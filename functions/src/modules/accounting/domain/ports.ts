import type {
  FinancialMovementDocument,
  FinancialMovementStatus,
  FinancialMovementType,
  FinancialConfigDocument,
  PaymentMethodDocument,
  PaymentCommissionRuleDocument,
  FinancialIncomeCategoryDocument,
  FinancialExpenseCategoryDocument,
  MacroDebitSettlementDocument,
  SalaryConfigurationDocument,
  SalaryPaymentDocument,
  ExternalAccountingReferenceDocument,
  ExpenseSubmissionDocument,
  ConcessionContractDocument,
  CashClosureDocument,
  EmployeeAccountingLinkDocument,
  EmployeeCertificateDocument,
  EmployeePayrollCycleDocument,
  AdvertisingContractDocument,
  HandicapChargeDocument,
  MemberFeeChargeDocument,
  OvertimeEntryDocument,
  PayrollConfigDocument,
  AccountingPeriod,
  EntityWithId,
  ReferencedEmployeeDocument,
  ReferencedFamilyGroupDocument,
  ReferencedHandicapDocument,
  ReferencedMemberDocument,
  ReferencedUserDocument,
  ThirdPartyType,
} from './models.js';
import type { TournamentRegistrationDocument } from '../../tournaments/domain/models.js';

export type StorePatch<T extends object> = {
  [K in keyof T]?: T[K] | null | undefined;
};

export type StoreCreate<T extends object> = {
  [K in keyof T]: T[K] | undefined;
};

export interface CursorPage<T> {
  items: T[];
  nextCursorId?: string;
}

export interface PageInput {
  limit?: number;
  cursorId?: string;
}

export interface MemberReferenceFilters extends PageInput {
  status?: ReferencedMemberDocument['status'];
}

export interface UsersReferenceStore {
  getById(uid: string): Promise<EntityWithId<ReferencedUserDocument> | null>;
}

export interface MembersReferenceStore {
  getById(memberId: string): Promise<EntityWithId<ReferencedMemberDocument> | null>;
  update(memberId: string, patch: StorePatch<ReferencedMemberDocument>, actorUid: string): Promise<void>;
  listPage(filters: MemberReferenceFilters): Promise<CursorPage<EntityWithId<ReferencedMemberDocument>>>;
}

export interface FamilyGroupsReferenceStore {
  getById(groupId: string): Promise<EntityWithId<ReferencedFamilyGroupDocument> | null>;
}

export interface EmployeesReferenceStore {
  getById(employeeId: string): Promise<EntityWithId<ReferencedEmployeeDocument> | null>;
}

export interface HandicapsReferenceStore {
  getById(handicapId: string): Promise<EntityWithId<ReferencedHandicapDocument> | null>;
}

export interface TournamentRegistrationsReferenceStore {
  getById(registrationId: string): Promise<EntityWithId<TournamentRegistrationDocument> | null>;
  update(registrationId: string, patch: StorePatch<TournamentRegistrationDocument>, actorUid: string): Promise<void>;
}

export interface FinancialConfigsStore {
  getById(configId: string): Promise<EntityWithId<FinancialConfigDocument> | null>;
  getActive(): Promise<EntityWithId<FinancialConfigDocument> | null>;
  getLatestVersion(): Promise<EntityWithId<FinancialConfigDocument> | null>;
  create(
    data: StoreCreate<Omit<FinancialConfigDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(configId: string, patch: StorePatch<FinancialConfigDocument>, actorUid: string): Promise<void>;
}

export interface PaymentMethodsStore {
  getById(paymentMethodId: string): Promise<EntityWithId<PaymentMethodDocument> | null>;
  set(
    paymentMethodId: string,
    data: StoreCreate<Omit<PaymentMethodDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<void>;
}

export interface PaymentCommissionRulesStore {
  getById(ruleId: string): Promise<EntityWithId<PaymentCommissionRuleDocument> | null>;
  getActiveByPaymentMethodId(paymentMethodId: string): Promise<EntityWithId<PaymentCommissionRuleDocument> | null>;
  create(
    data: StoreCreate<Omit<PaymentCommissionRuleDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(ruleId: string, patch: StorePatch<PaymentCommissionRuleDocument>, actorUid: string): Promise<void>;
}

export interface FinancialIncomeCategoriesStore {
  getById(categoryId: string): Promise<EntityWithId<FinancialIncomeCategoryDocument> | null>;
  set(
    categoryId: string,
    data: StoreCreate<Omit<FinancialIncomeCategoryDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<void>;
}

export interface FinancialExpenseCategoriesStore {
  getById(categoryId: string): Promise<EntityWithId<FinancialExpenseCategoryDocument> | null>;
  set(
    categoryId: string,
    data: StoreCreate<Omit<FinancialExpenseCategoryDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<void>;
}

export interface FinancialMovementFilters extends PageInput {
  movementType?: FinancialMovementType;
  categoryCodeSnapshot?: string;
  paymentMethodCodeSnapshot?: string;
  thirdPartyType?: ThirdPartyType;
  thirdPartyId?: string;
  accountingPeriod?: AccountingPeriod;
  status?: FinancialMovementStatus;
  installmentPlanId?: string;
  settlementId?: string;
  bancarizado?: boolean;
  imputableImpositivo?: boolean;
}

export interface FinancialMovementsStore {
  getById(movementId: string): Promise<EntityWithId<FinancialMovementDocument> | null>;
  create(
    data: StoreCreate<Omit<FinancialMovementDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(movementId: string, patch: StorePatch<FinancialMovementDocument>, actorUid: string): Promise<void>;
  listPage(filters: FinancialMovementFilters): Promise<CursorPage<EntityWithId<FinancialMovementDocument>>>;
  listBySettlementId(settlementId: string): Promise<Array<EntityWithId<FinancialMovementDocument>>>;
  listByInstallmentPlanId(installmentPlanId: string): Promise<Array<EntityWithId<FinancialMovementDocument>>>;
}

export interface MacroDebitSettlementFilters extends PageInput {
  month?: AccountingPeriod;
  status?: MacroDebitSettlementDocument['status'];
}

export interface MacroDebitSettlementsStore {
  getById(settlementId: string): Promise<EntityWithId<MacroDebitSettlementDocument> | null>;
  getByExternalBatchRef(externalBatchRef: string): Promise<EntityWithId<MacroDebitSettlementDocument> | null>;
  create(
    data: StoreCreate<Omit<MacroDebitSettlementDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(settlementId: string, patch: StorePatch<MacroDebitSettlementDocument>, actorUid: string): Promise<void>;
  listPage(filters: MacroDebitSettlementFilters): Promise<CursorPage<EntityWithId<MacroDebitSettlementDocument>>>;
}

export interface SalaryConfigurationsStore {
  getById(configurationId: string): Promise<EntityWithId<SalaryConfigurationDocument> | null>;
  getActiveByEmployeeId(employeeId: string): Promise<EntityWithId<SalaryConfigurationDocument> | null>;
  create(
    data: StoreCreate<Omit<SalaryConfigurationDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(configurationId: string, patch: StorePatch<SalaryConfigurationDocument>, actorUid: string): Promise<void>;
}

export interface SalaryPaymentsFilters extends PageInput {
  employeeId?: string;
  period?: AccountingPeriod;
  status?: SalaryPaymentDocument['status'];
}

export interface SalaryPaymentsStore {
  getById(paymentId: string): Promise<EntityWithId<SalaryPaymentDocument> | null>;
  findByEmployeeAndPeriod(employeeId: string, period: AccountingPeriod): Promise<EntityWithId<SalaryPaymentDocument> | null>;
  create(
    data: StoreCreate<Omit<SalaryPaymentDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(paymentId: string, patch: StorePatch<SalaryPaymentDocument>, actorUid: string): Promise<void>;
  listPage(filters: SalaryPaymentsFilters): Promise<CursorPage<EntityWithId<SalaryPaymentDocument>>>;
}

export interface PayrollConfigsStore {
  getCurrent(): Promise<EntityWithId<PayrollConfigDocument> | null>;
  setCurrent(
    data: StoreCreate<Omit<PayrollConfigDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<void>;
}

export interface OvertimeEntryFilters extends PageInput {
  employeeId?: string;
  period?: AccountingPeriod;
  status?: OvertimeEntryDocument['status'];
}

export interface OvertimeEntriesStore {
  getById(overtimeEntryId: string): Promise<EntityWithId<OvertimeEntryDocument> | null>;
  create(
    data: StoreCreate<Omit<OvertimeEntryDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(overtimeEntryId: string, patch: StorePatch<OvertimeEntryDocument>, actorUid: string): Promise<void>;
  listPage(filters: OvertimeEntryFilters): Promise<CursorPage<EntityWithId<OvertimeEntryDocument>>>;
  listApprovedByEmployeeAndPeriod(employeeId: string, period: AccountingPeriod): Promise<Array<EntityWithId<OvertimeEntryDocument>>>;
}

export interface EmployeePayrollCycleFilters extends PageInput {
  employeeId?: string;
  period?: AccountingPeriod;
  status?: EmployeePayrollCycleDocument['status'];
}

export interface EmployeePayrollCyclesStore {
  getById(cycleId: string): Promise<EntityWithId<EmployeePayrollCycleDocument> | null>;
  findByEmployeeAndPeriod(employeeId: string, period: AccountingPeriod): Promise<EntityWithId<EmployeePayrollCycleDocument> | null>;
  create(
    data: StoreCreate<Omit<EmployeePayrollCycleDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(cycleId: string, patch: StorePatch<EmployeePayrollCycleDocument>, actorUid: string): Promise<void>;
  listPage(filters: EmployeePayrollCycleFilters): Promise<CursorPage<EntityWithId<EmployeePayrollCycleDocument>>>;
}

export interface EmployeeAccountingLinkFilters extends PageInput {
  employeeId?: string;
  period?: AccountingPeriod;
  referenceId?: string;
  referenceType?: EmployeeAccountingLinkDocument['referenceType'];
}

export interface EmployeeAccountingLinksStore {
  getById(linkId: string): Promise<EntityWithId<EmployeeAccountingLinkDocument> | null>;
  findDuplicate(params: {
    employeeId: string;
    period: AccountingPeriod;
    referenceId: string;
  }): Promise<EntityWithId<EmployeeAccountingLinkDocument> | null>;
  findByEmployeePeriodAndReferenceType(params: {
    employeeId: string;
    period: AccountingPeriod;
    referenceType: EmployeeAccountingLinkDocument['referenceType'];
  }): Promise<EntityWithId<EmployeeAccountingLinkDocument> | null>;
  create(
    data: StoreCreate<Omit<EmployeeAccountingLinkDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(linkId: string, patch: StorePatch<EmployeeAccountingLinkDocument>, actorUid: string): Promise<void>;
  listPage(filters: EmployeeAccountingLinkFilters): Promise<CursorPage<EntityWithId<EmployeeAccountingLinkDocument>>>;
}

export interface EmployeeCertificateFilters extends PageInput {
  employeeId?: string;
  period?: AccountingPeriod;
  certificateType?: string;
  status?: EmployeeCertificateDocument['status'];
}

export interface EmployeeCertificatesStore {
  getById(certificateId: string): Promise<EntityWithId<EmployeeCertificateDocument> | null>;
  create(
    data: StoreCreate<Omit<EmployeeCertificateDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(certificateId: string, patch: StorePatch<EmployeeCertificateDocument>, actorUid: string): Promise<void>;
  listPage(filters: EmployeeCertificateFilters): Promise<CursorPage<EntityWithId<EmployeeCertificateDocument>>>;
}

export interface CashClosureFilters extends PageInput {
  period?: AccountingPeriod;
  status?: CashClosureDocument['status'];
}

export interface CashClosuresStore {
  getById(cashClosureId: string): Promise<EntityWithId<CashClosureDocument> | null>;
  create(
    data: StoreCreate<Omit<CashClosureDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(cashClosureId: string, patch: StorePatch<CashClosureDocument>, actorUid: string): Promise<void>;
  listPage(filters: CashClosureFilters): Promise<CursorPage<EntityWithId<CashClosureDocument>>>;
  listOpen(): Promise<Array<EntityWithId<CashClosureDocument>>>;
}

export interface ExternalAccountingReferencesStore {
  getById(referenceId: string): Promise<EntityWithId<ExternalAccountingReferenceDocument> | null>;
  findByEmployeePeriodAndReferenceType(params: {
    employeeId: string;
    period: AccountingPeriod;
    referenceType: ExternalAccountingReferenceDocument['referenceType'];
  }): Promise<EntityWithId<ExternalAccountingReferenceDocument> | null>;
  create(
    data: StoreCreate<Omit<ExternalAccountingReferenceDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(referenceId: string, patch: StorePatch<ExternalAccountingReferenceDocument>, actorUid: string): Promise<void>;
}

export interface ExpenseSubmissionFilters extends PageInput {
  employeeId?: string;
  status?: ExpenseSubmissionDocument['status'];
}

export interface ExpenseSubmissionsStore {
  getById(expenseSubmissionId: string): Promise<EntityWithId<ExpenseSubmissionDocument> | null>;
  create(
    data: StoreCreate<Omit<ExpenseSubmissionDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(expenseSubmissionId: string, patch: StorePatch<ExpenseSubmissionDocument>, actorUid: string): Promise<void>;
  listPage(filters: ExpenseSubmissionFilters): Promise<CursorPage<EntityWithId<ExpenseSubmissionDocument>>>;
}

export interface ConcessionContractsStore {
  getById(contractId: string): Promise<EntityWithId<ConcessionContractDocument> | null>;
  create(
    data: StoreCreate<Omit<ConcessionContractDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(contractId: string, patch: StorePatch<ConcessionContractDocument>, actorUid: string): Promise<void>;
}

export interface AdvertisingContractsStore {
  getById(contractId: string): Promise<EntityWithId<AdvertisingContractDocument> | null>;
  create(
    data: StoreCreate<Omit<AdvertisingContractDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(contractId: string, patch: StorePatch<AdvertisingContractDocument>, actorUid: string): Promise<void>;
}

export interface HandicapChargeFilters extends PageInput {
  memberId?: string;
  status?: HandicapChargeDocument['status'];
}

export interface HandicapChargesStore {
  getById(handicapChargeId: string): Promise<EntityWithId<HandicapChargeDocument> | null>;
  findByMemberAndPeriod(memberId: string, period: AccountingPeriod): Promise<EntityWithId<HandicapChargeDocument> | null>;
  create(
    data: StoreCreate<Omit<HandicapChargeDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(handicapChargeId: string, patch: StorePatch<HandicapChargeDocument>, actorUid: string): Promise<void>;
  listPage(filters: HandicapChargeFilters): Promise<CursorPage<EntityWithId<HandicapChargeDocument>>>;
}

export interface MemberFeeChargeFilters extends PageInput {
  memberId?: string;
  familyGroupId?: string;
  period?: AccountingPeriod;
  status?: MemberFeeChargeDocument['status'];
}

export interface MemberFeeChargesStore {
  getById(memberFeeChargeId: string): Promise<EntityWithId<MemberFeeChargeDocument> | null>;
  findDuplicate(params: {
    memberId?: string | null;
    familyGroupId?: string | null;
    period: AccountingPeriod;
    billingMode: MemberFeeChargeDocument['billingMode'];
  }): Promise<EntityWithId<MemberFeeChargeDocument> | null>;
  create(
    data: StoreCreate<Omit<MemberFeeChargeDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(memberFeeChargeId: string, patch: StorePatch<MemberFeeChargeDocument>, actorUid: string): Promise<void>;
  listPage(filters: MemberFeeChargeFilters): Promise<CursorPage<EntityWithId<MemberFeeChargeDocument>>>;
}

export interface AccountingDataAccess {
  users: UsersReferenceStore;
  members: MembersReferenceStore;
  familyGroups: FamilyGroupsReferenceStore;
  employees: EmployeesReferenceStore;
  handicaps: HandicapsReferenceStore;
  tournamentRegistrations: TournamentRegistrationsReferenceStore;
  financialConfigs: FinancialConfigsStore;
  paymentMethods: PaymentMethodsStore;
  paymentCommissionRules: PaymentCommissionRulesStore;
  financialIncomeCategories: FinancialIncomeCategoriesStore;
  financialExpenseCategories: FinancialExpenseCategoriesStore;
  financialMovements: FinancialMovementsStore;
  macroDebitSettlements: MacroDebitSettlementsStore;
  salaryConfigurations: SalaryConfigurationsStore;
  salaryPayments: SalaryPaymentsStore;
  payrollConfigs: PayrollConfigsStore;
  overtimeEntries: OvertimeEntriesStore;
  employeePayrollCycles: EmployeePayrollCyclesStore;
  employeeAccountingLinks: EmployeeAccountingLinksStore;
  employeeCertificates: EmployeeCertificatesStore;
  cashClosures: CashClosuresStore;
  externalAccountingReferences: ExternalAccountingReferencesStore;
  expenseSubmissions: ExpenseSubmissionsStore;
  concessionContracts: ConcessionContractsStore;
  advertisingContracts: AdvertisingContractsStore;
  handicapCharges: HandicapChargesStore;
  memberFeeCharges: MemberFeeChargesStore;
}

export interface AccountingTransactionManager {
  runInTransaction<T>(handler: (dataAccess: AccountingDataAccess) => Promise<T>): Promise<T>;
  getDataAccess(): AccountingDataAccess;
}

export interface Clock {
  now(): Date;
}
