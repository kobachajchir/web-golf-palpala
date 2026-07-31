import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import {
  syncCustomClaimsUseCase,
} from '../application/use-cases/auth.use-cases.js';
import {
  createEmployeeUseCase,
  parseCreateEmployeeInput,
  parseUpdateEmployeeInput,
  updateEmployeeUseCase,
} from '../application/use-cases/employee.use-cases.js';
import {
  addMemberToFamilyGroupUseCase,
  createFamilyGroupUseCase,
  parseAddMemberToFamilyGroupInput,
  parseCreateFamilyGroupInput,
  parseRemoveMemberFromFamilyGroupInput,
  removeMemberFromFamilyGroupUseCase,
} from '../application/use-cases/family-group.use-cases.js';
import { parseRecordHandicapInput, recordHandicapUseCase } from '../application/use-cases/handicap.use-cases.js';
import { getNextMemberNumberFromExisting } from '../application/use-cases/member-number.use-cases.js';
import {
  createMemberUseCase,
  endLicenseUseCase,
  parseCreateMemberInput,
  parseEndLicenseInput,
  parseStartLicenseInput,
  parseUpdateMemberInput,
  parseUpdateOwnMemberDniInput,
  startLicenseUseCase,
  updateMemberUseCase,
  updateOwnMemberDniUseCase,
} from '../application/use-cases/member.use-cases.js';
import { assignRoleUseCase, parseAssignRoleInput } from '../application/use-cases/role.use-cases.js';
import {
  assertIsRecord,
  buildCustomClaims,
  ensureStaff,
  parseOptionalBoolean,
  parseOptionalString,
  parseRequiredString,
  pickPrimaryRoleId,
  resolveActor,
  toHttpsError,
} from '../application/shared.js';
import { FirebaseAuthGateway } from '../infrastructure/firestore/auth-gateway.js';
import { FirestoreUsersTransactionManager, SystemClock } from '../infrastructure/firestore/repositories.js';
import { USERS_COLLECTIONS } from '../domain/constants.js';
import type { EmployeeDocument, MemberDocument, UserDocument } from '../domain/models.js';
import {
  buildSyntheticAuthEmail,
  generateMemberTemporaryPassword,
  normalizeMemberNumber,
} from '../../auth/member-number-auth.js';
import { emitRoleNotification } from '../../notifications/notifications.service.js';

const transactions = new FirestoreUsersTransactionManager(new SystemClock());
const authGateway = new FirebaseAuthGateway();

function getOrInitializeApp() {
  return getApps().length > 0 ? getApp() : initializeApp();
}

async function getActorFromCallableRequest(
  auth:
    | {
        uid?: string;
        token?: Record<string, unknown>;
      }
    | undefined,
) {
  return resolveActor(
    transactions.getDataAccess(),
    auth
      ? {
          uid: auth.uid,
          token: auth.token,
        }
      : null,
  );
}

function withCallableLogging(functionName: string, error: unknown): never {
  logger.error(`${functionName} failed`, error);
  throw toHttpsError(error);
}

async function getOrCreateMemberAuthUser(params: {
  email: string;
  displayName: string;
  password: string;
  active: boolean;
}) {
  const auth = getAuth(getOrInitializeApp());

  try {
    const existingUser = await auth.getUserByEmail(params.email);
    return auth.updateUser(existingUser.uid, {
      displayName: params.displayName,
      password: params.password,
      disabled: !params.active,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  return auth.createUser({
    email: params.email,
    password: params.password,
    displayName: params.displayName,
    disabled: !params.active,
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseLinkEmployeeAuthUserInput(payload: unknown): {
  employeeId: string;
  email?: string;
  displayName?: string | undefined;
  administrativeAccess: boolean;
} {
  const data = assertIsRecord(payload);
  const email = parseOptionalString(data, 'email');
  return {
    employeeId: parseRequiredString(data, 'employeeId'),
    ...(email ? { email: normalizeEmail(email) } : {}),
    displayName: parseOptionalString(data, 'displayName'),
    administrativeAccess: parseOptionalBoolean(data, 'administrativeAccess') ?? false,
  };
}

function buildEmployeeCodeFromId(employeeId: string): string {
  return `E${employeeId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`;
}

function parseInviteEmployeeUserInput(payload: unknown): { employeeId: string } {
  const data = assertIsRecord(payload);
  return {
    employeeId: parseRequiredString(data, 'employeeId'),
  };
}

async function getOrCreateEmployeeAuthUser(params: {
  email: string;
  displayName: string;
  password: string;
}) {
  const auth = getAuth(getOrInitializeApp());

  try {
    const existingUser = await auth.getUserByEmail(params.email);
    return {
      userRecord: await auth.updateUser(existingUser.uid, {
        displayName: params.displayName,
        password: params.password,
        disabled: false,
      }),
      created: false,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  return {
    userRecord: await auth.createUser({
      email: params.email,
      displayName: params.displayName,
      password: params.password,
      disabled: false,
    }),
    created: true,
  };
}

function buildEmployeeLoginPath(employeeCode: string): string {
  return `/login?usuario=${encodeURIComponent(employeeCode)}`;
}

async function linkEmployeeAuthUser(params: {
  actorUid: string;
  employeeId: string;
  email?: string | undefined;
  displayName?: string | undefined;
  administrativeAccess?: boolean | undefined;
}) {
  const db = getFirestore(getOrInitializeApp());
  const employeeRef = db.collection(USERS_COLLECTIONS.employees).doc(params.employeeId);
  const employeeSnapshot = await employeeRef.get();

  if (!employeeSnapshot.exists) {
    throw new Error(`No existe employees/${params.employeeId}.`);
  }

  const employee = employeeSnapshot.data() as EmployeeDocument;
  const employeeCode = employee.employeeCode?.trim() || buildEmployeeCodeFromId(params.employeeId);
  const email = buildSyntheticAuthEmail(employeeCode);
  const displayName = params.displayName?.trim()
    || `${employee.firstName} ${employee.lastName}`.trim()
    || employeeCode;
  const generatedPassword = generateMemberTemporaryPassword(employeeCode);
  const { userRecord, created } = await getOrCreateEmployeeAuthUser({
    email,
    displayName,
    password: generatedPassword.temporaryPassword,
  });
  const roleIds = params.administrativeAccess ? ['empleado', 'administrativo'] : ['empleado'];
  let claimRoleIds = roleIds;
  let claimsVersion = 1;

  await db.runTransaction(async (transaction) => {
    const freshEmployeeSnapshot = await transaction.get(employeeRef);
    if (!freshEmployeeSnapshot.exists) {
      throw new Error(`No existe employees/${params.employeeId}.`);
    }

    const freshEmployee = freshEmployeeSnapshot.data() as EmployeeDocument;
    if (freshEmployee.linkedUserId && freshEmployee.linkedUserId !== userRecord.uid) {
      throw new Error('El empleado ya esta vinculado a otro usuario.');
    }

    const userRef = db.collection(USERS_COLLECTIONS.users).doc(userRecord.uid);
    const userSnapshot = await transaction.get(userRef);
    const existingUser = userSnapshot.exists ? (userSnapshot.data() as UserDocument) : null;
    const isSameProfile = existingUser?.profileType === 'employee' && existingUser.profileId === params.employeeId;
    const isAvailableProfile =
      !existingUser
      || existingUser.profileType === 'none'
      || existingUser.profileId === undefined
      || existingUser.profileId === null;

    if (!isSameProfile && !isAvailableProfile) {
      throw new Error('El usuario Auth ya esta vinculado a otro perfil.');
    }

    const mergedRoleIds = Array.from(new Set([...(existingUser?.roleIds ?? []), ...roleIds]));
    claimRoleIds = mergedRoleIds;
    claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;

    transaction.set(
      userRef,
      {
        email,
        displayName,
        primaryRoleId: pickPrimaryRoleId(mergedRoleIds),
        roleIds: mergedRoleIds,
        profileType: 'employee',
        profileId: params.employeeId,
        memberNumber: employeeCode,
        authProviderMode: 'member_number_password',
        active: true,
        mustChangePassword: true,
        passwordResetRequiredReason: 'initial_default',
        claimsVersion,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: params.actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: params.actorUid,
      },
      { merge: true },
    );

    transaction.update(employeeRef, {
      ...(freshEmployee.employeeCode ? {} : { employeeCode }),
      linkedUserId: userRecord.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: params.actorUid,
    });
  });

  await authGateway.setCustomClaims(userRecord.uid, buildCustomClaims(claimRoleIds, claimsVersion, true));

  return {
    uid: userRecord.uid,
    employeeId: params.employeeId,
    employeeCode,
    email,
    loginPath: buildEmployeeLoginPath(employeeCode),
    temporaryPassword: generatedPassword.temporaryPassword,
    passwordGeneratedAt: generatedPassword.passwordGeneratedAt,
    createdAuthUser: created,
    claimsVersion,
  };
}

async function inviteEmployeeUser(params: {
  actorUid: string;
  employeeId: string;
}) {
  const db = getFirestore(getOrInitializeApp());
  const auth = getAuth(getOrInitializeApp());
  const employeeSnapshot = await db.collection(USERS_COLLECTIONS.employees).doc(params.employeeId).get();

  if (!employeeSnapshot.exists) {
    throw new Error(`No existe employees/${params.employeeId}.`);
  }

  const employee = employeeSnapshot.data() as EmployeeDocument;
  if (!employee.linkedUserId) {
    throw new Error('El empleado todavia no tiene usuario Auth vinculado.');
  }
  const employeeCode = employee.employeeCode?.trim() || buildEmployeeCodeFromId(params.employeeId);
  const displayName = `${employee.firstName} ${employee.lastName}`.trim() || employeeCode;

  const [, userSnapshot] = await Promise.all([
    auth.getUser(employee.linkedUserId),
    db.collection(USERS_COLLECTIONS.users).doc(employee.linkedUserId).get(),
  ]);
  const userDocument = userSnapshot.exists ? (userSnapshot.data() as UserDocument) : null;
  const email = buildSyntheticAuthEmail(employeeCode);
  const roleIds = userDocument?.roleIds?.length
    ? userDocument.roleIds
    : (employeeCode === 'E001' ? ['empleado', 'administrativo'] : ['empleado']);
  const claimsVersion = (userDocument?.claimsVersion ?? 0) + 1;
  const generatedPassword = generateMemberTemporaryPassword(employeeCode);

  await auth.updateUser(employee.linkedUserId, {
    email,
    displayName,
    password: generatedPassword.temporaryPassword,
    disabled: false,
  });

  await db.collection(USERS_COLLECTIONS.users).doc(employee.linkedUserId).set(
    {
      email,
      displayName,
      primaryRoleId: pickPrimaryRoleId(roleIds),
      roleIds,
      profileType: 'employee',
      profileId: params.employeeId,
      memberNumber: employeeCode,
      authProviderMode: 'member_number_password',
      active: true,
      mustChangePassword: true,
      passwordResetRequiredReason: 'staff_reset',
      claimsVersion,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: params.actorUid,
    },
    { merge: true },
  );

  await authGateway.setCustomClaims(employee.linkedUserId, buildCustomClaims(roleIds, claimsVersion, true));

  return {
    uid: employee.linkedUserId,
    employeeId: params.employeeId,
    employeeCode,
    email,
    loginPath: buildEmployeeLoginPath(employeeCode),
    temporaryPassword: generatedPassword.temporaryPassword,
    passwordGeneratedAt: generatedPassword.passwordGeneratedAt,
    claimsVersion,
  };
}

async function createDefaultAccessForMember(params: {
  actorUid: string;
  memberId: string;
}) {
  const db = getFirestore(getOrInitializeApp());
  const memberRef = db.collection(USERS_COLLECTIONS.members).doc(params.memberId);
  const memberSnapshot = await memberRef.get();

  if (!memberSnapshot.exists) {
    throw new Error(`No existe members/${params.memberId}.`);
  }

  const member = memberSnapshot.data() as MemberDocument;
  const normalizedMemberNumber = normalizeMemberNumber(member.memberNumber);
  const email = buildSyntheticAuthEmail(normalizedMemberNumber);
  const displayName = `${member.firstName} ${member.lastName}`.trim() || normalizedMemberNumber;
  const generatedPassword = generateMemberTemporaryPassword(normalizedMemberNumber);
  const authUser = await getOrCreateMemberAuthUser({
    email,
    displayName,
    password: generatedPassword.temporaryPassword,
    active: true,
  });
  const roleIds = ['socio'];
  let claimRoleIds = roleIds;
  let claimsVersion = 1;

  await db.runTransaction(async (transaction) => {
    const userRef = db.collection(USERS_COLLECTIONS.users).doc(authUser.uid);
    const identifierRef = db.collection(USERS_COLLECTIONS.memberLoginIdentifiers).doc(normalizedMemberNumber);
    const [freshMemberSnapshot, userSnapshot, identifierSnapshot] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(userRef),
      transaction.get(identifierRef),
    ]);

    if (!freshMemberSnapshot.exists) {
      throw new Error(`No existe members/${params.memberId}.`);
    }

    const freshMember = freshMemberSnapshot.data() as MemberDocument;
    if (freshMember.linkedUserId && freshMember.linkedUserId !== authUser.uid) {
      throw new Error('El socio ya esta vinculado a otro usuario.');
    }

    if (identifierSnapshot.exists) {
      const identifier = identifierSnapshot.data() as { uid?: string | null; memberId?: string | null };
      if (identifier.uid && identifier.uid !== authUser.uid) {
        throw new Error('Ya existe una cuenta para ese numero de socio.');
      }
    }

    const existingUser = userSnapshot.exists ? (userSnapshot.data() as UserDocument) : null;
    const mergedRoleIds = Array.from(new Set([...(existingUser?.roleIds ?? []), ...roleIds]));
    claimRoleIds = mergedRoleIds;
    claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;

    transaction.set(
      userRef,
      {
        email,
        displayName,
        primaryRoleId: pickPrimaryRoleId(mergedRoleIds),
        roleIds: mergedRoleIds,
        profileType: 'member',
        profileId: params.memberId,
        active: true,
        claimsVersion,
        memberNumber: normalizedMemberNumber,
        authProviderMode: 'member_number_password',
        mustChangePassword: true,
        passwordResetRequiredReason: 'initial_default',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: params.actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: params.actorUid,
      },
      { merge: true },
    );

    transaction.set(
      identifierRef,
      {
        uid: authUser.uid,
        memberId: params.memberId,
        memberNumber: member.memberNumber,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: params.actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: params.actorUid,
      },
      { merge: true },
    );

    transaction.update(memberRef, {
      linkedUserId: authUser.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: params.actorUid,
    });
  });

  await authGateway.setCustomClaims(
    authUser.uid,
    buildCustomClaims(claimRoleIds, claimsVersion, true),
  );

  return {
    uid: authUser.uid,
    memberNumber: normalizedMemberNumber,
    temporaryPassword: generatedPassword.temporaryPassword,
    passwordGeneratedAt: generatedPassword.passwordGeneratedAt,
  };
}

export const usersCreateMember = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const result = await createMemberUseCase({
      actor,
      input: parseCreateMemberInput(request.data),
      transactions,
    });
    const staffActor = ensureStaff(actor);
    const accessResult = await createDefaultAccessForMember({
      actorUid: staffActor.uid,
      memberId: result.memberId,
    });

    try {
      await emitRoleNotification({
        type: 'membership_created',
        sourceModule: 'users',
        sourceCollection: USERS_COLLECTIONS.members,
        sourceId: result.memberId,
        title: 'Nueva membresía cargada',
        body: `Se cargó el socio ${accessResult.memberNumber}.`,
        severity: 'success',
        roleIds: ['administrativo', 'directivo'],
        deliveryScope: 'role_info',
        route: `/admin/members/${result.memberId}`,
        metadata: {
          memberId: result.memberId,
          memberNumber: accessResult.memberNumber,
        },
        actorUid: staffActor.uid,
      });
    } catch (notificationError) {
      logger.warn('usersCreateMember notification emit failed', notificationError);
    }

    return {
      ...result,
      linkedUserId: accessResult.uid,
      memberNumber: accessResult.memberNumber,
      temporaryPassword: accessResult.temporaryPassword,
      passwordGeneratedAt: accessResult.passwordGeneratedAt,
      mustChangePassword: true,
    };
  } catch (error) {
    withCallableLogging('usersCreateMember', error);
  }
});

export const usersGetNextMemberNumber = onCall(async (request) => {
  try {
    ensureStaff(
      await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined),
    );

    const snapshot = await getFirestore(getOrInitializeApp())
      .collection(USERS_COLLECTIONS.members)
      .select('memberNumber')
      .get();
    const memberNumbers = snapshot.docs
      .map((entry) => entry.get('memberNumber'))
      .filter((memberNumber): memberNumber is string => typeof memberNumber === 'string');

    return getNextMemberNumberFromExisting(memberNumbers);
  } catch (error) {
    withCallableLogging('usersGetNextMemberNumber', error);
  }
});

export const usersUpdateMember = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return updateMemberUseCase({
      actor,
      input: parseUpdateMemberInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersUpdateMember', error);
  }
});

export const usersUpdateOwnMemberDni = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return updateOwnMemberDniUseCase({
      actor,
      input: parseUpdateOwnMemberDniInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersUpdateOwnMemberDni', error);
  }
});

export const usersCreateFamilyGroup = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return createFamilyGroupUseCase({
      actor,
      input: parseCreateFamilyGroupInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersCreateFamilyGroup', error);
  }
});

export const usersAddMemberToFamilyGroup = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return addMemberToFamilyGroupUseCase({
      actor,
      input: parseAddMemberToFamilyGroupInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersAddMemberToFamilyGroup', error);
  }
});

export const usersRemoveMemberFromFamilyGroup = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return removeMemberFromFamilyGroupUseCase({
      actor,
      input: parseRemoveMemberFromFamilyGroupInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersRemoveMemberFromFamilyGroup', error);
  }
});

export const usersStartLicense = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return startLicenseUseCase({
      actor,
      input: parseStartLicenseInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersStartLicense', error);
  }
});

export const usersEndLicense = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return endLicenseUseCase({
      actor,
      input: parseEndLicenseInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersEndLicense', error);
  }
});

export const usersCreateEmployee = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return createEmployeeUseCase({
      actor,
      input: parseCreateEmployeeInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersCreateEmployee', error);
  }
});

export const usersUpdateEmployee = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return updateEmployeeUseCase({
      actor,
      input: parseUpdateEmployeeInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersUpdateEmployee', error);
  }
});

export const usersLinkEmployeeAuthUser = onCall(async (request) => {
  try {
    const actor = ensureStaff(
      await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined),
    );
    const input = parseLinkEmployeeAuthUserInput(request.data);

    return linkEmployeeAuthUser({
      actorUid: actor.uid,
      employeeId: input.employeeId,
      email: input.email,
      displayName: input.displayName,
      administrativeAccess: input.administrativeAccess,
    });
  } catch (error) {
    withCallableLogging('usersLinkEmployeeAuthUser', error);
  }
});

export const usersInviteEmployeeUser = onCall(async (request) => {
  try {
    const actor = ensureStaff(
      await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined),
    );
    const input = parseInviteEmployeeUserInput(request.data);

    return inviteEmployeeUser({
      actorUid: actor.uid,
      employeeId: input.employeeId,
    });
  } catch (error) {
    withCallableLogging('usersInviteEmployeeUser', error);
  }
});

export const usersAssignRole = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return assignRoleUseCase({
      actor,
      input: parseAssignRoleInput(request.data),
      transactions,
      authGateway,
    });
  } catch (error) {
    withCallableLogging('usersAssignRole', error);
  }
});

export const usersSyncCustomClaims = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const data = request.data as Record<string, unknown>;
    const uid = typeof data?.uid === 'string' ? data.uid.trim() : '';

    return syncCustomClaimsUseCase({
      actor,
      targetUid: uid,
      transactions,
      authGateway,
    });
  } catch (error) {
    withCallableLogging('usersSyncCustomClaims', error);
  }
});

export const usersRecordHandicap = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return recordHandicapUseCase({
      actor,
      input: parseRecordHandicapInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('usersRecordHandicap', error);
  }
});

export const users = {
  getNextMemberNumber: usersGetNextMemberNumber,
  createMember: usersCreateMember,
  updateMember: usersUpdateMember,
  updateOwnMemberDni: usersUpdateOwnMemberDni,
  createFamilyGroup: usersCreateFamilyGroup,
  addMemberToFamilyGroup: usersAddMemberToFamilyGroup,
  removeMemberFromFamilyGroup: usersRemoveMemberFromFamilyGroup,
  startLicense: usersStartLicense,
  endLicense: usersEndLicense,
  createEmployee: usersCreateEmployee,
  updateEmployee: usersUpdateEmployee,
  linkEmployeeAuthUser: usersLinkEmployeeAuthUser,
  inviteEmployeeUser: usersInviteEmployeeUser,
  assignRole: usersAssignRole,
  syncCustomClaims: usersSyncCustomClaims,
  recordHandicap: usersRecordHandicap,
};
