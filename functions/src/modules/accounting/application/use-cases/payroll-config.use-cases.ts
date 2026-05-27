import { Timestamp } from 'firebase-admin/firestore';
import { assertCondition } from '../../domain/errors.js';
import type { Actor } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureDirectivo,
  parseOptionalFiniteNumber,
  parseOptionalIsoDate,
  parseRequiredFiniteNumber,
} from '../shared.js';

export interface UpsertPayrollConfigInput {
  paymentDay: number;
  prepareReceiptsDaysBefore?: number | null | undefined;
  effectiveFrom?: Date | undefined;
}

function assertIntegerRange(value: number, field: string, min: number, max: number): void {
  assertCondition(Number.isInteger(value) && value >= min && value <= max, 'invalid-argument', `${field} debe estar entre ${min} y ${max}.`);
}

export async function upsertPayrollConfigUseCase(params: {
  actor: Actor | null;
  input: UpsertPayrollConfigInput;
  transactions: AccountingTransactionManager;
}): Promise<{ payrollConfigId: 'current'; paymentDay: number; prepareReceiptsDaysBefore: number | null }> {
  const actor = ensureDirectivo(params.actor);
  assertIntegerRange(params.input.paymentDay, 'paymentDay', 1, 28);

  if (params.input.prepareReceiptsDaysBefore !== undefined && params.input.prepareReceiptsDaysBefore !== null) {
    assertIntegerRange(params.input.prepareReceiptsDaysBefore, 'prepareReceiptsDaysBefore', 0, 15);
  }

  return params.transactions.runInTransaction(async (dataAccess) => {
    await dataAccess.payrollConfigs.setCurrent(
      {
        paymentDay: params.input.paymentDay,
        prepareReceiptsDaysBefore: params.input.prepareReceiptsDaysBefore ?? null,
        isActive: true,
        effectiveFrom: Timestamp.fromDate(params.input.effectiveFrom ?? new Date()),
      },
      actor.uid,
    );

    return {
      payrollConfigId: 'current',
      paymentDay: params.input.paymentDay,
      prepareReceiptsDaysBefore: params.input.prepareReceiptsDaysBefore ?? null,
    };
  });
}

export function parseUpsertPayrollConfigInput(payload: unknown): UpsertPayrollConfigInput {
  const data = assertIsRecord(payload);

  return {
    paymentDay: parseRequiredFiniteNumber(data, 'paymentDay'),
    prepareReceiptsDaysBefore: parseOptionalFiniteNumber(data, 'prepareReceiptsDaysBefore') ?? null,
    effectiveFrom: parseOptionalIsoDate(data, 'effectiveFrom'),
  };
}
