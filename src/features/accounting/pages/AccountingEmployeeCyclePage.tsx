import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import type { EmployeeCycleSection } from '../types/employeeAccounting';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { DangerActionDialog } from '../components/DangerActionDialog';
import { EmployeeCycleAccordion } from '../components/EmployeeCycleAccordion';
import { useEmployeePeriod } from '../hooks/useEmployeePeriod';
import type { AccountingNotice } from '../types/accounting';
import { buildArgentinaDateIso, formatCurrency, formatPeriod, getCurrentAccountingPeriod, normalizeAccountingPeriod, parseAmountInputToMinor, shiftAccountingPeriod } from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();

function mapQuerySection(section: string | null): EmployeeCycleSection {
  if (section === 'references' || section === 'external-docs') {
    return 'external-docs';
  }
  if (section === 'salary' || section === 'settlement' || section === 'liquidation') {
    return 'settlement';
  }
  if (section === 'payment') {
    return 'payment';
  }
  return 'summary';
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function AccountingEmployeeCyclePage() {
  const { employeeId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryPeriod = normalizeAccountingPeriod(searchParams.get('period') ?? getCurrentAccountingPeriod());
  const employeePeriod = useEmployeePeriod(employeeId, queryPeriod, mapQuerySection(searchParams.get('section')));
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [payrollReason, setPayrollReason] = useState('');
  const [confirmPayrollOpen, setConfirmPayrollOpen] = useState(false);
  const [postingPayroll, setPostingPayroll] = useState(false);
  const [overtimeForm, setOvertimeForm] = useState({ workDate: todayInputValue(), hours: '', amount: '', reason: '' });
  const [certificateForm, setCertificateForm] = useState({ certificateType: 'RT', documentNumber: '', issuedAt: '', expiresAt: '' });

  const state = employeePeriod.state;
  const linkedReferenceIds = useMemo(() => state?.externalAssignments.map((link) => link.referenceId) ?? [], [state?.externalAssignments]);

  const setPeriod = (period: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('period', period);
      return next;
    });
  };

  const handleCreateOvertime = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hours = Number(overtimeForm.hours.replace(',', '.'));
    const amountMinor = parseAmountInputToMinor(overtimeForm.amount);
    if (!employeeId || !Number.isFinite(hours) || hours <= 0 || !Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Revisa horas, monto y empleado.' });
      return;
    }

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
    await employeePeriod.reload();
  };

  const handleRecordCertificate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeId || !certificateForm.certificateType.trim()) {
      setNotice({ kind: 'error', message: 'Indica tipo de certificado.' });
      return;
    }

    await accountingCallables.recordEmployeeCertificate({
      employeeId,
      period: queryPeriod,
      certificateType: certificateForm.certificateType.trim(),
      documentNumber: certificateForm.documentNumber.trim() || null,
      issuedAt: certificateForm.issuedAt ? buildArgentinaDateIso(certificateForm.issuedAt) : null,
      expiresAt: certificateForm.expiresAt ? buildArgentinaDateIso(certificateForm.expiresAt) : null,
    });
    setNotice({ kind: 'success', message: 'Certificado vinculado al ciclo.' });
    setCertificateForm({ certificateType: 'RT', documentNumber: '', issuedAt: '', expiresAt: '' });
    await employeePeriod.reload();
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
        notes: payrollReason.trim(),
      });
      setNotice({ kind: 'success', message: `Liquidacion posteada con ${result.financialMovementIds.length} movimientos.` });
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
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Ciclo mensual</p>
          <h1>{state.employee ? `${state.employee.lastName}, ${state.employee.firstName}` : 'Empleado'}</h1>
          <p>{formatPeriod(queryPeriod)} - estado {state.summary.status}</p>
        </div>
        <div className="accounting-hero__actions">
          <button type="button" className="btn-secondary" onClick={() => setPeriod(shiftAccountingPeriod(queryPeriod, -1))}>Mes anterior</button>
          <input type="month" value={queryPeriod} onChange={(event) => setPeriod(event.target.value)} aria-label="Periodo" />
          <button type="button" className="btn-secondary" onClick={() => setPeriod(shiftAccountingPeriod(queryPeriod, 1))}>Mes siguiente</button>
          <Link className="btn-secondary" to="/accounting/employees">Empleados</Link>
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />

      <section className="accounting-cycle-accordion">
        <EmployeeCycleAccordion section="summary" expandedSection={state.expandedSection} onExpand={employeePeriod.setExpandedSection} helper="Estado, base, horas, docs y bloqueo">
          <div className="summary-grid accounting-summary-grid">
            <article className="summary-card"><span>Base</span><strong>{formatCurrency(state.summary.baseSalary)}</strong><small>Sueldo snapshot</small></article>
            <article className="summary-card"><span>Horas extra</span><strong>{formatCurrency(state.summary.overtimeTotal)}</strong><small>{state.overtimeItems.length} registros</small></article>
            <article className="summary-card"><span>Docs</span><strong>{state.summary.externalDocsLinked}</strong><small>Asignados al periodo</small></article>
            <article className="summary-card"><span>Bloqueado</span><strong>{state.isLocked ? 'Si' : 'No'}</strong><small>No se recalculan historicos</small></article>
          </div>
        </EmployeeCycleAccordion>

        <EmployeeCycleAccordion section="overtime" expandedSection={state.expandedSection} onExpand={employeePeriod.setExpandedSection} helper="Carga puntual y revision posterior">
          <form className="accounting-entry-form" onSubmit={handleCreateOvertime}>
            <label className="form-field"><span>Fecha</span><input type="date" value={overtimeForm.workDate} onChange={(event) => setOvertimeForm((current) => ({ ...current, workDate: event.target.value }))} /></label>
            <label className="form-field"><span>Horas</span><input value={overtimeForm.hours} onChange={(event) => setOvertimeForm((current) => ({ ...current, hours: event.target.value }))} /></label>
            <label className="form-field"><span>Monto</span><input value={overtimeForm.amount} onChange={(event) => setOvertimeForm((current) => ({ ...current, amount: event.target.value }))} /></label>
            <label className="form-field"><span>Motivo</span><input value={overtimeForm.reason} onChange={(event) => setOvertimeForm((current) => ({ ...current, reason: event.target.value }))} /></label>
            <button type="submit" className="btn-primary">Cargar hora extra</button>
          </form>
          <div className="accounting-list">
            {state.overtimeItems.map((entry) => <article key={entry.id} className="accounting-row"><div className="accounting-row__main"><strong>{entry.reason}</strong><small>{entry.hours} horas</small></div><div className="accounting-row__meta"><span className={`status-chip status-chip--${entry.status}`}>{entry.status}</span><strong>{formatCurrency(entry.amountMinor)}</strong></div></article>)}
          </div>
        </EmployeeCycleAccordion>

        <EmployeeCycleAccordion section="certificates" expandedSection={state.expandedSection} onExpand={employeePeriod.setExpandedSection} helper="Certificados laborales del periodo">
          <form className="accounting-entry-form" onSubmit={handleRecordCertificate}>
            <label className="form-field"><span>Tipo</span><input value={certificateForm.certificateType} onChange={(event) => setCertificateForm((current) => ({ ...current, certificateType: event.target.value }))} /></label>
            <label className="form-field"><span>Numero</span><input value={certificateForm.documentNumber} onChange={(event) => setCertificateForm((current) => ({ ...current, documentNumber: event.target.value }))} /></label>
            <label className="form-field"><span>Emitido</span><input type="date" value={certificateForm.issuedAt} onChange={(event) => setCertificateForm((current) => ({ ...current, issuedAt: event.target.value }))} /></label>
            <label className="form-field"><span>Vence</span><input type="date" value={certificateForm.expiresAt} onChange={(event) => setCertificateForm((current) => ({ ...current, expiresAt: event.target.value }))} /></label>
            <button type="submit" className="btn-primary">Guardar certificado</button>
          </form>
        </EmployeeCycleAccordion>

        <EmployeeCycleAccordion section="external-docs" expandedSection={state.expandedSection} onExpand={employeePeriod.setExpandedSection} helper="F931, ART, obra social y links">
          <div className="accounting-list">
            {state.externalAssignments.map((link) => <article key={link.id} className="accounting-row"><div className="accounting-row__main"><strong>{link.referenceType}</strong><small>{link.referenceId}</small></div><div className="accounting-row__meta"><span className={`status-chip status-chip--${link.status}`}>{link.status}</span><strong>{formatCurrency(link.allocatedAmountMinor ?? 0)}</strong></div></article>)}
          </div>
          <Link className="btn-secondary" to="/accounting/external-docs">Gestionar docs globales</Link>
        </EmployeeCycleAccordion>

        <EmployeeCycleAccordion section="expenses" expandedSection={state.expandedSection} onExpand={employeePeriod.setExpandedSection} helper="Rendiciones del empleado">
          <p className="profile-note">Las rendiciones se operan desde Egresos para mantener una unica cola mental.</p>
          <Link className="btn-secondary" to="/accounting/expenses?tab=queue">Ver rendiciones</Link>
        </EmployeeCycleAccordion>

        <EmployeeCycleAccordion section="settlement" expandedSection={state.expandedSection} onExpand={employeePeriod.setExpandedSection} helper="Revision previa al posteo">
          <div className="summary-grid accounting-summary-grid">
            <article className="summary-card"><span>Bruto</span><strong>{formatCurrency(state.summary.baseSalary + state.summary.overtimeTotal)}</strong><small>Antes de confirmar</small></article>
            <article className="summary-card"><span>Docs linkeados</span><strong>{linkedReferenceIds.length}</strong><small>Se enviaran al backend</small></article>
          </div>
        </EmployeeCycleAccordion>

        <EmployeeCycleAccordion section="payment" expandedSection={state.expandedSection} onExpand={employeePeriod.setExpandedSection} helper="Posteo sensible con confirmacion">
          <button type="button" className="btn-primary" disabled={state.isLocked} onClick={() => setConfirmPayrollOpen(true)}>
            Postear liquidacion
          </button>
        </EmployeeCycleAccordion>
      </section>

      <DangerActionDialog
        open={confirmPayrollOpen}
        title="Postear liquidacion de sueldo"
        description="Esta accion crea movimientos contables y bloquea el ciclo segun validacion backend."
        reason={payrollReason}
        confirmLabel="Postear liquidacion"
        loading={postingPayroll}
        onReasonChange={setPayrollReason}
        onCancel={() => setConfirmPayrollOpen(false)}
        onConfirm={() => void postPayroll()}
      />
    </div>
  );
}
