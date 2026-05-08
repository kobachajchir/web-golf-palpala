import assert from 'node:assert/strict';
import test from 'node:test';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../src/modules/accounting/domain/constants.js';
import { registerPaymentUseCase } from '../../src/modules/accounting/application/use-cases/payment.use-cases.js';
import { setCreditCommissionRuleUseCase } from '../../src/modules/accounting/application/use-cases/config.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedActiveFinancialConfig,
  seedAccountingMember,
  seedCommissionRule,
  seedIncomeCategory,
  seedPaymentMethod,
} from '../helpers/accounting-fakes.js';

function createAdminActor() {
  return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}

function createDirectivoActor() {
  return createAccountingActor('board-1', ['directivo'], { directivo: true });
}

function setupPaymentFixture() {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-1');
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.credit, { bancarizado: true });
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.transfer, { bancarizado: true });
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.debit, { bancarizado: true });
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.debitMacro, { bancarizado: true, specialReportingType: 'macro_debit' });
  seedCommissionRule(manager, 'credit-rule-1', { paymentMethodId: PAYMENT_METHOD_IDS.credit, percentageBps: 300 });
  seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.greenFee);
  return manager;
}

test('credit aplica comisión vigente', async () => {
  const manager = setupPaymentFixture();

  const result = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'green_fee',
      memberId: 'member-1',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      paymentMethodId: PAYMENT_METHOD_IDS.credit,
      paymentReference: 'TC-001',
      grossAmountMinor: 100_000,
      operationDate: new Date('2026-04-01T00:00:00.000Z'),
    },
    transactions: manager,
  });

  const movement = manager.financialMovements.get(result.movementId);
  assert.ok(movement);
  assert.equal(movement?.appliedCommissionPctBps, 300);
  assert.equal(movement?.appliedCommissionAmountMinor, 3_000);
  assert.equal(movement?.netAmountMinor, 97_000);
});

test('cambio de comisión futura no altera histórico', async () => {
  const manager = setupPaymentFixture();

  const firstPayment = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'green_fee',
      memberId: 'member-1',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      paymentMethodId: PAYMENT_METHOD_IDS.credit,
      paymentReference: 'TC-002',
      grossAmountMinor: 100_000,
      operationDate: new Date('2026-04-01T00:00:00.000Z'),
    },
    transactions: manager,
  });

  await setCreditCommissionRuleUseCase({
    actor: createDirectivoActor(),
    input: {
      percentageBps: 500,
      validFrom: new Date('2026-05-01T00:00:00.000Z'),
    },
    transactions: manager,
  });

  const firstMovement = manager.financialMovements.get(firstPayment.movementId);
  assert.ok(firstMovement);
  assert.equal(firstMovement?.appliedCommissionPctBps, 300);
});

test('cash = bancarizado false', async () => {
  const manager = setupPaymentFixture();

  const result = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'green_fee',
      memberId: 'member-1',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      paymentMethodId: PAYMENT_METHOD_IDS.cash,
      grossAmountMinor: 100_000,
      operationDate: new Date('2026-04-01T00:00:00.000Z'),
    },
    transactions: manager,
  });

  assert.equal(manager.financialMovements.get(result.movementId)?.bancarizado, false);
});

test('transfer = bancarizado true', async () => {
  const manager = setupPaymentFixture();

  const result = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'green_fee',
      memberId: 'member-1',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      paymentMethodId: PAYMENT_METHOD_IDS.transfer,
      paymentReference: 'TR-001',
      grossAmountMinor: 100_000,
      operationDate: new Date('2026-04-01T00:00:00.000Z'),
    },
    transactions: manager,
  });

  assert.equal(manager.financialMovements.get(result.movementId)?.bancarizado, true);
});

test('debit = bancarizado true sin reporte Macro', async () => {
  const manager = setupPaymentFixture();

  const result = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'green_fee',
      memberId: 'member-1',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      paymentMethodId: PAYMENT_METHOD_IDS.debit,
      paymentReference: 'DEB-001',
      grossAmountMinor: 100_000,
      operationDate: new Date('2026-04-01T00:00:00.000Z'),
    },
    transactions: manager,
  });

  const movement = manager.financialMovements.get(result.movementId);
  assert.equal(movement?.bancarizado, true);
  assert.equal((movement?.metadata as { specialReportingType?: string | null } | undefined)?.specialReportingType, null);
});

test('debit_macro = bancarizado true + special reporting', async () => {
  const manager = setupPaymentFixture();

  const result = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'green_fee',
      memberId: 'member-1',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      paymentMethodId: PAYMENT_METHOD_IDS.debitMacro,
      paymentReference: 'MACRO-001',
      grossAmountMinor: 100_000,
      operationDate: new Date('2026-04-01T00:00:00.000Z'),
    },
    transactions: manager,
  });

  const movement = manager.financialMovements.get(result.movementId);
  assert.equal(movement?.bancarizado, true);
  assert.equal((movement?.metadata as { specialReportingType?: string } | undefined)?.specialReportingType, 'macro_debit');
});

test('medios no efectivo requieren referencia de pago', async () => {
  const manager = setupPaymentFixture();

  await assert.rejects(
    () =>
      registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
          sourceType: 'green_fee',
          memberId: 'member-1',
          categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
          paymentMethodId: PAYMENT_METHOD_IDS.transfer,
          grossAmountMinor: 100_000,
          operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
      }),
    /referencia de pago/i,
  );
});

test('ingreso manual permite medios no efectivo sin referencia', async () => {
  const manager = setupPaymentFixture();

  const result = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'manual_income',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      paymentMethodId: PAYMENT_METHOD_IDS.transfer,
      grossAmountMinor: 100_000,
      operationDate: new Date('2026-04-01T00:00:00.000Z'),
    },
    transactions: manager,
  });

  assert.ok(manager.financialMovements.get(result.movementId));
});

test('referencia de pago queda en metadata del movimiento', async () => {
  const manager = setupPaymentFixture();

  const result = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'green_fee',
      memberId: 'member-1',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      paymentMethodId: PAYMENT_METHOD_IDS.transfer,
      paymentReference: 'TRX-123',
      grossAmountMinor: 100_000,
      operationDate: new Date('2026-04-01T00:00:00.000Z'),
    },
    transactions: manager,
  });

  const movement = manager.financialMovements.get(result.movementId);
  assert.equal((movement?.metadata as { paymentReference?: string } | undefined)?.paymentReference, 'TRX-123');
});
