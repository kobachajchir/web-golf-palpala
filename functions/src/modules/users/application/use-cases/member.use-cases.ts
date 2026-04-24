import { Timestamp } from 'firebase-admin/firestore';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, MemberDocument, MemberStatus } from '../../domain/models.js';
import type { UsersTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureFamilyHolderEligibility,
  ensureStaff,
  parseOptionalBoolean,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseOptionalNullableIsoDate,
  parseOptionalString,
  parseRequiredIsoDate,
  parseRequiredString,
  syncProfileLink,
  validateLicenseRange,
} from '../shared.js';

export interface CreateMemberInput {
  memberNumber: string;
  firstName: string;
  lastName: string;
  typeId: string;
  aagMembershipNumber?: string | undefined;
  joinedAt: Date;
  dni?: string | undefined;
  birthDate?: Date | undefined;
  email?: string | undefined;
  phoneNumber?: string | undefined;
  linkedUserId?: string | null | undefined;
  notes?: string | undefined;
}

export interface UpdateMemberInput {
  memberId: string;
  memberNumber?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  typeId?: string | undefined;
  aagMembershipNumber?: string | null | undefined;
  joinedAt?: Date | undefined;
  dni?: string | null | undefined;
  birthDate?: Date | null | undefined;
  email?: string | null | undefined;
  phoneNumber?: string | null | undefined;
  linkedUserId?: string | null | undefined;
  notes?: string | null | undefined;
  status?: MemberStatus | undefined;
  familyGroupId?: string | null | undefined;
  isFamilyHolder?: boolean | undefined;
}

export interface StartLicenseInput {
  memberId: string;
  startAt: Date;
  endAt: Date;
}

export interface EndLicenseInput {
  memberId: string;
}

export async function createMemberUseCase(params: {
  actor: Actor | null;
  input: CreateMemberInput;
  transactions: UsersTransactionManager;
}): Promise<{ memberId: string }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const memberType = await dataAccess.memberTypes.getById(params.input.typeId);
    assertCondition(memberType, 'not-found', `No existe member_types/${params.input.typeId}.`);
    assertCondition(memberType.active, 'failed-precondition', `El tipo ${params.input.typeId} está inactivo.`);

    const memberId = await dataAccess.members.create(
      {
        memberNumber: params.input.memberNumber,
        firstName: params.input.firstName,
        lastName: params.input.lastName,
        aagMembershipNumber: params.input.aagMembershipNumber,
        dni: params.input.dni,
        birthDate: params.input.birthDate ? Timestamp.fromDate(params.input.birthDate) : undefined,
        email: params.input.email,
        phoneNumber: params.input.phoneNumber,
        linkedUserId: params.input.linkedUserId ?? undefined,
        typeId: memberType.id,
        typeCodeSnapshot: memberType.id,
        status: 'active',
        isFamilyHolder: false,
        joinedAt: Timestamp.fromDate(params.input.joinedAt),
        notes: params.input.notes,
      },
      actor.uid,
    );

    if (params.input.linkedUserId) {
      await syncProfileLink({
        dataAccess,
        actorUid: actor.uid,
        nextLinkedUserId: params.input.linkedUserId,
        profileId: memberId,
        profileType: 'member',
      });
    }

    return { memberId };
  });
}

export async function updateMemberUseCase(params: {
  actor: Actor | null;
  input: UpdateMemberInput;
  transactions: UsersTransactionManager;
}): Promise<{ memberId: string }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const existingMember = await dataAccess.members.getById(params.input.memberId);
    assertCondition(existingMember, 'not-found', `No existe members/${params.input.memberId}.`);

    let nextTypeId = existingMember.typeId;
    let nextTypeCodeSnapshot = existingMember.typeCodeSnapshot;
    if (params.input.typeId) {
      const memberType = await dataAccess.memberTypes.getById(params.input.typeId);
      assertCondition(memberType, 'not-found', `No existe member_types/${params.input.typeId}.`);
      assertCondition(memberType.active, 'failed-precondition', `El tipo ${params.input.typeId} está inactivo.`);

      if (existingMember.isFamilyHolder) {
        ensureFamilyHolderEligibility(existingMember, memberType);
      }

      nextTypeId = memberType.id;
      nextTypeCodeSnapshot = memberType.id;
    }

    if (params.input.isFamilyHolder === true) {
      assertCondition(
        params.input.familyGroupId !== null ? (params.input.familyGroupId ?? existingMember.familyGroupId) : existingMember.familyGroupId,
        'failed-precondition',
        'Un titular de grupo familiar debe pertenecer a un grupo familiar.',
      );

      const holderType = await dataAccess.memberTypes.getById(nextTypeId);
      assertCondition(holderType, 'not-found', `No existe member_types/${nextTypeId}.`);
      ensureFamilyHolderEligibility(existingMember, holderType);
    }

    await dataAccess.members.update(
      params.input.memberId,
      {
        memberNumber: params.input.memberNumber,
        firstName: params.input.firstName,
        lastName: params.input.lastName,
        aagMembershipNumber:
          params.input.aagMembershipNumber === undefined ? undefined : params.input.aagMembershipNumber,
        typeId: nextTypeId,
        typeCodeSnapshot: nextTypeCodeSnapshot,
        joinedAt: params.input.joinedAt ? Timestamp.fromDate(params.input.joinedAt) : undefined,
        dni: params.input.dni === undefined ? undefined : params.input.dni,
        birthDate:
          params.input.birthDate === undefined
            ? undefined
            : params.input.birthDate === null
              ? null
              : Timestamp.fromDate(params.input.birthDate),
        email: params.input.email === undefined ? undefined : params.input.email,
        phoneNumber: params.input.phoneNumber === undefined ? undefined : params.input.phoneNumber,
        linkedUserId: params.input.linkedUserId === undefined ? undefined : params.input.linkedUserId,
        notes: params.input.notes === undefined ? undefined : params.input.notes,
        status: params.input.status,
        familyGroupId: params.input.familyGroupId === undefined ? undefined : params.input.familyGroupId,
        isFamilyHolder: params.input.isFamilyHolder,
      },
      actor.uid,
    );

    await syncProfileLink({
      dataAccess,
      actorUid: actor.uid,
      previousLinkedUserId: existingMember.linkedUserId,
      nextLinkedUserId: params.input.linkedUserId === undefined ? existingMember.linkedUserId : params.input.linkedUserId ?? undefined,
      profileId: params.input.memberId,
      profileType: 'member',
    });

    return { memberId: params.input.memberId };
  });
}

export async function startLicenseUseCase(params: {
  actor: Actor | null;
  input: StartLicenseInput;
  transactions: UsersTransactionManager;
}): Promise<{ memberId: string }> {
  const actor = ensureStaff(params.actor);
  validateLicenseRange(params.input.startAt, params.input.endAt);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const member = await dataAccess.members.getById(params.input.memberId);
    assertCondition(member, 'not-found', `No existe members/${params.input.memberId}.`);

    await dataAccess.members.update(
      params.input.memberId,
      {
        status: 'license',
        licenseStartAt: Timestamp.fromDate(params.input.startAt),
        licenseEndAt: Timestamp.fromDate(params.input.endAt),
      },
      actor.uid,
    );

    return { memberId: params.input.memberId };
  });
}

export async function endLicenseUseCase(params: {
  actor: Actor | null;
  input: EndLicenseInput;
  transactions: UsersTransactionManager;
}): Promise<{ memberId: string }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const member = await dataAccess.members.getById(params.input.memberId);
    assertCondition(member, 'not-found', `No existe members/${params.input.memberId}.`);

    await dataAccess.members.update(
      params.input.memberId,
      {
        status: 'active',
        licenseStartAt: null,
        licenseEndAt: null,
      },
      actor.uid,
    );

    return { memberId: params.input.memberId };
  });
}

export function parseCreateMemberInput(payload: unknown): CreateMemberInput {
  const data = assertIsRecord(payload);

  return {
    memberNumber: parseRequiredString(data, 'memberNumber'),
    firstName: parseRequiredString(data, 'firstName'),
    lastName: parseRequiredString(data, 'lastName'),
    typeId: parseRequiredString(data, 'typeId'),
    aagMembershipNumber: parseOptionalString(data, 'aagMembershipNumber'),
    joinedAt: parseOptionalIsoDate(data, 'joinedAt') ?? new Date(),
    dni: parseOptionalString(data, 'dni'),
    birthDate: parseOptionalIsoDate(data, 'birthDate'),
    email: parseOptionalString(data, 'email'),
    phoneNumber: parseOptionalString(data, 'phoneNumber'),
    linkedUserId: parseOptionalNullableString(data, 'linkedUserId'),
    notes: parseOptionalString(data, 'notes'),
  };
}

export function parseUpdateMemberInput(payload: unknown): UpdateMemberInput {
  const data = assertIsRecord(payload);

  return {
    memberId: parseRequiredString(data, 'memberId'),
    memberNumber: parseOptionalString(data, 'memberNumber'),
    firstName: parseOptionalString(data, 'firstName'),
    lastName: parseOptionalString(data, 'lastName'),
    typeId: parseOptionalString(data, 'typeId'),
    aagMembershipNumber: parseOptionalNullableString(data, 'aagMembershipNumber'),
    joinedAt: parseOptionalIsoDate(data, 'joinedAt'),
    dni: parseOptionalNullableString(data, 'dni'),
    birthDate: parseOptionalNullableIsoDate(data, 'birthDate'),
    email: parseOptionalNullableString(data, 'email'),
    phoneNumber: parseOptionalNullableString(data, 'phoneNumber'),
    linkedUserId: parseOptionalNullableString(data, 'linkedUserId'),
    notes: parseOptionalNullableString(data, 'notes'),
    status: parseOptionalString(data, 'status') as MemberStatus | undefined,
    familyGroupId: parseOptionalNullableString(data, 'familyGroupId'),
    isFamilyHolder: parseOptionalBoolean(data, 'isFamilyHolder'),
  };
}

export function parseStartLicenseInput(payload: unknown): StartLicenseInput {
  const data = assertIsRecord(payload);

  return {
    memberId: parseRequiredString(data, 'memberId'),
    startAt: parseRequiredIsoDate(data, 'startAt'),
    endAt: parseRequiredIsoDate(data, 'endAt'),
  };
}

export function parseEndLicenseInput(payload: unknown): EndLicenseInput {
  const data = assertIsRecord(payload);

  return {
    memberId: parseRequiredString(data, 'memberId'),
  };
}
