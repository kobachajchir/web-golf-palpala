import type { AccountingSummary } from '../types/accounting';
import { formatCurrency, formatPeriod, getSignedMovementAmount } from '../utils/accountingFormatters';

export function AccountingHeaderSummary({ summary }: { summary: AccountingSummary | null }) {
  const netMinor = summary?.periodMovements.reduce((total, movement) => total + getSignedMovementAmount(movement), 0) ?? 0;

  return (
    <section className="summary-grid accounting-summary-grid accounting-header-summary" aria-label="Resumen contable">
      <article className="summary-card">
        <span>Periodo</span>
        <strong>{summary ? formatPeriod(summary.period) : 'Cargando'}</strong>
        <small>Vista operativa</small>
      </article>
      <article className="summary-card">
        <span>Caja neta</span>
        <strong>{formatCurrency(netMinor)}</strong>
        <small>{summary?.periodMovements.length ?? 0} movimientos</small>
      </article>
      <article className="summary-card">
        <span>Cuotas pendientes</span>
        <strong>{summary?.pendingFeeCount ?? 0}</strong>
        <small>{formatCurrency(summary?.pendingFeeCharges.reduce((total, charge) => total + charge.finalAmountMinor, 0) ?? 0)}</small>
      </article>
      <article className="summary-card">
        <span>Rendiciones</span>
        <strong>{summary?.pendingExpenseCount ?? 0}</strong>
        <small>Pendientes de revision</small>
      </article>
    </section>
  );
}
