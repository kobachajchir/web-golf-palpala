import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { reconcileMemberFeeRenewalsUseCase } from '../../src/modules/accounting/application/use-cases/member-fee-reconciliation.use-cases.js';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../src/modules/accounting/domain/constants.js';
import { InMemoryAccountingTransactionManager, createAccountingActor, seedActiveFinancialConfig, seedAccountingMember, } from '../helpers/accounting-fakes.js';
const now = Timestamp.fromDate(new Date('2026-05-08T15:00:00.000Z'));
function seedCharge(manager, id = 'fee-1') {
    manager.memberFeeCharges.set(id, {
        id,
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
        dueDate: now,
        generatedByUid: 'system',
        createdAt: now,
        createdBy: 'system',
        updatedAt: now,
        updatedBy: 'system',
    });
}
function seedLegacyMovement(manager, id = 'movement-1') {
    manager.financialMovements.set(id, {
        id,
        movementType: 'income',
        categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
        categoryCodeSnapshot: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
        status: 'posted',
        operationDate: now,
        postingDate: now,
        accountingPeriod: '2026-05',
        originType: 'manual_income',
        originCollection: null,
        originId: null,
        thirdPartyType: 'member',
        thirdPartyId: 'member-1',
        paymentMethodId: PAYMENT_METHOD_IDS.cash,
        paymentMethodCodeSnapshot: PAYMENT_METHOD_IDS.cash,
        grossAmountMinor: 11_000_000,
        netAmountMinor: 11_000_000,
        bancarizado: false,
        imputableImpositivo: true,
        registeredByUid: 'admin-1',
        approvedByUid: 'admin-1',
        approvedAt: now,
        metadata: { clubAmountMinor: 11_000_000 },
        notes: 'Cobro de cuota societaria',
        createdAt: now,
        createdBy: 'admin-1',
        updatedAt: now,
        updatedBy: 'admin-1',
    });
}
function directivoActor() {
    return createAccountingActor('board-1', ['directivo'], { directivo: true });
}
test('la vista previa encuentra el cobro legado sin modificar contabilidad ni cuota', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-1');
    seedCharge(manager);
    seedLegacyMovement(manager);
    const result = await reconcileMemberFeeRenewalsUseCase({
        actor: directivoActor(),
        input: { period: '2026-05', execute: false },
        transactions: manager,
    });
    assert.equal(result.repairedChargeCount, 1);
    assert.equal(result.repairs[0]?.source, 'period_member');
    assert.equal(manager.memberFeeCharges.get('fee-1')?.status, 'pending');
    assert.equal(result.repairs[0]?.memberName, 'Club, Socio');
    assert.equal(result.repairs[0]?.memberNumber, 'member-1');
    assert.equal(manager.financialMovements.get('movement-1')?.status, 'posted');
});
test('la ejecucion descuenta la renovacion y conserva intacto el movimiento', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-1');
    seedCharge(manager);
    seedLegacyMovement(manager);
    const result = await reconcileMemberFeeRenewalsUseCase({
        actor: directivoActor(),
        input: { period: '2026-05', execute: true },
        transactions: manager,
    });
    assert.equal(result.repairedChargeCount, 1);
    assert.equal(manager.memberFeeCharges.get('fee-1')?.status, 'paid');
    assert.equal(manager.memberFeeCharges.get('fee-1')?.paidMovementId, 'movement-1');
    assert.deepEqual(manager.memberFeeCharges.get('fee-1')?.paymentMovementIds, ['movement-1']);
    assert.equal(manager.members.get('member-1')?.membershipRenewalStatus, 'current');
    assert.equal(manager.financialMovements.get('movement-1')?.netAmountMinor, 11_000_000);
});
test('no infiere una renovacion cuando hay mas de una cuota candidata', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-1');
    seedCharge(manager, 'fee-1');
    seedCharge(manager, 'fee-2');
    seedLegacyMovement(manager);
    const result = await reconcileMemberFeeRenewalsUseCase({
        actor: directivoActor(),
        input: { period: '2026-05', execute: true },
        transactions: manager,
    });
    assert.equal(result.repairedChargeCount, 0);
    assert.equal(result.ambiguousCount, 1);
    assert.equal(manager.memberFeeCharges.get('fee-1')?.status, 'pending');
    assert.equal(result.skipped[0]?.memberName, 'Club, Socio');
    assert.equal(result.skipped[0]?.memberNumber, 'member-1');
    assert.equal(manager.memberFeeCharges.get('fee-2')?.status, 'pending');
});
test('reconstruye una renovacion faltante solo cuando socio, periodo e importe son inequivocos', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-1');
    seedLegacyMovement(manager);
    const result = await reconcileMemberFeeRenewalsUseCase({
        actor: directivoActor(),
        input: { period: '2026-05', execute: true },
        transactions: manager,
    });
    const reconstructed = manager.memberFeeCharges.get('member-fee-charge-1');
    assert.equal(result.repairedChargeCount, 1);
    assert.equal(result.repairs[0]?.chargeId, 'member-fee-charge-1');
    assert.equal(reconstructed?.memberId, 'member-1');
    assert.equal(reconstructed?.period, '2026-05');
    assert.equal(reconstructed?.status, 'paid');
    assert.equal(reconstructed?.paidMovementId, 'movement-1');
    assert.equal(manager.financialMovements.get('movement-1')?.netAmountMinor, 11_000_000);
});
test('reconstruye como pagada una cuota con pronto pago historico dentro del dia 10', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-1');
    seedLegacyMovement(manager);
    const movement = manager.financialMovements.get('movement-1');
    assert.ok(movement);
    movement.grossAmountMinor = 9_900_000;
    movement.netAmountMinor = 9_900_000;
    movement.metadata = { clubAmountMinor: 9_900_000 };
    const result = await reconcileMemberFeeRenewalsUseCase({
        actor: directivoActor(),
        input: { period: '2026-05', execute: true },
        transactions: manager,
    });
    const reconstructed = manager.memberFeeCharges.get('member-fee-charge-1');
    assert.equal(result.repairs[0]?.completed, true);
    assert.equal(reconstructed?.status, 'paid');
    assert.equal(reconstructed?.settlementAmountMinor, 9_900_000);
    assert.equal(reconstructed?.paymentDiscountAmountMinor, 1_100_000);
    assert.equal(reconstructed?.paymentDiscountPctBps, 1_000);
});
//# sourceMappingURL=accounting.member-fee-reconciliation.use-case.test.js.map