import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  ACCOUNTING_TIME_ZONE,
  DEFAULT_FINANCIAL_EXPENSE_CATEGORIES,
  DEFAULT_FINANCIAL_INCOME_CATEGORIES,
  FINANCIAL_EXPENSE_CATEGORY_IDS,
  FINANCIAL_INCOME_CATEGORY_IDS,
} from '../domain/constants.js';
import { parseSetCreditCommissionRuleInput, parseUpsertFinancialConfigInput, setCreditCommissionRuleUseCase, upsertFinancialConfigUseCase } from '../application/use-cases/config.use-cases.js';
import { generateCuotaUseCase, generateFeePreviewUseCase, parseGenerateCuotaInput, parseGenerateFeePreviewInput } from '../application/use-cases/fee.use-cases.js';
import {
  editInternalTransferUseCase,
  parseEditInternalTransferInput,
  parseRegisterPaymentInput,
  parseTransferFundsInput,
  registerPaymentUseCase,
  transferFundsUseCase,
} from '../application/use-cases/payment.use-cases.js';
import { createMacroDebitSettlementUseCase, parseCreateMacroDebitSettlementInput, parseReconcileMacroSettlementInput, reconcileMacroSettlementUseCase } from '../application/use-cases/settlement.use-cases.js';
import {
  parsePostExpenseMovementInput,
  parseRegisterExpenseMovementInput,
  parseReviewExpenseInput,
  parseSubmitExpenseInput,
  postExpenseMovementUseCase,
  registerExpenseMovementUseCase,
  reviewExpenseUseCase,
  submitExpenseUseCase,
} from '../application/use-cases/expense.use-cases.js';
import {
  parsePostAnnualBonusPaymentInput,
  parsePostSalaryPaymentInput,
  parseUpsertSalaryConfigurationInput,
  postAnnualBonusPaymentUseCase,
  postSalaryPaymentUseCase,
  upsertSalaryConfigurationUseCase,
} from '../application/use-cases/salary.use-cases.js';
import {
  parseRecordExternalReferenceInput,
  parseUpsertEmployeeExternalReferenceInput,
  recordExternalReferenceUseCase,
  upsertEmployeeExternalReferenceUseCase,
} from '../application/use-cases/external-reference.use-cases.js';
import {
  createHandicapChargeUseCase,
  parseCreateHandicapChargeInput,
  parseTransferHandicapToAssociationInput,
  parseTransferPendingHandicapToAssociationInput,
  transferHandicapToAssociationUseCase,
  transferPendingHandicapToAssociationUseCase,
} from '../application/use-cases/handicap.use-cases.js';
import {
  editFinancialMovementUseCase,
  parseEditFinancialMovementInput,
  parseSetFinancialMovementBalanceInclusionInput,
  parseVoidFinancialMovementInput,
  setFinancialMovementBalanceInclusionUseCase,
  voidFinancialMovementUseCase,
} from '../application/use-cases/movement.use-cases.js';
import {
  createCashClosureUseCase,
  closeCashClosureUseCase,
  parseCloseCashClosureInput,
  parseCreateCashClosureInput,
} from '../application/use-cases/cash-closure.use-cases.js';
import {
  createOvertimeEntryUseCase,
  linkExternalReferenceToEmployeeUseCase,
  listEmployeePayrollCycleUseCase,
  parseCreateOvertimeEntryInput,
  parseLinkExternalReferenceToEmployeeInput,
  parseListEmployeePayrollCycleInput,
  parsePostEmployeePayrollCycleInput,
  parseRecordEmployeeCertificateInput,
  parseReviewOvertimeEntryInput,
  postEmployeePayrollCycleUseCase,
  recordEmployeeCertificateUseCase,
  reviewOvertimeEntryUseCase,
} from '../application/use-cases/payroll-cycle.use-cases.js';
import { markMembershipRenewalsUseCase, syncMembershipRenewalsDailyUseCase } from '../application/use-cases/membership-renewal.use-cases.js';
import {
  parseRegisterMemberFeeBatchPaymentInput,
  registerMemberFeeBatchPaymentUseCase,
} from '../application/use-cases/member-fee-payment.use-cases.js';
import {
  parseReconcileMemberFeeRenewalsInput,
  reconcileMemberFeeRenewalsUseCase,
} from '../application/use-cases/member-fee-reconciliation.use-cases.js';
import {
  createInstallmentPlanUseCase,
  listMyReceiptsUseCase,
  parseCreateInstallmentPlanInput,
  parseRegisterInstallmentPaymentInput,
  registerInstallmentPaymentUseCase,
} from '../application/use-cases/installment.use-cases.js';
import { parseUpsertPayrollConfigInput, upsertPayrollConfigUseCase } from '../application/use-cases/payroll-config.use-cases.js';
import { ensureStaff, getClubDayOfMonth, resolveActor, toClubAccountingPeriod, toHttpsError } from '../application/shared.js';
import { FirestoreAccountingTransactionManager, SystemClock } from '../infrastructure/firestore/repositories.js';
import { emitMemberPaymentNotification, emitRoleNotification } from '../../notifications/notifications.service.js';

const transactions = new FirestoreAccountingTransactionManager(new SystemClock());
const DEFAULT_SERVER_EXPENSE_DUE_DAY = 20;
const DEFAULT_SERVER_MONTHLY_USD_MINOR = 6500;
const ON_DEMAND_EXPENSE_CATEGORY_IDS = new Set<string>([
  FINANCIAL_EXPENSE_CATEGORY_IDS.servidor,
  FINANCIAL_EXPENSE_CATEGORY_IDS.varios,
]);

async function ensureDefaultExpenseCategory(categoryId: string, actorUid: string): Promise<void> {
  const defaultCategory = DEFAULT_FINANCIAL_EXPENSE_CATEGORIES.find((category) => category.id === categoryId);
  if (!defaultCategory) {
    return;
  }

  const dataAccess = transactions.getDataAccess();
  if (!await dataAccess.financialExpenseCategories.getById(categoryId)) {
    await dataAccess.financialExpenseCategories.set(categoryId, defaultCategory.data, actorUid);
  }
}

async function ensureInternalTransferCategories(actorUid: string): Promise<void> {
  const defaultIncomeCategory = DEFAULT_FINANCIAL_INCOME_CATEGORIES.find(
    (category) => category.id === FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer,
  );
  const defaultExpenseCategory = DEFAULT_FINANCIAL_EXPENSE_CATEGORIES.find(
    (category) => category.id === FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer,
  );
  const dataAccess = transactions.getDataAccess();
  const [incomeCategory, expenseCategory] = await Promise.all([
    dataAccess.financialIncomeCategories.getById(FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer),
    dataAccess.financialExpenseCategories.getById(FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer),
  ]);

  await Promise.all([
    !incomeCategory && defaultIncomeCategory
      ? dataAccess.financialIncomeCategories.set(defaultIncomeCategory.id, defaultIncomeCategory.data, actorUid)
      : Promise.resolve(),
    !expenseCategory && defaultExpenseCategory
      ? dataAccess.financialExpenseCategories.set(defaultExpenseCategory.id, defaultExpenseCategory.data, actorUid)
      : Promise.resolve(),
  ]);
}

function formatServerUsdMinor(amountMinor: number) {
  return `USD ${(amountMinor / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

async function getActorFromCallableRequest(
  auth:
    | {
        uid?: string;
        token?: Record<string, unknown>;
      }
    | undefined,
) {
  return resolveActor(
    transactions.getDataAccess(),
    auth
      ? {
          uid: auth.uid,
          token: auth.token,
        }
      : null,
  );
}

function withCallableLogging(functionName: string, error: unknown): never {
  logger.error(`${functionName} failed`, error);
  throw toHttpsError(error);
}

export const accountingUpsertFinancialConfig = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return upsertFinancialConfigUseCase({
      actor,
      input: parseUpsertFinancialConfigInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingUpsertFinancialConfig', error);
  }
});

export const accountingSetCreditCommissionRule = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return setCreditCommissionRuleUseCase({
      actor,
      input: parseSetCreditCommissionRuleInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingSetCreditCommissionRule', error);
  }
});

export const accountingGenerateFeePreview = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return generateFeePreviewUseCase({
      actor,
      input: parseGenerateFeePreviewInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingGenerateFeePreview', error);
  }
});

export const accountingGenerateCuota = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return generateCuotaUseCase({
      actor,
      input: parseGenerateCuotaInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingGenerateCuota', error);
  }
});

export const accountingRegisterPayment = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const input = parseRegisterPaymentInput(request.data);
    const result = await registerPaymentUseCase({
      actor,
      input,
      transactions,
    });
    if (!result.duplicate) {
      const memberId = input.memberId ?? input.thirdPartyId ?? null;
      if (memberId) {
        try {
          await emitMemberPaymentNotification({
            memberId,
            movementId: result.movementId,
            amountMinor: result.grossAmountMinor,
            receiptNumber: result.receiptNumber,
            actorUid: actor?.uid ?? 'system',
          });
        } catch (notificationError) {
          logger.warn('accountingRegisterPayment notification emit failed', notificationError);
        }
      }
    }
    return result;
  } catch (error) {
    withCallableLogging('accountingRegisterPayment', error);
  }
});

export const accountingRegisterMemberFeeBatchPayment = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const result = await registerMemberFeeBatchPaymentUseCase({
      actor,
      input: parseRegisterMemberFeeBatchPaymentInput(request.data),
      transactions,
    });
    try {
      await emitMemberPaymentNotification({
        memberId: result.memberId,
        movementId: result.movementId,
        amountMinor: result.grossAmountMinor,
        receiptNumber: result.receiptNumber,
        actorUid: actor?.uid ?? 'system',
      });
    } catch (notificationError) {
      logger.warn('accountingRegisterMemberFeeBatchPayment notification emit failed', notificationError);
    }
    return result;
  } catch (error) {
    withCallableLogging('accountingRegisterMemberFeeBatchPayment', error);
  }
});

export const accountingReconcileMemberFeeRenewals = onCall({ timeoutSeconds: 120 }, async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return reconcileMemberFeeRenewalsUseCase({
      actor,
      input: parseReconcileMemberFeeRenewalsInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingReconcileMemberFeeRenewals', error);
  }
});

export const accountingCreateMacroDebitSettlement = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return createMacroDebitSettlementUseCase({
      actor,
      input: parseCreateMacroDebitSettlementInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingCreateMacroDebitSettlement', error);
  }
});

export const accountingReconcileMacroSettlement = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return reconcileMacroSettlementUseCase({
      actor,
      input: parseReconcileMacroSettlementInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingReconcileMacroSettlement', error);
  }
});

export const accountingSubmitExpense = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return submitExpenseUseCase({
      actor,
      input: parseSubmitExpenseInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingSubmitExpense', error);
  }
});

export const accountingCreateInstallmentPlan = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const input = parseCreateInstallmentPlanInput(request.data);
    if (input.movementType === 'expense' && ON_DEMAND_EXPENSE_CATEGORY_IDS.has(input.categoryId)) {
      const staffActor = ensureStaff(actor);
      await ensureDefaultExpenseCategory(input.categoryId, staffActor.uid);
    }
    return createInstallmentPlanUseCase({ actor, input, transactions });
  } catch (error) {
    withCallableLogging('accountingCreateInstallmentPlan', error);
  }
});

export const accountingRegisterInstallmentPayment = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const result = await registerInstallmentPaymentUseCase({
      actor,
      input: parseRegisterInstallmentPaymentInput(request.data),
      transactions,
    });
    if (result.receiptNumber) {
      const root = await transactions.getDataAccess().financialMovements.getById(result.installmentPlanId);
      if (root?.thirdPartyType === 'member' && root.thirdPartyId) {
        try {
          await emitMemberPaymentNotification({
            memberId: root.thirdPartyId,
            movementId: result.movementId,
            amountMinor: result.grossAmountMinor,
            receiptNumber: result.receiptNumber,
            actorUid: actor?.uid ?? 'system',
          });
        } catch (notificationError) {
          logger.warn('accountingRegisterInstallmentPayment notification emit failed', notificationError);
        }
      }
    }
    return result;
  } catch (error) {
    withCallableLogging('accountingRegisterInstallmentPayment', error);
  }
});

export const accountingListMyReceipts = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return listMyReceiptsUseCase({ actor, transactions });
  } catch (error) {
    withCallableLogging('accountingListMyReceipts', error);
  }
});

export const accountingTransferFunds = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const staffActor = ensureStaff(actor);
    await ensureInternalTransferCategories(staffActor.uid);
    return transferFundsUseCase({
      actor: staffActor,
      input: parseTransferFundsInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingTransferFunds', error);
  }
});

export const accountingEditInternalTransfer = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const staffActor = ensureStaff(actor);
    await ensureInternalTransferCategories(staffActor.uid);
    return editInternalTransferUseCase({
      actor: staffActor,
      input: parseEditInternalTransferInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingEditInternalTransfer', error);
  }
});

export const accountingRegisterExpenseMovement = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const staffActor = ensureStaff(actor);
    const input = parseRegisterExpenseMovementInput(request.data);
    if (ON_DEMAND_EXPENSE_CATEGORY_IDS.has(input.categoryId)) {
      await ensureDefaultExpenseCategory(input.categoryId, staffActor.uid);
    }
    return registerExpenseMovementUseCase({
      actor: staffActor,
      input,
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingRegisterExpenseMovement', error);
  }
});

export const accountingReviewExpense = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return reviewExpenseUseCase({
      actor,
      input: parseReviewExpenseInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingReviewExpense', error);
  }
});

export const accountingPostExpenseMovement = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return postExpenseMovementUseCase({
      actor,
      input: parsePostExpenseMovementInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingPostExpenseMovement', error);
  }
});

export const accountingUpsertSalaryConfiguration = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return upsertSalaryConfigurationUseCase({
      actor,
      input: parseUpsertSalaryConfigurationInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingUpsertSalaryConfiguration', error);
  }
});

export const accountingUpsertPayrollConfig = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return upsertPayrollConfigUseCase({
      actor,
      input: parseUpsertPayrollConfigInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingUpsertPayrollConfig', error);
  }
});

export const accountingPostSalaryPayment = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return postSalaryPaymentUseCase({
      actor,
      input: parsePostSalaryPaymentInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingPostSalaryPayment', error);
  }
});

export const accountingPostAnnualBonusPayment = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return postAnnualBonusPaymentUseCase({
      actor,
      input: parsePostAnnualBonusPaymentInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingPostAnnualBonusPayment', error);
  }
});

export const accountingRecordExternalReference = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return recordExternalReferenceUseCase({
      actor,
      input: parseRecordExternalReferenceInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingRecordExternalReference', error);
  }
});

export const accountingUpsertEmployeeExternalReference = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return upsertEmployeeExternalReferenceUseCase({
      actor,
      input: parseUpsertEmployeeExternalReferenceInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingUpsertEmployeeExternalReference', error);
  }
});

export const accountingCreateHandicapCharge = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const input = parseCreateHandicapChargeInput(request.data);
    const result = await createHandicapChargeUseCase({
      actor,
      input,
      transactions,
    });
    if (!result.duplicate && result.incomeMovementId && result.receiptNumber) {
      try {
        await emitMemberPaymentNotification({
          memberId: input.memberId,
          movementId: result.incomeMovementId,
          amountMinor: result.grossAmountMinor ?? input.collectionAmountMinor,
          receiptNumber: result.receiptNumber,
          actorUid: actor?.uid ?? 'system',
        });
      } catch (notificationError) {
        logger.warn('accountingCreateHandicapCharge notification emit failed', notificationError);
      }
    }
    return result;
  } catch (error) {
    withCallableLogging('accountingCreateHandicapCharge', error);
  }
});

export const accountingTransferHandicapToAssociation = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return transferHandicapToAssociationUseCase({
      actor,
      input: parseTransferHandicapToAssociationInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingTransferHandicapToAssociation', error);
  }
});

export const accountingTransferPendingHandicapToAssociation = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return transferPendingHandicapToAssociationUseCase({
      actor,
      input: parseTransferPendingHandicapToAssociationInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingTransferPendingHandicapToAssociation', error);
  }
});

export const accountingVoidFinancialMovement = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return voidFinancialMovementUseCase({
      actor,
      input: parseVoidFinancialMovementInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingVoidFinancialMovement', error);
  }
});

export const accountingEditFinancialMovement = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return editFinancialMovementUseCase({
      actor,
      input: parseEditFinancialMovementInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingEditFinancialMovement', error);
  }
});

export const accountingSetFinancialMovementBalanceInclusion = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return setFinancialMovementBalanceInclusionUseCase({
      actor,
      input: parseSetFinancialMovementBalanceInclusionInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingSetFinancialMovementBalanceInclusion', error);
  }
});

export const accountingCreateOvertimeEntry = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return createOvertimeEntryUseCase({
      actor,
      input: parseCreateOvertimeEntryInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingCreateOvertimeEntry', error);
  }
});

export const accountingReviewOvertimeEntry = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return reviewOvertimeEntryUseCase({
      actor,
      input: parseReviewOvertimeEntryInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingReviewOvertimeEntry', error);
  }
});

export const accountingListEmployeePayrollCycle = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return listEmployeePayrollCycleUseCase({
      actor,
      input: parseListEmployeePayrollCycleInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingListEmployeePayrollCycle', error);
  }
});

export const accountingPostEmployeePayrollCycle = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return postEmployeePayrollCycleUseCase({
      actor,
      input: parsePostEmployeePayrollCycleInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingPostEmployeePayrollCycle', error);
  }
});

export const accountingRecordEmployeeCertificate = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return recordEmployeeCertificateUseCase({
      actor,
      input: parseRecordEmployeeCertificateInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingRecordEmployeeCertificate', error);
  }
});

export const accountingLinkExternalReferenceToEmployee = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return linkExternalReferenceToEmployeeUseCase({
      actor,
      input: parseLinkExternalReferenceToEmployeeInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingLinkExternalReferenceToEmployee', error);
  }
});

export const accountingCreateCashClosure = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return createCashClosureUseCase({
      actor,
      input: parseCreateCashClosureInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingCreateCashClosure', error);
  }
});

export const accountingCloseCashClosure = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    return closeCashClosureUseCase({
      actor,
      input: parseCloseCashClosureInput(request.data),
      transactions,
    });
  } catch (error) {
    withCallableLogging('accountingCloseCashClosure', error);
  }
});

export const accountingMarkMembershipRenewals = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    ensureStaff(actor);
    return markMembershipRenewalsUseCase({ transactions, actor });
  } catch (error) {
    withCallableLogging('accountingMarkMembershipRenewals', error);
  }
});

export const accountingMarkMembershipRenewalsDaily = onSchedule(
  {
    schedule: '5 0 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 540,
  },
  async () => {
    const result = await syncMembershipRenewalsDailyUseCase({ transactions });
    logger.info('accountingMarkMembershipRenewalsDaily completed', result);
  },
);

export const accountingCheckServerExpenseDue = onSchedule(
  {
    schedule: '15 9 * * *',
    timeZone: ACCOUNTING_TIME_ZONE,
    timeoutSeconds: 120,
  },
  async () => {
    const now = new Date();
    const dayOfMonth = getClubDayOfMonth(now);
    const dataAccess = transactions.getDataAccess();
    const activeConfig = await dataAccess.financialConfigs.getActive();
    const serverExpenseDueDay = activeConfig?.serverMonthlyExpenseDueDay && activeConfig.serverMonthlyExpenseDueDay >= 1
      ? activeConfig.serverMonthlyExpenseDueDay
      : DEFAULT_SERVER_EXPENSE_DUE_DAY;

    if (dayOfMonth <= serverExpenseDueDay) {
      logger.info('accountingCheckServerExpenseDue skipped before notification day', { dayOfMonth, serverExpenseDueDay });
      return;
    }

    const period = toClubAccountingPeriod(now);
    const serverMovements = await dataAccess.financialMovements.listPage({
      accountingPeriod: period,
      movementType: 'expense',
      categoryCodeSnapshot: FINANCIAL_EXPENSE_CATEGORY_IDS.servidor,
      status: 'posted',
      limit: 1,
    });

    if (serverMovements.items.length > 0) {
      logger.info('accountingCheckServerExpenseDue completed with server expense found', { period });
      return;
    }

    const configuredAmountMinor = activeConfig?.serverMonthlyExpenseMinor && activeConfig.serverMonthlyExpenseMinor > 0
      ? activeConfig.serverMonthlyExpenseMinor
      : DEFAULT_SERVER_MONTHLY_USD_MINOR;

    try {
      const result = await emitRoleNotification({
        type: 'accounting_server_expense_due',
        sourceModule: 'accounting',
        sourceCollection: 'financial_movements',
        sourceId: `server-expense-${period}`,
        title: 'Pago de servidor pendiente',
        body: `No se registro el egreso SERVIDOR de ${period}. Vencimiento: dia ${serverExpenseDueDay}. Monto configurado: ${formatServerUsdMinor(configuredAmountMinor)}.`,
        severity: 'warning',
        roleIds: ['directivo', 'administrativo', 'comision_directiva'],
        deliveryScope: 'shared_role_action',
        route: '/accounting/caja?tab=egresos',
        action: {
          key: 'notifications.open_route',
          label: 'Ir a Caja',
          requiresConfirmation: false,
          route: '/accounting/caja?tab=egresos',
        },
        metadata: {
          period,
          dueDay: serverExpenseDueDay,
          configuredAmountMinor,
          currency: 'USD',
        },
        dedupeKey: `accounting-server-expense-due:${period}`,
        actorUid: 'system',
      });
      logger.info('accountingCheckServerExpenseDue emitted notification', { period, result });
    } catch (error) {
      logger.warn('accountingCheckServerExpenseDue notification skipped', { period, error });
    }
  },
);

export const accounting = {
  upsertFinancialConfig: accountingUpsertFinancialConfig,
  setCreditCommissionRule: accountingSetCreditCommissionRule,
  generateFeePreview: accountingGenerateFeePreview,
  generateCuota: accountingGenerateCuota,
  registerPayment: accountingRegisterPayment,
  registerMemberFeeBatchPayment: accountingRegisterMemberFeeBatchPayment,
  reconcileMemberFeeRenewals: accountingReconcileMemberFeeRenewals,
  createInstallmentPlan: accountingCreateInstallmentPlan,
  registerInstallmentPayment: accountingRegisterInstallmentPayment,
  listMyReceipts: accountingListMyReceipts,
  transferFunds: accountingTransferFunds,
  editInternalTransfer: accountingEditInternalTransfer,
  createMacroDebitSettlement: accountingCreateMacroDebitSettlement,
  reconcileMacroSettlement: accountingReconcileMacroSettlement,
  submitExpense: accountingSubmitExpense,
  registerExpenseMovement: accountingRegisterExpenseMovement,
  reviewExpense: accountingReviewExpense,
  postExpenseMovement: accountingPostExpenseMovement,
  upsertSalaryConfiguration: accountingUpsertSalaryConfiguration,
  upsertPayrollConfig: accountingUpsertPayrollConfig,
  postSalaryPayment: accountingPostSalaryPayment,
  postAnnualBonusPayment: accountingPostAnnualBonusPayment,
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
  checkServerExpenseDue: accountingCheckServerExpenseDue,
  createHandicapCharge: accountingCreateHandicapCharge,
  transferHandicapToAssociation: accountingTransferHandicapToAssociation,
  transferPendingHandicapToAssociation: accountingTransferPendingHandicapToAssociation,
  voidFinancialMovement: accountingVoidFinancialMovement,
  editFinancialMovement: accountingEditFinancialMovement,
  setFinancialMovementBalanceInclusion: accountingSetFinancialMovementBalanceInclusion,
};
