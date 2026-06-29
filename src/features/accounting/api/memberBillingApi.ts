import { ACCOUNTING_INCOME_CATEGORY_IDS } from '../../../modules/accounting/domain/constants';
import type { AccountingPeriod } from '../../../modules/accounting/domain/models';
import type { EntityWithId, MemberFeeChargeDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createMemberFeeChargesRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { buildArgentinaDateIso } from '../utils/accountingFormatters';
import { memberFeeChargeToOpenItem } from '../utils/accountingMappers';
import type {
  CheckoutSession,
  ManualPaymentReceipt,
  ManualPaymentRequest,
  MercadoPagoCheckoutRequest,
  OpenItem,
} from '../types/payment';

const accountingCallables = createAccountingCallables();

function isCharge(charge: EntityWithId<MemberFeeChargeDocument> | null): charge is EntityWithId<MemberFeeChargeDocument> {
  return Boolean(charge);
}

export async function getMemberOpenItems(memberId: string, period?: AccountingPeriod): Promise<OpenItem[]> {
  const repository = createMemberFeeChargesRepository();
  const charges = await repository.listByMember(memberId, 25);
  return charges
    .filter((charge) => {
      const isOpen = charge.status === 'pending' || charge.status === 'overdue';
      return isOpen && (!period || charge.period === period);
    })
    .map(memberFeeChargeToOpenItem);
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
  const validCharges = charges.filter(isCharge).filter((charge) => charge.status !== 'paid');

  if (validCharges.length === 0) {
    throw new Error('No hay conceptos abiertos validos para cobrar.');
  }

  const results = [];
  for (const charge of validCharges) {
    results.push(
      await accountingCallables.registerPayment({
        sourceType: 'member_fee_charge',
        sourceId: charge.id,
        memberId: charge.memberId ?? charge.holderMemberId ?? request.memberId,
        categoryId: ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria,
        paymentMethodId: request.paymentMethodId,
        paymentReference: request.reference?.trim() || null,
        grossAmountMinor: charge.finalAmountMinor,
        operationDate: buildArgentinaDateIso(request.paymentDate),
        notes: request.notes?.trim() || null,
        metadata: {
          openItemIds: request.openItemIds,
          paymentReference: request.reference?.trim() || null,
        },
      }),
    );
  }

  return {
    movementIds: results.map((result) => result.movementId),
    receiptNumbers: results.map((result) => result.receiptNumber).filter((value): value is string => Boolean(value)),
    totalAmountMinor: results.reduce((total, result) => total + result.netAmountMinor, 0),
    duplicate: results.every((result) => result.duplicate),
  };
}

export async function createMercadoPagoCheckout(request: MercadoPagoCheckoutRequest): Promise<CheckoutSession> {
  const repository = createMemberFeeChargesRepository();
  const charges = await Promise.all(request.openItemIds.map((openItemId) => repository.getById(openItemId)));
  const validCharges = charges.filter(isCharge).filter((charge) => charge.status !== 'paid');

  if (validCharges.length === 0) {
    throw new Error('No hay conceptos abiertos validos para generar checkout.');
  }

  const result = await accountingCallables.createMercadoPagoCheckout({
    items: validCharges.map((charge) => ({
      sourceType: 'member_fee_charge',
      sourceId: charge.id,
      memberId: charge.memberId ?? charge.holderMemberId ?? request.memberId,
    })),
    notes: `Checkout Mercado Pago para ${validCharges.length} concepto(s).`,
  });

  return {
    ...result,
    totalAmountMinor: validCharges.reduce((total, charge) => total + charge.finalAmountMinor, 0),
    itemCount: validCharges.length,
  };
}
