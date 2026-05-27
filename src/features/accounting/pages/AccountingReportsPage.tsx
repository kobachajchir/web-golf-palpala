import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import { generateReport, getReportHistoryItem, listReportHistory } from '../api/accountingApi';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import type { AccountingNotice, AccountingReportHistoryDocument, ReportInclude, ReportScope } from '../types/accounting';
import { formatCurrency, formatPeriod, formatTimestamp, getCurrentAccountingPeriod, normalizeAccountingPeriod } from '../utils/accountingFormatters';

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
    : `${report.dateFrom ?? 'sin fecha'} al ${report.dateTo ?? 'sin fecha'}`;
}

export function AccountingReportsPage() {
  const { reportId } = useParams();
  const { interfaceMode, user } = useAuth();
  const isDirectivo = interfaceMode === ROLES.DIRECTIVO;
  const [reports, setReports] = useState<Array<AccountingReportHistoryDocument & { id: string }>>([]);
  const [selectedReport, setSelectedReport] = useState<(AccountingReportHistoryDocument & { id: string }) | null>(null);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [form, setForm] = useState(createInitialForm);
  const [isGenerating, setIsGenerating] = useState(false);

  const selectedIncludes = useMemo(
    () => REPORT_INCLUDE_OPTIONS.filter((option) => form.includes[option.value]).map((option) => option.value),
    [form.includes],
  );

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
      return <AccountingEmptyState title="Reporte no encontrado"><Link className="btn-secondary" to="/accounting/reports">Volver</Link></AccountingEmptyState>;
    }

    return (
      <div className="accounting-shell">
        <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <p className="eyebrow">Detalle de reporte</p>
            <h1>{selectedReport.title}</h1>
            <p>{getReportRangeLabel(selectedReport)} - generado {formatTimestamp(selectedReport.generatedAt)}</p>
          </div>
          <div className="accounting-hero__actions"><Link className="btn-secondary" to="/accounting/reports">Volver</Link></div>
        </section>
        <section className="summary-grid accounting-summary-grid">
          <article className="summary-card"><span>Ingresos</span><strong>{formatCurrency(selectedReport.summary.incomeTotalMinor)}</strong><small>Incluidos</small></article>
          <article className="summary-card"><span>Egresos</span><strong>{formatCurrency(selectedReport.summary.expenseTotalMinor)}</strong><small>Incluidos</small></article>
          <article className="summary-card"><span>Neto</span><strong>{formatCurrency(selectedReport.summary.netTotalMinor)}</strong><small>Resultado</small></article>
          <article className="summary-card"><span>Movimientos</span><strong>{selectedReport.summary.movementCount}</strong><small>Registros</small></article>
        </section>
      </div>
    );
  }

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Reportes</p>
          <h1>Historial institucional</h1>
          <p>Los reportes se guardan en Firestore como metadata persistida, no solo en localStorage.</p>
        </div>
      </section>
      <AccountingInlineNotice notice={notice} />

      <AccountingCollapsibleSections
        initialOpenId="generate"
        sections={[
          {
            id: 'generate',
            title: 'Generar nuevo reporte',
            eyebrow: 'Generar',
            helper: 'Filtros, contenido y persistencia',
            content: (
              <form className="accounting-entry-form" onSubmit={handleGenerate}>
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
                      <input type="checkbox" checked={form.includes[option.value]} disabled={option.value === 'salaries' && !isDirectivo} onChange={(event) => setForm((current) => ({ ...current, includes: { ...current.includes, [option.value]: event.target.checked } }))} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="form-field"><span>Notas</span><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                <div className="form-actions"><UiActionButton type="submit" disabled={isGenerating}>{isGenerating ? 'Generando...' : 'Generar reporte'}</UiActionButton></div>
              </form>
            ),
          },
          {
            id: 'history',
            title: 'Historial de reportes',
            eyebrow: 'Historial',
            helper: `${reports.length} reportes persistidos`,
            content: (
              <div className="accounting-list">
                {reports.map((report) => (
                  <Link key={report.id} className="accounting-row accounting-row--actions" to={`/accounting/reports/${report.id}`}>
                    <span className="accounting-row__main"><strong>{report.title}</strong><small>{getReportRangeLabel(report)} - {report.status}</small></span>
                    <span className="accounting-row__meta"><strong>{formatCurrency(report.summary.netTotalMinor)}</strong><small>{formatTimestamp(report.generatedAt)}</small></span>
                  </Link>
                ))}
                {reports.length === 0 && <AccountingEmptyState title="Sin reportes persistidos" />}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
