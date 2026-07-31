import { Timestamp } from 'firebase-admin/firestore';
import { assertCondition } from '../domain/errors.js';
import type {
  FinancialMovementDocument,
  FinancialMovementType,
  ThirdPartyType,
} from '../domain/models.js';
import type { AccountingDataAccess } from '../domain/ports.js';
import { calculateAmountFromBps, toAccountingPeriod } from './shared.js';

export interface CreatePostedMovementParams {
  dataAccess: AccountingDataAccess;
  actorUid: string;
  movementType: FinancialMovementType;
  categoryId: string;
  categoryCodeSnapshot: string;
  grossAmountMinor: number;
  operationDate: Date;
  originType: string;
  originCollection?: string | null;
  originId?: string | null;
  thirdPartyType?: ThirdPartyType | null;
  thirdPartyId?: string | null;
  paymentMethodId?: string | null;
  bancarizado: boolean;
  imputableImpositivo: boolean;
  metadata?: Record<string, unknown>;
  notes?: string | null;
  settlementId?: string | null;
  approvedByUid?: string | null;
  applyPaymentCommission?: boolean;
  paymentCommissionMode?: 'deduct_from_gross' | 'add_to_charge' | 'add_to_expense';
  approvedAt?: Date;
  netAmountMinorOverride?: number | null | undefined;
  appliedCommissionAmountMinorOverride?: number | null | undefined;
  appliedCommissionPctBpsOverride?: number | null | undefined;
}

export interface CreatedMovementResult {
  movementId: string;
  grossAmountMinor: number;
  netAmountMinor: number;
  appliedCommissionPctBps: number | null;
  appliedCommissionAmountMinor: number | null;
  paymentMethodCodeSnapshot: string | null;
}

export async function createPostedMovement(params: CreatePostedMovementParams): Promise<CreatedMovementResult> {
  const paymentMethod = params.paymentMethodId
    ? await params.dataAccess.paymentMethods.getById(params.paymentMethodId)
    : null;

  if (params.paymentMethodId) {
    assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.paymentMethodId}.`);
    assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.paymentMethodId} esta inactivo.`);
  }

  let appliedCommissionPctBps: number | null = null;
  let appliedCommissionAmountMinor: number | null = null;
  let grossAmountMinor = params.grossAmountMinor;
  let netAmountMinor = params.grossAmountMinor;
  let paymentCommissionBreakdown: unknown[] = [];

  if (params.applyPaymentCommission === true && paymentMethod) {
    const activeRule = await params.dataAccess.paymentCommissionRules.getActiveByPaymentMethodId(paymentMethod.id);
    if (activeRule) {
      appliedCommissionPctBps = activeRule.percentageBps;
      appliedCommissionAmountMinor = calculateAmountFromBps(params.grossAmountMinor, activeRule.percentageBps);
      paymentCommissionBreakdown = activeRule.breakdown ?? [];

      if (params.paymentCommissionMode === 'add_to_charge') {
        grossAmountMinor = params.grossAmountMinor + appliedCommissionAmountMinor;
        netAmountMinor = params.grossAmountMinor;
      } else if (params.paymentCommissionMode === 'add_to_expense') {
        netAmountMinor = params.grossAmountMinor + appliedCommissionAmountMinor;
      } else {
        netAmountMinor = params.grossAmountMinor - appliedCommissionAmountMinor;
      }
    }
  }

  if (params.netAmountMinorOverride !== undefined && params.netAmountMinorOverride !== null) {
    netAmountMinor = params.netAmountMinorOverride;
    appliedCommissionAmountMinor = params.appliedCommissionAmountMinorOverride
      ?? Math.max(grossAmountMinor - params.netAmountMinorOverride, 0);
    appliedCommissionPctBps = params.appliedCommissionPctBpsOverride ?? null;
  }

  const operationTimestamp = Timestamp.fromDate(params.operationDate);
  const approvedAtDate = params.approvedAt ?? params.operationDate;
  const movementId = await params.dataAccess.financialMovements.create(
    {
      movementType: params.movementType,
      categoryId: params.categoryId,
      categoryCodeSnapshot: params.categoryCodeSnapshot,
      status: 'posted',
      operationDate: operationTimestamp,
      postingDate: Timestamp.fromDate(approvedAtDate),
      accountingPeriod: toAccountingPeriod(params.operationDate),
      originType: params.originType,
      originCollection: params.originCollection ?? null,
      originId: params.originId ?? null,
      thirdPartyType: params.thirdPartyType ?? null,
      thirdPartyId: params.thirdPartyId ?? null,
      paymentMethodId: paymentMethod?.id ?? null,
      paymentMethodCodeSnapshot: paymentMethod?.id ?? null,
      grossAmountMinor,
      appliedCommissionPctBps,
      appliedCommissionAmountMinor,
      netAmountMinor,
      bancarizado: params.bancarizado,
      imputableImpositivo: params.imputableImpositivo,
      settlementId: params.settlementId ?? null,
      registeredByUid: params.actorUid,
      approvedByUid: params.approvedByUid ?? params.actorUid,
      approvedAt: Timestamp.fromDate(approvedAtDate),
      reversalOfMovementId: null,
      voidReason: null,
      metadata: {
        ...(params.metadata ?? {}),
        ...(appliedCommissionPctBps !== null
          ? {
              paymentCommissionMode: params.paymentCommissionMode ?? 'deduct_from_gross',
              paymentCommissionBreakdown,
              clubAmountMinor: params.movementType === 'income' ? netAmountMinor : null,
              amountToChargeMinor: params.movementType === 'income' ? grossAmountMinor : null,
              expenseBaseAmountMinor: params.movementType === 'expense' ? params.grossAmountMinor : null,
              expenseTotalDebitedMinor: params.movementType === 'expense' ? netAmountMinor : null,
            }
          : {}),
      },
      notes: params.notes ?? null,
    },
    params.actorUid,
  );

  return {
    movementId,
    grossAmountMinor,
    netAmountMinor,
    appliedCommissionPctBps,
    appliedCommissionAmountMinor,
    paymentMethodCodeSnapshot: paymentMethod?.id ?? null,
  };
}

export function buildMovementPatchForVoid(params: {
  existingMovement: FinancialMovementDocument;
  reason: string;
}): Partial<FinancialMovementDocument> {
  return {
    status: 'voided',
    voidReason: params.reason,
  };
}
