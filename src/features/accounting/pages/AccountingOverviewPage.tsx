import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AccountingHeaderSummary } from '../components/AccountingHeaderSummary';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import type { CashClosureDocument, EntityWithId } from '../../../modules/accounting/domain/models';
import { createCashClosuresRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { formatCurrency, formatTimestamp, getMovementLabel, getPersonDisplayName } from '../utils/accountingFormatters';
import { buildChargesByMemberId, estimateMemberFeeAmountMinor, getOpenFeeCharges } from '../utils/memberFeeEstimates';

type AccountingActionIcon = 'wallet' | 'calendar' | 'clipboard' | 'chart' | 'flag';

type AccountingQuickAction = {
  id: string;
  label: string;
  helper: string;
  icon: AccountingActionIcon;
  to: string;
};

function toClubDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getClosureDayKey(closure: EntityWithId<CashClosureDocument>) {
  const date = closure.closureDate?.toDate();
  return date ? toClubDayKey(date) : '';
}

function ActionIcon({ type }: { type: AccountingActionIcon }) {
  const icons: Record<AccountingActionIcon, ReactNode> = {
    wallet: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h10A2.5 2.5 0 0 1 19 6.5V7h1a2 2 0 0 1 2 2v7.5A2.5 2.5 0 0 1 19.5 19h-13A2.5 2.5 0 0 1 4 16.5v-10ZM19.5 9H16a2 2 0 1 0 0 4h3.5a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5ZM6 7h11V6.5a.5.5 0 0 0-.5-.5h-10a.5.5 0 0 0-.5.5V7Zm10 4h1" />,
    calendar: <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 22 6.5v12A2.5 2.5 0 0 1 19.5 21h-15A2.5 2.5 0 0 1 2 18.5v-12A2.5 2.5 0 0 1 4.5 4H6V3a1 1 0 0 1 1-1Zm12.5 8h-15v8.5a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5V10Z" />,
    clipboard: <path d="M9 2a2 2 0 0 0-2 2H6.5A2.5 2.5 0 0 0 4 6.5v13A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5v-13A2.5 2.5 0 0 0 17.5 4H17a2 2 0 0 0-2-2H9Zm0 2h6v2H9V4Zm-1 6h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Zm0 4h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Z" />,
    chart: <path d="M4 19h16a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1V4a1 1 0 1 1 2 0v15Zm3-2a1 1 0 0 1-1-1v-4a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1Zm5 0a1 1 0 0 1-1-1V8a1 1 0 1 1 2 0v8a1 1 0 0 1-1 1Zm5 0a1 1 0 0 1-1-1V5a1 1 0 1 1 2 0v11a1 1 0 0 1-1 1Z" />,
    flag: <path d="M5 3a1 1 0 0 1 2 0v1h8.7a1 1 0 0 1 .86 1.5L15 8l1.56 2.5A1 1 0 0 1 15.7 12H7v8a1 1 0 1 1-2 0V3Z" />,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      {icons[type]}
    </svg>
  );
}

export function AccountingOverviewPage() {
  const { summary, loading, error } = useAccountingSummary();
  const [closures, setClosures] = useState<Array<EntityWithId<CashClosureDocument>>>([]);
  const todayKey = toClubDayKey(new Date());

  useEffect(() => {
    if (!summary?.period) {
      return;
    }

    let cancelled = false;
    void createCashClosuresRepository()
      .listByPeriod(summary.period)
      .then((nextClosures) => {
        if (!cancelled) {
          setClosures(nextClosures);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setClosures([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [summary?.period]);

  const hasTodayClosure = closures.some((closure) => getClosureDayKey(closure) === todayKey);
  const pendingFeeTotalMinor = summary?.renewalPendingTotalMinor ?? 0;
  const openChargesByMemberId = useMemo(
    () => buildChargesByMemberId(
      summary?.membersPreview ?? [],
      getOpenFeeCharges([...(summary?.periodFeeCharges ?? []), ...(summary?.pendingFeeCharges ?? [])]),
    ),
    [summary?.membersPreview, summary?.pendingFeeCharges, summary?.periodFeeCharges],
  );
  const pendingFeePreview = summary?.renewalMembers ?? [];
  const pendingExpensePreview = summary?.pendingExpenses ?? [];
  const quickActions = useMemo<AccountingQuickAction[]>(() => {
    const actions: AccountingQuickAction[] = [
      { id: 'register-payment', label: 'Registrar cobro', helper: 'Ingresos por categoria', icon: 'wallet', to: '/accounting/caja?tab=cobros' },
      { id: 'renewals', label: 'Renovaciones', helper: 'Socios por renovar', icon: 'calendar', to: '/accounting/member-dues?tab=renewals' },
      { id: 'manual-expense', label: 'Registrar egreso', helper: 'Gastos operativos', icon: 'clipboard', to: '/accounting/caja?tab=egresos' },
      { id: 'expense-review', label: 'Rendiciones', helper: 'Revision y aprobacion', icon: 'clipboard', to: '/accounting/caja?tab=rendiciones' },
      { id: 'daily-movements', label: 'Movimientos', helper: 'Caja operativa', icon: 'chart', to: '/accounting/caja?tab=movimientos' },
      { id: 'reports', label: 'Reportes', helper: 'Balances y resumen', icon: 'flag', to: '/accounting/reports' },
    ];

    return hasTodayClosure
      ? actions
      : [{ id: 'open-cash', label: 'Abrir caja', helper: 'Jornada de hoy', icon: 'chart' as const, to: '/accounting/caja?tab=cierre' }, ...actions].slice(0, 6);
  }, [hasTodayClosure]);

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <h1>Contabilidad</h1>
          <p>Accesos por tarea para cobrar, renovar, rendir, conciliar y reportar.</p>
        </div>
      </section>

      <AccountingInlineNotice notice={error ? { kind: 'error', message: error } : null} />
      {loading && <div className="loading-state loading-state--inline"><span className="loading-spinner" /><strong>Cargando contabilidad</strong></div>}

      <AccountingHeaderSummary summary={summary} />

      <section className="floating-card accounting-primary-panel">
        <div className="accounting-section-header accounting-section-header--plain">
          <h2>Acciones rapidas</h2>
        </div>
        <div className="action-grid accounting-action-grid">
          {quickActions.map((action) => (
            <Link key={action.id} className="action-tile accounting-action-tile" to={action.to}>
              <span className="action-icon">
                <ActionIcon type={action.icon} />
              </span>
              <strong>{action.label}</strong>
              <small>{action.helper}</small>
            </Link>
          ))}
        </div>
      </section>

      <div className="accounting-layout">
        <section className="floating-card accounting-primary-panel">
          <div className="accounting-section-header">
            <h2>Pendientes</h2>
          </div>
          <div className="accounting-list">
            <Link className="accounting-row accounting-row--actions" to="/accounting/member-dues?tab=renewals">
              <span className="accounting-row__main">
                <strong>Cuotas y renovaciones</strong>
                <small>{summary?.renewalPendingConceptCount ?? 0} conceptos abiertos para cobrar</small>
                <span className="accounting-pending-lines">
                  {pendingFeePreview.map((member) => {
                    const charges = openChargesByMemberId.get(member.id) ?? [];
                    const openAmountMinor = charges.reduce((total, charge) => total + charge.finalAmountMinor, 0);
                    const hasCurrentPeriodOpenCharge = charges.some((charge) => charge.period === summary?.period);
                    const amountMinor = openAmountMinor + (hasCurrentPeriodOpenCharge ? 0 : estimateMemberFeeAmountMinor(member, summary?.activeConfig));
                    return (
                      <small key={member.id}>
                        {getPersonDisplayName(member)} - socio {member.memberNumber} - {formatCurrency(amountMinor)}
                      </small>
                    );
                  })}
                </span>
              </span>
              <span className="accounting-row__meta">
                <strong>{formatCurrency(pendingFeeTotalMinor)}</strong>
                <small>Total abierto</small>
              </span>
            </Link>
            <Link className="accounting-row accounting-row--actions" to="/accounting/caja?tab=rendiciones">
              <span className="accounting-row__main">
                <strong>Rendiciones pendientes</strong>
                <small>{summary?.pendingExpenseCount ?? 0} pendientes de aprobacion</small>
                <span className="accounting-pending-lines">
                  {pendingExpensePreview.map((expense) => (
                    <small key={expense.id}>{expense.description} - {expense.vendorName ?? 'Sin proveedor'} - {formatCurrency(expense.amountMinor)}</small>
                  ))}
                </span>
              </span>
              <span className="accounting-row__meta">
                <strong>{formatCurrency(summary?.pendingExpenseTotalMinor ?? 0)}</strong>
                <small>Total rendido</small>
              </span>
            </Link>
          </div>
        </section>

        <section className="floating-card accounting-secondary-panel">
          <div className="accounting-section-header">
            <h2>Movimientos</h2>
          </div>
          <div className="accounting-table-wrap">
            <table className="accounting-data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Movimiento</th>
                  <th>Estado</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.recentMovements ?? []).map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatTimestamp(movement.operationDate)}</td>
                    <td><strong>{getMovementLabel(movement)}</strong></td>
                    <td><span className={`status-chip status-chip--${movement.status}`}>{movement.status}</span></td>
                    <td><strong>{formatCurrency(movement.netAmountMinor)}</strong></td>
                  </tr>
                ))}
                {!loading && (summary?.recentMovements.length ?? 0) === 0 && (
                  <tr><td colSpan={4}>Sin movimientos todavia.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
