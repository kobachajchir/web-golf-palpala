import type { PaymentCommissionBreakdownItem } from '../../../modules/accounting/domain/models';
import { formatCurrency } from '../utils/accountingFormatters';
import { formatPaymentCommissionPct } from '../utils/paymentMethods';

export function PaymentCommissionSummary({
  direction,
  baseAmountMinor,
  commissionAmountMinor,
  commissionPctBps,
  totalAmountMinor,
  breakdown = [],
}: {
  direction: 'income' | 'expense';
  baseAmountMinor: number;
  commissionAmountMinor: number;
  commissionPctBps: number;
  totalAmountMinor: number;
  breakdown?: PaymentCommissionBreakdownItem[];
}) {
  return (
    <section className="accounting-commission-summary form-field--wide" aria-label="Detalle de comision del medio de pago">
      <div className="accounting-commission-summary__line">
        <span>{direction === 'income' ? 'Importe para el club' : 'Importe del pago'}</span>
        <strong>{formatCurrency(baseAmountMinor)}</strong>
      </div>
      {breakdown.filter((item) => item.isActive).map((item) => (
        <div key={item.id} className="accounting-commission-summary__detail">
          <span>{item.label}</span>
          <small>{formatPaymentCommissionPct(item.percentageBps)}</small>
        </div>
      ))}
      <div className="accounting-commission-summary__line">
        <span>Comision del medio ({formatPaymentCommissionPct(commissionPctBps)})</span>
        <strong>{formatCurrency(commissionAmountMinor)}</strong>
      </div>
      <div className="accounting-commission-summary__line accounting-commission-summary__line--total">
        <span>{direction === 'income' ? 'Precio a cobrar' : 'Total a debitar'}</span>
        <strong>{formatCurrency(totalAmountMinor)}</strong>
      </div>
    </section>
  );
}
