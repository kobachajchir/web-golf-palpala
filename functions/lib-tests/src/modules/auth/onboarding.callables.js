import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { EXECUTIVE_ACCESS_ROLE_IDS, USERS_COLLECTIONS } from '../users/domain/constants.js';
import { assertCondition } from '../users/domain/errors.js';
import { assertIsRecord, buildCustomClaims, ensureDirectivo, ensureStaff, parseOptionalBoolean, parseRequiredString, parseRequiredStringArray, pickPrimaryRoleId, resolveActor, toHttpsError, } from '../users/application/shared.js';
import { FirestoreUsersTransactionManager, SystemClock } from '../users/infrastructure/firestore/repositories.js';
import { setCustomClaimsPreservingInternalRoles } from '../users/infrastructure/firestore/auth-gateway.js';
import { buildSyntheticAuthEmail, generateMemberTemporaryPassword, normalizeMemberNumber, } from './member-number-auth.js';
import { emitRoleNotification } from '../notifications/notifications.service.js';
const transactions = new FirestoreUsersTransactionManager(new SystemClock());
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
function parseCreateMemberAuthUserInput(payload) {
    const data = assertIsRecord(payload);
    const roleIds = parseRequiredStringArray({ roleIds: data.roleIds ?? ['socio'] }, 'roleIds');
    return {
        memberId: parseRequiredString(data, 'memberId'),
        roleIds: roleIds.length > 0 ? roleIds : ['socio'],
        active: parseOptionalBoolean(data, 'active') ?? true,
    };
}
async function getOrCreateAuthUser(params) {
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
function ensureRoleAssignmentAllowed(actor, roleIds) {
    if (EXECUTIVE_ACCESS_ROLE_IDS.some((roleId) => roleIds.includes(roleId))) {
        return ensureDirectivo(actor);
    }
    return ensureStaff(actor);
}
function ensureAuthUserMutationAllowed(actor, targetUser) {
    if (targetUser && EXECUTIVE_ACCESS_ROLE_IDS.some((roleId) => targetUser.roleIds.includes(roleId))) {
        return ensureDirectivo(actor);
    }
    return ensureStaff(actor);
}
export const authOnboardingCreateMemberAuthUser = onCall(async (request) => {
    try {
        const actor = ensureRoleAssignmentAllowed(await getActorFromCallableRequest(request.auth), Array.isArray(request.data?.roleIds)
            ? (request.data.roleIds)
            : ['socio']);
        const input = parseCreateMemberAuthUserInput(request.data);
        const db = getFirestore(getOrInitializeApp());
        const memberRef = db.collection(USERS_COLLECTIONS.members).doc(input.memberId);
        const memberSnapshot = await memberRef.get();
        assertCondition(memberSnapshot.exists, 'not-found', `No existe members/${input.memberId}.`);
        const member = memberSnapshot.data();
        const normalizedMemberNumber = normalizeMemberNumber(member.memberNumber);
        const email = buildSyntheticAuthEmail(member.memberNumber);
        const displayName = `${member.firstName} ${member.lastName}`.trim() || member.memberNumber;
        const generatedPassword = generateMemberTemporaryPassword(normalizedMemberNumber);
        const authUser = await getOrCreateAuthUser({
            email,
            password: generatedPassword.temporaryPassword,
            displayName,
            active: input.active,
        });
        const userRef = db.collection(USERS_COLLECTIONS.users).doc(authUser.uid);
        const identifierRef = db.collection(USERS_COLLECTIONS.memberLoginIdentifiers).doc(normalizedMemberNumber);
        let claims = null;
        let claimsVersion = 1;
        await db.runTransaction(async (transaction) => {
            const [identifierSnapshot, userSnapshot, freshMemberSnapshot] = await Promise.all([
                transaction.get(identifierRef),
                transaction.get(userRef),
                transaction.get(memberRef),
            ]);
            assertCondition(freshMemberSnapshot.exists, 'not-found', `No existe members/${input.memberId}.`);
            const freshMember = freshMemberSnapshot.data();
            assertCondition(!freshMember.linkedUserId || freshMember.linkedUserId === authUser.uid, 'already-exists', 'El socio ya esta vinculado a otro usuario.');
            if (identifierSnapshot.exists) {
                const identifier = identifierSnapshot.data();
                assertCondition(identifier.uid === authUser.uid || (!identifier.uid && identifier.memberId === input.memberId), 'already-exists', 'Ya existe una cuenta para ese numero de socio.');
                transaction.update(identifierRef, {
                    uid: authUser.uid,
                    memberId: input.memberId,
                    memberNumber: member.memberNumber,
                    active: input.active,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
            else {
                transaction.create(identifierRef, {
                    uid: authUser.uid,
                    memberId: input.memberId,
                    memberNumber: member.memberNumber,
                    active: input.active,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
            const existingUser = userSnapshot.exists ? userSnapshot.data() : null;
            claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;
            const primaryRoleId = pickPrimaryRoleId(input.roleIds);
            const userPayload = {
                email,
                displayName,
                primaryRoleId,
                roleIds: Array.from(new Set(input.roleIds)),
                profileType: 'member',
                profileId: input.memberId,
                active: input.active,
                claimsVersion,
                memberNumber: normalizedMemberNumber,
                authProviderMode: 'member_number_password',
                mustChangePassword: true,
                passwordResetRequiredReason: 'initial_default',
            };
            if (existingUser) {
                transaction.update(userRef, {
                    ...userPayload,
                    updatedAt: FieldValue.serverTimestamp(),
                    updatedBy: actor.uid,
                });
            }
            else {
                transaction.create(userRef, {
                    ...userPayload,
                    createdAt: FieldValue.serverTimestamp(),
                    createdBy: actor.uid,
                    updatedAt: FieldValue.serverTimestamp(),
                    updatedBy: actor.uid,
                });
            }
            transaction.update(memberRef, {
                linkedUserId: authUser.uid,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: actor.uid,
            });
            claims = buildCustomClaims(input.roleIds, claimsVersion, input.active);
        });
        if (!claims) {
            throw new HttpsError('internal', 'No se pudieron construir los custom claims.');
        }
        await setCustomClaimsPreservingInternalRoles(authUser.uid, claims, getAuth(getOrInitializeApp()));
        return {
            uid: authUser.uid,
            memberId: input.memberId,
            memberNumber: normalizedMemberNumber,
            email,
            temporaryPassword: generatedPassword.temporaryPassword,
            passwordGeneratedAt: generatedPassword.passwordGeneratedAt,
            claims,
            claimsVersion,
        };
    }
    catch (error) {
        logger.error('authOnboardingCreateMemberAuthUser failed', error);
        throw toHttpsError(error);
    }
});
export const authOnboardingGetMemberAuthStatus = onCall(async (request) => {
    try {
        ensureStaff(await getActorFromCallableRequest(request.auth));
        const data = assertIsRecord(request.data);
        const memberId = parseRequiredString(data, 'memberId');
        const db = getFirestore(getOrInitializeApp());
        const memberSnapshot = await db.collection(USERS_COLLECTIONS.members).doc(memberId).get();
        assertCondition(memberSnapshot.exists, 'not-found', `No existe members/${memberId}.`);
        const member = memberSnapshot.data();
        const normalizedMemberNumber = normalizeMemberNumber(member.memberNumber);
        const identifierSnapshot = await db.collection(USERS_COLLECTIONS.memberLoginIdentifiers).doc(normalizedMemberNumber).get();
        const identifier = identifierSnapshot.exists
            ? identifierSnapshot.data()
            : null;
        const uid = member.linkedUserId ?? identifier?.uid ?? null;
        const userSnapshot = uid ? await db.collection(USERS_COLLECTIONS.users).doc(uid).get() : null;
        const user = userSnapshot?.exists ? userSnapshot.data() : null;
        let authUser = null;
        if (uid) {
            try {
                authUser = await getAuth(getOrInitializeApp()).getUser(uid);
            }
            catch (error) {
                if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'auth/user-not-found') {
                    throw error;
                }
            }
        }
        return {
            memberId,
            memberNumber: normalizedMemberNumber,
            linkedUserId: uid,
            hasAuthUser: Boolean(authUser),
            authDisabled: authUser?.disabled ?? null,
            hasUserDocument: Boolean(user),
            userActive: user?.active ?? null,
            roleIds: user?.roleIds ?? [],
            claimsVersion: user?.claimsVersion ?? null,
            mustChangePassword: user?.mustChangePassword ?? null,
            lastLoginAt: user?.lastLoginAt ?? null,
            identifierExists: identifierSnapshot.exists,
            identifierActive: identifier?.active ?? null,
        };
    }
    catch (error) {
        logger.error('authOnboardingGetMemberAuthStatus failed', error);
        throw toHttpsError(error);
    }
});
export const authOnboardingResetMemberAuthPassword = onCall(async (request) => {
    try {
        const data = assertIsRecord(request.data);
        const memberId = parseRequiredString(data, 'memberId');
        const db = getFirestore(getOrInitializeApp());
        const memberSnapshot = await db.collection(USERS_COLLECTIONS.members).doc(memberId).get();
        assertCondition(memberSnapshot.exists, 'not-found', `No existe members/${memberId}.`);
        const member = memberSnapshot.data();
        assertCondition(member.linkedUserId, 'failed-precondition', 'El socio todavia no tiene acceso a la app.');
        const normalizedMemberNumber = normalizeMemberNumber(member.memberNumber);
        const generatedPassword = generateMemberTemporaryPassword(normalizedMemberNumber);
        const userSnapshot = await db.collection(USERS_COLLECTIONS.users).doc(member.linkedUserId).get();
        const user = userSnapshot.exists ? userSnapshot.data() : null;
        const actor = ensureAuthUserMutationAllowed(await getActorFromCallableRequest(request.auth), user);
        await getAuth(getOrInitializeApp()).updateUser(member.linkedUserId, {
            password: generatedPassword.temporaryPassword,
            disabled: false,
        });
        const requestRef = db.collection(USERS_COLLECTIONS.passwordResetRequests).doc(normalizedMemberNumber);
        await db.runTransaction(async (transaction) => {
            transaction.update(userSnapshot.ref, {
                active: true,
                mustChangePassword: true,
                passwordResetRequiredReason: 'staff_reset',
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: actor.uid,
            });
            transaction.set(requestRef, {
                memberNumber: member.memberNumber,
                normalizedMemberNumber,
                memberId,
                uid: member.linkedUserId,
                displayName: `${member.firstName} ${member.lastName}`.trim(),
                status: 'completed',
                requestedAt: FieldValue.serverTimestamp(),
                resolvedAt: FieldValue.serverTimestamp(),
                resolvedBy: actor.uid,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: actor.uid,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: actor.uid,
            }, { merge: true });
        });
        return {
            uid: member.linkedUserId,
            memberId,
            memberNumber: normalizedMemberNumber,
            temporaryPassword: generatedPassword.temporaryPassword,
            passwordGeneratedAt: generatedPassword.passwordGeneratedAt,
        };
    }
    catch (error) {
        logger.error('authOnboardingResetMemberAuthPassword failed', error);
        throw toHttpsError(error);
    }
});
export const authOnboardingRequestMemberPasswordReset = onCall(async (request) => {
    try {
        const data = assertIsRecord(request.data);
        const memberNumber = parseRequiredString(data, 'memberNumber');
        const normalizedMemberNumber = normalizeMemberNumber(memberNumber);
        const db = getFirestore(getOrInitializeApp());
        const identifierSnapshot = await db
            .collection(USERS_COLLECTIONS.memberLoginIdentifiers)
            .doc(normalizedMemberNumber)
            .get();
        if (identifierSnapshot.exists) {
            const identifier = identifierSnapshot.data();
            const memberSnapshot = identifier.memberId
                ? await db.collection(USERS_COLLECTIONS.members).doc(identifier.memberId).get()
                : null;
            const member = memberSnapshot?.exists ? memberSnapshot.data() : null;
            const displayName = member ? `${member.firstName} ${member.lastName}`.trim() : null;
            const requestRef = db.collection(USERS_COLLECTIONS.passwordResetRequests).doc(normalizedMemberNumber);
            const previousRequestSnapshot = await requestRef.get();
            const wasAlreadyPending = previousRequestSnapshot.exists && previousRequestSnapshot.get('status') === 'pending';
            await requestRef.set({
                memberNumber: identifier.memberNumber ?? member?.memberNumber ?? memberNumber,
                normalizedMemberNumber,
                memberId: identifier.memberId ?? null,
                uid: identifier.uid ?? null,
                displayName,
                status: 'pending',
                requestedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                createdBy: 'public-password-reset',
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: 'public-password-reset',
            }, { merge: true });
            if (!wasAlreadyPending && identifier.memberId) {
                try {
                    await emitRoleNotification({
                        type: 'password_reset_request',
                        sourceModule: 'users',
                        sourceCollection: USERS_COLLECTIONS.passwordResetRequests,
                        sourceId: normalizedMemberNumber,
                        title: 'Solicitud de contraseña',
                        body: `${displayName ?? `Socio ${identifier.memberNumber ?? memberNumber}`} pidió restablecer su contraseña.`,
                        severity: 'warning',
                        roleIds: ['administrativo', 'directivo'],
                        deliveryScope: 'shared_role_action',
                        route: `/admin/members/${identifier.memberId}`,
                        action: {
                            key: 'users.reset_member_password_request',
                            label: 'Restablecer contraseña',
                            requiresConfirmation: true,
                            route: `/admin/members/${identifier.memberId}`,
                            payload: {
                                memberId: identifier.memberId,
                                requestId: normalizedMemberNumber,
                            },
                        },
                        metadata: {
                            memberId: identifier.memberId,
                            memberNumber: identifier.memberNumber ?? member?.memberNumber ?? memberNumber,
                            normalizedMemberNumber,
                        },
                        actorUid: 'public-password-reset',
                    });
                }
                catch (notificationError) {
                    logger.warn('authOnboardingRequestMemberPasswordReset notification emit failed', notificationError);
                }
            }
        }
        return { ok: true };
    }
    catch (error) {
        logger.error('authOnboardingRequestMemberPasswordReset failed', error);
        throw toHttpsError(error);
    }
});
export const authOnboardingCompleteOwnPasswordChange = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        assertCondition(actor, 'unauthenticated', 'Debes iniciar sesión para confirmar el cambio de contraseña.');
        await getFirestore(getOrInitializeApp()).collection(USERS_COLLECTIONS.users).doc(actor.uid).update({
            mustChangePassword: false,
            passwordResetRequiredReason: null,
            passwordUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actor.uid,
        });
        return { uid: actor.uid };
    }
    catch (error) {
        logger.error('authOnboardingCompleteOwnPasswordChange failed', error);
        throw toHttpsError(error);
    }
});
export const authOnboardingSetMemberAuthAccessActive = onCall(async (request) => {
    try {
        const data = assertIsRecord(request.data);
        const memberId = parseRequiredString(data, 'memberId');
        const active = data.active;
        assertCondition(typeof active === 'boolean', 'invalid-argument', 'El campo active debe ser boolean.');
        const actor = await getActorFromCallableRequest(request.auth);
        const db = getFirestore(getOrInitializeApp());
        const memberRef = db.collection(USERS_COLLECTIONS.members).doc(memberId);
        const memberSnapshot = await memberRef.get();
        assertCondition(memberSnapshot.exists, 'not-found', `No existe members/${memberId}.`);
        const member = memberSnapshot.data();
        assertCondition(member.linkedUserId, 'failed-precondition', 'El socio todavia no tiene acceso a la app.');
        const userRef = db.collection(USERS_COLLECTIONS.users).doc(member.linkedUserId);
        const userSnapshot = await userRef.get();
        assertCondition(userSnapshot.exists, 'not-found', `No existe users/${member.linkedUserId}.`);
        const user = userSnapshot.data();
        const authorizedActor = ensureAuthUserMutationAllowed(actor, user);
        const nextClaimsVersion = (user.claimsVersion ?? 0) + 1;
        const claims = buildCustomClaims(user.roleIds, nextClaimsVersion, active);
        const normalizedMemberNumber = normalizeMemberNumber(member.memberNumber);
        await db.runTransaction(async (transaction) => {
            transaction.update(userRef, {
                active,
                claimsVersion: nextClaimsVersion,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: authorizedActor.uid,
            });
            transaction.update(memberRef, {
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: authorizedActor.uid,
            });
            transaction.set(db.collection(USERS_COLLECTIONS.memberLoginIdentifiers).doc(normalizedMemberNumber), {
                uid: member.linkedUserId,
                memberId,
                memberNumber: member.memberNumber,
                active,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        });
        await getAuth(getOrInitializeApp()).updateUser(member.linkedUserId, { disabled: !active });
        await setCustomClaimsPreservingInternalRoles(member.linkedUserId, claims, getAuth(getOrInitializeApp()));
        return {
            uid: member.linkedUserId,
            memberId,
            active,
            claimsVersion: nextClaimsVersion,
        };
    }
    catch (error) {
        logger.error('authOnboardingSetMemberAuthAccessActive failed', error);
        throw toHttpsError(error);
    }
});
export const authOnboarding = {
    createMemberAuthUser: authOnboardingCreateMemberAuthUser,
    requestMemberPasswordReset: authOnboardingRequestMemberPasswordReset,
    completeOwnPasswordChange: authOnboardingCompleteOwnPasswordChange,
    getMemberAuthStatus: authOnboardingGetMemberAuthStatus,
    resetMemberAuthPassword: authOnboardingResetMemberAuthPassword,
    setMemberAuthAccessActive: authOnboardingSetMemberAuthAccessActive,
};
//# sourceMappingURL=onboarding.callables.js.map