import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getAccountingReferenceTypeLabel } from '../../../modules/accounting/domain/constants';
import type { EmployeeAccountingLinkDocument, EntityWithId, ExternalAccountingReferenceDocument } from '../../../modules/accounting/domain/models';
import type { EmployeeDocument } from '../../../modules/users/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createEmployeeAccountingLinksRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { formatCurrency, formatPeriod, parseAmountInputToMinor } from '../utils/accountingFormatters';

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
  const [assignedLinks, setAssignedLinks] = useState<Array<EntityWithId<EmployeeAccountingLinkDocument>>>([]);
  const [submitting, setSubmitting] = useState(false);

  const selectedReference = documents.find((document) => document.id === referenceId);
  const assignedEmployeeIds = useMemo(() => new Set(assignedLinks.map((link) => link.employeeId)), [assignedLinks]);
  const availableEmployees = useMemo(
    () => employees.filter((employee) => !assignedEmployeeIds.has(employee.id)),
    [assignedEmployeeIds, employees],
  );

  useEffect(() => {
    if (!selectedReference) {
      setAssignedLinks([]);
      return;
    }

    let cancelled = false;
    void createEmployeeAccountingLinksRepository()
      .listByReferenceAndPeriod(selectedReference.id, selectedReference.period)
      .then((links) => {
        if (!cancelled) {
          setAssignedLinks(links);
          const assignedIds = new Set(links.map((link) => link.employeeId));
          const firstAvailable = employees.find((employee) => !assignedIds.has(employee.id));
          setEmployeeId(firstAvailable?.id ?? '');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAssignedLinks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [employees, selectedReference]);

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
        allocatedAmountMinor: amount ? parseAmountInputToMinor(amount) : null,
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
              {getAccountingReferenceTypeLabel(document.referenceType)} - {formatPeriod(document.period)} - {formatCurrency(document.amountMinor)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Empleado</span>
        <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
          {availableEmployees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.lastName}, {employee.firstName}
            </option>
          ))}
        </select>
        <small>{availableEmployees.length} empleado{availableEmployees.length === 1 ? '' : 's'} sin asignar para este documento.</small>
      </label>
      <label className="form-field">
        <span>Monto asignado opcional</span>
        <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={submitting || !referenceId || !employeeId || availableEmployees.length === 0}>
          {submitting ? 'Asignando...' : 'Asignar a empleado/periodo'}
        </button>
      </div>
    </form>
  );
}
