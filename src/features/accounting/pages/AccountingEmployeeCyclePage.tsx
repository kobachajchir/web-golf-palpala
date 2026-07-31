import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ModalCloseIcon } from '../../../components/ModalCloseIcon';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import type { SalaryPeriodicity } from '../../../modules/accounting/domain/models';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { DangerActionDialog } from '../components/DangerActionDialog';
import { useEmployeePeriod } from '../hooks/useEmployeePeriod';
import type { AccountingNotice } from '../types/accounting';
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

function getCycleStatusLabel(status: string | null | undefined, isLocked = false) {
  if (isLocked) {
    return 'Ciclo cerrado';
  }

  switch (status) {
    case 'draft':
      return 'Ciclo abierto';
    case 'ready':
    case 'ready_to_liquidate':
      return 'Listo para liquidar';
    case 'liquidated':
      return 'Liquidado';
    case 'paid':
    case 'posted':
      return 'Pagado';
    case 'voided':
      return 'Anulado';
    default:
      return status || 'Ciclo abierto';
  }
}
function amountMinorToInput(amountMinor: number) {
  return String(amountMinor / 100).replace('.', ',');
}

function getAnnualBonusReferenceLabel(source: string | null, period: string | null) {
  if (source === 'salary_payment' || source === 'payroll_cycle') {
    return period ? `Mejor sueldo liquidado del semestre (${period})` : 'Mejor sueldo liquidado del semestre';
  }
  if (source === 'active_salary_configuration') {
    return 'Configuracion salarial activa (sin liquidaciones semestrales)';
  }
  return 'Sin sueldo de referencia';
}


export function AccountingEmployeeCyclePage() {
  const { interfaceMode } = useAuth();
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
  const [annualBonusModalOpen, setAnnualBonusModalOpen] = useState(false);
  const [postingAnnualBonus, setPostingAnnualBonus] = useState(false);
  const [annualBonusForm, setAnnualBonusForm] = useState({
    amount: '',
    operationDate: todayInputValue(),
    paymentMethodId: ACCOUNTING_PAYMENT_METHOD_IDS.transferMacro as string,
    notes: '',
  });

  const state = employeePeriod.state;
  const employeeName = state?.employee ? `${state.employee.lastName}, ${state.employee.firstName}` : 'Empleado';
  const linkedReferenceIds = useMemo(() => state?.externalAssignments.map((link) => link.referenceId) ?? [], [state?.externalAssignments]);
  const cycleStatusLabel = getCycleStatusLabel(state?.summary.status, state?.isLocked);
  const salarySourceLabel = state?.payrollCycle
    ? 'Liquidacion posteada'
    : state?.salaryPayment
      ? 'Pago registrado'
      : state?.salaryConfiguration
        ? 'Configuracion activa en Firestore'
        : 'Sin sueldo configurado';
  const canConfigureSalaries = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;
  const canGenerateSalaryPayments = interfaceMode === ROLES.DIRECTIVO || interfaceMode === ROLES.ADMINISTRATIVO;
  const canGenerateSalaryPayment = Boolean(state?.salaryConfiguration || state?.salaryPayment || state?.payrollCycle);
  const grossSalaryMinor = (state?.summary.baseSalary ?? 0) + (state?.summary.overtimeTotal ?? 0);

  const annualBonusPreview = state?.annualBonusPreview ?? null;
  const annualBonusSemesterLabel = annualBonusPreview?.semester === 1 ? 'Primer semestre' : 'Segundo semestre';

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
    if (!state?.annualBonusPreview) {
      return;
    }
    const defaultPaymentMethodId = state.paymentMethods.some((method) => method.id === ACCOUNTING_PAYMENT_METHOD_IDS.transferMacro)
      ? ACCOUNTING_PAYMENT_METHOD_IDS.transferMacro
      : state.paymentMethods[0]?.id ?? '';
    setAnnualBonusForm((current) => ({
      ...current,
      amount: amountMinorToInput(state.annualBonusPreview.defaultAmountMinor),
      paymentMethodId: state.paymentMethods.some((method) => method.id === current.paymentMethodId)
        ? current.paymentMethodId
        : defaultPaymentMethodId,
    }));
  }, [state?.annualBonusPreview, state?.paymentMethods]);

  useEffect(() => {
    if (searchParams.get('section') !== 'salary') {
      return;
    }

    if (canConfigureSalaries) {
      setSalaryModalOpen(true);
      return;
    }

    setSalaryModalOpen(false);
    setNotice({ kind: 'info', message: 'Solo Administracion o el Comite Ejecutivo pueden modificar sueldos.' });
  }, [canConfigureSalaries, searchParams]);

  useEffect(() => {
    if (!overtimeModalOpen && !salaryModalOpen && !annualBonusModalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (annualBonusModalOpen) setAnnualBonusModalOpen(false);
      else if (salaryModalOpen) setSalaryModalOpen(false);
      else setOvertimeModalOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [annualBonusModalOpen, overtimeModalOpen, salaryModalOpen]);

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
    if (!canConfigureSalaries) {
      setNotice({ kind: 'error', message: 'Solo Administracion o el Comite Ejecutivo pueden modificar sueldos.' });
      return;
    }

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
  const handlePostAnnualBonus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeId || !annualBonusPreview) {
      return;
    }
    if (!canGenerateSalaryPayments) {
      setNotice({ kind: 'error', message: 'Solo Administracion o el Comite Ejecutivo pueden registrar el aguinaldo.' });
      return;
    }
    if (annualBonusPreview.alreadyPosted) {
      setNotice({ kind: 'info', message: 'Este semestre ya tiene un aguinaldo registrado.' });
      setAnnualBonusModalOpen(false);
      return;
    }
    const amountMinor = parseAmountInputToMinor(annualBonusForm.amount);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresa un monto de aguinaldo mayor a cero.' });
      return;
    }
    if (!annualBonusForm.paymentMethodId) {
      setNotice({ kind: 'error', message: 'Selecciona un medio de pago.' });
      return;
    }

    setPostingAnnualBonus(true);
    try {
      const result = await accountingCallables.postAnnualBonusPayment({
        employeeId,
        period: queryPeriod,
        amountMinor,
        paymentMethodId: annualBonusForm.paymentMethodId,
        operationDate: buildArgentinaDateIso(annualBonusForm.operationDate),
        notes: annualBonusForm.notes.trim() || null,
      });
      setNotice({ kind: 'success', message: `Aguinaldo del ${result.semester === 1 ? 'primer' : 'segundo'} semestre registrado por ${formatCurrency(result.amountMinor)}.` });
      setAnnualBonusModalOpen(false);
      setAnnualBonusForm((current) => ({ ...current, notes: '' }));
      await employeePeriod.reload();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos registrar el aguinaldo.' });
    } finally {
      setPostingAnnualBonus(false);
    }
  };


  const postPayroll = async () => {
    if (!employeeId || !state) {
      return;
    }

    if (!canGenerateSalaryPayments) {
      setNotice({ kind: 'error', message: 'Solo Administracion o el Comite Ejecutivo pueden generar pagos de sueldo.' });
      setConfirmPayrollOpen(false);
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
    <div className="accounting-shell accounting-employee-cycle-page">
      <section className="floating-card accounting-hero accounting-employee-cycle-hero">
        <div className="accounting-hero__copy">
          <h1>{employeeName}</h1>
        </div>
        <div className="accounting-hero__actions">
          <Link className="ui-action-button ui-action-button--secondary" to="/accounting/employees">Volver</Link>
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />

      <section className="floating-card accounting-panel accounting-centered-panel accounting-employee-cycle-summary">
        <div className="accounting-section-header accounting-section-header--plain">
          <div>
            <h2>Resumen</h2>
          </div>
          <div className="accounting-inline-actions">
            {canConfigureSalaries && (
              <UiActionButton type="button" variant="secondary" onClick={() => setSalaryModalOpen(true)}>
                Modificar sueldo
              </UiActionButton>
            )}
            <UiActionButton type="button" onClick={() => setOvertimeModalOpen(true)}>Cargar horas extra</UiActionButton>
          </div>
        </div>

        <div className="summary-grid accounting-summary-grid accounting-employee-cycle-summary-grid">
          <article className="summary-card"><span>Sueldo base</span><strong>{formatCurrency(state.summary.baseSalary)}</strong><small>{salarySourceLabel}</small></article>
          <article className="summary-card"><span>Horas extra</span><strong>{formatCurrency(state.summary.overtimeTotal)}</strong><small>{state.overtimeItems.length} registros</small></article>
          <article className="summary-card"><span>Bruto estimado</span><strong>{formatCurrency(grossSalaryMinor)}</strong><small>Sueldo base + horas extra</small></article>
          <article className="summary-card"><span>Estado</span><strong>{cycleStatusLabel}</strong><small>Control del ciclo</small></article>
        </div>

        <section className="accounting-cycle-liquidation">
          <div>
            <p className="eyebrow">Liquidacion</p>
            <h3>Detalle contable del ciclo</h3>
          </div>
          <div className="accounting-cycle-liquidation__grid">
            <div><span>Bruto estimado</span><strong>{formatCurrency(grossSalaryMinor)}</strong></div>
            <div><span>Documentos vinculados</span><strong>{linkedReferenceIds.length}</strong></div>
            <div><span>Movimientos</span><strong>{state.payrollCycle?.financialMovementIds.length ?? state.salaryPayment?.financialMovementIds.length ?? 0}</strong></div>
            <div><span>Estado</span><strong>{cycleStatusLabel}</strong></div>
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
              {!canGenerateSalaryPayments
                ? 'Solo Administracion o el Comite Ejecutivo pueden generar pagos de sueldo.'
                : state.isLocked
                ? 'El pago de sueldo ya fue generado para este ciclo.'
                : canGenerateSalaryPayment
                  ? 'Genera el pago desde la configuracion salarial activa; el backend crea los movimientos de egreso.'
                  : 'Primero hay que configurar el sueldo del empleado.'}
            </small>
            <UiActionButton type="button" disabled={!canGenerateSalaryPayments || state.isLocked || !canGenerateSalaryPayment} onClick={() => setConfirmPayrollOpen(true)}>
              Generar pago de sueldo
            </UiActionButton>
          </div>
        </section>

        {annualBonusPreview && (
          <section className="accounting-cycle-liquidation">
            <div>
              <p className="eyebrow">Aguinaldo</p>
              <h3>{annualBonusSemesterLabel} de {annualBonusPreview.year}</h3>
            </div>
            <div className="accounting-cycle-liquidation__grid">
              <div><span>Sueldo de referencia</span><strong>{formatCurrency(annualBonusPreview.referenceAmountMinor)}</strong></div>
              <div><span>Sugerido (50%)</span><strong>{formatCurrency(annualBonusPreview.defaultAmountMinor)}</strong></div>
              <div><span>Referencia</span><strong>{annualBonusPreview.referencePeriod ?? 'Configuracion activa'}</strong></div>
              <div>
                <span>Estado</span>
                <strong>{annualBonusPreview.alreadyPosted ? 'Registrado' : 'Pendiente'}</strong>
              </div>
            </div>
            <div className="accounting-inline-summary accounting-salary-config-summary">
              <span>Como se calcula</span>
              <strong>{getAnnualBonusReferenceLabel(annualBonusPreview.referenceSource, annualBonusPreview.referencePeriod)}</strong>
              <small>Se toma el mayor sueldo liquidado del semestre y se sugiere el 50%. El monto se puede reemplazar antes de registrar.</small>
            </div>
            <div className="form-actions form-actions--split">
              <small>
                {annualBonusPreview.alreadyPosted
                  ? `Ya se registro ${formatCurrency(annualBonusPreview.existingAmountMinor ?? 0)} para este semestre.`
                  : annualBonusPreview.referenceAmountMinor > 0
                    ? 'El periodo abierto define el semestre. La fecha elegida define cuando impacta en caja.'
                    : 'Configura o liquida un sueldo para habilitar el calculo del aguinaldo.'}
              </small>
              <UiActionButton
                type="button"
                disabled={!canGenerateSalaryPayments || annualBonusPreview.alreadyPosted || annualBonusPreview.referenceAmountMinor <= 0}
                onClick={() => {
                  setAnnualBonusForm((current) => ({ ...current, amount: amountMinorToInput(annualBonusPreview.defaultAmountMinor) }));
                  setAnnualBonusModalOpen(true);
                }}
              >
                {annualBonusPreview.alreadyPosted ? 'Aguinaldo registrado' : 'Registrar aguinaldo'}
              </UiActionButton>
            </div>
          </section>
        )}
      </section>

      <section className="floating-card accounting-panel accounting-centered-panel accounting-employee-cycle-overtime-panel">
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

      {overtimeModalOpen && (
        <div className="modal-overlay quick-actions-modal-overlay" role="presentation">
          <section
            className="member-modal-card quick-actions-modal accounting-operation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-overtime-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header quick-actions-modal__header">
              <div className="accounting-operation-modal__title-block">
                <h2 id="employee-overtime-modal-title" className="accounting-operation-modal__title">Cargar horas extra</h2>
              </div>
              <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={() => setOvertimeModalOpen(false)}>
                <ModalCloseIcon />
              </button>
            </div>
            <form className="accounting-entry-form accounting-dialog-form accounting-employee-cycle-modal-form" onSubmit={handleCreateOvertime}>
              <label className="form-field"><span>Fecha</span><input type="date" value={overtimeForm.workDate} onChange={(event) => setOvertimeForm((current) => ({ ...current, workDate: event.target.value }))} /></label>
              <label className="form-field"><span>Horas</span><input inputMode="decimal" value={overtimeForm.hours} onChange={(event) => setOvertimeForm((current) => ({ ...current, hours: event.target.value }))} /></label>
              <label className="form-field"><span>Monto</span><input inputMode="decimal" value={overtimeForm.amount} onChange={(event) => setOvertimeForm((current) => ({ ...current, amount: event.target.value }))} /></label>
              <label className="form-field"><span>Motivo</span><input value={overtimeForm.reason} onChange={(event) => setOvertimeForm((current) => ({ ...current, reason: event.target.value }))} /></label>
              <div className="form-actions form-actions--right">
                <UiActionButton type="submit">Cargar hora extra</UiActionButton>
              </div>
            </form>
          </section>
        </div>
      )}

      {canConfigureSalaries && salaryModalOpen && (
        <div className="modal-overlay quick-actions-modal-overlay" role="presentation">
          <section
            className="member-modal-card quick-actions-modal accounting-operation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-salary-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header quick-actions-modal__header">
              <div className="accounting-operation-modal__title-block">
                <h2 id="employee-salary-modal-title" className="accounting-operation-modal__title">Modificar sueldo</h2>
              </div>
              <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={() => setSalaryModalOpen(false)}>
                <ModalCloseIcon />
              </button>
            </div>
            <form className="accounting-entry-form accounting-dialog-form accounting-employee-cycle-modal-form" onSubmit={handleSaveSalary}>
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
              <div className="form-actions form-actions--right">
                <UiActionButton type="submit" disabled={savingSalary}>{savingSalary ? 'Guardando...' : 'Guardar sueldo'}</UiActionButton>
              </div>
            </form>
          </section>
        </div>
      )}

      {annualBonusModalOpen && annualBonusPreview && (
        <div className="modal-overlay quick-actions-modal-overlay" role="presentation">
          <section
            className="member-modal-card quick-actions-modal accounting-operation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-annual-bonus-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header quick-actions-modal__header">
              <div className="accounting-operation-modal__title-block">
                <h2 id="employee-annual-bonus-modal-title" className="accounting-operation-modal__title">Registrar aguinaldo</h2>
                <small>{annualBonusSemesterLabel} de {annualBonusPreview.year}</small>
              </div>
              <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={() => setAnnualBonusModalOpen(false)}>
                <ModalCloseIcon />
              </button>
            </div>
            <form className="accounting-entry-form accounting-dialog-form accounting-employee-cycle-modal-form" onSubmit={handlePostAnnualBonus}>
              <div className="accounting-inline-summary accounting-salary-config-summary">
                <span>Monto sugerido</span>
                <strong>{formatCurrency(annualBonusPreview.defaultAmountMinor)}</strong>
                <small>50% de {formatCurrency(annualBonusPreview.referenceAmountMinor)}. Podes ingresar otro monto.</small>
              </div>
              <label className="form-field">
                <span>Monto a pagar</span>
                <input inputMode="decimal" value={annualBonusForm.amount} onChange={(event) => setAnnualBonusForm((current) => ({ ...current, amount: event.target.value }))} />
              </label>
              <label className="form-field">
                <span>Fecha de pago</span>
                <input type="date" value={annualBonusForm.operationDate} onChange={(event) => setAnnualBonusForm((current) => ({ ...current, operationDate: event.target.value }))} />
              </label>
              <label className="form-field">
                <span>Medio de pago</span>
                <select value={annualBonusForm.paymentMethodId} onChange={(event) => setAnnualBonusForm((current) => ({ ...current, paymentMethodId: event.target.value }))}>
                  {state.paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>Nota</span>
                <textarea value={annualBonusForm.notes} onChange={(event) => setAnnualBonusForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>
              <small>El periodo {queryPeriod} determina el semestre; la fecha elegida determina el movimiento de caja.</small>
              <div className="form-actions form-actions--right">
                <UiActionButton type="submit" disabled={postingAnnualBonus || state.paymentMethods.length === 0}>
                  {postingAnnualBonus ? 'Registrando...' : 'Registrar aguinaldo'}
                </UiActionButton>
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
