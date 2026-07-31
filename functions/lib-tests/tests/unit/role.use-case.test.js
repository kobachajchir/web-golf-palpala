import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../src/modules/users/domain/errors.js';
import { assignRoleUseCase } from '../../src/modules/users/application/use-cases/role.use-cases.js';
import { createActor, FakeAuthGateway, InMemoryUsersTransactionManager, seedRole, seedUser, } from '../helpers/fakes.js';
test('assignRole rechaza a un usuario que no es directivo', async () => {
    const manager = new InMemoryUsersTransactionManager();
    const authGateway = new FakeAuthGateway();
    seedRole(manager, 'administrativo');
    seedRole(manager, 'directivo');
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), { administrativo: true });
    seedUser(manager, 'target-1');
    await assert.rejects(() => assignRoleUseCase({
        actor,
        transactions: manager,
        authGateway,
        input: {
            uid: 'target-1',
            roleIds: ['directivo'],
        },
    }), (error) => error instanceof AppError && error.code === 'permission-denied');
    await assert.rejects(() => assignRoleUseCase({
        actor,
        transactions: manager,
        authGateway,
        input: { uid: 'target-1', roleIds: ['administrativo'] },
    }), (error) => error instanceof AppError && error.code === 'permission-denied');
});
test('assignRole permite a administracion agregar el rol administrativo a un socio', async () => {
    const manager = new InMemoryUsersTransactionManager();
    const authGateway = new FakeAuthGateway();
    seedRole(manager, 'administrativo');
    seedRole(manager, 'socio');
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), { administrativo: true });
    seedUser(manager, 'target-1', {
        roleIds: ['socio'],
        primaryRoleId: 'socio',
        profileType: 'member',
        profileId: 'member-1',
    });
    await assignRoleUseCase({
        actor,
        transactions: manager,
        authGateway,
        input: { uid: 'target-1', roleIds: ['administrativo', 'socio'] },
    });
    assert.deepEqual(manager.users.get('target-1')?.roleIds, ['administrativo', 'socio']);
    assert.equal(authGateway.claimsByUid.get('target-1')?.administrativo, true);
});
test('assignRole impide que administracion quite roles o conceda roles sensibles', async () => {
    const manager = new InMemoryUsersTransactionManager();
    const authGateway = new FakeAuthGateway();
    seedRole(manager, 'administrativo');
    seedRole(manager, 'directivo');
    seedRole(manager, 'socio');
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), { administrativo: true });
    seedUser(manager, 'target-1', {
        roleIds: ['socio'],
        primaryRoleId: 'socio',
        profileType: 'member',
        profileId: 'member-1',
    });
    await assert.rejects(() => assignRoleUseCase({
        actor,
        transactions: manager,
        authGateway,
        input: { uid: 'target-1', roleIds: ['directivo', 'socio'] },
    }), (error) => error instanceof AppError && error.code === 'permission-denied');
    await assert.rejects(() => assignRoleUseCase({
        actor,
        transactions: manager,
        authGateway,
        input: { uid: 'target-1', roleIds: ['administrativo'] },
    }), (error) => error instanceof AppError && error.code === 'permission-denied');
});
test('assignRole permite a un directivo actualizar roles y sincroniza claims', async () => {
    const manager = new InMemoryUsersTransactionManager();
    const authGateway = new FakeAuthGateway();
    seedRole(manager, 'administrativo');
    seedRole(manager, 'directivo');
    seedRole(manager, 'socio');
    const actor = createActor(seedUser(manager, 'director-1', { roleIds: ['directivo'], primaryRoleId: 'directivo' }), { directivo: true });
    seedUser(manager, 'target-1', { roleIds: ['socio'], primaryRoleId: 'socio', claimsVersion: 3 });
    const result = await assignRoleUseCase({
        actor,
        transactions: manager,
        authGateway,
        input: {
            uid: 'target-1',
            roleIds: ['administrativo', 'socio'],
        },
    });
    const user = manager.users.get('target-1');
    const claims = authGateway.claimsByUid.get('target-1');
    assert.equal(result.claimsVersion, 4);
    assert.deepEqual(user?.roleIds, ['administrativo', 'socio']);
    assert.equal(user?.primaryRoleId, 'administrativo');
    assert.equal(claims?.administrativo, true);
    assert.equal(claims?.socio, true);
    assert.equal(claims?.directivo, false);
    assert.equal(claims?.claimsVersion, 4);
});
test('assignRole no permite agregar ni quitar el rol interno desarrollador', async () => {
    const manager = new InMemoryUsersTransactionManager();
    const authGateway = new FakeAuthGateway();
    seedRole(manager, 'directivo');
    seedRole(manager, 'socio');
    const actor = createActor(seedUser(manager, 'director-1', { roleIds: ['directivo'], primaryRoleId: 'directivo' }), { directivo: true });
    seedUser(manager, 'target-1', { roleIds: ['socio'], primaryRoleId: 'socio' });
    seedUser(manager, 'legacy-developer', {
        roleIds: ['socio', 'desarrollador'],
        primaryRoleId: 'socio',
    });
    await assert.rejects(() => assignRoleUseCase({
        actor,
        transactions: manager,
        authGateway,
        input: { uid: 'target-1', roleIds: ['socio', 'desarrollador'] },
    }), (error) => error instanceof AppError && error.code === 'permission-denied');
    await assert.rejects(() => assignRoleUseCase({
        actor,
        transactions: manager,
        authGateway,
        input: { uid: 'legacy-developer', roleIds: ['socio'] },
    }), (error) => error instanceof AppError && error.code === 'permission-denied');
});
//# sourceMappingURL=role.use-case.test.js.map