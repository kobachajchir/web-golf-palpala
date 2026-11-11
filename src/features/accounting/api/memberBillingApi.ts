import type { AccountingPeriod } from '../../../modules/accounting/domain/models';
import type { EntityWithId, MemberFeeChargeDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createMemberFeeChargesRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { buildArgentinaDateIso } from '../utils/accountingFormatters';
import { memberFeeChargeToOpenItem } from '../utils/accountingMappers';
import { getOrCreateOperationKey, memberFeePaymentOperationScope } from '../utils/pendingOperationKeys';
import type {
  ManualPaymentReceipt,
  ManualPaymentRequest,
  OpenItem,
} from '../types/payment';

const accountingCallables = createAccountingCallables();

function isCharge(charge: EntityWithId<MemberFeeChargeDocument> | null): charge is EntityWithId<MemberFeeChargeDocument> {
  return Boolean(charge);
}
export async function getMemberOpenItems(memberId: string, period?: AccountingPeriod): Promise<OpenItem[]> {
  const repository = createMemberFeeChargesRepository();
  const [memberCharges, holderCharges] = await Promise.all([
    repository.listByMember(memberId, 25),
    repository.listByHolderMember(memberId, 25),
  ]);
  const charges = [...new Map([...memberCharges, ...holderCharges].map((charge) => [charge.id, charge])).values()];
  return charges
    .filter((charge) => {
      const isOpen = charge.status === 'pending' || charge.status === 'overdue';
      return isOpen && (!period || charge.period === period);
    })
    .map(memberFeeChargeToOpenItem)
    .filter((item) => item.amountMinor > 0);
}

export async function generateMembershipFee({
  memberId,
  period,
  reason,
  force,
}: {
  memberId: string;
  period: AccountingPeriod;
  reason?: string;
  force?: boolean;
}) {
  return accountingCallables.generateCuota({
    memberId,
    period,
    notes: reason || null,
    forceAdministrativeExceptionReason: force ? reason || 'Generacion administrativa forzada.' : null,
  });
}

export async function registerManualPayment(request: ManualPaymentRequest): Promise<ManualPaymentReceipt> {
  const repository = createMemberFeeChargesRepository();
  const charges = await Promise.all(request.openItemIds.map((openItemId) => repository.getById(openItemId)));
  const validCharges = charges.filter(isCharge).filter((charge) => charge.status === 'pending' || charge.status === 'overdue');
  const periodAllocations = request.periodAllocations ?? [];

  if (validCharges.length === 0 && periodAllocations.length === 0) {
    throw new Error('Selecciona una cuota pendiente o un mes para cobrar por adelantado.');
  }

  // La clave pertenece a la operacion de cobro del socio y se persiste hasta que la pantalla
  // confirme el resultado (ver pendingOperationKeys). Reintentos y recargas reutilizan la misma.
  const operationScope = request.operationScope ?? memberFeePaymentOperationScope(request.memberId);
  const requestKey = getOrCreateOperationKey(operationScope);
  const result = await accountingCallables.registerMemberFeeBatchPayment({
    allocations: [...validCharges.map((charge) => {
      const amountMinor = request.allocationAmountsByChargeId?.[charge.id];
      const settlementAmountMinor = request.settlementAmountsByChargeId?.[charge.id];
      const expectedAvailableMinor = request.expectedAvailableByChargeId?.[charge.id];
      return {
        chargeId: charge.id,
        ...(expectedAvailableMinor !== undefined && settlementAmountMinor === undefined ? { expectedAvailableMinor } : {}),
        ...(amountMinor !== undefined ? { amountMinor } : {}),
        ...(settlementAmountMinor !== undefined ? { settlementAmountMinor } : {}),
        ...(request.applyEarlyPaymentDiscount !== undefined
          ? { applyEarlyPaymentDiscount: request.applyEarlyPaymentDiscount }
          : {}),
      };
    }), ...periodAllocations.map((allocation) => ({
      memberId: request.memberId,
      period: allocation.period,
      ...(allocation.expectedAvailableMinor !== undefined ? { expectedAvailableMinor: allocation.expectedAvailableMinor } : {}),
      amountMinor: allocation.amountMinor,
      ...(allocation.settlementAmountMinor !== undefined
        ? { settlementAmountMinor: allocation.settlementAmountMinor }
        : {}),
      ...(request.applyEarlyPaymentDiscount !== undefined
        ? { applyEarlyPaymentDiscount: request.applyEarlyPaymentDiscount }
        : {}),
    }))],
    paymentMethodId: request.paymentMethodId,
    paymentReference: request.reference?.trim() || null,
    operationDate: buildArgentinaDateIso(request.paymentDate),
    notes: request.notes?.trim() || null,
    idempotencyKey: requestKey,
  });

  return {
    movementIds: [result.movementId],
    receiptNumbers: result.receiptNumber ? [result.receiptNumber] : [],
    totalAmountMinor: result.grossAmountMinor,
    duplicate: Boolean((result as { duplicate?: boolean }).duplicate),
    operationScope,
    operationKey: requestKey,
  };
}
