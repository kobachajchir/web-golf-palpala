import { DEFAULT_PRIMARY_ROLE_ID, SYSTEM_ACTOR_UID } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, AuthSyncUserInput, CustomClaims, EntityWithId, UserDocument } from '../../domain/models.js';
import type { AuthGateway, UsersDataAccess, UsersTransactionManager } from '../../domain/ports.js';
import { buildCustomClaims, ensureDirectivo } from '../shared.js';

export async function syncUserFromAuthUseCase(
  transactions: UsersTransactionManager,
  input: AuthSyncUserInput,
): Promise<EntityWithId<UserDocument>> {
  return transactions.runInTransaction(async (dataAccess) =>
    dataAccess.users.syncFromAuthUser({
      uid: input.uid,
      email: input.email,
      displayName: input.displayName,
    }),
  );
}

export async function syncCustomClaimsUseCase(params: {
  actor: Actor | null;
  targetUid: string;
  transactions: UsersTransactionManager;
  authGateway: AuthGateway;
}): Promise<CustomClaims> {
  ensureDirectivo(params.actor);

  const user = await params.transactions.runInTransaction((dataAccess) => getRequiredUser(dataAccess, params.targetUid));
  const claims = buildCustomClaims(user.roleIds, user.claimsVersion, user.active);
  await params.authGateway.setCustomClaims(params.targetUid, claims);
  return claims;
}

export async function syncClaimsForUserDocument(params: {
  uid: string;
  user: EntityWithId<UserDocument>;
  authGateway: AuthGateway;
}): Promise<void> {
  const claims = buildCustomClaims(params.user.roleIds, params.user.claimsVersion, params.user.active);
  await params.authGateway.setCustomClaims(params.uid, claims);
}

export async function getRequiredUser(
  dataAccess: UsersDataAccess,
  uid: string,
): Promise<EntityWithId<UserDocument>> {
  const user = await dataAccess.users.getById(uid);
  assertCondition(user, 'not-found', `No existe users/${uid}.`);
  return user;
}

export function getDefaultPrimaryRoleId(): string {
  return DEFAULT_PRIMARY_ROLE_ID;
}

export function getSystemActorUid(): string {
  return SYSTEM_ACTOR_UID;
}
