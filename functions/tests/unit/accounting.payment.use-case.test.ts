import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
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
  seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, { originType: 'member_fee_charge' });
  return manager;
}

function createEmployeeActor() {
  return createAccountingActor('employee-1', ['empleado'], { empleado: true });
}

function timestamp(value: string) {
  return Timestamp.fromDate(new Date(value));
}

function seedPendingMemberFeeCharge(manager: InMemoryAccountingTransactionManager, memberFeeChargeId = 'fee-charge-1') {
  const now = timestamp('2026-05-01T00:00:00.000Z');
  manager.memberFeeCharges.set(memberFeeChargeId, {
    id: memberFeeChargeId,
    memberId: 'member-1',
    familyGroupId: null,
    holderMemberId: null,
    period: '2026-05',
    configVersion: 1,
    memberTypeCodeSnapshot: 'pleno',
    billingMode: 'per_member',
    baseAmountMinor: 11_000_000,
    appliedPctBps: 10_000,
    finalAmountMinor: 11_000_000,
    status: 'pending',
    dueDate: timestamp('2026-05-10T00:00:00.000Z'),
    generatedByUid: 'admin-1',
    createdAt: now,
    createdBy: 'admin-1',
    updatedAt: now,
    updatedBy: 'admin-1',
  });
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
  assert.match(String(result.receiptNumber ?? ''), /^REC-20260401-/);
  assert.equal((movement?.metadata as { receiptNumber?: string } | undefined)?.receiptNumber, result.receiptNumber);
});

test('empleado no puede registrar pagos', async () => {
  const manager = setupPaymentFixture();

  await assert.rejects(
    () =>
      registerPaymentUseCase({
        actor: createEmployeeActor(),
        input: {
          sourceType: 'green_fee',
          memberId: 'member-1',
          categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
          paymentMethodId: PAYMENT_METHOD_IDS.cash,
          grossAmountMinor: 100_000,
          operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
      }),
    /permisos|permission|directivo|administrativo/i,
  );
});

test('no permite registrar pagos nuevos para socio dado de baja', async () => {
  const manager = setupPaymentFixture();
  seedAccountingMember(manager, 'member-1', { status: 'inactive' });

  await assert.rejects(
    () =>
      registerPaymentUseCase({
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
      }),
    /dados de baja|suspendidos/i,
  );
});

test('no permite cobrar cuota pendiente de socio dado de baja', async () => {
  const manager = setupPaymentFixture();
  seedPendingMemberFeeCharge(manager);
  seedAccountingMember(manager, 'member-1', { status: 'inactive' });

  await assert.rejects(
    () =>
      registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
          sourceType: 'member_fee_charge',
          sourceId: 'fee-charge-1',
          memberId: 'member-1',
          categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
          paymentMethodId: PAYMENT_METHOD_IDS.cash,
          grossAmountMinor: 11_000_000,
          operationDate: new Date('2026-05-05T03:00:00.000Z'),
        },
        transactions: manager,
      }),
    /dados de baja|suspendidos/i,
  );
});

test('pronto pago aplica 10% del dia 1 al 10 y actualiza membresia', async () => {
  const manager = setupPaymentFixture();
  seedPendingMemberFeeCharge(manager);

  const result = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'member_fee_charge',
      sourceId: 'fee-charge-1',
      memberId: 'member-1',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
      paymentMethodId: PAYMENT_METHOD_IDS.cash,
      grossAmountMinor: 11_000_000,
      operationDate: new Date('2026-05-05T03:00:00.000Z'),
    },
    transactions: manager,
  });

  const movement = manager.financialMovements.get(result.movementId);
  const charge = manager.memberFeeCharges.get('fee-charge-1');
  const member = manager.members.get('member-1');
  assert.equal(movement?.grossAmountMinor, 9_900_000);
  assert.equal(movement?.netAmountMinor, 9_900_000);
  assert.equal(charge?.paidAmountMinor, 9_900_000);
  assert.equal(charge?.paymentDiscountPctBps, 1_000);
  assert.equal(charge?.paymentDiscountAmountMinor, 1_100_000);
  assert.equal(member?.membershipRenewalStatus, 'current');
  assert.equal(member?.lastFeePaidAmountMinor, 9_900_000);
});

test('cuota cobrada fuera del periodo no aplica pronto pago pero permite renovar', async () => {
  const manager = setupPaymentFixture();
  seedPendingMemberFeeCharge(manager);

  const result = await registerPaymentUseCase({
    actor: createAdminActor(),
    input: {
      sourceType: 'member_fee_charge',
      sourceId: 'fee-charge-1',
      memberId: 'member-1',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
      paymentMethodId: PAYMENT_METHOD_IDS.cash,
      grossAmountMinor: 11_000_000,
      operationDate: new Date('2026-06-05T03:00:00.000Z'),
    },
    transactions: manager,
  });

  const movement = manager.financialMovements.get(result.movementId);
  const charge = manager.memberFeeCharges.get('fee-charge-1');
  const metadata = movement?.metadata as {
    isFeePaymentOutsidePeriod?: boolean;
    feeChargePeriod?: string;
    feePaymentAccountingPeriod?: string;
  } | undefined;
  const member = manager.members.get('member-1');
  assert.equal(movement?.grossAmountMinor, 11_000_000);
  assert.equal(charge?.paymentDiscountAmountMinor, 0);
  assert.equal(charge?.paymentDiscountPctBps, 0);
  assert.equal(metadata?.isFeePaymentOutsidePeriod, true);
  assert.equal(metadata?.feeChargePeriod, '2026-05');
  assert.equal(metadata?.feePaymentAccountingPeriod, '2026-06');
  assert.equal(member?.membershipRenewalStatus, 'current');
});
