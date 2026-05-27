import { httpsCallable, type Functions } from 'firebase/functions';
import { getFirebaseFunctions } from '../../../lib/firebaseFunctions';
import { ACCOUNTING_CALLABLE_NAMES } from '../domain/constants';
import type {
  CloseCashClosurePayload,
  CloseCashClosureResult,
  CreateCashClosurePayload,
  CreateCashClosureResult,
  CreateMercadoPagoCheckoutPayload,
  CreateMercadoPagoCheckoutResult,
  CreateOvertimeEntryPayload,
  CreateOvertimeEntryResult,
  GenerateCuotaPayload,
  GenerateCuotaResult,
  GetMercadoPagoCheckoutStatusPayload,
  GetMercadoPagoCheckoutStatusResult,
  LinkExternalReferenceToEmployeePayload,
  LinkExternalReferenceToEmployeeResult,
  ListEmployeePayrollCyclePayload,
  ListEmployeePayrollCycleResult,
  PostExpenseMovementPayload,
  PostExpenseMovementResult,
  PostEmployeePayrollCyclePayload,
  PostEmployeePayrollCycleResult,
  RecordExternalReferencePayload,
  RecordExternalReferenceResult,
  RecordEmployeeCertificatePayload,
  RecordEmployeeCertificateResult,
  ReconcileMacroSettlementPayload,
  ReconcileMacroSettlementResult,
  RegisterPaymentPayload,
  RegisterPaymentResult,
  ReviewExpensePayload,
  ReviewExpenseResult,
  ReviewOvertimeEntryPayload,
  ReviewOvertimeEntryResult,
  SetCreditCommissionRulePayload,
  SetCreditCommissionRuleResult,
  SubmitExpensePayload,
  SubmitExpenseResult,
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
    async recordEmployeeCertificate(payload: RecordEmployeeCertificatePayload) {
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
    async createMercadoPagoCheckout(payload: CreateMercadoPagoCheckoutPayload) {
      return (await httpsCallable<CreateMercadoPagoCheckoutPayload, CreateMercadoPagoCheckoutResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.createMercadoPagoCheckout,
      )(payload)).data;
    },
    async getMercadoPagoCheckoutStatus(payload: GetMercadoPagoCheckoutStatusPayload) {
      return (await httpsCallable<GetMercadoPagoCheckoutStatusPayload, GetMercadoPagoCheckoutStatusResult>(
        functionsRef,
        ACCOUNTING_CALLABLE_NAMES.getMercadoPagoCheckoutStatus,
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
