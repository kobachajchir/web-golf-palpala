import { INTERNAL_ROLE_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, CustomClaims } from '../../domain/models.js';
import type { AuthGateway, UsersTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  buildCustomClaims,
  ensureStaff,
  hasExecutiveAccess,
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
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const targetUser = await getRequiredUser(dataAccess, params.input.uid);
    const currentRoleIds = new Set(targetUser.roleIds);
    const nextRoleIds = new Set(params.input.roleIds);
    for (const internalRoleId of INTERNAL_ROLE_IDS) {
      assertCondition(
        currentRoleIds.has(internalRoleId) === nextRoleIds.has(internalRoleId),
        'permission-denied',
        'Los roles internos del sistema no se pueden agregar ni quitar desde administracion.',
      );
    }

    const actorHasExecutiveAccess = hasExecutiveAccess(actor);
    if (!actorHasExecutiveAccess) {
      const addedRoleIds = params.input.roleIds.filter((roleId) => !currentRoleIds.has(roleId));
      const removedRoleIds = targetUser.roleIds.filter((roleId) => !nextRoleIds.has(roleId));

      assertCondition(
        targetUser.profileType === 'member',
        'permission-denied',
        'Administracion solo puede conceder acceso administrativo a perfiles de socios.',
      );
      assertCondition(
        removedRoleIds.length === 0,
        'permission-denied',
        'Administracion no puede quitar roles.',
      );
      assertCondition(
        addedRoleIds.length > 0 && addedRoleIds.every((roleId) => roleId === 'administrativo'),
        'permission-denied',
        'Administracion solo puede agregar el rol Administrativo.',
      );
    }
    const assignableRoleIds = params.input.roleIds.filter(
      (roleId) => !(INTERNAL_ROLE_IDS as readonly string[]).includes(roleId),
    );
    const roles = await dataAccess.roles.getByIds(assignableRoleIds);
    assertCondition(roles.length === Array.from(new Set(assignableRoleIds)).length, 'not-found', 'Uno o mas roles no existen.');

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
