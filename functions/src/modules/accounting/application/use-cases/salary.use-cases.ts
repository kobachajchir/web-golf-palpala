import { Timestamp } from 'firebase-admin/firestore';
import {
  FINANCIAL_EXPENSE_CATEGORY_IDS,
  PAYMENT_METHOD_IDS,
} from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { AccountingPeriod, Actor, SalaryPeriodicity } from '../../domain/models.js';
import type { AccountingDataAccess, AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureDirectivo,
  ensureStaff,
  hasExecutiveAccess,
  parseOptionalAccountingPeriod,
  parseOptionalAmountMinor,
  parseOptionalBoolean,
  parseOptionalFiniteNumber,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseOptionalStringArray,
  parseRequiredAccountingPeriod,
  parseRequiredAmountMinor,
  parseRequiredIsoDate,
  parseRequiredString,
} from '../shared.js';
import { createPostedMovement } from '../movement-helpers.js';

export interface UpsertSalaryConfigurationInput {
  employeeId: string;
  contractType: string;
  baseAmountMinor: number;
  periodicity: SalaryPeriodicity;
  effectiveFrom: Date;
  allowOvertime?: boolean | undefined;
  notes?: string | null | undefined;
}

export interface PostAnnualBonusPaymentInput {
  employeeId: string;
  period?: AccountingPeriod | undefined;
  amountMinor?: number | undefined;
  paymentMethodId?: string | null | undefined;
  operationDate: Date;
  notes?: string | null | undefined;
}
export interface PostSalaryPaymentInput {
  employeeId: string;
  period: string;
  salaryConfigurationId?: string | null | undefined;
  salaryGrossMinor?: number | undefined;
  overtimeHours?: number | null | undefined;
  overtimeAmountMinor?: number | null | undefined;
  bankedAmountMinor?: number | undefined;
  nonBankedAmountMinor?: number | undefined;
  linkedExternalReferenceIds?: string[] | undefined;
  operationDate?: Date | undefined;
  notes?: string | null | undefined;
}

interface ProcessSalaryPaymentResult {
  salaryPaymentId: string;
  financialMovementIds: string[];
  overtimeMovementId: string | null;
  salaryConfigurationId: string;
  salaryGrossMinor: number;
  overtimeHours: number;
  overtimeAmountMinor: number;
  bankedAmountMinor: number;
  nonBankedAmountMinor: number;
  linkedExternalReferenceIds: string[];
  notes: string | null;
  duplicate: boolean;
}

export async function upsertSalaryConfigurationUseCase(params: {
  actor: Actor | null;
  input: UpsertSalaryConfigurationInput;
  transactions: AccountingTransactionManager;
}): Promise<{ salaryConfigurationId: string }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const employee = await dataAccess.employees.getById(params.input.employeeId);
    assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);

    const activeConfiguration = await dataAccess.salaryConfigurations.getActiveByEmployeeId(params.input.employeeId);
    if (activeConfiguration) {
      await dataAccess.salaryConfigurations.update(
        activeConfiguration.id,
        {
          isActive: false,
          effectiveTo: Timestamp.fromDate(params.input.effectiveFrom),
        },
        actor.uid,
      );
    }

    const salaryConfigurationId = await dataAccess.salaryConfigurations.create(
      {
        employeeId: employee.id,
        contractType: params.input.contractType,
        baseAmountMinor: params.input.baseAmountMinor,
        periodicity: params.input.periodicity,
        effectiveFrom: Timestamp.fromDate(params.input.effectiveFrom),
        effectiveTo: null,
        isActive: true,
        allowOvertime: params.input.allowOvertime ?? activeConfiguration?.allowOvertime ?? false,
        notes: params.input.notes ?? null,
        setByUid: actor.uid,
      },
      actor.uid,
    );

    return { salaryConfigurationId };
  });
}

export async function processSalaryPaymentInTransaction(params: {
  dataAccess: AccountingDataAccess;
  actor: Actor;
  input: PostSalaryPaymentInput;
}): Promise<ProcessSalaryPaymentResult> {
  const { dataAccess, actor, input } = params;

  const employee = await dataAccess.employees.getById(input.employeeId);
  assertCondition(employee, 'not-found', `No existe employees/${input.employeeId}.`);

  const existingPayment = await dataAccess.salaryPayments.findByEmployeeAndPeriod(input.employeeId, input.period);
  if (existingPayment?.status === 'posted') {
    const existingMovementDocs = await Promise.all(
      existingPayment.financialMovementIds.map((movementId) => dataAccess.financialMovements.getById(movementId)),
    );
    return {
      salaryPaymentId: existingPayment.id,
      financialMovementIds: existingPayment.financialMovementIds,
      overtimeMovementId: existingMovementDocs.find(
        (movement) => movement?.categoryCodeSnapshot === FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra,
      )?.id ?? null,
      salaryConfigurationId: existingPayment.salaryConfigurationId,
      salaryGrossMinor: existingPayment.salaryGrossMinor,
      overtimeHours: existingPayment.overtimeHours ?? 0,
      overtimeAmountMinor: existingPayment.overtimeAmountMinor ?? 0,
      bankedAmountMinor: existingPayment.bankedAmountMinor,
      nonBankedAmountMinor: existingPayment.nonBankedAmountMinor,
      linkedExternalReferenceIds: existingPayment.linkedExternalReferenceIds ?? [],
      notes: existingPayment.notes ?? null,
      duplicate: true,
    };
  }

  const salaryConfiguration = input.salaryConfigurationId
    ? await dataAccess.salaryConfigurations.getById(input.salaryConfigurationId)
    : await dataAccess.salaryConfigurations.getActiveByEmployeeId(input.employeeId);
  assertCondition(salaryConfiguration, 'failed-precondition', 'No existe salary_configuration activa o indicada.');
  assertCondition(salaryConfiguration.isActive || input.salaryConfigurationId === salaryConfiguration.id, 'failed-precondition', 'La configuración salarial indicada no está activa.');

    const salaryCategory = await dataAccess.financialExpenseCategories.getById(FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo);
    const overtimeCategory = await dataAccess.financialExpenseCategories.getById(FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra);
    assertCondition(salaryCategory, 'not-found', `No existe financial_expense_categories/${FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo}.`);
    assertCondition(overtimeCategory, 'not-found', `No existe financial_expense_categories/${FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra}.`);

  const salaryGrossMinor = input.salaryGrossMinor ?? salaryConfiguration.baseAmountMinor;
  const bankedAmountMinor = input.bankedAmountMinor ?? salaryGrossMinor;
  const nonBankedAmountMinor = input.nonBankedAmountMinor ?? 0;
  const overtimeAmountMinor = input.overtimeAmountMinor ?? 0;
  const overtimeHours = input.overtimeHours ?? null;
  const operationDate = input.operationDate ?? new Date(`${input.period}-01T00:00:00.000Z`);
  const linkedReferenceIds = input.linkedExternalReferenceIds ?? [];
  const [bankedPaymentMethod, cashPaymentMethod, activeConfig, linkedExternalReferences] = await Promise.all([
    bankedAmountMinor > 0
      ? dataAccess.paymentMethods.getById(PAYMENT_METHOD_IDS.transferMacro)
      : Promise.resolve(null),
    nonBankedAmountMinor > 0 || overtimeAmountMinor > 0
      ? dataAccess.paymentMethods.getById(PAYMENT_METHOD_IDS.cash)
      : Promise.resolve(null),
    overtimeAmountMinor > 0 ? dataAccess.financialConfigs.getActive() : Promise.resolve(null),
    Promise.all(linkedReferenceIds.map((referenceId) => dataAccess.externalAccountingReferences.getById(referenceId))),
  ]);

  if (bankedAmountMinor > 0) {
    assertCondition(bankedPaymentMethod, 'not-found', `No existe payment_methods/${PAYMENT_METHOD_IDS.transferMacro}.`);
    assertCondition(bankedPaymentMethod.active, 'failed-precondition', `El medio de pago ${PAYMENT_METHOD_IDS.transferMacro} esta inactivo.`);
  }
  if (nonBankedAmountMinor > 0 || overtimeAmountMinor > 0) {
    assertCondition(cashPaymentMethod, 'not-found', `No existe payment_methods/${PAYMENT_METHOD_IDS.cash}.`);
    assertCondition(cashPaymentMethod.active, 'failed-precondition', `El medio de pago ${PAYMENT_METHOD_IDS.cash} esta inactivo.`);
  }
  if (overtimeAmountMinor > 0) {
    assertCondition(activeConfig, 'failed-precondition', 'No existe una configuracion financiera activa.');
    assertCondition(
      !activeConfig.requireApprovalForOvertimePosting || hasExecutiveAccess(actor),
      'permission-denied',
      'Las horas extra requieren aprobacion del Comite Ejecutivo.',
    );
  }
  linkedExternalReferences.forEach((externalReference, index) => {
    assertCondition(externalReference, 'not-found', `No existe external_accounting_references/${linkedReferenceIds[index]}.`);
  });

    assertCondition(
      bankedAmountMinor + nonBankedAmountMinor === salaryGrossMinor,
      'invalid-argument',
      'bankedAmountMinor + nonBankedAmountMinor debe coincidir con salaryGrossMinor.',
    );
    assertCondition(
      overtimeAmountMinor === 0 || salaryConfiguration.allowOvertime,
      'failed-precondition',
      'La configuración salarial no permite horas extra.',
    );

    const financialMovementIds: string[] = [];
    let overtimeMovementId: string | null = null;

    if (bankedAmountMinor > 0) {
      const bankedMovement = await createPostedMovement({
        dataAccess,
        actorUid: actor.uid,
        movementType: 'expense',
        categoryId: salaryCategory.id,
        categoryCodeSnapshot: salaryCategory.id,
        grossAmountMinor: bankedAmountMinor,
        operationDate,
        originType: 'salary_payment',
        originCollection: 'salary_payments',
        originId: existingPayment?.id ?? null,
        thirdPartyType: 'employee',
        thirdPartyId: employee.id,
        paymentMethodId: PAYMENT_METHOD_IDS.transferMacro,
        prefetchedPaymentMethod: bankedPaymentMethod,
        bancarizado: true,
        imputableImpositivo: true,
      metadata: { part: 'banked_salary' },
      notes: input.notes ?? null,
      applyPaymentCommission: false,
      });
      financialMovementIds.push(bankedMovement.movementId);
    }

    if (nonBankedAmountMinor > 0) {
      const cashSalaryMovement = await createPostedMovement({
        dataAccess,
        actorUid: actor.uid,
        movementType: 'expense',
        categoryId: salaryCategory.id,
        categoryCodeSnapshot: salaryCategory.id,
        grossAmountMinor: nonBankedAmountMinor,
        operationDate,
        originType: 'salary_payment',
        originCollection: 'salary_payments',
        originId: existingPayment?.id ?? null,
        thirdPartyType: 'employee',
        thirdPartyId: employee.id,
        paymentMethodId: PAYMENT_METHOD_IDS.cash,
        prefetchedPaymentMethod: cashPaymentMethod,
        bancarizado: false,
        imputableImpositivo: true,
      metadata: { part: 'non_banked_salary' },
      notes: input.notes ?? null,
      applyPaymentCommission: false,
      });
      financialMovementIds.push(cashSalaryMovement.movementId);
    }

    if (overtimeAmountMinor > 0) {
      const overtimeMovement = await createPostedMovement({
        dataAccess,
        actorUid: actor.uid,
        movementType: 'expense',
        categoryId: overtimeCategory.id,
        categoryCodeSnapshot: overtimeCategory.id,
        grossAmountMinor: overtimeAmountMinor,
        operationDate,
        originType: 'salary_payment_overtime',
        originCollection: 'salary_payments',
        originId: existingPayment?.id ?? null,
        thirdPartyType: 'employee',
        thirdPartyId: employee.id,
        paymentMethodId: PAYMENT_METHOD_IDS.cash,
        prefetchedPaymentMethod: cashPaymentMethod,
        bancarizado: false,
        imputableImpositivo: false,
      metadata: { overtimeHours, employeeName: `${employee.lastName}, ${employee.firstName}`, payrollPeriod: input.period },
      notes: input.notes ?? null,
      applyPaymentCommission: false,
      });
      financialMovementIds.push(overtimeMovement.movementId);
      overtimeMovementId = overtimeMovement.movementId;
    }

    const salaryPaymentId = await dataAccess.salaryPayments.create(
      {
      employeeId: employee.id,
      period: input.period,
      salaryConfigurationId: salaryConfiguration.id,
      salaryGrossMinor,
      overtimeHours,
      overtimeAmountMinor: overtimeAmountMinor || null,
      overtimeBancarizado: false,
      overtimeImputableImpositivo: false,
      bankedAmountMinor,
      nonBankedAmountMinor,
      linkedExternalReferenceIds: input.linkedExternalReferenceIds ?? [],
      financialMovementIds,
      status: 'posted',
      approvedByUid: actor.uid,
      notes: input.notes ?? null,
      },
      actor.uid,
    );

  if (linkedReferenceIds.length) {
    const primaryMovementId = financialMovementIds[0] ?? null;
    for (const [index, referenceId] of linkedReferenceIds.entries()) {
        const externalReference = linkedExternalReferences[index];
        assertCondition(externalReference, 'not-found', `No existe external_accounting_references/${referenceId}.`);
        await dataAccess.externalAccountingReferences.update(
          referenceId,
          {
            linkedMovementId: primaryMovementId,
            status: primaryMovementId ? 'linked' : externalReference.status,
          },
          actor.uid,
        );
      }
    }

  return {
    salaryPaymentId,
    financialMovementIds,
    overtimeMovementId,
    salaryConfigurationId: salaryConfiguration.id,
    salaryGrossMinor,
    overtimeHours: overtimeHours ?? 0,
    overtimeAmountMinor,
    bankedAmountMinor,
    nonBankedAmountMinor,
    linkedExternalReferenceIds: input.linkedExternalReferenceIds ?? [],
    notes: input.notes ?? null,
    duplicate: false,
  };
}

export async function postSalaryPaymentUseCase(params: {
  actor: Actor | null;
  input: PostSalaryPaymentInput;
  transactions: AccountingTransactionManager;
}): Promise<{ salaryPaymentId: string; financialMovementIds: string[]; duplicate: boolean }> {
  const actor = ensureDirectivo(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    return processSalaryPaymentInTransaction({
      dataAccess,
      actor,
      input: params.input,
    });
  });
}

export type AnnualBonusReferenceSource = 'salary_payment' | 'payroll_cycle' | 'active_salary_configuration';

export interface AnnualBonusPreview {
  period: AccountingPeriod;
  year: number;
  semester: 1 | 2;
  semesterPeriods: AccountingPeriod[];
  referenceAmountMinor: number;
  referencePeriod: AccountingPeriod | null;
  referenceSource: AnnualBonusReferenceSource | null;
  defaultAmountMinor: number;
  alreadyPosted: boolean;
  existingMovementId: string | null;
  existingAmountMinor: number | null;
  postedAnnualBonusCount: number;
  remainingAnnualSlots: number;
}

function getAnnualBonusPeriodDetails(period: AccountingPeriod): {
  year: number;
  semester: 1 | 2;
  semesterPeriods: AccountingPeriod[];
} {
  const [yearText, monthText] = period.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const semester = month <= 6 ? 1 : 2;
  const firstMonth = semester === 1 ? 1 : 7;
  const semesterPeriods = Array.from({ length: 6 }, (_, index) => (
    `${year}-${String(firstMonth + index).padStart(2, '0')}` as AccountingPeriod
  ));
  return { year, semester, semesterPeriods };
}

function getMovementAnnualBonusYear(operationDate: Timestamp, metadata: Record<string, unknown> | undefined): number {
  const metadataYear = metadata?.annualBonusYear;
  return typeof metadataYear === 'number' && Number.isInteger(metadataYear)
    ? metadataYear
    : operationDate.toDate().getUTCFullYear();
}

function getMovementAnnualBonusSemester(operationDate: Timestamp, metadata: Record<string, unknown> | undefined): 1 | 2 {
  const metadataSemester = metadata?.annualBonusSemester;
  if (metadataSemester === 1 || metadataSemester === 2) {
    return metadataSemester;
  }
  return operationDate.toDate().getUTCMonth() < 6 ? 1 : 2;
}

export async function calculateAnnualBonusPreview(params: {
  dataAccess: AccountingDataAccess;
  employeeId: string;
  period: AccountingPeriod;
}): Promise<AnnualBonusPreview> {
  const { year, semester, semesterPeriods } = getAnnualBonusPeriodDetails(params.period);
  const [salaryConfiguration, previousMovements, monthlyReferences] = await Promise.all([
    params.dataAccess.salaryConfigurations.getActiveByEmployeeId(params.employeeId),
    params.dataAccess.financialMovements.listPage({
      categoryCodeSnapshot: FINANCIAL_EXPENSE_CATEGORY_IDS.aguinaldo,
      thirdPartyType: 'employee',
      thirdPartyId: params.employeeId,
      limit: 100,
    }),
    Promise.all(semesterPeriods.map(async (candidatePeriod) => {
      const [salaryPayment, payrollCycle] = await Promise.all([
        params.dataAccess.salaryPayments.findByEmployeeAndPeriod(params.employeeId, candidatePeriod),
        params.dataAccess.employeePayrollCycles.findByEmployeeAndPeriod(params.employeeId, candidatePeriod),
      ]);
      if (salaryPayment && ['posted', 'paid', 'liquidated'].includes(salaryPayment.status) && salaryPayment.salaryGrossMinor > 0) {
        return {
          period: candidatePeriod,
          amountMinor: salaryPayment.salaryGrossMinor,
          source: 'salary_payment' as const,
        };
      }
      if (payrollCycle && ['posted', 'paid', 'liquidated'].includes(payrollCycle.status) && payrollCycle.salaryGrossMinor > 0) {
        return {
          period: candidatePeriod,
          amountMinor: payrollCycle.salaryGrossMinor,
          source: 'payroll_cycle' as const,
        };
      }
      return null;
    })),
  ]);

  const bestHistoricalReference = monthlyReferences
    .filter((reference): reference is NonNullable<typeof reference> => reference !== null)
    .sort((left, right) => right.amountMinor - left.amountMinor || right.period.localeCompare(left.period))[0] ?? null;
  const referenceAmountMinor = bestHistoricalReference?.amountMinor ?? salaryConfiguration?.baseAmountMinor ?? 0;
  const referencePeriod = bestHistoricalReference?.period ?? null;
  const referenceSource: AnnualBonusReferenceSource | null = bestHistoricalReference?.source
    ?? (salaryConfiguration ? 'active_salary_configuration' : null);
  const postedAnnualBonuses = previousMovements.items.filter((movement) =>
    movement.status === 'posted'
    && getMovementAnnualBonusYear(movement.operationDate, movement.metadata) === year,
  );
  const existingMovement = postedAnnualBonuses.find((movement) =>
    getMovementAnnualBonusSemester(movement.operationDate, movement.metadata) === semester,
  ) ?? null;

  return {
    period: params.period,
    year,
    semester,
    semesterPeriods,
    referenceAmountMinor,
    referencePeriod,
    referenceSource,
    defaultAmountMinor: Math.round(referenceAmountMinor / 2),
    alreadyPosted: existingMovement !== null,
    existingMovementId: existingMovement?.id ?? null,
    existingAmountMinor: existingMovement?.grossAmountMinor ?? null,
    postedAnnualBonusCount: postedAnnualBonuses.length,
    remainingAnnualSlots: Math.max(0, 2 - postedAnnualBonuses.length),
  };
}

export async function postAnnualBonusPaymentUseCase(params: {
  actor: Actor | null;
  input: PostAnnualBonusPaymentInput;
  transactions: AccountingTransactionManager;
}): Promise<{
  movementId: string;
  amountMinor: number;
  defaultAmountMinor: number;
  bonusNumber: number;
  remainingAnnualSlots: number;
  period: AccountingPeriod;
  year: number;
  semester: 1 | 2;
  referenceAmountMinor: number;
  referencePeriod: AccountingPeriod | null;
}> {
  const actor = ensureDirectivo(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const employee = await dataAccess.employees.getById(params.input.employeeId);
    assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);

    const operationYear = params.input.operationDate.getUTCFullYear();
    const operationMonth = String(params.input.operationDate.getUTCMonth() + 1).padStart(2, '0');
    const targetPeriod = params.input.period ?? `${operationYear}-${operationMonth}` as AccountingPeriod;
    const [preview, bonusCategory] = await Promise.all([
      calculateAnnualBonusPreview({ dataAccess, employeeId: employee.id, period: targetPeriod }),
      dataAccess.financialExpenseCategories.getById(FINANCIAL_EXPENSE_CATEGORY_IDS.aguinaldo),
    ]);
    assertCondition(bonusCategory, 'not-found', `No existe financial_expense_categories/${FINANCIAL_EXPENSE_CATEGORY_IDS.aguinaldo}.`);
    assertCondition(
      preview.referenceAmountMinor > 0,
      'failed-precondition',
      'No existe un sueldo liquidado en el semestre ni una configuracion salarial activa para calcular el aguinaldo.',
    );
    assertCondition(
      preview.postedAnnualBonusCount < 2,
      'failed-precondition',
      `El empleado ya tiene registrados dos aguinaldos para ${preview.year}.`,
    );
    assertCondition(
      !preview.alreadyPosted,
      'failed-precondition',
      `El empleado ya tiene registrado el aguinaldo del ${preview.semester === 1 ? 'primer' : 'segundo'} semestre de ${preview.year}.`,
    );

    const defaultAmountMinor = preview.defaultAmountMinor;
    const amountMinor = params.input.amountMinor ?? defaultAmountMinor;
    assertCondition(amountMinor > 0, 'invalid-argument', 'El monto del aguinaldo debe ser mayor a cero.');

    const paymentMethodId = params.input.paymentMethodId?.trim() || PAYMENT_METHOD_IDS.transferMacro;
    const paymentMethod = await dataAccess.paymentMethods.getById(paymentMethodId);
    assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${paymentMethodId}.`);
    assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${paymentMethodId} esta inactivo.`);

    const bonusNumber = preview.semester;
    const movement = await createPostedMovement({
      dataAccess,
      actorUid: actor.uid,
      movementType: 'expense',
      categoryId: bonusCategory.id,
      categoryCodeSnapshot: bonusCategory.id,
      grossAmountMinor: amountMinor,
      operationDate: params.input.operationDate,
      originType: 'annual_bonus_payment',
      originCollection: 'financial_movements',
      originId: null,
      thirdPartyType: 'employee',
      thirdPartyId: employee.id,
      paymentMethodId: paymentMethod.id,
      bancarizado: paymentMethod.id !== PAYMENT_METHOD_IDS.cash,
      imputableImpositivo: true,
      metadata: {
        annualBonusYear: preview.year,
        annualBonusSemester: preview.semester,
        annualBonusPeriod: preview.period,
        annualBonusNumber: bonusNumber,
        semesterPeriods: preview.semesterPeriods,
        salaryReferenceAmountMinor: preview.referenceAmountMinor,
        salaryReferencePeriod: preview.referencePeriod,
        salaryReferenceSource: preview.referenceSource,
        defaultAmountMinor,
        manuallyAdjusted: amountMinor !== defaultAmountMinor,
      },
      notes: params.input.notes ?? null,
      applyPaymentCommission: false,
    });

    return {
      movementId: movement.movementId,
      amountMinor,
      defaultAmountMinor,
      bonusNumber,
      remainingAnnualSlots: Math.max(0, preview.remainingAnnualSlots - 1),
      period: preview.period,
      year: preview.year,
      semester: preview.semester,
      referenceAmountMinor: preview.referenceAmountMinor,
      referencePeriod: preview.referencePeriod,
    };
  });
}

export function parsePostAnnualBonusPaymentInput(payload: unknown): PostAnnualBonusPaymentInput {
  const data = assertIsRecord(payload);

  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    amountMinor: parseOptionalAmountMinor(data, 'amountMinor'),
    paymentMethodId: parseOptionalNullableString(data, 'paymentMethodId'),
    operationDate: parseRequiredIsoDate(data, 'operationDate'),
    notes: parseOptionalNullableString(data, 'notes'),
    period: parseOptionalAccountingPeriod(data, 'period'),
  };
}
export function parseUpsertSalaryConfigurationInput(payload: unknown): UpsertSalaryConfigurationInput {
  const data = assertIsRecord(payload);

  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    contractType: parseRequiredString(data, 'contractType'),
    baseAmountMinor: parseRequiredAmountMinor(data, 'baseAmountMinor'),
    periodicity: parseRequiredString(data, 'periodicity') as SalaryPeriodicity,
    effectiveFrom: parseRequiredIsoDate(data, 'effectiveFrom'),
    allowOvertime: parseOptionalBoolean(data, 'allowOvertime'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parsePostSalaryPaymentInput(payload: unknown): PostSalaryPaymentInput {
  const data = assertIsRecord(payload);

  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
    salaryConfigurationId: parseOptionalNullableString(data, 'salaryConfigurationId'),
    salaryGrossMinor: parseOptionalAmountMinor(data, 'salaryGrossMinor'),
    overtimeHours: parseOptionalFiniteNumber(data, 'overtimeHours') ?? null,
    overtimeAmountMinor: parseOptionalAmountMinor(data, 'overtimeAmountMinor') ?? null,
    bankedAmountMinor: parseOptionalAmountMinor(data, 'bankedAmountMinor'),
    nonBankedAmountMinor: parseOptionalAmountMinor(data, 'nonBankedAmountMinor'),
    linkedExternalReferenceIds: parseOptionalStringArray(data, 'linkedExternalReferenceIds'),
    operationDate: parseOptionalIsoDate(data, 'operationDate'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}
