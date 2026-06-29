import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../src/modules/accounting/domain/constants.js';
import type {
  MercadoPagoClient,
  MercadoPagoPaymentSnapshot,
  MercadoPagoPreferencePayload,
} from '../../src/modules/accounting/application/use-cases/mercado-pago.use-cases.js';
import {
  createMercadoPagoCheckoutUseCase,
  processMercadoPagoPaymentUseCase,
} from '../../src/modules/accounting/application/use-cases/mercado-pago.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedAccountingMember,
  seedActiveFinancialConfig,
  seedIncomeCategory,
  seedPaymentMethod,
} from '../helpers/accounting-fakes.js';

const fixedClock = {
  now: () => new Date('2026-05-20T15:00:00.000Z'),
};

const mercadoPagoRuntimeConfig = {
  appBaseUrl: 'https://club.test',
  webhookUrl: 'https://functions.test/accountingMercadoPagoWebhook',
};

function timestamp(value: string) {
  return Timestamp.fromDate(new Date(value));
}

function createAdminActor() {
  return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}

function setupMercadoPagoFixture() {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-1');
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.mercadoPago, {
    name: 'Mercado Pago',
    bancarizado: true,
    specialReportingType: null,
  });
  seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, {
    name: 'Cuota societaria',
    originType: 'member_fee_charge',
  });
  return manager;
}

function seedPendingMemberFeeCharge(
  manager: InMemoryAccountingTransactionManager,
  memberFeeChargeId: string,
  overrides?: {
    period?: string;
    finalAmountMinor?: number;
    status?: 'pending' | 'paid' | 'overdue' | 'exempt' | 'cancelled';
  },
) {
  const now = timestamp('2026-05-01T00:00:00.000Z');
  manager.memberFeeCharges.set(memberFeeChargeId, {
    id: memberFeeChargeId,
    memberId: 'member-1',
    familyGroupId: null,
    holderMemberId: null,
    period: overrides?.period ?? '2026-05',
    configVersion: 1,
    memberTypeCodeSnapshot: 'pleno',
    billingMode: 'per_member',
    baseAmountMinor: overrides?.finalAmountMinor ?? 11_000_000,
    appliedPctBps: 10_000,
    finalAmountMinor: overrides?.finalAmountMinor ?? 11_000_000,
    status: overrides?.status ?? 'pending',
    dueDate: timestamp('2026-05-10T00:00:00.000Z'),
    generatedByUid: 'admin-1',
    createdAt: now,
    createdBy: 'admin-1',
    updatedAt: now,
    updatedBy: 'admin-1',
  });
}

function createPreferenceClient() {
  const payloads: MercadoPagoPreferencePayload[] = [];
  const client: MercadoPagoClient = {
    async createPreference(payload) {
      payloads.push(payload);
      return {
        preferenceId: `pref-${payloads.length}`,
        checkoutUrl: `https://mp.test/checkout/${payloads.length}`,
        rawResponse: { id: `pref-${payloads.length}` },
      };
    },
    async getPayment() {
      throw new Error('getPayment no se usa en estas pruebas.');
    },
  };
  return { client, payloads };
}

function createApprovedPayment(sessionId: string, overrides?: Partial<MercadoPagoPaymentSnapshot>): MercadoPagoPaymentSnapshot {
  return {
    paymentId: 'mp-payment-1',
    status: 'approved',
    statusDetail: 'accredited',
    externalReference: sessionId,
    merchantOrderId: 'merchant-order-1',
    transactionAmountMinor: 18_000_000,
    netAmountMinor: 17_460_000,
    feeAmountMinor: 540_000,
    moneyReleaseDate: '2026-05-22T03:00:00.000Z',
    paymentTypeId: 'credit_card',
    providerPaymentMethodId: 'visa',
    dateApproved: '2026-05-20T15:05:00.000Z',
    ...overrides,
  };
}

test('Mercado Pago checkout multiple suma importes y serializa items de la preferencia', async () => {
  const manager = setupMercadoPagoFixture();
  seedPendingMemberFeeCharge(manager, 'fee-2026-05', { period: '2026-05', finalAmountMinor: 11_000_000 });
  seedPendingMemberFeeCharge(manager, 'fee-2026-06', { period: '2026-06', finalAmountMinor: 7_000_000 });
  const mercadoPago = createPreferenceClient();

  const result = await createMercadoPagoCheckoutUseCase({
    actor: createAdminActor(),
    input: {
      items: [
        { sourceType: 'member_fee_charge', sourceId: 'fee-2026-05' },
        { sourceType: 'member_fee_charge', sourceId: 'fee-2026-06' },
      ],
    },
    transactions: manager,
    clock: fixedClock,
    mercadoPagoClient: mercadoPago.client,
    runtimeConfig: mercadoPagoRuntimeConfig,
  });

  const session = manager.mercadoPagoCheckoutSessions.get(result.sessionId);
  assert.ok(session);
  assert.equal(result.status, 'ready');
  assert.equal(session?.grossAmountMinor, 18_000_000);
  assert.equal(session?.items.length, 2);
  assert.deepEqual(session?.memberIds, ['member-1']);
  assert.equal(mercadoPago.payloads.length, 1);
  assert.equal(mercadoPago.payloads[0]?.items.length, 2);
  assert.equal(mercadoPago.payloads[0]?.items[0]?.unit_price, 110_000);
  assert.equal(mercadoPago.payloads[0]?.items[1]?.unit_price, 70_000);
  assert.equal(mercadoPago.payloads[0]?.external_reference, result.sessionId);

  const reused = await createMercadoPagoCheckoutUseCase({
    actor: createAdminActor(),
    input: {
      items: [
        { sourceType: 'member_fee_charge', sourceId: 'fee-2026-06' },
        { sourceType: 'member_fee_charge', sourceId: 'fee-2026-05' },
      ],
    },
    transactions: manager,
    clock: fixedClock,
    mercadoPagoClient: mercadoPago.client,
    runtimeConfig: mercadoPagoRuntimeConfig,
  });

  assert.equal(reused.sessionId, result.sessionId);
  assert.equal(reused.reused, true);
  assert.equal(mercadoPago.payloads.length, 1);
});

test('Mercado Pago no permite incluir cargos ya pagados', async () => {
  const manager = setupMercadoPagoFixture();
  seedPendingMemberFeeCharge(manager, 'fee-paid', { status: 'paid' });
  const mercadoPago = createPreferenceClient();

  await assert.rejects(
    () =>
      createMercadoPagoCheckoutUseCase({
        actor: createAdminActor(),
        input: {
          items: [{ sourceType: 'member_fee_charge', sourceId: 'fee-paid' }],
        },
        transactions: manager,
        clock: fixedClock,
        mercadoPagoClient: mercadoPago.client,
        runtimeConfig: mercadoPagoRuntimeConfig,
      }),
    /Solo se pueden pagar cuotas pendientes o vencidas/i,
  );
});

test('Mercado Pago aprobado crea movimientos por item y el reintento no duplica', async () => {
  const manager = setupMercadoPagoFixture();
  seedPendingMemberFeeCharge(manager, 'fee-2026-05', { period: '2026-05', finalAmountMinor: 11_000_000 });
  seedPendingMemberFeeCharge(manager, 'fee-2026-06', { period: '2026-06', finalAmountMinor: 7_000_000 });
  const mercadoPago = createPreferenceClient();

  const checkout = await createMercadoPagoCheckoutUseCase({
    actor: createAdminActor(),
    input: {
      items: [
        { sourceType: 'member_fee_charge', sourceId: 'fee-2026-05' },
        { sourceType: 'member_fee_charge', sourceId: 'fee-2026-06' },
      ],
    },
    transactions: manager,
    clock: fixedClock,
    mercadoPagoClient: mercadoPago.client,
    runtimeConfig: mercadoPagoRuntimeConfig,
  });

  const processed = await processMercadoPagoPaymentUseCase({
    payment: createApprovedPayment(checkout.sessionId),
    transactions: manager,
    clock: fixedClock,
  });

  assert.equal(processed.status, 'approved');
  assert.equal(processed.movementIds.length, 2);
  assert.equal(processed.receipts.length, 2);
  assert.equal(manager.financialMovements.size, 2);
  assert.equal(manager.memberFeeCharges.get('fee-2026-05')?.status, 'paid');
  assert.equal(manager.memberFeeCharges.get('fee-2026-06')?.status, 'paid');

  const firstMovement = Array.from(manager.financialMovements.values()).find((movement) => movement.originId === 'fee-2026-05');
  const secondMovement = Array.from(manager.financialMovements.values()).find((movement) => movement.originId === 'fee-2026-06');
  assert.ok(firstMovement);
  assert.ok(secondMovement);
  assert.equal(firstMovement?.paymentMethodCodeSnapshot, PAYMENT_METHOD_IDS.mercadoPago);
  assert.equal(secondMovement?.paymentMethodCodeSnapshot, PAYMENT_METHOD_IDS.mercadoPago);
  assert.equal(firstMovement?.grossAmountMinor, 11_000_000);
  assert.equal(firstMovement?.appliedCommissionAmountMinor, 330_000);
  assert.equal(firstMovement?.netAmountMinor, 10_670_000);
  assert.equal(secondMovement?.grossAmountMinor, 7_000_000);
  assert.equal(secondMovement?.appliedCommissionAmountMinor, 210_000);
  assert.equal(secondMovement?.netAmountMinor, 6_790_000);
  assert.equal((firstMovement?.metadata?.provider as { paymentId?: string } | undefined)?.paymentId, 'mp-payment-1');
  assert.match(String(firstMovement?.metadata?.receiptNumber ?? ''), /^REC-20260520-/);
  assert.equal(processed.receipts[0]?.receiptNumber, firstMovement?.metadata?.receiptNumber);
  assert.equal(manager.mercadoPagoCheckoutSessions.get(checkout.sessionId)?.financialMovementIds.length, 2);

  const retried = await processMercadoPagoPaymentUseCase({
    payment: createApprovedPayment(checkout.sessionId),
    transactions: manager,
    clock: fixedClock,
  });

  assert.equal(retried.movementIds.length, 2);
  assert.equal(retried.receipts.length, 0);
  assert.equal(manager.financialMovements.size, 2);
});

test('Mercado Pago pendiente actualiza sesiÃ³n sin crear movimientos', async () => {
  const manager = setupMercadoPagoFixture();
  seedPendingMemberFeeCharge(manager, 'fee-2026-05');
  const mercadoPago = createPreferenceClient();
  const checkout = await createMercadoPagoCheckoutUseCase({
    actor: createAdminActor(),
    input: {
      items: [{ sourceType: 'member_fee_charge', sourceId: 'fee-2026-05' }],
    },
    transactions: manager,
    clock: fixedClock,
    mercadoPagoClient: mercadoPago.client,
    runtimeConfig: mercadoPagoRuntimeConfig,
  });

  const processed = await processMercadoPagoPaymentUseCase({
    payment: createApprovedPayment(checkout.sessionId, {
      paymentId: 'mp-payment-pending',
      status: 'pending',
      statusDetail: 'pending_waiting_payment',
      netAmountMinor: null,
      feeAmountMinor: null,
      dateApproved: null,
    }),
    transactions: manager,
    clock: fixedClock,
  });

  assert.equal(processed.status, 'pending');
  assert.equal(processed.movementIds.length, 0);
  assert.equal(manager.financialMovements.size, 0);
  assert.equal(manager.memberFeeCharges.get('fee-2026-05')?.status, 'pending');
  assert.equal(manager.mercadoPagoCheckoutSessions.get(checkout.sessionId)?.providerStatus, 'pending');
});
