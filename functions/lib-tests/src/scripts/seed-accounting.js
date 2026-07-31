import { Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_FINANCIAL_CONFIG, DEFAULT_FINANCIAL_EXPENSE_CATEGORIES, DEFAULT_FINANCIAL_INCOME_CATEGORIES, DEFAULT_PAYMENT_METHODS, CLIENT_PAYMENT_METHODS, DEPRECATED_PAYMENT_METHOD_IDS, PAYMENT_METHOD_IDS, SYSTEM_ACTOR_UID, } from '../modules/accounting/domain/constants.js';
import { FirestoreAccountingTransactionManager, SystemClock } from '../modules/accounting/infrastructure/firestore/repositories.js';
async function main() {
    const transactions = new FirestoreAccountingTransactionManager(new SystemClock());
    const dataAccess = transactions.getDataAccess();
    for (const method of DEFAULT_PAYMENT_METHODS) {
        await dataAccess.paymentMethods.set(method.id, method.data, SYSTEM_ACTOR_UID);
    }
    for (const method of CLIENT_PAYMENT_METHODS) {
        await dataAccess.paymentMethods.set(method.id, method.data, SYSTEM_ACTOR_UID);
    }
    for (const methodId of DEPRECATED_PAYMENT_METHOD_IDS) {
        const existingMethod = await dataAccess.paymentMethods.getById(methodId);
        if (existingMethod) {
            await dataAccess.paymentMethods.set(methodId, {
                name: existingMethod.name,
                bancarizado: existingMethod.bancarizado,
                specialReportingType: existingMethod.specialReportingType ?? null,
                active: false,
                sortOrder: existingMethod.sortOrder,
            }, SYSTEM_ACTOR_UID);
        }
    }
    for (const category of DEFAULT_FINANCIAL_INCOME_CATEGORIES) {
        await dataAccess.financialIncomeCategories.set(category.id, category.data, SYSTEM_ACTOR_UID);
    }
    for (const category of DEFAULT_FINANCIAL_EXPENSE_CATEGORIES) {
        await dataAccess.financialExpenseCategories.set(category.id, category.data, SYSTEM_ACTOR_UID);
    }
    const activeConfig = await dataAccess.financialConfigs.getActive();
    if (!activeConfig) {
        await dataAccess.financialConfigs.create({
            ...DEFAULT_FINANCIAL_CONFIG,
            effectiveFrom: Timestamp.fromDate(new Date()),
            effectiveTo: null,
        }, SYSTEM_ACTOR_UID);
    }
    else {
        const defaultsChanged = activeConfig.fullMemberFeeMinor !== DEFAULT_FINANCIAL_CONFIG.fullMemberFeeMinor ||
            activeConfig.familyAssociatePctBps !== DEFAULT_FINANCIAL_CONFIG.familyAssociatePctBps ||
            activeConfig.minorPctBps !== DEFAULT_FINANCIAL_CONFIG.minorPctBps ||
            activeConfig.licensePctBps !== DEFAULT_FINANCIAL_CONFIG.licensePctBps;
        if (defaultsChanged) {
            const effectiveFrom = Timestamp.fromDate(new Date());
            const latestConfig = await dataAccess.financialConfigs.getLatestVersion();
            await dataAccess.financialConfigs.update(activeConfig.id, {
                isActive: false,
                effectiveTo: effectiveFrom,
            }, SYSTEM_ACTOR_UID);
            await dataAccess.financialConfigs.create({
                ...DEFAULT_FINANCIAL_CONFIG,
                version: (latestConfig?.version ?? activeConfig.version ?? 0) + 1,
                isActive: true,
                effectiveFrom,
                effectiveTo: null,
                notes: 'Valores base de membresia actualizados por seed.',
            }, SYSTEM_ACTOR_UID);
        }
    }
    const activeCreditRule = await dataAccess.paymentCommissionRules.getActiveByPaymentMethodId(PAYMENT_METHOD_IDS.creditGalicia);
    if (!activeCreditRule) {
        await dataAccess.paymentCommissionRules.create({
            paymentMethodId: PAYMENT_METHOD_IDS.creditGalicia,
            percentageBps: DEFAULT_FINANCIAL_CONFIG.creditCommissionPctBps,
            isActive: true,
            validFrom: Timestamp.fromDate(new Date()),
            validTo: null,
            setByUid: SYSTEM_ACTOR_UID,
            notes: 'Regla inicial de crédito.',
        }, SYSTEM_ACTOR_UID);
    }
    console.log('ACCOUNTING seed completed.');
}
main().catch((error) => {
    console.error('ACCOUNTING seed failed.', error);
    process.exitCode = 1;
});
//# sourceMappingURL=seed-accounting.js.map