import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { prepareMemberFeeStatus } from '../member-fee-status.js';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { AccountingPeriod, Actor, EntityWithId, MemberFeeChargeDocument, ReferencedMemberDocument } from '../../domain/models.js';
import type { AccountingDataAccess, AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  calculateAmountFromBps,
  calculateEarlyPaymentDiscount,
  calculateMembershipRenewalDueDateFromPeriod,
  ensureStaff,
  parseOptionalBoolean,
  parseOptionalNullableString,
  parseOptionalAccountingPeriod,
  parseOptionalString,
  parseRequiredAmountMinor,
  parseRequiredIsoDate,
  parseRequiredString,
  toClubAccountingPeriod,
} from '../shared.js';
import { assertCashOperationDateAllowed } from '../cash-closure-guards.js';
import { createPostedMovement } from '../movement-helpers.js';
import { assertChargeNotLockedByPartialPlan, getActivePartialPlanIdForCharge } from '../member-fee-plan-lock.js';
import {
  buildMemberFeeChargeCreateData,
  computeFeePreviewInternal,
} from './fee.use-cases.js';

export interface MemberFeePaymentAllocationInput {
  expectedAvailableMinor?: number | undefined;
  chargeId?: string | undefined;
  memberId?: string | undefined;
  period?: AccountingPeriod | undefined;
  amountMinor?: number | undefined;
  settlementAmountMinor?: number | undefined;
  applyEarlyPaymentDiscount?: boolean | undefined;
}

export interface RegisterMemberFeeBatchPaymentInput {
  expectedCommissionPctBps?: number | undefined;
  allocations: MemberFeePaymentAllocationInput[];
  paymentMethodId: string;
  operationDate: Date;
  paymentReference?: string | null | undefined;
  notes?: string | null | undefined;
  idempotencyKey?: string | undefined;
}

type PreparedAllocation = {
  charge: { id: string } & MemberFeeChargeDocument;
  memberId: string;
  settlementAmountMinor: number;
  previouslyPaidMinor: number;
  createData?: ReturnType<typeof buildMemberFeeChargeCreateData> | undefined;
  appliedAmountMinor: number;
  remainingAmountMinor: number;
  discountPctBps: number;
  discountAmountMinor: number;
  discountMode: 'automatic' | 'manual' | 'none';
};

function buildReceiptNumber(operationDate: Date, movementId: string): string {
  const year = operationDate.getUTCFullYear();
  const month = String(operationDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(operationDate.getUTCDate()).padStart(2, '0');
  return `REC-${year}${month}${day}-${movementId.slice(0, 8).toUpperCase()}`;
}

function resolveStoredPaidAmount(charge: MemberFeeChargeDocument, settlementAmountMinor: number): number {
  const paidFromRemaining = typeof charge.remainingAmountMinor === 'number'
    ? settlementAmountMinor - charge.remainingAmountMinor
    : 0;
  const storedPaidAmountMinor = Math.max(
    charge.paidClubAmountMinor ?? 0,
    charge.paidAmountMinor ?? 0,
    paidFromRemaining,
    charge.status === 'paid' ? settlementAmountMinor : 0,
  );

  return Math.min(Math.max(storedPaidAmountMinor, 0), settlementAmountMinor);
}

function getStoredSettlementAmount(charge: MemberFeeChargeDocument): number | null {
  const paidClubAmountMinor = charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0;
  const isLegacyUnpaidDefault = charge.settlementAmountMinor === charge.finalAmountMinor
    && paidClubAmountMinor <= 0
    && (charge.paymentDiscountAmountMinor ?? 0) <= 0;

  return isLegacyUnpaidDefault ? null : charge.settlementAmountMinor ?? null;
}

type SettlementResolution = {
  settlementAmountMinor: number;
  discountPctBps: number;
  discountAmountMinor: number;
  discountMode: 'automatic' | 'manual' | 'none';
};

/**
 * Calculo unico del monto final de una cuota al cobrarla. Lo usan tanto la vista previa
 * como el cobro, para que el saldo mostrado sea exactamente el que el servidor admite.
 */
function resolveChargeSettlement(params: {
  charge: Pick<MemberFeeChargeDocument, 'finalAmountMinor' | 'period' | 'settlementAmountMinor' | 'paidClubAmountMinor' | 'paidAmountMinor' | 'paymentDiscountAmountMinor' | 'paymentDiscountPctBps' | 'paymentDiscountMode'>;
  config: Parameters<typeof calculateEarlyPaymentDiscount>[0]['config'];
  operationDate: Date;
  applyEarlyPaymentDiscount?: boolean | undefined;
  manualSettlementAmountMinor?: number | undefined;
}): SettlementResolution {
  const { charge } = params;
  if (params.manualSettlementAmountMinor !== undefined) {
    const discountAmountMinor = Math.max(charge.finalAmountMinor - params.manualSettlementAmountMinor, 0);
    return {
      settlementAmountMinor: params.manualSettlementAmountMinor,
      discountAmountMinor,
      discountPctBps: charge.finalAmountMinor > 0 ? Math.round((discountAmountMinor * 10_000) / charge.finalAmountMinor) : 0,
      discountMode: 'manual',
    };
  }
  const storedSettlementAmountMinor = getStoredSettlementAmount(charge as MemberFeeChargeDocument);
  if (storedSettlementAmountMinor !== null) {
    return {
      settlementAmountMinor: storedSettlementAmountMinor,
      discountPctBps: charge.paymentDiscountPctBps ?? 0,
      discountAmountMinor: charge.paymentDiscountAmountMinor ?? 0,
      discountMode: charge.paymentDiscountMode ?? 'none',
    };
  }
  const paymentAccountingPeriod = toClubAccountingPeriod(params.operationDate);
  const isCurrentPeriodCharge = charge.period === paymentAccountingPeriod;
  const preview = calculateEarlyPaymentDiscount({
    chargeAmountMinor: charge.finalAmountMinor,
    config: params.config,
    chargePeriod: charge.period,
    operationDate: params.operationDate,
  });
  let discountPctBps = 0;
  let discountAmountMinor = 0;
  let discountMode: SettlementResolution['discountMode'] = 'none';
  if (params.applyEarlyPaymentDiscount === true && isCurrentPeriodCharge && preview.qualifies) {
    discountPctBps = params.config.earlyPaymentDiscountPctBps ?? 0;
    discountAmountMinor = calculateAmountFromBps(charge.finalAmountMinor, discountPctBps);
    discountMode = 'automatic';
  } else if (preview.qualifies && (charge.period > paymentAccountingPeriod || params.applyEarlyPaymentDiscount === undefined)) {
    discountPctBps = preview.discountPctBps;
    discountAmountMinor = preview.discountAmountMinor;
    discountMode = 'automatic';
  }
  return {
    settlementAmountMinor: Math.max(charge.finalAmountMinor - discountAmountMinor, 0),
    discountPctBps,
    discountAmountMinor,
    discountMode,
  };
}

function allocationIdentity(allocation: MemberFeePaymentAllocationInput): string {
  return allocation.chargeId ?? `${allocation.memberId ?? ''}:${allocation.period ?? ''}`;
}

function getMembershipPeriodStart(period: AccountingPeriod): Date {
  return new Date(period + '-01T00:00:00-03:00');
}

function isOpenMemberFeeCharge(charge: EntityWithId<MemberFeeChargeDocument>) {
  return charge.status === 'pending' || charge.status === 'overdue';
}

async function listOpenMemberFeeChargesByFilter(
  dataAccess: AccountingDataAccess,
  filters: { memberId?: string; familyGroupId?: string },
) {
  const charges: Array<EntityWithId<MemberFeeChargeDocument>> = [];
  let cursorId: string | undefined;

  do {
    const page = await dataAccess.memberFeeCharges.listPage({
      ...filters,
      limit: 100,
      ...(cursorId ? { cursorId } : {}),
    });
    charges.push(...page.items.filter(isOpenMemberFeeCharge));
    cursorId = page.nextCursorId;
  } while (cursorId);

  return charges;
}

async function listOpenRenewalChargesForMember(
  dataAccess: AccountingDataAccess,
  member: EntityWithId<ReferencedMemberDocument>,
) {
  const chargeGroups = await Promise.all([
    listOpenMemberFeeChargesByFilter(dataAccess, { memberId: member.id }),
    ...(member.familyGroupId
      ? [listOpenMemberFeeChargesByFilter(dataAccess, { familyGroupId: member.familyGroupId })]
      : []),
  ]);

  const uniqueCharges = new Map<string, EntityWithId<MemberFeeChargeDocument>>();
  chargeGroups.flat().forEach((charge) => uniqueCharges.set(charge.id, charge));
  return [...uniqueCharges.values()];
}

export async function registerMemberFeeBatchPaymentUseCase(params: {
  actor: Actor | null;
  input: RegisterMemberFeeBatchPaymentInput;
  transactions: AccountingTransactionManager;
}) {
  const actor = ensureStaff(params.actor);
  assertCondition(params.input.allocations.length > 0, 'invalid-argument', 'Selecciona al menos una cuota para cobrar.');
  assertCondition(params.input.allocations.length <= 100, 'invalid-argument', 'No se pueden cobrar mas de 100 cuotas a la vez.');
  assertCondition(
    params.input.allocations.every((allocation) => (
      Boolean(allocation.chargeId)
        ? !allocation.memberId && !allocation.period
        : Boolean(allocation.memberId && allocation.period)
    )),
    'invalid-argument',
    'Cada cuota debe indicar chargeId o bien memberId y period para crearla al cobrar.',
  );
  assertCondition(
    new Set(params.input.allocations.map(allocationIdentity)).size === params.input.allocations.length,
    'invalid-argument',
    'La misma cuota no puede incluirse dos veces en el cobro.',
  );

  return params.transactions.runInTransaction(async (dataAccess) => {
    const operationKey = params.input.idempotencyKey ? createHash('sha256').update(actor.uid + ':' + params.input.idempotencyKey).digest('hex') : null;
    const fingerprint = createHash('sha256').update(JSON.stringify(params.input)).digest('hex');
    const previous = operationKey ? await dataAccess.operations?.get(operationKey) : null;
    if (previous) {
      assertCondition(previous.fingerprint === fingerprint, 'already-exists', 'Ya se registro un cobro con esta operacion (posiblemente tras un corte o una demora). Revisa los movimientos del socio antes de volver a cobrar.', { businessCode: 'OPERATION_ALREADY_RECORDED', action: 'CHECK_OPERATION', movementId: previous.result?.movementId ?? null });
      return { ...previous.result, duplicate: true };
    }
    await assertCashOperationDateAllowed({ dataAccess, operationDate: params.input.operationDate });
    const [category, paymentMethod, activeConfig, activeCommissionRule] = await Promise.all([
      dataAccess.financialIncomeCategories.getById(FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria),
      dataAccess.paymentMethods.getById(params.input.paymentMethodId),
      dataAccess.financialConfigs.getActive(),
      dataAccess.paymentCommissionRules.getActiveByPaymentMethodId(params.input.paymentMethodId),
    ]);
    assertCondition(category?.active, 'failed-precondition', 'La categoria cuota societaria no esta activa.');
    assertCondition(paymentMethod?.active, 'failed-precondition', 'El medio de pago no esta activo.');
    assertCondition(activeConfig, 'failed-precondition', 'No existe una configuracion financiera activa.');
    assertCondition(params.input.expectedCommissionPctBps === undefined || params.input.expectedCommissionPctBps === (activeCommissionRule?.percentageBps ?? 0), 'failed-precondition', 'La comisión cambió desde la consulta. Actualizá los importes antes de confirmar.', { businessCode: 'QUOTE_CHANGED', action: 'REFRESH_QUOTE' });
    const paymentReference = params.input.paymentReference?.trim() || null;
    assertCondition(
      paymentMethod.id === PAYMENT_METHOD_IDS.cash || Boolean(paymentReference),
      'invalid-argument',
      'La referencia es obligatoria para medios distintos de efectivo.',
    );

    const prepared: PreparedAllocation[] = [];
    for (const inputAllocation of params.input.allocations) {
      let createData: ReturnType<typeof buildMemberFeeChargeCreateData> | undefined;
      let charge = inputAllocation.chargeId
        ? await dataAccess.memberFeeCharges.getById(inputAllocation.chargeId)
        : null;
      if (!inputAllocation.chargeId) {
        const memberId = inputAllocation.memberId!;
        const period = inputAllocation.period!;
        const preview = await computeFeePreviewInternal({ dataAccess, memberId, period });
        charge = await dataAccess.memberFeeCharges.findDuplicate({
          memberId: preview.billingMode === 'per_member' ? preview.memberId : preview.holderMemberId ?? null,
          familyGroupId: preview.billingMode === 'single_group_charge' ? preview.familyGroupId ?? null : null,
          period: preview.period,
          billingMode: preview.billingMode,
        });
        if (!charge) {
          createData = buildMemberFeeChargeCreateData({
            preview,
            actorUid: actor.uid,
            dueDate: getMembershipPeriodStart(period),
            notes: `Cuota ${period} creada dentro del cobro administrativo.`,
          });
          const auditTimestamp = Timestamp.fromMillis(0);
          charge = {
            id: `pending:${allocationIdentity(inputAllocation)}`,
            ...createData,
            createdAt: auditTimestamp,
            createdBy: actor.uid,
            updatedAt: auditTimestamp,
            updatedBy: actor.uid,
          };
        }
      }
      assertCondition(charge, 'not-found', `No existe member_fee_charges/${inputAllocation.chargeId ?? allocationIdentity(inputAllocation)}.`);
      assertCondition(
        charge.status === 'pending' || charge.status === 'overdue',
        'failed-precondition',
        `La cuota ${charge.period} ya no admite pagos.`,
      );
      await assertChargeNotLockedByPartialPlan(dataAccess, charge);
      const memberId = charge.memberId ?? charge.holderMemberId ?? null;
      assertCondition(memberId, 'failed-precondition', 'La cuota no tiene socio asociado.');
      const member = await dataAccess.members.getById(memberId);
      assertCondition(member, 'not-found', `No existe members/${memberId}.`);
      assertCondition(member.status !== 'suspended', 'failed-precondition', 'No se pueden cobrar cuotas societarias de socios suspendidos.');
      assertCondition(!member.membershipBillingExempt, 'failed-precondition', 'El socio esta exento de cuota societaria.');

      assertCondition(
        inputAllocation.settlementAmountMinor === undefined || inputAllocation.settlementAmountMinor > 0,
        'invalid-argument',
        'El monto final de la cuota debe ser mayor a cero.',
      );
      const { settlementAmountMinor, discountPctBps, discountAmountMinor, discountMode } = resolveChargeSettlement({
        charge,
        config: activeConfig,
        operationDate: params.input.operationDate,
        applyEarlyPaymentDiscount: inputAllocation.applyEarlyPaymentDiscount,
        manualSettlementAmountMinor: inputAllocation.settlementAmountMinor,
      });

      const previouslyPaidMinor = resolveStoredPaidAmount(charge, settlementAmountMinor);
      const availableMinor = Math.max(settlementAmountMinor - previouslyPaidMinor, 0);
      assertCondition(inputAllocation.expectedAvailableMinor === undefined || inputAllocation.expectedAvailableMinor === availableMinor, 'failed-precondition', 'El importe de la cuota cambio. Actualiza la vista previa antes de confirmar.', { businessCode: 'QUOTE_CHANGED', action: 'REFRESH_QUOTE' });
      assertCondition(availableMinor > 0, 'failed-precondition', `La cuota ${charge.period} no tiene saldo pendiente.`);
      const appliedAmountMinor = inputAllocation.amountMinor ?? availableMinor;
      assertCondition(appliedAmountMinor > 0, 'invalid-argument', 'El importe parcial debe ser mayor a cero.');
      assertCondition(appliedAmountMinor <= availableMinor, 'invalid-argument', `El pago supera el saldo de la cuota ${charge.period}.`);
      prepared.push({
        charge,
        memberId,
        settlementAmountMinor,
        previouslyPaidMinor,
        appliedAmountMinor,
        remainingAmountMinor: Math.max(settlementAmountMinor - previouslyPaidMinor - appliedAmountMinor, 0),
        discountPctBps,
        discountAmountMinor,
        discountMode,
        createData,
      });
    }

    const memberIds = new Set(prepared.map((allocation) => allocation.memberId));
    assertCondition(memberIds.size === 1, 'invalid-argument', 'Un cobro multiple solo puede corresponder a un mismo socio.');
    const memberId = prepared[0]!.memberId;
    const paymentMember = await dataAccess.members.getById(memberId);
    assertCondition(paymentMember, 'not-found', `No existe members/${memberId}.`);
    const openChargesBeforePayment = await listOpenRenewalChargesForMember(dataAccess, paymentMember);
    const membershipStatus = await prepareMemberFeeStatus(dataAccess, memberId, prepared.map((allocation) => ({ id: allocation.charge.id, period: allocation.charge.period, status: allocation.remainingAmountMinor === 0 ? 'paid' : 'pending' })));
    for (const allocation of prepared) {
      if (!allocation.createData) continue;
      const memberFeeChargeId = await dataAccess.memberFeeCharges.create(allocation.createData, actor.uid);
      allocation.charge = { ...allocation.charge, id: memberFeeChargeId };
      allocation.createData = undefined;
    }
    const clubAmountMinor = prepared.reduce((total, allocation) => total + allocation.appliedAmountMinor, 0);
    const movement = await createPostedMovement({
      dataAccess,
      actorUid: actor.uid,
      movementType: 'income',
      categoryId: category.id,
      categoryCodeSnapshot: category.id,
      grossAmountMinor: clubAmountMinor,
      operationDate: params.input.operationDate,
      originType: 'member_fee_payment',
      originCollection: 'member_fee_charges',
      originId: prepared.length === 1 ? prepared[0]!.charge.id : null,
      thirdPartyType: 'member',
      thirdPartyId: memberId,
      paymentMethodId: paymentMethod.id,
      prefetchedPaymentMethod: paymentMethod,
      prefetchedActiveCommissionRule: activeCommissionRule ?? null,
      bancarizado: paymentMethod.bancarizado,
      imputableImpositivo: true,
      applyPaymentCommission: true,
      paymentCommissionMode: 'add_to_charge',
      metadata: {
        idempotencyKey: params.input.idempotencyKey ?? null,
        paymentReference,
        feePaymentAccountingPeriod: toClubAccountingPeriod(params.input.operationDate),
        paymentAllocations: prepared.map((allocation) => ({
          chargeId: allocation.charge.id,
          period: allocation.charge.period,
          appliedClubAmountMinor: allocation.appliedAmountMinor,
          settlementAmountMinor: allocation.settlementAmountMinor,
          remainingAmountMinor: allocation.remainingAmountMinor,
          discountPctBps: allocation.discountPctBps,
          discountAmountMinor: allocation.discountAmountMinor,
          discountMode: allocation.discountMode,
        })),
      },
      notes: params.input.notes ?? null,
    });
    const receiptNumber = buildReceiptNumber(params.input.operationDate, movement.movementId);
    await dataAccess.financialMovements.update(movement.movementId, {
      metadata: {
        idempotencyKey: params.input.idempotencyKey ?? null,
        paymentReference,
        receiptNumber,
        receiptIssuedAt: Timestamp.fromDate(params.input.operationDate),
        receiptSource: 'member_fee_payment',
        appliedCommissionPctBps: movement.appliedCommissionPctBps,
        appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
        clubAmountMinor: movement.netAmountMinor,
        amountToChargeMinor: movement.grossAmountMinor,
        paymentAllocations: prepared.map((allocation) => ({
          chargeId: allocation.charge.id,
          period: allocation.charge.period,
          appliedClubAmountMinor: allocation.appliedAmountMinor,
          settlementAmountMinor: allocation.settlementAmountMinor,
          remainingAmountMinor: allocation.remainingAmountMinor,
          discountPctBps: allocation.discountPctBps,
          discountAmountMinor: allocation.discountAmountMinor,
          discountMode: allocation.discountMode,
        })),
      },
    }, actor.uid);

    for (const allocation of prepared) {
      const paidClubAmountMinor = Math.min(
        allocation.previouslyPaidMinor + allocation.appliedAmountMinor,
        allocation.settlementAmountMinor,
      );
      const remainingAmountMinor = Math.max(allocation.settlementAmountMinor - paidClubAmountMinor, 0);
      const completed = paidClubAmountMinor >= allocation.settlementAmountMinor;
      allocation.remainingAmountMinor = remainingAmountMinor;
      await dataAccess.memberFeeCharges.update(allocation.charge.id, {
        status: completed ? 'paid' : allocation.charge.status,
        paidMovementId: completed ? movement.movementId : allocation.charge.paidMovementId ?? null,
        paymentMovementIds: [...new Set([...(allocation.charge.paymentMovementIds ?? (allocation.charge.paidMovementId ? [allocation.charge.paidMovementId] : [])), movement.movementId])],
        paidAt: completed ? Timestamp.fromDate(params.input.operationDate) : null,
        paidAmountMinor: paidClubAmountMinor,
        settlementAmountMinor: allocation.settlementAmountMinor,
        paidClubAmountMinor,
        remainingAmountMinor,
        paymentDiscountPctBps: allocation.discountPctBps,
        paymentDiscountAmountMinor: allocation.discountAmountMinor,
        paymentDiscountMode: allocation.discountMode,
      }, actor.uid);
    }

    const selectedIds = new Set(prepared.map((allocation) => allocation.charge.id));
    const keepsOpenDebt = prepared.some((allocation) => allocation.remainingAmountMinor > 0)
      || openChargesBeforePayment.some((charge) => {
        const selected = prepared.find((allocation) => allocation.charge.id === charge.id);
        return !selectedIds.has(charge.id) || Boolean(selected && selected.remainingAmountMinor > 0);
      });
    const latestPaidPeriod = prepared
      .map((allocation) => allocation.charge.period)
      .sort((left, right) => right.localeCompare(left))[0]!;
    await dataAccess.members.update(memberId, {
      lastFeePaymentAt: Timestamp.fromDate(params.input.operationDate),
      ...membershipStatus,
      lastFeePaidAmountMinor: clubAmountMinor,
    }, actor.uid);

    const result = {
      duplicate: false,
      memberId,
      movementId: movement.movementId,
      grossAmountMinor: movement.grossAmountMinor,
      netAmountMinor: movement.netAmountMinor,
      appliedCommissionPctBps: movement.appliedCommissionPctBps,
      appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
      receiptNumber,
      completedChargeIds: prepared.filter((allocation) => allocation.remainingAmountMinor === 0).map((allocation) => allocation.charge.id),
      remainingChargeIds: prepared.filter((allocation) => allocation.remainingAmountMinor > 0).map((allocation) => allocation.charge.id),
    };
    if (operationKey) await dataAccess.operations?.set(operationKey, fingerprint, result);
    return result;
  });
}

export function parseRegisterMemberFeeBatchPaymentInput(payload: unknown): RegisterMemberFeeBatchPaymentInput {
  const data = assertIsRecord(payload);
  assertCondition(Array.isArray(data.allocations), 'invalid-argument', 'allocations debe ser un arreglo.');
  const allocations = data.allocations.map((rawAllocation) => {
    const allocation = assertIsRecord(rawAllocation);
    return {
      expectedAvailableMinor: allocation.expectedAvailableMinor === undefined ? undefined : parseRequiredAmountMinor(allocation, 'expectedAvailableMinor'),
      chargeId: parseOptionalString(allocation, 'chargeId'),
      memberId: parseOptionalString(allocation, 'memberId'),
      period: parseOptionalAccountingPeriod(allocation, 'period'),
      amountMinor: allocation.amountMinor === undefined ? undefined : parseRequiredAmountMinor(allocation, 'amountMinor'),
      settlementAmountMinor: allocation.settlementAmountMinor === undefined ? undefined : parseRequiredAmountMinor(allocation, 'settlementAmountMinor'),
      applyEarlyPaymentDiscount: parseOptionalBoolean(allocation, 'applyEarlyPaymentDiscount'),
    };
  });
  return {
    allocations,
    paymentMethodId: parseRequiredString(data, 'paymentMethodId'),
    operationDate: parseRequiredIsoDate(data, 'operationDate'),
    paymentReference: parseOptionalNullableString(data, 'paymentReference'),
    notes: parseOptionalNullableString(data, 'notes'),
    idempotencyKey: parseOptionalString(data, 'idempotencyKey'),
    ...(typeof data.expectedCommissionPctBps === 'number' ? { expectedCommissionPctBps: data.expectedCommissionPctBps } : {}),
  };
}
export async function previewMemberFeePaymentUseCase(params: {
  actor: Actor | null;
  input: { memberId: string; periods: string[]; operationDate: Date; applyEarlyPaymentDiscount?: boolean | undefined; paymentMethodId?: string | undefined };
  transactions: AccountingTransactionManager;
}) {
  ensureStaff(params.actor);
  assertCondition(params.input.periods.length > 0 && params.input.periods.length <= 100, 'invalid-argument', 'Selecciona entre 1 y 100 meses.');
  const dataAccess = params.transactions.getDataAccess();
  const config = await dataAccess.financialConfigs.getActive();
  assertCondition(config, 'failed-precondition', 'No existe configuracion financiera activa.');
  const member = await dataAccess.members.getById(params.input.memberId);
  assertCondition(member, 'not-found', 'No encontramos al socio seleccionado.');
  const lines = [];
  for (const period of [...new Set(params.input.periods)].sort()) {
    assertCondition(/^\d{4}-(0[1-9]|1[0-2])$/.test(period), 'invalid-argument', 'Periodo invalido.');
    const chargesById = new Map<string, EntityWithId<MemberFeeChargeDocument>>();
    for (const filter of [{ memberId: params.input.memberId }, ...(member.familyGroupId ? [{ familyGroupId: member.familyGroupId }] : [])]) {
      let cursorId: string | undefined;
      do {
        const page = await dataAccess.memberFeeCharges.listPage({ ...filter, period: period as AccountingPeriod, limit: 100, ...(cursorId ? { cursorId } : {}) });
        for (const charge of page.items) {
          if (charge.status !== 'cancelled' && (charge.memberId === params.input.memberId || (charge.billingMode === 'single_group_charge' && charge.familyGroupId === member.familyGroupId))) chargesById.set(charge.id, charge);
        }
        cursorId = page.nextCursorId;
      } while (cursorId);
    }
    const generatedPreview = chargesById.size ? null : await computeFeePreviewInternal({ dataAccess, memberId: params.input.memberId, period });
    const charges = chargesById.size ? [...chargesById.values()] : [null];
    for (const charge of charges) {
    const settlement = resolveChargeSettlement({
      charge: charge ?? { finalAmountMinor: generatedPreview!.finalAmountMinor, period: period as AccountingPeriod },
      config,
      operationDate: params.input.operationDate,
      applyEarlyPaymentDiscount: params.input.applyEarlyPaymentDiscount,
    });
    const paid = charge ? resolveStoredPaidAmount(charge, settlement.settlementAmountMinor) : 0;
    const activePartialPlanId = charge ? await getActivePartialPlanIdForCharge(dataAccess, charge) : null;
    const closed = charge?.status === 'paid' || charge?.status === 'exempt';
    lines.push({
      period,
      chargeId: charge?.id ?? null,
      status: charge?.status ?? 'unissued',
      activePartialPlanId,
      baseAmountMinor: charge?.finalAmountMinor ?? generatedPreview!.finalAmountMinor,
      settlementAmountMinor: settlement.settlementAmountMinor,
      discountPctBps: settlement.discountPctBps,
      discountAmountMinor: settlement.discountAmountMinor,
      discountMode: settlement.discountMode,
      paidAmountMinor: paid,
      payableAmountMinor: closed ? 0 : Math.max(settlement.settlementAmountMinor - paid, 0),
    });
  }
  }
  const commissionRule = params.input.paymentMethodId ? await dataAccess.paymentCommissionRules.getActiveByPaymentMethodId(params.input.paymentMethodId) : null;
  return { lines, totalAmountMinor: lines.reduce((sum, line) => sum + line.payableAmountMinor, 0), ...(params.input.paymentMethodId ? { paymentMethodId: params.input.paymentMethodId, commissionPctBps: commissionRule?.percentageBps ?? 0 } : {}) };
}
