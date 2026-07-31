import { Timestamp } from 'firebase-admin/firestore';
import { normalizeMemberNumber } from '../../../auth/member-number-auth.js';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, MemberStatus } from '../../domain/models.js';
import type { UsersDataAccess, UsersTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureAuthenticatedActor,
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

async function reserveMemberNumber(params: {
  dataAccess: UsersDataAccess;
  actorUid: string;
  memberId: string;
  memberNumber: string;
  linkedUserId?: string | null | undefined;
}): Promise<void> {
  const normalizedMemberNumber = normalizeMemberNumber(params.memberNumber);
  const existingIdentifier = await params.dataAccess.memberLoginIdentifiers.getById(normalizedMemberNumber);

  assertCondition(
    !existingIdentifier ||
      existingIdentifier.active === false ||
      !existingIdentifier.memberId ||
      existingIdentifier.memberId === params.memberId,
    'already-exists',
    'Ya existe un socio con ese numero.',
  );

  await params.dataAccess.memberLoginIdentifiers.set(
    normalizedMemberNumber,
    {
      uid: params.linkedUserId === undefined ? existingIdentifier?.uid ?? null : params.linkedUserId,
      memberId: params.memberId,
      memberNumber: params.memberNumber,
      active: true,
    },
    params.actorUid,
  );
}

async function moveMemberNumberReservation(params: {
  dataAccess: UsersDataAccess;
  actorUid: string;
  memberId: string;
  previousMemberNumber: string;
  nextMemberNumber: string;
  linkedUserId?: string | null | undefined;
}): Promise<void> {
  const previousNormalized = normalizeMemberNumber(params.previousMemberNumber);
  const nextNormalized = normalizeMemberNumber(params.nextMemberNumber);

  if (previousNormalized === nextNormalized) {
    await reserveMemberNumber({
      dataAccess: params.dataAccess,
      actorUid: params.actorUid,
      memberId: params.memberId,
      memberNumber: params.nextMemberNumber,
      linkedUserId: params.linkedUserId,
    });
    return;
  }

  const previousIdentifier = await params.dataAccess.memberLoginIdentifiers.getById(previousNormalized);
  assertCondition(
    !previousIdentifier || !previousIdentifier.uid,
    'failed-precondition',
    'El numero de socio no puede modificarse porque esta vinculado al acceso de la app.',
  );

  await reserveMemberNumber({
    dataAccess: params.dataAccess,
    actorUid: params.actorUid,
    memberId: params.memberId,
    memberNumber: params.nextMemberNumber,
    linkedUserId: params.linkedUserId,
  });

  if (previousIdentifier?.memberId === params.memberId) {
    await params.dataAccess.memberLoginIdentifiers.set(
      previousNormalized,
      {
        uid: null,
        memberId: null,
        active: false,
        memberNumber: params.previousMemberNumber,
      },
      params.actorUid,
    );
  }
}

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
  endAt?: Date | null | undefined;
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

    const normalizedMemberNumber = normalizeMemberNumber(params.input.memberNumber);
    const memberId = `member-${normalizedMemberNumber}`;
    const [existingMember, existingIdentifier] = await Promise.all([
      dataAccess.members.getById(memberId),
      dataAccess.memberLoginIdentifiers.getById(normalizedMemberNumber),
    ]);

    assertCondition(!existingMember, 'already-exists', 'Ya existe un socio con ese numero.');
    assertCondition(
      !existingIdentifier ||
        existingIdentifier.active === false ||
        !existingIdentifier.memberId ||
        existingIdentifier.memberId === memberId,
      'already-exists',
      'Ya existe un socio con ese numero.',
    );

    await dataAccess.members.createWithId(
      memberId,
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

    await dataAccess.memberLoginIdentifiers.set(
      normalizedMemberNumber,
      {
        uid: params.input.linkedUserId ?? null,
        memberId,
        memberNumber: params.input.memberNumber,
        active: true,
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

    assertCondition(
      !params.input.memberNumber || params.input.memberNumber === existingMember.memberNumber,
      'failed-precondition',
      'El numero de socio no puede modificarse una vez creado.',
    );

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

    if (params.input.memberNumber !== undefined || params.input.linkedUserId !== undefined) {
      await moveMemberNumberReservation({
        dataAccess,
        actorUid: actor.uid,
        memberId: params.input.memberId,
        previousMemberNumber: existingMember.memberNumber,
        nextMemberNumber: params.input.memberNumber ?? existingMember.memberNumber,
        linkedUserId:
          params.input.linkedUserId === undefined ? existingMember.linkedUserId : params.input.linkedUserId,
      });
    }

    if (params.input.linkedUserId !== undefined) {
      await syncProfileLink({
        dataAccess,
        actorUid: actor.uid,
        previousLinkedUserId: existingMember.linkedUserId,
        nextLinkedUserId: params.input.linkedUserId ?? undefined,
        profileId: params.input.memberId,
        profileType: 'member',
      });
    }

    return { memberId: params.input.memberId };
  });
}

export interface UpdateOwnMemberDniInput {
  dni: string;
}

export async function updateOwnMemberDniUseCase(params: {
  actor: Actor | null;
  input: UpdateOwnMemberDniInput;
  transactions: UsersTransactionManager;
}): Promise<{ memberId: string; dni: string }> {
  const actor = ensureAuthenticatedActor(params.actor);
  assertCondition(
    actor.user.profileType === 'member' && Boolean(actor.user.profileId),
    'permission-denied',
    'El usuario autenticado no tiene una ficha de socio propia.',
  );
  const dni = params.input.dni.replace(/\D/g, '');
  assertCondition(dni.length >= 7 && dni.length <= 9, 'invalid-argument', 'El DNI debe tener entre 7 y 9 digitos.');

  return params.transactions.runInTransaction(async (dataAccess) => {
    const memberId = actor.user.profileId as string;
    const member = await dataAccess.members.getById(memberId);
    assertCondition(member, 'not-found', `No existe members/${memberId}.`);
    assertCondition(
      !member.linkedUserId || member.linkedUserId === actor.uid,
      'permission-denied',
      'La ficha de socio no pertenece al usuario autenticado.',
    );
    await dataAccess.members.update(memberId, { dni }, actor.uid);
    return { memberId, dni };
  });
}

export async function startLicenseUseCase(params: {
  actor: Actor | null;
  input: StartLicenseInput;
  transactions: UsersTransactionManager;
}): Promise<{ memberId: string }> {
  const actor = ensureStaff(params.actor);
  if (params.input.endAt) {
    validateLicenseRange(params.input.startAt, params.input.endAt);
  }

  return params.transactions.runInTransaction(async (dataAccess) => {
    const member = await dataAccess.members.getById(params.input.memberId);
    assertCondition(member, 'not-found', `No existe members/${params.input.memberId}.`);

    await dataAccess.members.update(
      params.input.memberId,
      {
        status: 'license',
        licenseStartAt: Timestamp.fromDate(params.input.startAt),
        licenseEndAt: params.input.endAt ? Timestamp.fromDate(params.input.endAt) : null,
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

export function parseUpdateOwnMemberDniInput(payload: unknown): UpdateOwnMemberDniInput {
  const data = assertIsRecord(payload);
  return { dni: parseRequiredString(data, 'dni') };
}

export function parseStartLicenseInput(payload: unknown): StartLicenseInput {
  const data = assertIsRecord(payload);

  return {
    memberId: parseRequiredString(data, 'memberId'),
    startAt: parseRequiredIsoDate(data, 'startAt'),
    endAt: parseOptionalIsoDate(data, 'endAt') ?? null,
  };
}

export function parseEndLicenseInput(payload: unknown): EndLicenseInput {
  const data = assertIsRecord(payload);

  return {
    memberId: parseRequiredString(data, 'memberId'),
  };
}
