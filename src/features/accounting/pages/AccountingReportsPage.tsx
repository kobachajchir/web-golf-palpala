import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import { generateReport, getReportHistoryItem, listReportHistory } from '../api/accountingApi';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMovementDetailModal } from '../components/AccountingMovementDetailModal';
import { AccountingMovementsPanel } from '../components/AccountingMovementsPanel';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import type { AccountingNotice, AccountingReportHistoryDocument, ReportInclude, ReportScope } from '../types/accounting';
import { formatCurrency, formatPeriod, formatTimestamp, getCurrentAccountingPeriod, normalizeAccountingPeriod, timestampToDate } from '../utils/accountingFormatters';
import type { EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import {
  createFinancialExpenseCategoriesRepository,
  createFinancialIncomeCategoriesRepository,
  createFinancialMovementsRepository,
  createPaymentMethodsRepository,
} from '../../../modules/accounting/infrastructure/firestore/repositories';
import { getFallbackExpenseCategories, getFallbackIncomeCategories, type ExpenseCategoryOption, type IncomeCategoryOption } from '../utils/accountingCategories';
import type { PaymentMethod } from '../types/payment';

const REPORT_INCLUDE_OPTIONS: Array<{ value: ReportInclude; label: string }> = [
  { value: 'movements', label: 'Movimientos' },
  { value: 'cash_flow', label: 'Flujo de caja' },
  { value: 'payment_methods', label: 'Medios de pago' },
  { value: 'categories', label: 'Categorias' },
  { value: 'fees', label: 'Cuotas' },
  { value: 'salaries', label: 'Sueldos' },
];

function createInitialForm() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    title: '',
    scope: 'period' as ReportScope,
    period: getCurrentAccountingPeriod(),
    dateFrom: `${today.slice(0, 8)}01`,
    dateTo: today,
    includes: {
      movements: true,
      cash_flow: true,
      payment_methods: true,
      categories: true,
      fees: false,
      salaries: false,
    } as Record<ReportInclude, boolean>,
    notes: '',
  };
}

function getReportRangeLabel(report: AccountingReportHistoryDocument) {
  return report.scope === 'period'
    ? formatPeriod(report.period ?? '')
    : `${formatDateInputLabel(report.dateFrom)} al ${formatDateInputLabel(report.dateTo)}`;
}

function formatDateInputLabel(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 'sin fecha';
  }

  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function getReportStatusLabel(status: AccountingReportHistoryDocument['status']) {
  switch (status) {
    case 'generated':
      return 'Generado';
    case 'failed':
      return 'Fallido';
    default:
      return status;
  }
}

function getDateRangePeriods(dateFrom: string, dateTo: string) {
  const periods: string[] = [];
  const [fromYearText, fromMonthText] = dateFrom.slice(0, 7).split('-');
  const [toYearText, toMonthText] = dateTo.slice(0, 7).split('-');
  const fromYear = Number(fromYearText);
  const fromMonth = Number(fromMonthText);
  const toYear = Number(toYearText);
  const toMonth = Number(toMonthText);
  if (!Number.isFinite(fromYear) || !Number.isFinite(fromMonth) || !Number.isFinite(toYear) || !Number.isFinite(toMonth)) {
    return periods;
  }

  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    periods.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}

function getMovementDateKey(movement: EntityWithId<FinancialMovementDocument>) {
  const date = timestampToDate(movement.operationDate);
  return date
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date)
    : '';
}

export function AccountingReportsPage() {
  const { reportId } = useParams();
  const { interfaceMode, user } = useAuth();
  const canAccessSensitiveAccounting = interfaceMode === ROLES.DIRECTIVO || interfaceMode === ROLES.ADMINISTRATIVO;
  const [reports, setReports] = useState<Array<AccountingReportHistoryDocument & { id: string }>>([]);
  const [selectedReport, setSelectedReport] = useState<(AccountingReportHistoryDocument & { id: string }) | null>(null);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [form, setForm] = useState(createInitialForm);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportMovements, setReportMovements] = useState<Array<EntityWithId<FinancialMovementDocument>>>([]);
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategoryOption[]>(() => getFallbackIncomeCategories());
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryOption[]>(() => getFallbackExpenseCategories());
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedMovement, setSelectedMovement] = useState<EntityWithId<FinancialMovementDocument> | null>(null);
  const [movementReloadToken, setMovementReloadToken] = useState(0);

  const selectedIncludes = useMemo(
    () => REPORT_INCLUDE_OPTIONS.filter((option) => form.includes[option.value]).map((option) => option.value),
    [form.includes],
  );
  const generatedReports = reports.filter((report) => report.status === 'generated');
  const failedReports = reports.filter((report) => report.status === 'failed');
  const reportNetTotalMinor = generatedReports.reduce((total, report) => total + report.summary.netTotalMinor, 0);
  const reportMovementCount = generatedReports.reduce((total, report) => total + report.summary.movementCount, 0);

  const load = async () => {
    try {
      const nextReports = await listReportHistory();
      setReports(nextReports);
      if (reportId) {
        setSelectedReport(await getReportHistoryItem(reportId));
      }
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar el historial persistido.' });
    }
  };

  useEffect(() => {
    void load();
  }, [reportId]);

  useEffect(() => {
    if (!selectedReport) {
      return;
    }

    let cancelled = false;
    const loadReportMovements = async () => {
      const periods = selectedReport.scope === 'period' && selectedReport.period
        ? [normalizeAccountingPeriod(selectedReport.period)]
        : getDateRangePeriods(selectedReport.dateFrom ?? '', selectedReport.dateTo ?? '');
      const movementsRepository = createFinancialMovementsRepository();
      const [
        nextMovementsByPeriod,
        nextIncomeCategories,
        nextExpenseCategories,
        nextPaymentMethods,
      ] = await Promise.all([
        Promise.all(periods.map((period) => movementsRepository.listByAccountingPeriod(period))),
        createFinancialIncomeCategoriesRepository().listActiveSorted().catch(() => getFallbackIncomeCategories()),
        createFinancialExpenseCategoriesRepository().listActiveSorted().catch(() => getFallbackExpenseCategories()),
        createPaymentMethodsRepository().listActiveSorted().catch(() => []),
      ]);
      if (cancelled) {
        return;
      }
      const flattenedMovements = nextMovementsByPeriod.flat();
      const filteredMovements = selectedReport.scope === 'date_range'
        ? flattenedMovements.filter((movement) => {
            const dateKey = getMovementDateKey(movement);
            return Boolean(dateKey)
              && (!selectedReport.dateFrom || dateKey >= selectedReport.dateFrom)
              && (!selectedReport.dateTo || dateKey <= selectedReport.dateTo);
          })
        : flattenedMovements;
      setReportMovements(filteredMovements);
      setIncomeCategories(nextIncomeCategories.length ? nextIncomeCategories : getFallbackIncomeCategories());
      setExpenseCategories(nextExpenseCategories.length ? nextExpenseCategories : getFallbackExpenseCategories());
      setPaymentMethods(nextPaymentMethods);
    };

    void loadReportMovements().catch((error) => {
      if (!cancelled) {
        setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar los movimientos detallados del reporte.' });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [movementReloadToken, selectedReport]);

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setNotice({ kind: 'error', message: 'Ingresa un nombre para el reporte.' });
      return;
    }
    if (selectedIncludes.length === 0) {
      setNotice({ kind: 'error', message: 'Selecciona al menos un contenido.' });
      return;
    }
    if (form.scope === 'date_range' && (!form.dateFrom || !form.dateTo || form.dateFrom > form.dateTo)) {
      setNotice({ kind: 'error', message: 'Revisa el rango de fechas.' });
      return;
    }

    setIsGenerating(true);
    setNotice(null);
    try {
      const id = await generateReport({
        title: form.title.trim(),
        scope: form.scope,
        period: normalizeAccountingPeriod(form.period),
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
        includes: selectedIncludes,
        notes: form.notes,
        generatedBy: user?.id ?? 'unknown',
        generatedByRole: interfaceMode,
      });
      setNotice({ kind: 'success', message: `Reporte ${id} generado y persistido en Firestore.` });
      setForm(createInitialForm());
      await load();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos generar el reporte.' });
    } finally {
      setIsGenerating(false);
    }
  };

  if (reportId) {
    if (!selectedReport) {
      return (
        <div className="accounting-shell accounting-reports-page">
          <AccountingEmptyState title="Reporte no encontrado">
            <UiActionButton to="/accounting/reports" variant="secondary">Volver</UiActionButton>
          </AccountingEmptyState>
        </div>
      );
    }

    return (
      <div className="accounting-shell accounting-reports-page accounting-report-detail-page">
        <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <h1>{selectedReport.title}</h1>
          </div>
          <div className="accounting-hero__actions">
            <UiActionButton to="/accounting/reports" variant="secondary">Volver</UiActionButton>
          </div>
        </section>
        <AccountingInlineNotice notice={notice} />
        <section className="summary-grid accounting-summary-grid accounting-reports-summary" aria-label="Resumen del reporte">
          <article className="summary-card"><span>Ingresos</span><strong>{formatCurrency(selectedReport.summary.incomeTotalMinor)}</strong><small>Incluidos</small></article>
          <article className="summary-card"><span>Egresos</span><strong>{formatCurrency(selectedReport.summary.expenseTotalMinor)}</strong><small>Incluidos</small></article>
          <article className="summary-card"><span>Neto</span><strong>{formatCurrency(selectedReport.summary.netTotalMinor)}</strong><small>Resultado</small></article>
          <article className="summary-card"><span>Movimientos</span><strong>{selectedReport.summary.movementCount}</strong><small>Registros</small></article>
        </section>
        <div className="accounting-report-detail-movements">
          <AccountingMovementsPanel
            movements={reportMovements}
            incomeCategories={incomeCategories}
            expenseCategories={expenseCategories}
            paymentMethods={paymentMethods}
            period={selectedReport.period ?? undefined}
            title="Movimientos detallados"
            onSelectMovement={setSelectedMovement}
            onMovementChanged={() => setMovementReloadToken((current) => current + 1)}
          />
        </div>
        {selectedMovement && (
          <AccountingMovementDetailModal
            movement={selectedMovement}
            members={[]}
            employees={[]}
            paymentMethods={paymentMethods}
            onSelectMovement={setSelectedMovement}
            onChanged={() => setMovementReloadToken((current) => current + 1)}
            onClose={() => setSelectedMovement(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="accounting-shell accounting-reports-page">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <h1>Reportes</h1>
        </div>
      </section>
      <AccountingInlineNotice notice={notice} />

      <section className="summary-grid accounting-summary-grid accounting-reports-summary" aria-label="Resumen de reportes">
        <article className="summary-card"><span>Reportes</span><strong>{reports.length}</strong><small>Historial institucional</small></article>
        <article className="summary-card"><span>Generados</span><strong>{generatedReports.length}</strong><small>{failedReports.length} fallidos</small></article>
        <article className="summary-card"><span>Neto acumulado</span><strong>{formatCurrency(reportNetTotalMinor)}</strong><small>Reportes generados</small></article>
        <article className="summary-card"><span>Movimientos</span><strong>{reportMovementCount}</strong><small>Incluidos</small></article>
        <article className="summary-card"><span>Persistencia</span><strong>Firestore</strong><small>Metadata guardada</small></article>
      </section>

      <div className="accounting-reports-sections">
        <AccountingCollapsibleSections
          sections={[
            {
              id: 'generate',
              title: 'Generar reporte',
              eyebrow: 'Generar',
              helper: 'Periodo o rango',
              content: (
                <div className="accounting-full-width-section accounting-reports-generate-section">
                  <form className="accounting-entry-form accounting-reports-form" onSubmit={handleGenerate}>
                    <label className="form-field"><span>Nombre</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
                    <label className="form-field">
                      <span>Tipo de fecha</span>
                      <select value={form.scope} onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value as ReportScope }))}>
                        <option value="period">Periodo mensual</option>
                        <option value="date_range">Rango de fechas</option>
                      </select>
                    </label>
                    {form.scope === 'period' ? (
                      <AccountingMonthPicker
                        period={normalizeAccountingPeriod(form.period)}
                        onChange={(nextPeriod) => setForm((current) => ({ ...current, period: nextPeriod }))}
                      />
                    ) : (
                      <>
                        <label className="form-field"><span>Desde</span><input type="date" value={form.dateFrom} onChange={(event) => setForm((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
                        <label className="form-field"><span>Hasta</span><input type="date" value={form.dateTo} onChange={(event) => setForm((current) => ({ ...current, dateTo: event.target.value }))} /></label>
                      </>
                    )}
                    <fieldset className="accounting-report-fieldset">
                      <legend>Contenido</legend>
                      {REPORT_INCLUDE_OPTIONS.map((option) => (
                        <label key={option.value} className="check-field">
                          <input type="checkbox" checked={form.includes[option.value]} disabled={option.value === 'salaries' && !canAccessSensitiveAccounting} onChange={(event) => setForm((current) => ({ ...current, includes: { ...current.includes, [option.value]: event.target.checked } }))} />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </fieldset>
                    <label className="form-field"><span>Notas</span><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                    <div className="form-actions form-actions--right"><UiActionButton type="submit" disabled={isGenerating}>{isGenerating ? 'Generando...' : 'Generar reporte'}</UiActionButton></div>
                  </form>
                </div>
              ),
            },
            {
              id: 'history',
              title: 'Historial institucional',
              eyebrow: 'Historial',
              helper: `${reports.length} reportes - Firestore`,
              content: (
                <div className="accounting-full-width-section accounting-reports-history-section">
                  <div className="accounting-list accounting-reports-list">
                    {reports.map((report) => (
                      <Link key={report.id} className="accounting-row accounting-row--actions accounting-report-history-row" to={`/accounting/reports/${report.id}`}>
                        <span className="accounting-row__main"><strong>{report.title}</strong><small>{getReportRangeLabel(report)}</small></span>
                        <span className="accounting-row__meta"><small>Estado</small><span className={`status-chip status-chip--${report.status}`}>{getReportStatusLabel(report.status)}</span></span>
                        <span className="accounting-row__meta"><small>Neto</small><strong>{formatCurrency(report.summary.netTotalMinor)}</strong></span>
                        <span className="accounting-row__meta"><small>Generado</small><strong>{formatTimestamp(report.generatedAt)}</strong></span>
                        <span className="accounting-report-row__action">Ver detalle</span>
                      </Link>
                    ))}
                    {reports.length === 0 && <AccountingEmptyState title="Sin reportes persistidos" />}
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
