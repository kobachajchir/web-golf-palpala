import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../src/modules/users/domain/errors.js';
import { createFamilyGroupUseCase } from '../../src/modules/users/application/use-cases/family-group.use-cases.js';
import {
  createActor,
  InMemoryUsersTransactionManager,
  seedMember,
  seedMemberType,
  seedUser,
} from '../helpers/fakes.js';

test('createFamilyGroup falla con menos de 2 miembros', async () => {
  const manager = new InMemoryUsersTransactionManager();
  seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
  seedMember(manager, 'member-1', { typeId: 'grupo_familiar_titular', typeCodeSnapshot: 'grupo_familiar_titular' });

  const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
    administrativo: true,
  });

  await assert.rejects(
    () =>
      createFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
          holderMemberId: 'member-1',
          memberIds: ['member-1'],
        },
      }),
    (error: unknown) => error instanceof AppError && error.code === 'failed-precondition',
  );
});

test('createFamilyGroup falla si el holder no está dentro del grupo', async () => {
  const manager = new InMemoryUsersTransactionManager();
  seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
  seedMember(manager, 'member-1', { typeId: 'grupo_familiar_titular', typeCodeSnapshot: 'grupo_familiar_titular' });
  seedMember(manager, 'member-2');
  seedMember(manager, 'member-3');

  const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
    administrativo: true,
  });

  await assert.rejects(
    () =>
      createFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
          holderMemberId: 'member-1',
          memberIds: ['member-2', 'member-3'],
        },
      }),
    (error: unknown) => error instanceof AppError && error.code === 'failed-precondition',
  );
});

test('createFamilyGroup crea el grupo y actualiza a sus miembros cuando cumple las reglas', async () => {
  const manager = new InMemoryUsersTransactionManager();
  seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
  seedMemberType(manager, 'grupo_familiar_asociado', { canBeFamilyHolder: false, requiresFamilyGroup: true });
  seedMember(manager, 'member-1', { typeId: 'grupo_familiar_titular', typeCodeSnapshot: 'grupo_familiar_titular' });
  seedMember(manager, 'member-2', { typeId: 'grupo_familiar_asociado', typeCodeSnapshot: 'grupo_familiar_asociado' });

  const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
    administrativo: true,
  });

  const result = await createFamilyGroupUseCase({
    actor,
    transactions: manager,
    input: {
      holderMemberId: 'member-1',
      memberIds: ['member-1', 'member-2'],
      code: 'GF-001',
    },
  });

  const group = manager.familyGroups.get(result.familyGroupId);
  assert.ok(group);
  assert.deepEqual(group.memberIds, ['member-1', 'member-2']);
  assert.equal(group.holderMemberId, 'member-1');
  assert.equal(manager.members.get('member-1')?.familyGroupId, result.familyGroupId);
  assert.equal(manager.members.get('member-1')?.isFamilyHolder, true);
  assert.equal(manager.members.get('member-2')?.familyGroupId, result.familyGroupId);
});
