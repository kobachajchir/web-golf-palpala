import assert from 'node:assert/strict';
import test from 'node:test';
import type { EntityWithId, FinancialConfigDocument } from '../../../modules/accounting/domain/models';
import type { EntityWithId as UserEntityWithId, MemberDocument } from '../../../modules/users/domain/models';

const { estimateMemberFeeDetails } = await import(
  new URL('../utils/memberFeeEstimates.ts', import.meta.url).href
) as typeof import('../utils/memberFeeEstimates');

const timestamp = { toDate: () => new Date('2026-07-10T00:00:00.000Z') } as never;

function buildConfig(): EntityWithId<FinancialConfigDocument> {
  return {
    id: 'config-1',
    version: 1,
    isActive: true,
    effectiveFrom: timestamp,
    currency: 'ARS',
    fullMemberFeeMinor: 100_000,
    familyAssociatePctBps: 5_000,
    lifetimePctBps: 5_000,
    minorPctBps: 3_000,
    licensePctBps: 0,
    creditCommissionPctBps: 0,
    allowStandaloneMinor: false,
    maxLicenseMonths: 6,
    familyGroupBillingMode: 'per_member',
    membershipChargePersistenceMode: 'member_fee_charges',
    greenFeeAppliesToMembers: false,
    cantineroContractMode: 'fixed_monthly',
    advertisingDefaultPeriodicity: 'monthly',
    requireApprovalForExpensePosting: false,
    requireApprovalForOvertimePosting: false,
    createdAt: timestamp,
    createdBy: 'test',
    updatedAt: timestamp,
    updatedBy: 'test',
  };
}

function buildMember(typeCodeSnapshot: string): UserEntityWithId<MemberDocument> {
  return {
    id: `member-${typeCodeSnapshot}`,
    memberNumber: '1',
    firstName: 'Test',
    lastName: 'Socio',
    dni: '123',
    status: 'active',
    typeId: typeCodeSnapshot,
    typeCodeSnapshot,
    isFamilyHolder: typeCodeSnapshot.includes('titular'),
    joinedAt: timestamp,
    createdAt: timestamp,
    createdBy: 'test',
    updatedAt: timestamp,
    updatedBy: 'test',
  };
}

test('estimateMemberFeeDetails cobra 100% al titular familiar', () => {
  const result = estimateMemberFeeDetails(buildMember('grupo_familiar_titular'), buildConfig());

  assert.equal(result.appliedPctBps, 10_000);
  assert.equal(result.finalAmountMinor, 100_000);
  assert.equal(result.typeDiscountAmountMinor, 0);
});

test('estimateMemberFeeDetails aplica descuento de adjunto solo al asociado familiar', () => {
  const result = estimateMemberFeeDetails(buildMember('grupo_familiar_asociado'), buildConfig());

  assert.equal(result.appliedPctBps, 5_000);
  assert.equal(result.finalAmountMinor, 50_000);
  assert.equal(result.typeDiscountAmountMinor, 50_000);
});
