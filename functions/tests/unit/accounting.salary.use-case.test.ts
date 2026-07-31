import assert from 'node:assert/strict';
import test from 'node:test';
import { FINANCIAL_EXPENSE_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../src/modules/accounting/domain/constants.js';
import { postAnnualBonusPaymentUseCase, postSalaryPaymentUseCase, upsertSalaryConfigurationUseCase } from '../../src/modules/accounting/application/use-cases/salary.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedAccountingEmployee,
  seedActiveFinancialConfig,
  seedExpenseCategory,
  seedPaymentMethod,
} from '../helpers/accounting-fakes.js';

function createDirectivoActor() {
  return createAccountingActor('board-1', ['directivo'], { directivo: true });
}

function createAdministrativeActor() {
  return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}

test('administracion puede modificar el sueldo y generar su pago', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedAccountingEmployee(manager, 'employee-1');
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo);
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra);
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.transferMacro, { bancarizado: true });

  const salaryConfiguration = await upsertSalaryConfigurationUseCase({
    actor: createAdministrativeActor(),
    input: {
      employeeId: 'employee-1',
      contractType: 'monthly',
      baseAmountMinor: 26_000_000,
      periodicity: 'monthly',
      effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
      allowOvertime: true,
      notes: 'Actualizado por Administracion',
    },
    transactions: manager,
  });

  assert.equal(manager.salaryConfigurations.get(salaryConfiguration.salaryConfigurationId)?.baseAmountMinor, 26_000_000);
  assert.equal(manager.salaryConfigurations.get(salaryConfiguration.salaryConfigurationId)?.setByUid, 'admin-1');

  const payment = await postSalaryPaymentUseCase({
    actor: createAdministrativeActor(),
    input: {
      employeeId: 'employee-1',
      period: '2026-07',
      salaryConfigurationId: salaryConfiguration.salaryConfigurationId,
    },
    transactions: manager,
  });

  assert.equal(payment.duplicate, false);
  assert.equal(manager.salaryPayments.get(payment.salaryPaymentId)?.approvedByUid, 'admin-1');
  assert.equal(payment.financialMovementIds.length, 1);
});

test('horas extra = bancarizado false e imputableImpositivo false', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingEmployee(manager, 'employee-1');
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo);
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra, {
    defaultBancarizado: false,
    defaultImputableImpositivo: false,
  });
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.transferMacro, { bancarizado: true });
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });

  const actor = createDirectivoActor();
  const salaryConfiguration = await upsertSalaryConfigurationUseCase({
    actor,
    input: {
      employeeId: 'employee-1',
      contractType: 'monthly',
      baseAmountMinor: 25_000_000,
      periodicity: 'monthly',
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      allowOvertime: true,
    },
    transactions: manager,
  });

  const result = await postSalaryPaymentUseCase({
    actor,
    input: {
      employeeId: 'employee-1',
      period: '2026-04',
      salaryConfigurationId: salaryConfiguration.salaryConfigurationId,
      salaryGrossMinor: 25_000_000,
      bankedAmountMinor: 25_000_000,
      nonBankedAmountMinor: 0,
      overtimeHours: 4,
      overtimeAmountMinor: 1_200_000,
    },
    transactions: manager,
  });

  const movements = result.financialMovementIds.map((movementId) => manager.financialMovements.get(movementId));
  const overtimeMovement = movements.find((movement) => movement?.categoryCodeSnapshot === FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra);
  assert.ok(overtimeMovement);
  assert.equal(overtimeMovement?.bancarizado, false);
  assert.equal(overtimeMovement?.imputableImpositivo, false);
});

test('aguinaldo calcula 50%, permite ajuste y bloquea el tercero del año', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedAccountingEmployee(manager, 'employee-1');
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.aguinaldo);
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo);
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra);
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.transferMacro, { bancarizado: true });

  const actor = createAdministrativeActor();
  const salaryConfiguration = await upsertSalaryConfigurationUseCase({
    actor,
    input: {
      employeeId: 'employee-1',
      contractType: 'monthly',
      baseAmountMinor: 20_000_000,
      periodicity: 'monthly',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      allowOvertime: false,
    },
    transactions: manager,
  });

  await postSalaryPaymentUseCase({
    actor,
    input: {
      employeeId: 'employee-1',
      period: '2026-04',
      salaryConfigurationId: salaryConfiguration.salaryConfigurationId,
      salaryGrossMinor: 20_000_000,
    },
    transactions: manager,
  });
  await postSalaryPaymentUseCase({
    actor,
    input: {
      employeeId: 'employee-1',
      period: '2026-05',
      salaryConfigurationId: salaryConfiguration.salaryConfigurationId,
      salaryGrossMinor: 24_000_000,
    },
    transactions: manager,
  });

  const first = await postAnnualBonusPaymentUseCase({
    actor,
    input: {
      employeeId: 'employee-1',
      period: '2026-06',
      operationDate: new Date('2026-06-30T15:00:00.000Z'),
    },
    transactions: manager,
  });
  assert.equal(first.amountMinor, 12_000_000);
  assert.equal(first.referenceAmountMinor, 24_000_000);
  assert.equal(first.referencePeriod, '2026-05');
  assert.equal(first.bonusNumber, 1);
  assert.equal(first.remainingAnnualSlots, 1);

  await assert.rejects(
    () => postAnnualBonusPaymentUseCase({
      actor,
      input: {
        employeeId: 'employee-1',
        period: '2026-05',
        operationDate: new Date('2026-07-02T15:00:00.000Z'),
      },
      transactions: manager,
    }),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'failed-precondition',
  );

  const second = await postAnnualBonusPaymentUseCase({
    actor,
    input: {
      employeeId: 'employee-1',
      period: '2026-12',
      amountMinor: 13_000_000,
      operationDate: new Date('2026-12-18T15:00:00.000Z'),
    },
    transactions: manager,
  });
  assert.equal(second.amountMinor, 13_000_000);
  assert.equal(second.bonusNumber, 2);
  assert.equal(second.remainingAnnualSlots, 0);
  assert.equal(manager.financialMovements.get(second.movementId)?.metadata?.manuallyAdjusted, true);
  assert.equal(manager.financialMovements.get(second.movementId)?.metadata?.annualBonusSemester, 2);

  await assert.rejects(
    () => postAnnualBonusPaymentUseCase({
      actor,
      input: {
        employeeId: 'employee-1',
        period: '2026-12',
        operationDate: new Date('2026-12-22T15:00:00.000Z'),
      },
      transactions: manager,
    }),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'failed-precondition',
  );
});
