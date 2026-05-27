import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { createCashClosureUseCase } from '../../src/modules/accounting/application/use-cases/cash-closure.use-cases.js';
import { createAccountingActor, InMemoryAccountingTransactionManager } from '../helpers/accounting-fakes.js';
function auditFields() {
    const now = Timestamp.fromDate(new Date('2026-05-23T09:00:00.000-03:00'));
    return {
        createdAt: now,
        createdBy: 'admin-1',
        updatedAt: now,
        updatedBy: 'admin-1',
    };
}
function movement(id, patch) {
    const document = {
        movementType: 'income',
        categoryId: 'cuota_societaria',
        categoryCodeSnapshot: 'cuota_societaria',
        status: 'posted',
        operationDate: Timestamp.fromDate(new Date('2026-05-23T12:00:00.000-03:00')),
        accountingPeriod: '2026-05',
        originType: 'manual',
        paymentMethodId: 'cash',
        paymentMethodCodeSnapshot: 'cash',
        grossAmountMinor: 100_000,
        netAmountMinor: 100_000,
        bancarizado: false,
        imputableImpositivo: true,
        registeredByUid: 'admin-1',
        ...auditFields(),
        ...patch,
    };
    return { id, ...document };
}
test('createCashClosure suma saldo inicial y calcula esperado por medio de pago', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    const actor = createAccountingActor('admin-1', ['administrativo']);
    manager.financialMovements.set('cash-income', movement('cash-income', {
        movementType: 'income',
        paymentMethodCodeSnapshot: 'cash',
        netAmountMinor: 120_000,
    }));
    manager.financialMovements.set('cash-expense', movement('cash-expense', {
        movementType: 'expense',
        categoryId: 'insumos',
        categoryCodeSnapshot: 'insumos',
        paymentMethodCodeSnapshot: 'cash',
        grossAmountMinor: 30_000,
        netAmountMinor: 30_000,
    }));
    manager.financialMovements.set('transfer-income', movement('transfer-income', {
        paymentMethodId: 'transfer',
        paymentMethodCodeSnapshot: 'transfer',
        bancarizado: true,
        grossAmountMinor: 50_000,
        netAmountMinor: 50_000,
    }));
    const result = await createCashClosureUseCase({
        actor,
        input: {
            period: '2026-05',
            closureDate: new Date('2026-05-23T20:00:00.000-03:00'),
            openingBalanceMinor: 200_000,
        },
        transactions: manager,
    });
    assert.equal(result.cashExpectedMinor, 290_000);
    assert.equal(result.expectedByPaymentMethod.cash, 290_000);
    assert.equal(result.expectedByPaymentMethod.transfer, 50_000);
    const closure = manager.cashClosures.get(result.cashClosureId);
    assert.equal(closure?.openingBalanceMinor, 200_000);
    assert.equal(closure?.expectedByPaymentMethod?.cash, 290_000);
    assert.equal(closure?.expectedByPaymentMethod?.transfer, 50_000);
    assert.equal(closure?.movementIds.length, 3);
});
//# sourceMappingURL=accounting.cash-closure.use-case.test.js.map