import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { parseSetCreditCommissionRuleInput, parseUpsertFinancialConfigInput, setCreditCommissionRuleUseCase, upsertFinancialConfigUseCase } from '../application/use-cases/config.use-cases.js';
import { generateCuotaUseCase, generateFeePreviewUseCase, parseGenerateCuotaInput, parseGenerateFeePreviewInput } from '../application/use-cases/fee.use-cases.js';
import { parseRegisterPaymentInput, registerPaymentUseCase } from '../application/use-cases/payment.use-cases.js';
import { createMacroDebitSettlementUseCase, parseCreateMacroDebitSettlementInput, parseReconcileMacroSettlementInput, reconcileMacroSettlementUseCase } from '../application/use-cases/settlement.use-cases.js';
import { parsePostExpenseMovementInput, parseReviewExpenseInput, parseSubmitExpenseInput, postExpenseMovementUseCase, reviewExpenseUseCase, submitExpenseUseCase } from '../application/use-cases/expense.use-cases.js';
import { parsePostSalaryPaymentInput, parseUpsertSalaryConfigurationInput, postSalaryPaymentUseCase, upsertSalaryConfigurationUseCase } from '../application/use-cases/salary.use-cases.js';
import { parseRecordExternalReferenceInput, recordExternalReferenceUseCase } from '../application/use-cases/external-reference.use-cases.js';
import { createHandicapChargeUseCase, parseCreateHandicapChargeInput, parseTransferHandicapToAssociationInput, transferHandicapToAssociationUseCase } from '../application/use-cases/handicap.use-cases.js';
import { parseVoidFinancialMovementInput, voidFinancialMovementUseCase } from '../application/use-cases/movement.use-cases.js';
import { resolveActor, toHttpsError } from '../application/shared.js';
import { FirestoreAccountingTransactionManager, SystemClock } from '../infrastructure/firestore/repositories.js';
const transactions = new FirestoreAccountingTransactionManager(new SystemClock());
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
        return registerPaymentUseCase({
            actor,
            input: parseRegisterPaymentInput(request.data),
            transactions,
        });
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
    postSalaryPayment: accountingPostSalaryPayment,
    recordExternalReference: accountingRecordExternalReference,
    createHandicapCharge: accountingCreateHandicapCharge,
    transferHandicapToAssociation: accountingTransferHandicapToAssociation,
    voidFinancialMovement: accountingVoidFinancialMovement,
};
//# sourceMappingURL=accounting.callables.js.map