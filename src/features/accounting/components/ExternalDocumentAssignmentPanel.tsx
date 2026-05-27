import { useState, type FormEvent } from 'react';
import type { EntityWithId, ExternalAccountingReferenceDocument } from '../../../modules/accounting/domain/models';
import type { EmployeeDocument } from '../../../modules/users/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { formatCurrency, formatPeriod } from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();

export function ExternalDocumentAssignmentPanel({
  documents,
  employees,
  onAssigned,
}: {
  documents: Array<EntityWithId<ExternalAccountingReferenceDocument>>;
  employees: Array<EntityWithId<EmployeeDocument>>;
  onAssigned: () => void;
}) {
  const [referenceId, setReferenceId] = useState(documents[0]?.id ?? '');
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedReference = documents.find((document) => document.id === referenceId);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedReference || !employeeId) {
      return;
    }

    setSubmitting(true);
    try {
      await accountingCallables.linkExternalReferenceToEmployee({
        employeeId,
        period: selectedReference.period,
        referenceId,
        allocatedAmountMinor: amount ? Number(amount) * 100 : null,
      });
      onAssigned();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="accounting-entry-form" onSubmit={handleSubmit}>
      <label className="form-field">
        <span>Documento global</span>
        <select value={referenceId} onChange={(event) => setReferenceId(event.target.value)}>
          {documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.referenceType} - {formatPeriod(document.period)} - {formatCurrency(document.amountMinor)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Empleado</span>
        <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.lastName}, {employee.firstName}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Monto asignado opcional</span>
        <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting || !referenceId || !employeeId}>
          {submitting ? 'Asignando...' : 'Asignar a empleado/periodo'}
        </button>
      </div>
    </form>
  );
}
