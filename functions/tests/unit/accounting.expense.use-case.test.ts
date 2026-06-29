import assert from 'node:assert/strict';
import test from 'node:test';
import { FINANCIAL_EXPENSE_CATEGORY_IDS } from '../../src/modules/accounting/domain/constants.js';
import {
  postExpenseMovementUseCase,
  reviewExpenseUseCase,
  submitExpenseUseCase,
} from '../../src/modules/accounting/application/use-cases/expense.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedAccountingEmployee,
  seedActiveFinancialConfig,
  seedExpenseCategory,
} from '../helpers/accounting-fakes.js';

function createAdminActor() {
  return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}

function setupExpenseFixture() {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingEmployee(manager, 'employee-1');
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.proveedores);
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.servidor, {
    name: 'SERVIDOR',
    defaultBancarizado: true,
    defaultImputableImpositivo: true,
  });
  return manager;
}

test('egreso exige categoria de egreso valida', async () => {
  const manager = setupExpenseFixture();

  await assert.rejects(
    () =>
      submitExpenseUseCase({
        actor: createAdminActor(),
        input: {
          employeeId: 'employee-1',
          categoryId: 'green_fee',
          description: 'Compra operativa',
          expenseDate: new Date('2026-04-01T00:00:00.000Z'),
          amountMinor: 100_000,
        },
        transactions: manager,
      }),
    /financial_expense_categories\/green_fee/i,
  );
});

test('rendicion aprobada genera movimiento de egreso con categoria existente', async () => {
  const manager = setupExpenseFixture();

  const submitted = await submitExpenseUseCase({
    actor: createAdminActor(),
    input: {
      employeeId: 'employee-1',
      categoryId: FINANCIAL_EXPENSE_CATEGORY_IDS.proveedores,
      description: 'Pago a proveedor',
      expenseDate: new Date('2026-04-01T00:00:00.000Z'),
      amountMinor: 250_000,
      vendorName: 'Proveedor SA',
    },
    transactions: manager,
  });

  await reviewExpenseUseCase({
    actor: createAdminActor(),
    input: { expenseSubmissionId: submitted.expenseSubmissionId, decision: 'approved' },
    transactions: manager,
  });

  const posted = await postExpenseMovementUseCase({
    actor: createAdminActor(),
    input: { expenseSubmissionId: submitted.expenseSubmissionId, notes: 'Posteado desde test.' },
    transactions: manager,
  });

  const movement = manager.financialMovements.get(posted.movementId);
  assert.equal(movement?.movementType, 'expense');
  assert.equal(movement?.categoryId, FINANCIAL_EXPENSE_CATEGORY_IDS.proveedores);
  assert.equal(movement?.originType, 'expense_submission');
});

test('rechazar rendicion exige motivo', async () => {
  const manager = setupExpenseFixture();
  const submitted = await submitExpenseUseCase({
    actor: createAdminActor(),
    input: {
      employeeId: 'employee-1',
      categoryId: FINANCIAL_EXPENSE_CATEGORY_IDS.proveedores,
      description: 'Compra sin comprobante',
      expenseDate: new Date('2026-04-01T00:00:00.000Z'),
      amountMinor: 90_000,
    },
    transactions: manager,
  });

  await assert.rejects(
    () =>
      reviewExpenseUseCase({
        actor: createAdminActor(),
        input: { expenseSubmissionId: submitted.expenseSubmissionId, decision: 'rejected' },
        transactions: manager,
      }),
    /rejectionReason es obligatorio/i,
  );
});

test('gasto servidor queda como egreso categorizado normal', async () => {
  const manager = setupExpenseFixture();

  const submitted = await submitExpenseUseCase({
    actor: createAdminActor(),
    input: {
      employeeId: 'employee-1',
      categoryId: FINANCIAL_EXPENSE_CATEGORY_IDS.servidor,
      description: 'Servidor mensual',
      expenseDate: new Date('2026-04-01T00:00:00.000Z'),
      amountMinor: 180_000,
      vendorName: 'Hosting',
    },
    transactions: manager,
  });

  await reviewExpenseUseCase({
    actor: createAdminActor(),
    input: { expenseSubmissionId: submitted.expenseSubmissionId, decision: 'approved' },
    transactions: manager,
  });

  const posted = await postExpenseMovementUseCase({
    actor: createAdminActor(),
    input: { expenseSubmissionId: submitted.expenseSubmissionId },
    transactions: manager,
  });

  const movement = manager.financialMovements.get(posted.movementId);
  assert.equal(movement?.categoryId, FINANCIAL_EXPENSE_CATEGORY_IDS.servidor);
  assert.equal(movement?.bancarizado, true);
  assert.equal(movement?.imputableImpositivo, true);
});
