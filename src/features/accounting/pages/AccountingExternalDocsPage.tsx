import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { UiActionButton } from '../../../components/UiActionButton';
import { ACCOUNTING_REFERENCE_TYPES, getAccountingReferenceTypeLabel } from '../../../modules/accounting/domain/constants';
import type { ExternalReferenceType } from '../../../modules/accounting/domain/models';
import { createEmployeesRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import type { EntityWithId, EmployeeDocument } from '../../../modules/users/domain/models';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { AccountingOperationModal } from '../components/AccountingOperationModal';
import { useExternalDocuments } from '../hooks/useExternalDocuments';
import type { AccountingNotice } from '../types/accounting';
import { buildArgentinaDateIso, formatCurrency, formatPeriod, formatTimestamp, getCurrentAccountingPeriod, normalizeAccountingPeriod, parseAmountInputToMinor } from '../utils/accountingFormatters';

const LABOR_CREDITORS: Partial<Record<ExternalReferenceType, string>> = {
  F931: 'Arca',
  ART: 'Latitud Sur',
  OBRA_SOCIAL: 'Salud Jujuy',
};

function getLaborCreditor(referenceType: ExternalReferenceType) {
  return LABOR_CREDITORS[referenceType] ?? '';
}

export function AccountingExternalDocsPage() {
  const [period, setPeriod] = useState(getCurrentAccountingPeriod());
  const externalDocs = useExternalDocuments(period);
  const [employees, setEmployees] = useState<Array<EntityWithId<EmployeeDocument>>>([]);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [selectedDocument, setSelectedDocument] = useState<(typeof externalDocs.documents)[number] | null>(null);
  const [form, setForm] = useState({
    referenceType: 'F931' as ExternalReferenceType,
    amount: '',
    providerName: getLaborCreditor('F931'),
    referenceNumber: '',
    dueDate: '',
    documentDate: new Date().toISOString().slice(0, 10),
  });
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === 'active'), [employees]);
  const documentsTotalMinor = useMemo(
    () => externalDocs.documents.reduce((total, document) => total + document.amountMinor, 0),
    [externalDocs.documents],
  );

  useEffect(() => {
    const repository = createEmployeesRepository();
    void repository.listAlphabetical(500).then(setEmployees);
  }, []);

  const handleReferenceTypeChange = (referenceType: ExternalReferenceType) => {
    const creditor = getLaborCreditor(referenceType);
    setForm((current) => ({
      ...current,
      referenceType,
      providerName: creditor || current.providerName,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(form.amount);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresa un monto valido.' });
      return;
    }

    try {
      const creditor = getLaborCreditor(form.referenceType) || form.providerName.trim();
      const result = await externalDocs.recordExternalReference({
        referenceType: form.referenceType,
        period,
        amountMinor,
        providerName: creditor || null,
        referenceNumber: form.referenceNumber.trim() || null,
        dueDate: form.dueDate ? buildArgentinaDateIso(form.dueDate) : null,
        documentDate: form.documentDate ? buildArgentinaDateIso(form.documentDate) : null,
      });
      await Promise.all(activeEmployees.map((employee) => externalDocs.linkExternalReferenceToEmployee({
        employeeId: employee.id,
        period,
        referenceId: result.referenceId,
        allocatedAmountMinor: null,
        notes: `${form.referenceType} vinculado automaticamente al periodo ${period}.`,
      })));
      setNotice({ kind: 'success', message: `Documento laboral creado y vinculado a ${activeEmployees.length} empleados activos.` });
      setForm((current) => ({ ...current, amount: '', providerName: getLaborCreditor(current.referenceType), referenceNumber: '' }));
      await externalDocs.reload();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos crear el documento.' });
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

      <AccountingInlineNotice notice={notice ?? (externalDocs.error ? { kind: 'error', message: externalDocs.error } : null)} />

      <section className="summary-grid accounting-summary-grid accounting-external-docs-summary" aria-label="Resumen de documentos laborales">
        <article className="summary-card"><span>Periodo</span><strong>{formatPeriod(period)}</strong><small>Seleccionado</small></article>
        <article className="summary-card"><span>Documentos</span><strong>{externalDocs.documents.length}</strong><small>Registrados</small></article>
        <article className="summary-card"><span>Total</span><strong>{formatCurrency(documentsTotalMinor)}</strong><small>Importe del periodo</small></article>
        <article className="summary-card"><span>Empleados activos</span><strong>{activeEmployees.length}</strong><small>Vinculacion automatica</small></article>
      </section>

      <div className="accounting-external-docs-sections">
        <AccountingCollapsibleSections
          sections={[
            {
              id: 'create',
              title: 'Crear documento laboral',
              eyebrow: 'Documento laboral',
              helper: 'F931, ART, obra social u otro',
              content: (
                <div className="accounting-full-width-section">
                  <form className="accounting-entry-form accounting-external-docs-form" onSubmit={handleSubmit}>
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
                    <div className="accounting-inline-summary form-field--wide">
                      <span>Vinculacion</span>
                      <strong>{activeEmployees.length} empleados activos</strong>
                      <small>Al crear el documento se enlaza automaticamente al periodo {formatPeriod(period)}.</small>
                    </div>
                    <div className="form-actions form-actions--right"><UiActionButton type="submit">Crear documento laboral</UiActionButton></div>
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
                      <article key={document.id} className="accounting-row accounting-row--actions">
                        <div className="accounting-row__main">
                          <strong>{getAccountingReferenceTypeLabel(document.referenceType)}</strong>
                          <small>{document.providerName ?? 'Sin proveedor'} - {document.referenceNumber ?? 'Sin numero'} - {formatTimestamp(document.documentDate)}</small>
                        </div>
                        <div className="accounting-row__meta">
                          <span className={`status-chip status-chip--${document.status}`}>{document.status}</span>
                          <strong>{formatCurrency(document.amountMinor)}</strong>
                        </div>
                        <div className="accounting-inline-actions">
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
      {selectedDocument && (
        <AccountingOperationModal title="Detalle del documento laboral" meta={`${getAccountingReferenceTypeLabel(selectedDocument.referenceType)} - ${formatPeriod(selectedDocument.period)}`} onClose={() => setSelectedDocument(null)}>
          <div className="accounting-full-width-section">
            <div className="summary-grid accounting-summary-grid">
              <article className="summary-card"><span>Acreedor</span><strong>{selectedDocument.providerName ?? 'Sin acreedor'}</strong><small>{selectedDocument.referenceNumber ?? 'Sin numero'}</small></article>
              <article className="summary-card"><span>Monto</span><strong>{formatCurrency(selectedDocument.amountMinor)}</strong><small>{selectedDocument.status}</small></article>
              <article className="summary-card"><span>Documento</span><strong>{formatTimestamp(selectedDocument.documentDate)}</strong><small>Vence {formatTimestamp(selectedDocument.dueDate)}</small></article>
              <article className="summary-card"><span>Empleados vinculados</span><strong>{activeEmployees.length}</strong><small>Activos al crear/ver</small></article>
            </div>
            <div className="accounting-table-wrap">
              <table className="accounting-data-table">
                <thead><tr><th>Empleado</th><th>Legajo</th><th>Puesto</th><th>Estado</th></tr></thead>
                <tbody>
                  {activeEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td>{employee.lastName}, {employee.firstName}</td>
                      <td>{employee.employeeCode ?? employee.id}</td>
                      <td>{employee.position}</td>
                      <td>Vinculado</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </AccountingOperationModal>
      )}
    </div>
  );
}
