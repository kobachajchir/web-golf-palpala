import { Timestamp } from 'firebase-admin/firestore';
import { PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { Actor } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureDirectivo,
  parseOptionalAccountingPeriod,
  parseOptionalAmountMinor,
  parseOptionalBoolean,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseRequiredAccountingPeriod,
  parseRequiredIsoDate,
  parseRequiredString,
  parseRequiredStringArray,
} from '../shared.js';

export interface CreateMacroDebitSettlementInput {
  month: string;
  externalBatchRef: string;
  movementIds: string[];
  accreditedAt: Date;
  bankName?: string | undefined;
  commissionAmountMinor?: number | undefined;
  statementFileUrl?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface ReconcileMacroSettlementInput {
  settlementId: string;
  expectedGrossAmountMinor?: number | undefined;
  expectedCommissionAmountMinor?: number | undefined;
  expectedNetAmountMinor?: number | undefined;
  close?: boolean | undefined;
}

export async function createMacroDebitSettlementUseCase(params: {
  actor: Actor | null;
  input: CreateMacroDebitSettlementInput;
  transactions: AccountingTransactionManager;
}): Promise<{ settlementId: string; duplicate: boolean }> {
  const actor = ensureDirectivo(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const existingSettlement = await dataAccess.macroDebitSettlements.getByExternalBatchRef(params.input.externalBatchRef);
    if (existingSettlement) {
      return { settlementId: existingSettlement.id, duplicate: true };
    }

    const movements = await Promise.all(params.input.movementIds.map((movementId) => dataAccess.financialMovements.getById(movementId)));
    const resolvedMovements = movements.filter((movement): movement is NonNullable<typeof movement> => movement !== null);
    assertCondition(resolvedMovements.length === params.input.movementIds.length, 'not-found', 'Uno o más financial_movements no existen.');
    resolvedMovements.forEach((movement) => {
      assertCondition(movement.paymentMethodCodeSnapshot === PAYMENT_METHOD_IDS.debitMacro, 'failed-precondition', `El movimiento ${movement.id} no es debit_macro.`);
      assertCondition(movement.status === 'posted', 'failed-precondition', `El movimiento ${movement.id} debe estar posted.`);
      assertCondition(!movement.settlementId, 'failed-precondition', `El movimiento ${movement.id} ya pertenece a otra liquidación.`);
    });

    const grossAmountMinor = resolvedMovements.reduce((total, movement) => total + movement.grossAmountMinor, 0);
    const commissionAmountMinor = params.input.commissionAmountMinor
      ?? resolvedMovements.reduce((total, movement) => total + (movement.appliedCommissionAmountMinor ?? 0), 0);
    const netAmountMinor = grossAmountMinor - commissionAmountMinor;

    const settlementId = await dataAccess.macroDebitSettlements.create(
      {
        month: params.input.month,
        bankName: params.input.bankName ?? 'Banco Macro',
        externalBatchRef: params.input.externalBatchRef,
        grossAmountMinor,
        commissionAmountMinor,
        netAmountMinor,
        movementCount: resolvedMovements.length,
        status: 'imported',
        statementFileUrl: params.input.statementFileUrl ?? null,
        accreditedAt: Timestamp.fromDate(params.input.accreditedAt),
        importedByUid: actor.uid,
        notes: params.input.notes ?? null,
      },
      actor.uid,
    );

    for (const movement of resolvedMovements) {
      await dataAccess.financialMovements.update(
        movement.id,
        { settlementId },
        actor.uid,
      );
    }

    return { settlementId, duplicate: false };
  });
}

export async function reconcileMacroSettlementUseCase(params: {
  actor: Actor | null;
  input: ReconcileMacroSettlementInput;
  transactions: AccountingTransactionManager;
}): Promise<{ settlementId: string; status: 'reconciled' | 'closed'; movementCount: number }> {
  const actor = ensureDirectivo(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const settlement = await dataAccess.macroDebitSettlements.getById(params.input.settlementId);
    assertCondition(settlement, 'not-found', `No existe macro_debit_settlements/${params.input.settlementId}.`);

    const movements = await dataAccess.financialMovements.listBySettlementId(settlement.id);
    const grossAmountMinor = movements.reduce((total, movement) => total + movement.grossAmountMinor, 0);
    const commissionAmountMinor = settlement.commissionAmountMinor;
    const netAmountMinor = grossAmountMinor - commissionAmountMinor;

    if (params.input.expectedGrossAmountMinor !== undefined) {
      assertCondition(grossAmountMinor === params.input.expectedGrossAmountMinor, 'failed-precondition', 'El total bruto no coincide con el esperado.');
    }
    if (params.input.expectedCommissionAmountMinor !== undefined) {
      assertCondition(commissionAmountMinor === params.input.expectedCommissionAmountMinor, 'failed-precondition', 'La comisión total no coincide con la esperada.');
    }
    if (params.input.expectedNetAmountMinor !== undefined) {
      assertCondition(netAmountMinor === params.input.expectedNetAmountMinor, 'failed-precondition', 'El total neto no coincide con el esperado.');
    }

    const status = params.input.close ? 'closed' : 'reconciled';
    await dataAccess.macroDebitSettlements.update(
      settlement.id,
      {
        grossAmountMinor,
        commissionAmountMinor,
        netAmountMinor,
        movementCount: movements.length,
        status,
      },
      actor.uid,
    );

    return {
      settlementId: settlement.id,
      status,
      movementCount: movements.length,
    };
  });
}

export function parseCreateMacroDebitSettlementInput(payload: unknown): CreateMacroDebitSettlementInput {
  const data = assertIsRecord(payload);

  return {
    month: parseOptionalAccountingPeriod(data, 'month') ?? parseRequiredAccountingPeriod(data, 'month'),
    externalBatchRef: parseRequiredString(data, 'externalBatchRef'),
    movementIds: parseRequiredStringArray(data, 'movementIds'),
    accreditedAt: parseOptionalIsoDate(data, 'accreditedAt') ?? parseRequiredIsoDate(data, 'accreditedAt'),
    bankName: parseOptionalNullableString(data, 'bankName') ?? undefined,
    commissionAmountMinor: parseOptionalAmountMinor(data, 'commissionAmountMinor'),
    statementFileUrl: parseOptionalNullableString(data, 'statementFileUrl'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseReconcileMacroSettlementInput(payload: unknown): ReconcileMacroSettlementInput {
  const data = assertIsRecord(payload);

  return {
    settlementId: parseRequiredString(data, 'settlementId'),
    expectedGrossAmountMinor: parseOptionalAmountMinor(data, 'expectedGrossAmountMinor'),
    expectedCommissionAmountMinor: parseOptionalAmountMinor(data, 'expectedCommissionAmountMinor'),
    expectedNetAmountMinor: parseOptionalAmountMinor(data, 'expectedNetAmountMinor'),
    close: parseOptionalBoolean(data, 'close'),
  };
}
