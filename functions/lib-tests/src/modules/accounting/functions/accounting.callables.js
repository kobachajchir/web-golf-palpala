import { logger } from 'firebase-functions';
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { parseSetCreditCommissionRuleInput, parseUpsertFinancialConfigInput, setCreditCommissionRuleUseCase, upsertFinancialConfigUseCase } from '../application/use-cases/config.use-cases.js';
import { generateCuotaUseCase, generateFeePreviewUseCase, parseGenerateCuotaInput, parseGenerateFeePreviewInput } from '../application/use-cases/fee.use-cases.js';
import { parseRegisterPaymentInput, registerPaymentUseCase } from '../application/use-cases/payment.use-cases.js';
import { createMacroDebitSettlementUseCase, parseCreateMacroDebitSettlementInput, parseReconcileMacroSettlementInput, reconcileMacroSettlementUseCase } from '../application/use-cases/settlement.use-cases.js';
import { parsePostExpenseMovementInput, parseReviewExpenseInput, parseSubmitExpenseInput, postExpenseMovementUseCase, reviewExpenseUseCase, submitExpenseUseCase } from '../application/use-cases/expense.use-cases.js';
import { parsePostSalaryPaymentInput, parseUpsertSalaryConfigurationInput, postSalaryPaymentUseCase, upsertSalaryConfigurationUseCase } from '../application/use-cases/salary.use-cases.js';
import { parseRecordExternalReferenceInput, parseUpsertEmployeeExternalReferenceInput, recordExternalReferenceUseCase, upsertEmployeeExternalReferenceUseCase, } from '../application/use-cases/external-reference.use-cases.js';
import { createHandicapChargeUseCase, parseCreateHandicapChargeInput, parseTransferHandicapToAssociationInput, transferHandicapToAssociationUseCase } from '../application/use-cases/handicap.use-cases.js';
import { parseVoidFinancialMovementInput, voidFinancialMovementUseCase } from '../application/use-cases/movement.use-cases.js';
import { createCashClosureUseCase, closeCashClosureUseCase, parseCloseCashClosureInput, parseCreateCashClosureInput, } from '../application/use-cases/cash-closure.use-cases.js';
import { createOvertimeEntryUseCase, linkExternalReferenceToEmployeeUseCase, listEmployeePayrollCycleUseCase, parseCreateOvertimeEntryInput, parseLinkExternalReferenceToEmployeeInput, parseListEmployeePayrollCycleInput, parsePostEmployeePayrollCycleInput, parseRecordEmployeeCertificateInput, parseReviewOvertimeEntryInput, postEmployeePayrollCycleUseCase, recordEmployeeCertificateUseCase, reviewOvertimeEntryUseCase, } from '../application/use-cases/payroll-cycle.use-cases.js';
import { markMembershipRenewalsUseCase } from '../application/use-cases/membership-renewal.use-cases.js';
import { createMercadoPagoCheckoutUseCase, getMercadoPagoCheckoutStatusUseCase, parseCreateMercadoPagoCheckoutInput, parseGetMercadoPagoCheckoutStatusInput, parseMercadoPagoPaymentResponse, reconcileMercadoPagoPaymentsUseCase, recordMercadoPagoEventUseCase, verifyMercadoPagoSignature, } from '../application/use-cases/mercado-pago.use-cases.js';
import { parseUpsertPayrollConfigInput, upsertPayrollConfigUseCase } from '../application/use-cases/payroll-config.use-cases.js';
import { assertIsRecord, ensureStaff, resolveActor, toHttpsError } from '../application/shared.js';
import { FirestoreAccountingTransactionManager, SystemClock } from '../infrastructure/firestore/repositories.js';
import { emitMemberPaymentNotification } from '../../notifications/notifications.service.js';
const transactions = new FirestoreAccountingTransactionManager(new SystemClock());
const clock = new SystemClock();
function readEnv(name) {
    const value = process.env[name];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function getAppBaseUrl() {
    return readEnv('APP_BASE_URL') ?? readEnv('VITE_APP_BASE_URL') ?? 'http://localhost:5173';
}
function getMercadoPagoWebhookUrl() {
    return readEnv('MP_WEBHOOK_URL') ?? `${getAppBaseUrl()}/mercadoPagoWebhook`;
}
function isEmulatorRuntime() {
    return process.env.FUNCTIONS_EMULATOR === 'true' || process.env.FIRESTORE_EMULATOR_HOST !== undefined;
}
function shouldEnforceAppCheck() {
    return !isEmulatorRuntime() && readEnv('ENFORCE_APP_CHECK') === 'true';
}
function sanitizeEventId(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
}
function getHeaderValue(headers, key) {
    const value = headers[key.toLowerCase()] ?? headers[key];
    if (Array.isArray(value)) {
        return value.join(',');
    }
    return typeof value === 'string' ? value : '';
}
function pickMercadoPagoHeaders(headers) {
    return {
        'x-request-id': getHeaderValue(headers, 'x-request-id'),
        'x-signature': getHeaderValue(headers, 'x-signature'),
        'user-agent': getHeaderValue(headers, 'user-agent'),
    };
}
function buildMercadoPagoRuntimeConfig() {
    return {
        appBaseUrl: getAppBaseUrl(),
        webhookUrl: getMercadoPagoWebhookUrl(),
        preferenceExpirationMinutes: Number(readEnv('MP_PREFERENCE_EXPIRATION_MINUTES') ?? '30'),
    };
}
function createMercadoPagoClient() {
    const accessToken = readEnv('MP_ACCESS_TOKEN');
    const useMock = isEmulatorRuntime() && !accessToken;
    return {
        async createPreference(payload) {
            if (useMock) {
                const externalReference = payload.external_reference;
                return {
                    preferenceId: `mock_pref_${externalReference}`,
                    checkoutUrl: `${getAppBaseUrl()}/payments/mercado-pago/return/success?sessionId=${encodeURIComponent(externalReference)}&mock=1`,
                    rawResponse: {
                        id: `mock_pref_${externalReference}`,
                        init_point: null,
                        sandbox_init_point: null,
                    },
                };
            }
            if (!accessToken) {
                throw new Error('MP_ACCESS_TOKEN no está configurado.');
            }
            const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(8000),
            });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(`Mercado Pago rechazó la preferencia: ${JSON.stringify(body)}`);
            }
            const preferenceId = typeof body.id === 'string' ? body.id : null;
            const checkoutUrl = typeof body.init_point === 'string'
                ? body.init_point
                : typeof body.sandbox_init_point === 'string'
                    ? body.sandbox_init_point
                    : null;
            if (!preferenceId || !checkoutUrl) {
                throw new Error('Mercado Pago no devolvió preferenceId o checkoutUrl.');
            }
            return {
                preferenceId,
                checkoutUrl,
                rawResponse: body,
            };
        },
        async getPayment(paymentId) {
            if (useMock) {
                return {
                    paymentId,
                    status: 'approved',
                    statusDetail: 'accredited',
                    externalReference: null,
                    merchantOrderId: null,
                    transactionAmountMinor: 0,
                    netAmountMinor: null,
                    feeAmountMinor: null,
                    moneyReleaseDate: null,
                    paymentTypeId: 'account_money',
                    providerPaymentMethodId: 'account_money',
                    dateApproved: new Date().toISOString(),
                };
            }
            if (!accessToken) {
                throw new Error('MP_ACCESS_TOKEN no está configurado.');
            }
            const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                signal: AbortSignal.timeout(8000),
            });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(`No se pudo consultar el pago de Mercado Pago: ${JSON.stringify(body)}`);
            }
            return parseMercadoPagoPaymentResponse(body);
        },
    };
}
async function getActorFromCallableRequest(auth) {
    return resolveActor(transactions.getDataAccess(), auth
        ? {
            uid: auth.uid,
            token: auth.token,
        }
        : null);
}
function withCallableLogging(functionName, error) {
    logger.error(`${functionName} failed`, error);
    throw toHttpsError(error);
}
export const accountingUpsertFinancialConfig = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return upsertFinancialConfigUseCase({
            actor,
            input: parseUpsertFinancialConfigInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingUpsertFinancialConfig', error);
    }
});
export const accountingSetCreditCommissionRule = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return setCreditCommissionRuleUseCase({
            actor,
            input: parseSetCreditCommissionRuleInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingSetCreditCommissionRule', error);
    }
});
export const accountingGenerateFeePreview = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return generateFeePreviewUseCase({
            actor,
            input: parseGenerateFeePreviewInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingGenerateFeePreview', error);
    }
});
export const accountingGenerateCuota = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return generateCuotaUseCase({
            actor,
            input: parseGenerateCuotaInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingGenerateCuota', error);
    }
});
export const accountingRegisterPayment = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        const input = parseRegisterPaymentInput(request.data);
        const result = await registerPaymentUseCase({
            actor,
            input,
            transactions,
        });
        if (!result.duplicate && input.sourceType === 'member_fee_charge') {
            const memberId = input.memberId ?? input.thirdPartyId ?? null;
            if (memberId) {
                try {
                    await emitMemberPaymentNotification({
                        memberId,
                        movementId: result.movementId,
                        amountMinor: result.netAmountMinor,
                        receiptNumber: result.receiptNumber,
                        actorUid: actor?.uid ?? 'system',
                    });
                }
                catch (notificationError) {
                    logger.warn('accountingRegisterPayment notification emit failed', notificationError);
                }
            }
        }
        return result;
    }
    catch (error) {
        withCallableLogging('accountingRegisterPayment', error);
    }
});
export const accountingCreateMacroDebitSettlement = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createMacroDebitSettlementUseCase({
            actor,
            input: parseCreateMacroDebitSettlementInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingCreateMacroDebitSettlement', error);
    }
});
export const accountingReconcileMacroSettlement = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return reconcileMacroSettlementUseCase({
            actor,
            input: parseReconcileMacroSettlementInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingReconcileMacroSettlement', error);
    }
});
export const accountingSubmitExpense = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return submitExpenseUseCase({
            actor,
            input: parseSubmitExpenseInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingSubmitExpense', error);
    }
});
export const accountingReviewExpense = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return reviewExpenseUseCase({
            actor,
            input: parseReviewExpenseInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingReviewExpense', error);
    }
});
export const accountingPostExpenseMovement = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return postExpenseMovementUseCase({
            actor,
            input: parsePostExpenseMovementInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingPostExpenseMovement', error);
    }
});
export const accountingUpsertSalaryConfiguration = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return upsertSalaryConfigurationUseCase({
            actor,
            input: parseUpsertSalaryConfigurationInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingUpsertSalaryConfiguration', error);
    }
});
export const accountingUpsertPayrollConfig = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return upsertPayrollConfigUseCase({
            actor,
            input: parseUpsertPayrollConfigInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingUpsertPayrollConfig', error);
    }
});
export const accountingPostSalaryPayment = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return postSalaryPaymentUseCase({
            actor,
            input: parsePostSalaryPaymentInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingPostSalaryPayment', error);
    }
});
export const accountingRecordExternalReference = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return recordExternalReferenceUseCase({
            actor,
            input: parseRecordExternalReferenceInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingRecordExternalReference', error);
    }
});
export const accountingUpsertEmployeeExternalReference = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return upsertEmployeeExternalReferenceUseCase({
            actor,
            input: parseUpsertEmployeeExternalReferenceInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingUpsertEmployeeExternalReference', error);
    }
});
export const accountingCreateHandicapCharge = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createHandicapChargeUseCase({
            actor,
            input: parseCreateHandicapChargeInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingCreateHandicapCharge', error);
    }
});
export const accountingTransferHandicapToAssociation = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return transferHandicapToAssociationUseCase({
            actor,
            input: parseTransferHandicapToAssociationInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingTransferHandicapToAssociation', error);
    }
});
export const accountingVoidFinancialMovement = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return voidFinancialMovementUseCase({
            actor,
            input: parseVoidFinancialMovementInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingVoidFinancialMovement', error);
    }
});
export const accountingCreateOvertimeEntry = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createOvertimeEntryUseCase({
            actor,
            input: parseCreateOvertimeEntryInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingCreateOvertimeEntry', error);
    }
});
export const accountingReviewOvertimeEntry = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return reviewOvertimeEntryUseCase({
            actor,
            input: parseReviewOvertimeEntryInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingReviewOvertimeEntry', error);
    }
});
export const accountingListEmployeePayrollCycle = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return listEmployeePayrollCycleUseCase({
            actor,
            input: parseListEmployeePayrollCycleInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingListEmployeePayrollCycle', error);
    }
});
export const accountingPostEmployeePayrollCycle = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return postEmployeePayrollCycleUseCase({
            actor,
            input: parsePostEmployeePayrollCycleInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingPostEmployeePayrollCycle', error);
    }
});
export const accountingRecordEmployeeCertificate = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return recordEmployeeCertificateUseCase({
            actor,
            input: parseRecordEmployeeCertificateInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingRecordEmployeeCertificate', error);
    }
});
export const accountingLinkExternalReferenceToEmployee = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return linkExternalReferenceToEmployeeUseCase({
            actor,
            input: parseLinkExternalReferenceToEmployeeInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingLinkExternalReferenceToEmployee', error);
    }
});
export const accountingCreateCashClosure = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createCashClosureUseCase({
            actor,
            input: parseCreateCashClosureInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingCreateCashClosure', error);
    }
});
export const accountingCloseCashClosure = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return closeCashClosureUseCase({
            actor,
            input: parseCloseCashClosureInput(request.data),
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingCloseCashClosure', error);
    }
});
export const accountingMarkMembershipRenewals = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        ensureStaff(actor);
        return markMembershipRenewalsUseCase({ transactions, actor });
    }
    catch (error) {
        withCallableLogging('accountingMarkMembershipRenewals', error);
    }
});
export const accountingCreateMercadoPagoCheckout = onCall({
    enforceAppCheck: shouldEnforceAppCheck(),
    consumeAppCheckToken: shouldEnforceAppCheck(),
    timeoutSeconds: 30,
}, async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return createMercadoPagoCheckoutUseCase({
            actor,
            input: parseCreateMercadoPagoCheckoutInput(request.data),
            transactions,
            clock,
            mercadoPagoClient: createMercadoPagoClient(),
            runtimeConfig: buildMercadoPagoRuntimeConfig(),
        });
    }
    catch (error) {
        withCallableLogging('accountingCreateMercadoPagoCheckout', error);
    }
});
export const accountingGetMercadoPagoCheckoutStatus = onCall(async (request) => {
    try {
        const actor = await getActorFromCallableRequest(request.auth);
        return getMercadoPagoCheckoutStatusUseCase({
            actor,
            sessionId: parseGetMercadoPagoCheckoutStatusInput(request.data).sessionId,
            transactions,
        });
    }
    catch (error) {
        withCallableLogging('accountingGetMercadoPagoCheckoutStatus', error);
    }
});
export const accountingMercadoPagoWebhook = onRequest({
    timeoutSeconds: 60,
}, async (request, response) => {
    try {
        if (request.method !== 'POST') {
            response.status(405).json({ ok: false, error: 'method_not_allowed' });
            return;
        }
        const payload = assertIsRecord(request.body);
        const paymentData = typeof payload.data === 'object' && payload.data !== null
            ? payload.data
            : {};
        const queryDataId = request.query['data.id'];
        const paymentId = String((typeof queryDataId === 'string' ? queryDataId : undefined)
            ?? paymentData.id
            ?? payload.id
            ?? '');
        if (!paymentId) {
            response.status(400).json({ ok: false, error: 'missing_payment_id' });
            return;
        }
        const webhookSecret = readEnv('MP_WEBHOOK_SECRET');
        if (webhookSecret) {
            const xRequestId = getHeaderValue(request.headers, 'x-request-id');
            const xSignature = getHeaderValue(request.headers, 'x-signature');
            const validSignature = verifyMercadoPagoSignature({
                dataId: paymentId,
                xRequestId,
                xSignature,
                secret: webhookSecret,
            });
            if (!validSignature) {
                response.status(401).json({ ok: false, error: 'invalid_signature' });
                return;
            }
        }
        else if (!isEmulatorRuntime()) {
            response.status(500).json({ ok: false, error: 'missing_webhook_secret' });
            return;
        }
        const payment = await createMercadoPagoClient().getPayment(paymentId);
        const eventId = sanitizeEventId(`payment_${payload.action ?? 'updated'}_${payment.paymentId}`);
        const result = await recordMercadoPagoEventUseCase({
            eventId,
            payload,
            headers: pickMercadoPagoHeaders(request.headers),
            payment,
            transactions,
            clock,
        });
        for (const receipt of result.receipts) {
            if (!receipt.memberId) {
                continue;
            }
            try {
                await emitMemberPaymentNotification({
                    memberId: receipt.memberId,
                    movementId: receipt.movementId,
                    amountMinor: receipt.amountMinor,
                    receiptNumber: receipt.receiptNumber,
                    actorUid: 'system',
                });
            }
            catch (notificationError) {
                logger.warn('accountingMercadoPagoWebhook notification emit failed', notificationError);
            }
        }
        response.status(200).json({ ok: true, ...result });
    }
    catch (error) {
        logger.error('accountingMercadoPagoWebhook failed', error);
        response.status(500).json({
            ok: false,
            error: error instanceof Error ? error.message : 'unexpected_error',
        });
    }
});
export const accountingReconcileMercadoPagoPayments = onSchedule({
    schedule: 'every 30 minutes',
    timeZone: 'America/Argentina/Buenos_Aires',
}, async () => {
    const result = await reconcileMercadoPagoPaymentsUseCase({
        transactions,
        mercadoPagoClient: createMercadoPagoClient(),
        clock,
    });
    for (const receipt of result.receipts) {
        if (!receipt.memberId) {
            continue;
        }
        try {
            await emitMemberPaymentNotification({
                memberId: receipt.memberId,
                movementId: receipt.movementId,
                amountMinor: receipt.amountMinor,
                receiptNumber: receipt.receiptNumber,
                actorUid: 'system',
            });
        }
        catch (notificationError) {
            logger.warn('accountingReconcileMercadoPagoPayments notification emit failed', notificationError);
        }
    }
    logger.info('accountingReconcileMercadoPagoPayments completed', result);
});
export const accountingMarkMembershipRenewalsDaily = onSchedule({
    schedule: '5 0 1 * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 540,
}, async () => {
    const result = await markMembershipRenewalsUseCase({ transactions });
    logger.info('accountingMarkMembershipRenewalsDaily completed', result);
});
export const accounting = {
    upsertFinancialConfig: accountingUpsertFinancialConfig,
    setCreditCommissionRule: accountingSetCreditCommissionRule,
    generateFeePreview: accountingGenerateFeePreview,
    generateCuota: accountingGenerateCuota,
    registerPayment: accountingRegisterPayment,
    createMacroDebitSettlement: accountingCreateMacroDebitSettlement,
    reconcileMacroSettlement: accountingReconcileMacroSettlement,
    submitExpense: accountingSubmitExpense,
    reviewExpense: accountingReviewExpense,
    postExpenseMovement: accountingPostExpenseMovement,
    upsertSalaryConfiguration: accountingUpsertSalaryConfiguration,
    upsertPayrollConfig: accountingUpsertPayrollConfig,
    postSalaryPayment: accountingPostSalaryPayment,
    recordExternalReference: accountingRecordExternalReference,
    upsertEmployeeExternalReference: accountingUpsertEmployeeExternalReference,
    createOvertimeEntry: accountingCreateOvertimeEntry,
    reviewOvertimeEntry: accountingReviewOvertimeEntry,
    listEmployeePayrollCycle: accountingListEmployeePayrollCycle,
    postEmployeePayrollCycle: accountingPostEmployeePayrollCycle,
    recordEmployeeCertificate: accountingRecordEmployeeCertificate,
    linkExternalReferenceToEmployee: accountingLinkExternalReferenceToEmployee,
    createCashClosure: accountingCreateCashClosure,
    closeCashClosure: accountingCloseCashClosure,
    markMembershipRenewals: accountingMarkMembershipRenewals,
    createMercadoPagoCheckout: accountingCreateMercadoPagoCheckout,
    getMercadoPagoCheckoutStatus: accountingGetMercadoPagoCheckoutStatus,
    createHandicapCharge: accountingCreateHandicapCharge,
    transferHandicapToAssociation: accountingTransferHandicapToAssociation,
    voidFinancialMovement: accountingVoidFinancialMovement,
};
//# sourceMappingURL=accounting.callables.js.map