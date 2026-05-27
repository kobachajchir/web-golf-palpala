import { Link } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import { AccountingHeaderSummary } from '../components/AccountingHeaderSummary';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import { formatCurrency, formatTimestamp, getMovementLabel } from '../utils/accountingFormatters';

export function AccountingOverviewPage() {
  const { summary, loading, error } = useAccountingSummary();

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Contabilidad</p>
          <h1>Operacion contable</h1>
          <p>Accesos por tarea para cobrar, renovar, rendir, conciliar y reportar sin pasar por un mega-dashboard.</p>
        </div>
      </section>

      <AccountingInlineNotice notice={error ? { kind: 'error', message: error } : null} />
      {loading && <div className="loading-state loading-state--inline"><span className="loading-spinner" /><strong>Cargando contabilidad</strong></div>}

      <AccountingHeaderSummary summary={summary} />

      <section className="floating-card accounting-primary-panel">
        <div className="accounting-section-header">
          <div>
            <p className="eyebrow">Acciones rapidas</p>
            <h2>Entradas reales por flujo</h2>
          </div>
        </div>
        <div className="accounting-quick-grid">
          <UiActionButton to="/accounting/collections" variant="positive">Registrar cobro</UiActionButton>
          <UiActionButton to="/accounting/member-dues?tab=renewals" variant="secondary">Ver renovaciones pendientes</UiActionButton>
          <UiActionButton to="/accounting/expenses" variant="secondary">Cargar egreso</UiActionButton>
          <UiActionButton to="/accounting/expenses?tab=queue" variant="secondary">Ver rendiciones pendientes</UiActionButton>
          <UiActionButton to="/accounting/cash-closures" variant="secondary">Ir a cierres de caja</UiActionButton>
          <UiActionButton to="/accounting/reports" variant="secondary">Ir a reportes</UiActionButton>
        </div>
      </section>

      <div className="accounting-layout">
        <section className="floating-card accounting-primary-panel">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Pendientes</p>
              <h2>Trabajo que pide accion</h2>
            </div>
          </div>
          <div className="accounting-list">
            <Link className="accounting-row accounting-row--actions" to="/accounting/member-dues?tab=renewals">
              <span className="accounting-row__main">
                <strong>Cuotas y renovaciones</strong>
                <small>{summary?.pendingFeeCharges.length ?? 0} conceptos abiertos</small>
              </span>
              <span className="accounting-row__meta">
                <strong>{formatCurrency(summary?.pendingFeeCharges.reduce((total, charge) => total + charge.finalAmountMinor, 0) ?? 0)}</strong>
              </span>
            </Link>
            <Link className="accounting-row accounting-row--actions" to="/accounting/expenses?tab=queue">
              <span className="accounting-row__main">
                <strong>Rendiciones pendientes</strong>
                <small>Revision administrativa antes de postear</small>
              </span>
              <span className="accounting-row__meta">
                <strong>{summary?.pendingExpenseCount ?? 0}</strong>
              </span>
            </Link>
          </div>
        </section>

        <section className="floating-card accounting-secondary-panel">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Ultimos movimientos</p>
              <h2>Caja reciente</h2>
            </div>
          </div>
          <div className="accounting-list">
            {summary?.recentMovements.map((movement) => (
              <article key={movement.id} className="accounting-row">
                <div className="accounting-row__main">
                  <strong>{getMovementLabel(movement)}</strong>
                  <small>{formatTimestamp(movement.operationDate)}</small>
                </div>
                <div className="accounting-row__meta">
                  <span className={`status-chip status-chip--${movement.status}`}>{movement.status}</span>
                  <strong>{formatCurrency(movement.netAmountMinor)}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
