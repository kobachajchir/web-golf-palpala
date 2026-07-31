import { Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_CURRENCY, DEFAULT_FINANCIAL_CONFIG, PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureStaff, hasExecutiveAccess, parseOptionalAmountMinor, parseOptionalBoolean, parseOptionalBps, parseOptionalInteger, parseOptionalIsoDate, parseOptionalNullableString, parseOptionalStringArray, parseRequiredAmountMinor, parseRequiredBps, parseRequiredEnum, parseRequiredInteger, } from '../shared.js';
function isDirectivoActor(actor) {
    return hasExecutiveAccess(actor);
}
function assertConfigValueUnchanged(field, nextValue, currentValue) {
    assertCondition(Object.is(nextValue, currentValue), 'permission-denied', `Administración solo puede modificar precio base y descuentos por tipo de socio. El campo ${field} requiere Comité Ejecutivo.`);
}
function assertAdministrativeFeeOnlyUpdate(input, activeConfig) {
    assertCondition(activeConfig, 'permission-denied', 'Administración solo puede actualizar cuotas sobre una configuración contable activa.');
    assertConfigValueUnchanged('maxLicenseMonths', input.maxLicenseMonths, activeConfig.maxLicenseMonths);
    assertConfigValueUnchanged('familyGroupBillingMode', input.familyGroupBillingMode, activeConfig.familyGroupBillingMode);
    assertConfigValueUnchanged('allowStandaloneMinor', input.allowStandaloneMinor, activeConfig.allowStandaloneMinor);
    assertConfigValueUnchanged('membershipChargePersistenceMode', input.membershipChargePersistenceMode, activeConfig.membershipChargePersistenceMode);
    assertConfigValueUnchanged('cantineroContractMode', input.cantineroContractMode, activeConfig.cantineroContractMode);
    assertConfigValueUnchanged('advertisingDefaultPeriodicity', input.advertisingDefaultPeriodicity, activeConfig.advertisingDefaultPeriodicity);
    assertConfigValueUnchanged('requireApprovalForExpensePosting', input.requireApprovalForExpensePosting, activeConfig.requireApprovalForExpensePosting);
    assertConfigValueUnchanged('requireApprovalForOvertimePosting', input.requireApprovalForOvertimePosting, activeConfig.requireApprovalForOvertimePosting);
    assertConfigValueUnchanged('serverMonthlyExpenseMinor', input.serverMonthlyExpenseMinor ?? activeConfig.serverMonthlyExpenseMinor ?? DEFAULT_FINANCIAL_CONFIG.serverMonthlyExpenseMinor, activeConfig.serverMonthlyExpenseMinor ?? DEFAULT_FINANCIAL_CONFIG.serverMonthlyExpenseMinor);
    assertConfigValueUnchanged('serverMonthlyExpenseDueDay', input.serverMonthlyExpenseDueDay ?? activeConfig.serverMonthlyExpenseDueDay ?? DEFAULT_FINANCIAL_CONFIG.serverMonthlyExpenseDueDay, activeConfig.serverMonthlyExpenseDueDay ?? DEFAULT_FINANCIAL_CONFIG.serverMonthlyExpenseDueDay);
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
        const nationalHolidayDates = [...new Set(params.input.nationalHolidayDates
                ?? activeConfig?.nationalHolidayDates
                ?? DEFAULT_FINANCIAL_CONFIG.nationalHolidayDates
                ?? [])].sort();
        assertCondition(nationalHolidayDates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)), 'invalid-argument', 'Los feriados deben usar el formato AAAA-MM-DD.');
        const serverMonthlyExpenseDueDay = params.input.serverMonthlyExpenseDueDay ?? activeConfig?.serverMonthlyExpenseDueDay ?? DEFAULT_FINANCIAL_CONFIG.serverMonthlyExpenseDueDay ?? 20;
        assertCondition(Number.isInteger(serverMonthlyExpenseDueDay) && serverMonthlyExpenseDueDay >= 1 && serverMonthlyExpenseDueDay <= 28, 'invalid-argument', 'El vencimiento del servidor debe ser un dia entre 1 y 28.');
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
            memberGreenFeeWeekdayMinor: params.input.memberGreenFeeWeekdayMinor ?? activeConfig?.memberGreenFeeWeekdayMinor ?? DEFAULT_FINANCIAL_CONFIG.memberGreenFeeWeekdayMinor,
            memberGreenFeeSaturdayHolidayMinor: params.input.memberGreenFeeSaturdayHolidayMinor ?? activeConfig?.memberGreenFeeSaturdayHolidayMinor ?? DEFAULT_FINANCIAL_CONFIG.memberGreenFeeSaturdayHolidayMinor,
            guestGreenFeeWeekdayMinor: params.input.guestGreenFeeWeekdayMinor ?? activeConfig?.guestGreenFeeWeekdayMinor ?? DEFAULT_FINANCIAL_CONFIG.guestGreenFeeWeekdayMinor,
            guestGreenFeeSaturdayHolidayMinor: params.input.guestGreenFeeSaturdayHolidayMinor ?? activeConfig?.guestGreenFeeSaturdayHolidayMinor ?? DEFAULT_FINANCIAL_CONFIG.guestGreenFeeSaturdayHolidayMinor,
            minorGreenFeeSaturdayHolidayPctBps: params.input.minorGreenFeeSaturdayHolidayPctBps ?? activeConfig?.minorGreenFeeSaturdayHolidayPctBps ?? DEFAULT_FINANCIAL_CONFIG.minorGreenFeeSaturdayHolidayPctBps,
            nationalHolidayDates,
            cantineroContractMode: params.input.cantineroContractMode,
            advertisingDefaultPeriodicity: params.input.advertisingDefaultPeriodicity,
            requireApprovalForExpensePosting: params.input.requireApprovalForExpensePosting,
            requireApprovalForOvertimePosting: params.input.requireApprovalForOvertimePosting,
            serverMonthlyExpenseMinor: params.input.serverMonthlyExpenseMinor ?? activeConfig?.serverMonthlyExpenseMinor ?? DEFAULT_FINANCIAL_CONFIG.serverMonthlyExpenseMinor,
            serverMonthlyExpenseDueDay,
            notes: params.input.notes ?? null,
        }, actor.uid);
        return { configId, version: nextVersion };
    });
}
export async function setCreditCommissionRuleUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const paymentMethodId = PAYMENT_METHOD_IDS.creditGalicia;
        const paymentMethod = await dataAccess.paymentMethods.getById(paymentMethodId);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${paymentMethodId}.`);
        const previousRule = await dataAccess.paymentCommissionRules.getActiveByPaymentMethodId(paymentMethodId);
        const validFrom = params.input.validFrom ?? new Date();
        if (previousRule) {
            await dataAccess.paymentCommissionRules.update(previousRule.id, {
                isActive: false,
                validTo: Timestamp.fromDate(validFrom),
            }, actor.uid);
        }
        const ruleId = await dataAccess.paymentCommissionRules.create({
            paymentMethodId,
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
        memberGreenFeeWeekdayMinor: parseOptionalAmountMinor(data, 'memberGreenFeeWeekdayMinor'),
        memberGreenFeeSaturdayHolidayMinor: parseOptionalAmountMinor(data, 'memberGreenFeeSaturdayHolidayMinor'),
        guestGreenFeeWeekdayMinor: parseOptionalAmountMinor(data, 'guestGreenFeeWeekdayMinor'),
        guestGreenFeeSaturdayHolidayMinor: parseOptionalAmountMinor(data, 'guestGreenFeeSaturdayHolidayMinor'),
        minorGreenFeeSaturdayHolidayPctBps: parseOptionalBps(data, 'minorGreenFeeSaturdayHolidayPctBps'),
        nationalHolidayDates: parseOptionalStringArray(data, 'nationalHolidayDates'),
        cantineroContractMode: parseRequiredEnum(data, 'cantineroContractMode', ['fixed_monthly', 'fixed_plus_variable']),
        advertisingDefaultPeriodicity: parseRequiredEnum(data, 'advertisingDefaultPeriodicity', ['monthly', 'one_time']),
        requireApprovalForExpensePosting: parseOptionalBoolean(data, 'requireApprovalForExpensePosting') ?? DEFAULT_FINANCIAL_CONFIG.requireApprovalForExpensePosting,
        requireApprovalForOvertimePosting: parseOptionalBoolean(data, 'requireApprovalForOvertimePosting') ?? DEFAULT_FINANCIAL_CONFIG.requireApprovalForOvertimePosting,
        serverMonthlyExpenseMinor: parseOptionalAmountMinor(data, 'serverMonthlyExpenseMinor'),
        serverMonthlyExpenseDueDay: parseOptionalInteger(data, 'serverMonthlyExpenseDueDay'),
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