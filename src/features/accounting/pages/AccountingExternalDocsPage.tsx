import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { UiActionButton } from '../../../components/UiActionButton';
import { ACCOUNTING_REFERENCE_TYPES, getAccountingReferenceTypeLabel } from '../../../modules/accounting/domain/constants';
import type { AccountingPeriod, ExternalReferenceType, PaymentMethodDocument, RecordExternalReferenceResult } from '../../../modules/accounting/domain/models';
import { createEmployeeAccountingLinksRepository, createPaymentMethodsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { createEmployeesRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import type { EntityWithId, EmployeeDocument } from '../../../modules/users/domain/models';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { AccountingOperationModal } from '../components/AccountingOperationModal';
import { useExternalDocuments } from '../hooks/useExternalDocuments';
import type { AccountingNotice } from '../types/accounting';
import { buildArgentinaDateIso, formatCurrency, formatPeriod, formatTimestamp, normalizeAccountingPeriod, parseAmountInputToMinor } from '../utils/accountingFormatters';
import './AccountingExternalDocsPage.css';

const LABOR_CREDITORS: Partial<Record<ExternalReferenceType, string>> = {
  F931: 'Arca',
  ART: 'Latitud Sur',
  OBRA_SOCIAL: 'Salud Jujuy',
};

function getLaborCreditor(referenceType: ExternalReferenceType) {
  return LABOR_CREDITORS[referenceType] ?? '';
}

function getExternalReferenceStatusLabel(status: 'recorded' | 'linked' | 'paid') {
  return { recorded: 'Registrado', linked: 'Vinculado', paid: 'Pagado' }[status];
}

function getArgentinaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (part: 'year' | 'month' | 'day') => parts.find((item) => item.type === part)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function getArgentinaPeriod(): AccountingPeriod {
  return getArgentinaToday().slice(0, 7) as AccountingPeriod;
}

function createInitialDocumentForm() {
  return {
    referenceType: 'F931' as ExternalReferenceType,
    amount: '',
    providerName: getLaborCreditor('F931'),
    referenceNumber: '',
    dueDate: '',
    documentDate: getArgentinaToday(),
    operationDate: getArgentinaToday(),
    paymentMethodId: '',
  };
}

export function AccountingExternalDocsPage() {
  const [period, setPeriod] = useState(getArgentinaPeriod);
  const externalDocs = useExternalDocuments(period);
  const [employees, setEmployees] = useState<Array<EntityWithId<EmployeeDocument>>>([]);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<(typeof externalDocs.documents)[number] | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<(typeof externalDocs.documents)[number] | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [linkedEmployees, setLinkedEmployees] = useState<Array<EntityWithId<EmployeeDocument>>>([]);
  const [formPeriod, setFormPeriod] = useState(getArgentinaPeriod);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [form, setForm] = useState(createInitialDocumentForm);
  const [paymentMethods, setPaymentMethods] = useState<Array<EntityWithId<PaymentMethodDocument>>>([]);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingLinks, setPendingLinks] = useState<Array<{ referenceId: string; period: AccountingPeriod; employeeIds: string[] }>>([]);
  const [isRelinking, setIsRelinking] = useState(false);
  const [createdReferenceId, setCreatedReferenceId] = useState<string | null>(null);
  const requestAttempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const [createdDocumentConfirmation, setCreatedDocumentConfirmation] = useState<{
    referenceType: ExternalReferenceType;
    period: string;
    employeeCount: number;
    failedCount: number;
  } | null>(null);
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === 'active'), [employees]);
  const documentsTotalMinor = useMemo(
    () => externalDocs.documents.reduce((total, document) => total + document.amountMinor, 0),
    [externalDocs.documents],
  );

  useEffect(() => {
    const repository = createEmployeesRepository();
    void repository.listAlphabetical(500).then(setEmployees);
    void createPaymentMethodsRepository().listActiveSorted().then((methods) => {
      setPaymentMethods(methods);
      setForm((current) => ({ ...current, paymentMethodId: current.paymentMethodId || methods[0]?.id || '' }));
    });
  }, []);

  useEffect(() => {
    setFeedbackDismissed(false);
  }, [notice, externalDocs.error]);

  useEffect(() => {
    if (selectedDocument) {
      const repository = createEmployeeAccountingLinksRepository();
      void repository.listByReferenceAndPeriod(selectedDocument.id, selectedDocument.period).then((links) => {
        const linkedIds = new Set(links.map((l) => l.employeeId));
        setLinkedEmployees(employees.filter((e) => linkedIds.has(e.id)));
      });
    } else {
      setLinkedEmployees([]);
    }
  }, [selectedDocument, employees]);

  const handleReferenceTypeChange = (referenceType: ExternalReferenceType) => {
    const creditor = getLaborCreditor(referenceType);
    setForm((current) => ({
      ...current,
      referenceType,
      providerName: creditor || current.providerName,
    }));
  };

  const toggleEmployeeSelection = (employeeId: string) => {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) {
        next.delete(employeeId);
      } else {
        next.add(employeeId);
      }
      return next;
    });
  };

  const selectAllEmployees = () => {
    setSelectedEmployeeIds(new Set(activeEmployees.map((e) => e.id)));
  };

  const deselectAllEmployees = () => {
    setSelectedEmployeeIds(new Set());
  };

  const linkSelectedEmployees = async (referenceId: string, targetPeriod: AccountingPeriod, employeeIds: string[]) => {
    const results = await Promise.allSettled(employeeIds.map((employeeId) => externalDocs.linkExternalReferenceToEmployee({
      employeeId,
      period: targetPeriod,
      referenceId,
      notes: `Documento laboral vinculado automaticamente al periodo ${targetPeriod}.`,
    })));
    return employeeIds.filter((_, index) => results[index]?.status === 'rejected');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCreating) return;
    const amountMinor = parseAmountInputToMinor(form.amount);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresa un monto valido.' });
      return;
    }
    if (!form.operationDate) {
      setNotice({ kind: 'error', message: 'Selecciona la fecha del pago.' });
      return;
    }
    if (!form.paymentMethodId) {
      setNotice({ kind: 'error', message: 'Selecciona un medio de pago.' });
      return;
    }

    const targetPeriod = formPeriod;
    const selectedIds = activeEmployees.filter((employee) => selectedEmployeeIds.has(employee.id)).map((employee) => employee.id);
    const creditor = getLaborCreditor(form.referenceType) || form.providerName.trim();
    const payload = {
      referenceType: form.referenceType,
      period: targetPeriod,
      amountMinor,
      providerName: creditor || null,
      referenceNumber: form.referenceNumber.trim() || null,
      dueDate: form.dueDate ? buildArgentinaDateIso(form.dueDate) : null,
      documentDate: form.documentDate ? buildArgentinaDateIso(form.documentDate) : null,
      operationDate: buildArgentinaDateIso(form.operationDate),
      paymentMethodId: form.paymentMethodId,
    };
    const fingerprint = JSON.stringify(payload);
    const previousAttempt = requestAttempt.current;
    const requestId = previousAttempt && previousAttempt.fingerprint === fingerprint
      ? previousAttempt.requestId
      : (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`);
    requestAttempt.current = { fingerprint, requestId };
    setIsCreating(true);
    setNotice({ kind: 'info', message: 'Generando el pago y el documento laboral...' });
    let result: RecordExternalReferenceResult;
    try {
      result = await externalDocs.recordExternalReference({ ...payload, requestId });
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `${error instanceof Error ? error.message : 'No pudimos confirmar el pago.'} Si la conexion se interrumpio, revisa el listado antes de reintentar; el mismo intento no duplicara el pago.`,
      });
      setIsCreating(false);
      return;
    }

    const failedEmployeeIds = await linkSelectedEmployees(result.referenceId, targetPeriod, selectedIds);
    setPendingLinks((current) => [
      ...current.filter((item) => item.referenceId !== result.referenceId),
      ...(failedEmployeeIds.length > 0 ? [{ referenceId: result.referenceId, period: targetPeriod, employeeIds: failedEmployeeIds }] : []),
    ]);
    setCreatedReferenceId(result.referenceId);
    setOpenSectionId('documents');
    let listLoaded = false;
    try {
      await externalDocs.reload(targetPeriod);
      listLoaded = true;
    } catch {
      // El pago ya se confirmo; un error de lectura no debe ofrecer crear otro.
    } finally {
      setPeriod(targetPeriod);
      setIsCreating(false);
      requestAttempt.current = null;
    }
    const linkedCount = selectedIds.length - failedEmployeeIds.length;
    if (!listLoaded) {
      setNotice({ kind: 'info', message: `Pago y documento ${form.referenceType} registrados. No se pudo actualizar el listado; usa "Actualizar listado" para verlo.` });
    } else if (failedEmployeeIds.length > 0) {
      setNotice({ kind: 'info', message: `Pago y documento ${form.referenceType} registrados. ${linkedCount} de ${selectedIds.length} vinculos completados; puedes reintentar los pendientes.` });
    } else {
      setNotice({ kind: 'success', message: `Pago y documento ${form.referenceType} registrados para ${formatPeriod(targetPeriod)}${selectedIds.length ? ` y vinculados a ${linkedCount} empleados` : ''}.` });
    }
    setCreatedDocumentConfirmation({ referenceType: form.referenceType, period: targetPeriod, employeeCount: linkedCount, failedCount: failedEmployeeIds.length });
    setForm({ ...createInitialDocumentForm(), paymentMethodId: paymentMethods[0]?.id || '' });
    setFormPeriod(getArgentinaPeriod());
    setSelectedEmployeeIds(new Set());
  };

  const handleRetryLinks = async (pending: (typeof pendingLinks)[number]) => {
    if (isRelinking) return;
    setIsRelinking(true);
    const failed = await linkSelectedEmployees(pending.referenceId, pending.period, pending.employeeIds);
    setPendingLinks((current) => current.flatMap((item) => item.referenceId === pending.referenceId
      ? (failed.length ? [{ ...item, employeeIds: failed }] : [])
      : [item]));
    setNotice(failed.length
      ? { kind: 'info', message: `Documento y pago registrados. Quedan ${failed.length} vinculos pendientes.` }
      : { kind: 'success', message: 'Los empleados pendientes quedaron vinculados al documento.' });
    setIsRelinking(false);
  };

  const handleRefreshList = async () => {
    try {
      await externalDocs.reload(period);
      setNotice({ kind: 'success', message: 'Listado de documentos actualizado.' });
    } catch {
      setNotice({ kind: 'error', message: 'No pudimos actualizar el listado. Intentalo de nuevo.' });
    } finally {
      setOpenSectionId('documents');
    }
  };

  const handleDeleteDocument = async () => {
    if (!documentToDelete) return;
    setIsDeleting(true);
    try {
      await externalDocs.deleteExternalReference({ referenceId: documentToDelete.id });
      setDocumentToDelete(null);
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Error al eliminar el documento.' });
      setIsDeleting(false);
      return;
    }
    try {
      await externalDocs.reload();
      setNotice({ kind: 'success', message: 'Documento laboral eliminado con exito.' });
    } catch {
      setNotice({ kind: 'info', message: 'Documento laboral eliminado. No pudimos actualizar el listado; usa "Actualizar listado".' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="accounting-shell accounting-external-docs-page">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <h1>Documentos laborales</h1>
        </div>
        <div className="accounting-hero__controls">
          <AccountingMonthPicker period={normalizeAccountingPeriod(period)} onChange={setPeriod} />
        </div>
      </section>

      {!feedbackDismissed && (notice || externalDocs.error) && (
        <div className="accounting-external-docs-feedback">
          <button className="accounting-external-docs-feedback__close" type="button" aria-label="Cerrar notificacion" title="Cerrar" onClick={() => setFeedbackDismissed(true)}>×</button>
          <AccountingInlineNotice notice={notice ?? { kind: 'error', message: externalDocs.error }} />
          {externalDocs.error && (
            <UiActionButton type="button" variant="secondary" compact disabled={externalDocs.loading} onClick={() => void handleRefreshList()}>
              Actualizar listado
            </UiActionButton>
          )}
        </div>
      )}

      {pendingLinks.length > 0 && (
        <div className="accounting-external-docs-pending">
          <strong>Vinculos con empleados pendientes</strong>
          {pendingLinks.map((pending) => (
            <UiActionButton key={pending.referenceId} type="button" variant="secondary" compact disabled={isRelinking} onClick={() => void handleRetryLinks(pending)}>
              {isRelinking ? 'Vinculando...' : `Reintentar ${pending.employeeIds.length} vinculos de ${formatPeriod(pending.period)}`}
            </UiActionButton>
          ))}
        </div>
      )}

      <section className="summary-grid accounting-summary-grid accounting-external-docs-summary" aria-label="Resumen de documentos laborales">
        <article className="summary-card"><span>Periodo</span><strong>{formatPeriod(period)}</strong><small>Seleccionado</small></article>
        <article className="summary-card"><span>Documentos</span><strong>{externalDocs.documents.length}</strong><small>Registrados</small></article>
        <article className="summary-card"><span>Total</span><strong>{formatCurrency(documentsTotalMinor)}</strong><small>Importe del periodo</small></article>
        <article className="summary-card"><span>Empleados activos</span><strong>{activeEmployees.length}</strong><small>Vinculacion automatica</small></article>
      </section>

      <div className="accounting-external-docs-sections">
        <AccountingCollapsibleSections
          openId={openSectionId}
          onOpenChange={setOpenSectionId}
          sections={[
            {
              id: 'create',
              title: 'Crear documento laboral',
              eyebrow: 'Documento laboral',
              helper: 'F931, ART, obra social u otro',
              content: (
                <div className="accounting-full-width-section">
                  <form className="accounting-entry-form accounting-external-docs-form" onSubmit={handleSubmit} aria-busy={isCreating}>
                    <label className="form-field">
                      <span>Tipo</span>
                      <select value={form.referenceType} onChange={(event) => handleReferenceTypeChange(event.target.value as ExternalReferenceType)}>
                        {ACCOUNTING_REFERENCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </label>
                    <label className="form-field"><span>Acreedor</span><input value={form.providerName} readOnly={Boolean(getLaborCreditor(form.referenceType))} onChange={(event) => setForm((current) => ({ ...current, providerName: event.target.value }))} /></label>
                    <label className="form-field"><span>Monto</span><input inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></label>
                    <label className="form-field"><span>Numero de referencia</span><input value={form.referenceNumber} onChange={(event) => setForm((current) => ({ ...current, referenceNumber: event.target.value }))} /></label>
                    <label className="form-field"><span>Fecha documento</span><input type="date" value={form.documentDate} onChange={(event) => setForm((current) => ({ ...current, documentDate: event.target.value }))} /></label>
                    <label className="form-field"><span>Vencimiento</span><input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} /></label>
                    <label className="form-field"><span>Fecha del pago</span><input type="date" value={form.operationDate} onChange={(event) => setForm((current) => ({ ...current, operationDate: event.target.value }))} /></label>
                    <label className="form-field">
                      <span>Medio de pago</span>
                      <select value={form.paymentMethodId} onChange={(event) => setForm((current) => ({ ...current, paymentMethodId: event.target.value }))}>
                        <option value="">Seleccionar</option>
                        {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                      </select>
                    </label>
                    <div className="form-field">
                      <span>Periodo de Creacion</span>
                      <AccountingMonthPicker period={normalizeAccountingPeriod(formPeriod)} onChange={setFormPeriod} />
                    </div>
                    <div className="accounting-inline-summary form-field--wide">
                      <span>Vinculacion</span>
                      <strong>{selectedEmployeeIds.size} empleados seleccionados</strong>
                      <small>La vinculacion es opcional. Los empleados seleccionados se enlazaran al periodo {formatPeriod(formPeriod)}.</small>
                    </div>
                    <div className="form-field--wide">
                      <div className="accounting-inline-actions" style={{ marginBottom: '0.5rem' }}>
                        <UiActionButton type="button" variant="secondary" compact onClick={selectAllEmployees}>Seleccionar todos</UiActionButton>
                        <UiActionButton type="button" variant="secondary" compact onClick={deselectAllEmployees}>Deseleccionar todos</UiActionButton>
                      </div>
                      <div className="accounting-table-wrap" style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)' }}>
                        <table className="accounting-data-table">
                          <thead>
                            <tr>
                              <th style={{ width: '40px', textAlign: 'center' }}></th>
                              <th>Empleado</th>
                              <th>Puesto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeEmployees.map((employee) => (
                              <tr key={employee.id} onClick={() => toggleEmployeeSelection(employee.id)} style={{ cursor: 'pointer' }}>
                                <td style={{ textAlign: 'center' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={selectedEmployeeIds.has(employee.id)} 
                                    readOnly 
                                    style={{ pointerEvents: 'none' }}
                                  />
                                </td>
                                <td>{employee.lastName}, {employee.firstName}</td>
                                <td>{employee.position}</td>
                              </tr>
                            ))}
                            {activeEmployees.length === 0 && (
                              <tr>
                                <td colSpan={3} style={{ textAlign: 'center', padding: '1rem' }}>No hay empleados activos.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="form-actions form-actions--right">
                      <UiActionButton type="submit" disabled={isCreating}>
                        {isCreating && <span className="accounting-external-docs-spinner" aria-hidden="true" />}
                        {isCreating ? 'Generando...' : 'Generar pago y documento'}
                      </UiActionButton>
                    </div>
                  </form>
                </div>
              ),
            },
            {
              id: 'documents',
              title: 'Documentos de este periodo',
              eyebrow: `Historial ${formatPeriod(period)}`,
              helper: `${externalDocs.documents.length} comprobantes`,
              content: (
                <div className="accounting-full-width-section">
                  <div className="accounting-list accounting-external-docs-list">
                    {externalDocs.documents.map((document) => (
                      <article key={document.id} className={`accounting-row accounting-row--actions ${document.id === createdReferenceId ? 'accounting-external-docs-row--created' : ''}`}>
                        <div className="accounting-row__main">
                          <strong>{getAccountingReferenceTypeLabel(document.referenceType)}</strong>
                          <small>{document.providerName ?? 'Sin proveedor'} - {document.referenceNumber ?? 'Sin numero'} - {formatTimestamp(document.documentDate)}</small>
                        </div>
                        <div className="accounting-row__meta">
                          <span className={`status-chip status-chip--${document.status}`}>{getExternalReferenceStatusLabel(document.status)}</span>
                          <strong>{formatCurrency(document.amountMinor)}</strong>
                        </div>
                        <div className="accounting-inline-actions">
                          <UiActionButton type="button" variant="danger" compact onClick={() => setDocumentToDelete(document)}>
                            Borrar
                          </UiActionButton>
                          <UiActionButton type="button" variant="secondary" compact onClick={() => setSelectedDocument(document)}>
                            Ver detalle
                          </UiActionButton>
                        </div>
                      </article>
                    ))}
                    {!externalDocs.loading && externalDocs.documents.length === 0 && <AccountingEmptyState title="Sin documentos para este periodo" />}
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
      {createdDocumentConfirmation && (
        <AccountingOperationModal
          title="Documento laboral creado"
          meta={`${getAccountingReferenceTypeLabel(createdDocumentConfirmation.referenceType)} - ${formatPeriod(createdDocumentConfirmation.period)}`}
          onClose={() => setCreatedDocumentConfirmation(null)}
        >
          <div className="accounting-full-width-section">
            <div className="accounting-inline-summary">
              <span>Creacion confirmada</span>
              <strong>El documento y su egreso contable se registraron correctamente.</strong>
              <small>
                {createdDocumentConfirmation.employeeCount > 0
                  ? `Se vinculo a ${createdDocumentConfirmation.employeeCount} empleado${createdDocumentConfirmation.employeeCount === 1 ? '' : 's'}.`
                  : 'Se registro sin vincular empleados.'}
                {createdDocumentConfirmation.failedCount > 0 ? ` Quedan ${createdDocumentConfirmation.failedCount} vinculos pendientes.` : ''}
              </small>
            </div>
            <div className="form-actions form-actions--right"><UiActionButton type="button" onClick={() => setCreatedDocumentConfirmation(null)}>Entendido</UiActionButton></div>
          </div>
        </AccountingOperationModal>
      )}
      {selectedDocument && (
        <AccountingOperationModal title="Detalle del documento laboral" meta={`${getAccountingReferenceTypeLabel(selectedDocument.referenceType)} - ${formatPeriod(selectedDocument.period)}`} onClose={() => setSelectedDocument(null)}>
          <div className="accounting-full-width-section">
            <div className="summary-grid accounting-summary-grid">
              <article className="summary-card"><span>Acreedor</span><strong>{selectedDocument.providerName ?? 'Sin acreedor'}</strong><small>{selectedDocument.referenceNumber ?? 'Sin numero'}</small></article>
              <article className="summary-card"><span>Monto</span><strong>{formatCurrency(selectedDocument.amountMinor)}</strong><small>{getExternalReferenceStatusLabel(selectedDocument.status)}</small></article>
              <article className="summary-card"><span>Documento</span><strong>{formatTimestamp(selectedDocument.documentDate)}</strong><small>Vence {formatTimestamp(selectedDocument.dueDate)}</small></article>
              <article className="summary-card"><span>Empleados vinculados</span><strong>{linkedEmployees.length}</strong><small>En periodo {formatPeriod(selectedDocument.period)}</small></article>
            </div>
            <div className="accounting-table-wrap">
              <table className="accounting-data-table">
                <thead><tr><th>Empleado</th><th>Legajo</th><th>Puesto</th><th>Estado</th></tr></thead>
                <tbody>
                  {linkedEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td>{employee.lastName}, {employee.firstName}</td>
                      <td>{employee.employeeCode ?? employee.id}</td>
                      <td>{employee.position}</td>
                      <td>Vinculado</td>
                    </tr>
                  ))}
                  {linkedEmployees.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '1rem' }}>No hay empleados vinculados o cargando...</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </AccountingOperationModal>
      )}

      <ConfirmDialog
        open={Boolean(documentToDelete)}
        title="Eliminar documento laboral"
        description={<p>¿Estas seguro que deseas eliminar el documento laboral de {documentToDelete ? getAccountingReferenceTypeLabel(documentToDelete.referenceType) : ''} por <strong>{documentToDelete ? formatCurrency(documentToDelete.amountMinor) : ''}</strong>? Si genero un egreso, el sistema lo revertira para quitar su impacto de caja. Tambien eliminara los enlaces a los empleados. Esta accion no se puede deshacer.</p>}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        tone="danger"
        loading={isDeleting}
        onCancel={() => setDocumentToDelete(null)}
        onConfirm={() => { void handleDeleteDocument(); }}
      />
    </div>
  );
}
