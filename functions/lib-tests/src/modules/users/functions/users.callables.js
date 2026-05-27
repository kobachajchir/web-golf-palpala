import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { syncCustomClaimsUseCase, } from '../application/use-cases/auth.use-cases.js';
import { createEmployeeUseCase, parseCreateEmployeeInput, parseUpdateEmployeeInput, updateEmployeeUseCase, } from '../application/use-cases/employee.use-cases.js';
import { addMemberToFamilyGroupUseCase, createFamilyGroupUseCase, parseAddMemberToFamilyGroupInput, parseCreateFamilyGroupInput, parseRemoveMemberFromFamilyGroupInput, removeMemberFromFamilyGroupUseCase, } from '../application/use-cases/family-group.use-cases.js';
import { parseRecordHandicapInput, recordHandicapUseCase } from '../application/use-cases/handicap.use-cases.js';
import { getNextMemberNumberFromExisting } from '../application/use-cases/member-number.use-cases.js';
import { createMemberUseCase, endLicenseUseCase, parseCreateMemberInput, parseEndLicenseInput, parseStartLicenseInput, parseUpdateMemberInput, startLicenseUseCase, updateMemberUseCase, } from '../application/use-cases/member.use-cases.js';
import { assignRoleUseCase, parseAssignRoleInput } from '../application/use-cases/role.use-cases.js';
import { assertIsRecord, buildCustomClaims, ensureStaff, parseOptionalString, parseRequiredString, pickPrimaryRoleId, resolveActor, toHttpsError, } from '../application/shared.js';
import { FirebaseAuthGateway } from '../infrastructure/firestore/auth-gateway.js';
import { FirestoreUsersTransactionManager, SystemClock } from '../infrastructure/firestore/repositories.js';
import { USERS_COLLECTIONS } from '../domain/constants.js';
import { buildSyntheticAuthEmail, generateMemberTemporaryPassword, normalizeMemberNumber, } from '../../auth/member-number-auth.js';
const transactions = new FirestoreUsersTransactionManager(new SystemClock());
const authGateway = new FirebaseAuthGateway();
function getOrInitializeApp() {
    return getApps().length > 0 ? getApp() : initializeApp();
}
async function getActorFromCallableRequest(auth) {
    return resolveActor(transactions.getDataAccess(), auth
        ? {
            uid: auth.uid,
            token: auth.token,
        }
        : null);
}
function withCallableLogging(functionName, error) {
    logger.error(`${functionName} failed`, error);
    throw toHttpsError(error);
}
async function getOrCreateMemberAuthUser(params) {
    const auth = getAuth(getOrInitializeApp());
    try {
        const existingUser = await auth.getUserByEmail(params.email);
        return auth.updateUser(existingUser.uid, {
            displayName: params.displayName,
            password: params.password,
            disabled: !params.active,
        });
    }
    catch (error) {
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
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
function parseLinkEmployeeAuthUserInput(payload) {
    const data = assertIsRecord(payload);
    return {
        employeeId: parseRequiredString(data, 'employeeId'),
        email: normalizeEmail(parseRequiredString(data, 'email')),
        displayName: parseOptionalString(data, 'displayName'),
    };
}
function parseInviteEmployeeUserInput(payload) {
    const data = assertIsRecord(payload);
    return {
        employeeId: parseRequiredString(data, 'employeeId'),
    };
}
async function getOrCreateEmployeeAuthUser(params) {
    const auth = getAuth(getOrInitializeApp());
    try {
        const existingUser = await auth.getUserByEmail(params.email);
        return {
            userRecord: await auth.updateUser(existingUser.uid, {
                displayName: params.displayName,
                disabled: false,
            }),
            created: false,
        };
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code !== 'auth/user-not-found') {
            throw error;
        }
    }
    return {
        userRecord: await auth.createUser({
            email: params.email,
            displayName: params.displayName,
            disabled: false,
        }),
        created: true,
    };
}
async function linkEmployeeAuthUser(params) {
    const db = getFirestore(getOrInitializeApp());
    const auth = getAuth(getOrInitializeApp());
    const employeeRef = db.collection(USERS_COLLECTIONS.employees).doc(params.employeeId);
    const employeeSnapshot = await employeeRef.get();
    if (!employeeSnapshot.exists) {
        throw new Error(`No existe employees/${params.employeeId}.`);
    }
    const employee = employeeSnapshot.data();
    const displayName = params.displayName?.trim()
        || `${employee.firstName} ${employee.lastName}`.trim()
        || params.email;
    const { userRecord, created } = await getOrCreateEmployeeAuthUser({
        email: params.email,
        displayName,
    });
    const roleIds = ['empleado'];
    let claimRoleIds = roleIds;
    let claimsVersion = 1;
    await db.runTransaction(async (transaction) => {
        const freshEmployeeSnapshot = await transaction.get(employeeRef);
        if (!freshEmployeeSnapshot.exists) {
            throw new Error(`No existe employees/${params.employeeId}.`);
        }
        const freshEmployee = freshEmployeeSnapshot.data();
        if (freshEmployee.linkedUserId && freshEmployee.linkedUserId !== userRecord.uid) {
            throw new Error('El empleado ya esta vinculado a otro usuario.');
        }
        const userRef = db.collection(USERS_COLLECTIONS.users).doc(userRecord.uid);
        const userSnapshot = await transaction.get(userRef);
        const existingUser = userSnapshot.exists ? userSnapshot.data() : null;
        const isSameProfile = existingUser?.profileType === 'employee' && existingUser.profileId === params.employeeId;
        const isAvailableProfile = !existingUser
            || existingUser.profileType === 'none'
            || existingUser.profileId === undefined
            || existingUser.profileId === null;
        if (!isSameProfile && !isAvailableProfile) {
            throw new Error('El usuario Auth ya esta vinculado a otro perfil.');
        }
        const mergedRoleIds = Array.from(new Set([...(existingUser?.roleIds ?? []), ...roleIds]));
        claimRoleIds = mergedRoleIds;
        claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;
        transaction.set(userRef, {
            email: params.email,
            displayName,
            primaryRoleId: 'empleado',
            roleIds: mergedRoleIds,
            profileType: 'employee',
            profileId: params.employeeId,
            active: true,
            claimsVersion,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: params.actorUid,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: params.actorUid,
        }, { merge: true });
        transaction.update(employeeRef, {
            linkedUserId: userRecord.uid,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: params.actorUid,
        });
    });
    await auth.setCustomUserClaims(userRecord.uid, buildCustomClaims(claimRoleIds, claimsVersion, true));
    const inviteLink = await auth.generatePasswordResetLink(params.email);
    return {
        uid: userRecord.uid,
        employeeId: params.employeeId,
        email: params.email,
        inviteLink,
        createdAuthUser: created,
        claimsVersion,
    };
}
async function inviteEmployeeUser(params) {
    void params.actorUid;
    const db = getFirestore(getOrInitializeApp());
    const auth = getAuth(getOrInitializeApp());
    const employeeSnapshot = await db.collection(USERS_COLLECTIONS.employees).doc(params.employeeId).get();
    if (!employeeSnapshot.exists) {
        throw new Error(`No existe employees/${params.employeeId}.`);
    }
    const employee = employeeSnapshot.data();
    if (!employee.linkedUserId) {
        throw new Error('El empleado todavia no tiene usuario Auth vinculado.');
    }
    const [authUser, userSnapshot] = await Promise.all([
        auth.getUser(employee.linkedUserId),
        db.collection(USERS_COLLECTIONS.users).doc(employee.linkedUserId).get(),
    ]);
    const userDocument = userSnapshot.exists ? userSnapshot.data() : null;
    const email = normalizeEmail(authUser.email ?? userDocument?.email ?? '');
    if (!email) {
        throw new Error('El usuario vinculado no tiene email para enviar invitacion.');
    }
    const inviteLink = await auth.generatePasswordResetLink(email);
    return {
        uid: employee.linkedUserId,
        employeeId: params.employeeId,
        email,
        inviteLink,
    };
}
async function createDefaultAccessForMember(params) {
    const db = getFirestore(getOrInitializeApp());
    const memberRef = db.collection(USERS_COLLECTIONS.members).doc(params.memberId);
    const memberSnapshot = await memberRef.get();
    if (!memberSnapshot.exists) {
        throw new Error(`No existe members/${params.memberId}.`);
    }
    const member = memberSnapshot.data();
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
        const freshMember = freshMemberSnapshot.data();
        if (freshMember.linkedUserId && freshMember.linkedUserId !== authUser.uid) {
            throw new Error('El socio ya esta vinculado a otro usuario.');
        }
        if (identifierSnapshot.exists) {
            const identifier = identifierSnapshot.data();
            if (identifier.uid && identifier.uid !== authUser.uid) {
                throw new Error('Ya existe una cuenta para ese numero de socio.');
            }
        }
        const existingUser = userSnapshot.exists ? userSnapshot.data() : null;
        const mergedRoleIds = Array.from(new Set([...(existingUser?.roleIds ?? []), ...roleIds]));
        claimRoleIds = mergedRoleIds;
        claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;
        transaction.set(userRef, {
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
        }, { merge: true });
        transaction.set(identifierRef, {
            uid: authUser.uid,
            memberId: params.memberId,
            memberNumber: member.memberNumber,
            active: true,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: params.actorUid,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: params.actorUid,
        }, { merge: true });
        transaction.update(memberRef, {
            linkedUserId: authUser.uid,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: params.actorUid,
        });
    });
    await getAuth(getOrInitializeApp()).setCustomUserClaims(authUser.uid, buildCustomClaims(claimRoleIds, claimsVersion, true));
    return {
        uid: authUser.uid,
        memberNumber: normalizedMemberNumber,
        temporaryPassword: generatedPassword.temporaryPassword,
        passwordGeneratedAt: generatedPassword.passwordGeneratedAt,
    };
}
export const usersCreateMember = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
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
        return {
            ...result,
            linkedUserId: accessResult.uid,
            memberNumber: accessResult.memberNumber,
            temporaryPassword: accessResult.temporaryPassword,
            passwordGeneratedAt: accessResult.passwordGeneratedAt,
            mustChangePassword: true,
        };
    }
    catch (error) {
        withCallableLogging('usersCreateMember', error);
    }
});
export const usersGetNextMemberNumber = onCall(async (request) => {
    try {
        ensureStaff(await getActorFromCallableRequest(request.auth));
        const snapshot = await getFirestore(getOrInitializeApp())
            .collection(USERS_COLLECTIONS.members)
            .select('memberNumber')
            .get();
        const memberNumbers = snapshot.docs
            .map((entry) => entry.get('memberNumber'))
            .filter((memberNumber) => typeof memberNumber === 'string');
        return getNextMemberNumberFromExisting(memberNumbers);
    }
    catch (error) {
        withCallableLogging('usersGetNextMemberNumber', error);
    }
});
export const usersUpdateMember = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return updateMemberUseCase({
            actor,
            input: parseUpdateMemberInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersUpdateMember', error);
    }
});
export const usersCreateFamilyGroup = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createFamilyGroupUseCase({
            actor,
            input: parseCreateFamilyGroupInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersCreateFamilyGroup', error);
    }
});
export const usersAddMemberToFamilyGroup = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return addMemberToFamilyGroupUseCase({
            actor,
            input: parseAddMemberToFamilyGroupInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersAddMemberToFamilyGroup', error);
    }
});
export const usersRemoveMemberFromFamilyGroup = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return removeMemberFromFamilyGroupUseCase({
            actor,
            input: parseRemoveMemberFromFamilyGroupInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersRemoveMemberFromFamilyGroup', error);
    }
});
export const usersStartLicense = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return startLicenseUseCase({
            actor,
            input: parseStartLicenseInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersStartLicense', error);
    }
});
export const usersEndLicense = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return endLicenseUseCase({
            actor,
            input: parseEndLicenseInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersEndLicense', error);
    }
});
export const usersCreateEmployee = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createEmployeeUseCase({
            actor,
            input: parseCreateEmployeeInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersCreateEmployee', error);
    }
});
export const usersUpdateEmployee = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return updateEmployeeUseCase({
            actor,
            input: parseUpdateEmployeeInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersUpdateEmployee', error);
    }
});
export const usersLinkEmployeeAuthUser = onCall(async (request) => {
    try {
        const actor = ensureStaff(await getActorFromCallableRequest(request.auth));
        const input = parseLinkEmployeeAuthUserInput(request.data);
        return linkEmployeeAuthUser({
            actorUid: actor.uid,
            employeeId: input.employeeId,
            email: input.email,
            displayName: input.displayName,
        });
    }
    catch (error) {
        withCallableLogging('usersLinkEmployeeAuthUser', error);
    }
});
export const usersInviteEmployeeUser = onCall(async (request) => {
    try {
        const actor = ensureStaff(await getActorFromCallableRequest(request.auth));
        const input = parseInviteEmployeeUserInput(request.data);
        return inviteEmployeeUser({
            actorUid: actor.uid,
            employeeId: input.employeeId,
        });
    }
    catch (error) {
        withCallableLogging('usersInviteEmployeeUser', error);
    }
});
export const usersAssignRole = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return assignRoleUseCase({
            actor,
            input: parseAssignRoleInput(request.data),
            transactions,
            authGateway,
        });
    }
    catch (error) {
        withCallableLogging('usersAssignRole', error);
    }
});
export const usersSyncCustomClaims = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        const data = request.data;
        const uid = typeof data?.uid === 'string' ? data.uid.trim() : '';
        return syncCustomClaimsUseCase({
            actor,
            targetUid: uid,
            transactions,
            authGateway,
        });
    }
    catch (error) {
        withCallableLogging('usersSyncCustomClaims', error);
    }
});
export const usersRecordHandicap = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return recordHandicapUseCase({
            actor,
            input: parseRecordHandicapInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('usersRecordHandicap', error);
    }
});
export const users = {
    getNextMemberNumber: usersGetNextMemberNumber,
    createMember: usersCreateMember,
    updateMember: usersUpdateMember,
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
//# sourceMappingURL=users.callables.js.map