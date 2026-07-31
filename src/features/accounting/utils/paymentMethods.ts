import { ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import type { PaymentMethod } from '../types/payment';

export type PaymentAccountId = 'cash' | 'macro' | 'debitMacro' | 'galicia';

const HIDDEN_PAYMENT_METHOD_IDS = new Set<string>([
  'mercado_pago',
  ACCOUNTING_PAYMENT_METHOD_IDS.transfer,
  ACCOUNTING_PAYMENT_METHOD_IDS.debit,
  ACCOUNTING_PAYMENT_METHOD_IDS.credit,
]);

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  [ACCOUNTING_PAYMENT_METHOD_IDS.cash]: 'Efectivo',
  [ACCOUNTING_PAYMENT_METHOD_IDS.transferMacro]: 'Transferencia Macro',
  [ACCOUNTING_PAYMENT_METHOD_IDS.qrMacro]: 'QR Macro',
  [ACCOUNTING_PAYMENT_METHOD_IDS.transferGalicia]: 'Transferencia Galicia',
  [ACCOUNTING_PAYMENT_METHOD_IDS.qrGalicia]: 'QR Galicia',
  [ACCOUNTING_PAYMENT_METHOD_IDS.debitGalicia]: 'Tarjeta de debito',
  [ACCOUNTING_PAYMENT_METHOD_IDS.creditGalicia]: 'Tarjeta de credito',
  [ACCOUNTING_PAYMENT_METHOD_IDS.transfer]: 'Transferencia',
  [ACCOUNTING_PAYMENT_METHOD_IDS.debit]: 'Tarjeta debito',
  [ACCOUNTING_PAYMENT_METHOD_IDS.credit]: 'Tarjeta credito',
  [ACCOUNTING_PAYMENT_METHOD_IDS.debitMacro]: 'Cuenta debito Macro',
};

const CASH_METHOD_IDS = new Set<string>([ACCOUNTING_PAYMENT_METHOD_IDS.cash]);
const MACRO_METHOD_IDS = new Set<string>([
  ACCOUNTING_PAYMENT_METHOD_IDS.transferMacro,
  ACCOUNTING_PAYMENT_METHOD_IDS.qrMacro,
]);
const DEBIT_MACRO_METHOD_IDS = new Set<string>([
  ACCOUNTING_PAYMENT_METHOD_IDS.debitMacro,
]);
const GALICIA_METHOD_IDS = new Set<string>([
  ACCOUNTING_PAYMENT_METHOD_IDS.transferGalicia,
  ACCOUNTING_PAYMENT_METHOD_IDS.qrGalicia,
  ACCOUNTING_PAYMENT_METHOD_IDS.debitGalicia,
  ACCOUNTING_PAYMENT_METHOD_IDS.creditGalicia,
]);
const LEGACY_GALICIA_METHOD_IDS = new Set<string>([
  ACCOUNTING_PAYMENT_METHOD_IDS.transfer,
  ACCOUNTING_PAYMENT_METHOD_IDS.debit,
  ACCOUNTING_PAYMENT_METHOD_IDS.credit,
]);

export const PAYMENT_ACCOUNT_OPTIONS: Array<{ id: PaymentAccountId; label: string; helper?: string }> = [
  { id: 'cash', label: 'Efectivo' },
  { id: 'macro', label: 'Macro', helper: 'Transferencia Macro / QR Macro' },
  { id: 'debitMacro', label: 'Cuenta debito Macro', helper: 'Solo cuotas societarias' },
  { id: 'galicia', label: 'Galicia', helper: 'Transferencia Galicia / QR Galicia / tarjetas' },
];

export function isVisiblePaymentMethod(method: Pick<PaymentMethod, 'id'>) {
  return !HIDDEN_PAYMENT_METHOD_IDS.has(method.id);
}

export function isMacroDebitPaymentMethod(method: Pick<PaymentMethod, 'id'> | string | null | undefined) {
  const methodId = typeof method === 'string' ? method : method?.id;
  return methodId === ACCOUNTING_PAYMENT_METHOD_IDS.debitMacro;
}

export function getPaymentMethodDisplayName(method: Pick<PaymentMethod, 'id' | 'name'> | string | null | undefined) {
  if (!method) {
    return 'Sin medio';
  }
  const methodId = typeof method === 'string' ? method : method.id;
  const methodName = typeof method === 'string' ? null : method.name;
  return PAYMENT_METHOD_LABELS[methodId] ?? methodName ?? methodId.replaceAll('_', ' ');
}

export function getPaymentMethodAccount(method: Pick<PaymentMethod, 'id' | 'name'>): PaymentAccountId | null {
  if (CASH_METHOD_IDS.has(method.id)) {
    return 'cash';
  }
  if (MACRO_METHOD_IDS.has(method.id)) {
    return 'macro';
  }
  if (DEBIT_MACRO_METHOD_IDS.has(method.id)) {
    return 'debitMacro';
  }
  if (GALICIA_METHOD_IDS.has(method.id)) {
    return 'galicia';
  }
  if (LEGACY_GALICIA_METHOD_IDS.has(method.id)) {
    return 'galicia';
  }

  const name = method.name.toLowerCase();
  if (name.includes('macro') && name.includes('debito')) {
    return 'debitMacro';
  }
  if (name.includes('macro')) {
    return 'macro';
  }
  if (name.includes('galicia') || name.includes('credito') || name.includes('debito') || name.includes('transfer')) {
    return 'galicia';
  }
  return null;
}

export function getPaymentMethodsForAccount(paymentMethods: PaymentMethod[], accountId: PaymentAccountId) {
  return paymentMethods
    .filter(isVisiblePaymentMethod)
    .filter((method) => getPaymentMethodAccount(method) === accountId);
}

export function getPaymentMethodCommissionPctBps(method: PaymentMethod | null | undefined) {
  return Math.max(0, Math.min(10000, method?.activeCommissionPctBps ?? 0));
}

export function calculatePaymentCommission(amountMinor: number, method: PaymentMethod | null | undefined) {
  const percentageBps = getPaymentMethodCommissionPctBps(method);
  const commissionAmountMinor = Number.isFinite(amountMinor)
    ? Math.round((amountMinor * percentageBps) / 10000)
    : 0;
  return {
    percentageBps,
    commissionAmountMinor,
    totalAmountMinor: Number.isFinite(amountMinor) ? amountMinor + commissionAmountMinor : 0,
  };
}

export function formatPaymentCommissionPct(percentageBps: number | null | undefined) {
  return `${((percentageBps ?? 0) / 100).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function getMovementStatusLabel(status: string | null | undefined) {
  switch (status) {
    case 'draft':
      return 'Borrador';
    case 'pending':
      return 'Pendiente';
    case 'posted':
      return 'Pagado';
    case 'voided':
      return 'Anulado';
    case 'reversed':
      return 'Revertido';
    case 'open':
      return 'Abierta';
    case 'closed':
      return 'Cerrada';
    default:
      return status ?? 'Sin estado';
  }
}
