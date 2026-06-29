import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createExpenseSubmissionsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { EntityWithId, ExpenseSubmissionDocument, SalaryPeriodicity } from '../../../modules/accounting/domain/models';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { DangerActionDialog } from '../components/DangerActionDialog';
import { useEmployeePeriod } from '../hooks/useEmployeePeriod';
import type { AccountingNotice } from '../types/accounting';
import { getCategoryLabel } from '../utils/accountingCategories';
import {
  buildArgentinaDateIso,
  formatCurrency,
  formatTimestamp,
  getCurrentAccountingPeriod,
  normalizeAccountingPeriod,
  parseAmountInputToMinor,
  timestampToDate,
} from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();

type ExpenseStatusFilter = 'all' | ExpenseSubmissionDocument['status'];

const EXPENSE_STATUS_OPTIONS: Array<{ value: ExpenseStatusFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'submitted', label: 'Pendientes' },
  { value: 'approved', label: 'Aprobadas' },
  { value: 'rejected', label: 'Rechazadas' },
  { value: 'posted', label: 'Posteadas' },
];

const SALARY_PERIODICITY_OPTIONS: Array<{ value: SalaryPeriodicity; label: string }> = [
  { value: 'monthly', label: 'Mensual' },
  { value: 'daily', label: 'Diario' },
  { value: 'hourly', label: 'Por hora' },
  { value: 'seasonal', label: 'Temporario' },
  { value: 'honorarios', label: 'Honorarios' },
];

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function AccountingEmployeeCyclePage() {
  const { employeeId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const queryPeriod = normalizeAccountingPeriod(searchParams.get('period') ?? getCurrentAccountingPeriod());
  const employeePeriod = useEmployeePeriod(employeeId, queryPeriod, 'summary');
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [payrollReason, setPayrollReason] = useState('');
  const [confirmPayrollOpen, setConfirmPayrollOpen] = useState(false);
  const [postingPayroll, setPostingPayroll] = useState(false);
  const [overtimeModalOpen, setOvertimeModalOpen] = useState(false);
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const [savingSalary, setSavingSalary] = useState(false);
  const [overtimeForm, setOvertimeForm] = useState({ workDate: todayInputValue(), hours: '', amount: '', reason: '' });
  const [salaryForm, setSalaryForm] = useState({
    baseAmount: '',
    periodicity: 'monthly' as SalaryPeriodicity,
    effectiveFrom: todayInputValue(),
    allowOvertime: true,
    notes: '',
  });
  const [expenseSubmissions, setExpenseSubmissions] = useState<Array<EntityWithId<ExpenseSubmissionDocument>>>([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseStatusFilter, setExpenseStatusFilter] = useState<ExpenseStatusFilter>('all');

  const state = employeePeriod.state;
  const employeeName = state?.employee ? `${state.employee.lastName}, ${state.employee.firstName}` : 'Empleado';
  const linkedReferenceIds = useMemo(() => state?.externalAssignments.map((link) => link.referenceId) ?? [], [state?.externalAssignments]);
  const salarySourceLabel = state?.payrollCycle
    ? 'Liquidacion posteada'
    : state?.salaryPayment
      ? 'Pago registrado'
      : state?.salaryConfiguration
        ? 'Configuracion activa en Firestore'
        : 'Sin sueldo configurado';
  const canGenerateSalaryPayment = Boolean(state?.salaryConfiguration || state?.salaryPayment || state?.payrollCycle);
  const grossSalaryMinor = (state?.summary.baseSalary ?? 0) + (state?.summary.overtimeTotal ?? 0);
  const expensesTotalMinor = expenseSubmissions.reduce((total, expense) => total + expense.amountMinor, 0);
  const approvedExpensesMinor = expenseSubmissions
    .filter((expense) => expense.status === 'approved' || expense.status === 'posted')
    .reduce((total, expense) => total + expense.amountMinor, 0);

  useEffect(() => {
    if (!state?.salaryConfiguration) {
      return;
    }

    const effectiveDate = timestampToDate(state.salaryConfiguration.effectiveFrom);
    setSalaryForm((current) => ({
      ...current,
      baseAmount: String(state.salaryConfiguration?.baseAmountMinor ? state.salaryConfiguration.baseAmountMinor / 100 : '').replace('.', ','),
      periodicity: state.salaryConfiguration?.periodicity ?? 'monthly',
      effectiveFrom: effectiveDate ? effectiveDate.toISOString().slice(0, 10) : todayInputValue(),
      allowOvertime: state.salaryConfiguration?.allowOvertime ?? true,
    }));
  }, [state?.salaryConfiguration]);

  useEffect(() => {
    if (!employeeId) {
      setExpensesLoading(false);
      return;
    }

    let cancelled = false;
    setExpensesLoading(true);
    createExpenseSubmissionsRepository().listRecent(150)
      .then((items) => {
        if (!cancelled) {
          setExpenseSubmissions(items.filter((expense) => expense.employeeId === employeeId));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar rendiciones del empleado.' });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setExpensesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const filteredExpenseSubmissions = useMemo(() => {
    const query = normalizeSearchText(expenseSearch);
    return expenseSubmissions.filter((expense) => {
      if (expenseStatusFilter !== 'all' && expense.status !== expenseStatusFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = normalizeSearchText([
        expense.description,
        expense.vendorName,
        getCategoryLabel(expense.categoryId),
        expense.categoryCodeSnapshot,
        expense.status,
      ].filter(Boolean).join(' '));

      return searchable.includes(query);
    });
  }, [expenseSearch, expenseStatusFilter, expenseSubmissions]);

  const handleCreateOvertime = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hours = Number(overtimeForm.hours.replace(',', '.'));
    const amountMinor = parseAmountInputToMinor(overtimeForm.amount);
    if (!employeeId || !Number.isFinite(hours) || hours <= 0 || !Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Revisa horas, monto y empleado.' });
      return;
    }

    try {
      await accountingCallables.createOvertimeEntry({
        employeeId,
        period: queryPeriod,
        workDate: buildArgentinaDateIso(overtimeForm.workDate),
        hours,
        amountMinor,
        reason: overtimeForm.reason.trim() || 'Horas extra',
      });
      setNotice({ kind: 'success', message: 'Hora extra cargada para revision.' });
      setOvertimeForm({ workDate: todayInputValue(), hours: '', amount: '', reason: '' });
      setOvertimeModalOpen(false);
      await employeePeriod.reload();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar la hora extra.' });
    }
  };

  const handleSaveSalary = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeId) {
      return;
    }

    const baseAmountMinor = parseAmountInputToMinor(salaryForm.baseAmount);
    if (!Number.isFinite(baseAmountMinor) || baseAmountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresa un sueldo valido para el empleado.' });
      return;
    }

    setSavingSalary(true);
    try {
      await accountingCallables.upsertSalaryConfiguration({
        employeeId,
        contractType: salaryForm.periodicity,
        baseAmountMinor,
        periodicity: salaryForm.periodicity,
        effectiveFrom: buildArgentinaDateIso(salaryForm.effectiveFrom),
        allowOvertime: salaryForm.allowOvertime,
        notes: salaryForm.notes.trim() || null,
      });
      setNotice({ kind: 'success', message: 'Sueldo del empleado actualizado.' });
      setSalaryModalOpen(false);
      await employeePeriod.reload();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos actualizar el sueldo.' });
    } finally {
      setSavingSalary(false);
    }
  };

  const postPayroll = async () => {
    if (!employeeId || !state) {
      return;
    }

    setPostingPayroll(true);
    try {
      const result = await accountingCallables.postEmployeePayrollCycle({
        employeeId,
        period: queryPeriod,
        linkedExternalReferenceIds: linkedReferenceIds,
        operationDate: buildArgentinaDateIso(todayInputValue()),
        notes: payrollReason.trim(),
      });
      setNotice({ kind: 'success', message: `Pago de sueldo generado con ${result.financialMovementIds.length} movimientos de caja.` });
      setConfirmPayrollOpen(false);
      setPayrollReason('');
      await employeePeriod.reload();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos postear la liquidacion.' });
    } finally {
      setPostingPayroll(false);
    }
  };

  if (employeePeriod.loading) {
    return <div className="loading-state loading-state--inline"><span className="loading-spinner" /><strong>Cargando ciclo mensual</strong></div>;
  }

  if (employeePeriod.error || !state) {
    return <div className="empty-state">{employeePeriod.error || 'No encontramos el ciclo solicitado.'}</div>;
  }

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero accounting-employee-cycle-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Ciclo mensual</p>
          <h1>{employeeName}</h1>
          <p>{state.employee?.position ?? 'Sin puesto'} - {state.employee?.contractType ?? 'Sin contrato'} - estado {state.summary.status}</p>
        </div>
        <div className="accounting-hero__actions">
          <Link className="ui-action-button ui-action-button--secondary" to="/accounting/employees">Volver a lista de empleados</Link>
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />

      <section className="floating-card accounting-panel accounting-centered-panel accounting-employee-cycle-summary">
        <div className="accounting-section-header accounting-section-header--plain">
          <div>
            <h2>Resumen</h2>
          </div>
          <div className="accounting-inline-actions">
            <UiActionButton type="button" variant="secondary" onClick={() => setSalaryModalOpen(true)}>
              {state.salaryConfiguration ? 'Modificar sueldo' : 'Configurar sueldo'}
            </UiActionButton>
            <UiActionButton type="button" onClick={() => setOvertimeModalOpen(true)}>Cargar horas extra</UiActionButton>
          </div>
        </div>

        <div className="summary-grid accounting-summary-grid accounting-employee-cycle-summary-grid">
          <article className="summary-card"><span>Sueldo base</span><strong>{formatCurrency(state.summary.baseSalary)}</strong><small>{salarySourceLabel}</small></article>
          <article className="summary-card"><span>Horas extra</span><strong>{formatCurrency(state.summary.overtimeTotal)}</strong><small>{state.overtimeItems.length} registros</small></article>
          <article className="summary-card"><span>Rendiciones</span><strong>{formatCurrency(expensesTotalMinor)}</strong><small>{expenseSubmissions.length} cargadas</small></article>
          <article className="summary-card"><span>Estado</span><strong>{state.isLocked ? 'Bloqueado' : state.summary.status}</strong><small>Control del ciclo</small></article>
        </div>

        <section className="accounting-cycle-liquidation">
          <div>
            <p className="eyebrow">Liquidacion</p>
            <h3>Detalle contable del ciclo</h3>
          </div>
          <div className="accounting-cycle-liquidation__grid">
            <div><span>Bruto estimado</span><strong>{formatCurrency(grossSalaryMinor)}</strong></div>
            <div><span>Rendiciones aprobadas</span><strong>{formatCurrency(approvedExpensesMinor)}</strong></div>
            <div><span>Documentos vinculados</span><strong>{linkedReferenceIds.length}</strong></div>
            <div><span>Movimientos</span><strong>{state.payrollCycle?.financialMovementIds.length ?? state.salaryPayment?.financialMovementIds.length ?? 0}</strong></div>
          </div>
          {state.salaryConfiguration && (
            <div className="accounting-inline-summary accounting-salary-config-summary">
              <span>Configuracion salarial activa</span>
              <strong>{formatCurrency(state.salaryConfiguration.baseAmountMinor)}</strong>
              <small>{state.salaryConfiguration.periodicity} - horas extra {state.salaryConfiguration.allowOvertime ? 'habilitadas' : 'no habilitadas'}</small>
            </div>
          )}
          <div className="form-actions form-actions--split">
            <small>
              {state.isLocked
                ? 'El pago de sueldo ya fue generado para este ciclo.'
                : canGenerateSalaryPayment
                  ? 'Genera el pago desde la configuracion salarial activa; el backend crea los movimientos de egreso.'
                  : 'Primero hay que configurar el sueldo del empleado.'}
            </small>
            <UiActionButton type="button" disabled={state.isLocked || !canGenerateSalaryPayment} onClick={() => setConfirmPayrollOpen(true)}>
              Generar pago de sueldo
            </UiActionButton>
          </div>
        </section>
      </section>

      <section className="floating-card accounting-panel accounting-centered-panel">
        <div className="accounting-section-header accounting-section-header--plain">
          <div>
            <h2>Horas extra cargadas</h2>
          </div>
        </div>
        <div className="accounting-list">
          {state.overtimeItems.map((entry) => (
            <article key={entry.id} className="accounting-row accounting-row--actions">
              <div className="accounting-row__main">
                <strong>{entry.reason}</strong>
                <small>{formatTimestamp(entry.workDate)} - {entry.hours} horas</small>
              </div>
              <div className="accounting-row__meta">
                <span className={`status-chip status-chip--${entry.status}`}>{entry.status}</span>
                <strong>{formatCurrency(entry.amountMinor)}</strong>
              </div>
            </article>
          ))}
          {state.overtimeItems.length === 0 && <AccountingEmptyState title="Sin horas extra cargadas" />}
        </div>
      </section>

      <section className="floating-card accounting-panel accounting-centered-panel">
        <div className="accounting-section-header accounting-section-header--plain">
          <div>
            <h2>Rendiciones cargadas por empleado</h2>
          </div>
        </div>
        <div className="accounting-entry-form accounting-employee-expense-filters">
          <label className="form-field">
            <span>Buscar</span>
            <input value={expenseSearch} onChange={(event) => setExpenseSearch(event.target.value)} placeholder="Descripcion, proveedor o categoria" />
          </label>
          <label className="form-field">
            <span>Estado</span>
            <select value={expenseStatusFilter} onChange={(event) => setExpenseStatusFilter(event.target.value as ExpenseStatusFilter)}>
              {EXPENSE_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="accounting-list accounting-employee-expense-list">
          {filteredExpenseSubmissions.map((expense) => (
            <article key={expense.id} className="accounting-row accounting-row--actions">
              <div className="accounting-row__main">
                <strong>{expense.description}</strong>
                <small>{getCategoryLabel(expense.categoryId)} - {formatTimestamp(expense.expenseDate)} - {expense.vendorName ?? 'Sin proveedor'}</small>
              </div>
              <div className="accounting-row__meta">
                <span className={`status-chip status-chip--${expense.status}`}>{expense.status}</span>
                <strong>{formatCurrency(expense.amountMinor)}</strong>
              </div>
            </article>
          ))}
          {!expensesLoading && filteredExpenseSubmissions.length === 0 && <AccountingEmptyState title="Sin rendiciones para estos filtros" />}
        </div>
      </section>

      {overtimeModalOpen && (
        <div className="modal-overlay quick-actions-modal-overlay" role="presentation" onClick={() => setOvertimeModalOpen(false)}>
          <section
            className="member-modal-card quick-actions-modal accounting-operation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-overtime-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header quick-actions-modal__header">
              <div>
                <h2 id="employee-overtime-modal-title">Cargar horas extra</h2>
              </div>
              <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={() => setOvertimeModalOpen(false)}>
                x
              </button>
            </div>
            <form className="accounting-entry-form" onSubmit={handleCreateOvertime}>
              <label className="form-field"><span>Fecha</span><input type="date" value={overtimeForm.workDate} onChange={(event) => setOvertimeForm((current) => ({ ...current, workDate: event.target.value }))} /></label>
              <label className="form-field"><span>Horas</span><input inputMode="decimal" value={overtimeForm.hours} onChange={(event) => setOvertimeForm((current) => ({ ...current, hours: event.target.value }))} /></label>
              <label className="form-field"><span>Monto</span><input inputMode="decimal" value={overtimeForm.amount} onChange={(event) => setOvertimeForm((current) => ({ ...current, amount: event.target.value }))} /></label>
              <label className="form-field"><span>Motivo</span><input value={overtimeForm.reason} onChange={(event) => setOvertimeForm((current) => ({ ...current, reason: event.target.value }))} /></label>
              <div className="form-actions">
                <UiActionButton type="submit">Cargar hora extra</UiActionButton>
              </div>
            </form>
          </section>
        </div>
      )}

      {salaryModalOpen && (
        <div className="modal-overlay quick-actions-modal-overlay" role="presentation" onClick={() => setSalaryModalOpen(false)}>
          <section
            className="member-modal-card quick-actions-modal accounting-operation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-salary-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header quick-actions-modal__header">
              <div>
                <h2 id="employee-salary-modal-title">Modificar sueldo</h2>
              </div>
              <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={() => setSalaryModalOpen(false)}>
                x
              </button>
            </div>
            <form className="accounting-entry-form" onSubmit={handleSaveSalary}>
              <label className="form-field">
                <span>Sueldo base</span>
                <input inputMode="decimal" value={salaryForm.baseAmount} onChange={(event) => setSalaryForm((current) => ({ ...current, baseAmount: event.target.value }))} />
              </label>
              <label className="form-field">
                <span>Periodicidad</span>
                <select value={salaryForm.periodicity} onChange={(event) => setSalaryForm((current) => ({ ...current, periodicity: event.target.value as SalaryPeriodicity }))}>
                  {SALARY_PERIODICITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>Vigente desde</span>
                <input type="date" value={salaryForm.effectiveFrom} onChange={(event) => setSalaryForm((current) => ({ ...current, effectiveFrom: event.target.value }))} />
              </label>
              <label className="check-field">
                <input type="checkbox" checked={salaryForm.allowOvertime} onChange={(event) => setSalaryForm((current) => ({ ...current, allowOvertime: event.target.checked }))} />
                <span>Permite cargar horas extra</span>
              </label>
              <label className="form-field">
                <span>Nota</span>
                <textarea value={salaryForm.notes} onChange={(event) => setSalaryForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>
              <div className="form-actions">
                <UiActionButton type="submit" disabled={savingSalary}>{savingSalary ? 'Guardando...' : 'Guardar sueldo'}</UiActionButton>
              </div>
            </form>
          </section>
        </div>
      )}

      <DangerActionDialog
        open={confirmPayrollOpen}
        title="Generar pago de sueldo"
        description="Esta accion toma el sueldo cargado en Firestore, registra el pago del periodo y crea los movimientos de egreso en caja segun validacion backend."
        reason={payrollReason}
        confirmLabel="Generar pago"
        loading={postingPayroll}
        onReasonChange={setPayrollReason}
        onCancel={() => setConfirmPayrollOpen(false)}
        onConfirm={() => void postPayroll()}
      />
    </div>
  );
}
