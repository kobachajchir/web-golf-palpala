import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS, } from '../../src/modules/accounting/domain/constants.js';
import { registerMemberFeeBatchPaymentUseCase } from '../../src/modules/accounting/application/use-cases/member-fee-payment.use-cases.js';
import { markMembershipRenewalsUseCase } from '../../src/modules/accounting/application/use-cases/membership-renewal.use-cases.js';
import { InMemoryAccountingTransactionManager, createAccountingActor, seedActiveFinancialConfig, seedAccountingMember, seedIncomeCategory, seedPaymentMethod, } from '../helpers/accounting-fakes.js';
function seedPendingCharge(manager, id, period) {
    const now = Timestamp.fromDate(new Date('2026-05-01T00:00:00.000Z'));
    manager.memberFeeCharges.set(id, {
        id,
        memberId: 'member-1',
        familyGroupId: null,
        holderMemberId: null,
        period,
        configVersion: 1,
        memberTypeCodeSnapshot: 'pleno',
        billingMode: 'per_member',
        baseAmountMinor: 11_000_000,
        appliedPctBps: 10_000,
        finalAmountMinor: 11_000_000,
        status: period === '2026-05' ? 'overdue' : 'pending',
        dueDate: Timestamp.fromDate(new Date(`${period}-10T00:00:00.000Z`)),
        generatedByUid: 'admin-1',
        createdAt: now,
        createdBy: 'admin-1',
        updatedAt: now,
        updatedBy: 'admin-1',
    });
}
test('un lote descuenta solo la cuota del mes y crea un unico movimiento por lo cobrado', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-1');
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });
    seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, {
        originType: 'member_fee_charge',
    });
    seedPendingCharge(manager, 'fee-overdue', '2026-05');
    seedPendingCharge(manager, 'fee-current', '2026-06');
    const result = await registerMemberFeeBatchPaymentUseCase({
        actor: createAccountingActor('admin-1', ['administrativo'], { administrativo: true }),
        input: {
            allocations: [
                { chargeId: 'fee-overdue', applyEarlyPaymentDiscount: true },
                { chargeId: 'fee-current', applyEarlyPaymentDiscount: true },
            ],
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            operationDate: new Date('2026-06-20T12:00:00.000Z'),
        },
        transactions: manager,
    });
    assert.equal(result.netAmountMinor, 20_900_000);
    assert.equal(result.grossAmountMinor, 20_900_000);
    assert.equal(manager.memberFeeCharges.get('fee-overdue')?.paymentDiscountAmountMinor, 0);
    assert.equal(manager.memberFeeCharges.get('fee-overdue')?.paidClubAmountMinor, 11_000_000);
    assert.equal(manager.memberFeeCharges.get('fee-current')?.paymentDiscountAmountMinor, 1_100_000);
    assert.equal(manager.memberFeeCharges.get('fee-current')?.paidClubAmountMinor, 9_900_000);
    assert.equal(manager.financialMovements.size, 1);
});
test('una cuota futura pagada antes de comenzar renueva desde el periodo cobrado', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-1');
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });
    seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, { originType: 'member_fee_charge' });
    seedPendingCharge(manager, 'fee-august', '2026-08');
    const result = await registerMemberFeeBatchPaymentUseCase({
        actor: createAccountingActor('admin-1', ['administrativo'], { administrativo: true }),
        input: {
            allocations: [{ chargeId: 'fee-august', amountMinor: 7_000_000, settlementAmountMinor: 7_000_000 }],
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            operationDate: new Date('2026-07-28T15:00:00.000Z'),
        },
        transactions: manager,
    });
    assert.equal(result.grossAmountMinor, 7_000_000);
    assert.deepEqual(result.completedChargeIds, ['fee-august']);
    assert.equal(manager.memberFeeCharges.get('fee-august')?.settlementAmountMinor, 7_000_000);
    assert.equal(manager.memberFeeCharges.get('fee-august')?.status, 'paid');
    assert.equal(manager.members.get('member-1')?.membershipRenewalStatus, 'current');
    assert.equal(manager.members.get('member-1')?.membershipRenewalDueAt?.toDate().toISOString(), '2026-09-01T03:00:00.000Z');
});
test('el cobro adelantado crea una unica cuota futura y la emision posterior no la duplica', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-1');
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });
    seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, { originType: 'member_fee_charge' });
    const result = await registerMemberFeeBatchPaymentUseCase({
        actor: createAccountingActor('admin-1', ['administrativo'], { administrativo: true }),
        input: {
            allocations: [{
                    memberId: 'member-1',
                    period: '2026-08',
                    amountMinor: 7_000_000,
                    settlementAmountMinor: 7_000_000,
                }],
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            operationDate: new Date('2026-07-28T15:00:00.000Z'),
        },
        transactions: manager,
    });
    assert.equal(manager.memberFeeCharges.size, 1);
    const createdCharge = manager.memberFeeCharges.get(result.completedChargeIds[0]);
    assert.equal(createdCharge?.memberId, 'member-1');
    assert.equal(createdCharge?.period, '2026-08');
    assert.equal(createdCharge?.status, 'paid');
    assert.equal(createdCharge?.settlementAmountMinor, 7_000_000);
    const issuance = await markMembershipRenewalsUseCase({
        transactions: manager,
        now: new Date('2026-08-01T06:00:00.000Z'),
    });
    assert.equal(issuance.generatedCount, 0);
    assert.equal(issuance.duplicateCount, 1);
    assert.equal(manager.memberFeeCharges.size, 1);
    assert.equal(manager.members.get('member-1')?.membershipRenewalStatus, 'current');
    assert.equal(manager.members.get('member-1')?.membershipRenewalDueAt?.toDate().toISOString(), '2026-09-01T03:00:00.000Z');
});
//# sourceMappingURL=accounting.member-fee-batch-payment.use-case.test.js.map