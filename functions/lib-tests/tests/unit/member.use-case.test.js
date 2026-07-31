import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../../src/modules/users/domain/errors.js';
import { createMemberUseCase, updateOwnMemberDniUseCase, updateMemberUseCase, } from '../../src/modules/users/application/use-cases/member.use-cases.js';
import { createActor, InMemoryUsersTransactionManager, seedMember, seedMemberType, seedUser, } from '../helpers/fakes.js';
function createStaffActor(manager) {
    return createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
        administrativo: true,
    });
}
test('createMember reserva memberNumber normalizado y rechaza duplicados', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'pleno');
    const actor = createStaffActor(manager);
    await createMemberUseCase({
        actor,
        transactions: manager,
        input: {
            memberNumber: '123',
            firstName: 'Ana',
            lastName: 'Club',
            typeId: 'pleno',
            joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
    });
    assert.equal(manager.memberLoginIdentifiers.get('000123')?.active, true);
    await assert.rejects(() => createMemberUseCase({
        actor,
        transactions: manager,
        input: {
            memberNumber: '000123',
            firstName: 'Otra',
            lastName: 'Persona',
            typeId: 'pleno',
            joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
    }), (error) => error instanceof AppError && error.code === 'already-exists');
});
test('updateMember impide cambiar memberNumber una vez creado', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'pleno');
    seedMember(manager, 'member-1', {
        memberNumber: '000123',
        linkedUserId: 'user-1',
        joinedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
    });
    manager.memberLoginIdentifiers.set('000123', {
        id: '000123',
        uid: 'user-1',
        memberId: 'member-1',
        memberNumber: '000123',
        active: true,
        createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
        createdBy: 'system',
        updatedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
        updatedBy: 'system',
    });
    const actor = createStaffActor(manager);
    await assert.rejects(() => updateMemberUseCase({
        actor,
        transactions: manager,
        input: {
            memberId: 'member-1',
            memberNumber: '000124',
        },
    }), (error) => error instanceof AppError && error.code === 'failed-precondition');
});
test('updateMember impide cambiar memberNumber aunque no tenga acceso app', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMemberType(manager, 'pleno');
    seedMember(manager, 'member-1', {
        memberNumber: '000123',
        joinedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
    });
    const actor = createStaffActor(manager);
    await assert.rejects(() => updateMemberUseCase({
        actor,
        transactions: manager,
        input: {
            memberId: 'member-1',
            memberNumber: '000124',
        },
    }), (error) => error instanceof AppError && error.code === 'failed-precondition');
});
test('updateOwnMemberDni permite al socio modificar unicamente el DNI de su ficha vinculada', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMember(manager, 'member-1', { linkedUserId: 'member-user', dni: '11111111' });
    const actor = createActor(seedUser(manager, 'member-user', {
        profileType: 'member',
        profileId: 'member-1',
        roleIds: ['socio'],
        primaryRoleId: 'socio',
    }));
    const result = await updateOwnMemberDniUseCase({
        actor,
        transactions: manager,
        input: { dni: '22.222.222' },
    });
    assert.deepEqual(result, { memberId: 'member-1', dni: '22222222' });
    assert.equal(manager.members.get('member-1')?.dni, '22222222');
    assert.equal(manager.members.get('member-1')?.firstName, 'Nombre');
});
test('updateOwnMemberDni rechaza una ficha que pertenece a otro usuario', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMember(manager, 'member-1', { linkedUserId: 'other-user' });
    const actor = createActor(seedUser(manager, 'member-user', {
        profileType: 'member',
        profileId: 'member-1',
        roleIds: ['socio'],
        primaryRoleId: 'socio',
    }));
    await assert.rejects(() => updateOwnMemberDniUseCase({
        actor,
        transactions: manager,
        input: { dni: '22222222' },
    }), (error) => error instanceof AppError && error.code === 'permission-denied');
});
//# sourceMappingURL=member.use-case.test.js.map