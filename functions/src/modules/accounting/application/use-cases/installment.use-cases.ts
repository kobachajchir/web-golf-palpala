import { Timestamp } from 'firebase-admin/firestore';
import { ACCOUNTING_COLLECTIONS, PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, FinancialMovementType, ThirdPartyType } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  calculateAmountFromBps,
  ensureAuthenticatedActor,
  ensureStaff,
  parseOptionalNullableString,
  parseOptionalRecord,
  parseRequiredAmountMinor,
  parseRequiredBps,
  parseRequiredInteger,
  parseRequiredIsoDate,
  parseRequiredString,
  toClubAccountingPeriod,
} from '../shared.js';
import { assertCashOperationDateAllowed } from '../cash-closure-guards.js';
import { createPostedMovement } from '../movement-helpers.js';

export interface CreateInstallmentPlanInput {
  movementType: FinancialMovementType;
  categoryId: string;
  baseAmountMinor: number;
  installmentCount?: number | undefined;
  interestPctBps: number;
  operationDate: Date;
  thirdPartyType?: ThirdPartyType | null;
  thirdPartyId?: string | null;
  paymentReference?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RegisterInstallmentPaymentInput {
  installmentPlanId: string;
  paymentMethodId: string;
  operationDate: Date;
  amountMinor?: number | undefined;
  paymentReference?: string | null;
  notes?: string | null;
}

function splitAmount(amountMinor: number, count: number): number[] {
  const base = Math.floor(amountMinor / count);
  const remainder = amountMinor - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function addMonthsToPeriod(operationDate: Date, monthOffset: number): string {
  const date = new Date(Date.UTC(
    operationDate.getUTCFullYear(),
    operationDate.getUTCMonth() + monthOffset,
    1,
  ));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function readNumberArray(value: unknown): number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? value
    : [];
}

function buildReceiptNumber(operationDate: Date, movementId: string): string {
  const year = operationDate.getUTCFullYear();
  const month = String(operationDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(operationDate.getUTCDate()).padStart(2, '0');
  return `REC-${year}${month}${day}-${movementId.slice(0, 8).toUpperCase()}`;
}

export async function createInstallmentPlanUseCase(params: {
  actor: Actor | null;
  input: CreateInstallmentPlanInput;
  transactions: AccountingTransactionManager;
}) {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    await assertCashOperationDateAllowed({ dataAccess, operationDate: params.input.operationDate });
    assertCondition(params.input.baseAmountMinor > 0, 'invalid-argument', 'El importe debe ser mayor a cero.');
    const isFlexiblePartialPlan = params.input.installmentCount === undefined;
    if (!isFlexiblePartialPlan) {
      assertCondition(
        params.input.installmentCount! >= 2 && params.input.installmentCount! <= 120,
        'invalid-argument',
        'La cantidad de cuotas debe estar entre 2 y 120.',
      );
    }
    assertCondition(
      params.input.interestPctBps >= 0 && params.input.interestPctBps <= 10000,
      'invalid-argument',
      'El interes debe estar entre 0 y 100%.',
    );

    const incomeCategory = params.input.movementType === 'income'
      ? await dataAccess.financialIncomeCategories.getById(params.input.categoryId)
      : null;
    const expenseCategory = params.input.movementType === 'expense'
      ? await dataAccess.financialExpenseCategories.getById(params.input.categoryId)
      : null;
    const category = incomeCategory ?? expenseCategory;
    assertCondition(category, 'not-found', `No existe la categoria ${params.input.categoryId}.`);
    assertCondition(category.active, 'failed-precondition', `La categoria ${params.input.categoryId} esta inactiva.`);

    const interestAmountMinor = calculateAmountFromBps(params.input.baseAmountMinor, params.input.interestPctBps);
    const totalAmountMinor = params.input.baseAmountMinor + interestAmountMinor;
    const principalAmountsMinor = isFlexiblePartialPlan
      ? [params.input.baseAmountMinor]
      : splitAmount(params.input.baseAmountMinor, params.input.installmentCount!);
    const monthlyInterestAmountsMinor = isFlexiblePartialPlan
      ? [interestAmountMinor]
      : splitAmount(interestAmountMinor, params.input.installmentCount!);
    const installmentAmountsMinor = principalAmountsMinor.map(
      (principalAmountMinor, index) => principalAmountMinor + (monthlyInterestAmountsMinor[index] ?? 0),
    );
    const schedule = (isFlexiblePartialPlan ? [] : installmentAmountsMinor).map((amountMinor, index) => ({
      installmentNumber: index + 1,
      period: addMonthsToPeriod(params.input.operationDate, index),
      principalAmountMinor: principalAmountsMinor[index],
      interestAmountMinor: monthlyInterestAmountsMinor[index],
      amountMinor,
    }));
    const operationTimestamp = Timestamp.fromDate(params.input.operationDate);
    const movementId = await dataAccess.financialMovements.create(
      {
        movementType: params.input.movementType,
        categoryId: category.id,
        categoryCodeSnapshot: category.id,
        status: 'pending',
        operationDate: operationTimestamp,
        postingDate: null,
        accountingPeriod: toClubAccountingPeriod(params.input.operationDate),
        originType: isFlexiblePartialPlan ? 'partial_payment_plan' : 'installment_charge',
        originCollection: null,
        originId: null,
        thirdPartyType: params.input.thirdPartyType ?? null,
        thirdPartyId: params.input.thirdPartyId ?? null,
        paymentMethodId: null,
        paymentMethodCodeSnapshot: null,
        grossAmountMinor: totalAmountMinor,
        appliedCommissionPctBps: null,
        appliedCommissionAmountMinor: null,
        netAmountMinor: totalAmountMinor,
        installmentPlanId: null,
        installmentRole: 'charge',
        installmentNumber: 0,
        installmentCount: params.input.installmentCount ?? null,
        installmentBaseAmountMinor: params.input.baseAmountMinor,
        installmentInterestPctBps: params.input.interestPctBps,
        installmentInterestAmountMinor: interestAmountMinor,
        installmentTotalAmountMinor: totalAmountMinor,
        installmentScheduledAmountMinor: null,
        installmentPaidAmountMinor: 0,
        installmentPaidCount: 0,
        bancarizado: false,
        imputableImpositivo: params.input.movementType === 'income'
          ? true
          : expenseCategory?.defaultImputableImpositivo ?? false,
        settlementId: null,
        registeredByUid: actor.uid,
        approvedByUid: actor.uid,
        approvedAt: operationTimestamp,
        reversalOfMovementId: null,
        voidReason: null,
        excludeFromBalance: true,
        balanceExclusionReason: isFlexiblePartialPlan
          ? 'Plan de pagos parciales: el balance se actualiza con cada pago efectivo.'
          : 'Carga en cuotas: el balance se actualiza con cada pago efectivo.',
        metadata: {
          ...(params.input.metadata ?? {}),
          partialPaymentMode: isFlexiblePartialPlan ? 'flexible' : 'scheduled',
          installmentSchedule: schedule,
          principalAmountsMinor,
          monthlyInterestAmountsMinor,
          installmentAmountsMinor,
          paymentReference: params.input.paymentReference ?? null,
        },
        notes: params.input.notes ?? null,
      },
      actor.uid,
    );

    await dataAccess.financialMovements.update(
      movementId,
      {
        installmentPlanId: movementId,
        originId: movementId,
        metadata: {
          ...(params.input.metadata ?? {}),
          installmentPlanId: movementId,
          partialPaymentMode: isFlexiblePartialPlan ? 'flexible' : 'scheduled',
          installmentSchedule: schedule,
          principalAmountsMinor,
          monthlyInterestAmountsMinor,
          installmentAmountsMinor,
          paymentReference: params.input.paymentReference ?? null,
        },
      },
      actor.uid,
    );

    return {
      movementId,
      installmentPlanId: movementId,
      installmentCount: params.input.installmentCount ?? null,
      interestAmountMinor,
      totalAmountMinor,
      monthlyInterestAmountsMinor,
      installmentAmountsMinor,
    };
  });
}

export async function registerInstallmentPaymentUseCase(params: {
  actor: Actor | null;
  input: RegisterInstallmentPaymentInput;
  transactions: AccountingTransactionManager;
}) {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    await assertCashOperationDateAllowed({ dataAccess, operationDate: params.input.operationDate });
    const root = await dataAccess.financialMovements.getById(params.input.installmentPlanId);
    assertCondition(root, 'not-found', `No existe la carga ${params.input.installmentPlanId}.`);
    assertCondition(root.installmentRole === 'charge', 'failed-precondition', 'El movimiento no es una carga en cuotas.');
    assertCondition(root.status !== 'voided' && root.status !== 'reversed', 'failed-precondition', 'La carga esta anulada.');

    const linkedMovements = await dataAccess.financialMovements.listByInstallmentPlanId(root.id);
    const postedPayments = linkedMovements
      .filter((movement) => movement.installmentRole === 'payment' && movement.status === 'posted')
      .sort((left, right) => (left.installmentNumber ?? 0) - (right.installmentNumber ?? 0));
    const installmentCount = root.installmentCount ?? 0;
    const isFlexiblePartialPlan = root.metadata?.partialPaymentMode === 'flexible' || installmentCount === 0;
    const nextInstallmentNumber = postedPayments.length + 1;
    if (!isFlexiblePartialPlan) {
      assertCondition(nextInstallmentNumber <= installmentCount, 'failed-precondition', 'Todas las cuotas ya estan pagadas.');
    }

    const installmentAmountsMinor = readNumberArray(root.metadata?.installmentAmountsMinor);
    const monthlyInterestAmountsMinor = readNumberArray(root.metadata?.monthlyInterestAmountsMinor);
    const totalAmountMinor = root.installmentTotalAmountMinor ?? root.netAmountMinor;
    const currentPaidAmountMinor = root.installmentPaidAmountMinor ?? 0;
    const remainingBeforePaymentMinor = Math.max(totalAmountMinor - currentPaidAmountMinor, 0);
    const scheduledAmountMinor = isFlexiblePartialPlan
      ? params.input.amountMinor
      : installmentAmountsMinor[nextInstallmentNumber - 1];
    assertCondition(
      typeof scheduledAmountMinor === 'number' && scheduledAmountMinor > 0,
      'invalid-argument',
      isFlexiblePartialPlan ? 'Indica el importe del pago parcial.' : 'La carga no tiene un cronograma de cuotas valido.',
    );
    assertCondition(scheduledAmountMinor <= remainingBeforePaymentMinor, 'invalid-argument', 'El pago supera el saldo pendiente.');

    const paymentMethod = await dataAccess.paymentMethods.getById(params.input.paymentMethodId);
    assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.input.paymentMethodId}.`);
    assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.input.paymentMethodId} esta inactivo.`);
    const paymentReference = params.input.paymentReference?.trim() || null;
    assertCondition(
      paymentMethod.id === PAYMENT_METHOD_IDS.cash || Boolean(paymentReference),
      'invalid-argument',
      'La referencia es obligatoria para medios distintos de efectivo.',
    );

    const movement = await createPostedMovement({
      dataAccess,
      actorUid: actor.uid,
      movementType: root.movementType,
      categoryId: root.categoryId,
      categoryCodeSnapshot: root.categoryCodeSnapshot,
      grossAmountMinor: scheduledAmountMinor,
      operationDate: params.input.operationDate,
      originType: isFlexiblePartialPlan ? 'partial_payment' : 'installment_payment',
      originCollection: ACCOUNTING_COLLECTIONS.financialMovements,
      originId: root.id,
      thirdPartyType: root.thirdPartyType ?? null,
      thirdPartyId: root.thirdPartyId ?? null,
      paymentMethodId: paymentMethod.id,
      bancarizado: paymentMethod.bancarizado,
      imputableImpositivo: root.imputableImpositivo,
      metadata: {
        ...(root.metadata ?? {}),
        installmentPlanId: root.id,
        installmentNumber: nextInstallmentNumber,
        installmentCount: isFlexiblePartialPlan ? null : installmentCount,
        partialPaymentMode: isFlexiblePartialPlan ? 'flexible' : 'scheduled',
        scheduledAmountMinor,
        monthlyInterestAmountMinor: monthlyInterestAmountsMinor[nextInstallmentNumber - 1] ?? 0,
        paymentReference,
      },
      notes: params.input.notes ?? root.notes ?? null,
      applyPaymentCommission: true,
      paymentCommissionMode: root.movementType === 'income' ? 'add_to_charge' : 'add_to_expense',
    });

    const receiptNumber = root.movementType === 'income'
      ? buildReceiptNumber(params.input.operationDate, movement.movementId)
      : null;
    const paidAmountMinor = currentPaidAmountMinor + scheduledAmountMinor;
    const paidCount = postedPayments.length + 1;
    const completed = paidAmountMinor >= totalAmountMinor;

    await dataAccess.financialMovements.update(
      movement.movementId,
      {
        installmentPlanId: root.id,
        installmentRole: 'payment',
        installmentNumber: nextInstallmentNumber,
        installmentCount: isFlexiblePartialPlan ? null : installmentCount,
        installmentBaseAmountMinor: root.installmentBaseAmountMinor ?? null,
        installmentInterestPctBps: root.installmentInterestPctBps ?? 0,
        installmentInterestAmountMinor: root.installmentInterestAmountMinor ?? 0,
        installmentTotalAmountMinor: root.installmentTotalAmountMinor ?? root.netAmountMinor,
        installmentScheduledAmountMinor: scheduledAmountMinor,
        installmentPaidAmountMinor: paidAmountMinor,
        installmentPaidCount: paidCount,
        metadata: {
          ...(root.metadata ?? {}),
          installmentPlanId: root.id,
          installmentNumber: nextInstallmentNumber,
          installmentCount: isFlexiblePartialPlan ? null : installmentCount,
          partialPaymentMode: isFlexiblePartialPlan ? 'flexible' : 'scheduled',
          scheduledAmountMinor,
          monthlyInterestAmountMinor: monthlyInterestAmountsMinor[nextInstallmentNumber - 1] ?? 0,
          paymentReference,
          receiptNumber,
          receiptIssuedAt: receiptNumber ? Timestamp.fromDate(params.input.operationDate) : null,
          receiptSource: receiptNumber ? 'installment_payment' : null,
          appliedCommissionPctBps: movement.appliedCommissionPctBps,
          appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
          clubAmountMinor: root.movementType === 'income' ? movement.netAmountMinor : null,
          amountToChargeMinor: root.movementType === 'income' ? movement.grossAmountMinor : null,
          expenseBaseAmountMinor: root.movementType === 'expense' ? movement.grossAmountMinor : null,
          expenseTotalDebitedMinor: root.movementType === 'expense' ? movement.netAmountMinor : null,
        },
      },
      actor.uid,
    );
    await dataAccess.financialMovements.update(
      root.id,
      {
        status: completed ? 'posted' : 'pending',
        installmentPaidAmountMinor: paidAmountMinor,
        installmentPaidCount: paidCount,
      },
      actor.uid,
    );

    return {
      movementId: movement.movementId,
      installmentPlanId: root.id,
      installmentNumber: nextInstallmentNumber,
      installmentCount: isFlexiblePartialPlan ? null : installmentCount,
      scheduledAmountMinor,
      grossAmountMinor: movement.grossAmountMinor,
      netAmountMinor: movement.netAmountMinor,
      paidAmountMinor,
      totalAmountMinor: root.installmentTotalAmountMinor ?? root.netAmountMinor,
      completed,
      receiptNumber,
    };
  });
}

export async function listMyReceiptsUseCase(params: {
  actor: Actor | null;
  transactions: AccountingTransactionManager;
}) {
  const actor = ensureAuthenticatedActor(params.actor);
  assertCondition(actor.user.active, 'permission-denied', 'El usuario no esta activo.');

  if (actor.user.profileType !== 'member' || !actor.user.profileId) {
    return { receipts: [] };
  }

  const page = await params.transactions.getDataAccess().financialMovements.listPage({
    thirdPartyType: 'member',
    thirdPartyId: actor.user.profileId,
    limit: 100,
  });
  const receipts = page.items
    .filter((movement) => movement.movementType === 'income')
    .map((movement) => {
      const receiptNumber = typeof movement.metadata?.receiptNumber === 'string'
        ? movement.metadata.receiptNumber.trim()
        : '';
      if (!receiptNumber) {
        return null;
      }
      const description = typeof movement.metadata?.description === 'string'
        ? movement.metadata.description.trim()
        : '';
      const tournamentName = typeof movement.metadata?.tournamentName === 'string'
        ? movement.metadata.tournamentName.trim()
        : '';
      const paymentReference = typeof movement.metadata?.paymentReference === 'string'
        ? movement.metadata.paymentReference.trim()
        : null;

      return {
        id: movement.id,
        receiptNumber,
        movementId: movement.id,
        categoryId: movement.categoryId,
        concept: description || tournamentName || movement.categoryCodeSnapshot,
        operationDate: movement.operationDate.toDate().toISOString(),
        accountingPeriod: movement.accountingPeriod,
        paymentMethodId: movement.paymentMethodId ?? null,
        grossAmountMinor: movement.grossAmountMinor,
        netAmountMinor: movement.netAmountMinor,
        appliedCommissionPctBps: movement.appliedCommissionPctBps ?? null,
        appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor ?? null,
        paymentReference,
        notes: movement.notes ?? null,
        status: movement.status,
      };
    })
    .filter((receipt): receipt is NonNullable<typeof receipt> => receipt !== null);

  return { receipts };
}

export function parseCreateInstallmentPlanInput(payload: unknown): CreateInstallmentPlanInput {
  const data = assertIsRecord(payload);
  const movementType = parseRequiredString(data, 'movementType');
  assertCondition(movementType === 'income' || movementType === 'expense', 'invalid-argument', 'movementType invalido.');
  const thirdPartyType = parseOptionalNullableString(data, 'thirdPartyType');
  const thirdPartyId = parseOptionalNullableString(data, 'thirdPartyId');
  const paymentReference = parseOptionalNullableString(data, 'paymentReference');
  const notes = parseOptionalNullableString(data, 'notes');
  const metadata = parseOptionalRecord(data, 'metadata');
  return {
    movementType,
    categoryId: parseRequiredString(data, 'categoryId'),
    baseAmountMinor: parseRequiredAmountMinor(data, 'baseAmountMinor'),
    installmentCount: data.installmentCount === undefined ? undefined : parseRequiredInteger(data, 'installmentCount'),
    interestPctBps: parseRequiredBps(data, 'interestPctBps'),
    operationDate: parseRequiredIsoDate(data, 'operationDate'),
    ...(thirdPartyType !== undefined ? { thirdPartyType: thirdPartyType as ThirdPartyType | null } : {}),
    ...(thirdPartyId !== undefined ? { thirdPartyId } : {}),
    ...(paymentReference !== undefined ? { paymentReference } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

export function parseRegisterInstallmentPaymentInput(payload: unknown): RegisterInstallmentPaymentInput {
  const data = assertIsRecord(payload);
  const paymentReference = parseOptionalNullableString(data, 'paymentReference');
  const notes = parseOptionalNullableString(data, 'notes');
  return {
    installmentPlanId: parseRequiredString(data, 'installmentPlanId'),
    paymentMethodId: parseRequiredString(data, 'paymentMethodId'),
    operationDate: parseRequiredIsoDate(data, 'operationDate'),
    amountMinor: data.amountMinor === undefined ? undefined : parseRequiredAmountMinor(data, 'amountMinor'),
    ...(paymentReference !== undefined ? { paymentReference } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}
