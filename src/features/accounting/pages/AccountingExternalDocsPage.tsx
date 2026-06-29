import { useEffect, useState, type FormEvent } from 'react';
import { UiActionButton } from '../../../components/UiActionButton';
import { ACCOUNTING_REFERENCE_TYPES } from '../../../modules/accounting/domain/constants';
import type { ExternalReferenceType } from '../../../modules/accounting/domain/models';
import { createEmployeesRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import type { EntityWithId, EmployeeDocument } from '../../../modules/users/domain/models';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { ExternalDocumentAssignmentPanel } from '../components/ExternalDocumentAssignmentPanel';
import { useExternalDocuments } from '../hooks/useExternalDocuments';
import type { AccountingNotice } from '../types/accounting';
import { buildArgentinaDateIso, formatCurrency, formatPeriod, formatTimestamp, getCurrentAccountingPeriod, normalizeAccountingPeriod, parseAmountInputToMinor } from '../utils/accountingFormatters';

export function AccountingExternalDocsPage() {
  const [period, setPeriod] = useState(getCurrentAccountingPeriod());
  const externalDocs = useExternalDocuments(period);
  const [employees, setEmployees] = useState<Array<EntityWithId<EmployeeDocument>>>([]);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [form, setForm] = useState({
    referenceType: 'F931' as ExternalReferenceType,
    amount: '',
    providerName: '',
    referenceNumber: '',
    dueDate: '',
    documentDate: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    const repository = createEmployeesRepository();
    void repository.listAlphabetical(100).then(setEmployees);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(form.amount);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresa un monto valido.' });
      return;
    }

    try {
      await externalDocs.recordExternalReference({
        referenceType: form.referenceType,
        period,
        amountMinor,
        providerName: form.providerName.trim() || null,
        referenceNumber: form.referenceNumber.trim() || null,
        dueDate: form.dueDate ? buildArgentinaDateIso(form.dueDate) : null,
        documentDate: form.documentDate ? buildArgentinaDateIso(form.documentDate) : null,
      });
      setNotice({ kind: 'success', message: 'Documento global creado. Ahora podes asignarlo a empleados/periodos.' });
      setForm((current) => ({ ...current, amount: '', referenceNumber: '' }));
      await externalDocs.reload();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos crear el documento.' });
    }
  };

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Documentos laborales</p>
          <h1>Crear y enlazar documentos laborales</h1>
          <p>F931, ART, obra social y otros documentos del periodo seleccionado.</p>
        </div>
        <div className="accounting-hero__controls">
          <AccountingMonthPicker period={normalizeAccountingPeriod(period)} onChange={setPeriod} />
        </div>
      </section>

      <AccountingInlineNotice notice={notice ?? (externalDocs.error ? { kind: 'error', message: externalDocs.error } : null)} />

      <AccountingCollapsibleSections
        initialOpenId="create"
        sections={[
          {
            id: 'create',
            title: 'Crear documento laboral',
            eyebrow: 'Documento laboral',
            helper: 'F931, ART, obra social u otro',
            content: (
              <form className="accounting-entry-form" onSubmit={handleSubmit}>
                <label className="form-field">
                  <span>Tipo</span>
                  <select value={form.referenceType} onChange={(event) => setForm((current) => ({ ...current, referenceType: event.target.value as ExternalReferenceType }))}>
                    {ACCOUNTING_REFERENCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label className="form-field"><span>Monto</span><input inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></label>
                <label className="form-field"><span>Proveedor</span><input value={form.providerName} onChange={(event) => setForm((current) => ({ ...current, providerName: event.target.value }))} /></label>
                <label className="form-field"><span>Numero</span><input value={form.referenceNumber} onChange={(event) => setForm((current) => ({ ...current, referenceNumber: event.target.value }))} /></label>
                <label className="form-field"><span>Fecha documento</span><input type="date" value={form.documentDate} onChange={(event) => setForm((current) => ({ ...current, documentDate: event.target.value }))} /></label>
                <label className="form-field"><span>Vencimiento</span><input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} /></label>
                <div className="form-actions"><UiActionButton type="submit">Crear documento laboral</UiActionButton></div>
              </form>
            ),
          },
          {
            id: 'documents',
            title: 'Documentos de este periodo',
            eyebrow: `Historial ${formatPeriod(period)}`,
            helper: `${externalDocs.documents.length} comprobantes`,
            content: (
              <div className="accounting-list">
                <article className="accounting-row accounting-row--actions accounting-document-assignment-row">
                  <div className="accounting-row__main">
                    <strong>Asignar empleado a periodo</strong>
                    <small>Enlaza un documento laboral existente con un empleado del periodo.</small>
                  </div>
                  <div className="accounting-inline-actions">
                    <UiActionButton
                      type="button"
                      variant="secondary"
                      disabled={externalDocs.documents.length === 0}
                      onClick={() => setAssignmentOpen((current) => !current)}
                    >
                      {assignmentOpen ? 'Ocultar asignacion' : 'Asignar empleado'}
                    </UiActionButton>
                  </div>
                </article>
                {assignmentOpen && externalDocs.documents.length > 0 && (
                  <section className="accounting-inline-workbench">
                    <ExternalDocumentAssignmentPanel documents={externalDocs.documents} employees={employees} onAssigned={() => {
                      setAssignmentOpen(false);
                      void externalDocs.reload();
                    }} />
                  </section>
                )}
                {externalDocs.documents.map((document) => (
                  <article key={document.id} className="accounting-row">
                    <div className="accounting-row__main">
                      <strong>{document.referenceType}</strong>
                      <small>{document.providerName ?? 'Sin proveedor'} - {document.referenceNumber ?? 'Sin numero'} - {formatTimestamp(document.documentDate)}</small>
                    </div>
                    <div className="accounting-row__meta">
                      <span className={`status-chip status-chip--${document.status}`}>{document.status}</span>
                      <strong>{formatCurrency(document.amountMinor)}</strong>
                    </div>
                  </article>
                ))}
                {!externalDocs.loading && externalDocs.documents.length === 0 && <AccountingEmptyState title="Sin documentos para este periodo" />}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
