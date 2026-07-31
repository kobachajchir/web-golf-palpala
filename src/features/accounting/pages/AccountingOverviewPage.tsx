import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AccountingHeaderSummary } from '../components/AccountingHeaderSummary';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMovementDetailModal } from '../components/AccountingMovementDetailModal';
import { AccountingMovementsPanel } from '../components/AccountingMovementsPanel';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import type { CashClosureDocument, EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import {
  createCashClosuresRepository,
  createFinancialExpenseCategoriesRepository,
  createFinancialIncomeCategoriesRepository,
} from '../../../modules/accounting/infrastructure/firestore/repositories';
import { formatCurrency } from '../utils/accountingFormatters';
import type { ExpenseCategoryOption, IncomeCategoryOption } from '../utils/accountingCategories';
import { getFallbackExpenseCategories, getFallbackIncomeCategories } from '../utils/accountingCategories';
import { getServerExpenseAlertMessage } from '../utils/serverExpenseAlert';

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
  const { summary, loading, error, reload } = useAccountingSummary();
  const [closures, setClosures] = useState<Array<EntityWithId<CashClosureDocument>>>([]);
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategoryOption[]>(() => getFallbackIncomeCategories());
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryOption[]>(() => getFallbackExpenseCategories());
  const [selectedMovement, setSelectedMovement] = useState<EntityWithId<FinancialMovementDocument> | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      createFinancialIncomeCategoriesRepository().listActiveSorted().catch(() => getFallbackIncomeCategories()),
      createFinancialExpenseCategoriesRepository().listActiveSorted().catch(() => getFallbackExpenseCategories()),
    ]).then(([nextIncomeCategories, nextExpenseCategories]) => {
      if (cancelled) {
        return;
      }
      setIncomeCategories(nextIncomeCategories.length ? nextIncomeCategories : getFallbackIncomeCategories());
      setExpenseCategories(nextExpenseCategories.length ? nextExpenseCategories : getFallbackExpenseCategories());
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const hasTodayOpenClosure = closures.some((closure) => getClosureDayKey(closure) === todayKey && closure.status === 'open');
  const pendingFeeTotalMinor = summary?.renewalPendingTotalMinor ?? 0;
  const serverExpenseAlertMessage = getServerExpenseAlertMessage(
    summary?.period,
    summary?.periodMovements ?? [],
    summary?.activeConfig?.serverMonthlyExpenseMinor,
    summary?.activeConfig?.serverMonthlyExpenseDueDay,
  );
  const quickActions = useMemo<AccountingQuickAction[]>(() => {
    const actions: AccountingQuickAction[] = [
      { id: 'green-fee-payment', label: 'Green Fee y cuotas', helper: 'Cobro directo', icon: 'wallet', to: '/accounting/caja?tab=cobros&modal=income-priority' },
      { id: 'register-payment', label: 'Registrar cobro', helper: 'Ingresos por categoria', icon: 'wallet', to: '/accounting/caja?tab=cobros&modal=income-other' },
      { id: 'renewals', label: 'Renovaciones', helper: 'Socios por renovar', icon: 'calendar', to: '/accounting/member-dues?tab=renewals' },
      { id: 'manual-expense', label: 'Registrar egreso', helper: 'Gastos operativos', icon: 'clipboard', to: '/accounting/caja?tab=egresos&modal=expense' },
      { id: 'daily-movements', label: 'Movimientos', helper: 'Caja operativa', icon: 'chart', to: '/accounting/caja?tab=movimientos' },
      { id: 'reports', label: 'Reportes', helper: 'Balances y resumen', icon: 'flag', to: '/accounting/reports' },
    ];

    return hasTodayOpenClosure
      ? actions
      : [actions[0]!, actions[1]!, { id: 'open-cash', label: 'Abrir caja', helper: 'Jornada de hoy', icon: 'chart' as const, to: '/accounting/caja?tab=caja' }, ...actions.slice(2)].slice(0, 6);
  }, [hasTodayOpenClosure]);

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <h1>Contabilidad</h1>
        </div>
      </section>

      <AccountingInlineNotice notice={error ? { kind: 'error', message: error } : null} />
      <AccountingInlineNotice notice={serverExpenseAlertMessage ? { kind: 'error', message: serverExpenseAlertMessage } : null} />
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
              </span>
              <span className="accounting-row__meta">
                <strong>{formatCurrency(pendingFeeTotalMinor)}</strong>
                <small>Total abierto</small>
              </span>
            </Link>
          </div>
        </section>

        <div className="accounting-secondary-panel accounting-overview-movements">
          <AccountingMovementsPanel
            movements={summary?.periodMovements ?? []}
            incomeCategories={incomeCategories}
            expenseCategories={expenseCategories}
            paymentMethods={summary?.paymentMethods ?? []}
            period={summary?.period}
            loading={loading}
            onSelectMovement={setSelectedMovement}
            onMovementChanged={reload}
          />
        </div>
      </div>
      {selectedMovement && (
        <AccountingMovementDetailModal
          movement={selectedMovement}
          members={summary?.membersPreview ?? []}
          employees={summary?.employeesPreview ?? []}
          paymentMethods={summary?.paymentMethods ?? []}
          onSelectMovement={setSelectedMovement}
          onChanged={reload}
          onClose={() => setSelectedMovement(null)}
        />
      )}
    </div>
  );
}
