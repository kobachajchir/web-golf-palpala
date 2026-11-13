import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { createCashClosureUseCase, closeCashClosureUseCase } from '../../src/modules/accounting/application/use-cases/cash-closure.use-cases.js';
import type { FinancialMovementDocument } from '../../src/modules/accounting/domain/models.js';
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

function movement(id: string, patch: Partial<FinancialMovementDocument>) {
  const document: FinancialMovementDocument = {
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


test('el cierre recorre mas de 100 movimientos y excluye el plan principal', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  for (let index = 0; index < 225; index++) manager.financialMovements.set(`income-${String(index).padStart(3, '0')}`, movement(`income-${index}`, { netAmountMinor: 10050, grossAmountMinor: 10050 }));
  manager.financialMovements.set('plan', movement('plan', { installmentRole: 'charge', netAmountMinor: 999999 }));
  const result = await createCashClosureUseCase({ actor: createAccountingActor('admin-1', ['administrativo']), input: { period: '2026-05', closureDate: new Date('2026-05-23T20:00:00-03:00'), openingBalanceMinor: 0 }, transactions: manager });
  assert.equal(result.cashExpectedMinor, 225 * 10050);
  assert.equal(result.movementCount, 225);
});


test('cerrar la jornada recalcula movimientos posteriores a su apertura sin cortar paginas', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  const actor = createAccountingActor('admin-1', ['administrativo']);
  const opening = await createCashClosureUseCase({ actor, input: { period: '2026-05', closureDate: new Date('2026-05-23T09:00:00-03:00'), openingBalanceMinor: 5000 }, transactions: manager });
  for (let index = 0; index < 225; index++) manager.financialMovements.set(`after-${String(index).padStart(3, '0')}`, movement(`after-${index}`, { netAmountMinor: 10050 }));
  const result = await closeCashClosureUseCase({ actor, input: { cashClosureId: opening.cashClosureId, cashCountedMinor: 225 * 10050 + 5000 }, transactions: manager });
  assert.equal(result.differenceMinor, 0);
  assert.equal(manager.cashClosures.get(opening.cashClosureId)?.movementIds.length, 225);
  assert.equal(manager.cashClosures.get(opening.cashClosureId)?.cashExpectedMinor, 225 * 10050 + 5000);
});
