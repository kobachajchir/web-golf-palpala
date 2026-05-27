import { Timestamp } from 'firebase-admin/firestore';
import {
  FINANCIAL_EXPENSE_CATEGORY_IDS,
  PAYMENT_METHOD_IDS,
} from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, SalaryPeriodicity } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureDirectivo,
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
  allowOvertime: boolean;
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

export async function upsertSalaryConfigurationUseCase(params: {
  actor: Actor | null;
  input: UpsertSalaryConfigurationInput;
  transactions: AccountingTransactionManager;
}): Promise<{ salaryConfigurationId: string }> {
  const actor = ensureDirectivo(params.actor);

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
        allowOvertime: params.input.allowOvertime,
        notes: params.input.notes ?? null,
        setByUid: actor.uid,
      },
      actor.uid,
    );

    return { salaryConfigurationId };
  });
}

export async function postSalaryPaymentUseCase(params: {
  actor: Actor | null;
  input: PostSalaryPaymentInput;
  transactions: AccountingTransactionManager;
}): Promise<{ salaryPaymentId: string; financialMovementIds: string[]; duplicate: boolean }> {
  const actor = ensureDirectivo(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const employee = await dataAccess.employees.getById(params.input.employeeId);
    assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);

    const existingPayment = await dataAccess.salaryPayments.findByEmployeeAndPeriod(params.input.employeeId, params.input.period);
    if (existingPayment?.status === 'posted') {
      return {
        salaryPaymentId: existingPayment.id,
        financialMovementIds: existingPayment.financialMovementIds,
        duplicate: true,
      };
    }

    const salaryConfiguration = params.input.salaryConfigurationId
      ? await dataAccess.salaryConfigurations.getById(params.input.salaryConfigurationId)
      : await dataAccess.salaryConfigurations.getActiveByEmployeeId(params.input.employeeId);
    assertCondition(salaryConfiguration, 'failed-precondition', 'No existe salary_configuration activa o indicada.');
    assertCondition(salaryConfiguration.isActive || params.input.salaryConfigurationId === salaryConfiguration.id, 'failed-precondition', 'La configuración salarial indicada no está activa.');

    const salaryCategory = await dataAccess.financialExpenseCategories.getById(FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo);
    const overtimeCategory = await dataAccess.financialExpenseCategories.getById(FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra);
    assertCondition(salaryCategory, 'not-found', `No existe financial_expense_categories/${FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo}.`);
    assertCondition(overtimeCategory, 'not-found', `No existe financial_expense_categories/${FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra}.`);

    const salaryGrossMinor = params.input.salaryGrossMinor ?? salaryConfiguration.baseAmountMinor;
    const bankedAmountMinor = params.input.bankedAmountMinor ?? salaryGrossMinor;
    const nonBankedAmountMinor = params.input.nonBankedAmountMinor ?? 0;
    const overtimeAmountMinor = params.input.overtimeAmountMinor ?? 0;
    const overtimeHours = params.input.overtimeHours ?? null;
    const operationDate = params.input.operationDate ?? new Date(`${params.input.period}-01T00:00:00.000Z`);

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
        paymentMethodId: PAYMENT_METHOD_IDS.transfer,
        bancarizado: true,
        imputableImpositivo: true,
        metadata: { part: 'banked_salary' },
        notes: params.input.notes ?? null,
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
        bancarizado: false,
        imputableImpositivo: true,
        metadata: { part: 'non_banked_salary' },
        notes: params.input.notes ?? null,
        applyPaymentCommission: false,
      });
      financialMovementIds.push(cashSalaryMovement.movementId);
    }

    if (overtimeAmountMinor > 0) {
      const activeConfig = await dataAccess.financialConfigs.getActive();
      assertCondition(activeConfig, 'failed-precondition', 'No existe una configuración financiera activa.');
      assertCondition(
        !activeConfig.requireApprovalForOvertimePosting || hasExecutiveAccess(actor),
        'permission-denied',
        'Las horas extra requieren aprobación del Comité Ejecutivo.',
      );

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
        bancarizado: false,
        imputableImpositivo: false,
        metadata: { overtimeHours },
        notes: params.input.notes ?? null,
        applyPaymentCommission: false,
      });
      financialMovementIds.push(overtimeMovement.movementId);
    }

    const salaryPaymentId = await dataAccess.salaryPayments.create(
      {
        employeeId: employee.id,
        period: params.input.period,
        salaryConfigurationId: salaryConfiguration.id,
        salaryGrossMinor,
        overtimeHours,
        overtimeAmountMinor: overtimeAmountMinor || null,
        overtimeBancarizado: false,
        overtimeImputableImpositivo: false,
        bankedAmountMinor,
        nonBankedAmountMinor,
        linkedExternalReferenceIds: params.input.linkedExternalReferenceIds ?? [],
        financialMovementIds,
        status: 'posted',
        approvedByUid: actor.uid,
        notes: params.input.notes ?? null,
      },
      actor.uid,
    );

    if (params.input.linkedExternalReferenceIds?.length) {
      const primaryMovementId = financialMovementIds[0] ?? null;
      for (const referenceId of params.input.linkedExternalReferenceIds) {
        const externalReference = await dataAccess.externalAccountingReferences.getById(referenceId);
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
      duplicate: false,
    };
  });
}

export function parseUpsertSalaryConfigurationInput(payload: unknown): UpsertSalaryConfigurationInput {
  const data = assertIsRecord(payload);

  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    contractType: parseRequiredString(data, 'contractType'),
    baseAmountMinor: parseRequiredAmountMinor(data, 'baseAmountMinor'),
    periodicity: parseRequiredString(data, 'periodicity') as SalaryPeriodicity,
    effectiveFrom: parseRequiredIsoDate(data, 'effectiveFrom'),
    allowOvertime: parseOptionalBoolean(data, 'allowOvertime') ?? false,
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
