import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { markMembershipRenewalsUseCase, syncMembershipRenewalsDailyUseCase } from '../../src/modules/accounting/application/use-cases/membership-renewal.use-cases.js';
import { InMemoryAccountingTransactionManager, seedActiveFinancialConfig, seedAccountingMember, } from '../helpers/accounting-fakes.js';
test('emite cuotas mensuales pendientes para socios activos el primer dia del mes', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-active');
    seedAccountingMember(manager, 'member-inactive', { status: 'inactive' });
    const result = await markMembershipRenewalsUseCase({
        transactions: manager,
        now: new Date('2026-05-01T06:00:00.000Z'),
    });
    assert.equal(result.period, '2026-05');
    assert.equal(result.activeMemberCount, 1);
    assert.equal(result.generatedCount, 1);
    assert.equal(result.duplicateCount, 0);
    assert.equal(result.markedCount, 1);
    assert.equal(result.skippedCount, 0);
    const charges = Array.from(manager.memberFeeCharges.values());
    assert.equal(charges.length, 1);
    const charge = charges[0];
    assert.ok(charge);
    assert.equal(charge.memberId, 'member-active');
    assert.equal(charge.period, '2026-05');
    assert.equal(charge.status, 'pending');
    assert.equal(charge.dueDate?.toDate().toISOString(), '2026-05-01T03:00:00.000Z');
    const member = manager.members.get('member-active');
    assert.equal(member?.membershipRenewalStatus, 'needs_renewal');
    assert.equal(member?.membershipRenewalDueAt?.toDate().toISOString(), '2026-05-01T03:00:00.000Z');
});
test('la emision mensual es idempotente y no duplica cuotas del mismo periodo', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-active');
    await markMembershipRenewalsUseCase({
        transactions: manager,
        now: new Date('2026-05-01T06:00:00.000Z'),
    });
    const secondRun = await markMembershipRenewalsUseCase({
        transactions: manager,
        now: new Date('2026-05-01T09:00:00.000Z'),
    });
    assert.equal(manager.memberFeeCharges.size, 1);
    assert.equal(secondRun.generatedCount, 0);
    assert.equal(secondRun.duplicateCount, 1);
    assert.equal(secondRun.markedCount, 0);
    assert.equal(secondRun.skippedCount, 0);
});
test('incluye socios en licencia cuando la configuracion les asigna cuota', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager, 'financial-config-active', { licensePctBps: 5_000 });
    seedAccountingMember(manager, 'member-license', {
        status: 'license',
        typeId: 'licencia',
        typeCodeSnapshot: 'licencia',
        licenseStartAt: Timestamp.fromDate(new Date('2026-02-01T03:00:00.000Z')),
        licenseEndAt: Timestamp.fromDate(new Date('2026-06-01T03:00:00.000Z')),
    });
    const result = await markMembershipRenewalsUseCase({
        transactions: manager,
        now: new Date('2026-05-01T06:00:00.000Z'),
    });
    assert.equal(result.activeMemberCount, 1);
    assert.equal(result.generatedCount, 1);
    const charge = Array.from(manager.memberFeeCharges.values())[0];
    assert.equal(charge?.memberId, 'member-license');
    assert.equal(charge?.finalAmountMinor, 5_500_000);
    assert.equal(charge?.status, 'pending');
});
test('no vuelve a marcar una renovacion que ya fue pagada antes del primer dia', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    const mayStart = Timestamp.fromDate(new Date('2026-05-01T03:00:00.000Z'));
    const paidAt = Timestamp.fromDate(new Date('2026-04-28T15:00:00.000Z'));
    seedAccountingMember(manager, 'member-prepaid', {
        membershipRenewalStatus: 'needs_renewal',
        membershipRenewalDueAt: mayStart,
    });
    manager.memberFeeCharges.set('fee-prepaid', {
        id: 'fee-prepaid',
        memberId: 'member-prepaid',
        familyGroupId: null,
        holderMemberId: null,
        period: '2026-05',
        configVersion: 1,
        memberTypeCodeSnapshot: 'pleno',
        billingMode: 'per_member',
        baseAmountMinor: 11_000_000,
        appliedPctBps: 10_000,
        finalAmountMinor: 11_000_000,
        status: 'paid',
        dueDate: mayStart,
        generatedByUid: 'admin-1',
        paidMovementId: 'movement-prepaid',
        paymentMovementIds: ['movement-prepaid'],
        paidAt,
        paidAmountMinor: 11_000_000,
        settlementAmountMinor: 11_000_000,
        paidClubAmountMinor: 11_000_000,
        remainingAmountMinor: 0,
        paymentDiscountPctBps: 0,
        paymentDiscountAmountMinor: 0,
        paymentDiscountMode: 'none',
        createdAt: paidAt,
        createdBy: 'admin-1',
        updatedAt: paidAt,
        updatedBy: 'admin-1',
    });
    const result = await markMembershipRenewalsUseCase({
        transactions: manager,
        now: new Date('2026-05-01T06:00:00.000Z'),
    });
    assert.equal(result.generatedCount, 0);
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.markedCount, 0);
    assert.equal(manager.members.get('member-prepaid')?.membershipRenewalStatus, 'current');
    assert.equal(manager.members.get('member-prepaid')?.membershipRenewalDueAt?.toDate().toISOString(), '2026-06-01T03:00:00.000Z');
});
test('la sincronizacion diaria repone una cuota faltante sin pago y no la duplica al repetir', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-without-charge', {
        firstName: 'Maria',
        lastName: 'Perez',
        memberNumber: '321',
    });
    const firstRun = await syncMembershipRenewalsDailyUseCase({
        transactions: manager,
        now: new Date('2026-07-29T06:00:00.000Z'),
    });
    const charge = Array.from(manager.memberFeeCharges.values())[0];
    assert.equal(firstRun.issuance.generatedCount, 1);
    assert.equal(firstRun.paymentReconciliation.repairedChargeCount, 0);
    assert.equal(charge?.memberId, 'member-without-charge');
    assert.equal(charge?.period, '2026-07');
    assert.equal(charge?.status, 'pending');
    assert.equal(manager.members.get('member-without-charge')?.membershipRenewalStatus, 'needs_renewal');
    const secondRun = await syncMembershipRenewalsDailyUseCase({
        transactions: manager,
        now: new Date('2026-07-29T09:00:00.000Z'),
    });
    assert.equal(secondRun.issuance.generatedCount, 0);
    assert.equal(secondRun.issuance.duplicateCount, 1);
    assert.equal(manager.memberFeeCharges.size, 1);
});
//# sourceMappingURL=accounting.membership-renewal.use-case.test.js.map