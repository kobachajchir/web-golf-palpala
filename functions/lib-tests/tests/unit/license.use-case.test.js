import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../src/modules/users/domain/errors.js';
import { startLicenseUseCase } from '../../src/modules/users/application/use-cases/member.use-cases.js';
import { createActor, InMemoryUsersTransactionManager, seedMember, seedUser } from '../helpers/fakes.js';
test('startLicense falla si la licencia supera 6 meses', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMember(manager, 'member-1');
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
        administrativo: true,
    });
    await assert.rejects(() => startLicenseUseCase({
        actor,
        transactions: manager,
        input: {
            memberId: 'member-1',
            startAt: new Date('2026-01-01T00:00:00.000Z'),
            endAt: new Date('2026-08-01T00:00:00.000Z'),
        },
    }), (error) => error instanceof AppError && error.code === 'failed-precondition');
});
test('startLicense actualiza estado y rango cuando la licencia es válida', async () => {
    const manager = new InMemoryUsersTransactionManager();
    seedMember(manager, 'member-1');
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
        administrativo: true,
    });
    await startLicenseUseCase({
        actor,
        transactions: manager,
        input: {
            memberId: 'member-1',
            startAt: new Date('2026-01-01T00:00:00.000Z'),
            endAt: new Date('2026-06-30T00:00:00.000Z'),
        },
    });
    const member = manager.members.get('member-1');
    assert.equal(member?.status, 'license');
    assert.equal(member?.licenseStartAt?.toDate().toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(member?.licenseEndAt?.toDate().toISOString(), '2026-06-30T00:00:00.000Z');
});
//# sourceMappingURL=license.use-case.test.js.map