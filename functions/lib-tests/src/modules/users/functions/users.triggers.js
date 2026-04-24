import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { beforeUserSignedIn } from 'firebase-functions/v2/identity';
import { syncUserFromAuthUseCase } from '../application/use-cases/auth.use-cases.js';
import { refreshMemberHandicapSnapshotUseCase } from '../application/use-cases/handicap.use-cases.js';
import { syncClaimsForUserDocument } from '../application/use-cases/auth.use-cases.js';
import { FirebaseAuthGateway } from '../infrastructure/firestore/auth-gateway.js';
import { FirestoreUsersTransactionManager, SystemClock } from '../infrastructure/firestore/repositories.js';
const transactions = new FirestoreUsersTransactionManager(new SystemClock());
const authGateway = new FirebaseAuthGateway();
export const usersBeforeUserSignedIn = beforeUserSignedIn(async (event) => {
    if (!event.data?.uid) {
        return;
    }
    await syncUserFromAuthUseCase(transactions, {
        uid: event.data.uid,
        email: event.data.email,
        displayName: event.data.displayName,
    });
    logger.info('usersBeforeUserSignedIn synced user document', {
        uid: event.data.uid,
    });
    return;
});
export const usersSyncClaimsOnUserWrite = onDocumentWritten('users/{uid}', async (event) => {
    const afterSnapshot = event.data?.after;
    if (!afterSnapshot?.exists) {
        return;
    }
    const beforeData = event.data?.before.exists ? event.data.before.data() : null;
    const afterData = afterSnapshot.data();
    const shouldSyncClaims = beforeData === null ||
        beforeData.active !== afterData.active ||
        beforeData.claimsVersion !== afterData.claimsVersion ||
        JSON.stringify(beforeData.roleIds) !== JSON.stringify(afterData.roleIds);
    if (!shouldSyncClaims) {
        return;
    }
    await syncClaimsForUserDocument({
        uid: event.params.uid,
        user: {
            id: event.params.uid,
            ...afterData,
        },
        authGateway,
    });
    logger.info('usersSyncClaimsOnUserWrite synced custom claims', {
        uid: event.params.uid,
    });
});
export const usersRefreshHandicapSnapshot = onDocumentWritten('handicaps/{handicapId}', async (event) => {
    const memberIds = new Set();
    const beforeData = event.data?.before.exists ? event.data.before.data() : undefined;
    const afterData = event.data?.after.exists ? event.data.after.data() : undefined;
    if (beforeData?.memberId) {
        memberIds.add(beforeData.memberId);
    }
    if (afterData?.memberId) {
        memberIds.add(afterData.memberId);
    }
    await Promise.all(Array.from(memberIds).map((memberId) => refreshMemberHandicapSnapshotUseCase({
        memberId,
        transactions,
    })));
    logger.info('usersRefreshHandicapSnapshot refreshed member handicap snapshot', {
        handicapId: event.params.handicapId,
        memberIds: Array.from(memberIds),
    });
});
//# sourceMappingURL=users.triggers.js.map