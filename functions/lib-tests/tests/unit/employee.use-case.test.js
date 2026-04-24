import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../src/modules/users/domain/errors.js';
import { createEmployeeUseCase, parseCreateEmployeeInput, } from '../../src/modules/users/application/use-cases/employee.use-cases.js';
import { createActor, InMemoryUsersTransactionManager, seedUser } from '../helpers/fakes.js';
test('createEmployee rechaza campos salariales porque pertenecen a ACCOUNTING', () => {
    assert.throws(() => parseCreateEmployeeInput({
        firstName: 'Ana',
        lastName: 'Club',
        position: 'Recepcion',
        contractType: 'monthly',
        startDate: '2026-01-01T00:00:00.000Z',
        salaryAmount: 1000000,
    }), (error) => error instanceof AppError && error.code === 'invalid-argument');
});
test('createEmployee nunca persiste monto salarial en employees', async () => {
    const manager = new InMemoryUsersTransactionManager();
    const actor = createActor(seedUser(manager, 'staff-1', { roleIds: ['administrativo'], primaryRoleId: 'administrativo' }), {
        administrativo: true,
    });
    const result = await createEmployeeUseCase({
        actor,
        transactions: manager,
        input: {
            firstName: 'Ana',
            lastName: 'Club',
            position: 'Recepcion',
            contractType: 'monthly',
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            canSubmitExpenses: false,
        },
    });
    const employeeRecord = manager.employees.get(result.employeeId);
    assert.ok(employeeRecord);
    assert.equal('salaryAmount' in (employeeRecord ?? {}), false);
    assert.equal('grossSalary' in (employeeRecord ?? {}), false);
});
//# sourceMappingURL=employee.use-case.test.js.map