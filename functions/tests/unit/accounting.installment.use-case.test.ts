import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINANCIAL_EXPENSE_CATEGORY_IDS,
  FINANCIAL_INCOME_CATEGORY_IDS,
  PAYMENT_METHOD_IDS,
} from '../../src/modules/accounting/domain/constants.js';
import {
  createInstallmentPlanUseCase,
  listMyReceiptsUseCase,
  registerInstallmentPaymentUseCase,
} from '../../src/modules/accounting/application/use-cases/installment.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedAccountingMember,
  seedCommissionRule,
  seedExpenseCategory,
  seedIncomeCategory,
  seedPaymentMethod,
} from '../helpers/accounting-fakes.js';

function setupFixture() {
  const manager = new InMemoryAccountingTransactionManager();
  seedAccountingMember(manager, 'member-1');
  seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.greenFee);
  seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.varios);
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.creditGalicia, { bancarizado: true });
  seedCommissionRule(manager, 'credit-rule', {
    paymentMethodId: PAYMENT_METHOD_IDS.creditGalicia,
    percentageBps: 300,
  });
  return manager;
}

function createAdminActor() {
  return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}

test('una carga de ingreso reparte capital e interes y permite pagar cuotas con distintos medios', async () => {
  const manager = setupFixture();
  const plan = await createInstallmentPlanUseCase({
    actor: createAdminActor(),
    input: {
      movementType: 'income',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      baseAmountMinor: 100_000,
      installmentCount: 3,
      interestPctBps: 1_000,
      operationDate: new Date('2026-06-01T12:00:00.000Z'),
      thirdPartyType: 'member',
      thirdPartyId: 'member-1',
      metadata: { description: 'Green fee en cuotas' },
    },
    transactions: manager,
  });

  assert.equal(plan.interestAmountMinor, 10_000);
  assert.equal(plan.totalAmountMinor, 110_000);
  assert.equal(plan.installmentAmountsMinor.reduce((sum, amount) => sum + amount, 0), 110_000);
  const root = manager.financialMovements.get(plan.movementId);
  assert.equal(root?.installmentPlanId, plan.movementId);
  assert.equal(root?.excludeFromBalance, true);
  assert.equal(root?.installmentPaidAmountMinor, 0);

  const firstPayment = await registerInstallmentPaymentUseCase({
    actor: createAdminActor(),
    input: {
      installmentPlanId: plan.installmentPlanId,
      paymentMethodId: PAYMENT_METHOD_IDS.cash,
      operationDate: new Date('2026-06-01T12:00:00.000Z'),
    },
    transactions: manager,
  });
  const secondPayment = await registerInstallmentPaymentUseCase({
    actor: createAdminActor(),
    input: {
      installmentPlanId: plan.installmentPlanId,
      paymentMethodId: PAYMENT_METHOD_IDS.creditGalicia,
      paymentReference: 'TC-CUOTA-2',
      operationDate: new Date('2026-07-01T12:00:00.000Z'),
    },
    transactions: manager,
  });

  assert.equal(firstPayment.installmentNumber, 1);
  assert.equal(secondPayment.installmentNumber, 2);
  assert.equal(secondPayment.netAmountMinor, secondPayment.scheduledAmountMinor);
  assert.equal(secondPayment.grossAmountMinor, Math.round(secondPayment.scheduledAmountMinor * 1.03));
  const updatedRoot = manager.financialMovements.get(plan.movementId);
  assert.equal(updatedRoot?.installmentPaidCount, 2);
  assert.equal(
    updatedRoot?.installmentPaidAmountMinor,
    firstPayment.scheduledAmountMinor + secondPayment.scheduledAmountMinor,
  );

  const memberActor = createAccountingActor('member-user', ['socio'], { socio: true });
  memberActor.user.profileType = 'member';
  memberActor.user.profileId = 'member-1';
  const receiptResult = await listMyReceiptsUseCase({ actor: memberActor, transactions: manager });
  assert.equal(receiptResult.receipts.length, 2);
  assert.ok(receiptResult.receipts.every((receipt) => receipt.receiptNumber.startsWith('REC-')));
});

test('una cuota de egreso suma la comision al total debitado y no emite recibo de cobro', async () => {
  const manager = setupFixture();
  const plan = await createInstallmentPlanUseCase({
    actor: createAdminActor(),
    input: {
      movementType: 'expense',
      categoryId: FINANCIAL_EXPENSE_CATEGORY_IDS.varios,
      baseAmountMinor: 60_000,
      installmentCount: 2,
      interestPctBps: 0,
      operationDate: new Date('2026-07-01T12:00:00.000Z'),
      thirdPartyType: 'external',
      metadata: { vendorName: 'Proveedor de prueba' },
    },
    transactions: manager,
  });

  const payment = await registerInstallmentPaymentUseCase({
    actor: createAdminActor(),
    input: {
      installmentPlanId: plan.installmentPlanId,
      paymentMethodId: PAYMENT_METHOD_IDS.creditGalicia,
      paymentReference: 'PROV-001',
      operationDate: new Date('2026-07-01T12:00:00.000Z'),
    },
    transactions: manager,
  });

  assert.equal(payment.scheduledAmountMinor, 30_000);
  assert.equal(payment.grossAmountMinor, 30_000);
  assert.equal(payment.netAmountMinor, 30_900);
  assert.equal(payment.receiptNumber, null);
});

test('pagos parciales aceptan importes y medios distintos hasta cancelar el saldo', async () => {
  const manager = setupFixture();
  const plan = await createInstallmentPlanUseCase({
    actor: createAdminActor(),
    input: {
      movementType: 'income',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
      baseAmountMinor: 100_000,
      interestPctBps: 0,
      operationDate: new Date('2026-07-01T12:00:00.000Z'),
      thirdPartyType: 'member',
      thirdPartyId: 'member-1',
      metadata: { description: 'Pago flexible' },
    },
    transactions: manager,
  });

  assert.equal(plan.installmentCount, null);
  assert.equal(manager.financialMovements.get(plan.movementId)?.metadata?.partialPaymentMode, 'flexible');

  const cashPayment = await registerInstallmentPaymentUseCase({
    actor: createAdminActor(),
    input: {
      installmentPlanId: plan.installmentPlanId,
      paymentMethodId: PAYMENT_METHOD_IDS.cash,
      amountMinor: 40_000,
      operationDate: new Date('2026-07-02T12:00:00.000Z'),
    },
    transactions: manager,
  });
  const cardPayment = await registerInstallmentPaymentUseCase({
    actor: createAdminActor(),
    input: {
      installmentPlanId: plan.installmentPlanId,
      paymentMethodId: PAYMENT_METHOD_IDS.creditGalicia,
      paymentReference: 'TC-PARCIAL',
      amountMinor: 60_000,
      operationDate: new Date('2026-07-15T12:00:00.000Z'),
    },
    transactions: manager,
  });

  assert.equal(cashPayment.completed, false);
  assert.equal(cardPayment.completed, true);
  assert.equal(cardPayment.paidAmountMinor, 100_000);
  assert.equal(cardPayment.grossAmountMinor, 61_800);
  assert.equal(cardPayment.netAmountMinor, 60_000);
  assert.equal(manager.financialMovements.get(plan.movementId)?.status, 'posted');
});