import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import type {
  AccountingPeriod,
  EntityWithId,
  FinancialMovementDocument,
  MemberFeeChargeDocument,
  SalaryPaymentDocument,
} from '../modules/accounting/domain/models';
import {
  createFinancialMovementsRepository,
  createMemberFeeChargesRepository,
  createSalaryPaymentsRepository,
} from '../modules/accounting/infrastructure/firestore/repositories';
import {
  formatCurrency,
  formatPeriod,
  getCurrentAccountingPeriod,
  getSignedMovementAmount,
  normalizeAccountingPeriod,
  timestampToDate,
} from './accountingPageUtils';

type ReportInclude = 'movements' | 'cash_flow' | 'payment_methods' | 'categories' | 'fees' | 'salaries';
type ReportScope = 'period' | 'date_range';

type StoredAccountingReport = {
  id: string;
  title: string;
  scope: ReportScope;
  period?: AccountingPeriod;
  dateFrom?: string;
  dateTo?: string;
  includes: ReportInclude[];
  notes?: string;
  createdAt: string;
  createdByRole: string;
  summary: {
    incomeTotalMinor: number;
    expenseTotalMinor: number;
    netTotalMinor: number;
    movementCount: number;
    feePendingMinor: number;
    salaryTotalMinor: number;
  };
};

type ReportFormState = {
  title: string;
  scope: ReportScope;
  period: AccountingPeriod;
  dateFrom: string;
  dateTo: string;
  includes: Record<ReportInclude, boolean>;
  notes: string;
};

const REPORT_STORAGE_KEY = 'webGolfPalpala.accountingReports';
const REPORT_INCLUDE_OPTIONS: Array<{ value: ReportInclude; label: string }> = [
  { value: 'movements', label: 'Movimientos' },
  { value: 'cash_flow', label: 'Flujo de caja' },
  { value: 'payment_methods', label: 'Medios de pago' },
  { value: 'categories', label: 'Categorías' },
  { value: 'fees', label: 'Cuotas' },
  { value: 'salaries', label: 'Sueldos' },
];

function createEmptyReportForm(): ReportFormState {
  const today = new Date().toISOString().slice(0, 10);

  return {
    title: '',
    scope: 'period',
    period: getCurrentAccountingPeriod(),
    dateFrom: today.slice(0, 8) + '01',
    dateTo: today,
    includes: {
      movements: true,
      cash_flow: true,
      payment_methods: true,
      categories: true,
      fees: false,
      salaries: false,
    },
    notes: '',
  };
}

function loadStoredReports(): StoredAccountingReport[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(REPORT_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as StoredAccountingReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredReports(reports: StoredAccountingReport[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(reports));
}

function createReportId() {
  return globalThis.crypto?.randomUUID?.() ?? `report-${Date.now()}`;
}

function getReportRangeLabel(report: StoredAccountingReport) {
  if (report.scope === 'period') {
    return report.period ? formatPeriod(report.period) : 'Sin periodo';
  }

  return `${report.dateFrom ?? 'sin fecha'} al ${report.dateTo ?? 'sin fecha'}`;
}

function formatReportDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(value));
}

function enumeratePeriods(from: string, to: string): AccountingPeriod[] {
  const start = new Date(`${from}T00:00:00.000-03:00`);
  const end = new Date(`${to}T00:00:00.000-03:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const periods: AccountingPeriod[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endCursor = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= endCursor) {
    periods.push(normalizeAccountingPeriod(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return periods;
}

function isMovementInsideRange(movement: EntityWithId<FinancialMovementDocument>, from: string, to: string) {
  const date = timestampToDate(movement.operationDate);
  if (!date) {
    return false;
  }

  const fromDate = new Date(`${from}T00:00:00.000-03:00`);
  const toDate = new Date(`${to}T23:59:59.999-03:00`);
  return date >= fromDate && date <= toDate;
}

function summarizeReportData({
  movements,
  feeCharges,
  salaryPayments,
}: {
  movements: Array<EntityWithId<FinancialMovementDocument>>;
  feeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
  salaryPayments: Array<EntityWithId<SalaryPaymentDocument>>;
}): StoredAccountingReport['summary'] {
  const visibleMovements = movements.filter((movement) => movement.status !== 'voided');
  const incomeTotalMinor = visibleMovements
    .filter((movement) => movement.movementType === 'income')
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
  const expenseTotalMinor = visibleMovements
    .filter((movement) => movement.movementType === 'expense')
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
  const feePendingMinor = feeCharges
    .filter((charge) => charge.status === 'pending' || charge.status === 'overdue')
    .reduce((total, charge) => total + charge.finalAmountMinor, 0);
  const salaryTotalMinor = salaryPayments.reduce((total, payment) => total + payment.salaryGrossMinor, 0);

  return {
    incomeTotalMinor,
    expenseTotalMinor,
    netTotalMinor: visibleMovements.reduce((total, movement) => total + getSignedMovementAmount(movement), 0),
    movementCount: visibleMovements.length,
    feePendingMinor,
    salaryTotalMinor,
  };
}

function SummaryCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

export function AccountingReports() {
  const { interfaceMode } = useAuth();
  const canUseReports = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;
  const isDirectivo = interfaceMode === ROLES.DIRECTIVO;
  const [reports, setReports] = useState<StoredAccountingReport[]>(() => loadStoredReports());
  const [form, setForm] = useState<ReportFormState>(() => createEmptyReportForm());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    saveStoredReports(reports);
  }, [reports]);

  const sortedReports = useMemo(
    () => [...reports].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [reports],
  );

  const selectedIncludes = useMemo(
    () => REPORT_INCLUDE_OPTIONS.filter((option) => form.includes[option.value]).map((option) => option.value),
    [form.includes],
  );

  const handleScopeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setForm((current) => ({ ...current, scope: event.target.value as ReportScope }));
  };

  const handleIncludeChange = (include: ReportInclude, checked: boolean) => {
    setForm((current) => ({
      ...current,
      includes: {
        ...current.includes,
        [include]: checked,
      },
    }));
  };

  const handleGenerateReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);

    if (!form.title.trim()) {
      setNotice({ kind: 'error', message: 'Ingresá un nombre para el reporte.' });
      return;
    }

    if (selectedIncludes.length === 0) {
      setNotice({ kind: 'error', message: 'Seleccioná al menos un contenido para incluir.' });
      return;
    }

    if (form.scope === 'date_range' && (!form.dateFrom || !form.dateTo || form.dateFrom > form.dateTo)) {
      setNotice({ kind: 'error', message: 'Revisá el rango de fechas del reporte.' });
      return;
    }

    setIsGenerating(true);

    try {
      const periods =
        form.scope === 'period'
          ? [form.period]
          : enumeratePeriods(form.dateFrom, form.dateTo);
      const movementsRepository = createFinancialMovementsRepository();
      const feeChargesRepository = createMemberFeeChargesRepository();
      const salaryPaymentsRepository = createSalaryPaymentsRepository();
      const [movementGroups, feeGroups, salaryGroups] = await Promise.all([
        Promise.all(periods.map((period) => movementsRepository.listByAccountingPeriod(period))),
        form.includes.fees ? Promise.all(periods.map((period) => feeChargesRepository.listByPeriod(period))) : Promise.resolve([]),
        form.includes.salaries && isDirectivo
          ? Promise.all(periods.map((period) => salaryPaymentsRepository.listByPeriod(period)))
          : Promise.resolve([]),
      ]);
      const movements = movementGroups.flat().filter((movement) =>
        form.scope === 'period' ? true : isMovementInsideRange(movement, form.dateFrom, form.dateTo),
      );
      const generatedReport: StoredAccountingReport = {
        id: createReportId(),
        title: form.title.trim(),
        scope: form.scope,
        ...(form.scope === 'period'
          ? { period: form.period }
          : { dateFrom: form.dateFrom, dateTo: form.dateTo }),
        includes: selectedIncludes,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        createdAt: new Date().toISOString(),
        createdByRole: interfaceMode,
        summary: summarizeReportData({
          movements,
          feeCharges: feeGroups.flat(),
          salaryPayments: salaryGroups.flat(),
        }),
      };

      setReports((current) => [generatedReport, ...current]);
      setForm(createEmptyReportForm());
      setIsModalOpen(false);
      setNotice({ kind: 'success', message: 'Reporte generado correctamente.' });
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos generar el reporte.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (!canUseReports) {
    return <div className="empty-state">Los reportes contables estan disponibles para administracion y Comité Ejecutivo.</div>;
  }

  return (
    <div className="page-container accounting-page">
      <div className="accounting-shell">
        <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <p className="eyebrow">Reportes</p>
            <h1>Reportes contables</h1>
            <p>Generá reportes por período o rango de fechas y consultá el historial generado.</p>
          </div>
          <div className="accounting-hero__actions">
            <Link className="ui-action-button ui-action-button--secondary" to="/accounting">
              Volver a contabilidad
            </Link>
            <button type="button" className="ui-action-button ui-action-button--positive" onClick={() => setIsModalOpen(true)}>
              Generar reporte
            </button>
          </div>
        </section>

        {notice && <div className={notice.kind === 'error' ? 'error-message' : 'accounting-success'}>{notice.message}</div>}

        <section className="floating-card accounting-primary-panel">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Historial</p>
              <h2>Reportes generados</h2>
            </div>
          </div>

          <div className="accounting-list">
            {sortedReports.map((report) => (
              <Link key={report.id} className="accounting-row accounting-report-row" to={`/accounting/reports/${report.id}`}>
                <div className="accounting-row__main">
                  <strong>{report.title}</strong>
                  <small>
                    {getReportRangeLabel(report)} · {report.includes.map((include) => include.replaceAll('_', ' ')).join(', ')}
                  </small>
                </div>
                <div className="accounting-row__meta">
                  <strong>{formatCurrency(report.summary.netTotalMinor)}</strong>
                  <small>{formatReportDate(report.createdAt)}</small>
                </div>
              </Link>
            ))}

            {sortedReports.length === 0 && (
              <div className="empty-state empty-state--inline">Todavia no hay reportes generados.</div>
            )}
          </div>
        </section>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setIsModalOpen(false)}>
          <section className="floating-card accounting-entry-modal" role="dialog" aria-modal="true" aria-label="Generar reporte" onClick={(event) => event.stopPropagation()}>
            <div className="info-dialog-card__header">
              <div>
                <p className="eyebrow">Reportes</p>
                <h2>Generar reporte</h2>
              </div>
              <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={() => setIsModalOpen(false)}>
                ×
              </button>
            </div>

            <form className="accounting-entry-form" onSubmit={handleGenerateReport}>
              <label className="form-field">
                <span>Nombre del reporte</span>
                <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </label>

              <label className="form-field">
                <span>Tipo de fecha</span>
                <select value={form.scope} onChange={handleScopeChange}>
                  <option value="period">Periodo mensual</option>
                  <option value="date_range">Rango de fechas</option>
                </select>
              </label>

              {form.scope === 'period' ? (
                <label className="form-field">
                  <span>Periodo</span>
                  <input
                    type="month"
                    value={form.period}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, period: normalizeAccountingPeriod(event.target.value) }))
                    }
                  />
                </label>
              ) : (
                <>
                  <label className="form-field">
                    <span>Desde</span>
                    <input
                      type="date"
                      value={form.dateFrom}
                      onChange={(event) => setForm((current) => ({ ...current, dateFrom: event.target.value }))}
                    />
                  </label>
                  <label className="form-field">
                    <span>Hasta</span>
                    <input
                      type="date"
                      value={form.dateTo}
                      onChange={(event) => setForm((current) => ({ ...current, dateTo: event.target.value }))}
                    />
                  </label>
                </>
              )}

              <fieldset className="accounting-report-fieldset">
                <legend>Qué incluye</legend>
                {REPORT_INCLUDE_OPTIONS.map((option) => (
                  <label key={option.value} className="check-field">
                    <input
                      type="checkbox"
                      checked={form.includes[option.value]}
                      disabled={option.value === 'salaries' && !isDirectivo}
                      onChange={(event) => handleIncludeChange(option.value, event.target.checked)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>

              <label className="form-field">
                <span>Notas</span>
                <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>

              <div className="form-actions">
                <button type="button" className="ui-action-button ui-action-button--danger" disabled={isGenerating} onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="ui-action-button ui-action-button--positive" disabled={isGenerating}>
                  {isGenerating ? 'Generando...' : 'Generar reporte'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export function AccountingReportDetail() {
  const { interfaceMode } = useAuth();
  const { reportId } = useParams();
  const report = useMemo(
    () => loadStoredReports().find((entry) => entry.id === reportId) ?? null,
    [reportId],
  );
  const canUseReports = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;

  if (!canUseReports) {
    return <div className="empty-state">Los reportes contables estan disponibles para administracion y Comité Ejecutivo.</div>;
  }

  if (!report) {
    return (
      <div className="empty-state">
        <div>
          <strong>Reporte no encontrado</strong>
          <Link className="ui-action-button ui-action-button--secondary" to="/accounting/reports">
            Volver a reportes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container accounting-page">
      <div className="accounting-shell">
        <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <p className="eyebrow">Detalle de reporte</p>
            <h1>{report.title}</h1>
            <p>
              {getReportRangeLabel(report)} · generado el {formatReportDate(report.createdAt)}
            </p>
          </div>
          <div className="accounting-hero__actions">
            <Link className="ui-action-button ui-action-button--secondary" to="/accounting/reports">
              Volver a reportes
            </Link>
          </div>
        </section>

        <section className="floating-card accounting-primary-panel">
          <div className="summary-grid accounting-summary-grid">
            <SummaryCard label="Ingresos" value={formatCurrency(report.summary.incomeTotalMinor)} helper="Entradas incluidas" />
            <SummaryCard label="Egresos" value={formatCurrency(report.summary.expenseTotalMinor)} helper="Salidas incluidas" />
            <SummaryCard label="Caja neta" value={formatCurrency(report.summary.netTotalMinor)} helper="Resultado del reporte" />
            <SummaryCard label="Movimientos" value={String(report.summary.movementCount)} helper="Registros considerados" />
            <SummaryCard label="Cuotas pendientes" value={formatCurrency(report.summary.feePendingMinor)} helper="Si se incluyeron cuotas" />
            <SummaryCard label="Sueldos" value={formatCurrency(report.summary.salaryTotalMinor)} helper="Visible para Comité Ejecutivo" />
          </div>
        </section>

        <section className="floating-card accounting-secondary-panel">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Contenido</p>
              <h2>Qué incluye este reporte</h2>
            </div>
          </div>

          <div className="accounting-topic-list">
            {report.includes.map((include) => (
              <span key={include}>{include.replaceAll('_', ' ')}</span>
            ))}
          </div>

          {report.notes && <p className="accounting-helper-copy">{report.notes}</p>}
        </section>
      </div>
    </div>
  );
}
