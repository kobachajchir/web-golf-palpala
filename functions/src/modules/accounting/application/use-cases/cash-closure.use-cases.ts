import { Timestamp } from 'firebase-admin/firestore';
import { PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, CashClosureDocument, EntityWithId, FinancialMovementDocument } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureStaff,
  parseOptionalAccountingPeriod,
  parseOptionalAmountMinor,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseOptionalStringArray,
  parseRequiredAccountingPeriod,
  parseRequiredAmountMinor,
  parseRequiredIsoDate,
  parseRequiredString,
} from '../shared.js';
import { assertCashClosureCanOpen } from '../cash-closure-guards.js';

export interface CreateCashClosureInput {
  period: string;
  closureDate: Date;
  openingBalanceMinor?: number | undefined;
  movementIds?: string[] | undefined;
  notes?: string | null | undefined;
}

export interface CloseCashClosureInput {
  cashClosureId: string;
  cashCountedMinor: number;
  notes?: string | null | undefined;
}

function toClubDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function signedMovementAmount(movement: EntityWithId<FinancialMovementDocument>): number {
  return movement.movementType === 'income' ? movement.netAmountMinor : -movement.netAmountMinor;
}

async function resolveClosureMovements(params: {
  transactions: AccountingTransactionManager;
  period: string;
  closureDate: Date;
  movementIds?: string[];
}): Promise<Array<EntityWithId<FinancialMovementDocument>>> {
  const dataAccess = params.transactions.getDataAccess();
  if (params.movementIds?.length) {
    const movements = await Promise.all(params.movementIds.map((movementId) => dataAccess.financialMovements.getById(movementId)));
    assertCondition(movements.every(Boolean), 'not-found', 'Uno o más financial_movements no existen.');
    return movements.filter((movement): movement is EntityWithId<FinancialMovementDocument> => movement !== null);
  }

  const page = await dataAccess.financialMovements.listPage({
    accountingPeriod: params.period,
    status: 'posted',
    limit: 100,
  });
  const closureDay = toClubDayKey(params.closureDate);
  return page.items.filter((movement) => toClubDayKey(movement.operationDate.toDate()) === closureDay);
}

export async function createCashClosureUseCase(params: {
  actor: Actor | null;
  input: CreateCashClosureInput;
  transactions: AccountingTransactionManager;
}): Promise<{ cashClosureId: string; cashExpectedMinor: number; expectedByPaymentMethod: Record<string, number>; movementCount: number }> {
  const actor = ensureStaff(params.actor);
  const movements = await resolveClosureMovements({
    transactions: params.transactions,
    period: params.input.period,
    closureDate: params.input.closureDate,
    ...(params.input.movementIds ? { movementIds: params.input.movementIds } : {}),
  });

  const openingBalanceMinor = params.input.openingBalanceMinor ?? 0;
  const expectedByPaymentMethod = movements.reduce<Record<string, number>>((grouped, movement) => {
    const key = movement.paymentMethodCodeSnapshot ?? 'sin_medio';
    grouped[key] = (grouped[key] ?? 0) + signedMovementAmount(movement);
    return grouped;
  }, {});
  expectedByPaymentMethod[PAYMENT_METHOD_IDS.cash] = (expectedByPaymentMethod[PAYMENT_METHOD_IDS.cash] ?? 0) + openingBalanceMinor;
  const cashExpectedMinor = expectedByPaymentMethod[PAYMENT_METHOD_IDS.cash] ?? 0;

  return params.transactions.runInTransaction(async (dataAccess) => {
    await assertCashClosureCanOpen({
      dataAccess,
      closureDate: params.input.closureDate,
    });

    const cashClosureId = await dataAccess.cashClosures.create(
      {
        period: params.input.period,
        closureDate: Timestamp.fromDate(params.input.closureDate),
        openedByUid: actor.uid,
        closedByUid: null,
        closedAt: null,
        openingBalanceMinor,
        expectedByPaymentMethod,
        cashExpectedMinor,
        cashCountedMinor: null,
        differenceMinor: null,
        movementIds: movements.map((movement) => movement.id),
        status: 'open',
        notes: params.input.notes ?? null,
      },
      actor.uid,
    );

    return {
      cashClosureId,
      cashExpectedMinor,
      expectedByPaymentMethod,
      movementCount: movements.length,
    };
  });
}

export async function closeCashClosureUseCase(params: {
  actor: Actor | null;
  input: CloseCashClosureInput;
  transactions: AccountingTransactionManager;
}): Promise<{ cashClosureId: string; status: CashClosureDocument['status']; differenceMinor: number }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const cashClosure = await dataAccess.cashClosures.getById(params.input.cashClosureId);
    assertCondition(cashClosure, 'not-found', `No existe cash_closures/${params.input.cashClosureId}.`);
    assertCondition(cashClosure.status === 'open', 'failed-precondition', 'Solo se pueden cerrar cajas abiertas.');
    const differenceMinor = params.input.cashCountedMinor - cashClosure.cashExpectedMinor;

    await dataAccess.cashClosures.update(
      cashClosure.id,
      {
        status: 'closed',
        closedByUid: actor.uid,
        closedAt: Timestamp.fromDate(new Date()),
        cashCountedMinor: params.input.cashCountedMinor,
        differenceMinor,
        notes: params.input.notes ?? cashClosure.notes ?? null,
      },
      actor.uid,
    );

    return {
      cashClosureId: cashClosure.id,
      status: 'closed',
      differenceMinor,
    };
  });
}

export function parseCreateCashClosureInput(payload: unknown): CreateCashClosureInput {
  const data = assertIsRecord(payload);
  return {
    period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
    closureDate: parseOptionalIsoDate(data, 'closureDate') ?? parseRequiredIsoDate(data, 'closureDate'),
    openingBalanceMinor: parseOptionalAmountMinor(data, 'openingBalanceMinor'),
    movementIds: parseOptionalStringArray(data, 'movementIds'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseCloseCashClosureInput(payload: unknown): CloseCashClosureInput {
  const data = assertIsRecord(payload);
  return {
    cashClosureId: parseRequiredString(data, 'cashClosureId'),
    cashCountedMinor: parseOptionalAmountMinor(data, 'cashCountedMinor') ?? parseRequiredAmountMinor(data, 'cashCountedMinor'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}
