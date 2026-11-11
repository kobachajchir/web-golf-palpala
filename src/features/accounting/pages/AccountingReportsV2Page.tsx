import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import {
  createFinancialExpenseCategoriesRepository,
  createFinancialIncomeCategoriesRepository,
} from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { AccountingReportTemplate, FinancialMovementType } from '../../../modules/accounting/domain/models';
import { generateReport, getReportHistoryItem, listReportHistory } from '../api/accountingApi';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import type {
  AccountingNotice,
  AccountingReportDetailRow,
  AccountingReportHistoryDocument,
  ReportScope,
} from '../types/accounting';
import {
  formatCurrency,
  formatPeriod,
  formatTimestamp,
  getCurrentAccountingPeriod,
  normalizeAccountingPeriod,
} from '../utils/accountingFormatters';
import {
  getFallbackExpenseCategories,
  getFallbackIncomeCategories,
  type ExpenseCategoryOption,
  type IncomeCategoryOption,
} from '../utils/accountingCategories';

type ReportWithId = AccountingReportHistoryDocument & { id: string };
type CategoryChoice = {
  id: string;
  label: string;
  movementType: FinancialMovementType;
};

const TEMPLATE_OPTIONS: Array<{
  id: AccountingReportTemplate;
  title: string;
  helper: string;
}> = [
  { id: 'categories', title: 'Ingresos y egresos', helper: 'Elegi las categorias que queres comparar.' },
  { id: 'green_fee', title: 'Green fee', helper: 'Dias de semana, fines de semana y feriados.' },
  { id: 'member_dues', title: 'Cuotas societarias', helper: 'Cobrado, deuda del periodo y deuda acumulada.' },
  { id: 'custom', title: 'Reporte personalizado', helper: 'Combina categorias y cuotas en un mismo informe.' },
];

function initialForm() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    title: 'Ingresos y egresos por categoria',
    template: 'categories' as AccountingReportTemplate,
    scope: 'period' as ReportScope,
    period: getCurrentAccountingPeriod(),
    dateFrom: `${today.slice(0, 8)}01`,
    dateTo: today,
    movementTypes: { income: true, expense: true },
    categoryIds: [] as string[],
    includePaidDues: false,
    includeUnpaidPeriod: false,
    includeUnpaidAccumulated: false,
    notes: '',
  };
}

function templateTitle(template: AccountingReportTemplate) {
  switch (template) {
    case 'green_fee':
      return 'Green fee por tipo de dia';
    case 'member_dues':
      return 'Cuotas societarias';
    case 'custom':
      return 'Reporte contable personalizado';
    default:
      return 'Ingresos y egresos por categoria';
  }
}

function rangeLabel(report: AccountingReportHistoryDocument) {
  return report.scope === 'period' && report.period
    ? formatPeriod(report.period)
    : `${formatDate(report.dateFrom)} al ${formatDate(report.dateTo)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Sin fecha';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function reportStatus(status: AccountingReportHistoryDocument['status']) {
  if (status === 'generated') return 'Generado';
  if (status === 'generating') return 'Generando';
  return 'Fallido';
}

function detailSectionLabel(section: AccountingReportDetailRow['section']) {
  switch (section) {
    case 'green_fee':
      return 'Green fee';
    case 'dues_paid':
      return 'Cuotas cobradas';
    case 'dues_unpaid_period':
      return 'Impagas del periodo';
    case 'dues_unpaid_accumulated':
      return 'Deuda acumulada';
    default:
      return 'Movimientos';
  }
}

function rowAmount(row: AccountingReportDetailRow) {
  return row.outstandingAmountMinor > 0 ? row.outstandingAmountMinor : row.netAmountMinor;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buildPrintableReport(report: ReportWithId) {
  const sections = report.sections ?? [];
  const rows = report.detailRows ?? [];
  const sectionRows = sections.map((section) => `
    <tr>
      <td>${escapeHtml(section.label)}</td>
      <td>${section.count}</td>
      <td>${escapeHtml(formatCurrency(section.grossAmountMinor))}</td>
      <td>${escapeHtml(formatCurrency(section.commissionAmountMinor))}</td>
      <td>${escapeHtml(formatCurrency(section.outstandingAmountMinor || section.netAmountMinor))}</td>
    </tr>`).join('');
  const detailRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.date ?? row.period ?? '')}</td>
      <td>${escapeHtml(detailSectionLabel(row.section))}</td>
      <td>${escapeHtml(row.groupLabel ?? row.categoryLabel ?? row.label)}</td>
      <td>${escapeHtml(row.memberName ?? row.paymentMethodLabel ?? '')}</td>
      <td>${escapeHtml(formatCurrency(rowAmount(row)))}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: Arial, sans-serif; color: #163b2a; margin: 0; }
  header { border-bottom: 4px solid #2f7654; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { margin: 0 0 6px; } p { margin: 4px 0; color: #52655b; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
  .card { border: 1px solid #d7e3dc; border-radius: 10px; padding: 12px; }
  .card span { display: block; color: #52655b; font-size: 12px; } .card strong { font-size: 18px; }
  h2 { margin-top: 24px; font-size: 17px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #eaf3ee; color: #163b2a; text-align: left; }
  th, td { border: 1px solid #d7e3dc; padding: 7px; }
</style></head><body>
<header><p>Club de Golf Palpala - Reporte contable</p><h1>${escapeHtml(report.title)}</h1>
<p>${escapeHtml(rangeLabel(report))} - Emitido ${escapeHtml(formatTimestamp(report.generatedAt))}</p></header>
<section class="summary">
<div class="card"><span>Ingresos</span><strong>${escapeHtml(formatCurrency(report.summary.incomeTotalMinor))}</strong></div>
${report.template === 'categories' || report.template === 'custom' ? `
<div class="card"><span>Egresos</span><strong>${escapeHtml(formatCurrency(report.summary.expenseTotalMinor))}</strong></div>
<div class="card"><span>Resultado neto</span><strong>${escapeHtml(formatCurrency(report.summary.netTotalMinor))}</strong></div>
` : ''}
<div class="card"><span>Registros</span><strong>${report.detailRowCount ?? rows.length}</strong></div>
</section>
<h2>Desglose</h2><table><thead><tr><th>Concepto</th><th>Cantidad</th><th>Bruto</th><th>Comisiones</th><th>Neto / saldo</th></tr></thead><tbody>${sectionRows}</tbody></table>
<h2>Detalle</h2><table><thead><tr><th>Fecha / periodo</th><th>Seccion</th><th>Concepto</th><th>Socio / medio</th><th>Monto</th></tr></thead><tbody>${detailRows}</tbody></table>
</body></html>`;
}

function printReport(report: ReportWithId) {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  iframe.contentDocument?.open();
  iframe.contentDocument?.write(buildPrintableReport(report));
  iframe.contentDocument?.close();
  iframe.contentWindow?.focus();
  window.setTimeout(() => {
    iframe.contentWindow?.print();
    window.setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  }, 250);
}

function xmlCell(value: unknown, type: 'String' | 'Number' = 'String') {
  const escaped = escapeHtml(value).replaceAll('&quot;', '&apos;');
  return `<Cell><Data ss:Type="${type}">${escaped}</Data></Cell>`;
}

function downloadExcel(report: ReportWithId) {
  const summaryRows = [
    ['Reporte', report.title],
    ['Periodo', rangeLabel(report)],
    ['Ingresos', report.summary.incomeTotalMinor / 100],
    ...(report.template === 'categories' || report.template === 'custom' ? [
      ['Egresos', report.summary.expenseTotalMinor / 100],
      ['Resultado neto', report.summary.netTotalMinor / 100],
    ] as const : []),
    ['Cuotas cobradas', (report.summary.paidDuesMinor ?? 0) / 100],
    ['Impagas del periodo', (report.summary.unpaidPeriodMinor ?? 0) / 100],
    ['Deuda acumulada', (report.summary.unpaidAccumulatedMinor ?? 0) / 100],
  ].map(([label, value]) => `<Row>${xmlCell(label)}${xmlCell(value, typeof value === 'number' ? 'Number' : 'String')}</Row>`).join('');

  const sectionRows = (report.sections ?? []).map((section) => `<Row>
    ${xmlCell(section.label)}${xmlCell(section.count, 'Number')}${xmlCell(section.grossAmountMinor / 100, 'Number')}
    ${xmlCell(section.commissionAmountMinor / 100, 'Number')}${xmlCell((section.outstandingAmountMinor || section.netAmountMinor) / 100, 'Number')}
  </Row>`).join('');

  const detailRows = (report.detailRows ?? []).map((row) => `<Row>
    ${xmlCell(row.date ?? row.period ?? '')}${xmlCell(detailSectionLabel(row.section))}
    ${xmlCell(row.groupLabel ?? row.categoryLabel ?? row.label)}${xmlCell(row.memberName ?? '')}
    ${xmlCell(row.paymentMethodLabel ?? '')}${xmlCell(rowAmount(row) / 100, 'Number')}
  </Row>`).join('');

  const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Resumen"><Table>${summaryRows}</Table></Worksheet>
<Worksheet ss:Name="Desgloses"><Table><Row>${xmlCell('Concepto')}${xmlCell('Cantidad')}${xmlCell('Bruto')}${xmlCell('Comisiones')}${xmlCell('Neto o saldo')}</Row>${sectionRows}</Table></Worksheet>
<Worksheet ss:Name="Detalle"><Table><Row>${xmlCell('Fecha o periodo')}${xmlCell('Seccion')}${xmlCell('Concepto')}${xmlCell('Socio')}${xmlCell('Medio')}${xmlCell('Monto')}</Row>${detailRows}</Table></Worksheet>
</Workbook>`;
  const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${report.title.toLowerCase().replace(/[^a-z0-9]+/gi, '-') || 'reporte'}.xls`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AccountingReportsV2Page() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportWithId[]>([]);
  const [selectedReport, setSelectedReport] = useState<ReportWithId | null>(null);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [form, setForm] = useState(initialForm);
  const [isGenerating, setIsGenerating] = useState(false);
  // El id se reutiliza solo para reintentar exactamente la misma solicitud.
  const reportRequestAttempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategoryOption[]>(getFallbackIncomeCategories);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryOption[]>(getFallbackExpenseCategories);
  const [expandedSection, setExpandedSection] = useState<string | null>(reportId ? 'detail' : 'generate');
  const [showCategories, setShowCategories] = useState(false);

  const load = async () => {
    const nextReports = await listReportHistory();
    setReports(nextReports);
    setSelectedReport(reportId ? await getReportHistoryItem(reportId) : null);
  };

  useEffect(() => {
    void load().catch((error) => {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar los reportes.' });
    });
  }, [reportId]);

  useEffect(() => {
    void Promise.all([
      createFinancialIncomeCategoriesRepository().listActiveSorted(),
      createFinancialExpenseCategoriesRepository().listActiveSorted(),
    ]).then(([income, expense]) => {
      setIncomeCategories(income.length ? income : getFallbackIncomeCategories());
      setExpenseCategories(expense.length ? expense : getFallbackExpenseCategories());
    }).catch(() => {
      setIncomeCategories(getFallbackIncomeCategories());
      setExpenseCategories(getFallbackExpenseCategories());
    });
  }, []);

  const selectTemplate = (template: AccountingReportTemplate) => {
    setForm((current) => ({
      ...current,
      template,
      title: templateTitle(template),
      categoryIds: [],
      movementTypes: { income: true, expense: template !== 'green_fee' && template !== 'member_dues' },
      includePaidDues: template === 'member_dues',
      includeUnpaidPeriod: template === 'member_dues',
      includeUnpaidAccumulated: template === 'member_dues',
    }));
  };

  const toggleCategory = (categoryId: string) => {
    setForm((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(categoryId)
        ? current.categoryIds.filter((entry) => entry !== categoryId)
        : [...current.categoryIds, categoryId],
    }));
  };

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setNotice({ kind: 'error', message: 'Ingresa un nombre para el reporte.' });
      return;
    }
    if (form.scope === 'date_range' && (!form.dateFrom || !form.dateTo || form.dateFrom > form.dateTo)) {
      setNotice({ kind: 'error', message: 'Revisa el rango de fechas.' });
      return;
    }
    setIsGenerating(true);
    setNotice(null);
    const reportRequest = {
        title: form.title.trim(),
        template: form.template,
        scope: form.scope,
        period: normalizeAccountingPeriod(form.period),
        dateFrom: form.scope === 'date_range' ? form.dateFrom : null,
        dateTo: form.scope === 'date_range' ? form.dateTo : null,
        movementTypes: (Object.entries(form.movementTypes)
          .filter(([, selected]) => selected)
          .map(([type]) => type)) as FinancialMovementType[],
        categoryIds: form.categoryIds,
        includePaidDues: form.includePaidDues,
        includeUnpaidPeriod: form.includeUnpaidPeriod,
        includeUnpaidAccumulated: form.includeUnpaidAccumulated,
        notes: form.notes.trim() || null,
      };
    const fingerprint = JSON.stringify(reportRequest);
    const requestId = reportRequestAttempt.current?.fingerprint === fingerprint
      ? reportRequestAttempt.current.requestId
      : crypto.randomUUID();
    reportRequestAttempt.current = { fingerprint, requestId };
    try {
      await generateReport({ requestId, ...reportRequest });
      reportRequestAttempt.current = null;
      setNotice({ kind: 'success', message: 'Reporte generado exitosamente.' });
      setExpandedSection('history');
      void load();
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
            <UiActionButton to="/accounting/reports" variant="secondary">Volver a reportes</UiActionButton>
          </AccountingEmptyState>
        </div>
      );
    }
    if (selectedReport.status === 'generating') {
      return (
        <div className="accounting-shell accounting-reports-page">
          <AccountingEmptyState title="Generando reporte">
            <p style={{ marginTop: '0.5rem', color: 'var(--muted)' }}>Por favor, aguarda unos instantes y recarga la pagina.</p>
            <UiActionButton to="/accounting/reports" variant="secondary">Volver a reportes</UiActionButton>
          </AccountingEmptyState>
        </div>
      );
    }
    if (selectedReport.status === 'failed') {
      return (
        <div className="accounting-shell accounting-reports-page">
          <AccountingEmptyState title="Reporte fallido">
            <p style={{ marginTop: '0.5rem', color: 'var(--error)' }}>{selectedReport.errorMessage ?? 'Ocurrio un error al generar este reporte.'}</p>
            <UiActionButton to="/accounting/reports" variant="secondary">Volver a reportes</UiActionButton>
          </AccountingEmptyState>
        </div>
      );
    }
    const rows = selectedReport.detailRows ?? [];
    return (
      <div className="accounting-shell accounting-reports-page accounting-report-detail-page">
        <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <p className="eyebrow">Reporte emitido - {rangeLabel(selectedReport)}</p>
            <h1>{selectedReport.title}</h1>
            <p>Fotografia contable al {formatTimestamp(selectedReport.sourceCutoffAt ?? selectedReport.generatedAt)}</p>
          </div>
          <div className="accounting-hero__actions">
            <UiActionButton to="/accounting/reports" variant="secondary">Volver</UiActionButton>
            {selectedReport.schemaVersion === 2 && (
              <>
                <UiActionButton variant="secondary" onClick={() => printReport(selectedReport)}>Imprimir / PDF</UiActionButton>
                <UiActionButton onClick={() => downloadExcel(selectedReport)}>Descargar Excel</UiActionButton>
              </>
            )}
          </div>
        </section>
        <AccountingInlineNotice notice={notice} />
        {selectedReport.schemaVersion !== 2 && (
          <AccountingInlineNotice notice={{ kind: 'info', message: 'Este reporte pertenece al formato historico anterior. Conserva su resumen, pero no dispone de snapshot detallado ni exportaciones nuevas.' }} />
        )}
        <section className="summary-grid accounting-summary-grid accounting-reports-summary" aria-label="Resumen del reporte">
          <article className="summary-card"><span>Ingresos</span><strong>{formatCurrency(selectedReport.summary.incomeTotalMinor)}</strong><small>Monto neto</small></article>
          {(selectedReport.template === 'categories' || selectedReport.template === 'custom') && (
            <>
              <article className="summary-card"><span>Egresos</span><strong>{formatCurrency(selectedReport.summary.expenseTotalMinor)}</strong><small>Monto neto</small></article>
              <article className="summary-card"><span>Resultado</span><strong>{formatCurrency(selectedReport.summary.netTotalMinor)}</strong><small>Ingresos menos egresos</small></article>
            </>
          )}
          <article className="summary-card"><span>Registros</span><strong>{selectedReport.detailRowCount ?? selectedReport.summary.movementCount}</strong><small>Detalle congelado</small></article>
          {(selectedReport.summary.unpaidPeriodMinor ?? 0) > 0 && <article className="summary-card"><span>Impagas del periodo</span><strong>{formatCurrency(selectedReport.summary.unpaidPeriodMinor ?? 0)}</strong><small>Saldo pendiente</small></article>}
          {(selectedReport.summary.unpaidAccumulatedMinor ?? 0) > 0 && <article className="summary-card"><span>Deuda acumulada</span><strong>{formatCurrency(selectedReport.summary.unpaidAccumulatedMinor ?? 0)}</strong><small>Al cierre</small></article>}
        </section>

        <AccountingCollapsibleSections
          sections={[
            {
              id: 'breakdown',
              title: 'Desglose del reporte',
              eyebrow: 'Resumen',
              helper: `${selectedReport.sections?.length ?? 0} grupos`,
              content: selectedReport.sections?.length ? (
                <div className="accounting-table-wrap">
                  <table className="accounting-data-table">
                    <thead><tr><th>Concepto</th><th>Cantidad</th><th>Bruto</th><th>Comisiones</th><th>Neto / saldo</th></tr></thead>
                    <tbody>{selectedReport.sections.map((section) => (
                      <tr key={section.key}>
                        <td><strong>{section.label}</strong></td>
                        <td>{section.count}</td>
                        <td>{formatCurrency(section.grossAmountMinor)}</td>
                        <td>{formatCurrency(section.commissionAmountMinor)}</td>
                        <td><strong>{formatCurrency(section.outstandingAmountMinor || section.netAmountMinor)}</strong></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <AccountingEmptyState title="Sin desgloses guardados" />,
            },
            {
              id: 'detail',
              title: 'Detalle que compone los montos',
              eyebrow: 'Detalle',
              helper: `${rows.length} registros`,
              content: rows.length ? (
                <div className="accounting-table-wrap">
                  <table className="accounting-data-table">
                    <thead><tr><th>Fecha / periodo</th><th>Seccion</th><th>Concepto</th><th>Socio / referencia</th><th>Medio</th><th>Monto</th></tr></thead>
                    <tbody>{rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.date ? formatDate(row.date) : row.period ?? '-'}</td>
                        <td>{detailSectionLabel(row.section)}</td>
                        <td><strong>{row.groupLabel ?? row.categoryLabel ?? row.label}</strong><small>{row.groupLabel ? row.categoryLabel : row.label}</small></td>
                        <td>{row.memberName ?? '-'}</td>
                        <td>{row.paymentMethodLabel ?? '-'}</td>
                        <td><strong>{formatCurrency(rowAmount(row))}</strong></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <AccountingEmptyState title="Sin filas de detalle" />,
            },
          ]}
        />
      </div>
    );
  }

  const generatedReports = reports.filter((report) => report.status === 'generated');
  return (
    <div className="accounting-shell accounting-reports-page">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Contabilidad - Informacion institucional</p>
          <h1>Reportes</h1>
          <p>Emiti informes congelados, comparables y listos para presentar.</p>
        </div>
      </section>
      <AccountingInlineNotice notice={notice} />

      <section className="summary-grid accounting-summary-grid accounting-reports-summary" aria-label="Resumen de reportes">
        <article className="summary-card"><span>Historial</span><strong>{reports.length}</strong><small>Reportes institucionales</small></article>
        <article className="summary-card"><span>Generados</span><strong>{generatedReports.length}</strong><small>Disponibles para consulta</small></article>
        <article className="summary-card"><span>Formatos</span><strong>3</strong><small>Pantalla, PDF y Excel</small></article>
        <article className="summary-card"><span>Persistencia</span><strong>Snapshot</strong><small>Los emitidos no cambian</small></article>
      </section>

      <AccountingCollapsibleSections
        openId={expandedSection}
        onOpenChange={setExpandedSection}
        sections={[
          {
            id: 'generate',
            title: 'Emitir un reporte',
            eyebrow: 'Generador',
            helper: 'Plantillas y modo personalizado',
            content: (
              <form className="accounting-entry-form accounting-reports-form" onSubmit={handleGenerate}>
                <div className="form-field form-field--wide" style={{ gridColumn: '1 / -1' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                    {TEMPLATE_OPTIONS.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className={`summary-card ${form.template === template.id ? 'is-selected' : ''}`}
                        aria-pressed={form.template === template.id}
                        onClick={() => selectTemplate(template.id)}
                        style={{ padding: '12px', textAlign: 'left', minHeight: 'auto', border: form.template === template.id ? '2px solid var(--primary)' : '1px solid var(--border)' }}
                      >
                        <strong style={{ fontSize: '14px', display: 'block', marginBottom: '4px' }}>{template.title}</strong>
                        <small style={{ fontSize: '12px' }}>{template.helper}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <label className="form-field form-field--wide" style={{ gridColumn: '1 / -1' }}><span>Nombre del reporte</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
                <label className="form-field"><span>Tipo de fecha</span><select value={form.scope} onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value as ReportScope }))}><option value="period">Periodo mensual</option><option value="date_range">Rango de fechas</option></select></label>
                {form.scope === 'period' ? (
                  <AccountingMonthPicker period={normalizeAccountingPeriod(form.period)} onChange={(period) => setForm((current) => ({ ...current, period }))} />
                ) : (
                  <>
                    <label className="form-field"><span>Desde</span><input type="date" value={form.dateFrom} onChange={(event) => setForm((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
                    <label className="form-field"><span>Hasta</span><input type="date" value={form.dateTo} onChange={(event) => setForm((current) => ({ ...current, dateTo: event.target.value }))} /></label>
                  </>
                )}

                {(form.template === 'categories' || form.template === 'custom') && (
                  <>
                    <fieldset className="accounting-report-fieldset">
                      <legend>Movimientos</legend>
                      {(['income', 'expense'] as const).map((type) => (
                        <label className="check-field" key={type}><input type="checkbox" checked={form.movementTypes[type]} onChange={(event) => setForm((current) => ({ ...current, movementTypes: { ...current.movementTypes, [type]: event.target.checked } }))} /><span>{type === 'income' ? 'Ingresos' : 'Egresos'}</span></label>
                      ))}
                    </fieldset>
                    <fieldset className="accounting-report-fieldset form-field--wide">
                      <legend>Categorias a incluir</legend>
                      <p className="field-help" style={{ marginBottom: '1rem' }}>Si no marcas ninguna, se incluyen todas las categorias del tipo seleccionado.</p>
                      
                      <div style={{ marginBottom: '1rem' }}>
                        <UiActionButton type="button" variant="secondary" onClick={() => setShowCategories(!showCategories)}>
                          {showCategories ? 'Ocultar categorias' : 'Ver categorias'}
                        </UiActionButton>
                      </div>

                      {showCategories && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1rem', alignItems: 'start' }}>
                          {form.movementTypes.income && (
                            <div>
                              <h4 style={{ color: 'var(--positive)', marginBottom: '1rem', borderBottom: '2px solid var(--positive)', paddingBottom: '0.5rem' }}>Ingresos</h4>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {incomeCategories.map((c) => (
                                  <label className="check-field" key={`income:${c.id}`} style={{ borderLeft: '3px solid var(--positive)', paddingLeft: '12px' }}>
                                    <input type="checkbox" checked={form.categoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                                    <span>{c.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {form.movementTypes.expense && (
                            <div>
                              <h4 style={{ color: 'var(--error)', marginBottom: '1rem', borderBottom: '2px solid var(--error)', paddingBottom: '0.5rem' }}>Egresos</h4>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {expenseCategories.map((c) => (
                                  <label className="check-field" key={`expense:${c.id}`} style={{ borderLeft: '3px solid var(--error)', paddingLeft: '12px' }}>
                                    <input type="checkbox" checked={form.categoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                                    <span>{c.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </fieldset>
                  </>
                )}

                {(form.template === 'member_dues' || form.template === 'custom') && (
                  <fieldset className="accounting-report-fieldset form-field--wide">
                    <legend>Cuotas societarias</legend>
                    <label className="check-field"><input type="checkbox" checked={form.includePaidDues} onChange={(event) => setForm((current) => ({ ...current, includePaidDues: event.target.checked }))} /><span>Cobradas dentro del rango</span></label>
                    <label className="check-field"><input type="checkbox" checked={form.includeUnpaidPeriod} onChange={(event) => setForm((current) => ({ ...current, includeUnpaidPeriod: event.target.checked }))} /><span>Impagas del periodo elegido</span></label>
                    <label className="check-field"><input type="checkbox" checked={form.includeUnpaidAccumulated} onChange={(event) => setForm((current) => ({ ...current, includeUnpaidAccumulated: event.target.checked }))} /><span>Deuda acumulada al cierre</span></label>
                  </fieldset>
                )}

                {form.template === 'green_fee' && (
                  <div className="accounting-inline-notice accounting-inline-notice--info form-field--wide">
                    El desglose separara dias de semana, fines de semana y feriados nacionales. Si un feriado cae sabado o domingo, se contabiliza como feriado.
                  </div>
                )}

                <label className="form-field form-field--wide"><span>Notas institucionales</span><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                <div className="form-actions form-actions--right form-field--wide"><UiActionButton type="submit" disabled={isGenerating}>{isGenerating ? 'Generando snapshot...' : 'Emitir reporte'}</UiActionButton></div>
              </form>
            ),
          },
          {
            id: 'history',
            title: 'Historial institucional',
            eyebrow: 'Historial',
            helper: `${reports.length} reportes`,
            content: reports.length ? (
              <div className="accounting-list accounting-reports-list">
                {reports.map((report) => (
                  <Link key={report.id} className="accounting-row accounting-row--actions accounting-report-history-row" to={`/accounting/reports/${report.id}`}>
                    <span className="accounting-row__main"><strong>{report.title}</strong><small>{rangeLabel(report)}</small></span>
                    <span className="accounting-row__meta"><small>Estado</small><span className={`status-chip status-chip--${report.status}`}>{reportStatus(report.status)}</span></span>
                    <span className="accounting-row__meta"><small>{report.template === 'categories' || report.template === 'custom' ? 'Neto' : 'Ingresos'}</small><strong>{formatCurrency(report.summary?.[report.template === 'categories' || report.template === 'custom' ? 'netTotalMinor' : 'incomeTotalMinor'] ?? 0)}</strong></span>
                    <span className="accounting-row__meta"><small>Emitido</small><strong>{formatTimestamp(report.generatedAt)}</strong></span>
                    <span className="accounting-report-row__action">Ver reporte</span>
                  </Link>
                ))}
              </div>
            ) : <AccountingEmptyState title="Todavia no hay reportes emitidos" />,
          },
        ]}
      />
    </div>
  );
}
