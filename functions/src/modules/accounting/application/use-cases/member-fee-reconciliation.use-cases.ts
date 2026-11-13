import { prepareMemberFeeStatus } from '../member-fee-status.js';
import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type {
  AccountingPeriod,
  Actor,
  EntityWithId,
  FeePreview,
  FinancialConfigDocument,
  FinancialMovementDocument,
  MemberFeeChargeDocument,
  ReferencedMemberDocument,
} from '../../domain/models.js';
import type { AccountingDataAccess, AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  buildFeePreview,
  calculateEarlyPaymentDiscount,
  calculateMembershipRenewalDueDateFromPeriod,
  ensureDirectivo,
  ensureStaff,
  parseOptionalBoolean,
  parseRequiredAccountingPeriod,
} from '../shared.js';

const PAGE_SIZE = 200;
const MAX_REPAIR_WRITES = 350;

type ReconciliationSource = 'payment_allocation' | 'origin_charge' | 'period_member' | 'fully_paid_total';

type MovementAllocation = {
  movement: EntityWithId<FinancialMovementDocument>;
  charge: EntityWithId<MemberFeeChargeDocument>;
  source: ReconciliationSource;
  appliedAmountMinor: number;
  settlementAmountMinor?: number | undefined;
  discountPctBps?: number | undefined;
  discountAmountMinor?: number | undefined;
  discountMode?: 'automatic' | 'manual' | 'none' | undefined;
};

type PlannedCharge = {
  charge: EntityWithId<MemberFeeChargeDocument>;
  movementIds: string[];
  paidClubAmountMinor: number;
  remainingAmountMinor: number;
  settlementAmountMinor: number;
  paidMovementId: string | null;
  paidAt: Timestamp | null;
  paymentDiscountPctBps: number;
  paymentDiscountAmountMinor: number;
  paymentDiscountMode: 'automatic' | 'manual' | 'none';
  createDocument: boolean;
};

export interface ReconcileMemberFeeRenewalsInput {
  period: AccountingPeriod;
  execute: boolean;
  markFullyPaidOnly: boolean;
}

export interface ReconcileMemberFeeRenewalsResult {
  period: AccountingPeriod;
  mode: 'dry-run' | 'execute';
  scannedMovementCount: number;
  feeMovementCount: number;
  scannedPeriodChargeCount: number;
  matchedAllocationCount: number;
  alreadySynchronizedCount: number;
  repairedChargeCount: number;
  repairedMemberCount: number;
  ambiguousCount: number;
  fullyPaidCandidateCount: number;
  fullyPaidCandidates: Array<{
    chargeId: string;
    memberId: string;
    memberName: string | null;
    memberNumber: string | null;
    chargePeriod: AccountingPeriod;
    paidAmountMinor: number;
    settlementAmountMinor: number;
    movementCount: number;
    lastMovementId: string;
  }>;
  skipped: Array<{
    movementId: string;
    memberId: string | null;
    memberName: string | null;
    memberNumber: string | null;
    reason: string;
  }>;
  repairs: Array<{
    movementId: string;
    chargeId: string;
    memberId: string;
    memberName: string | null;
    memberNumber: string | null;
    chargePeriod: AccountingPeriod;
    source: ReconciliationSource;
    appliedAmountMinor: number;
    remainingAmountMinor: number;
    completed: boolean;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

function readDiscountMode(record: Record<string, unknown>): 'automatic' | 'manual' | 'none' | undefined {
  const value = record.discountMode;
  return value === 'automatic' || value === 'manual' || value === 'none' ? value : undefined;
}

function chargeMemberId(charge: MemberFeeChargeDocument): string | null {
  return charge.memberId ?? charge.holderMemberId ?? null;
}

function movementClubAmountMinor(movement: FinancialMovementDocument): number {
  const metadata = movement.metadata;
  const storedClubAmount = isRecord(metadata) ? readNumber(metadata, 'clubAmountMinor') : undefined;
  return storedClubAmount && storedClubAmount > 0 ? storedClubAmount : movement.netAmountMinor;
}

function inferSettlementFromMovement(
  movement: FinancialMovementDocument,
  charge: MemberFeeChargeDocument,
  config?: EntityWithId<FinancialConfigDocument>,
) {
  const metadata = isRecord(movement.metadata) ? movement.metadata : {};
  const storedDiscountAmountMinor = readNumber(metadata, 'memberFeeEarlyPaymentDiscountAmountMinor')
    ?? readNumber(metadata, 'earlyPaymentDiscountAmountMinor');
  const storedDiscountPctBps = readNumber(metadata, 'earlyPaymentDiscountPctBps');
  if (storedDiscountAmountMinor !== undefined || storedDiscountPctBps !== undefined) {
    const discountAmountMinor = Math.max(storedDiscountAmountMinor ?? 0, 0);
    return {
      settlementAmountMinor: Math.max(charge.finalAmountMinor - discountAmountMinor, 0),
      discountPctBps: Math.max(storedDiscountPctBps ?? 0, 0),
      discountAmountMinor,
      discountMode: (discountAmountMinor > 0 ? 'automatic' : 'none') as 'automatic' | 'none',
    };
  }
  if (config) {
    const calculated = calculateEarlyPaymentDiscount({
      chargeAmountMinor: charge.finalAmountMinor,
      config,
      chargePeriod: charge.period,
      operationDate: movement.operationDate.toDate(),
    });
    if (calculated.qualifies && movementClubAmountMinor(movement) === calculated.paidAmountMinor) {
      return {
        settlementAmountMinor: calculated.paidAmountMinor,
        discountPctBps: calculated.discountPctBps,
        discountAmountMinor: calculated.discountAmountMinor,
        discountMode: 'automatic' as const,
      };
    }
  }
  return {
    settlementAmountMinor: charge.finalAmountMinor,
    discountPctBps: 0,
    discountAmountMinor: 0,
    discountMode: 'none' as const,
  };
}
function buildMissingChargeSnapshot(params: {
  movement: EntityWithId<FinancialMovementDocument>;
  member: EntityWithId<ReferencedMemberDocument>;
  config: EntityWithId<FinancialConfigDocument>;
  period: AccountingPeriod;
}): { charge: EntityWithId<MemberFeeChargeDocument>; preview: FeePreview } {
  const preview = buildFeePreview({
    member: params.member,
    config: params.config,
    period: params.period,
  });
  const metadata = isRecord(params.movement.metadata) ? params.movement.metadata : {};
  const storedBaseAmountMinor = readNumber(metadata, 'memberFeeBaseAmountMinor');
  const storedTypeDiscountAmountMinor = readNumber(metadata, 'memberFeeTypeDiscountAmountMinor');
  const baseAmountMinor = storedBaseAmountMinor ?? preview.baseAmountMinor;
  const finalAmountMinor = storedBaseAmountMinor !== undefined || storedTypeDiscountAmountMinor !== undefined
    ? Math.max(baseAmountMinor - (storedTypeDiscountAmountMinor ?? 0), 0)
    : preview.finalAmountMinor;
  const appliedPctBps = baseAmountMinor > 0
    ? Math.max(0, Math.min(10_000, Math.round((finalAmountMinor * 10_000) / baseAmountMinor)))
    : preview.appliedPctBps;
  const chargeId = 'reconstructed:' + params.member.id + ':' + params.period;

  return {
    preview,
    charge: {
      id: chargeId,
      memberId: params.member.id,
      familyGroupId: preview.familyGroupId ?? null,
      holderMemberId: preview.holderMemberId ?? null,
      period: params.period,
      configVersion: preview.configVersion,
      memberTypeCodeSnapshot: preview.memberTypeCodeSnapshot,
      billingMode: preview.billingMode,
      baseAmountMinor,
      appliedPctBps,
      finalAmountMinor,
      status: 'pending',
      dueDate: null,
      generatedByUid: params.movement.registeredByUid,
      paidMovementId: null,
      paymentMovementIds: [],
      paidAt: null,
      paidAmountMinor: 0,
      settlementAmountMinor: null,
      paidClubAmountMinor: 0,
      remainingAmountMinor: finalAmountMinor,
      paymentDiscountPctBps: 0,
      paymentDiscountAmountMinor: 0,
      paymentDiscountMode: 'none',
      notes: null,
      createdAt: params.movement.createdAt,
      createdBy: params.movement.createdBy,
      updatedAt: params.movement.updatedAt,
      updatedBy: params.movement.updatedBy,
    },
  };
}

async function listMovementsForPeriod(dataAccess: AccountingDataAccess, period: AccountingPeriod) {
  const items: Array<EntityWithId<FinancialMovementDocument>> = [];
  let cursorId: string | undefined;
  do {
    const page = await dataAccess.financialMovements.listPage({
      accountingPeriod: period,
      status: 'posted',
      limit: PAGE_SIZE,
      ...(cursorId ? { cursorId } : {}),
    });
    items.push(...page.items);
    cursorId = page.nextCursorId;
  } while (cursorId);
  return items;
}

async function listChargesForPeriod(dataAccess: AccountingDataAccess, period: AccountingPeriod) {
  const items: Array<EntityWithId<MemberFeeChargeDocument>> = [];
  let cursorId: string | undefined;
  do {
    const page = await dataAccess.memberFeeCharges.listPage({
      period,
      limit: PAGE_SIZE,
      ...(cursorId ? { cursorId } : {}),
    });
    items.push(...page.items);
    cursorId = page.nextCursorId;
  } while (cursorId);
  return items;
}

async function listChargesForMember(dataAccess: AccountingDataAccess, memberId: string) {
  const items: Array<EntityWithId<MemberFeeChargeDocument>> = [];
  let cursorId: string | undefined;
  do {
    const page = await dataAccess.memberFeeCharges.listPage({
      memberId,
      limit: PAGE_SIZE,
      ...(cursorId ? { cursorId } : {}),
    });
    items.push(...page.items);
    cursorId = page.nextCursorId;
  } while (cursorId);
  return items;
}

function parsePaymentAllocations(movement: EntityWithId<FinancialMovementDocument>) {
  const metadata = isRecord(movement.metadata) ? movement.metadata : null;
  const allocations = metadata?.paymentAllocations;
  if (!Array.isArray(allocations)) return [];
  return allocations.flatMap((value) => {
    if (!isRecord(value) || typeof value.chargeId !== 'string' || !value.chargeId.trim()) return [];
    const appliedAmountMinor = readNumber(value, 'appliedClubAmountMinor');
    if (!appliedAmountMinor || appliedAmountMinor <= 0) return [];
    return [{
      chargeId: value.chargeId.trim(),
      appliedAmountMinor,
      settlementAmountMinor: readNumber(value, 'settlementAmountMinor'),
      discountPctBps: readNumber(value, 'discountPctBps'),
      discountAmountMinor: readNumber(value, 'discountAmountMinor'),
      discountMode: readDiscountMode(value),
    }];
  });
}

function getStoredPaidAmount(charge: MemberFeeChargeDocument, settlementAmountMinor: number) {
  const paidFromRemaining = typeof charge.remainingAmountMinor === 'number'
    ? settlementAmountMinor - charge.remainingAmountMinor
    : 0;
  return Math.min(Math.max(
    charge.paidClubAmountMinor ?? 0,
    charge.paidAmountMinor ?? 0,
    paidFromRemaining,
    charge.status === 'paid' ? settlementAmountMinor : 0,
    0,
  ), settlementAmountMinor);
}

function isOpenChargeStatus(status: MemberFeeChargeDocument['status']) {
  return status === 'pending' || status === 'overdue';
}

export async function reconcileMemberFeeRenewalsUseCase(params: {
  actor: Actor | null;
  input: ReconcileMemberFeeRenewalsInput;
  transactions: AccountingTransactionManager;
}): Promise<ReconcileMemberFeeRenewalsResult> {
  const actor = params.input.execute ? ensureDirectivo(params.actor) : ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const [allMovements, periodCharges, activeConfig] = await Promise.all([
      listMovementsForPeriod(dataAccess, params.input.period),
      listChargesForPeriod(dataAccess, params.input.period),
      dataAccess.financialConfigs.getActive(),
    ]);
    assertCondition(activeConfig, 'failed-precondition', 'No existe una configuracion financiera activa.');
    const feeMovements = allMovements
      .filter((movement) =>
        movement.movementType === 'income'
        && movement.categoryCodeSnapshot === FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria
        && movement.status === 'posted'
        && movement.installmentRole !== 'charge')
      .sort((left, right) => left.operationDate.toMillis() - right.operationDate.toMillis());
    const feeMovementById = new Map(feeMovements.map((movement) => [movement.id, movement]));
    const chargeCache = new Map(periodCharges.map((charge) => [charge.id, charge]));
    const periodChargesByMemberId = new Map<string, Array<EntityWithId<MemberFeeChargeDocument>>>();
    periodCharges.forEach((charge) => {
      const memberId = chargeMemberId(charge);
      if (!memberId) return;
      const current = periodChargesByMemberId.get(memberId) ?? [];
      current.push(charge);
      periodChargesByMemberId.set(memberId, current);
    });

    const allocations: MovementAllocation[] = [];
    const skipped: Array<{ movementId: string; reason: string }> = [];
    for (const movement of feeMovements) {
      const explicitAllocations = parsePaymentAllocations(movement);
      if (explicitAllocations.length > 0) {
        for (const allocation of explicitAllocations) {
          let charge = chargeCache.get(allocation.chargeId) ?? null;
          if (!charge) {
            charge = await dataAccess.memberFeeCharges.getById(allocation.chargeId);
            if (charge) chargeCache.set(charge.id, charge);
          }
          if (!charge) {
            skipped.push({ movementId: movement.id, reason: `No existe la cuota explicita ${allocation.chargeId}.` });
            continue;
          }
          const memberId = chargeMemberId(charge);
          if (movement.thirdPartyId && memberId && movement.thirdPartyId !== memberId) {
            skipped.push({ movementId: movement.id, reason: `La cuota ${charge.id} pertenece a otro socio.` });
            continue;
          }
          allocations.push({ movement, charge, source: 'payment_allocation', ...allocation });
        }
        continue;
      }

      if (movement.originCollection === 'member_fee_charges' && movement.originId) {
        let charge = chargeCache.get(movement.originId) ?? null;
        if (!charge) {
          charge = await dataAccess.memberFeeCharges.getById(movement.originId);
          if (charge) chargeCache.set(charge.id, charge);
        }
        if (!charge) {
          skipped.push({ movementId: movement.id, reason: `No existe la cuota de origen ${movement.originId}.` });
          continue;
        }
        allocations.push({
          movement,
          charge,
          source: 'origin_charge',
          appliedAmountMinor: movementClubAmountMinor(movement),
          ...inferSettlementFromMovement(movement, charge, activeConfig),
        });
        continue;
      }

      skipped.push({ movementId: movement.id, reason: 'Sin vínculo explícito a una cuota. Seleccioná la asociación administrativa mediante comprobantes; no se infiere por mes de cobro.' });
    }

    const planned = new Map<string, PlannedCharge>();
    const repairs: ReconcileMemberFeeRenewalsResult['repairs'] = [];
    let alreadySynchronizedCount = 0;
    for (const allocation of allocations) {
      const existing = planned.get(allocation.charge.id);
      const settlementAmountMinor = existing?.settlementAmountMinor
        ?? allocation.charge.settlementAmountMinor
        ?? allocation.settlementAmountMinor
        ?? allocation.charge.finalAmountMinor;
      const movementIds = existing?.movementIds
        ?? [...new Set([
          ...(allocation.charge.paymentMovementIds ?? []),
          ...(allocation.charge.paidMovementId ? [allocation.charge.paidMovementId] : []),
        ])];
      if (movementIds.includes(allocation.movement.id)) {
        alreadySynchronizedCount += 1;
        continue;
      }
      if (!isOpenChargeStatus(existing?.charge.status ?? allocation.charge.status)) {
        if (allocation.charge.status === 'paid') alreadySynchronizedCount += 1;
        else skipped.push({ movementId: allocation.movement.id, reason: `La cuota ${allocation.charge.id} no admite conciliacion por estado ${allocation.charge.status}.` });
        continue;
      }
      const paidClubAmountMinor = existing?.paidClubAmountMinor
        ?? getStoredPaidAmount(allocation.charge, settlementAmountMinor);
      const storedRemainingAmountMinor = allocation.charge.id.startsWith('reconstructed:')
        ? undefined
        : allocation.charge.remainingAmountMinor;
      const remainingAmountMinor = existing?.remainingAmountMinor
        ?? storedRemainingAmountMinor
        ?? Math.max(settlementAmountMinor - paidClubAmountMinor, 0);      if (allocation.appliedAmountMinor <= 0 || allocation.appliedAmountMinor > remainingAmountMinor) {
        skipped.push({ movementId: allocation.movement.id, reason: `El importe no coincide con el saldo de la cuota ${allocation.charge.id}.` });
        continue;
      }
      const nextPaidClubAmountMinor = paidClubAmountMinor + allocation.appliedAmountMinor;
      const nextRemainingAmountMinor = remainingAmountMinor - allocation.appliedAmountMinor;
      const completed = nextRemainingAmountMinor === 0;
      planned.set(allocation.charge.id, {
        charge: allocation.charge,
        movementIds: [...movementIds, allocation.movement.id],
        paidClubAmountMinor: nextPaidClubAmountMinor,
        remainingAmountMinor: nextRemainingAmountMinor,
        settlementAmountMinor,
        paidMovementId: completed ? allocation.movement.id : existing?.paidMovementId ?? allocation.charge.paidMovementId ?? null,
        paidAt: completed ? allocation.movement.operationDate : existing?.paidAt ?? allocation.charge.paidAt ?? null,
        paymentDiscountPctBps: allocation.discountPctBps ?? existing?.paymentDiscountPctBps ?? allocation.charge.paymentDiscountPctBps ?? 0,
        paymentDiscountAmountMinor: allocation.discountAmountMinor ?? existing?.paymentDiscountAmountMinor ?? allocation.charge.paymentDiscountAmountMinor ?? 0,
        paymentDiscountMode: allocation.discountMode ?? existing?.paymentDiscountMode ?? allocation.charge.paymentDiscountMode ?? 'none',
        createDocument: existing?.createDocument ?? allocation.charge.id.startsWith('reconstructed:'),
      });
      repairs.push({
        movementId: allocation.movement.id,
        chargeId: allocation.charge.id,
        memberId: chargeMemberId(allocation.charge) ?? '',
        chargePeriod: allocation.charge.period,
        memberName: null,
        memberNumber: null,
        source: allocation.source,
        appliedAmountMinor: allocation.appliedAmountMinor,
        remainingAmountMinor: nextRemainingAmountMinor,
        completed,
      });
    }

    const allocationsByChargeId = new Map<string, MovementAllocation[]>();
    allocations.forEach((allocation) => {
      const current = allocationsByChargeId.get(allocation.charge.id) ?? [];
      current.push(allocation);
      allocationsByChargeId.set(allocation.charge.id, current);
    });
    for (const charge of periodCharges) {
      if (!isOpenChargeStatus(charge.status)) continue;
      const relatedAllocations = [...(allocationsByChargeId.get(charge.id) ?? [])];
      const knownMovementIds = new Set(relatedAllocations.map((allocation) => allocation.movement.id));
      const linkedMovementIds = [...new Set([
        ...(charge.paymentMovementIds ?? []),
        ...(charge.paidMovementId ? [charge.paidMovementId] : []),
      ])].filter((movementId) => !knownMovementIds.has(movementId));
      const linkedMovements = await Promise.all(
        linkedMovementIds.map((movementId) => dataAccess.financialMovements.getById(movementId)),
      );
      linkedMovements.forEach((movement) => {
        if (!movement
          || movement.status !== 'posted'
          || movement.installmentRole === 'charge'
          || movement.movementType !== 'income'
          || movement.categoryCodeSnapshot !== FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria) return;
        feeMovementById.set(movement.id, movement);
        const explicitAllocation = parsePaymentAllocations(movement)
          .find((allocation) => allocation.chargeId === charge.id);
        if (explicitAllocation) {
          relatedAllocations.push({ movement, charge, source: 'payment_allocation', ...explicitAllocation });
          return;
        }
        if (movement.originCollection !== 'member_fee_charges' || movement.originId !== charge.id) return;
        relatedAllocations.push({
          movement,
          charge,
          source: 'origin_charge',
          appliedAmountMinor: movementClubAmountMinor(movement),
          ...inferSettlementFromMovement(movement, charge, activeConfig),
        });
      });
      if (relatedAllocations.length === 0) continue;
      const uniqueAllocationByMovementId = new Map<string, MovementAllocation>();
      relatedAllocations.forEach((allocation) => uniqueAllocationByMovementId.set(allocation.movement.id, allocation));
      const uniqueAllocations = [...uniqueAllocationByMovementId.values()];
      const currentPlan = planned.get(charge.id);
      const settlementAmountMinor = currentPlan?.settlementAmountMinor
        ?? charge.settlementAmountMinor
        ?? uniqueAllocations.find((allocation) => allocation.settlementAmountMinor !== undefined)?.settlementAmountMinor
        ?? charge.finalAmountMinor;
      if (settlementAmountMinor <= 0) continue;
      const paidFromMovements = uniqueAllocations.reduce((total, allocation) => total + allocation.appliedAmountMinor, 0);
      const paidClubAmountMinor = Math.min(
        Math.max(currentPlan?.paidClubAmountMinor ?? 0, getStoredPaidAmount(charge, settlementAmountMinor), paidFromMovements),
        settlementAmountMinor,
      );
      if (paidClubAmountMinor < settlementAmountMinor) continue;
      const latestAllocation = [...uniqueAllocations]
        .sort((left, right) => right.movement.operationDate.toMillis() - left.movement.operationDate.toMillis())[0];
      if (!latestAllocation) continue;
      const movementIds = [...new Set([
        ...(charge.paymentMovementIds ?? []),
        ...(charge.paidMovementId ? [charge.paidMovementId] : []),
        ...uniqueAllocations.map((allocation) => allocation.movement.id),
      ])];
      planned.set(charge.id, {
        charge,
        movementIds,
        paidClubAmountMinor,
        remainingAmountMinor: 0,
        settlementAmountMinor,
        paidMovementId: latestAllocation.movement.id,
        paidAt: latestAllocation.movement.operationDate,
        paymentDiscountPctBps: currentPlan?.paymentDiscountPctBps ?? latestAllocation.discountPctBps ?? charge.paymentDiscountPctBps ?? 0,
        paymentDiscountAmountMinor: currentPlan?.paymentDiscountAmountMinor ?? latestAllocation.discountAmountMinor ?? charge.paymentDiscountAmountMinor ?? 0,
        paymentDiscountMode: currentPlan?.paymentDiscountMode ?? latestAllocation.discountMode ?? charge.paymentDiscountMode ?? 'none',
        createDocument: false,
      });
      if (!repairs.some((repair) => repair.chargeId === charge.id && repair.completed)) {
        repairs.push({
          movementId: latestAllocation.movement.id,
          chargeId: charge.id,
          memberId: chargeMemberId(charge) ?? '',
          chargePeriod: charge.period,
          memberName: null,
          memberNumber: null,
          source: 'fully_paid_total',
          appliedAmountMinor: paidClubAmountMinor,
          remainingAmountMinor: 0,
          completed: true,
        });
      }
    }

    const executionPlans = params.input.markFullyPaidOnly
      ? new Map([...planned].filter(([, repair]) => repair.remainingAmountMinor === 0))
      : planned;
    const affectedMemberIds = [...new Set(
      [...executionPlans.values()]
        .map((item) => chargeMemberId(item.charge))
        .filter((value): value is string => Boolean(value)),
    )];
    const memberPatches = new Map<string, Awaited<ReturnType<typeof prepareMemberFeeStatus>>>();
    for (const memberId of affectedMemberIds) {
      const changes = [...executionPlans.values()].filter((repair) => chargeMemberId(repair.charge) === memberId).map((repair) => ({ id: repair.charge.id, period: repair.charge.period, status: repair.remainingAmountMinor === 0 ? 'paid' : repair.charge.status }));
      memberPatches.set(memberId, await prepareMemberFeeStatus(dataAccess, memberId, changes));
    }

    const skippedMemberIdByMovementId = new Map(
      skipped.map((item) => [
        item.movementId,
        feeMovements.find((movement) => movement.id === item.movementId)?.thirdPartyId ?? null,
      ]),
    );
    const diagnosticMemberIds = [...new Set([
      ...repairs.map((repair) => repair.memberId),
      ...skippedMemberIdByMovementId.values(),
    ].filter((value): value is string => Boolean(value)))];
    const diagnosticMembers = await Promise.all(
      diagnosticMemberIds.map(async (memberId) => [memberId, await dataAccess.members.getById(memberId)] as const),
    );
    const diagnosticMemberById = new Map(diagnosticMembers);

    assertCondition(
      executionPlans.size + memberPatches.size <= MAX_REPAIR_WRITES,
      'failed-precondition',
      `La sincronizacion requiere mas de ${MAX_REPAIR_WRITES} escrituras. Elegi un periodo mas acotado.`,
    );

    if (params.input.execute) {
      const createdChargeIds = new Map<string, string>();
      for (const repair of executionPlans.values()) {
        const completed = repair.remainingAmountMinor === 0;
        const notes = [
          repair.charge.notes?.trim(),
          `Sincronizada con movimientos contables del periodo ${params.input.period}.`,
        ].filter(Boolean).join('\n');
        if (repair.createDocument) {
          const createdChargeId = await dataAccess.memberFeeCharges.create({
            memberId: repair.charge.memberId ?? null,
            familyGroupId: repair.charge.familyGroupId ?? null,
            holderMemberId: repair.charge.holderMemberId ?? null,
            period: repair.charge.period,
            configVersion: repair.charge.configVersion,
            memberTypeCodeSnapshot: repair.charge.memberTypeCodeSnapshot,
            billingMode: repair.charge.billingMode,
            baseAmountMinor: repair.charge.baseAmountMinor,
            appliedPctBps: repair.charge.appliedPctBps,
            finalAmountMinor: repair.charge.finalAmountMinor,
            status: completed ? 'paid' : repair.charge.status,
            dueDate: repair.charge.dueDate ?? null,
            generatedByUid: repair.charge.generatedByUid,
            paidMovementId: repair.paidMovementId,
            paymentMovementIds: repair.movementIds,
            paidAt: repair.paidAt,
            paidAmountMinor: repair.paidClubAmountMinor,
            settlementAmountMinor: repair.settlementAmountMinor,
            paidClubAmountMinor: repair.paidClubAmountMinor,
            remainingAmountMinor: repair.remainingAmountMinor,
            paymentDiscountPctBps: repair.paymentDiscountPctBps,
            paymentDiscountAmountMinor: repair.paymentDiscountAmountMinor,
            paymentDiscountMode: repair.paymentDiscountMode,
            notes,
          }, actor.uid);
          createdChargeIds.set(repair.charge.id, createdChargeId);
        } else {
          await dataAccess.memberFeeCharges.update(repair.charge.id, {
            status: completed ? 'paid' : repair.charge.status,
            paidMovementId: repair.paidMovementId,
            paymentMovementIds: repair.movementIds,
            paidAt: repair.paidAt,
            paidAmountMinor: repair.paidClubAmountMinor,
            settlementAmountMinor: repair.settlementAmountMinor,
            paidClubAmountMinor: repair.paidClubAmountMinor,
            remainingAmountMinor: repair.remainingAmountMinor,
            paymentDiscountPctBps: repair.paymentDiscountPctBps,
            paymentDiscountAmountMinor: repair.paymentDiscountAmountMinor,
            paymentDiscountMode: repair.paymentDiscountMode,
            notes,
          }, actor.uid);
        }
      }
      for (const [memberId, patch] of memberPatches) {
        await dataAccess.members.update(memberId, patch, actor.uid);
      }
      repairs.forEach((repair) => {
        repair.chargeId = createdChargeIds.get(repair.chargeId) ?? repair.chargeId;
      });
    }

    return {
      period: params.input.period,
      mode: params.input.execute ? 'execute' : 'dry-run',
      scannedMovementCount: allMovements.length,
      feeMovementCount: feeMovements.length,
      scannedPeriodChargeCount: periodCharges.length,
      matchedAllocationCount: allocations.length,
      alreadySynchronizedCount,
      repairedChargeCount: executionPlans.size,
      repairedMemberCount: memberPatches.size,
      ambiguousCount: skipped.length,
      fullyPaidCandidateCount: [...planned.values()].filter((repair) => repair.remainingAmountMinor === 0).length,
      fullyPaidCandidates: [...planned.values()]
        .filter((repair) => repair.remainingAmountMinor === 0 && repair.paidMovementId)
        .map((repair) => {
          const memberId = chargeMemberId(repair.charge) ?? '';
          const member = diagnosticMemberById.get(memberId);
          return {
            chargeId: repair.charge.id,
            memberId,
            memberName: member ? `${member.lastName}, ${member.firstName}` : null,
            memberNumber: member?.memberNumber ?? null,
            chargePeriod: repair.charge.period,
            paidAmountMinor: repair.paidClubAmountMinor,
            settlementAmountMinor: repair.settlementAmountMinor,
            movementCount: repair.movementIds.length,
            lastMovementId: repair.paidMovementId!,
          };
        }),
      skipped: skipped.map((item) => {
        const memberId = skippedMemberIdByMovementId.get(item.movementId) ?? null;
        const member = memberId ? diagnosticMemberById.get(memberId) : null;
        return {
          ...item,
          memberId,
          memberName: member ? `${member.lastName}, ${member.firstName}` : null,
          memberNumber: member?.memberNumber ?? null,
        };
      }),
      repairs: repairs
        .filter((repair) => !params.input.markFullyPaidOnly || executionPlans.has(repair.chargeId))
        .map((repair) => {
        const member = diagnosticMemberById.get(repair.memberId);
        return { ...repair, memberName: member ? `${member.lastName}, ${member.firstName}` : null, memberNumber: member?.memberNumber ?? null };
      }),
    };
  });
}

export function parseReconcileMemberFeeRenewalsInput(payload: unknown): ReconcileMemberFeeRenewalsInput {
  const data = assertIsRecord(payload);
  return {
    period: parseRequiredAccountingPeriod(data, 'period'),
    execute: parseOptionalBoolean(data, 'execute') ?? false,
    markFullyPaidOnly: parseOptionalBoolean(data, 'markFullyPaidOnly') ?? false,
  };
}
