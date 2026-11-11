import { Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_FINANCIAL_EXPENSE_CATEGORIES, FINANCIAL_EXPENSE_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../domain/constants.js';
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
import type { AccountingDataAccess, AccountingTransactionManager } from '../../domain/ports.js';
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
  toClubAccountingPeriod,
} from '../shared.js';
import { createPostedMovement } from '../movement-helpers.js';
import { assertCashOperationDateAllowed } from '../cash-closure-guards.js';
import { calculateAnnualBonusPreview, processSalaryPaymentInTransaction, type AnnualBonusPreview } from './salary.use-cases.js';

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

export interface PayOvertimeEntryInput {
  overtimeEntryId: string;
  paymentMethodId: string;
  operationDate?: Date | undefined;
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

async function listAllEmployeeOvertime(dataAccess: AccountingDataAccess, employeeId: string, period: string) {
  const entries: Array<OvertimeEntryDocument & { id: string }> = [];
  let cursorId: string | undefined;
  do {
    const page = await dataAccess.overtimeEntries.listPage({ employeeId, period, limit: 100, cursorId });
    entries.push(...page.items);
    cursorId = page.nextCursorId;
  } while (cursorId);
  return entries;
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
    assertCondition(params.input.amountMinor > 0, 'invalid-argument', 'El monto de horas extra debe ser mayor a cero.');
    assertCondition(
      toClubAccountingPeriod(params.input.workDate) === params.input.period,
      'invalid-argument',
      'La fecha de las horas extra debe pertenecer al periodo seleccionado.',
    );

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
    assertCondition(entry.status === 'submitted' || (entry.status === 'approved' && params.input.decision === 'rejected'), 'failed-precondition', 'Solo se pueden revisar horas extra pendientes de pago.');

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

export async function payOvertimeEntryUseCase(params: {
  actor: Actor | null;
  input: PayOvertimeEntryInput;
  transactions: AccountingTransactionManager;
}): Promise<{ overtimeEntryId: string; movementId: string; duplicate: boolean }> {
  const actor = ensureDirectivo(params.actor);
  return params.transactions.runInTransaction(async (dataAccess) => {
    const entry = await dataAccess.overtimeEntries.getById(params.input.overtimeEntryId);
    assertCondition(entry, 'not-found', 'No encontramos el registro de horas extra.');
    if (entry.status === 'liquidated') {
      assertCondition(entry.linkedMovementId, 'failed-precondition', 'Las horas extra ya fueron liquidadas.');
      return { overtimeEntryId: entry.id, movementId: entry.linkedMovementId, duplicate: true };
    }
    assertCondition(entry.status === 'submitted' || entry.status === 'approved', 'failed-precondition', 'Solo se pueden pagar horas extra pendientes o aprobadas.');
    assertCondition(entry.hours > 0 && entry.amountMinor > 0, 'failed-precondition', 'El registro debe tener horas y monto mayores a cero.');

    const operationDate = params.input.operationDate ?? new Date();
    await assertCashOperationDateAllowed({ dataAccess, operationDate });
    const [employee, storedCategory, paymentMethod, salaryConfiguration] = await Promise.all([
      dataAccess.employees.getById(entry.employeeId),
      dataAccess.financialExpenseCategories.getById(FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra),
      dataAccess.paymentMethods.getById(params.input.paymentMethodId),
      dataAccess.salaryConfigurations.getActiveByEmployeeId(entry.employeeId),
    ]);
    assertCondition(employee, 'not-found', 'No encontramos el empleado asociado.');
    assertCondition(paymentMethod?.active, 'failed-precondition', 'Selecciona un medio de pago activo.');
    assertCondition(params.input.paymentMethodId !== PAYMENT_METHOD_IDS.debitMacro, 'invalid-argument', 'Cuenta debito Macro solo esta disponible para cuotas societarias.');
    assertCondition(salaryConfiguration?.allowOvertime !== false, 'failed-precondition', 'La configuracion salarial del empleado no permite horas extra.');
    const defaultCategory = DEFAULT_FINANCIAL_EXPENSE_CATEGORIES.find((category) => category.id === FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra)!;
    const category = storedCategory ?? { id: defaultCategory.id, ...defaultCategory.data };
    assertCondition(category.active, 'failed-precondition', 'La categoria Horas extra esta inactiva.');
    const employeeName = `${employee.lastName}, ${employee.firstName}`;
    const movement = await createPostedMovement({
      dataAccess,
      actorUid: actor.uid,
      movementType: 'expense',
      categoryId: category.id,
      categoryCodeSnapshot: category.id,
      grossAmountMinor: entry.amountMinor,
      operationDate,
      originType: 'employee_overtime',
      originCollection: 'overtime_entries',
      originId: entry.id,
      thirdPartyType: 'employee',
      thirdPartyId: employee.id,
      paymentMethodId: params.input.paymentMethodId,
      prefetchedPaymentMethod: paymentMethod,
      bancarizado: paymentMethod.bancarizado,
      imputableImpositivo: false,
      applyPaymentCommission: false,
      metadata: { employeeName, overtimeHours: entry.hours, payrollPeriod: entry.period, workDate: entry.workDate.toDate().toISOString() },
      notes: `Horas extra - ${employeeName} (${entry.period}): ${entry.reason}`,
    });
    await dataAccess.overtimeEntries.update(entry.id, {
      status: 'liquidated',
      linkedMovementId: movement.movementId,
      approvedByUid: entry.approvedByUid ?? actor.uid,
      approvedAt: entry.approvedAt ?? Timestamp.fromDate(new Date()),
    }, actor.uid);
    return { overtimeEntryId: entry.id, movementId: movement.movementId, duplicate: false };
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
    listAllEmployeeOvertime(dataAccess, params.input.employeeId, params.input.period),
    dataAccess.employeeAccountingLinks.listPage({ employeeId: params.input.employeeId, period: params.input.period, limit: 100 }),
    dataAccess.employeeCertificates.listPage({ employeeId: params.input.employeeId, period: params.input.period, limit: 100 }),
    calculateAnnualBonusPreview({ dataAccess, employeeId: params.input.employeeId, period: params.input.period as AccountingPeriod }),
  ]);

  return {
    payrollCycle,
    salaryPayment,
    overtimeEntries,
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

  return params.transactions.runInTransaction(async (transactionDataAccess) => {
    const employee = await transactionDataAccess.employees.getById(params.input.employeeId);
    assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);

    const approvedOvertimeEntries = await transactionDataAccess.overtimeEntries.listApprovedByEmployeeAndPeriod(
      params.input.employeeId,
      params.input.period,
    );
    const overtimeHours = approvedOvertimeEntries.reduce((total, entry) => total + entry.hours, 0);
    const overtimeAmountMinor = approvedOvertimeEntries.reduce((total, entry) => total + entry.amountMinor, 0);
    const linkedCertificateIds = (await transactionDataAccess.employeeCertificates.listPage({
      employeeId: params.input.employeeId,
      period: params.input.period,
      limit: 100,
    })).items.map((certificate) => certificate.id);
    const existingCycle = await transactionDataAccess.employeePayrollCycles.findByEmployeeAndPeriod(
      params.input.employeeId,
      params.input.period,
    );
    if (existingCycle?.status === 'posted' && existingCycle.salaryPaymentId) {
      return { payrollCycleId: existingCycle.id, salaryPaymentId: existingCycle.salaryPaymentId, financialMovementIds: existingCycle.financialMovementIds, duplicate: true };
    }
    const pendingOvertime = await transactionDataAccess.overtimeEntries.listPage({ employeeId: params.input.employeeId, period: params.input.period, status: 'submitted', limit: 1 });
    assertCondition(pendingOvertime.items.length === 0, 'failed-precondition', 'Hay horas extra pendientes de aprobacion. Revisalas antes de generar el pago de sueldo.');

    const payment = await processSalaryPaymentInTransaction({
      dataAccess: transactionDataAccess,
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
    });

    // A repeated payroll request must not overwrite totals or mark later entries as paid.
    if (payment.duplicate && existingCycle) {
      return { payrollCycleId: existingCycle.id, salaryPaymentId: payment.salaryPaymentId, financialMovementIds: payment.financialMovementIds, duplicate: true };
    }
    assertCondition(!payment.duplicate || approvedOvertimeEntries.length === 0, 'failed-precondition', 'El sueldo ya fue pagado. Usa Pagar ahora en las horas extra pendientes.');

    for (const overtimeEntry of approvedOvertimeEntries) {
      await transactionDataAccess.overtimeEntries.update(
        overtimeEntry.id,
        {
          status: 'liquidated',
          linkedSalaryPaymentId: payment.salaryPaymentId,
          linkedMovementId: payment.overtimeMovementId,
        },
        actor.uid,
      );
    }


    const cycleData = {
      employeeId: params.input.employeeId,
      period: params.input.period,
      salaryPaymentId: payment.salaryPaymentId,
      salaryConfigurationId: payment.salaryConfigurationId,
      salaryGrossMinor: payment.salaryGrossMinor,
      overtimeTotalHours: payment.overtimeHours,
      overtimeTotalMinor: payment.overtimeAmountMinor,
      bankedAmountMinor: payment.bankedAmountMinor,
      nonBankedAmountMinor: payment.nonBankedAmountMinor,
      linkedReferenceIds: payment.linkedExternalReferenceIds,
      linkedCertificateIds,
      financialMovementIds: payment.financialMovementIds,
      status: 'posted' as const,
      paidAt: Timestamp.fromDate(params.input.operationDate ?? new Date()),
      notes: params.input.notes ?? payment.notes,
    };

    if (existingCycle) {
      await transactionDataAccess.employeePayrollCycles.update(existingCycle.id, cycleData, actor.uid);
      return {
        payrollCycleId: existingCycle.id,
        salaryPaymentId: payment.salaryPaymentId,
        financialMovementIds: payment.financialMovementIds,
        duplicate: payment.duplicate,
      };
    }

    const payrollCycleId = await transactionDataAccess.employeePayrollCycles.create(cycleData, actor.uid);
    return {
      payrollCycleId,
      salaryPaymentId: payment.salaryPaymentId,
      financialMovementIds: payment.financialMovementIds,
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

export function parsePayOvertimeEntryInput(payload: unknown): PayOvertimeEntryInput {
  const data = assertIsRecord(payload);
  return {
    overtimeEntryId: parseRequiredString(data, 'overtimeEntryId'),
    paymentMethodId: parseRequiredString(data, 'paymentMethodId'),
    operationDate: parseOptionalIsoDate(data, 'operationDate'),
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
    allocatedAmountMinor: data.allocatedAmountMinor === null ? null : parseOptionalAmountMinor(data, 'allocatedAmountMinor') ?? null,
    paidAt: parseOptionalIsoDate(data, 'paidAt') ?? null,
    notes: parseOptionalNullableString(data, 'notes'),
  };
}
