import { Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_CURRENCY, DEFAULT_FINANCIAL_CONFIG, PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureDirectivo, ensureStaff, parseOptionalBoolean, parseOptionalBps, parseOptionalInteger, parseOptionalIsoDate, parseOptionalNullableString, parseRequiredAmountMinor, parseRequiredBps, parseRequiredEnum, parseRequiredInteger, } from '../shared.js';
function isDirectivoActor(actor) {
    return actor.user.roleIds.includes('directivo') && actor.claims.directivo === true;
}
function assertConfigValueUnchanged(field, nextValue, currentValue) {
    assertCondition(Object.is(nextValue, currentValue), 'permission-denied', `Administración solo puede modificar precio base y descuentos por tipo de socio. El campo ${field} requiere Junta Directiva.`);
}
function assertAdministrativeFeeOnlyUpdate(input, activeConfig) {
    assertCondition(activeConfig, 'permission-denied', 'Administración solo puede actualizar cuotas sobre una configuración contable activa.');
    assertConfigValueUnchanged('maxLicenseMonths', input.maxLicenseMonths, activeConfig.maxLicenseMonths);
    assertConfigValueUnchanged('creditCommissionPctBps', input.creditCommissionPctBps ?? DEFAULT_FINANCIAL_CONFIG.creditCommissionPctBps, activeConfig.creditCommissionPctBps);
    assertConfigValueUnchanged('earlyPaymentDiscountPctBps', input.earlyPaymentDiscountPctBps ?? DEFAULT_FINANCIAL_CONFIG.earlyPaymentDiscountPctBps, activeConfig.earlyPaymentDiscountPctBps ?? DEFAULT_FINANCIAL_CONFIG.earlyPaymentDiscountPctBps);
    assertConfigValueUnchanged('earlyPaymentDiscountDayOfMonth', input.earlyPaymentDiscountDayOfMonth ?? DEFAULT_FINANCIAL_CONFIG.earlyPaymentDiscountDayOfMonth, activeConfig.earlyPaymentDiscountDayOfMonth ?? DEFAULT_FINANCIAL_CONFIG.earlyPaymentDiscountDayOfMonth);
    assertConfigValueUnchanged('familyGroupBillingMode', input.familyGroupBillingMode, activeConfig.familyGroupBillingMode);
    assertConfigValueUnchanged('allowStandaloneMinor', input.allowStandaloneMinor, activeConfig.allowStandaloneMinor);
    assertConfigValueUnchanged('membershipChargePersistenceMode', input.membershipChargePersistenceMode, activeConfig.membershipChargePersistenceMode);
    assertConfigValueUnchanged('greenFeeAppliesToMembers', input.greenFeeAppliesToMembers, activeConfig.greenFeeAppliesToMembers);
    assertConfigValueUnchanged('cantineroContractMode', input.cantineroContractMode, activeConfig.cantineroContractMode);
    assertConfigValueUnchanged('advertisingDefaultPeriodicity', input.advertisingDefaultPeriodicity, activeConfig.advertisingDefaultPeriodicity);
    assertConfigValueUnchanged('requireApprovalForExpensePosting', input.requireApprovalForExpensePosting, activeConfig.requireApprovalForExpensePosting);
    assertConfigValueUnchanged('requireApprovalForOvertimePosting', input.requireApprovalForOvertimePosting, activeConfig.requireApprovalForOvertimePosting);
}
export async function upsertFinancialConfigUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const activeConfig = await dataAccess.financialConfigs.getActive();
        const latestConfig = await dataAccess.financialConfigs.getLatestVersion();
        const nextVersion = (latestConfig?.version ?? 0) + 1;
        const effectiveFrom = params.input.effectiveFrom ?? new Date();
        if (!isDirectivoActor(actor)) {
            assertAdministrativeFeeOnlyUpdate(params.input, activeConfig);
        }
        if (activeConfig) {
            await dataAccess.financialConfigs.update(activeConfig.id, {
                isActive: false,
                effectiveTo: Timestamp.fromDate(effectiveFrom),
            }, actor.uid);
        }
        const configId = await dataAccess.financialConfigs.create({
            version: nextVersion,
            isActive: true,
            effectiveFrom: Timestamp.fromDate(effectiveFrom),
            effectiveTo: null,
            currency: DEFAULT_CURRENCY,
            fullMemberFeeMinor: params.input.fullMemberFeeMinor,
            familyAssociatePctBps: params.input.familyAssociatePctBps,
            lifetimePctBps: params.input.lifetimePctBps,
            minorPctBps: params.input.minorPctBps,
            licensePctBps: params.input.licensePctBps,
            maxLicenseMonths: params.input.maxLicenseMonths,
            creditCommissionPctBps: params.input.creditCommissionPctBps ?? DEFAULT_FINANCIAL_CONFIG.creditCommissionPctBps,
            earlyPaymentDiscountPctBps: params.input.earlyPaymentDiscountPctBps ?? DEFAULT_FINANCIAL_CONFIG.earlyPaymentDiscountPctBps,
            earlyPaymentDiscountDayOfMonth: params.input.earlyPaymentDiscountDayOfMonth ?? DEFAULT_FINANCIAL_CONFIG.earlyPaymentDiscountDayOfMonth,
            familyGroupBillingMode: params.input.familyGroupBillingMode,
            allowStandaloneMinor: params.input.allowStandaloneMinor,
            membershipChargePersistenceMode: params.input.membershipChargePersistenceMode,
            greenFeeAppliesToMembers: params.input.greenFeeAppliesToMembers,
            cantineroContractMode: params.input.cantineroContractMode,
            advertisingDefaultPeriodicity: params.input.advertisingDefaultPeriodicity,
            requireApprovalForExpensePosting: params.input.requireApprovalForExpensePosting,
            requireApprovalForOvertimePosting: params.input.requireApprovalForOvertimePosting,
            notes: params.input.notes ?? null,
        }, actor.uid);
        return { configId, version: nextVersion };
    });
}
export async function setCreditCommissionRuleUseCase(params) {
    const actor = ensureDirectivo(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const paymentMethod = await dataAccess.paymentMethods.getById(PAYMENT_METHOD_IDS.credit);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${PAYMENT_METHOD_IDS.credit}.`);
        const previousRule = await dataAccess.paymentCommissionRules.getActiveByPaymentMethodId(PAYMENT_METHOD_IDS.credit);
        const validFrom = params.input.validFrom ?? new Date();
        if (previousRule) {
            await dataAccess.paymentCommissionRules.update(previousRule.id, {
                isActive: false,
                validTo: Timestamp.fromDate(validFrom),
            }, actor.uid);
        }
        const ruleId = await dataAccess.paymentCommissionRules.create({
            paymentMethodId: PAYMENT_METHOD_IDS.credit,
            percentageBps: params.input.percentageBps,
            isActive: true,
            validFrom: Timestamp.fromDate(validFrom),
            validTo: null,
            setByUid: actor.uid,
            notes: params.input.notes ?? null,
        }, actor.uid);
        return {
            ruleId,
            percentageBps: params.input.percentageBps,
        };
    });
}
export function parseUpsertFinancialConfigInput(payload) {
    const data = assertIsRecord(payload);
    return {
        effectiveFrom: parseOptionalIsoDate(data, 'effectiveFrom'),
        fullMemberFeeMinor: parseRequiredAmountMinor(data, 'fullMemberFeeMinor'),
        familyAssociatePctBps: parseRequiredBps(data, 'familyAssociatePctBps'),
        lifetimePctBps: parseRequiredBps(data, 'lifetimePctBps'),
        minorPctBps: parseRequiredBps(data, 'minorPctBps'),
        licensePctBps: parseRequiredBps(data, 'licensePctBps'),
        maxLicenseMonths: parseRequiredInteger(data, 'maxLicenseMonths'),
        creditCommissionPctBps: parseOptionalBps(data, 'creditCommissionPctBps'),
        earlyPaymentDiscountPctBps: parseOptionalBps(data, 'earlyPaymentDiscountPctBps'),
        earlyPaymentDiscountDayOfMonth: parseOptionalInteger(data, 'earlyPaymentDiscountDayOfMonth'),
        familyGroupBillingMode: parseRequiredEnum(data, 'familyGroupBillingMode', ['per_member', 'single_group_charge']),
        allowStandaloneMinor: parseOptionalBoolean(data, 'allowStandaloneMinor') ?? DEFAULT_FINANCIAL_CONFIG.allowStandaloneMinor,
        membershipChargePersistenceMode: parseRequiredEnum(data, 'membershipChargePersistenceMode', ['member_fee_charges']),
        greenFeeAppliesToMembers: parseOptionalBoolean(data, 'greenFeeAppliesToMembers') ?? DEFAULT_FINANCIAL_CONFIG.greenFeeAppliesToMembers,
        cantineroContractMode: parseRequiredEnum(data, 'cantineroContractMode', ['fixed_monthly', 'fixed_plus_variable']),
        advertisingDefaultPeriodicity: parseRequiredEnum(data, 'advertisingDefaultPeriodicity', ['monthly', 'one_time']),
        requireApprovalForExpensePosting: parseOptionalBoolean(data, 'requireApprovalForExpensePosting') ?? DEFAULT_FINANCIAL_CONFIG.requireApprovalForExpensePosting,
        requireApprovalForOvertimePosting: parseOptionalBoolean(data, 'requireApprovalForOvertimePosting') ?? DEFAULT_FINANCIAL_CONFIG.requireApprovalForOvertimePosting,
        notes: parseOptionalNullableString(data, 'notes'),
    };
}
export function parseSetCreditCommissionRuleInput(payload) {
    const data = assertIsRecord(payload);
    return {
        percentageBps: parseRequiredBps(data, 'percentageBps'),
        validFrom: parseOptionalIsoDate(data, 'validFrom'),
        notes: parseOptionalNullableString(data, 'notes'),
    };
}
//# sourceMappingURL=config.use-cases.js.map