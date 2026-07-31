import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { assertIsRecord, buildCustomClaims, ensureAuthenticatedActor, ensureDirectivo, parseOptionalBoolean, parseOptionalIsoDate, parseOptionalNullableIsoDate, parseOptionalNullableString, parseOptionalString, parseRequiredString, pickPrimaryRoleId, resolveActor, toHttpsError, } from '../users/application/shared.js';
import { USERS_COLLECTIONS } from '../users/domain/constants.js';
import { assertCondition } from '../users/domain/errors.js';
import { setCustomClaimsPreservingInternalRoles } from '../users/infrastructure/firestore/auth-gateway.js';
import { FirestoreUsersTransactionManager, SystemClock } from '../users/infrastructure/firestore/repositories.js';
const EXECUTIVE_BOARD_TERMS_COLLECTION = 'executive_board_terms';
const EXECUTIVE_BOARD_MEMBERS_COLLECTION = 'executive_board_members';
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
function slugify(value) {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
function parseInteger(value, field) {
    assertCondition(typeof value === 'number' && Number.isInteger(value), 'invalid-argument', `El campo ${field} debe ser entero.`);
    return value;
}
function parseUpsertTermInput(payload) {
    const data = assertIsRecord(payload);
    return {
        termId: parseOptionalString(data, 'termId'),
        label: parseRequiredString(data, 'label'),
        active: parseOptionalBoolean(data, 'active') ?? true,
        startsAt: parseOptionalNullableIsoDate(data, 'startsAt'),
        endsAt: parseOptionalNullableIsoDate(data, 'endsAt'),
    };
}
function parseUpsertBoardMemberInput(payload) {
    const data = assertIsRecord(payload);
    return {
        id: parseOptionalString(data, 'id'),
        termId: parseRequiredString(data, 'termId'),
        uid: parseRequiredString(data, 'uid'),
        memberId: parseRequiredString(data, 'memberId'),
        memberNumber: parseRequiredString(data, 'memberNumber'),
        positionCode: parseRequiredString(data, 'positionCode'),
        positionLabel: parseRequiredString(data, 'positionLabel'),
        fullNameSnapshot: parseRequiredString(data, 'fullNameSnapshot'),
        order: parseInteger(data.order, 'order'),
        active: parseOptionalBoolean(data, 'active') ?? true,
        appointedAt: parseOptionalNullableIsoDate(data, 'appointedAt'),
        endedAt: parseOptionalNullableIsoDate(data, 'endedAt'),
    };
}
function timestampOrNull(value) {
    return value ? Timestamp.fromDate(value) : null;
}
function normalizeRoleIds(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.filter((roleId) => typeof roleId === 'string' && roleId.trim().length > 0)));
}
function userDataFromSnapshot(snapshot) {
    const data = snapshot.data();
    assertCondition(data, 'not-found', `No existe users/${snapshot.id}.`);
    return data;
}
function buildRoleUpdate(params) {
    const currentClaimsVersion = typeof params.user.claimsVersion === 'number' ? params.user.claimsVersion : 0;
    const currentRoleIds = normalizeRoleIds(params.user.roleIds);
    const nextRoleIds = Array.from(new Set(params.roleIds));
    const nextPrimaryRoleId = pickPrimaryRoleId(nextRoleIds);
    const rolesChanged = currentRoleIds.length !== nextRoleIds.length ||
        currentRoleIds.some((roleId) => !nextRoleIds.includes(roleId)) ||
        params.user.primaryRoleId !== nextPrimaryRoleId;
    const nextClaimsVersion = rolesChanged ? currentClaimsVersion + 1 : currentClaimsVersion;
    return {
        payload: rolesChanged
            ? {
                roleIds: nextRoleIds,
                primaryRoleId: nextPrimaryRoleId,
                claimsVersion: nextClaimsVersion,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: params.actorUid,
            }
            : {},
        target: {
            uid: params.uid,
            roleIds: nextRoleIds,
            claimsVersion: nextClaimsVersion,
            active: params.user.active !== false,
        },
    };
}
async function syncClaims(targets) {
    const uniqueTargets = new Map();
    for (const target of targets) {
        uniqueTargets.set(target.uid, target);
    }
    const auth = getAuth(getOrInitializeApp());
    for (const target of uniqueTargets.values()) {
        await setCustomClaimsPreservingInternalRoles(target.uid, buildCustomClaims(target.roleIds, target.claimsVersion, target.active), auth);
    }
}
export const executiveBoardUpsertTerm = onCall(async (request) => {
    try {
        const actor = ensureDirectivo(await getActorFromCallableRequest(request.auth));
        const input = parseUpsertTermInput(request.data);
        const db = getFirestore(getOrInitializeApp());
        const termId = input.termId ?? slugify(input.label);
        const termRef = db.collection(EXECUTIVE_BOARD_TERMS_COLLECTION).doc(termId);
        const snapshot = await termRef.get();
        const payload = {
            label: input.label,
            active: input.active,
            startsAt: timestampOrNull(input.startsAt),
            endsAt: timestampOrNull(input.endsAt),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actor.uid,
        };
        if (snapshot.exists) {
            await termRef.update(payload);
        }
        else {
            await termRef.create({
                ...payload,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: actor.uid,
            });
        }
        return { termId };
    }
    catch (error) {
        logger.error('executiveBoardUpsertTerm failed', error);
        throw toHttpsError(error);
    }
});
export const executiveBoardUpsertBoardMember = onCall(async (request) => {
    try {
        const actor = ensureDirectivo(await getActorFromCallableRequest(request.auth));
        const input = parseUpsertBoardMemberInput(request.data);
        const db = getFirestore(getOrInitializeApp());
        const id = input.id ?? `${input.termId}_${input.positionCode}`;
        const syncTargets = await db.runTransaction(async (transaction) => {
            const memberRef = db.collection(EXECUTIVE_BOARD_MEMBERS_COLLECTION).doc(id);
            const snapshot = await transaction.get(memberRef);
            const previousData = snapshot.exists ? snapshot.data() : null;
            const previousUid = typeof previousData?.uid === 'string' ? previousData.uid : null;
            const previousWasActive = previousData?.active !== false;
            const nextSyncTargets = [];
            const pendingUserUpdates = [];
            if (previousUid && previousUid !== input.uid && previousWasActive) {
                const previousBoardSeats = await transaction.get(db
                    .collection(EXECUTIVE_BOARD_MEMBERS_COLLECTION)
                    .where('uid', '==', previousUid)
                    .where('active', '==', true));
                const hasOtherActiveSeat = previousBoardSeats.docs.some((entry) => entry.id !== id);
                if (!hasOtherActiveSeat) {
                    const previousUserRef = db.collection(USERS_COLLECTIONS.users).doc(previousUid);
                    const previousUserSnapshot = await transaction.get(previousUserRef);
                    if (previousUserSnapshot.exists) {
                        const previousUser = previousUserSnapshot.data();
                        const currentRoles = normalizeRoleIds(previousUser.roleIds);
                        const nextRolesWithoutCommission = currentRoles.filter((roleId) => roleId !== 'comision_directiva');
                        const nextRoles = nextRolesWithoutCommission.length > 0 ? nextRolesWithoutCommission : ['socio'];
                        const roleUpdate = buildRoleUpdate({
                            user: previousUser,
                            uid: previousUid,
                            roleIds: nextRoles,
                            actorUid: actor.uid,
                        });
                        pendingUserUpdates.push({ ref: previousUserRef, payload: roleUpdate.payload });
                        nextSyncTargets.push(roleUpdate.target);
                    }
                }
            }
            const nextUserRef = db.collection(USERS_COLLECTIONS.users).doc(input.uid);
            const nextUserSnapshot = await transaction.get(nextUserRef);
            const nextUser = userDataFromSnapshot(nextUserSnapshot);
            assertCondition(nextUser.active !== false, 'failed-precondition', 'No se puede incorporar un usuario inactivo a la Comisión Directiva.');
            const nextRoles = Array.from(new Set([...normalizeRoleIds(nextUser.roleIds), 'socio', 'comision_directiva']));
            const nextUserRoleUpdate = buildRoleUpdate({
                user: nextUser,
                uid: input.uid,
                roleIds: nextRoles,
                actorUid: actor.uid,
            });
            pendingUserUpdates.push({ ref: nextUserRef, payload: nextUserRoleUpdate.payload });
            nextSyncTargets.push(nextUserRoleUpdate.target);
            const payload = {
                termId: input.termId,
                uid: input.uid,
                memberId: input.memberId,
                memberNumber: input.memberNumber,
                positionCode: input.positionCode,
                positionLabel: input.positionLabel,
                fullNameSnapshot: input.fullNameSnapshot,
                order: input.order,
                active: input.active,
                appointedAt: timestampOrNull(input.appointedAt),
                endedAt: timestampOrNull(input.endedAt),
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: actor.uid,
            };
            for (const update of pendingUserUpdates) {
                if (Object.keys(update.payload).length > 0) {
                    transaction.update(update.ref, update.payload);
                }
            }
            if (snapshot.exists) {
                transaction.update(memberRef, payload);
            }
            else {
                transaction.create(memberRef, {
                    ...payload,
                    createdAt: FieldValue.serverTimestamp(),
                    createdBy: actor.uid,
                });
            }
            return nextSyncTargets;
        });
        await syncClaims(syncTargets);
        return { id };
    }
    catch (error) {
        logger.error('executiveBoardUpsertBoardMember failed', error);
        throw toHttpsError(error);
    }
});
export const executiveBoardListActiveBoard = onCall(async (request) => {
    try {
        ensureAuthenticatedActor(await getActorFromCallableRequest(request.auth));
        const data = request.data ? assertIsRecord(request.data) : {};
        const requestedTermId = parseOptionalNullableString(data, 'termId');
        const db = getFirestore(getOrInitializeApp());
        const termSnapshot = requestedTermId
            ? await db.collection(EXECUTIVE_BOARD_TERMS_COLLECTION).doc(requestedTermId).get()
            : (await db
                .collection(EXECUTIVE_BOARD_TERMS_COLLECTION)
                .where('active', '==', true)
                .limit(1)
                .get()).docs[0];
        if (!termSnapshot?.exists) {
            return { term: null, members: [] };
        }
        const membersSnapshot = await db
            .collection(EXECUTIVE_BOARD_MEMBERS_COLLECTION)
            .where('termId', '==', termSnapshot.id)
            .where('active', '==', true)
            .orderBy('order', 'asc')
            .get();
        return {
            term: { id: termSnapshot.id, ...termSnapshot.data() },
            members: membersSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
        };
    }
    catch (error) {
        logger.error('executiveBoardListActiveBoard failed', error);
        throw toHttpsError(error);
    }
});
export const executiveBoardDeactivateBoardMember = onCall(async (request) => {
    try {
        const actor = ensureDirectivo(await getActorFromCallableRequest(request.auth));
        const data = assertIsRecord(request.data);
        const id = parseRequiredString(data, 'id');
        const endedAt = parseOptionalIsoDate(data, 'endedAt') ?? new Date();
        const db = getFirestore(getOrInitializeApp());
        const syncTargets = await db.runTransaction(async (transaction) => {
            const boardMemberRef = db.collection(EXECUTIVE_BOARD_MEMBERS_COLLECTION).doc(id);
            const boardMemberSnapshot = await transaction.get(boardMemberRef);
            assertCondition(boardMemberSnapshot.exists, 'not-found', `No existe executive_board_members/${id}.`);
            const boardMember = boardMemberSnapshot.data();
            const uid = typeof boardMember?.uid === 'string' ? boardMember.uid : null;
            const nextSyncTargets = [];
            if (uid && boardMember?.active !== false) {
                const activeSeats = await transaction.get(db
                    .collection(EXECUTIVE_BOARD_MEMBERS_COLLECTION)
                    .where('uid', '==', uid)
                    .where('active', '==', true));
                const hasOtherActiveSeat = activeSeats.docs.some((entry) => entry.id !== id);
                if (!hasOtherActiveSeat) {
                    const userRef = db.collection(USERS_COLLECTIONS.users).doc(uid);
                    const userSnapshot = await transaction.get(userRef);
                    if (userSnapshot.exists) {
                        const user = userSnapshot.data();
                        const currentRoles = normalizeRoleIds(user.roleIds);
                        const nextRolesWithoutCommission = currentRoles.filter((roleId) => roleId !== 'comision_directiva');
                        const nextRoles = nextRolesWithoutCommission.length > 0 ? nextRolesWithoutCommission : ['socio'];
                        const roleUpdate = buildRoleUpdate({
                            user,
                            uid,
                            roleIds: nextRoles,
                            actorUid: actor.uid,
                        });
                        if (Object.keys(roleUpdate.payload).length > 0) {
                            transaction.update(userRef, roleUpdate.payload);
                        }
                        nextSyncTargets.push(roleUpdate.target);
                    }
                }
            }
            transaction.update(boardMemberRef, {
                active: false,
                endedAt: Timestamp.fromDate(endedAt),
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: actor.uid,
            });
            return nextSyncTargets;
        });
        await syncClaims(syncTargets);
        return { id };
    }
    catch (error) {
        logger.error('executiveBoardDeactivateBoardMember failed', error);
        throw toHttpsError(error);
    }
});
export const executiveBoard = {
    upsertTerm: executiveBoardUpsertTerm,
    upsertBoardMember: executiveBoardUpsertBoardMember,
    listActiveBoard: executiveBoardListActiveBoard,
    deactivateBoardMember: executiveBoardDeactivateBoardMember,
};
//# sourceMappingURL=executive-board.callables.js.map