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
import { buildCustomClaims, ensureStaff, pickPrimaryRoleId, resolveActor, toHttpsError } from '../application/shared.js';
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
    assignRole: usersAssignRole,
    syncCustomClaims: usersSyncCustomClaims,
    recordHandicap: usersRecordHandicap,
};
//# sourceMappingURL=users.callables.js.map