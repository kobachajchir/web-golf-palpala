import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import {
  ACCOUNTING_REFERENCE_TYPES,
} from '../modules/accounting/domain/constants';
import type {
  AccountingPeriod,
  EmployeeAccountingLinkDocument,
  EmployeeCertificateDocument,
  EmployeePayrollCycleDocument,
  EntityWithId,
  ExternalAccountingReferenceDocument,
  ExternalReferenceType,
  OvertimeEntryDocument,
  SalaryPaymentDocument,
} from '../modules/accounting/domain/models';
import { createAccountingCallables } from '../modules/accounting/functions/accounting.callables';
import { createExternalAccountingReferencesRepository } from '../modules/accounting/infrastructure/firestore/repositories';
import type { EmployeeDocument } from '../modules/users/domain/models';
import { createEmployeesRepository } from '../modules/users/infrastructure/firestore/repositories';
import {
  buildArgentinaDateIso,
  formatCurrency,
  formatPeriod,
  formatTimestamp,
  getCurrentAccountingPeriod,
  normalizeAccountingPeriod,
  parseAmountInputToMinor,
} from './accountingPageUtils';

type NoticeState = {
  kind: 'success' | 'error';
  message: string;
} | null;

type EmployeeCycleSnapshot = {
  employee: EntityWithId<EmployeeDocument> | null;
  payrollCycle: EntityWithId<EmployeePayrollCycleDocument> | null;
  salaryPayment: EntityWithId<SalaryPaymentDocument> | null;
  overtimeEntries: Array<EntityWithId<OvertimeEntryDocument>>;
  accountingLinks: Array<EntityWithId<EmployeeAccountingLinkDocument>>;
  certificates: Array<EntityWithId<EmployeeCertificateDocument>>;
  externalReferences: Array<EntityWithId<ExternalAccountingReferenceDocument>>;
};

type OvertimeFormState = {
  workDate: string;
  hours: string;
  amountMinor: string;
  reason: string;
  notes: string;
};

type CertificateFormState = {
  certificateType: string;
  documentNumber: string;
  issuedAt: string;
  expiresAt: string;
  attachmentUrl: string;
  notes: string;
};

type ReferenceLinkFormState = {
  referenceId: string;
  allocatedAmountMinor: string;
  paidAt: string;
  notes: string;
};

type ReferenceRecordFormState = {
  referenceType: ExternalReferenceType;
  amountMinor: string;
  providerName: string;
  referenceNumber: string;
  dueDate: string;
  documentDate: string;
  attachmentUrl: string;
  allocatedAmountMinor: string;
  paidAt: string;
  notes: string;
};

type PayrollFormState = {
  salaryConfigurationId: string;
  salaryGrossMinor: string;
  bankedAmountMinor: string;
  nonBankedAmountMinor: string;
  operationDate: string;
  notes: string;
};

const EMPTY_SNAPSHOT: EmployeeCycleSnapshot = {
  employee: null,
  payrollCycle: null,
  salaryPayment: null,
  overtimeEntries: [],
  accountingLinks: [],
  certificates: [],
  externalReferences: [],
};

const accountingCallables = createAccountingCallables();

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function getEmployeeDisplayName(employee: EntityWithId<EmployeeDocument> | null) {
  return employee ? `${employee.lastName}, ${employee.firstName}` : 'Empleado';
}

function getOptionalAmount(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const amountMinor = parseAmountInputToMinor(value);
  return Number.isFinite(amountMinor) ? amountMinor : Number.NaN;
}

function CycleSummary({ snapshot }: { snapshot: EmployeeCycleSnapshot }) {
  const approvedOvertimeMinor = snapshot.overtimeEntries
    .filter((entry) => entry.status === 'approved' || entry.status === 'liquidated')
    .reduce((total, entry) => total + entry.amountMinor, 0);
  const approvedOvertimeHours = snapshot.overtimeEntries
    .filter((entry) => entry.status === 'approved' || entry.status === 'liquidated')
    .reduce((total, entry) => total + entry.hours, 0);

  return (
    <section className="floating-card accounting-primary-panel">
      <div className="accounting-section-header">
        <div>
          <p className="eyebrow">Ciclo mensual</p>
          <h2>Resumen del empleado</h2>
        </div>
      </div>

      <div className="summary-grid accounting-summary-grid">
        <article className="summary-card">
          <span>Liquidacion</span>
          <strong>{snapshot.payrollCycle?.status ?? 'Sin postear'}</strong>
          <small>{snapshot.payrollCycle ? `${snapshot.payrollCycle.financialMovementIds.length} movimientos` : 'Pendiente'}</small>
        </article>
        <article className="summary-card">
          <span>Sueldo bruto</span>
          <strong>{formatCurrency(snapshot.payrollCycle?.salaryGrossMinor ?? snapshot.salaryPayment?.salaryGrossMinor ?? 0)}</strong>
          <small>Base salarial del periodo</small>
        </article>
        <article className="summary-card">
          <span>Horas extra</span>
          <strong>{formatCurrency(snapshot.payrollCycle?.overtimeTotalMinor ?? approvedOvertimeMinor)}</strong>
          <small>{snapshot.payrollCycle?.overtimeTotalHours ?? approvedOvertimeHours} horas aprobadas/liquidadas</small>
        </article>
        <article className="summary-card">
          <span>Referencias</span>
          <strong>{snapshot.accountingLinks.length}</strong>
          <small>F931, ART, obra social u otros links</small>
        </article>
        <article className="summary-card">
          <span>Certificados</span>
          <strong>{snapshot.certificates.length}</strong>
          <small>RT y documentacion laboral</small>
        </article>
      </div>
    </section>
  );
}

function shiftAccountingPeriod(period: AccountingPeriod, deltaMonths: number): AccountingPeriod {
  const [yearText, monthText] = period.split('-');
  const date = new Date(Number(yearText), Number(monthText) - 1 + deltaMonths, 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}` as AccountingPeriod;
}

export function EmployeeAccountingPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { interfaceMode } = useAuth();
  const queryPeriod = searchParams.get('period');
  const selectedSection = searchParams.get('section');
  const [selectedPeriod, setSelectedPeriodState] = useState<AccountingPeriod>(() =>
    normalizeAccountingPeriod(queryPeriod || getCurrentAccountingPeriod()),
  );
  const [snapshot, setSnapshot] = useState<EmployeeCycleSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [overtimeForm, setOvertimeForm] = useState<OvertimeFormState>({
    workDate: todayInputValue(),
    hours: '',
    amountMinor: '',
    reason: '',
    notes: '',
  });
  const [certificateForm, setCertificateForm] = useState<CertificateFormState>({
    certificateType: 'RT',
    documentNumber: '',
    issuedAt: '',
    expiresAt: '',
    attachmentUrl: '',
    notes: '',
  });
  const [referenceLinkForm, setReferenceLinkForm] = useState<ReferenceLinkFormState>({
    referenceId: '',
    allocatedAmountMinor: '',
    paidAt: '',
    notes: '',
  });
  const [referenceRecordForm, setReferenceRecordForm] = useState<ReferenceRecordFormState>({
    referenceType: 'F931',
    amountMinor: '',
    providerName: 'AFIP',
    referenceNumber: '',
    dueDate: '',
    documentDate: todayInputValue(),
    attachmentUrl: '',
    allocatedAmountMinor: '',
    paidAt: '',
    notes: '',
  });
  const [payrollForm, setPayrollForm] = useState<PayrollFormState>({
    salaryConfigurationId: '',
    salaryGrossMinor: '',
    bankedAmountMinor: '',
    nonBankedAmountMinor: '',
    operationDate: todayInputValue(),
    notes: '',
  });

  const canOperate = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;
  const canPostPayroll = interfaceMode === ROLES.DIRECTIVO;

  const setSelectedPeriod = useCallback(
    (period: AccountingPeriod) => {
      setSelectedPeriodState(period);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set('period', period);
        return next;
      });
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (!queryPeriod) {
      return;
    }

    const normalizedPeriod = normalizeAccountingPeriod(queryPeriod);
    setSelectedPeriodState((current) => (current === normalizedPeriod ? current : normalizedPeriod));
  }, [queryPeriod]);

  const loadCycle = useCallback(async () => {
    if (!employeeId || !canOperate) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      const employeesRepository = createEmployeesRepository();
      const externalReferencesRepository = createExternalAccountingReferencesRepository();
      const [employee, cycleResult, externalReferences] = await Promise.all([
        employeesRepository.getById(employeeId),
        accountingCallables.listEmployeePayrollCycle({
          employeeId,
          period: normalizeAccountingPeriod(selectedPeriod),
        }),
        externalReferencesRepository.listByPeriod(selectedPeriod),
      ]);

      setSnapshot({
        employee,
        payrollCycle: cycleResult.payrollCycle,
        salaryPayment: cycleResult.salaryPayment,
        overtimeEntries: cycleResult.overtimeEntries,
        accountingLinks: cycleResult.accountingLinks,
        certificates: cycleResult.certificates,
        externalReferences,
      });

      const firstReference = externalReferences[0];
      if (!referenceLinkForm.referenceId && firstReference) {
        setReferenceLinkForm((current) => ({ ...current, referenceId: firstReference.id }));
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos cargar el ciclo mensual del empleado.',
      });
    } finally {
      setLoading(false);
    }
  }, [canOperate, employeeId, referenceLinkForm.referenceId, selectedPeriod]);

  useEffect(() => {
    void loadCycle();
  }, [loadCycle]);

  const linkedReferenceIds = useMemo(
    () => snapshot.accountingLinks.map((link) => link.referenceId),
    [snapshot.accountingLinks],
  );

  const handleCreateOvertime = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeId) {
      return;
    }

    const hours = Number(overtimeForm.hours.replace(',', '.'));
    const amountMinor = parseAmountInputToMinor(overtimeForm.amountMinor);

    if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(amountMinor)) {
      setNotice({ kind: 'error', message: 'Revisa horas y monto antes de cargar la hora extra.' });
      return;
    }

    setSubmittingAction('create-overtime');
    setNotice(null);

    try {
      await accountingCallables.createOvertimeEntry({
        employeeId,
        period: normalizeAccountingPeriod(selectedPeriod),
        workDate: buildArgentinaDateIso(overtimeForm.workDate),
        hours,
        amountMinor,
        reason: overtimeForm.reason.trim(),
        notes: overtimeForm.notes.trim() || null,
      });
      setNotice({ kind: 'success', message: 'Hora extra cargada para revision.' });
      setOvertimeForm((current) => ({ ...current, hours: '', amountMinor: '', reason: '', notes: '' }));
      await loadCycle();
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos cargar la hora extra.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleReviewOvertime = async (entryId: string, decision: 'approved' | 'rejected') => {
    const rejectionReason = decision === 'rejected' ? window.prompt('Motivo del rechazo') : null;
    if (decision === 'rejected' && !rejectionReason?.trim()) {
      return;
    }

    setSubmittingAction(`${decision}-${entryId}`);
    setNotice(null);

    try {
      await accountingCallables.reviewOvertimeEntry({
        overtimeEntryId: entryId,
        decision,
        rejectionReason: rejectionReason?.trim() || null,
      });
      setNotice({ kind: 'success', message: decision === 'approved' ? 'Hora extra aprobada.' : 'Hora extra rechazada.' });
      await loadCycle();
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos revisar la hora extra.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleRecordCertificate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeId) {
      return;
    }

    setSubmittingAction('record-certificate');
    setNotice(null);

    try {
      await accountingCallables.recordEmployeeCertificate({
        employeeId,
        period: normalizeAccountingPeriod(selectedPeriod),
        certificateType: certificateForm.certificateType.trim(),
        documentNumber: certificateForm.documentNumber.trim() || null,
        issuedAt: certificateForm.issuedAt ? buildArgentinaDateIso(certificateForm.issuedAt) : null,
        expiresAt: certificateForm.expiresAt ? buildArgentinaDateIso(certificateForm.expiresAt) : null,
        attachmentUrl: certificateForm.attachmentUrl.trim() || null,
        notes: certificateForm.notes.trim() || null,
      });
      setNotice({ kind: 'success', message: 'Certificado vinculado al ciclo mensual.' });
      setCertificateForm((current) => ({ ...current, documentNumber: '', attachmentUrl: '', notes: '' }));
      await loadCycle();
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos cargar el certificado.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleRecordAndLinkReference = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeId) {
      return;
    }

    const amountMinor = parseAmountInputToMinor(referenceRecordForm.amountMinor);
    const allocatedAmountMinor = getOptionalAmount(referenceRecordForm.allocatedAmountMinor);

    if (!Number.isFinite(amountMinor) || amountMinor <= 0 || Number.isNaN(allocatedAmountMinor)) {
      setNotice({ kind: 'error', message: 'Revisa monto total y monto asignado del comprobante.' });
      return;
    }

    setSubmittingAction('record-reference');
    setNotice(null);

    try {
      const reference = await accountingCallables.upsertEmployeeExternalReference({
        employeeId,
        referenceType: referenceRecordForm.referenceType,
        period: normalizeAccountingPeriod(selectedPeriod),
        amountMinor,
        allocatedAmountMinor: allocatedAmountMinor ?? amountMinor,
        providerName: referenceRecordForm.providerName.trim() || null,
        referenceNumber: referenceRecordForm.referenceNumber.trim() || null,
        dueDate: referenceRecordForm.dueDate ? buildArgentinaDateIso(referenceRecordForm.dueDate) : null,
        documentDate: referenceRecordForm.documentDate ? buildArgentinaDateIso(referenceRecordForm.documentDate) : null,
        attachmentUrl: referenceRecordForm.attachmentUrl.trim() || null,
        paidAt: referenceRecordForm.paidAt ? buildArgentinaDateIso(referenceRecordForm.paidAt) : null,
        notes: referenceRecordForm.notes.trim() || null,
      });

      setNotice({
        kind: 'success',
        message: reference.duplicate
          ? `${referenceRecordForm.referenceType} actualizado para este empleado y mes.`
          : `${referenceRecordForm.referenceType} cargado y vinculado al empleado.`,
      });
      setReferenceRecordForm((current) => ({
        ...current,
        amountMinor: '',
        referenceNumber: '',
        attachmentUrl: '',
        allocatedAmountMinor: '',
        paidAt: '',
        notes: '',
      }));
      await loadCycle();
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos cargar el comprobante del empleado.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleLinkReference = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeId || !referenceLinkForm.referenceId) {
      setNotice({ kind: 'error', message: 'Selecciona una referencia externa para vincular.' });
      return;
    }

    const allocatedAmountMinor = getOptionalAmount(referenceLinkForm.allocatedAmountMinor);
    if (Number.isNaN(allocatedAmountMinor)) {
      setNotice({ kind: 'error', message: 'El monto asignado no es valido.' });
      return;
    }

    setSubmittingAction('link-reference');
    setNotice(null);

    try {
      await accountingCallables.linkExternalReferenceToEmployee({
        employeeId,
        period: normalizeAccountingPeriod(selectedPeriod),
        referenceId: referenceLinkForm.referenceId,
        allocatedAmountMinor: allocatedAmountMinor ?? null,
        paidAt: referenceLinkForm.paidAt ? buildArgentinaDateIso(referenceLinkForm.paidAt) : null,
        notes: referenceLinkForm.notes.trim() || null,
      });
      setNotice({ kind: 'success', message: 'Referencia vinculada al empleado.' });
      setReferenceLinkForm((current) => ({ ...current, allocatedAmountMinor: '', paidAt: '', notes: '' }));
      await loadCycle();
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos vincular la referencia.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handlePostPayroll = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeId) {
      return;
    }

    const salaryGrossMinor = getOptionalAmount(payrollForm.salaryGrossMinor);
    const bankedAmountMinor = getOptionalAmount(payrollForm.bankedAmountMinor);
    const nonBankedAmountMinor = getOptionalAmount(payrollForm.nonBankedAmountMinor);

    if ([salaryGrossMinor, bankedAmountMinor, nonBankedAmountMinor].some(Number.isNaN)) {
      setNotice({ kind: 'error', message: 'Revisa los montos de liquidacion.' });
      return;
    }

    setSubmittingAction('post-payroll');
    setNotice(null);

    try {
      const result = await accountingCallables.postEmployeePayrollCycle({
        employeeId,
        period: normalizeAccountingPeriod(selectedPeriod),
        linkedExternalReferenceIds: linkedReferenceIds,
        operationDate: buildArgentinaDateIso(payrollForm.operationDate),
        notes: payrollForm.notes.trim() || null,
        ...(payrollForm.salaryConfigurationId.trim()
          ? { salaryConfigurationId: payrollForm.salaryConfigurationId.trim() }
          : {}),
        ...(salaryGrossMinor !== undefined ? { salaryGrossMinor } : {}),
        ...(bankedAmountMinor !== undefined ? { bankedAmountMinor } : {}),
        ...(nonBankedAmountMinor !== undefined ? { nonBankedAmountMinor } : {}),
      });
      setNotice({
        kind: 'success',
        message: `Liquidacion posteada con ${result.financialMovementIds.length} movimientos.`,
      });
      await loadCycle();
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos postear la liquidacion.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  if (!canOperate) {
    return <div className="empty-state">La ficha contable del empleado esta disponible para administracion y Comité Ejecutivo.</div>;
  }

  if (!employeeId) {
    return <div className="empty-state">No encontramos el empleado solicitado.</div>;
  }

  return (
    <div className="page-container accounting-page">
      <div className="accounting-shell">
        <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <p className="eyebrow">Empleado - ciclo mensual</p>
            <h1>{getEmployeeDisplayName(snapshot.employee)}</h1>
            <p>
              Seguimiento de liquidacion, horas extra, aportes, F931, ART, obra social, certificados RT y movimientos
              asociados.
            </p>
          </div>
          <div className="accounting-hero__controls">
            <div className="accounting-hero__actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedPeriod(shiftAccountingPeriod(selectedPeriod, -1))}
              >
                Mes anterior
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedPeriod(shiftAccountingPeriod(selectedPeriod, 1))}
              >
                Mes siguiente
              </button>
            </div>
            <label className="form-field accounting-period-field">
              <span>Periodo</span>
              <input
                type="month"
                value={selectedPeriod}
                onChange={(event) => setSelectedPeriod(normalizeAccountingPeriod(event.target.value))}
              />
            </label>
            <div className="accounting-hero__actions">
              <Link className="btn-secondary" to="/accounting">
                Operacion contable
              </Link>
              <Link className="btn-secondary" to="/admin/employees">
                Empleados
              </Link>
            </div>
          </div>
        </section>

        {selectedSection && (
          <div className="accounting-success">
            Vista enfocada desde empleados: {selectedSection === 'salary' ? 'configuracion de sueldo' : 'comprobantes y rendiciones'}.
          </div>
        )}

        {notice && <div className={notice.kind === 'error' ? 'error-message' : 'accounting-success'}>{notice.message}</div>}
        {loading && (
          <div className="loading-state loading-state--inline accounting-loading-inline">
            <span className="loading-spinner" />
            <strong>Obteniendo ciclo mensual</strong>
          </div>
        )}

        <CycleSummary snapshot={snapshot} />

        <div className="accounting-layout">
          <section className="floating-card accounting-primary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Horas extra</p>
                <h2>Carga y aprobacion</h2>
              </div>
            </div>

            <form className="accounting-entry-form" onSubmit={handleCreateOvertime}>
              <label className="form-field">
                <span>Fecha trabajada</span>
                <input
                  type="date"
                  value={overtimeForm.workDate}
                  onChange={(event) => setOvertimeForm((current) => ({ ...current, workDate: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Horas</span>
                <input
                  value={overtimeForm.hours}
                  onChange={(event) => setOvertimeForm((current) => ({ ...current, hours: event.target.value }))}
                  placeholder="2"
                />
              </label>
              <label className="form-field">
                <span>Monto</span>
                <input
                  value={overtimeForm.amountMinor}
                  onChange={(event) => setOvertimeForm((current) => ({ ...current, amountMinor: event.target.value }))}
                  placeholder="15000"
                />
              </label>
              <label className="form-field">
                <span>Motivo</span>
                <input
                  value={overtimeForm.reason}
                  onChange={(event) => setOvertimeForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Notas</span>
                <textarea
                  value={overtimeForm.notes}
                  onChange={(event) => setOvertimeForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={submittingAction === 'create-overtime'}>
                  {submittingAction === 'create-overtime' ? 'Cargando...' : 'Cargar hora extra'}
                </button>
              </div>
            </form>

            <div className="accounting-list">
              {snapshot.overtimeEntries.map((entry) => (
                <article key={entry.id} className="accounting-row accounting-row--actions">
                  <div className="accounting-row__main">
                    <strong>{entry.reason}</strong>
                    <small>
                      {entry.hours} horas - {formatTimestamp(entry.workDate)}
                    </small>
                  </div>
                  <div className="accounting-row__meta">
                    <span className={`status-chip status-chip--${entry.status}`}>{entry.status}</span>
                    <strong>{formatCurrency(entry.amountMinor)}</strong>
                  </div>
                  {canPostPayroll && entry.status === 'submitted' && (
                    <div className="accounting-inline-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={submittingAction === `approved-${entry.id}`}
                        onClick={() => void handleReviewOvertime(entry.id, 'approved')}
                      >
                        Aprobar
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={submittingAction === `rejected-${entry.id}`}
                        onClick={() => void handleReviewOvertime(entry.id, 'rejected')}
                      >
                        Rechazar
                      </button>
                    </div>
                  )}
                </article>
              ))}
              {!loading && snapshot.overtimeEntries.length === 0 && (
                <div className="empty-state empty-state--inline">No hay horas extra para {formatPeriod(selectedPeriod)}.</div>
              )}
            </div>
          </section>

          <section className="floating-card accounting-secondary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Certificados</p>
                <h2>RT y documentacion laboral</h2>
              </div>
            </div>

            <form className="accounting-entry-form" onSubmit={handleRecordCertificate}>
              <label className="form-field">
                <span>Tipo</span>
                <input
                  value={certificateForm.certificateType}
                  onChange={(event) => setCertificateForm((current) => ({ ...current, certificateType: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Numero</span>
                <input
                  value={certificateForm.documentNumber}
                  onChange={(event) => setCertificateForm((current) => ({ ...current, documentNumber: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Emitido</span>
                <input
                  type="date"
                  value={certificateForm.issuedAt}
                  onChange={(event) => setCertificateForm((current) => ({ ...current, issuedAt: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Vence</span>
                <input
                  type="date"
                  value={certificateForm.expiresAt}
                  onChange={(event) => setCertificateForm((current) => ({ ...current, expiresAt: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Adjunto URL</span>
                <input
                  value={certificateForm.attachmentUrl}
                  onChange={(event) => setCertificateForm((current) => ({ ...current, attachmentUrl: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Notas</span>
                <textarea
                  value={certificateForm.notes}
                  onChange={(event) => setCertificateForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={submittingAction === 'record-certificate'}>
                  {submittingAction === 'record-certificate' ? 'Guardando...' : 'Guardar certificado'}
                </button>
              </div>
            </form>

            <div className="accounting-list">
              {snapshot.certificates.map((certificate) => (
                <article key={certificate.id} className="accounting-row">
                  <div className="accounting-row__main">
                    <strong>{certificate.certificateType}</strong>
                    <small>{certificate.documentNumber ?? 'Sin numero'}</small>
                  </div>
                  <div className="accounting-row__meta">
                    <span className={`status-chip status-chip--${certificate.status}`}>{certificate.status}</span>
                    <small>Vence {formatTimestamp(certificate.expiresAt)}</small>
                  </div>
                </article>
              ))}
              {!loading && snapshot.certificates.length === 0 && (
                <div className="empty-state empty-state--inline">No hay certificados cargados para este ciclo.</div>
              )}
            </div>
          </section>
        </div>

        <div className="accounting-layout">
          <section className="floating-card accounting-primary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Aportes y referencias</p>
                <h2>F931, ART, obra social y otros</h2>
              </div>
            </div>

            <form className="accounting-entry-form" onSubmit={handleRecordAndLinkReference}>
              <label className="form-field">
                <span>Tipo</span>
                <select
                  value={referenceRecordForm.referenceType}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({
                      ...current,
                      referenceType: event.target.value as ExternalReferenceType,
                    }))
                  }
                >
                  {ACCOUNTING_REFERENCE_TYPES.map((referenceType) => (
                    <option key={referenceType} value={referenceType}>
                      {referenceType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Monto total</span>
                <input
                  value={referenceRecordForm.amountMinor}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({ ...current, amountMinor: event.target.value }))
                  }
                  placeholder="35000"
                />
              </label>
              <label className="form-field">
                <span>Proveedor</span>
                <input
                  value={referenceRecordForm.providerName}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({ ...current, providerName: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Numero</span>
                <input
                  value={referenceRecordForm.referenceNumber}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({ ...current, referenceNumber: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Fecha documento</span>
                <input
                  type="date"
                  value={referenceRecordForm.documentDate}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({ ...current, documentDate: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Vencimiento</span>
                <input
                  type="date"
                  value={referenceRecordForm.dueDate}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({ ...current, dueDate: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Monto asignado al empleado</span>
                <input
                  value={referenceRecordForm.allocatedAmountMinor}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({ ...current, allocatedAmountMinor: event.target.value }))
                  }
                  placeholder="Si queda vacio usa el total"
                />
              </label>
              <label className="form-field">
                <span>Pagado el</span>
                <input
                  type="date"
                  value={referenceRecordForm.paidAt}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({ ...current, paidAt: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Adjunto URL</span>
                <input
                  value={referenceRecordForm.attachmentUrl}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({ ...current, attachmentUrl: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Notas</span>
                <textarea
                  value={referenceRecordForm.notes}
                  onChange={(event) =>
                    setReferenceRecordForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={submittingAction === 'record-reference'}>
                  {submittingAction === 'record-reference' ? 'Guardando...' : 'Cargar comprobante del empleado'}
                </button>
              </div>
            </form>

            <form className="accounting-entry-form" onSubmit={handleLinkReference}>
              <label className="form-field">
                <span>Referencia externa</span>
                <select
                  value={referenceLinkForm.referenceId}
                  onChange={(event) => setReferenceLinkForm((current) => ({ ...current, referenceId: event.target.value }))}
                >
                  <option value="">Seleccionar referencia</option>
                  {snapshot.externalReferences.map((reference) => (
                    <option key={reference.id} value={reference.id}>
                      {reference.referenceType} - {reference.providerName ?? 'Sin proveedor'} - {formatCurrency(reference.amountMinor)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Monto asignado</span>
                <input
                  value={referenceLinkForm.allocatedAmountMinor}
                  onChange={(event) =>
                    setReferenceLinkForm((current) => ({ ...current, allocatedAmountMinor: event.target.value }))
                  }
                  placeholder="Opcional"
                />
              </label>
              <label className="form-field">
                <span>Pagado el</span>
                <input
                  type="date"
                  value={referenceLinkForm.paidAt}
                  onChange={(event) => setReferenceLinkForm((current) => ({ ...current, paidAt: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Notas</span>
                <textarea
                  value={referenceLinkForm.notes}
                  onChange={(event) => setReferenceLinkForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={submittingAction === 'link-reference'}>
                  {submittingAction === 'link-reference' ? 'Vinculando...' : 'Vincular referencia'}
                </button>
              </div>
            </form>

            <div className="accounting-topic-list">
              {ACCOUNTING_REFERENCE_TYPES.map((referenceType) => (
                <span key={referenceType}>{referenceType}</span>
              ))}
            </div>
          </section>

          <section className="floating-card accounting-secondary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Links del ciclo</p>
                <h2>Obligaciones asignadas</h2>
              </div>
            </div>

            <div className="accounting-list">
              {snapshot.accountingLinks.map((link) => (
                <article key={link.id} className="accounting-row">
                  <div className="accounting-row__main">
                    <strong>{link.referenceType}</strong>
                    <small>Referencia {link.referenceId}</small>
                  </div>
                  <div className="accounting-row__meta">
                    <span className={`status-chip status-chip--${link.status}`}>{link.status}</span>
                    <strong>{formatCurrency(link.allocatedAmountMinor ?? 0)}</strong>
                    <small>{link.paidAt ? `Pagado ${formatTimestamp(link.paidAt)}` : 'Sin fecha de pago'}</small>
                  </div>
                </article>
              ))}
              {!loading && snapshot.accountingLinks.length === 0 && (
                <div className="empty-state empty-state--inline">No hay referencias vinculadas a este empleado.</div>
              )}
            </div>
          </section>
        </div>

        {canPostPayroll && (
          <section className="floating-card accounting-owner-footer">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Comité Ejecutivo</p>
                <h2>Postear liquidacion y movimientos</h2>
              </div>
            </div>

            <form className="accounting-entry-form" onSubmit={handlePostPayroll}>
              <label className="form-field">
                <span>ID configuracion salarial</span>
                <input
                  value={payrollForm.salaryConfigurationId}
                  onChange={(event) =>
                    setPayrollForm((current) => ({ ...current, salaryConfigurationId: event.target.value }))
                  }
                  placeholder="Opcional si existe activa"
                />
              </label>
              <label className="form-field">
                <span>Sueldo bruto</span>
                <input
                  value={payrollForm.salaryGrossMinor}
                  onChange={(event) => setPayrollForm((current) => ({ ...current, salaryGrossMinor: event.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <label className="form-field">
                <span>Monto bancarizado</span>
                <input
                  value={payrollForm.bankedAmountMinor}
                  onChange={(event) => setPayrollForm((current) => ({ ...current, bankedAmountMinor: event.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <label className="form-field">
                <span>Monto no bancarizado</span>
                <input
                  value={payrollForm.nonBankedAmountMinor}
                  onChange={(event) =>
                    setPayrollForm((current) => ({ ...current, nonBankedAmountMinor: event.target.value }))
                  }
                  placeholder="Opcional"
                />
              </label>
              <label className="form-field">
                <span>Fecha de pago</span>
                <input
                  type="date"
                  value={payrollForm.operationDate}
                  onChange={(event) => setPayrollForm((current) => ({ ...current, operationDate: event.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>Notas</span>
                <textarea
                  value={payrollForm.notes}
                  onChange={(event) => setPayrollForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={submittingAction === 'post-payroll'}>
                  {submittingAction === 'post-payroll' ? 'Posteando...' : 'Postear liquidacion'}
                </button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}

export const AccountingEmployeeDetail = EmployeeAccountingPage;
