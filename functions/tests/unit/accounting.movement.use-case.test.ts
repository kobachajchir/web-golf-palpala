import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import {
  editFinancialMovementUseCase,
  setFinancialMovementBalanceInclusionUseCase,
  voidFinancialMovementUseCase,
} from '../../src/modules/accounting/application/use-cases/movement.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedIncomeCategory,
  seedPaymentMethod,
} from '../helpers/accounting-fakes.js';

function createAdministrativeActor() {
  return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}

function seedPostedIncome(manager: InMemoryAccountingTransactionManager) {
  const timestamp = Timestamp.fromDate(new Date('2026-07-08T13:00:00.000Z'));
  manager.financialMovements.set('movement-original', {
    id: 'movement-original',
    movementType: 'income',
    categoryId: 'green_fee',
    categoryCodeSnapshot: 'green_fee',
    status: 'posted',
    operationDate: timestamp,
    postingDate: timestamp,
    accountingPeriod: '2026-07',
    originType: 'manual_income',
    originCollection: null,
    originId: null,
    thirdPartyType: 'external',
    thirdPartyId: null,
    paymentMethodId: 'cash',
    paymentMethodCodeSnapshot: 'cash',
    grossAmountMinor: 100_000,
    appliedCommissionPctBps: null,
    appliedCommissionAmountMinor: null,
    netAmountMinor: 100_000,
    bancarizado: false,
    imputableImpositivo: true,
    settlementId: null,
    registeredByUid: 'admin-1',
    approvedByUid: 'admin-1',
    approvedAt: timestamp,
    reversalOfMovementId: null,
    voidReason: null,
    metadata: {
      description: 'Green fee original',
      payerName: 'Persona original',
    },
    notes: 'Nota original',
    createdAt: timestamp,
    createdBy: 'admin-1',
    updatedAt: timestamp,
    updatedBy: 'admin-1',
  });
}

test('administracion puede editar un movimiento y conserva historial auditable', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedIncomeCategory(manager, 'green_fee');
  seedIncomeCategory(manager, 'rental_hall');
  seedPaymentMethod(manager, 'cash', { bancarizado: false });
  seedPaymentMethod(manager, 'transfer_galicia', { bancarizado: true });
  seedPostedIncome(manager);
  const closureAudit = Timestamp.fromDate(new Date('2026-07-08T23:00:00.000Z'));
  manager.cashClosures.set('closure-original-day', {
    id: 'closure-original-day',
    period: '2026-07',
    closureDate: Timestamp.fromDate(new Date('2026-07-08T15:00:00.000Z')),
    openedByUid: 'admin-1',
    openingBalanceMinor: 0,
    closedByUid: 'admin-1',
    closedAt: closureAudit,
    cashExpectedMinor: 100_000,
    expectedByPaymentMethod: { cash: 100_000 },
    cashCountedMinor: 100_000,
    differenceMinor: 0,
    movementIds: ['movement-original'],
    status: 'closed',
    createdAt: closureAudit,
    createdBy: 'admin-1',
    updatedAt: closureAudit,
    updatedBy: 'admin-1',
  });
  manager.cashClosures.set('closure-corrected-day', {
    id: 'closure-corrected-day',
    period: '2026-07',
    closureDate: Timestamp.fromDate(new Date('2026-07-07T15:00:00.000Z')),
    openedByUid: 'admin-1',
    openingBalanceMinor: 0,
    closedByUid: 'admin-1',
    closedAt: closureAudit,
    cashExpectedMinor: 0,
    expectedByPaymentMethod: {},
    cashCountedMinor: 0,
    differenceMinor: 0,
    movementIds: [],
    status: 'closed',
    createdAt: closureAudit,
    createdBy: 'admin-1',
    updatedAt: closureAudit,
    updatedBy: 'admin-1',
  });

  await editFinancialMovementUseCase({
    actor: createAdministrativeActor(),
    input: {
      movementId: 'movement-original',
      categoryId: 'rental_hall',
      paymentMethodId: 'transfer_galicia',
      grossAmountMinor: 150_000,
      operationDate: new Date('2026-07-07T03:00:00.000Z'),
      description: 'Alquiler corregido',
      paymentReference: 'TR-2026-15',
      thirdPartyLabel: 'Pagador corregido',
      notes: 'Movimiento corregido',
      reason: 'Correccion de carga',
    },
    transactions: manager,
  });

  const movement = manager.financialMovements.get('movement-original');
  assert.ok(movement);
  assert.equal(movement.categoryId, 'rental_hall');
  assert.equal(movement.paymentMethodId, 'transfer_galicia');
  assert.equal(movement.grossAmountMinor, 150_000);
  assert.equal(movement.netAmountMinor, 150_000);
  assert.equal(movement.bancarizado, true);
  assert.equal(movement.updatedBy, 'admin-1');
  assert.equal(movement.metadata?.lastEditReason, 'Correccion de carga');
  const editHistory = movement.metadata?.editHistory;
  assert.ok(Array.isArray(editHistory));
  assert.equal((editHistory[0] as { previous?: { grossAmountMinor?: number } }).previous?.grossAmountMinor, 100_000);
  assert.deepEqual(manager.cashClosures.get('closure-original-day')?.movementIds, []);
  assert.equal(manager.cashClosures.get('closure-original-day')?.cashExpectedMinor, 0);
  assert.deepEqual(manager.cashClosures.get('closure-corrected-day')?.movementIds, ['movement-original']);
  assert.equal(manager.cashClosures.get('closure-corrected-day')?.expectedByPaymentMethod?.transfer_galicia, 150_000);
});

test('administracion puede eliminar contablemente un movimiento posteado', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedPostedIncome(manager);

  const result = await voidFinancialMovementUseCase({
    actor: createAdministrativeActor(),
    input: {
      movementId: 'movement-original',
      reason: 'Cobro cargado por error',
    },
    transactions: manager,
  });

  assert.equal(manager.financialMovements.get('movement-original')?.status, 'reversed');
  assert.equal(manager.financialMovements.get('movement-original')?.voidReason, 'Cobro cargado por error');
  assert.ok(result.reversalMovementId);
  const reversal = manager.financialMovements.get(result.reversalMovementId!);
  assert.equal(reversal?.movementType, 'expense');
  assert.equal(reversal?.originType, 'movement_reversal');
  assert.equal(reversal?.grossAmountMinor, 100_000);
});

test('no contar en balance se aplica al original revertido y a su contramovimiento', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedPostedIncome(manager);
  const reversed = await voidFinancialMovementUseCase({
    actor: createAdministrativeActor(),
    input: {
      movementId: 'movement-original',
      reason: 'Cobro cargado por error',
    },
    transactions: manager,
  });
  assert.ok(reversed.reversalMovementId);

  const excluded = await setFinancialMovementBalanceInclusionUseCase({
    actor: createAdministrativeActor(),
    input: {
      movementId: reversed.reversalMovementId!,
      excluded: true,
      reason: 'Carga duplicada por error',
    },
    transactions: manager,
  });

  assert.deepEqual(new Set(excluded.affectedMovementIds), new Set(['movement-original', reversed.reversalMovementId!]));
  const original = manager.financialMovements.get('movement-original');
  const reversal = manager.financialMovements.get(reversed.reversalMovementId!);
  assert.equal(original?.excludeFromBalance, true);
  assert.equal(reversal?.excludeFromBalance, true);
  assert.equal(original?.balanceExclusionReason, 'Carga duplicada por error');
  assert.equal(reversal?.balanceExcludedByUid, 'admin-1');
  assert.ok(Array.isArray(original?.metadata?.balanceInclusionHistory));

  await setFinancialMovementBalanceInclusionUseCase({
    actor: createAdministrativeActor(),
    input: {
      movementId: 'movement-original',
      excluded: false,
      reason: 'Se verifico que debe contarse',
    },
    transactions: manager,
  });
  assert.equal(manager.financialMovements.get('movement-original')?.excludeFromBalance, false);
  assert.equal(manager.financialMovements.get(reversed.reversalMovementId!)?.excludeFromBalance, false);
});
