import { httpsCallable, type Functions } from 'firebase/functions';
import { getFirebaseFunctions } from '../../../lib/firebaseFunctions';
import { ACCOUNTING_CALLABLE_NAMES } from '../domain/constants';
import type {
  GenerateCuotaPayload,
  GenerateCuotaResult,
  PostExpenseMovementPayload,
  PostExpenseMovementResult,
  RecordExternalReferencePayload,
  RecordExternalReferenceResult,
  ReconcileMacroSettlementPayload,
  ReconcileMacroSettlementResult,
  RegisterPaymentPayload,
  RegisterPaymentResult,
  ReviewExpensePayload,
  ReviewExpenseResult,
  SubmitExpensePayload,
  SubmitExpenseResult,
  UpsertFinancialConfigPayload,
  UpsertFinancialConfigResult,
  UpsertSalaryConfigurationPayload,
  UpsertSalaryConfigurationResult,
  VoidFinancialMovementPayload,
  VoidFinancialMovementResult,
} from '../domain/models';

function getAccountingFunctions(functionsInstance?: Functions): Functions {
  return getFirebaseFunctions(functionsInstance);
}

export function createAccountingCallables(functionsInstance?: Functions) {
  const functionsRef = getAccountingFunctions(functionsInstance);

  return {
    async upsertFinancialConfig(payload: UpsertFinancialConfigPayload) {
      return (await httpsCallable<UpsertFinancialConfigPayload, UpsertFinancialConfigResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.upsertFinancialConfig,
      )(payload)).data;
    },
    async upsertSalaryConfiguration(payload: UpsertSalaryConfigurationPayload) {
      return (await httpsCallable<UpsertSalaryConfigurationPayload, UpsertSalaryConfigurationResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.upsertSalaryConfiguration,
      )(payload)).data;
    },
    async generateCuota(payload: GenerateCuotaPayload) {
      return (await httpsCallable<GenerateCuotaPayload, GenerateCuotaResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.generateCuota,
      )(payload)).data;
    },
    async registerPayment(payload: RegisterPaymentPayload) {
      return (await httpsCallable<RegisterPaymentPayload, RegisterPaymentResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.registerPayment,
      )(payload)).data;
    },
    async submitExpense(payload: SubmitExpensePayload) {
      return (await httpsCallable<SubmitExpensePayload, SubmitExpenseResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.submitExpense,
      )(payload)).data;
    },
    async reviewExpense(payload: ReviewExpensePayload) {
      return (await httpsCallable<ReviewExpensePayload, ReviewExpenseResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.reviewExpense,
      )(payload)).data;
    },
    async postExpenseMovement(payload: PostExpenseMovementPayload) {
      return (await httpsCallable<PostExpenseMovementPayload, PostExpenseMovementResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.postExpenseMovement,
      )(payload)).data;
    },
    async recordExternalReference(payload: RecordExternalReferencePayload) {
      return (await httpsCallable<RecordExternalReferencePayload, RecordExternalReferenceResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.recordExternalReference,
      )(payload)).data;
    },
    async reconcileMacroSettlement(payload: ReconcileMacroSettlementPayload) {
      return (await httpsCallable<ReconcileMacroSettlementPayload, ReconcileMacroSettlementResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.reconcileMacroSettlement,
      )(payload)).data;
    },
    async voidFinancialMovement(payload: VoidFinancialMovementPayload) {
      return (await httpsCallable<VoidFinancialMovementPayload, VoidFinancialMovementResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.voidFinancialMovement,
      )(payload)).data;
    },
  };
}

export type AccountingCallableApi = ReturnType<typeof createAccountingCallables>;
