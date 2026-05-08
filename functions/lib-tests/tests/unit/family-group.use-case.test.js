import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../src/modules/users/domain/errors.js';
import { createFamilyGroupUseCase, removeMemberFromFamilyGroupUseCase, } from '../../src/modules/users/application/use-cases/family-group.use-cases.js';
import { createActor, InMemoryUsersTransactionManager, seedMember, seedMemberType, seedUser, } from '../helpers/fakes.js';
test('createFamilyGroup falla con menos de 2 miembros', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
    seedMember(manager, 'member-1', { typeId: 'grupo_familiar_titular', typeCodeSnapshot: 'grupo_familiar_titular' });
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
        administrativo: true,
    });
    await assert.rejects(() => createFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
            holderMemberId: 'member-1',
            memberIds: ['member-1'],
        },
    }), (error) => error instanceof AppError && error.code === 'failed-precondition');
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
    await assert.rejects(() => createFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
            holderMemberId: 'member-1',
            memberIds: ['member-2', 'member-3'],
        },
    }), (error) => error instanceof AppError && error.code === 'failed-precondition');
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
    assert.equal(manager.members.get('member-1')?.typeId, 'grupo_familiar_titular');
    assert.equal(manager.members.get('member-2')?.familyGroupId, result.familyGroupId);
    assert.equal(manager.members.get('member-2')?.typeId, 'grupo_familiar_asociado');
});
test('removeMemberFromFamilyGroup no permite remover titular sin reemplazo', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
    seedMemberType(manager, 'pleno', { canBeFamilyHolder: true });
    seedMember(manager, 'member-1', {
        typeId: 'grupo_familiar_titular',
        typeCodeSnapshot: 'grupo_familiar_titular',
        familyGroupId: 'family-1',
        isFamilyHolder: true,
    });
    seedMember(manager, 'member-2', { familyGroupId: 'family-1' });
    seedMember(manager, 'member-3', { familyGroupId: 'family-1' });
    manager.familyGroups.set('family-1', {
        id: 'family-1',
        holderMemberId: 'member-1',
        memberIds: ['member-1', 'member-2', 'member-3'],
        active: true,
        createdAt: manager.members.get('member-1').createdAt,
        createdBy: 'system',
        updatedAt: manager.members.get('member-1').updatedAt,
        updatedBy: 'system',
    });
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
        administrativo: true,
    });
    await assert.rejects(() => removeMemberFromFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
            groupId: 'family-1',
            memberId: 'member-1',
        },
    }), (error) => error instanceof AppError && error.code === 'failed-precondition');
});
test('removeMemberFromFamilyGroup reasigna titular cuando se indica reemplazo valido', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
    seedMemberType(manager, 'pleno', { canBeFamilyHolder: true });
    seedMember(manager, 'member-1', {
        typeId: 'grupo_familiar_titular',
        typeCodeSnapshot: 'grupo_familiar_titular',
        familyGroupId: 'family-1',
        isFamilyHolder: true,
    });
    seedMember(manager, 'member-2', { typeId: 'pleno', familyGroupId: 'family-1' });
    seedMember(manager, 'member-3', { typeId: 'pleno', familyGroupId: 'family-1' });
    manager.familyGroups.set('family-1', {
        id: 'family-1',
        holderMemberId: 'member-1',
        memberIds: ['member-1', 'member-2', 'member-3'],
        active: true,
        createdAt: manager.members.get('member-1').createdAt,
        createdBy: 'system',
        updatedAt: manager.members.get('member-1').updatedAt,
        updatedBy: 'system',
    });
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
        administrativo: true,
    });
    await removeMemberFromFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
            groupId: 'family-1',
            memberId: 'member-1',
            replacementHolderMemberId: 'member-2',
        },
    });
    assert.equal(manager.familyGroups.get('family-1')?.holderMemberId, 'member-2');
    assert.deepEqual(manager.familyGroups.get('family-1')?.memberIds, ['member-2', 'member-3']);
    assert.equal(manager.members.get('member-1')?.familyGroupId, undefined);
    assert.equal(manager.members.get('member-1')?.typeId, 'pleno');
    assert.equal(manager.members.get('member-2')?.isFamilyHolder, true);
    assert.equal(manager.members.get('member-2')?.typeId, 'grupo_familiar_titular');
});
test('removeMemberFromFamilyGroup cierra el grupo si queda un solo integrante', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
    seedMemberType(manager, 'grupo_familiar_asociado', { canBeFamilyHolder: false, requiresFamilyGroup: true });
    seedMemberType(manager, 'pleno', { canBeFamilyHolder: true });
    seedMember(manager, 'member-1', {
        typeId: 'grupo_familiar_titular',
        typeCodeSnapshot: 'grupo_familiar_titular',
        familyGroupId: 'family-1',
        isFamilyHolder: true,
    });
    seedMember(manager, 'member-2', {
        typeId: 'grupo_familiar_asociado',
        typeCodeSnapshot: 'grupo_familiar_asociado',
        familyGroupId: 'family-1',
    });
    manager.familyGroups.set('family-1', {
        id: 'family-1',
        holderMemberId: 'member-1',
        memberIds: ['member-1', 'member-2'],
        active: true,
        createdAt: manager.members.get('member-1').createdAt,
        createdBy: 'system',
        updatedAt: manager.members.get('member-1').updatedAt,
        updatedBy: 'system',
    });
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
        administrativo: true,
    });
    await removeMemberFromFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
            groupId: 'family-1',
            memberId: 'member-2',
        },
    });
    assert.equal(manager.familyGroups.get('family-1')?.active, false);
    assert.deepEqual(manager.familyGroups.get('family-1')?.memberIds, ['member-1']);
    assert.equal(manager.members.get('member-1')?.familyGroupId, undefined);
    assert.equal(manager.members.get('member-1')?.isFamilyHolder, false);
    assert.equal(manager.members.get('member-1')?.typeId, 'pleno');
    assert.equal(manager.members.get('member-2')?.familyGroupId, undefined);
    assert.equal(manager.members.get('member-2')?.typeId, 'pleno');
});
test('removeMemberFromFamilyGroup permite que el titular saque un asociado de su grupo', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
    seedMemberType(manager, 'grupo_familiar_asociado', { canBeFamilyHolder: false, requiresFamilyGroup: true });
    seedMemberType(manager, 'pleno', { canBeFamilyHolder: true });
    seedMember(manager, 'member-1', {
        typeId: 'grupo_familiar_titular',
        typeCodeSnapshot: 'grupo_familiar_titular',
        familyGroupId: 'family-1',
        isFamilyHolder: true,
    });
    seedMember(manager, 'member-2', {
        typeId: 'grupo_familiar_asociado',
        typeCodeSnapshot: 'grupo_familiar_asociado',
        familyGroupId: 'family-1',
    });
    manager.familyGroups.set('family-1', {
        id: 'family-1',
        holderMemberId: 'member-1',
        memberIds: ['member-1', 'member-2'],
        active: true,
        createdAt: manager.members.get('member-1').createdAt,
        createdBy: 'system',
        updatedAt: manager.members.get('member-1').updatedAt,
        updatedBy: 'system',
    });
    const actor = createActor(seedUser(manager, 'holder-user', { profileType: 'member', profileId: 'member-1' }), { socio: true });
    await removeMemberFromFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
            groupId: 'family-1',
            memberId: 'member-2',
        },
    });
    assert.equal(manager.familyGroups.get('family-1')?.active, false);
    assert.equal(manager.members.get('member-1')?.typeId, 'pleno');
    assert.equal(manager.members.get('member-2')?.typeId, 'pleno');
});
test('removeMemberFromFamilyGroup permite que un asociado se salga a si mismo', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
    seedMemberType(manager, 'grupo_familiar_asociado', { canBeFamilyHolder: false, requiresFamilyGroup: true });
    seedMemberType(manager, 'pleno', { canBeFamilyHolder: true });
    seedMember(manager, 'member-1', {
        typeId: 'grupo_familiar_titular',
        typeCodeSnapshot: 'grupo_familiar_titular',
        familyGroupId: 'family-1',
        isFamilyHolder: true,
    });
    seedMember(manager, 'member-2', {
        typeId: 'grupo_familiar_asociado',
        typeCodeSnapshot: 'grupo_familiar_asociado',
        familyGroupId: 'family-1',
    });
    manager.familyGroups.set('family-1', {
        id: 'family-1',
        holderMemberId: 'member-1',
        memberIds: ['member-1', 'member-2'],
        active: true,
        createdAt: manager.members.get('member-1').createdAt,
        createdBy: 'system',
        updatedAt: manager.members.get('member-1').updatedAt,
        updatedBy: 'system',
    });
    const actor = createActor(seedUser(manager, 'associate-user', { profileType: 'member', profileId: 'member-2' }), { socio: true });
    await removeMemberFromFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
            groupId: 'family-1',
            memberId: 'member-2',
        },
    });
    assert.equal(manager.familyGroups.get('family-1')?.active, false);
    assert.equal(manager.members.get('member-1')?.typeId, 'pleno');
    assert.equal(manager.members.get('member-2')?.typeId, 'pleno');
});
test('removeMemberFromFamilyGroup rechaza socios ajenos al grupo', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'grupo_familiar_titular', { canBeFamilyHolder: true });
    seedMemberType(manager, 'grupo_familiar_asociado', { canBeFamilyHolder: false, requiresFamilyGroup: true });
    seedMember(manager, 'member-1', {
        typeId: 'grupo_familiar_titular',
        typeCodeSnapshot: 'grupo_familiar_titular',
        familyGroupId: 'family-1',
        isFamilyHolder: true,
    });
    seedMember(manager, 'member-2', {
        typeId: 'grupo_familiar_asociado',
        typeCodeSnapshot: 'grupo_familiar_asociado',
        familyGroupId: 'family-1',
    });
    manager.familyGroups.set('family-1', {
        id: 'family-1',
        holderMemberId: 'member-1',
        memberIds: ['member-1', 'member-2'],
        active: true,
        createdAt: manager.members.get('member-1').createdAt,
        createdBy: 'system',
        updatedAt: manager.members.get('member-1').updatedAt,
        updatedBy: 'system',
    });
    const actor = createActor(seedUser(manager, 'other-user', { profileType: 'member', profileId: 'member-99' }), { socio: true });
    await assert.rejects(() => removeMemberFromFamilyGroupUseCase({
        actor,
        transactions: manager,
        input: {
            groupId: 'family-1',
            memberId: 'member-2',
        },
    }), (error) => error instanceof AppError && error.code === 'permission-denied');
});
//# sourceMappingURL=family-group.use-case.test.js.map