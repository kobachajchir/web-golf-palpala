import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS, } from '../../src/modules/accounting/domain/constants.js';
import { prepareMemberFeeStatus } from '../../src/modules/accounting/application/member-fee-status.js';
import { movementCountsTowardBalance, toClubAccountingPeriod } from '../../src/modules/accounting/application/shared.js';
import { createInstallmentPlanUseCase, registerInstallmentPaymentUseCase, } from '../../src/modules/accounting/application/use-cases/installment.use-cases.js';
import { previewMemberFeePaymentUseCase, registerMemberFeeBatchPaymentUseCase, } from '../../src/modules/accounting/application/use-cases/member-fee-payment.use-cases.js';
import { InMemoryAccountingTransactionManager, createAccountingActor, seedAccountingMember, seedActiveFinancialConfig, seedIncomeCategory, seedPaymentMethod, } from '../helpers/accounting-fakes.js';
const admin = () => createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
function seedCharge(manager, id, overrides) {
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
    manager.members.set('member-1', { ...manager.members.get('member-1'), familyGroupId: 'family-1' });
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
    await assert.rejects(registerMemberFeeBatchPaymentUseCase({
        actor: admin(),
        input: { allocations: [{ chargeId: 'fee-1' }], paymentMethodId: PAYMENT_METHOD_IDS.cash, operationDate: new Date('2026-06-16T15:00:00.000Z') },
        transactions: manager,
    }), /plan de pagos parciales activo/);
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
    manager.memberFeeCharges.set('fee-1', { ...manager.memberFeeCharges.get('fee-1'), status: 'paid' });
    await assert.rejects(registerInstallmentPaymentUseCase({
        actor: admin(),
        input: { installmentPlanId: plan.installmentPlanId, paymentMethodId: PAYMENT_METHOD_IDS.cash, operationDate: new Date('2026-06-16T15:00:00.000Z'), amountMinor: 1_000_000 },
        transactions: manager,
    }), /ya fue cobrada por otra via/);
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
    const line = preview.lines[0];
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
//# sourceMappingURL=accounting.member-fee-safeguards.use-case.test.js.map