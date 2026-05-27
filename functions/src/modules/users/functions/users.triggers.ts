import { logger } from 'firebase-functions';
import { auth as authV1 } from 'firebase-functions/v1';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { syncClaimsForUserDocument, syncUserFromAuthUseCase } from '../application/use-cases/auth.use-cases.js';
import { refreshMemberHandicapSnapshotUseCase } from '../application/use-cases/handicap.use-cases.js';
import { toHttpsError } from '../application/shared.js';
import type { UserDocument } from '../domain/models.js';
import { FirebaseAuthGateway } from '../infrastructure/firestore/auth-gateway.js';
import { FirestoreUsersTransactionManager, SystemClock } from '../infrastructure/firestore/repositories.js';

const transactions = new FirestoreUsersTransactionManager(new SystemClock());
const authGateway = new FirebaseAuthGateway();

async function syncAuthUserAndClaims(input: {
  uid: string;
  email?: string;
  displayName?: string;
}) {
  const user = await syncUserFromAuthUseCase(transactions, input);
  await syncClaimsForUserDocument({
    uid: input.uid,
    user,
    authGateway,
  });

  return user;
}

function createAuthSyncInput(input: {
  uid: string;
  email?: string | undefined;
  displayName?: string | undefined;
}) {
  return {
    uid: input.uid,
    ...(input.email ? { email: input.email } : {}),
    ...(input.displayName ? { displayName: input.displayName } : {}),
  };
}

export const usersOnAuthUserCreated = authV1.user().onCreate(async (user) => {
  await syncAuthUserAndClaims(createAuthSyncInput({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
  }));

  logger.info('usersOnAuthUserCreated synced user document', {
    uid: user.uid,
  });
});

export const usersEnsureCurrentUserProfile = onCall(async (request) => {
  try {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesion para sincronizar el perfil.');
    }

    const user = await syncAuthUserAndClaims(createAuthSyncInput({
      uid: request.auth.uid,
      email: typeof request.auth.token.email === 'string' ? request.auth.token.email : undefined,
      displayName: typeof request.auth.token.name === 'string' ? request.auth.token.name : undefined,
    }));

    logger.info('usersEnsureCurrentUserProfile synced user document', {
      uid: request.auth.uid,
    });

    return {
      uid: user.id,
      active: user.active,
      roleIds: user.roleIds,
      primaryRoleId: user.primaryRoleId,
      profileType: user.profileType,
      profileId: user.profileId ?? null,
      claimsVersion: user.claimsVersion,
    };
  } catch (error) {
    logger.error('usersEnsureCurrentUserProfile failed', error);
    throw toHttpsError(error);
  }
});

export const usersSyncClaimsOnUserWrite = onDocumentWritten('users/{uid}', async (event) => {
  const afterSnapshot = event.data?.after;
  if (!afterSnapshot?.exists) {
    return;
  }

  const beforeData = event.data?.before.exists ? (event.data.before.data() as UserDocument) : null;
  const afterData = afterSnapshot.data() as UserDocument;

  const shouldSyncClaims =
    beforeData === null ||
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
  const memberIds = new Set<string>();
  const beforeData = event.data?.before.exists ? event.data.before.data() as { memberId?: string } : undefined;
  const afterData = event.data?.after.exists ? event.data.after.data() as { memberId?: string } : undefined;

  if (beforeData?.memberId) {
    memberIds.add(beforeData.memberId);
  }

  if (afterData?.memberId) {
    memberIds.add(afterData.memberId);
  }

  await Promise.all(
    Array.from(memberIds).map((memberId) =>
      refreshMemberHandicapSnapshotUseCase({
        memberId,
        transactions,
      }),
    ),
  );

  logger.info('usersRefreshHandicapSnapshot refreshed member handicap snapshot', {
    handicapId: event.params.handicapId,
    memberIds: Array.from(memberIds),
  });
});
