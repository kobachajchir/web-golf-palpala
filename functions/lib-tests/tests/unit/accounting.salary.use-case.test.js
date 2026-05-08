import assert from 'node:assert/strict';
import test from 'node:test';
import { FINANCIAL_EXPENSE_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../src/modules/accounting/domain/constants.js';
import { postSalaryPaymentUseCase, upsertSalaryConfigurationUseCase } from '../../src/modules/accounting/application/use-cases/salary.use-cases.js';
import { InMemoryAccountingTransactionManager, createAccountingActor, seedAccountingEmployee, seedActiveFinancialConfig, seedExpenseCategory, seedPaymentMethod, } from '../helpers/accounting-fakes.js';
function createDirectivoActor() {
    return createAccountingActor('board-1', ['directivo'], { directivo: true });
}
test('horas extra = bancarizado false e imputableImpositivo false', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingEmployee(manager, 'employee-1');
    seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.sueldo);
    seedExpenseCategory(manager, FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra, {
        defaultBancarizado: false,
        defaultImputableImpositivo: false,
    });
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.transfer, { bancarizado: true });
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });
    const actor = createDirectivoActor();
    const salaryConfiguration = await upsertSalaryConfigurationUseCase({
        actor,
        input: {
            employeeId: 'employee-1',
            contractType: 'monthly',
            baseAmountMinor: 25_000_000,
            periodicity: 'monthly',
            effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
            allowOvertime: true,
        },
        transactions: manager,
    });
    const result = await postSalaryPaymentUseCase({
        actor,
        input: {
            employeeId: 'employee-1',
            period: '2026-04',
            salaryConfigurationId: salaryConfiguration.salaryConfigurationId,
            salaryGrossMinor: 25_000_000,
            bankedAmountMinor: 25_000_000,
            nonBankedAmountMinor: 0,
            overtimeHours: 4,
            overtimeAmountMinor: 1_200_000,
        },
        transactions: manager,
    });
    const movements = result.financialMovementIds.map((movementId) => manager.financialMovements.get(movementId));
    const overtimeMovement = movements.find((movement) => movement?.categoryCodeSnapshot === FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra);
    assert.ok(overtimeMovement);
    assert.equal(overtimeMovement?.bancarizado, false);
    assert.equal(overtimeMovement?.imputableImpositivo, false);
});
//# sourceMappingURL=accounting.salary.use-case.test.js.map