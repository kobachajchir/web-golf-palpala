import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUpsertFinancialConfigInput, upsertFinancialConfigUseCase, } from '../../src/modules/accounting/application/use-cases/config.use-cases.js';
import { InMemoryAccountingTransactionManager, createAccountingActor, seedActiveFinancialConfig, } from '../helpers/accounting-fakes.js';
function createAdminActor() {
    return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}
function createDirectivoActor() {
    return createAccountingActor('directivo-1', ['directivo'], { directivo: true });
}
function payloadFromConfig(config, overrides = {}) {
    const payload = {
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
test('administracion puede modificar gasto servidor y cuota societaria', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    const activeConfig = seedActiveFinancialConfig(manager, 'config-active', { serverMonthlyExpenseMinor: 120_000 });
    const result = await upsertFinancialConfigUseCase({
        actor: createAdminActor(),
        input: payloadFromConfig(activeConfig, {
            fullMemberFeeMinor: activeConfig.fullMemberFeeMinor + 10_000,
            serverMonthlyExpenseMinor: 185_000,
        }),
        transactions: manager,
    });
    const nextConfig = manager.financialConfigs.get(result.configId);
    assert.equal(nextConfig?.fullMemberFeeMinor, activeConfig.fullMemberFeeMinor + 10_000);
    assert.equal(nextConfig?.serverMonthlyExpenseMinor, 185_000);
    assert.equal(manager.financialConfigs.get(activeConfig.id)?.isActive, false);
});
test('administracion puede modificar comision de credito en configuracion activa', async () => {
    const manager = new InMemoryAccountingTransactionManager();
    const activeConfig = seedActiveFinancialConfig(manager, 'config-active', { creditCommissionPctBps: 300 });
    const result = await upsertFinancialConfigUseCase({
        actor: createAdminActor(),
        input: payloadFromConfig(activeConfig, { creditCommissionPctBps: 450 }),
        transactions: manager,
    });
    const nextConfig = manager.financialConfigs.get(result.configId);
    assert.equal(nextConfig?.creditCommissionPctBps, 450);
    assert.equal(manager.financialConfigs.get(activeConfig.id)?.isActive, false);
});
test('parser acepta monto de servidor como configuracion contable normal', () => {
    const manager = new InMemoryAccountingTransactionManager();
    const activeConfig = seedActiveFinancialConfig(manager);
    const parsed = parseUpsertFinancialConfigInput(payloadFromConfig(activeConfig, { serverMonthlyExpenseMinor: 185_000 }));
    assert.equal(parsed.serverMonthlyExpenseMinor, 185_000);
});
//# sourceMappingURL=accounting.config.use-case.test.js.map