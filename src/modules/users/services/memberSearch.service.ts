import type { EntityWithId, MemberDocument } from '../domain/models';

export function normalizeMemberSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesMemberSearch(member: EntityWithId<MemberDocument>, query: string): boolean {
  const normalizedQuery = normalizeMemberSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const searchTerms = normalizedQuery.split(' ').filter(Boolean);
  const searchableText = normalizeMemberSearchText(
    [
      member.id,
      member.memberNumber,
      member.firstName,
      member.lastName,
      member.dni ?? '',
      member.aagMembershipNumber ?? '',
      member.email ?? '',
      member.phoneNumber ?? '',
      member.typeId,
      member.typeCodeSnapshot,
      member.status,
    ].join(' '),
  );

  return searchTerms.every((term) => searchableText.includes(term));
}

