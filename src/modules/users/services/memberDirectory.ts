import type { Timestamp } from 'firebase/firestore';
import { normalizeMemberNumber } from '../../../lib/memberAuth';
import { createFamilyGroupsRepository } from '../repositories/familyGroups.repository';
import { createMembersRepository } from '../repositories/members.repository';
import { createUsersCallables } from '../functions/users.callables';
import type {
  CreateMemberPayload,
  EntityWithId,
  FamilyGroupDocument,
  MemberDocument,
  MemberTypeDocument,
  UpdateMemberPayload,
} from '../domain/models';
import type { ListMembersParams, ListMembersResult } from '../types/member.types';
import type { TemporaryMemberCredentials } from '../types/user.types';
import * as localDirectory from '../local/memberDirectory';
import type {
  ClubMemberDraft,
  ClubMemberRecord,
  ClubMemberStatus,
  ClubMemberTypeId,
} from '../local/memberDirectory';

export type { ClubMemberDraft, ClubMemberRecord, ClubMemberStatus, ClubMemberTypeId };
export { matchesClubMemberSearch } from '../local/memberDirectory';

export interface ClubMemberListParams {
  search?: string;
  status?: ListMembersParams['status'];
  typeId?: string | 'all';
  familyGroupId?: string | 'all';
  linkedUser?: ListMembersParams['linkedUser'];
  pageSize?: number;
  cursor?: ListMembersParams['cursor'];
}

export interface ClubMemberListResult {
  members: ClubMemberRecord[];
  nextCursor: ListMembersResult['nextCursor'];
  hasMore: boolean;
}

export type ClubMemberSaveResult = ClubMemberRecord & {
  temporaryAccessCredentials?: TemporaryMemberCredentials;
};

type DirectorySource = {
  mode: 'firestore' | 'local';
  label: string;
  canReset: boolean;
};

type ParsedMemberName = {
  firstName: string;
  lastName: string;
};

const LOCAL_DIRECTORY_SOURCE_VALUES = new Set(['local', 'csv', 'fallback']);

function shouldUseLocalDirectory(): boolean {
  const requestedSource = import.meta.env.VITE_MEMBER_DIRECTORY_SOURCE?.toLowerCase();
  return import.meta.env.DEV && LOCAL_DIRECTORY_SOURCE_VALUES.has(requestedSource ?? '');
}

export function getMemberDirectorySource(): DirectorySource {
  if (shouldUseLocalDirectory()) {
    return {
      mode: 'local',
      label: 'Fallback localStorage/CSV',
      canReset: true,
    };
  }

  return {
    mode: 'firestore',
    label: 'Firestore + callables',
    canReset: false,
  };
}

function cleanOptionalValue(value: string | null | undefined): string | undefined {
  const trimmedValue = value?.trim() ?? '';
  return trimmedValue ? trimmedValue : undefined;
}

function timestampToIso(value: Timestamp | string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  return value.toDate().toISOString();
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const lowerToken = token.toLocaleLowerCase('es-AR');
      return `${lowerToken.charAt(0).toLocaleUpperCase('es-AR')}${lowerToken.slice(1)}`;
    })
    .join(' ');
}

function parseMemberName(fullName: string): ParsedMemberName {
  const normalizedName = fullName.trim().replace(/\s+/g, ' ');
  if (!normalizedName) {
    return { firstName: '', lastName: '' };
  }

  if (normalizedName.includes(',')) {
    const [lastName = '', ...firstNameParts] = normalizedName.split(',');
    return {
      firstName: toTitleCase(firstNameParts.join(',').trim()),
      lastName: toTitleCase(lastName.trim()),
    };
  }

  const tokens = normalizedName.split(' ').filter(Boolean);
  if (tokens.length === 1) {
    return {
      firstName: '',
      lastName: toTitleCase(tokens[0] ?? ''),
    };
  }

  return {
    lastName: toTitleCase(tokens[0] ?? ''),
    firstName: toTitleCase(tokens.slice(1).join(' ')),
  };
}

function getMemberTypeLabel(typeId: string, memberTypes: Map<string, EntityWithId<MemberTypeDocument>>): string {
  const configuredType = memberTypes.get(typeId);
  if (configuredType?.label) {
    return configuredType.label;
  }

  switch (typeId) {
    case 'pleno':
      return 'Socio pleno';
    case 'vitalicio':
      return 'Vitalicio';
    case 'menor':
      return 'Socio menor';
    case 'licencia':
      return 'Licencia';
    case 'grupo_familiar_asociado':
      return 'Grupo familiar asociado';
    case 'grupo_familiar_titular':
      return 'Grupo familiar titular';
    default:
      return typeId;
  }
}

function getMembershipStatusLabel(member: MemberDocument): string {
  if (member.status === 'license') {
    return 'LICENCIA';
  }

  if (member.status === 'inactive') {
    return 'INACTIVO';
  }

  switch (member.typeId) {
    case 'vitalicio':
      return 'VITALICIO';
    case 'menor':
      return 'SOCIO MENOR';
    case 'licencia':
      return 'LICENCIA';
    case 'grupo_familiar_asociado':
      return 'GRUPO FAMILIAR';
    case 'grupo_familiar_titular':
    case 'pleno':
    default:
      return 'SOCIO PLENO';
  }
}

function getFeeDeductionLabel(member: MemberDocument): string | undefined {
  if (member.typeId === 'menor') {
    return '30% SOCIO PLENO';
  }

  if (member.typeId !== 'pleno' && member.typeId !== 'grupo_familiar_titular') {
    return '50% SOCIO PLENO';
  }

  return undefined;
}

function buildFamilyGroupCode(memberNumber: string, fallbackId?: string): string {
  const cleanedMemberNumber = memberNumber.trim();
  if (cleanedMemberNumber) {
    return `GF-${cleanedMemberNumber.padStart(4, '0')}`;
  }

  return `GF-${fallbackId ?? Date.now().toString(36)}`;
}

function mapFirestoreMember(params: {
  member: EntityWithId<MemberDocument>;
  members?: Array<EntityWithId<MemberDocument>>;
  memberTypes: Map<string, EntityWithId<MemberTypeDocument>>;
  familyGroups: Map<string, EntityWithId<FamilyGroupDocument>>;
}): ClubMemberRecord {
  const { familyGroups, member, members, memberTypes } = params;
  const fullName = `${member.lastName}, ${member.firstName}`.replace(/,\s*$/, '').trim();
  const displayName = fullName || member.memberNumber;
  const familyGroup = member.familyGroupId ? familyGroups.get(member.familyGroupId) : undefined;
  const familyMembers = members
    ? member.familyGroupId
      ? members.filter((entry) => entry.familyGroupId === member.familyGroupId)
      : members.filter((entry) => !entry.familyGroupId && entry.memberNumber === member.memberNumber)
    : [];
  const holderMember =
    familyMembers.find((entry) => familyGroup?.holderMemberId === entry.id) ??
    familyMembers.find((entry) => entry.isFamilyHolder) ??
    familyMembers[0];
  const familyGroupCode =
    (familyMembers.length > 1 || (familyGroup?.memberIds.length ?? 0) > 1)
      ? familyGroup?.code ?? buildFamilyGroupCode(holderMember?.memberNumber ?? member.memberNumber, member.id)
      : undefined;

  return {
    id: member.id,
    memberNumber: member.memberNumber,
    fullName,
    displayName,
    firstName: member.firstName,
    lastName: member.lastName,
    dni: member.dni,
    linkedUserId: member.linkedUserId,
    aagMembershipNumber: member.aagMembershipNumber,
    membershipStatusLabel: getMembershipStatusLabel(member),
    memberTypeId: member.typeId as ClubMemberTypeId,
    memberTypeLabel: getMemberTypeLabel(member.typeId, memberTypes),
    feeDeductionLabel: getFeeDeductionLabel(member),
    notes: member.notes,
    active: member.status === 'active',
    status: member.status,
    legacyOrder: Number(member.memberNumber) || 0,
    familyGroupId: member.familyGroupId,
    familyHolderMemberId: familyGroupCode ? holderMember?.id : undefined,
    familyGroupCode,
    householdSize: familyMembers.length || familyGroup?.memberIds.length || 1,
    isFamilyHolder: member.isFamilyHolder || familyGroup?.holderMemberId === member.id,
    source: member.id.startsWith('legacy-') ? 'legacy-padron' : 'manual',
    createdAt: timestampToIso(member.createdAt),
    updatedAt: timestampToIso(member.updatedAt),
  };
}

async function getFirestoreMembers(): Promise<ClubMemberRecord[]> {
  const membersRepository = createMembersRepository();
  const familyGroupsRepository = createFamilyGroupsRepository();
  const allMembers: Array<EntityWithId<MemberDocument>> = [];
  let cursor: ListMembersParams['cursor'] = null;
  let hasMore = true;

  while (hasMore) {
    const page = await membersRepository.listMembers({ pageSize: 100, cursor });
    allMembers.push(...page.members);
    cursor = page.nextCursor;
    hasMore = page.hasMore && Boolean(cursor);
  }

  const [memberTypes, familyGroupsPage] = await Promise.all([
    membersRepository.listMemberTypes(),
    familyGroupsRepository.listFamilyGroups({ active: true, pageSize: 100 }),
  ]);

  const memberTypeMap = new Map(memberTypes.map((memberType) => [memberType.id, memberType]));
  const familyGroupMap = new Map(familyGroupsPage.familyGroups.map((familyGroup) => [familyGroup.id, familyGroup]));

  return allMembers.map((member) =>
    mapFirestoreMember({
      member,
      members: allMembers,
      memberTypes: memberTypeMap,
      familyGroups: familyGroupMap,
    }),
  );
}

async function listFirestoreMembers(params: ClubMemberListParams): Promise<ClubMemberListResult> {
  const membersRepository = createMembersRepository();
  const familyGroupsRepository = createFamilyGroupsRepository();
  const listParams: ListMembersParams = {};

  if (params.search !== undefined) {
    listParams.search = params.search;
  }

  if (params.status !== undefined) {
    listParams.status = params.status;
  }

  if (params.typeId !== undefined) {
    listParams.typeId = params.typeId;
  }

  if (params.familyGroupId !== undefined) {
    listParams.familyGroupId = params.familyGroupId;
  }

  if (params.linkedUser !== undefined) {
    listParams.linkedUser = params.linkedUser;
  }

  if (params.pageSize !== undefined) {
    listParams.pageSize = params.pageSize;
  }

  if (params.cursor !== undefined) {
    listParams.cursor = params.cursor;
  }

  const [page, memberTypes, familyGroupsPage] = await Promise.all([
    membersRepository.listMembers(listParams),
    membersRepository.listMemberTypes(),
    familyGroupsRepository.listFamilyGroups({ active: true, pageSize: 100 }),
  ]);

  const memberTypeMap = new Map(memberTypes.map((memberType) => [memberType.id, memberType]));
  const familyGroupMap = new Map(familyGroupsPage.familyGroups.map((familyGroup) => [familyGroup.id, familyGroup]));

  return {
    members: page.members.map((member) =>
      mapFirestoreMember({
        member,
        memberTypes: memberTypeMap,
        familyGroups: familyGroupMap,
      }),
    ),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

async function getFirestoreMemberById(memberId: string): Promise<ClubMemberRecord | null> {
  const membersRepository = createMembersRepository();
  const [member, memberTypes] = await Promise.all([
    membersRepository.getMember(memberId),
    membersRepository.listMemberTypes(),
  ]);

  if (!member) {
    return null;
  }

  return mapFirestoreMember({
    member,
    members: [member],
    memberTypes: new Map(memberTypes.map((memberType) => [memberType.id, memberType])),
    familyGroups: new Map(),
  });
}

async function applyFamilyGroupSelection(params: {
  memberId: string;
  familyHolderMemberId: string | undefined;
  previousFamilyGroupId?: string | undefined;
  previousIsFamilyHolder?: boolean | undefined;
}) {
  const { familyHolderMemberId, memberId, previousFamilyGroupId, previousIsFamilyHolder } = params;
  const callables = createUsersCallables();
  const membersRepository = createMembersRepository();

  if (!familyHolderMemberId) {
    if (previousFamilyGroupId && !previousIsFamilyHolder) {
      await callables.removeMemberFromFamilyGroup({ groupId: previousFamilyGroupId, memberId });
    }
    return;
  }

  const holder = await membersRepository.getMember(familyHolderMemberId);
  if (!holder) {
    throw new Error('No encontramos el titular familiar seleccionado.');
  }

  if (previousFamilyGroupId && previousFamilyGroupId !== holder.familyGroupId && !previousIsFamilyHolder) {
    await callables.removeMemberFromFamilyGroup({ groupId: previousFamilyGroupId, memberId });
  }

  if (holder.familyGroupId) {
    await callables.addMemberToFamilyGroup({ groupId: holder.familyGroupId, memberId });
    return;
  }

  await callables.createFamilyGroup({
    holderMemberId: holder.id,
    memberIds: [holder.id, memberId],
    code: buildFamilyGroupCode(holder.memberNumber, holder.id),
  });
}

async function saveFirestoreMember(draft: ClubMemberDraft): Promise<ClubMemberSaveResult> {
  const membersRepository = createMembersRepository();
  const callables = createUsersCallables();
  const { firstName, lastName } = parseMemberName(draft.fullName);

  if (!firstName && !lastName) {
    throw new Error('El nombre completo es obligatorio.');
  }

  const aagMembershipNumber = cleanOptionalValue(draft.aagMembershipNumber);
  const commonPayload: Pick<CreateMemberPayload, 'memberNumber' | 'firstName' | 'lastName' | 'typeId'> &
    Partial<Pick<CreateMemberPayload, 'aagMembershipNumber' | 'dni' | 'notes'>> = {
    memberNumber: draft.memberNumber.trim(),
    firstName: firstName || lastName,
    lastName: lastName || firstName,
    typeId: draft.memberTypeId,
  };
  const dni = cleanOptionalValue(draft.dni);
  const notes = cleanOptionalValue(draft.notes);

  if (aagMembershipNumber) {
    commonPayload.aagMembershipNumber = aagMembershipNumber;
  }

  if (dni) {
    commonPayload.dni = dni;
  }

  if (notes) {
    commonPayload.notes = notes;
  }

  let memberId = draft.id;
  let previousMember: EntityWithId<MemberDocument> | null = null;
  let temporaryAccessCredentials: TemporaryMemberCredentials | undefined;

  if (memberId) {
    previousMember = await membersRepository.getMember(memberId);
    if (previousMember && previousMember.memberNumber !== draft.memberNumber.trim()) {
      throw new Error('El numero de socio no puede modificarse una vez creado.');
    }
    const { memberNumber: _memberNumber, ...updateCommonPayload } = commonPayload;
    const payload: UpdateMemberPayload = {
      memberId,
      ...updateCommonPayload,
      aagMembershipNumber: aagMembershipNumber ?? null,
      dni: dni ?? null,
      notes: notes ?? null,
      status: draft.active ? 'active' : 'inactive',
    };

    await callables.updateMember(payload);
  } else {
    const payload: CreateMemberPayload = {
      ...commonPayload,
      joinedAt: new Date().toISOString(),
    };

    const result = await callables.createMember(payload);
    memberId = result.memberId;
    if (result.temporaryPassword && result.memberNumber) {
      temporaryAccessCredentials = {
        memberNumber: result.memberNumber,
        temporaryPassword: result.temporaryPassword,
        passwordGeneratedAt: result.passwordGeneratedAt,
      };
    }
  }

  if (draft.memberTypeId === 'grupo_familiar_asociado') {
    await applyFamilyGroupSelection({
      memberId,
      familyHolderMemberId: draft.familyHolderMemberId,
      previousFamilyGroupId: previousMember?.familyGroupId,
      previousIsFamilyHolder: previousMember?.isFamilyHolder,
    });
  } else if (previousMember?.familyGroupId && !previousMember.isFamilyHolder) {
    await applyFamilyGroupSelection({
      memberId,
      familyHolderMemberId: undefined,
      previousFamilyGroupId: previousMember.familyGroupId,
      previousIsFamilyHolder: previousMember.isFamilyHolder,
    });
  }

  const savedMember = await getFirestoreMemberById(memberId);
  if (!savedMember) {
    throw new Error('El socio se guardo, pero no pudimos recargarlo desde Firestore.');
  }

  return temporaryAccessCredentials
    ? {
        ...savedMember,
        temporaryAccessCredentials,
      }
    : savedMember;
}

export async function getClubMembers(): Promise<ClubMemberRecord[]> {
  if (shouldUseLocalDirectory()) {
    return localDirectory.getClubMembers();
  }

  return getFirestoreMembers();
}

export async function listClubMembers(params: ClubMemberListParams = {}): Promise<ClubMemberListResult> {
  if (shouldUseLocalDirectory()) {
    const allMembers = await localDirectory.getClubMembers();
    const filteredMembers = allMembers.filter((member) => {
      const matchesSearch = localDirectory.matchesClubMemberSearch(member, params.search ?? '');
      const matchesStatus = !params.status || params.status === 'all' ? true : member.status === params.status;
      const matchesType = !params.typeId || params.typeId === 'all' ? true : member.memberTypeId === params.typeId;
      const matchesFamily =
        !params.familyGroupId || params.familyGroupId === 'all' ? true : member.familyGroupId === params.familyGroupId;
      const linkedUser = params.linkedUser ?? 'all';
      const matchesLinked =
        linkedUser === 'all' ? true : linkedUser === 'linked' ? Boolean(member.linkedUserId) : !member.linkedUserId;

      return matchesSearch && matchesStatus && matchesType && matchesFamily && matchesLinked;
    });

    return {
      members: filteredMembers.slice(0, params.pageSize ?? 25),
      nextCursor: null,
      hasMore: filteredMembers.length > (params.pageSize ?? 25),
    };
  }

  return listFirestoreMembers(params);
}

export async function getClubMemberById(memberId: string): Promise<ClubMemberRecord | null> {
  if (shouldUseLocalDirectory()) {
    return localDirectory.getClubMemberById(memberId);
  }

  return getFirestoreMemberById(memberId);
}

export async function isClubMemberNumberInUse(
  memberNumber: string,
  excludingMemberId?: string | null,
): Promise<boolean> {
  const compactMemberNumber = memberNumber.trim().replace(/\s+/g, '');

  if (!compactMemberNumber) {
    return false;
  }

  if (shouldUseLocalDirectory()) {
    const members = await localDirectory.getClubMembers();
    const normalizedMemberNumber = normalizeMemberNumber(compactMemberNumber);
    return members.some(
      (member) =>
        member.id !== excludingMemberId &&
        normalizeMemberNumber(member.memberNumber) === normalizedMemberNumber,
    );
  }

  const membersRepository = createMembersRepository();
  const existingMember = await membersRepository.findByMemberNumber(compactMemberNumber);
  return Boolean(existingMember && existingMember.id !== excludingMemberId);
}

export async function getClubMemberHousehold(memberId: string): Promise<ClubMemberRecord[]> {
  if (shouldUseLocalDirectory()) {
    return localDirectory.getClubMemberHousehold(memberId);
  }

  const membersRepository = createMembersRepository();
  const familyGroupsRepository = createFamilyGroupsRepository();
  const member = await membersRepository.getMember(memberId);
  if (!member) {
    return [];
  }

  if (member.familyGroupId) {
    const [familyGroup, memberTypes] = await Promise.all([
      familyGroupsRepository.getFamilyGroup(member.familyGroupId),
      membersRepository.listMemberTypes(),
    ]);
    const familyMemberIds = familyGroup?.memberIds.length ? familyGroup.memberIds : [member.id];
    const relatedMembers = (
      await Promise.all(familyMemberIds.map((relatedMemberId) => membersRepository.getMember(relatedMemberId)))
    ).filter((relatedMember): relatedMember is EntityWithId<MemberDocument> => Boolean(relatedMember));
    const memberTypeMap = new Map(memberTypes.map((memberType) => [memberType.id, memberType]));
    const familyGroupMap = familyGroup ? new Map([[familyGroup.id, familyGroup]]) : new Map<string, EntityWithId<FamilyGroupDocument>>();

    return relatedMembers.map((relatedMember) =>
      mapFirestoreMember({
        member: relatedMember,
        members: relatedMembers,
        memberTypes: memberTypeMap,
        familyGroups: familyGroupMap,
      }),
    );
  }

  return [];
}

export async function saveClubMember(draft: ClubMemberDraft): Promise<ClubMemberSaveResult> {
  if (shouldUseLocalDirectory()) {
    return localDirectory.saveClubMember(draft);
  }

  return saveFirestoreMember(draft);
}

export async function setClubMemberActive(memberId: string, active: boolean): Promise<ClubMemberRecord | null> {
  if (shouldUseLocalDirectory()) {
    return localDirectory.setClubMemberActive(memberId, active);
  }

  const callables = createUsersCallables();
  await callables.updateMember({
    memberId,
    status: active ? 'active' : 'inactive',
  });

  return getFirestoreMemberById(memberId);
}

export async function resetClubMemberDirectory(): Promise<ClubMemberRecord[]> {
  if (shouldUseLocalDirectory()) {
    return localDirectory.resetClubMemberDirectory();
  }

  throw new Error('El padron operativo usa Firestore. El CSV/localStorage solo queda disponible como fallback de desarrollo.');
}
