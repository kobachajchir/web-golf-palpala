import type { AccountingSummary } from '../types/accounting';
import { formatCurrency, getSignedMovementAmount } from '../utils/accountingFormatters';
import { isMovementExcludedFromBalance } from '../utils/balanceInclusion';

export function AccountingHeaderSummary({ summary }: { summary: AccountingSummary | null }) {
  const balanceMovements = summary?.periodMovements.filter((movement) => !isMovementExcludedFromBalance(movement)) ?? [];
  const netMinor = balanceMovements.reduce((total, movement) => total + getSignedMovementAmount(movement), 0);

  return (
    <section className="summary-grid accounting-summary-grid accounting-header-summary" aria-label="Resumen contable">
      <article className="summary-card">
        <span>Caja neta</span>
        <strong>{formatCurrency(netMinor)}</strong>
        <small>{balanceMovements.length} movimientos contados</small>
      </article>
      <article className="summary-card">
        <span>Cuotas pendientes</span>
        <strong>{summary?.renewalPendingConceptCount ?? 0}</strong>
        <small>{formatCurrency(summary?.renewalPendingTotalMinor ?? 0)}</small>
      </article>
    </section>
  );
}
