import type { EntityWithId, FinancialConfigDocument, MemberFeeChargeDocument } from '../../../modules/accounting/domain/models';
import type { EntityWithId as UserEntityWithId, MemberDocument } from '../../../modules/users/domain/models';

function normalizeMemberType(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

export function getMemberFeeAppliedPctBps(member: UserEntityWithId<MemberDocument>, config: EntityWithId<FinancialConfigDocument>) {
  const type = normalizeMemberType(member.typeCodeSnapshot);

  if (
    type === 'PLENO'
    || type === 'GRUPO_FAMILIAR_TITULAR'
    || type === 'FAMILIAR_TITULAR'
    || type === 'FAMILY_GROUP_HOLDER'
    || type === 'FAMILY_HOLDER'
    || type.includes('TITULAR')
  ) {
    return 10000;
  }

  if (
    type === 'GRUPO_FAMILIAR_ASOCIADO'
    || type === 'FAMILIAR_ASOCIADO'
    || type === 'FAMILY_ASSOCIATE'
    || type === 'FAMILY_ASSOC'
    || type.includes('ASOCIADO')
    || type.includes('ADJUNTO')
    || type.includes('ADHERENTE')
  ) {
    return config.familyAssociatePctBps;
  }
  if (type.includes('LIFETIME') || type.includes('VITALICIO')) {
    return config.lifetimePctBps;
  }
  if (type.includes('MINOR') || type.includes('MENOR')) {
    return config.minorPctBps;
  }
  if (type.includes('LICENSE') || type.includes('LICENCIA')) {
    return config.licensePctBps;
  }
  return 10000;
}

export function estimateMemberFeeDetails(
  member: UserEntityWithId<MemberDocument>,
  config: EntityWithId<FinancialConfigDocument> | null | undefined,
) {
  if (!config) {
    return {
      baseAmountMinor: 0,
      appliedPctBps: 0,
      finalAmountMinor: 0,
      typeDiscountAmountMinor: 0,
    };
  }

  const appliedPctBps = getMemberFeeAppliedPctBps(member, config);
  const finalAmountMinor = Math.round((config.fullMemberFeeMinor * appliedPctBps) / 10000);
  return {
    baseAmountMinor: config.fullMemberFeeMinor,
    appliedPctBps,
    finalAmountMinor,
    typeDiscountAmountMinor: Math.max(config.fullMemberFeeMinor - finalAmountMinor, 0),
  };
}

export function estimateMemberFeeAmountMinor(
  member: UserEntityWithId<MemberDocument>,
  config: EntityWithId<FinancialConfigDocument> | null | undefined,
) {
  return estimateMemberFeeDetails(member, config).finalAmountMinor;
}

export function getChargeTargetMemberIds(
  charge: EntityWithId<MemberFeeChargeDocument>,
  members: Array<UserEntityWithId<MemberDocument>>,
) {
  const memberIds = new Set<string>();
  if (charge.memberId) {
    memberIds.add(charge.memberId);
  }
  if (charge.holderMemberId) {
    memberIds.add(charge.holderMemberId);
  }
  if (charge.familyGroupId) {
    members
      .filter((member) => member.familyGroupId === charge.familyGroupId)
      .forEach((member) => memberIds.add(member.id));
  }
  return memberIds;
}

export function buildChargesByMemberId(
  members: Array<UserEntityWithId<MemberDocument>>,
  charges: Array<EntityWithId<MemberFeeChargeDocument>>,
) {
  const map = new Map<string, Array<EntityWithId<MemberFeeChargeDocument>>>();
  const seenByMemberId = new Map<string, Set<string>>();

  charges.forEach((charge) => {
    getChargeTargetMemberIds(charge, members).forEach((memberId) => {
      const seen = seenByMemberId.get(memberId) ?? new Set<string>();
      if (seen.has(charge.id)) {
        return;
      }
      seen.add(charge.id);
      seenByMemberId.set(memberId, seen);
      map.set(memberId, [...(map.get(memberId) ?? []), charge]);
    });
  });

  return map;
}

export function getOpenFeeCharges(charges: Array<EntityWithId<MemberFeeChargeDocument>>) {
  return charges.filter((charge) => charge.status === 'pending' || charge.status === 'overdue');
}
