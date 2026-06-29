import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseUpsertFinancialConfigInput,
  upsertFinancialConfigUseCase,
  type UpsertFinancialConfigInput,
} from '../../src/modules/accounting/application/use-cases/config.use-cases.js';
import type { EntityWithId, FinancialConfigDocument } from '../../src/modules/accounting/domain/models.js';
import {
  InMemoryAccountingTransactionManager,
  createAccountingActor,
  seedActiveFinancialConfig,
} from '../helpers/accounting-fakes.js';

function createAdminActor() {
  return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}

function createDirectivoActor() {
  return createAccountingActor('directivo-1', ['directivo'], { directivo: true });
}

function payloadFromConfig(
  config: EntityWithId<FinancialConfigDocument>,
  overrides: Partial<UpsertFinancialConfigInput> = {},
): UpsertFinancialConfigInput {
  const payload: UpsertFinancialConfigInput = {
    fullMemberFeeMinor: config.fullMemberFeeMinor,
    familyAssociatePctBps: config.familyAssociatePctBps,
    lifetimePctBps: config.lifetimePctBps,
    minorPctBps: config.minorPctBps,
    licensePctBps: config.licensePctBps,
    maxLicenseMonths: config.maxLicenseMonths,
    creditCommissionPctBps: config.creditCommissionPctBps,
    familyGroupBillingMode: config.familyGroupBillingMode,
    allowStandaloneMinor: config.allowStandaloneMinor,
    membershipChargePersistenceMode: config.membershipChargePersistenceMode,
    greenFeeAppliesToMembers: config.greenFeeAppliesToMembers,
    cantineroContractMode: config.cantineroContractMode,
    advertisingDefaultPeriodicity: config.advertisingDefaultPeriodicity,
    requireApprovalForExpensePosting: config.requireApprovalForExpensePosting,
    requireApprovalForOvertimePosting: config.requireApprovalForOvertimePosting,
    serverMonthlyExpenseMinor: config.serverMonthlyExpenseMinor ?? 0,
    ...overrides,
  };

  if (config.earlyPaymentDiscountPctBps !== undefined && config.earlyPaymentDiscountPctBps !== null) {
    payload.earlyPaymentDiscountPctBps = config.earlyPaymentDiscountPctBps;
  }
  if (config.earlyPaymentDiscountDayOfMonth !== undefined && config.earlyPaymentDiscountDayOfMonth !== null) {
    payload.earlyPaymentDiscountDayOfMonth = config.earlyPaymentDiscountDayOfMonth;
  }

  return payload;
}

test('directivo puede configurar gasto fijo mensual servidor', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  const activeConfig = seedActiveFinancialConfig(manager, 'config-active', { serverMonthlyExpenseMinor: 120_000 });

  const result = await upsertFinancialConfigUseCase({
    actor: createDirectivoActor(),
    input: payloadFromConfig(activeConfig, { serverMonthlyExpenseMinor: 185_000 }),
    transactions: manager,
  });

  const nextConfig = manager.financialConfigs.get(result.configId);
  assert.equal(nextConfig?.serverMonthlyExpenseMinor, 185_000);
  assert.equal(manager.financialConfigs.get(activeConfig.id)?.isActive, false);
});

test('administracion no puede modificar gasto servidor', async () => {
  const manager = new InMemoryAccountingTransactionManager();
  const activeConfig = seedActiveFinancialConfig(manager, 'config-active', { serverMonthlyExpenseMinor: 120_000 });

  await assert.rejects(
    () =>
      upsertFinancialConfigUseCase({
        actor: createAdminActor(),
        input: payloadFromConfig(activeConfig, {
          fullMemberFeeMinor: activeConfig.fullMemberFeeMinor + 10_000,
          serverMonthlyExpenseMinor: 185_000,
        }),
        transactions: manager,
      }),
    /serverMonthlyExpenseMinor/i,
  );
});

test('parser acepta monto de servidor como configuracion contable normal', () => {
  const manager = new InMemoryAccountingTransactionManager();
  const activeConfig = seedActiveFinancialConfig(manager);
  const parsed = parseUpsertFinancialConfigInput(payloadFromConfig(activeConfig, { serverMonthlyExpenseMinor: 185_000 }));

  assert.equal(parsed.serverMonthlyExpenseMinor, 185_000);
});
