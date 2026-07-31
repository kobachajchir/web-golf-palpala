import { ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import type { OpenItem, PaymentMethod } from '../types/payment';

export function requiresPaymentReference(paymentMethodId: string | null | undefined) {
  return Boolean(
    paymentMethodId
      && paymentMethodId !== ACCOUNTING_PAYMENT_METHOD_IDS.cash,
  );
}

export function validatePaymentDraft({
  memberId,
  openItems,
  selectedOpenItemIds,
  paymentMethodId,
  paymentDate,
  reference,
  paymentMethods,
}: {
  memberId: string | null | undefined;
  openItems: OpenItem[];
  selectedOpenItemIds: string[];
  paymentMethodId: string | null;
  paymentDate: string;
  reference: string;
  paymentMethods: PaymentMethod[];
}) {
  const selectedItems = openItems.filter((item) => selectedOpenItemIds.includes(item.id));
  const amountMinor = selectedItems.reduce((total, item) => total + item.amountMinor, 0);
  const method = paymentMethods.find((entry) => entry.id === paymentMethodId) ?? null;

  if (!memberId) {
    return 'Selecciona un socio antes de registrar el cobro.';
  }

  if (selectedItems.length === 0) {
    return 'Selecciona al menos un concepto abierto para cobrar.';
  }

  if (!paymentMethodId || !method) {
    return 'Selecciona un medio de pago.';
  }

  if (!paymentDate) {
    return 'Selecciona la fecha del pago.';
  }

  if (amountMinor <= 0) {
    return 'El monto del cobro debe ser mayor a cero.';
  }

  if (requiresPaymentReference(paymentMethodId) && !reference.trim()) {
    return 'Ingresa la referencia del comprobante para este medio de pago.';
  }

  return null;
}

export function validateReversalReason(reason: string) {
  return reason.trim().length >= 10 ? null : 'El motivo debe tener al menos 10 caracteres.';
}
