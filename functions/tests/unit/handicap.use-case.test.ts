import assert from 'node:assert/strict';
import test from 'node:test';
import { recordHandicapUseCase } from '../../src/modules/users/application/use-cases/handicap.use-cases.js';
import {
  createActor,
  InMemoryUsersTransactionManager,
  seedHandicap,
  seedMember,
  seedUser,
} from '../helpers/fakes.js';

test('recordHandicap garantiza un único handicap activo y actualiza el snapshot del socio', async () => {
  const manager = new InMemoryUsersTransactionManager();
  seedMember(manager, 'member-1');
  seedHandicap(manager, 'handicap-old', {
    memberId: 'member-1',
    handicapNumber: 18.4,
    status: 'active',
  });

  const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
    administrativo: true,
  });

  const result = await recordHandicapUseCase({
    actor,
    transactions: manager,
    input: {
      memberId: 'member-1',
      handicapNumber: 12.3,
      validFrom: new Date('2026-02-01T00:00:00.000Z'),
    },
  });

  const activeHandicaps = Array.from(manager.handicaps.values()).filter(
    (handicap) => handicap.memberId === 'member-1' && handicap.status === 'active',
  );

  assert.equal(activeHandicaps.length, 1);
  assert.equal(activeHandicaps[0]?.id, result.handicapId);
  assert.equal(manager.handicaps.get('handicap-old')?.status, 'inactive');
  assert.equal(manager.members.get('member-1')?.currentHandicapNumber, 12.3);
});
