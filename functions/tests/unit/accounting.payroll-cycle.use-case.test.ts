import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINANCIAL_EXPENSE_CATEGORY_IDS,
  PAYMENT_METHOD_IDS,
} from '../../src/modules/accounting/domain/constants.js';
import {
  recordExternalReferenceUseCase,
  upsertEmployeeExternalReferenceUseCase,
} from '../../src/modules/accounting/application/use-cases/external-reference.use-cases.js';
import {
  createOvertimeEntryUseCase,
  linkExternalReferenceToEmployeeUseCase,
  listEmployeePayrollCycleUseCase,
  postEmployeePayrollCycleUseCase,
  recordEmployeeCertificateUseCase,
  reviewOvertimeEntryUseCase,
} from '../../src/modules/accounting/application/use-cases/payroll-cycle.use-cases.js';
import { upsertSalaryConfigurationUseCase } from '../../src/modules/accounting/application/use-cases/salary.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedAccountingEmployee,
  seedActiveFinancialConfig,
  seedExpenseCategory,
  seedPaymentMethod,
} from '../helpers/accounting-fakes.js';

function createAdminActor() {
  return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}

function createDirectivoActor() {
  return createAccountingActor('board-1', ['directivo'], { directivo: true });
}

async function setupPayrollFixture() {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingEmployee(manager, 'employee-1');
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo);
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra, {
    defaultBancarizado: false,
    defaultImputableImpositivo: false,
  });
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.transfer, { bancarizado: true });
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });

  const actor = createDirectivoActor();
  const salaryConfiguration = await upsertSalaryConfigurationUseCase({
    actor,
    input: {
      employeeId: 'employee-1',
      contractType: 'monthly',
      baseAmountMinor: 25_000_000,
      periodicity: 'monthly',
      effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
      allowOvertime: true,
    },
    transactions: manager,
  });

  return { manager, salaryConfigurationId: salaryConfiguration.salaryConfigurationId };
}

test('horas extra aprobadas entran en liquidacion y generan movimiento no bancarizado/no imputable', async () => {
  const { manager, salaryConfigurationId } = await setupPayrollFixture();
  const admin = createAdminActor();
  const directivo = createDirectivoActor();

  const overtime = await createOvertimeEntryUseCase({
    actor: admin,
    input: {
      employeeId: 'employee-1',
      period: '2026-05',
      workDate: new Date('2026-05-08T03:00:00.000Z'),
      hours: 4,
      amountMinor: 1_200_000,
      reason: 'Torneo fin de semana',
    },
    transactions: manager,
  });

  await reviewOvertimeEntryUseCase({
    actor: directivo,
    input: {
      overtimeEntryId: overtime.overtimeEntryId,
      decision: 'approved',
    },
    transactions: manager,
  });

  const result = await postEmployeePayrollCycleUseCase({
    actor: directivo,
    input: {
      employeeId: 'employee-1',
      period: '2026-05',
      salaryConfigurationId,
      operationDate: new Date('2026-05-31T03:00:00.000Z'),
    },
    transactions: manager,
  });

  const cycle = manager.employeePayrollCycles.get(result.payrollCycleId);
  const overtimeEntry = manager.overtimeEntries.get(overtime.overtimeEntryId);
  const movements = result.financialMovementIds.map((movementId) => manager.financialMovements.get(movementId));
  const overtimeMovement = movements.find((movement) => movement?.categoryCodeSnapshot === FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra);

  assert.equal(cycle?.status, 'posted');
  assert.equal(cycle?.overtimeTotalHours, 4);
  assert.equal(cycle?.overtimeTotalMinor, 1_200_000);
  assert.equal(overtimeEntry?.status, 'liquidated');
  assert.equal(overtimeEntry?.linkedSalaryPaymentId, result.salaryPaymentId);
  assert.ok(overtimeMovement);
  assert.equal(overtimeMovement?.bancarizado, false);
  assert.equal(overtimeMovement?.imputableImpositivo, false);
});

test('F931 se registra como referencia externa y aparece vinculado en el ciclo mensual', async () => {
  const { manager } = await setupPayrollFixture();
  const admin = createAdminActor();

  const reference = await recordExternalReferenceUseCase({
    actor: admin,
    input: {
      referenceType: 'F931',
      providerName: 'AFIP',
      period: '2026-05',
      referenceNumber: 'F931-2026-05',
      amountMinor: 3_500_000,
    },
    transactions: manager,
  });

  const link = await linkExternalReferenceToEmployeeUseCase({
    actor: admin,
    input: {
      employeeId: 'employee-1',
      period: '2026-05',
      referenceId: reference.referenceId,
      allocatedAmountMinor: 1_000_000,
      paidAt: new Date('2026-05-15T03:00:00.000Z'),
    },
    transactions: manager,
  });

  const certificate = await recordEmployeeCertificateUseCase({
    actor: admin,
    input: {
      employeeId: 'employee-1',
      period: '2026-05',
      certificateType: 'RT',
      documentNumber: 'RT-001',
      issuedAt: new Date('2026-05-10T03:00:00.000Z'),
      expiresAt: new Date('2026-06-10T03:00:00.000Z'),
    },
    transactions: manager,
  });

  const cycle = await listEmployeePayrollCycleUseCase({
    actor: admin,
    input: {
      employeeId: 'employee-1',
      period: '2026-05',
    },
    transactions: manager,
  });

  assert.equal(link.duplicate, false);
  assert.equal(cycle.accountingLinks[0]?.id, link.linkId);
  assert.equal(cycle.accountingLinks[0]?.referenceType, 'F931');
  assert.equal(cycle.certificates[0]?.id, certificate.certificateId);
  assert.equal(cycle.certificates[0]?.certificateType, 'RT');
});

test('no duplica ART/F931 por empleado y periodo al cargar comprobante laboral', async () => {
  const { manager } = await setupPayrollFixture();
  const admin = createAdminActor();

  const first = await upsertEmployeeExternalReferenceUseCase({
    actor: admin,
    input: {
      employeeId: 'employee-1',
      referenceType: 'ART',
      providerName: 'ART Test',
      period: '2026-05',
      referenceNumber: 'ART-001',
      amountMinor: 2_000_000,
      attachmentUrl: 'https://storage.test/art-001.pdf',
    },
    transactions: manager,
  });
  const second = await upsertEmployeeExternalReferenceUseCase({
    actor: admin,
    input: {
      employeeId: 'employee-1',
      referenceType: 'ART',
      providerName: 'ART Test',
      period: '2026-05',
      referenceNumber: 'ART-001-B',
      amountMinor: 2_500_000,
      attachmentUrl: 'https://storage.test/art-001-b.pdf',
    },
    transactions: manager,
  });

  assert.equal(second.duplicate, true);
  assert.equal(second.referenceId, first.referenceId);
  assert.equal(second.linkId, first.linkId);
  assert.equal(manager.externalAccountingReferences.size, 1);
  assert.equal(manager.employeeAccountingLinks.size, 1);
  assert.equal(manager.externalAccountingReferences.get(first.referenceId)?.amountMinor, 2_500_000);
});
