import type { AccountingPeriod, FinancialConfigDocument } from '../../../modules/accounting/domain/models';

type EarlyPaymentConfig = Pick<
  FinancialConfigDocument,
  'earlyPaymentDiscountPctBps' | 'earlyPaymentDiscountDayOfMonth'
>;

function getPaymentDatePeriod(paymentDate: string): AccountingPeriod | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
    ? (paymentDate.slice(0, 7) as AccountingPeriod)
    : null;
}

function getPaymentDateDay(paymentDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
    ? Number(paymentDate.slice(8, 10))
    : Number.NaN;
}

export function calculateMemberFeeEarlyPaymentPreview({
  amountMinor,
  period,
  paymentDate,
  config,
  forceDiscount,
}: {
  amountMinor: number;
  period: AccountingPeriod;
  paymentDate: string;
  config: EarlyPaymentConfig | null | undefined;
  forceDiscount?: boolean;
}) {
  const discountPctBps = config?.earlyPaymentDiscountPctBps ?? 0;
  const discountDayOfMonth = config?.earlyPaymentDiscountDayOfMonth ?? 10;
  const isCurrentPaymentPeriod = getPaymentDatePeriod(paymentDate) === period;
  const paymentDay = getPaymentDateDay(paymentDate);
  const qualifiesAutomatically = isCurrentPaymentPeriod
    && paymentDay >= 1
    && paymentDay <= discountDayOfMonth;
  const appliesDiscount = discountPctBps > 0
    && isCurrentPaymentPeriod
    && (forceDiscount === true || (forceDiscount === undefined && qualifiesAutomatically));
  const discountAmountMinor = appliesDiscount
    ? Math.round((amountMinor * discountPctBps) / 10000)
    : 0;

  return {
    discountPctBps: appliesDiscount ? discountPctBps : 0,
    discountAmountMinor,
    payableAmountMinor: Math.max(amountMinor - discountAmountMinor, 0),
  };
}
