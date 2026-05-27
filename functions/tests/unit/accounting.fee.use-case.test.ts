import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { AppError } from '../../src/modules/accounting/domain/errors.js';
import { generateFeePreviewUseCase } from '../../src/modules/accounting/application/use-cases/fee.use-cases.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedActiveFinancialConfig,
  seedAccountingMember,
} from '../helpers/accounting-fakes.js';

function createAdminActor() {
  return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}

test('cálculo cuota pleno 100%', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-pleno', { typeCodeSnapshot: 'pleno' });

  const result = await generateFeePreviewUseCase({
    actor: createAdminActor(),
    input: { memberId: 'member-pleno', period: '2026-04' },
    transactions: manager,
  });

  assert.equal(result.appliedPctBps, 10_000);
  assert.equal(result.finalAmountMinor, 11_000_000);
});

test('cálculo grupo familiar asociado 50%', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-family', {
    typeCodeSnapshot: 'grupo_familiar_asociado',
    familyGroupId: 'family-1',
  });

  const result = await generateFeePreviewUseCase({
    actor: createAdminActor(),
    input: { memberId: 'member-family', period: '2026-04' },
    transactions: manager,
  });

  assert.equal(result.appliedPctBps, 5_000);
  assert.equal(result.finalAmountMinor, 5_500_000);
});

test('cálculo vitalicio 50%', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-lifetime', { typeCodeSnapshot: 'vitalicio' });

  const result = await generateFeePreviewUseCase({
    actor: createAdminActor(),
    input: { memberId: 'member-lifetime', period: '2026-04' },
    transactions: manager,
  });

  assert.equal(result.appliedPctBps, 5_000);
  assert.equal(result.finalAmountMinor, 5_500_000);
});

test('cálculo menor 30%', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-minor', {
    typeCodeSnapshot: 'menor',
    familyGroupId: 'family-1',
  });

  const result = await generateFeePreviewUseCase({
    actor: createAdminActor(),
    input: { memberId: 'member-minor', period: '2026-04' },
    transactions: manager,
  });

  assert.equal(result.appliedPctBps, 3_000);
  assert.equal(result.finalAmountMinor, 3_300_000);
});

test('cálculo licencia 0%', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-license', {
    typeCodeSnapshot: 'licencia',
    status: 'license',
    licenseStartAt: Timestamp.fromDate(new Date('2026-04-01T00:00:00.000Z')),
    licenseEndAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
  });

  const result = await generateFeePreviewUseCase({
    actor: createAdminActor(),
    input: { memberId: 'member-license', period: '2026-04' },
    transactions: manager,
  });

  assert.equal(result.appliedPctBps, 0);
  assert.equal(result.finalAmountMinor, 0);
});

test('licencia mayor a 6 meses debe fallar', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-license-long', {
    typeCodeSnapshot: 'licencia',
    status: 'license',
    licenseStartAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
    licenseEndAt: Timestamp.fromDate(new Date('2026-08-05T00:00:00.000Z')),
  });

  await assert.rejects(
    () =>
      generateFeePreviewUseCase({
        actor: createAdminActor(),
        input: { memberId: 'member-license-long', period: '2026-04' },
        transactions: manager,
      }),
    (error: unknown) => error instanceof AppError && error.code === 'failed-precondition',
  );
});

test('socio dado de baja no puede generar cuota aunque exista excepcion administrativa', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  seedActiveFinancialConfig(manager);
  seedAccountingMember(manager, 'member-inactive', {
    typeCodeSnapshot: 'pleno',
    status: 'inactive',
  });

  await assert.rejects(
    () =>
      generateFeePreviewUseCase({
        actor: createAdminActor(),
        input: {
          memberId: 'member-inactive',
          period: '2026-04',
          forceAdministrativeExceptionReason: 'Baja administrativa',
        },
        transactions: manager,
      }),
    (error: unknown) => error instanceof AppError && error.code === 'failed-precondition',
  );
});
