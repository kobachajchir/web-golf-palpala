import { assertCondition } from '../../domain/errors.js';
import type { Actor, CustomClaims } from '../../domain/models.js';
import type { AuthGateway, UsersTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  buildCustomClaims,
  ensureDirectivo,
  parseRequiredString,
  parseRequiredStringArray,
  pickPrimaryRoleId,
} from '../shared.js';
import { getRequiredUser } from './auth.use-cases.js';

export interface AssignRoleInput {
  uid: string;
  roleIds: string[];
}

export async function assignRoleUseCase(params: {
  actor: Actor | null;
  input: AssignRoleInput;
  transactions: UsersTransactionManager;
  authGateway: AuthGateway;
}): Promise<{ uid: string; claims: CustomClaims; claimsVersion: number }> {
  const actor = ensureDirectivo(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const targetUser = await getRequiredUser(dataAccess, params.input.uid);
    const roles = await dataAccess.roles.getByIds(params.input.roleIds);
    assertCondition(roles.length === Array.from(new Set(params.input.roleIds)).length, 'not-found', 'Uno o más roles no existen.');

    for (const role of roles) {
      assertCondition(role.active, 'failed-precondition', `El rol ${role.id} está inactivo.`);
    }

    const primaryRoleId = pickPrimaryRoleId(params.input.roleIds);
    const nextClaimsVersion = targetUser.claimsVersion + 1;

    await dataAccess.users.assignRoles({
      uid: params.input.uid,
      roleIds: params.input.roleIds,
      primaryRoleId,
      nextClaimsVersion,
      actorUid: actor.uid,
    });

    const claims = buildCustomClaims(params.input.roleIds, nextClaimsVersion, targetUser.active);
    await params.authGateway.setCustomClaims(params.input.uid, claims);

    return {
      uid: params.input.uid,
      claims,
      claimsVersion: nextClaimsVersion,
    };
  });
}

export function parseAssignRoleInput(payload: unknown): AssignRoleInput {
  const data = assertIsRecord(payload);

  return {
    uid: parseRequiredString(data, 'uid'),
    roleIds: parseRequiredStringArray(data, 'roleIds'),
  };
}
