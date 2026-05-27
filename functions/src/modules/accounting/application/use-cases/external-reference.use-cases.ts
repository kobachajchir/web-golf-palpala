import { Timestamp } from 'firebase-admin/firestore';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, EmployeeAccountingLinkStatus, ExternalReferenceStatus, ExternalReferenceType } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureStaff,
  parseOptionalAccountingPeriod,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseRequiredAccountingPeriod,
  parseRequiredAmountMinor,
  parseRequiredString,
} from '../shared.js';

export interface RecordExternalReferenceInput {
  employeeId?: string | null | undefined;
  referenceType: ExternalReferenceType;
  providerName?: string | null | undefined;
  period: string;
  referenceNumber?: string | null | undefined;
  amountMinor: number;
  allocatedAmountMinor?: number | null | undefined;
  dueDate?: Date | null | undefined;
  documentDate?: Date | null | undefined;
  attachmentUrl?: string | null | undefined;
  linkedMovementId?: string | null | undefined;
  paidAt?: Date | null | undefined;
  notes?: string | null | undefined;
}

export async function recordExternalReferenceUseCase(params: {
  actor: Actor | null;
  input: RecordExternalReferenceInput;
  transactions: AccountingTransactionManager;
}): Promise<{ referenceId: string; status: 'recorded' | 'linked' | 'paid' }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    if (params.input.linkedMovementId) {
      const linkedMovement = await dataAccess.financialMovements.getById(params.input.linkedMovementId);
      assertCondition(linkedMovement, 'not-found', `No existe financial_movements/${params.input.linkedMovementId}.`);
    }
    if (params.input.employeeId) {
      const employee = await dataAccess.employees.getById(params.input.employeeId);
      assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);
    }

    const status: ExternalReferenceStatus = params.input.paidAt ? 'paid' : params.input.linkedMovementId ? 'linked' : 'recorded';
    const referenceId = await dataAccess.externalAccountingReferences.create(
      {
        employeeId: params.input.employeeId ?? null,
        referenceType: params.input.referenceType,
        providerName: params.input.providerName ?? null,
        period: params.input.period,
        referenceNumber: params.input.referenceNumber ?? null,
        amountMinor: params.input.amountMinor,
        dueDate: params.input.dueDate ? Timestamp.fromDate(params.input.dueDate) : null,
        documentDate: params.input.documentDate ? Timestamp.fromDate(params.input.documentDate) : null,
        attachmentUrl: params.input.attachmentUrl ?? null,
        linkedMovementId: params.input.linkedMovementId ?? null,
        paidAt: params.input.paidAt ? Timestamp.fromDate(params.input.paidAt) : null,
        paidByUid: params.input.paidAt ? actor.uid : null,
        status,
        notes: params.input.notes ?? null,
      },
      actor.uid,
    );

    return { referenceId, status };
  });
}

export async function upsertEmployeeExternalReferenceUseCase(params: {
  actor: Actor | null;
  input: RecordExternalReferenceInput & { employeeId: string };
  transactions: AccountingTransactionManager;
}): Promise<{ referenceId: string; linkId: string; status: 'recorded' | 'linked' | 'paid'; duplicate: boolean }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const employee = await dataAccess.employees.getById(params.input.employeeId);
    assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);

    if (params.input.linkedMovementId) {
      const linkedMovement = await dataAccess.financialMovements.getById(params.input.linkedMovementId);
      assertCondition(linkedMovement, 'not-found', `No existe financial_movements/${params.input.linkedMovementId}.`);
    }

    const status: ExternalReferenceStatus = params.input.paidAt ? 'paid' : params.input.linkedMovementId ? 'linked' : 'recorded';
    const existingReference = await dataAccess.externalAccountingReferences.findByEmployeePeriodAndReferenceType({
      employeeId: employee.id,
      period: params.input.period,
      referenceType: params.input.referenceType,
    });
    const referenceData = {
      employeeId: employee.id,
      referenceType: params.input.referenceType,
      providerName: params.input.providerName ?? null,
      period: params.input.period,
      referenceNumber: params.input.referenceNumber ?? null,
      amountMinor: params.input.amountMinor,
      dueDate: params.input.dueDate ? Timestamp.fromDate(params.input.dueDate) : null,
      documentDate: params.input.documentDate ? Timestamp.fromDate(params.input.documentDate) : null,
      attachmentUrl: params.input.attachmentUrl ?? null,
      linkedMovementId: params.input.linkedMovementId ?? null,
      paidAt: params.input.paidAt ? Timestamp.fromDate(params.input.paidAt) : null,
      paidByUid: params.input.paidAt ? actor.uid : null,
      status,
      notes: params.input.notes ?? null,
    };
    const referenceId = existingReference
      ? existingReference.id
      : await dataAccess.externalAccountingReferences.create(referenceData, actor.uid);

    if (existingReference) {
      await dataAccess.externalAccountingReferences.update(existingReference.id, referenceData, actor.uid);
    }

    const existingLink = await dataAccess.employeeAccountingLinks.findByEmployeePeriodAndReferenceType({
      employeeId: employee.id,
      period: params.input.period,
      referenceType: params.input.referenceType,
    });
    const linkStatus: EmployeeAccountingLinkStatus = status;
    const linkData = {
      employeeId: employee.id,
      period: params.input.period,
      referenceId,
      referenceType: params.input.referenceType,
      allocatedAmountMinor: params.input.allocatedAmountMinor ?? params.input.amountMinor,
      paidAt: params.input.paidAt ? Timestamp.fromDate(params.input.paidAt) : null,
      status: linkStatus,
      notes: params.input.notes ?? null,
    };
    const linkId = existingLink
      ? existingLink.id
      : await dataAccess.employeeAccountingLinks.create(linkData, actor.uid);

    if (existingLink) {
      await dataAccess.employeeAccountingLinks.update(existingLink.id, linkData, actor.uid);
    }

    return {
      referenceId,
      linkId,
      status,
      duplicate: Boolean(existingReference || existingLink),
    };
  });
}

export function parseRecordExternalReferenceInput(payload: unknown): RecordExternalReferenceInput {
  const data = assertIsRecord(payload);

  return {
    employeeId: parseOptionalNullableString(data, 'employeeId'),
    referenceType: parseRequiredString(data, 'referenceType') as ExternalReferenceType,
    providerName: parseOptionalNullableString(data, 'providerName'),
    period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
    referenceNumber: parseOptionalNullableString(data, 'referenceNumber'),
    amountMinor: parseRequiredAmountMinor(data, 'amountMinor'),
    allocatedAmountMinor: 'allocatedAmountMinor' in data ? parseRequiredAmountMinor(data, 'allocatedAmountMinor') : null,
    dueDate: parseOptionalIsoDate(data, 'dueDate') ?? null,
    documentDate: parseOptionalIsoDate(data, 'documentDate') ?? null,
    attachmentUrl: parseOptionalNullableString(data, 'attachmentUrl'),
    linkedMovementId: parseOptionalNullableString(data, 'linkedMovementId'),
    paidAt: parseOptionalIsoDate(data, 'paidAt') ?? null,
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseUpsertEmployeeExternalReferenceInput(payload: unknown): RecordExternalReferenceInput & { employeeId: string } {
  const input = parseRecordExternalReferenceInput(payload);
  assertCondition(input.employeeId, 'invalid-argument', 'employeeId es obligatorio.');

  return {
    ...input,
    employeeId: input.employeeId,
  };
}
