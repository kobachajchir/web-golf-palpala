import { httpsCallable, type Functions } from 'firebase/functions';
import { getFirebaseFunctions } from '../../../lib/firebaseFunctions';
import { ACCOUNTING_CALLABLE_NAMES } from '../domain/constants';
import type {
  CloseCashClosurePayload,
  CloseCashClosureResult,
  CreateInstallmentPlanPayload,
  CreateInstallmentPlanResult,
  CreateHandicapChargePayload,
  CreateHandicapChargeResult,
  CreateCashClosurePayload,
  CreateCashClosureResult,
  CreateOvertimeEntryPayload,
  CreateOvertimeEntryResult,
  EditFinancialMovementPayload,
  EditFinancialMovementResult,
  EditInternalTransferPayload,
  EditInternalTransferResult,
  GenerateCuotaPayload,
  GenerateCuotaResult,
  LinkExternalReferenceToEmployeePayload,
  LinkExternalReferenceToEmployeeResult,
  ListEmployeePayrollCyclePayload,
  ListEmployeePayrollCycleResult,
  ListMyReceiptsResult,
  PostExpenseMovementPayload,
  PostExpenseMovementResult,
  PostEmployeePayrollCyclePayload,
  PostAnnualBonusPaymentPayload,
  PostEmployeePayrollCycleResult,
  PostAnnualBonusPaymentResult,
  RecordExternalReferencePayload,
  RecordExternalReferenceResult,
  RecordEmployeeCertificatePayload,
  RecordEmployeeCertificateResult,
  ReconcileMacroSettlementPayload,
  ReconcileMacroSettlementResult,
  RegisterExpenseMovementPayload,
  RegisterExpenseMovementResult,
  RegisterInstallmentPaymentPayload,
  RegisterInstallmentPaymentResult,
  RegisterMemberFeeBatchPaymentPayload,
  RegisterMemberFeeBatchPaymentResult,
  ReconcileMemberFeeRenewalsPayload,
  ReconcileMemberFeeRenewalsResult,
  RegisterPaymentPayload,
  RegisterPaymentResult,
  ReviewExpensePayload,
  ReviewExpenseResult,
  ReviewOvertimeEntryPayload,
  ReviewOvertimeEntryResult,
  SetCreditCommissionRulePayload,
  SetCreditCommissionRuleResult,
  SetFinancialMovementBalanceInclusionPayload,
  SetFinancialMovementBalanceInclusionResult,
  SubmitExpensePayload,
  SubmitExpenseResult,
  TransferFundsPayload,
  TransferFundsResult,
  TransferHandicapToAssociationPayload,
  TransferHandicapToAssociationResult,
  TransferPendingHandicapToAssociationPayload,
  TransferPendingHandicapToAssociationResult,
  UpsertEmployeeExternalReferencePayload,
  UpsertEmployeeExternalReferenceResult,
  UpsertFinancialConfigPayload,
  UpsertFinancialConfigResult,
  UpsertPayrollConfigPayload,
  UpsertPayrollConfigResult,
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
    async setCreditCommissionRule(payload: SetCreditCommissionRulePayload) {
      return (await httpsCallable<SetCreditCommissionRulePayload, SetCreditCommissionRuleResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.setCreditCommissionRule,
      )(payload)).data;
    },
    async upsertSalaryConfiguration(payload: UpsertSalaryConfigurationPayload) {
      return (await httpsCallable<UpsertSalaryConfigurationPayload, UpsertSalaryConfigurationResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.upsertSalaryConfiguration,
      )(payload)).data;
    },
    async upsertPayrollConfig(payload: UpsertPayrollConfigPayload) {
      return (await httpsCallable<UpsertPayrollConfigPayload, UpsertPayrollConfigResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.upsertPayrollConfig,
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
    async registerMemberFeeBatchPayment(payload: RegisterMemberFeeBatchPaymentPayload) {
      return (await httpsCallable<RegisterMemberFeeBatchPaymentPayload, RegisterMemberFeeBatchPaymentResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.registerMemberFeeBatchPayment,
      )(payload)).data;
    },
    async reconcileMemberFeeRenewals(payload: ReconcileMemberFeeRenewalsPayload) {
      return (await httpsCallable<ReconcileMemberFeeRenewalsPayload, ReconcileMemberFeeRenewalsResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.reconcileMemberFeeRenewals,
      )(payload)).data;
    },
    async createInstallmentPlan(payload: CreateInstallmentPlanPayload) {
      return (await httpsCallable<CreateInstallmentPlanPayload, CreateInstallmentPlanResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.createInstallmentPlan,
      )(payload)).data;
    },
    async registerInstallmentPayment(payload: RegisterInstallmentPaymentPayload) {
      return (await httpsCallable<RegisterInstallmentPaymentPayload, RegisterInstallmentPaymentResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.registerInstallmentPayment,
      )(payload)).data;
    },
    async listMyReceipts() {
      return (await httpsCallable<Record<string, never>, ListMyReceiptsResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.listMyReceipts,
      )({})).data;
    },
    async transferFunds(payload: TransferFundsPayload) {
      return (await httpsCallable<TransferFundsPayload, TransferFundsResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.transferFunds,
      )(payload)).data;
    },
    async editInternalTransfer(payload: EditInternalTransferPayload) {
      return (await httpsCallable<EditInternalTransferPayload, EditInternalTransferResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.editInternalTransfer,
      )(payload)).data;
    },
    async createHandicapCharge(payload: CreateHandicapChargePayload) {
      return (await httpsCallable<CreateHandicapChargePayload, CreateHandicapChargeResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.createHandicapCharge,
      )(payload)).data;
    },
    async transferHandicapToAssociation(payload: TransferHandicapToAssociationPayload) {
      return (await httpsCallable<TransferHandicapToAssociationPayload, TransferHandicapToAssociationResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.transferHandicapToAssociation,
      )(payload)).data;
    },
    async transferPendingHandicapToAssociation(payload: TransferPendingHandicapToAssociationPayload) {
      return (await httpsCallable<TransferPendingHandicapToAssociationPayload, TransferPendingHandicapToAssociationResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.transferPendingHandicapToAssociation,
      )(payload)).data;
    },
    async registerExpenseMovement(payload: RegisterExpenseMovementPayload) {
      return (await httpsCallable<RegisterExpenseMovementPayload, RegisterExpenseMovementResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.registerExpenseMovement,
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
    async upsertEmployeeExternalReference(payload: UpsertEmployeeExternalReferencePayload) {
      return (await httpsCallable<UpsertEmployeeExternalReferencePayload, UpsertEmployeeExternalReferenceResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.upsertEmployeeExternalReference,
      )(payload)).data;
    },
    async createOvertimeEntry(payload: CreateOvertimeEntryPayload) {
      return (await httpsCallable<CreateOvertimeEntryPayload, CreateOvertimeEntryResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.createOvertimeEntry,
      )(payload)).data;
    },
    async reviewOvertimeEntry(payload: ReviewOvertimeEntryPayload) {
      return (await httpsCallable<ReviewOvertimeEntryPayload, ReviewOvertimeEntryResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.reviewOvertimeEntry,
      )(payload)).data;
    },
    async listEmployeePayrollCycle(payload: ListEmployeePayrollCyclePayload) {
      return (await httpsCallable<ListEmployeePayrollCyclePayload, ListEmployeePayrollCycleResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.listEmployeePayrollCycle,
      )(payload)).data;
    },
    async postEmployeePayrollCycle(payload: PostEmployeePayrollCyclePayload) {
      return (await httpsCallable<PostEmployeePayrollCyclePayload, PostEmployeePayrollCycleResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.postEmployeePayrollCycle,
      )(payload)).data;
    },
    async postAnnualBonusPayment(payload: PostAnnualBonusPaymentPayload) {
      return (await httpsCallable<PostAnnualBonusPaymentPayload, PostAnnualBonusPaymentResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.postAnnualBonusPayment,
      )(payload)).data;
    },    async recordEmployeeCertificate(payload: RecordEmployeeCertificatePayload) {
      return (await httpsCallable<RecordEmployeeCertificatePayload, RecordEmployeeCertificateResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.recordEmployeeCertificate,
      )(payload)).data;
    },
    async linkExternalReferenceToEmployee(payload: LinkExternalReferenceToEmployeePayload) {
      return (await httpsCallable<LinkExternalReferenceToEmployeePayload, LinkExternalReferenceToEmployeeResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.linkExternalReferenceToEmployee,
      )(payload)).data;
    },
    async createCashClosure(payload: CreateCashClosurePayload) {
      return (await httpsCallable<CreateCashClosurePayload, CreateCashClosureResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.createCashClosure,
      )(payload)).data;
    },
    async closeCashClosure(payload: CloseCashClosurePayload) {
      return (await httpsCallable<CloseCashClosurePayload, CloseCashClosureResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.closeCashClosure,
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
    async editFinancialMovement(payload: EditFinancialMovementPayload) {
      return (await httpsCallable<EditFinancialMovementPayload, EditFinancialMovementResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.editFinancialMovement,
      )(payload)).data;
    },
    async setFinancialMovementBalanceInclusion(payload: SetFinancialMovementBalanceInclusionPayload) {
      return (await httpsCallable<SetFinancialMovementBalanceInclusionPayload, SetFinancialMovementBalanceInclusionResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.setFinancialMovementBalanceInclusion,
      )(payload)).data;
    },
  };
}

export type AccountingCallableApi = ReturnType<typeof createAccountingCallables>;
