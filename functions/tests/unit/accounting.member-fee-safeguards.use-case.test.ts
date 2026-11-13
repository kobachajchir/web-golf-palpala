import { recoverMemberFeePlanUseCase } from '../../src/modules/accounting/application/use-cases/member-fee-recovery.use-cases.js';
import { voidFinancialMovementUseCase } from '../../src/modules/accounting/application/use-cases/movement.use-cases.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import {
  FINANCIAL_INCOME_CATEGORY_IDS,
  PAYMENT_METHOD_IDS,
} from '../../src/modules/accounting/domain/constants.js';
import type { MemberFeeChargeDocument } from '../../src/modules/accounting/domain/models.js';
import { prepareMemberFeeStatus } from '../../src/modules/accounting/application/member-fee-status.js';
import { movementCountsTowardBalance, toClubAccountingPeriod } from '../../src/modules/accounting/application/shared.js';
import {
  createInstallmentPlanUseCase,
  listMyReceiptsUseCase,
  registerInstallmentPaymentUseCase,
} from '../../src/modules/accounting/application/use-cases/installment.use-cases.js';
import {
  previewMemberFeePaymentUseCase,
  registerMemberFeeBatchPaymentUseCase,
} from '../../src/modules/accounting/application/use-cases/member-fee-payment.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedAccountingMember,
  seedActiveFinancialConfig,
  seedIncomeCategory,
  seedPaymentMethod,
} from '../helpers/accounting-fakes.js';

const admin = () => createAccountingActor('admin-1', ['administrativo'], { administrativo: true });

function seedCharge(
  manager: InMemoryAccountingTransactionManager,
  id: string,
  overrides: Partial<MemberFeeChargeDocument> & { period: MemberFeeChargeDocument['period'] },
) {
  const now = Timestamp.fromDate(new Date('2026-05-01T00:00:00.000Z'));
  manager.memberFeeCharges.set(id, {
    id,
    memberId: 'member-1',
    familyGroupId: null,
    holderMemberId: null,
    configVersion: 1,
    memberTypeCodeSnapshot: 'pleno',
    billingMode: 'per_member',
    baseAmountMinor: 10_000_000,
    appliedPctBps: 10_000,
    finalAmountMinor: 10_000_000,
    status: 'pending',
    dueDate: null,
    generatedByUid: 'admin-1',
    createdAt: now,
    createdBy: 'admin-1',
    updatedAt: now,
    updatedBy: 'admin-1',
    ...overrides,
  });
}

function setup() {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-1');
  seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });
  seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, { originType: 'member_fee_charge' });
  return manager;
}

test('estado familiar: deduplica cuotas del grupo e ignora cargos individuales de otros integrantes', async () => {
  const manager = setup();
  const current = toClubAccountingPeriod(new Date());
  manager.members.set('member-1', { ...manager.members.get('member-1')!, familyGroupId: 'family-1' });
  // La cuota grupal aparece tanto por memberId (titular) como por familyGroupId.
  seedCharge(manager, 'group-charge', { period: current, familyGroupId: 'family-1', holderMemberId: 'member-1', billingMode: 'single_group_charge' });
  // Cargo individual impago de otro integrante: no debe afectar al socio.
  seedCharge(manager, 'other-member-charge', { period: current, memberId: 'member-2', familyGroupId: 'family-1' });

  const status = await prepareMemberFeeStatus(manager.getDataAccess(), 'member-1', [{ id: 'group-charge', period: current, status: 'paid' }]);
  assert.equal(status.membershipRenewalStatus, 'current');
});

test('una cuota reservada por un plan parcial activo no se puede cobrar desde Renovaciones', async () => {
  const manager = setup();
  seedCharge(manager, 'fee-1', { period: '2026-06' });

  const plan = await createInstallmentPlanUseCase({
    actor: admin(),
    input: {
      movementType: 'income',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
      baseAmountMinor: 10_000_000,
      interestPctBps: 0,
      operationDate: new Date('2026-06-15T15:00:00.000Z'),
      thirdPartyType: 'member',
      thirdPartyId: 'member-1',
      metadata: {
        memberFeeMemberId: 'member-1',
        memberFeeRenewalAllocations: [{ chargeId: 'fee-1', period: '2026-06', settlementAmountMinor: 10_000_000, discountPctBps: 0, discountAmountMinor: 0, discountMode: 'none' }],
      },
    },
    transactions: manager,
  });
  assert.equal(manager.memberFeeCharges.get('fee-1')?.activePartialPlanId, plan.installmentPlanId);

  await assert.rejects(
    registerMemberFeeBatchPaymentUseCase({
      actor: admin(),
      input: { allocations: [{ chargeId: 'fee-1' }], paymentMethodId: PAYMENT_METHOD_IDS.cash, operationDate: new Date('2026-06-16T15:00:00.000Z') },
      transactions: manager,
    }),
    /plan de pagos parciales activo/,
  );

  const preview = await previewMemberFeePaymentUseCase({
    actor: admin(),
    input: { memberId: 'member-1', periods: ['2026-06'], operationDate: new Date('2026-06-16T15:00:00.000Z') },
    transactions: manager,
  });
  assert.equal(preview.lines[0]?.activePartialPlanId, plan.installmentPlanId);

  // Al completar el plan la cuota queda pagada y liberada.
  await registerInstallmentPaymentUseCase({
    actor: admin(),
    input: { installmentPlanId: plan.installmentPlanId, paymentMethodId: PAYMENT_METHOD_IDS.cash, operationDate: new Date('2026-06-16T15:00:00.000Z'), amountMinor: 10_000_000 },
    transactions: manager,
  });
  assert.equal(manager.memberFeeCharges.get('fee-1')?.status, 'paid');
  assert.equal(manager.memberFeeCharges.get('fee-1')?.activePartialPlanId ?? null, null);
});

test('un plan parcial rechaza abonos si su cuota ya fue cobrada por otra via', async () => {
  const manager = setup();
  seedCharge(manager, 'fee-1', { period: '2026-06' });
  const plan = await createInstallmentPlanUseCase({
    actor: admin(),
    input: {
      movementType: 'income',
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
      baseAmountMinor: 10_000_000,
      interestPctBps: 0,
      operationDate: new Date('2026-06-15T15:00:00.000Z'),
      thirdPartyType: 'member',
      thirdPartyId: 'member-1',
      metadata: {
        memberFeeMemberId: 'member-1',
        memberFeeRenewalAllocations: [{ chargeId: 'fee-1', period: '2026-06', settlementAmountMinor: 10_000_000, discountPctBps: 0, discountAmountMinor: 0, discountMode: 'none' }],
      },
    },
    transactions: manager,
  });
  // Simula un cobro historico por otra via (datos previos al bloqueo).
  manager.memberFeeCharges.set('fee-1', { ...manager.memberFeeCharges.get('fee-1')!, status: 'paid' });

  await assert.rejects(
    registerInstallmentPaymentUseCase({
      actor: admin(),
      input: { installmentPlanId: plan.installmentPlanId, paymentMethodId: PAYMENT_METHOD_IDS.cash, operationDate: new Date('2026-06-16T15:00:00.000Z'), amountMinor: 1_000_000 },
      transactions: manager,
    }),
    /ya fue cobrada por otra via/,
  );
});

test('vista previa y cobro coinciden para un mes futuro ya emitido', async () => {
  const manager = setup();
  seedCharge(manager, 'fee-future', { period: '2026-09' });
  const operationDate = new Date('2026-06-20T15:00:00.000Z');
  const preview = await previewMemberFeePaymentUseCase({
    actor: admin(),
    input: { memberId: 'member-1', periods: ['2026-09'], operationDate, applyEarlyPaymentDiscount: false },
    transactions: manager,
  });
  const line = preview.lines[0]!;
  assert.ok(line.discountAmountMinor > 0, 'el mes futuro lleva descuento por adelanto');

  const result = await registerMemberFeeBatchPaymentUseCase({
    actor: admin(),
    input: {
      allocations: [{ chargeId: 'fee-future', expectedAvailableMinor: line.payableAmountMinor, applyEarlyPaymentDiscount: false }],
      paymentMethodId: PAYMENT_METHOD_IDS.cash,
      operationDate,
    },
    transactions: manager,
  });
  assert.equal(result.netAmountMinor, line.payableAmountMinor);
});

test('un movimiento anulado y su reverso cuentan ambos en el balance', () => {
  assert.equal(movementCountsTowardBalance({ status: 'posted' }), true);
  assert.equal(movementCountsTowardBalance({ status: 'reversed', reversalOfMovementId: 'rev-1' }), true);
  assert.equal(movementCountsTowardBalance({ status: 'reversed', reversalOfMovementId: null }), false);
  assert.equal(movementCountsTowardBalance({ status: 'voided' }), false);
});


test('anular un abono conserva el otro pago y reabre solo el saldo aplicado', async () => {
  const manager = setup();
  seedCharge(manager, 'fee-reversal', { period: '2026-11', status: 'paid', finalAmountMinor: 10000, settlementAmountMinor: 10000, paidClubAmountMinor: 10000, paidAmountMinor: 10000, remainingAmountMinor: 0, paymentMovementIds: ['payment-40', 'payment-60'] });
  manager.financialMovements.set('payment-40', {
    id: 'payment-40', status: 'posted', movementType: 'income', categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, categoryCodeSnapshot: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
    grossAmountMinor: 4000, netAmountMinor: 4000, operationDate: Timestamp.fromDate(new Date()), accountingPeriod: '2026-11', originCollection: 'member_fee_charges', originId: 'fee-reversal',
    metadata: { paymentAllocations: [{ chargeId: 'fee-reversal', appliedClubAmountMinor: 4000 }] },
  } as any);
  await voidFinancialMovementUseCase({ actor: admin(), input: { movementId: 'payment-40', reason: 'Correccion de comprobante duplicado' }, transactions: manager });
  const charge = manager.memberFeeCharges.get('fee-reversal');
  assert.equal(charge?.paidClubAmountMinor, 6000);
  assert.equal(charge?.remainingAmountMinor, 4000);
  assert.equal(charge?.status, 'pending');
  assert.deepEqual(charge?.paymentMovementIds, ['payment-60']);
});


test('cargos distintos del mismo mes no se ocultan por una cuota pagada', async () => {
  const manager = setup();
  const period = toClubAccountingPeriod(new Date());
  seedCharge(manager, 'fee-paid', { period, status: 'paid' });
  seedCharge(manager, 'fee-still-open', { period });
  const status = await prepareMemberFeeStatus(manager.dataAccess, 'member-1', []);
  assert.equal(status.membershipRenewalStatus, 'needs_renewal');
  assert.equal(toClubAccountingPeriod(status.membershipRenewalDueAt.toDate()), period);
});

test('reintentar una cuota con la misma clave devuelve un comprobante y no otro ingreso', async () => {
  const manager = setup();
  seedCharge(manager, 'fee-retry', { period: '2026-06' });
  const input = { allocations: [{ chargeId: 'fee-retry', amountMinor: 4_000_000, expectedAvailableMinor: 10_000_000 }], paymentMethodId: PAYMENT_METHOD_IDS.cash, operationDate: new Date('2026-06-20T15:00:00Z'), idempotencyKey: 'retry-same-key' };
  const first = await registerMemberFeeBatchPaymentUseCase({ actor: admin(), input, transactions: manager });
  const retry = await registerMemberFeeBatchPaymentUseCase({ actor: admin(), input, transactions: manager });
  assert.equal(first.movementId, retry.movementId);
  assert.equal(manager.financialMovements.size, 1);
  assert.equal(manager.memberFeeCharges.get('fee-retry')?.remainingAmountMinor, 6_000_000);
  await assert.rejects(registerMemberFeeBatchPaymentUseCase({ actor: admin(), input: { ...input, allocations: [{ chargeId: 'fee-retry', amountMinor: 5_000_000 }] }, transactions: manager }), /Ya se registro un cobro/i);
  assert.equal(manager.financialMovements.size, 1);
});

test('cotizacion vencida no registra dinero ni modifica la cuota', async () => {
  const manager = setup();
  seedCharge(manager, 'fee-stale', { period: '2026-06', paidClubAmountMinor: 4_000_000, settlementAmountMinor: 10_000_000, remainingAmountMinor: 6_000_000 });
  await assert.rejects(registerMemberFeeBatchPaymentUseCase({ actor: admin(), input: { allocations: [{ chargeId: 'fee-stale', amountMinor: 6_000_000, expectedAvailableMinor: 10_000_000 }], paymentMethodId: PAYMENT_METHOD_IDS.cash, operationDate: new Date('2026-06-20T15:00:00Z') }, transactions: manager }), /cambio/i);
  assert.equal(manager.financialMovements.size, 0);
  assert.equal(manager.memberFeeCharges.get('fee-stale')?.paidClubAmountMinor, 4_000_000);
});

test('recuperacion explicita conserva ingresos, exige revision vigente y audita el cambio', async () => {
  const manager = setup();
  seedCharge(manager, 'historical-fee', { period: '2026-06', finalAmountMinor: 10000 });
  const now = Timestamp.fromDate(new Date('2026-07-15T12:00:00Z'));
  manager.financialMovements.set('old-plan', { id: 'old-plan', movementType: 'income', categoryId: 'cuota_societaria', categoryCodeSnapshot: 'cuota_societaria', status: 'posted', installmentRole: 'charge', installmentPlanId: 'old-plan', thirdPartyType: 'member', thirdPartyId: 'member-1', installmentBaseAmountMinor: 10000, installmentTotalAmountMinor: 10000, grossAmountMinor: 10000, netAmountMinor: 10000, operationDate: now } as any);
  manager.financialMovements.set('old-receipt', { id: 'old-receipt', movementType: 'income', categoryCodeSnapshot: 'cuota_societaria', status: 'posted', installmentRole: 'payment', installmentPlanId: 'old-plan', netAmountMinor: 10000, operationDate: now, metadata: { receiptNumber: 'REC-OLD' } } as any);
  const actor = createAccountingActor('board-1', ['directivo'], { directivo: true });
  const input = { planId: 'old-plan', chargeIds: ['historical-fee'], execute: false, reason: 'Comprobante REC-OLD presentado', expectedRevision: '' };
  const preview = await recoverMemberFeePlanUseCase({ actor, input, transactions: manager });
  assert.equal(preview.changes[0]?.after.remainingAmountMinor, 0);
  assert.equal(manager.memberFeeCharges.get('historical-fee')?.status, 'pending');
  await assert.rejects(recoverMemberFeePlanUseCase({ actor, input: { ...input, execute: true }, transactions: manager }), /cambiaron/i);
  const applied = await recoverMemberFeePlanUseCase({ actor, input: { ...input, execute: true, expectedRevision: preview.revision }, transactions: manager });
  assert.equal(applied.applied, true);
  assert.equal(manager.financialMovements.size, 2);
  assert.equal(manager.financialMovements.get('old-receipt')?.netAmountMinor, 10000);
  assert.equal(manager.memberFeeCharges.get('historical-fee')?.status, 'paid');
  assert.equal(manager.operations.size, 1);
  assert.equal([...manager.operations.values()][0]?.result.actorUid, 'board-1');
  assert.deepEqual(manager.memberFeeCharges.get('historical-fee')?.paymentMovementIds, ['old-receipt']);
});


test('la cotizacion conserva cargos distintos del mismo mes, incluso con otro pagado', async () => {
  const manager = setup();
  seedCharge(manager, 'same-period-paid', { period: '2026-06', status: 'paid' });
  seedCharge(manager, 'same-period-open', { period: '2026-06' });
  const quote = await previewMemberFeePaymentUseCase({ actor: admin(), input: { memberId: 'member-1', periods: ['2026-06'], operationDate: new Date('2026-06-20T15:00:00Z') }, transactions: manager });
  assert.equal(quote.lines.length, 2);
  assert.equal(quote.lines.find((line) => line.chargeId === 'same-period-paid')?.payableAmountMinor, 0);
  assert.equal(quote.lines.find((line) => line.chargeId === 'same-period-open')?.payableAmountMinor, 10_000_000);
});

test('una cuota existente puede cotizarse aunque sea anterior al ingreso registrado', async () => {
  const manager = setup();
  seedCharge(manager, 'historical-existing', { period: '2024-08' });
  manager.members.set('member-1', { ...manager.members.get('member-1')!, joinedAt: Timestamp.fromDate(new Date('2026-11-01T00:00:00Z')) });
  const quote = await previewMemberFeePaymentUseCase({ actor: admin(), input: { memberId: 'member-1', periods: ['2024-08'], operationDate: new Date('2026-11-12T15:00:00Z') }, transactions: manager });
  assert.equal(quote.lines[0]?.chargeId, 'historical-existing');
  assert.equal(quote.totalAmountMinor, 10_000_000);
});


test('anular un abono de un plan flexible reabre la cuota y permite completar el saldo real', async () => {
  const manager = setup();
  seedCharge(manager, 'plan-fee', { period: '2026-06', finalAmountMinor: 10000 });
  const plan = await createInstallmentPlanUseCase({ actor: admin(), input: { movementType: 'income', categoryId: 'cuota_societaria', baseAmountMinor: 10000, interestPctBps: 0, operationDate: new Date('2026-06-20T15:00:00Z'), thirdPartyType: 'member', thirdPartyId: 'member-1', metadata: { memberFeeMemberId: 'member-1', memberFeeRenewalAllocations: [{ chargeId: 'plan-fee', period: '2026-06', settlementAmountMinor: 10000, discountPctBps: 0, discountAmountMinor: 0, discountMode: 'none' }] } }, transactions: manager });
  const pay = (amountMinor: number) => registerInstallmentPaymentUseCase({ actor: admin(), input: { installmentPlanId: plan.installmentPlanId, paymentMethodId: 'cash', amountMinor, operationDate: new Date('2026-06-20T15:00:00Z') }, transactions: manager });
  const first = await pay(4000);
  const second = await pay(6000);
  assert.equal(manager.memberFeeCharges.get('plan-fee')?.status, 'paid');
  await voidFinancialMovementUseCase({ actor: admin(), input: { movementId: first.movementId, reason: 'Corrección del abono inicial' }, transactions: manager });
  assert.equal(manager.financialMovements.get(plan.installmentPlanId)?.installmentPaidAmountMinor, 6000);
  assert.equal(manager.financialMovements.get(second.movementId)?.status, 'posted');
  assert.equal(manager.memberFeeCharges.get('plan-fee')?.activePartialPlanId, plan.installmentPlanId);
  assert.equal(manager.memberFeeCharges.get('plan-fee')?.status, 'pending');
  await pay(4000);
  assert.equal(manager.memberFeeCharges.get('plan-fee')?.remainingAmountMinor, 0);
  assert.equal(manager.memberFeeCharges.get('plan-fee')?.status, 'paid');
  const effective = [...manager.financialMovements.values()].filter((movement) => movement.installmentRole !== 'charge' && movementCountsTowardBalance(movement)).reduce((sum, movement) => sum + (movement.movementType === 'income' ? movement.netAmountMinor : -movement.netAmountMinor), 0);
  assert.equal(effective, 10000);
});


test('el historial personal pagina todos los recibos y excluye planes principales', async () => {
  const manager = setup();
  for (let index = 0; index < 125; index++) manager.financialMovements.set(`receipt-${index}`, { id: `receipt-${index}`, movementType: 'income', thirdPartyType: 'member', thirdPartyId: 'member-1', status: 'posted', operationDate: Timestamp.now(), accountingPeriod: '2026-11', grossAmountMinor: 10050, netAmountMinor: 10050, categoryId: 'cuota_societaria', categoryCodeSnapshot: 'cuota_societaria', metadata: { receiptNumber: `REC-${index}` } } as any);
  manager.financialMovements.set('root-with-receipt', { ...manager.financialMovements.get('receipt-0')!, id: 'root-with-receipt', installmentRole: 'charge' });
  const actor = createAccountingActor('viewer', ['socio'], { socio: true });
  actor.user.profileType = 'member';
  actor.user.profileId = 'member-1';
  const result = await listMyReceiptsUseCase({ actor, transactions: manager });
  assert.equal(result.receipts.length, 125);
  assert.equal(new Set(result.receipts.map((receipt) => receipt.id)).size, 125);
  assert.ok(!result.receipts.some((receipt) => receipt.id === 'root-with-receipt'));
});


test('una comision cambiada invalida la cotizacion antes de registrar dinero', async () => {
  const manager = setup();
  seedCharge(manager, 'fee-commission', { period: '2026-06' });
  manager.paymentCommissionRules.set('rule', { id: 'rule', paymentMethodId: 'cash', percentageBps: 1000, isActive: true, validFrom: Timestamp.now() } as any);
  const quote = await previewMemberFeePaymentUseCase({ actor: admin(), input: { memberId: 'member-1', periods: ['2026-06'], operationDate: new Date('2026-06-20T15:00:00Z'), paymentMethodId: 'cash' }, transactions: manager });
  assert.equal(quote.commissionPctBps, 1000);
  manager.paymentCommissionRules.get('rule')!.percentageBps = 2000;
  await assert.rejects(registerMemberFeeBatchPaymentUseCase({ actor: admin(), input: { allocations: [{ chargeId: 'fee-commission' }], expectedCommissionPctBps: quote.commissionPctBps, paymentMethodId: 'cash', operationDate: new Date('2026-06-20T15:00:00Z') }, transactions: manager }), /comisión cambió/);
  assert.equal(manager.financialMovements.size, 0);
});
