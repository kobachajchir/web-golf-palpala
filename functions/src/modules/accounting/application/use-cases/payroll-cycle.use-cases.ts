import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_EXPENSE_CATEGORY_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type {
  Actor,
  AccountingPeriod,
  EmployeeAccountingLinkDocument,
  EmployeeCertificateDocument,
  EmployeePayrollCycleDocument,
  ExternalReferenceType,
  OvertimeEntryDocument,
  SalaryPaymentDocument,
} from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureDirectivo,
  ensureStaff,
  parseOptionalAccountingPeriod,
  parseOptionalAmountMinor,
  parseOptionalFiniteNumber,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseRequiredAccountingPeriod,
  parseRequiredAmountMinor,
  parseRequiredFiniteNumber,
  parseRequiredIsoDate,
  parseRequiredString,
  parseRequiredStringArray,
} from '../shared.js';
import { calculateAnnualBonusPreview, postSalaryPaymentUseCase, type AnnualBonusPreview } from './salary.use-cases.js';

export interface CreateOvertimeEntryInput {
  employeeId: string;
  period: string;
  workDate: Date;
  hours: number;
  amountMinor: number;
  reason: string;
  notes?: string | null | undefined;
}

export interface ReviewOvertimeEntryInput {
  overtimeEntryId: string;
  decision: 'approved' | 'rejected';
  rejectionReason?: string | null | undefined;
}

export interface ListEmployeePayrollCycleInput {
  employeeId: string;
  period: string;
}

export interface PostEmployeePayrollCycleInput {
  employeeId: string;
  period: string;
  salaryConfigurationId?: string | null | undefined;
  salaryGrossMinor?: number | undefined;
  bankedAmountMinor?: number | undefined;
  nonBankedAmountMinor?: number | undefined;
  linkedExternalReferenceIds?: string[] | undefined;
  operationDate?: Date | undefined;
  notes?: string | null | undefined;
}

export interface RecordEmployeeCertificateInput {
  employeeId: string;
  period: string;
  certificateType: string;
  documentNumber?: string | null | undefined;
  issuedAt?: Date | null | undefined;
  expiresAt?: Date | null | undefined;
  attachmentUrl?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface LinkExternalReferenceToEmployeeInput {
  employeeId: string;
  period: string;
  referenceId: string;
  allocatedAmountMinor?: number | null | undefined;
  paidAt?: Date | null | undefined;
  notes?: string | null | undefined;
}

function isApprovedDecision(value: string): value is ReviewOvertimeEntryInput['decision'] {
  return value === 'approved' || value === 'rejected';
}

export async function createOvertimeEntryUseCase(params: {
  actor: Actor | null;
  input: CreateOvertimeEntryInput;
  transactions: AccountingTransactionManager;
}): Promise<{ overtimeEntryId: string; status: OvertimeEntryDocument['status'] }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const employee = await dataAccess.employees.getById(params.input.employeeId);
    assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);
    assertCondition(params.input.hours > 0, 'invalid-argument', 'hours debe ser mayor a 0.');

    const overtimeEntryId = await dataAccess.overtimeEntries.create(
      {
        employeeId: employee.id,
        period: params.input.period,
        workDate: Timestamp.fromDate(params.input.workDate),
        hours: params.input.hours,
        amountMinor: params.input.amountMinor,
        reason: params.input.reason,
        status: 'submitted',
        createdByUid: actor.uid,
        approvedByUid: null,
        approvedAt: null,
        rejectionReason: null,
        linkedSalaryPaymentId: null,
        linkedMovementId: null,
        notes: params.input.notes ?? null,
      },
      actor.uid,
    );

    return { overtimeEntryId, status: 'submitted' };
  });
}

export async function reviewOvertimeEntryUseCase(params: {
  actor: Actor | null;
  input: ReviewOvertimeEntryInput;
  transactions: AccountingTransactionManager;
}): Promise<{ overtimeEntryId: string; status: OvertimeEntryDocument['status'] }> {
  const actor = ensureDirectivo(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const entry = await dataAccess.overtimeEntries.getById(params.input.overtimeEntryId);
    assertCondition(entry, 'not-found', `No existe overtime_entries/${params.input.overtimeEntryId}.`);
    assertCondition(entry.status === 'submitted', 'failed-precondition', 'Solo se pueden revisar horas extra submitted.');

    if (params.input.decision === 'rejected') {
      assertCondition(params.input.rejectionReason, 'invalid-argument', 'rejectionReason es obligatorio al rechazar horas extra.');
    }

    const status = params.input.decision === 'approved' ? 'approved' : 'rejected';
    await dataAccess.overtimeEntries.update(
      entry.id,
      {
        status,
        approvedByUid: params.input.decision === 'approved' ? actor.uid : null,
        approvedAt: params.input.decision === 'approved' ? Timestamp.fromDate(new Date()) : null,
        rejectionReason: params.input.decision === 'rejected' ? params.input.rejectionReason ?? null : null,
      },
      actor.uid,
    );

    return { overtimeEntryId: entry.id, status };
  });
}

export async function listEmployeePayrollCycleUseCase(params: {
  actor: Actor | null;
  input: ListEmployeePayrollCycleInput;
  transactions: AccountingTransactionManager;
}): Promise<{
  payrollCycle: EmployeePayrollCycleDocument & { id: string } | null;
  salaryPayment: SalaryPaymentDocument & { id: string } | null;
  overtimeEntries: Array<OvertimeEntryDocument & { id: string }>;
  accountingLinks: Array<EmployeeAccountingLinkDocument & { id: string }>;
  certificates: Array<EmployeeCertificateDocument & { id: string }>;
  annualBonusPreview: AnnualBonusPreview;
}> {
  ensureStaff(params.actor);
  const dataAccess = params.transactions.getDataAccess();
  const employee = await dataAccess.employees.getById(params.input.employeeId);
  assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);

  const [payrollCycle, salaryPayment, overtimeEntries, accountingLinks, certificates, annualBonusPreview] = await Promise.all([
    dataAccess.employeePayrollCycles.findByEmployeeAndPeriod(params.input.employeeId, params.input.period),
    dataAccess.salaryPayments.findByEmployeeAndPeriod(params.input.employeeId, params.input.period),
    dataAccess.overtimeEntries.listPage({ employeeId: params.input.employeeId, period: params.input.period, limit: 100 }),
    dataAccess.employeeAccountingLinks.listPage({ employeeId: params.input.employeeId, period: params.input.period, limit: 100 }),
    dataAccess.employeeCertificates.listPage({ employeeId: params.input.employeeId, period: params.input.period, limit: 100 }),
    calculateAnnualBonusPreview({ dataAccess, employeeId: params.input.employeeId, period: params.input.period as AccountingPeriod }),
  ]);

  return {
    payrollCycle,
    salaryPayment,
    overtimeEntries: overtimeEntries.items,
    accountingLinks: accountingLinks.items,
    certificates: certificates.items,
    annualBonusPreview,
  };
}

export async function postEmployeePayrollCycleUseCase(params: {
  actor: Actor | null;
  input: PostEmployeePayrollCycleInput;
  transactions: AccountingTransactionManager;
}): Promise<{ payrollCycleId: string; salaryPaymentId: string; financialMovementIds: string[]; duplicate: boolean }> {
  const actor = ensureDirectivo(params.actor);
  const dataAccess = params.transactions.getDataAccess();
  const employee = await dataAccess.employees.getById(params.input.employeeId);
  assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);

  const approvedOvertimeEntries = await dataAccess.overtimeEntries.listApprovedByEmployeeAndPeriod(
    params.input.employeeId,
    params.input.period,
  );
  const overtimeHours = approvedOvertimeEntries.reduce((total, entry) => total + entry.hours, 0);
  const overtimeAmountMinor = approvedOvertimeEntries.reduce((total, entry) => total + entry.amountMinor, 0);

  const payment = await postSalaryPaymentUseCase({
    actor,
    input: {
      employeeId: params.input.employeeId,
      period: params.input.period,
      salaryConfigurationId: params.input.salaryConfigurationId,
      salaryGrossMinor: params.input.salaryGrossMinor,
      overtimeHours,
      overtimeAmountMinor,
      bankedAmountMinor: params.input.bankedAmountMinor,
      nonBankedAmountMinor: params.input.nonBankedAmountMinor,
      linkedExternalReferenceIds: params.input.linkedExternalReferenceIds,
      operationDate: params.input.operationDate,
      notes: params.input.notes,
    },
    transactions: params.transactions,
  });

  return params.transactions.runInTransaction(async (transactionDataAccess) => {
    const salaryPayment = await transactionDataAccess.salaryPayments.getById(payment.salaryPaymentId);
    assertCondition(salaryPayment, 'not-found', `No existe salary_payments/${payment.salaryPaymentId}.`);
    const movementDocs = await Promise.all(
      payment.financialMovementIds.map((movementId) => transactionDataAccess.financialMovements.getById(movementId)),
    );
    const overtimeMovement = movementDocs.find((movement) => movement?.categoryCodeSnapshot === FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra);

    for (const overtimeEntry of approvedOvertimeEntries) {
      await transactionDataAccess.overtimeEntries.update(
        overtimeEntry.id,
        {
          status: 'liquidated',
          linkedSalaryPaymentId: salaryPayment.id,
          linkedMovementId: overtimeMovement?.id ?? null,
        },
        actor.uid,
      );
    }

    const linkedCertificateIds = (await transactionDataAccess.employeeCertificates.listPage({
      employeeId: params.input.employeeId,
      period: params.input.period,
      limit: 100,
    })).items.map((certificate) => certificate.id);

    const existingCycle = await transactionDataAccess.employeePayrollCycles.findByEmployeeAndPeriod(
      params.input.employeeId,
      params.input.period,
    );
    const cycleData = {
      employeeId: params.input.employeeId,
      period: params.input.period,
      salaryPaymentId: salaryPayment.id,
      salaryConfigurationId: salaryPayment.salaryConfigurationId,
      salaryGrossMinor: salaryPayment.salaryGrossMinor,
      overtimeTotalHours: overtimeHours,
      overtimeTotalMinor: overtimeAmountMinor,
      bankedAmountMinor: salaryPayment.bankedAmountMinor,
      nonBankedAmountMinor: salaryPayment.nonBankedAmountMinor,
      linkedReferenceIds: salaryPayment.linkedExternalReferenceIds ?? [],
      linkedCertificateIds,
      financialMovementIds: salaryPayment.financialMovementIds,
      status: 'posted' as const,
      paidAt: Timestamp.fromDate(params.input.operationDate ?? new Date()),
      notes: params.input.notes ?? salaryPayment.notes ?? null,
    };

    if (existingCycle) {
      await transactionDataAccess.employeePayrollCycles.update(existingCycle.id, cycleData, actor.uid);
      return {
        payrollCycleId: existingCycle.id,
        salaryPaymentId: salaryPayment.id,
        financialMovementIds: salaryPayment.financialMovementIds,
        duplicate: payment.duplicate,
      };
    }

    const payrollCycleId = await transactionDataAccess.employeePayrollCycles.create(cycleData, actor.uid);
    return {
      payrollCycleId,
      salaryPaymentId: salaryPayment.id,
      financialMovementIds: salaryPayment.financialMovementIds,
      duplicate: payment.duplicate,
    };
  });
}

export async function recordEmployeeCertificateUseCase(params: {
  actor: Actor | null;
  input: RecordEmployeeCertificateInput;
  transactions: AccountingTransactionManager;
}): Promise<{ certificateId: string; status: EmployeeCertificateDocument['status'] }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const employee = await dataAccess.employees.getById(params.input.employeeId);
    assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);
    const status = params.input.expiresAt && params.input.expiresAt.getTime() < Date.now() ? 'expired' : 'active';

    const certificateId = await dataAccess.employeeCertificates.create(
      {
        employeeId: employee.id,
        period: params.input.period,
        certificateType: params.input.certificateType,
        documentNumber: params.input.documentNumber ?? null,
        issuedAt: params.input.issuedAt ? Timestamp.fromDate(params.input.issuedAt) : null,
        expiresAt: params.input.expiresAt ? Timestamp.fromDate(params.input.expiresAt) : null,
        attachmentUrl: params.input.attachmentUrl ?? null,
        status,
        notes: params.input.notes ?? null,
      },
      actor.uid,
    );

    return { certificateId, status };
  });
}

export async function linkExternalReferenceToEmployeeUseCase(params: {
  actor: Actor | null;
  input: LinkExternalReferenceToEmployeeInput;
  transactions: AccountingTransactionManager;
}): Promise<{ linkId: string; duplicate: boolean }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const [employee, reference] = await Promise.all([
      dataAccess.employees.getById(params.input.employeeId),
      dataAccess.externalAccountingReferences.getById(params.input.referenceId),
    ]);
    assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);
    assertCondition(reference, 'not-found', `No existe external_accounting_references/${params.input.referenceId}.`);

    const duplicate = await dataAccess.employeeAccountingLinks.findDuplicate({
      employeeId: employee.id,
      period: params.input.period,
      referenceId: reference.id,
    });

    if (duplicate) {
      return { linkId: duplicate.id, duplicate: true };
    }

    const linkId = await dataAccess.employeeAccountingLinks.create(
      {
        employeeId: employee.id,
        period: params.input.period,
        referenceId: reference.id,
        referenceType: reference.referenceType,
        allocatedAmountMinor: params.input.allocatedAmountMinor ?? null,
        paidAt: params.input.paidAt ? Timestamp.fromDate(params.input.paidAt) : null,
        status: reference.status === 'paid' ? 'paid' : 'linked',
        notes: params.input.notes ?? null,
      },
      actor.uid,
    );

    return { linkId, duplicate: false };
  });
}

export function parseCreateOvertimeEntryInput(payload: unknown): CreateOvertimeEntryInput {
  const data = assertIsRecord(payload);
  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    period: parseRequiredAccountingPeriod(data, 'period'),
    workDate: parseRequiredIsoDate(data, 'workDate'),
    hours: parseRequiredFiniteNumber(data, 'hours'),
    amountMinor: parseRequiredAmountMinor(data, 'amountMinor'),
    reason: parseRequiredString(data, 'reason'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseReviewOvertimeEntryInput(payload: unknown): ReviewOvertimeEntryInput {
  const data = assertIsRecord(payload);
  const decision = parseRequiredString(data, 'decision');
  assertCondition(isApprovedDecision(decision), 'invalid-argument', 'decision debe ser approved o rejected.');
  return {
    overtimeEntryId: parseRequiredString(data, 'overtimeEntryId'),
    decision,
    rejectionReason: parseOptionalNullableString(data, 'rejectionReason'),
  };
}

export function parseListEmployeePayrollCycleInput(payload: unknown): ListEmployeePayrollCycleInput {
  const data = assertIsRecord(payload);
  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
  };
}

export function parsePostEmployeePayrollCycleInput(payload: unknown): PostEmployeePayrollCycleInput {
  const data = assertIsRecord(payload);
  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
    salaryConfigurationId: parseOptionalNullableString(data, 'salaryConfigurationId'),
    salaryGrossMinor: parseOptionalAmountMinor(data, 'salaryGrossMinor'),
    bankedAmountMinor: parseOptionalAmountMinor(data, 'bankedAmountMinor'),
    nonBankedAmountMinor: parseOptionalAmountMinor(data, 'nonBankedAmountMinor'),
    linkedExternalReferenceIds: 'linkedExternalReferenceIds' in data ? parseRequiredStringArray(data, 'linkedExternalReferenceIds') : undefined,
    operationDate: parseOptionalIsoDate(data, 'operationDate'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseRecordEmployeeCertificateInput(payload: unknown): RecordEmployeeCertificateInput {
  const data = assertIsRecord(payload);
  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
    certificateType: parseRequiredString(data, 'certificateType'),
    documentNumber: parseOptionalNullableString(data, 'documentNumber'),
    issuedAt: parseOptionalIsoDate(data, 'issuedAt') ?? null,
    expiresAt: parseOptionalIsoDate(data, 'expiresAt') ?? null,
    attachmentUrl: parseOptionalNullableString(data, 'attachmentUrl'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseLinkExternalReferenceToEmployeeInput(payload: unknown): LinkExternalReferenceToEmployeeInput {
  const data = assertIsRecord(payload);
  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
    referenceId: parseRequiredString(data, 'referenceId'),
    allocatedAmountMinor: parseOptionalAmountMinor(data, 'allocatedAmountMinor') ?? null,
    paidAt: parseOptionalIsoDate(data, 'paidAt') ?? null,
    notes: parseOptionalNullableString(data, 'notes'),
  };
}
