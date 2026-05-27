import assert from 'node:assert/strict';
import test from 'node:test';
import { markMembershipRenewalsUseCase } from '../../src/modules/accounting/application/use-cases/membership-renewal.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  seedActiveFinancialConfig,
  seedAccountingMember,
} from '../helpers/accounting-fakes.js';

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
