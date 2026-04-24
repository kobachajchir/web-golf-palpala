import { DEFAULT_PRIMARY_ROLE_ID, SYSTEM_ACTOR_UID } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { buildCustomClaims, ensureDirectivo } from '../shared.js';
export async function syncUserFromAuthUseCase(transactions, input) {
    return transactions.runInTransaction(async (dataAccess) => dataAccess.users.syncFromAuthUser({
        uid: input.uid,
        email: input.email,
        displayName: input.displayName,
    }));
}
export async function syncCustomClaimsUseCase(params) {
    ensureDirectivo(params.actor);
    const user = await params.transactions.runInTransaction((dataAccess) => getRequiredUser(dataAccess, params.targetUid));
    const claims = buildCustomClaims(user.roleIds, user.claimsVersion, user.active);
    await params.authGateway.setCustomClaims(params.targetUid, claims);
    return claims;
}
export async function syncClaimsForUserDocument(params) {
    const claims = buildCustomClaims(params.user.roleIds, params.user.claimsVersion, params.user.active);
    await params.authGateway.setCustomClaims(params.uid, claims);
}
export async function getRequiredUser(dataAccess, uid) {
    const user = await dataAccess.users.getById(uid);
    assertCondition(user, 'not-found', `No existe users/${uid}.`);
    return user;
}
export function getDefaultPrimaryRoleId() {
    return DEFAULT_PRIMARY_ROLE_ID;
}
export function getSystemActorUid() {
    return SYSTEM_ACTOR_UID;
}
//# sourceMappingURL=auth.use-cases.js.map