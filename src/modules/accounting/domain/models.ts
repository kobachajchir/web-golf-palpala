import type { Timestamp } from 'firebase/firestore';

export type UID = string;
export type DocId = string;
export type AmountMinor = number;
export type Bps = number;
export type AccountingPeriod = `${number}-${number}${number}`;

export interface AuditFields {
  createdAt: Timestamp;
  createdBy: UID;
  updatedAt: Timestamp;
  updatedBy: UID;
  isDeleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: UID;
}

export type EntityWithId<T extends object> = T & { id: DocId };

export type FinancialMovementType = 'income' | 'expense';
export type FinancialMovementStatus = 'draft' | 'pending' | 'posted' | 'voided' | 'reversed';
export type InstallmentMovementRole = 'charge' | 'payment';
export type ThirdPartyType = 'member' | 'employee' | 'vendor' | 'association' | 'tenant' | 'advertiser' | 'external';
export type BillingMode = 'per_member' | 'single_group_charge';
export type MemberFeeChargeStatus = 'pending' | 'paid' | 'exempt' | 'cancelled' | 'overdue';
export type ExpenseSubmissionStatus = 'submitted' | 'approved' | 'rejected' | 'posted';
export type SalaryPaymentStatus = 'draft' | 'ready_to_liquidate' | 'liquidated' | 'paid' | 'posted' | 'voided';
export type SalaryPeriodicity = 'monthly' | 'daily' | 'hourly' | 'seasonal' | 'honorarios';
export type OvertimeEntryStatus = 'submitted' | 'approved' | 'rejected' | 'liquidated';
export type EmployeePayrollCycleStatus = 'draft' | 'ready_to_liquidate' | 'liquidated' | 'paid' | 'ready' | 'posted' | 'voided';
export type EmployeeAccountingLinkStatus = 'recorded' | 'linked' | 'paid';
export type EmployeeCertificateStatus = 'active' | 'expired' | 'archived';
export type CashClosureStatus = 'open' | 'closed' | 'voided';
export type MacroDebitSettlementStatus = 'imported' | 'reconciled' | 'closed';
export type ExternalReferenceType = 'F931' | 'OBRA_SOCIAL' | 'ART' | 'OTHER';
export type ExternalReferenceStatus = 'recorded' | 'linked' | 'paid';
export type HandicapChargeStatus = 'pending_collection' | 'collected' | 'transferred' | 'closed';
export interface FinancialConfigDocument extends AuditFields {
  version: number;
  isActive: boolean;
  effectiveFrom: Timestamp;
  effectiveTo?: Timestamp | null;
  currency: 'ARS';
  fullMemberFeeMinor: AmountMinor;
  familyAssociatePctBps: Bps;
  lifetimePctBps: Bps;
  minorPctBps: Bps;
  licensePctBps: Bps;
  maxLicenseMonths: number;
  creditCommissionPctBps: Bps;
  earlyPaymentDiscountPctBps?: Bps | null;
  earlyPaymentDiscountDayOfMonth?: number | null;
  familyGroupBillingMode: BillingMode;
  allowStandaloneMinor: boolean;
  membershipChargePersistenceMode: 'member_fee_charges';
  greenFeeAppliesToMembers: boolean;
  memberGreenFeeWeekdayMinor?: AmountMinor | null;
  memberGreenFeeSaturdayHolidayMinor?: AmountMinor | null;
  guestGreenFeeWeekdayMinor?: AmountMinor | null;
  guestGreenFeeSaturdayHolidayMinor?: AmountMinor | null;
  minorGreenFeeSaturdayHolidayPctBps?: Bps | null;
  nationalHolidayDates?: string[];
  cantineroContractMode: 'fixed_monthly' | 'fixed_plus_variable';
  advertisingDefaultPeriodicity: 'monthly' | 'one_time';
  requireApprovalForExpensePosting: boolean;
  requireApprovalForOvertimePosting: boolean;
  serverMonthlyExpenseMinor?: AmountMinor | null;
  serverMonthlyExpenseDueDay?: number | null;
  notes?: string | null;
}

export interface PaymentMethodDocument extends AuditFields {
  name: string;
  bancarizado: boolean;
  specialReportingType?: 'macro_debit' | null;
  active: boolean;
  sortOrder: number;
  activeCommissionPctBps?: Bps | null;
  activeCommissionBreakdown?: PaymentCommissionBreakdownItem[];
}

export interface PaymentCommissionBreakdownItem {
  id: DocId;
  label: string;
  percentageBps: Bps;
  isActive: boolean;
}

export interface PaymentCommissionRuleDocument extends AuditFields {
  paymentMethodId: DocId;
  percentageBps: Bps;
  isActive: boolean;
  validFrom: Timestamp;
  validTo?: Timestamp | null;
  setByUid: UID;
  breakdown?: PaymentCommissionBreakdownItem[];
  notes?: string | null;
}

export interface FinancialIncomeCategoryDocument extends AuditFields {
  name: string;
  description?: string | null;
  originType: string;
  active: boolean;
  sortOrder: number;
}

export interface FinancialExpenseCategoryDocument extends AuditFields {
  name: string;
  description?: string | null;
  defaultBancarizado: boolean;
  defaultImputableImpositivo: boolean;
  active: boolean;
  sortOrder: number;
}

export interface FinancialMovementDocument extends AuditFields {
  movementType: FinancialMovementType;
  categoryId: DocId;
  categoryCodeSnapshot: string;
  status: FinancialMovementStatus;
  operationDate: Timestamp;
  postingDate?: Timestamp | null;
  accountingPeriod: AccountingPeriod;
  originType: string;
  originCollection?: string | null;
  originId?: DocId | null;
  thirdPartyType?: ThirdPartyType | null;
  thirdPartyId?: DocId | null;
  paymentMethodId?: DocId | null;
  paymentMethodCodeSnapshot?: string | null;
  grossAmountMinor: AmountMinor;
  appliedCommissionPctBps?: Bps | null;
  appliedCommissionAmountMinor?: AmountMinor | null;
  netAmountMinor: AmountMinor;
  installmentPlanId?: DocId | null;
  installmentRole?: InstallmentMovementRole | null;
  installmentNumber?: number | null;
  installmentCount?: number | null;
  installmentBaseAmountMinor?: AmountMinor | null;
  installmentInterestPctBps?: Bps | null;
  installmentInterestAmountMinor?: AmountMinor | null;
  installmentTotalAmountMinor?: AmountMinor | null;
  installmentScheduledAmountMinor?: AmountMinor | null;
  installmentPaidAmountMinor?: AmountMinor | null;
  installmentPaidCount?: number | null;
  bancarizado: boolean;
  imputableImpositivo: boolean;
  settlementId?: DocId | null;
  registeredByUid: UID;
  approvedByUid?: UID | null;
  approvedAt?: Timestamp | null;
  reversalOfMovementId?: DocId | null;
  voidReason?: string | null;
  excludeFromBalance?: boolean;
  balanceExclusionReason?: string | null;
  balanceExcludedAt?: Timestamp | null;
  balanceExcludedByUid?: UID | null;
  metadata?: Record<string, unknown>;
  notes?: string | null;
}

export interface MacroDebitSettlementDocument extends AuditFields {
  month: AccountingPeriod;
  bankName: string;
  externalBatchRef: string;
  grossAmountMinor: AmountMinor;
  commissionAmountMinor: AmountMinor;
  netAmountMinor: AmountMinor;
  movementCount: number;
  status: MacroDebitSettlementStatus;
  statementFileUrl?: string | null;
  accreditedAt: Timestamp;
  importedByUid: UID;
  notes?: string | null;
}

export interface SalaryConfigurationDocument extends AuditFields {
  employeeId: DocId;
  contractType: string;
  baseAmountMinor: AmountMinor;
  periodicity: SalaryPeriodicity;
  effectiveFrom: Timestamp;
  effectiveTo?: Timestamp | null;
  isActive: boolean;
  allowOvertime: boolean;
  notes?: string | null;
  setByUid: UID;
}

export interface MemberFeeChargeDocument extends AuditFields {
  memberId?: DocId | null;
  familyGroupId?: DocId | null;
  holderMemberId?: DocId | null;
  period: AccountingPeriod;
  configVersion: number;
  memberTypeCodeSnapshot: string;
  billingMode: BillingMode;
  baseAmountMinor: AmountMinor;
  appliedPctBps: Bps;
  finalAmountMinor: AmountMinor;
  status: MemberFeeChargeStatus;
  dueDate?: Timestamp | null;
  generatedByUid: UID;
  paidMovementId?: DocId | null;
  paymentMovementIds?: DocId[];
  paidAt?: Timestamp | null;
  paidAmountMinor?: AmountMinor | null;
  settlementAmountMinor?: AmountMinor | null;
  paidClubAmountMinor?: AmountMinor | null;
  remainingAmountMinor?: AmountMinor | null;
  paymentDiscountPctBps?: Bps | null;
  paymentDiscountAmountMinor?: AmountMinor | null;
  paymentDiscountMode?: 'automatic' | 'manual' | 'none' | null;
  notes?: string | null;
}

export interface ExpenseSubmissionDocument extends AuditFields {
  employeeId: DocId;
  categoryId: DocId;
  categoryCodeSnapshot: string;
  description: string;
  expenseDate: Timestamp;
  amountMinor: AmountMinor;
  liters?: number | null;
  vendorName?: string | null;
  receiptFileUrl?: string | null;
  status: ExpenseSubmissionStatus;
  reviewedByUid?: UID | null;
  reviewedAt?: Timestamp | null;
  rejectionReason?: string | null;
  linkedMovementId?: DocId | null;
  paymentMethodId?: DocId | null;
}

export interface SalaryPaymentDocument extends AuditFields {
  employeeId: DocId;
  period: AccountingPeriod;
  salaryConfigurationId: DocId;
  salaryGrossMinor: AmountMinor;
  overtimeHours?: number | null;
  overtimeAmountMinor?: AmountMinor | null;
  overtimeBancarizado: boolean;
  overtimeImputableImpositivo: boolean;
  bankedAmountMinor: AmountMinor;
  nonBankedAmountMinor: AmountMinor;
  linkedExternalReferenceIds?: DocId[];
  financialMovementIds: DocId[];
  status: SalaryPaymentStatus;
  approvedByUid?: UID | null;
  liquidatedAt?: Timestamp | null;
  liquidatedByUid?: UID | null;
  paidAt?: Timestamp | null;
  paidByUid?: UID | null;
  paymentMethodId?: DocId | null;
  notes?: string | null;
}

export interface PayrollConfigDocument extends AuditFields {
  paymentDay: number;
  prepareReceiptsDaysBefore?: number | null;
  isActive: boolean;
  effectiveFrom: Timestamp;
}

export interface OvertimeEntryDocument extends AuditFields {
  employeeId: DocId;
  period: AccountingPeriod;
  workDate: Timestamp;
  hours: number;
  amountMinor: AmountMinor;
  reason: string;
  status: OvertimeEntryStatus;
  createdByUid: UID;
  approvedByUid?: UID | null;
  approvedAt?: Timestamp | null;
  rejectionReason?: string | null;
  linkedSalaryPaymentId?: DocId | null;
  linkedMovementId?: DocId | null;
  notes?: string | null;
}

export interface EmployeePayrollCycleDocument extends AuditFields {
  employeeId: DocId;
  period: AccountingPeriod;
  salaryPaymentId?: DocId | null;
  salaryConfigurationId?: DocId | null;
  salaryGrossMinor: AmountMinor;
  overtimeTotalHours: number;
  overtimeTotalMinor: AmountMinor;
  bankedAmountMinor: AmountMinor;
  nonBankedAmountMinor: AmountMinor;
  linkedReferenceIds: DocId[];
  linkedCertificateIds: DocId[];
  financialMovementIds: DocId[];
  status: EmployeePayrollCycleStatus;
  paidAt?: Timestamp | null;
  notes?: string | null;
}

export interface EmployeeAccountingLinkDocument extends AuditFields {
  employeeId: DocId;
  period: AccountingPeriod;
  referenceId: DocId;
  referenceType: ExternalReferenceType;
  allocatedAmountMinor?: AmountMinor | null;
  paidAt?: Timestamp | null;
  status: EmployeeAccountingLinkStatus;
  notes?: string | null;
}

export interface EmployeeCertificateDocument extends AuditFields {
  employeeId: DocId;
  period: AccountingPeriod;
  certificateType: string;
  documentNumber?: string | null;
  issuedAt?: Timestamp | null;
  expiresAt?: Timestamp | null;
  attachmentUrl?: string | null;
  status: EmployeeCertificateStatus;
  notes?: string | null;
}

export interface CashClosureDocument extends AuditFields {
  period: AccountingPeriod;
  closureDate: Timestamp;
  openedByUid: UID;
  openingBalanceMinor?: AmountMinor | null;
  closedByUid?: UID | null;
  closedAt?: Timestamp | null;
  cashExpectedMinor: AmountMinor;
  expectedByPaymentMethod?: Record<string, AmountMinor>;
  cashCountedMinor?: AmountMinor | null;
  differenceMinor?: AmountMinor | null;
  movementIds: DocId[];
  status: CashClosureStatus;
  notes?: string | null;
}

export interface ExternalAccountingReferenceDocument extends AuditFields {
  employeeId?: DocId | null;
  referenceType: ExternalReferenceType;
  providerName?: string | null;
  period: AccountingPeriod;
  referenceNumber?: string | null;
  amountMinor: AmountMinor;
  dueDate?: Timestamp | null;
  documentDate?: Timestamp | null;
  attachmentUrl?: string | null;
  linkedMovementId?: DocId | null;
  paidAt?: Timestamp | null;
  paidByUid?: UID | null;
  status: ExternalReferenceStatus;
  notes?: string | null;
}

export interface HandicapChargeDocument extends AuditFields {
  memberId: DocId;
  handicapId?: DocId | null;
  period: AccountingPeriod;
  collectionAmountMinor: AmountMinor;
  transferAmountMinor: AmountMinor;
  associationName: string;
  incomeMovementId?: DocId | null;
  expenseMovementId?: DocId | null;
  status: HandicapChargeStatus;
  transferDueDate?: Timestamp | null;
  notes?: string | null;
}

export interface GenerateCuotaPayload {
  memberId: DocId;
  period: AccountingPeriod;
  dueDate?: string;
  notes?: string | null;
  forceAdministrativeExceptionReason?: string | null;
}

export interface GenerateCuotaResult {
  memberFeeChargeId: DocId;
  status: MemberFeeChargeStatus;
  duplicate: boolean;
}

export interface RegisterPaymentPayload {
  sourceType: string;
  sourceId?: DocId | null;
  memberId?: DocId | null;
  thirdPartyType?: ThirdPartyType | null;
  thirdPartyId?: DocId | null;
  categoryId: DocId;
  paymentMethodId: DocId;
  paymentReference?: string | null;
  grossAmountMinor: AmountMinor;
  operationDate: string;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RegisterPaymentResult {
  movementId: DocId;
  grossAmountMinor: AmountMinor;
  netAmountMinor: AmountMinor;
  appliedCommissionPctBps?: Bps | null;
  appliedCommissionAmountMinor?: AmountMinor | null;
  duplicate: boolean;
  receiptNumber?: string | null;
}

export interface RegisterMemberFeeBatchPaymentPayload {
  allocations: Array<{
    chargeId?: DocId;
    memberId?: DocId;
    period?: AccountingPeriod;
    amountMinor?: AmountMinor;
    settlementAmountMinor?: AmountMinor;
    applyEarlyPaymentDiscount?: boolean;
  }>;
  paymentMethodId: DocId;
  operationDate: string;
  paymentReference?: string | null;
  notes?: string | null;
  idempotencyKey?: string;
}

export interface RegisterMemberFeeBatchPaymentResult {
  memberId: DocId;
  movementId: DocId;
  grossAmountMinor: AmountMinor;
  netAmountMinor: AmountMinor;
  appliedCommissionPctBps?: Bps | null;
  appliedCommissionAmountMinor?: AmountMinor | null;
  receiptNumber: string;
  completedChargeIds: DocId[];
  remainingChargeIds: DocId[];
}

export interface ReconcileMemberFeeRenewalsPayload {
  period: AccountingPeriod;
  execute?: boolean;
}

export interface ReconcileMemberFeeRenewalsResult {
  period: AccountingPeriod;
  mode: 'dry-run' | 'execute';
  scannedMovementCount: number;
  feeMovementCount: number;
  scannedPeriodChargeCount: number;
  matchedAllocationCount: number;
  alreadySynchronizedCount: number;
  repairedChargeCount: number;
  repairedMemberCount: number;
  ambiguousCount: number;
  skipped: Array<{
    movementId: DocId;
    memberId: DocId | null;
    memberName: string | null;
    memberNumber: string | null;
    reason: string;
  }>;
  repairs: Array<{
    movementId: DocId;
    chargeId: DocId;
    memberId: DocId;
    memberName: string | null;
    memberNumber: string | null;
    chargePeriod: AccountingPeriod;
    source: 'payment_allocation' | 'origin_charge' | 'period_member';
    appliedAmountMinor: AmountMinor;
    remainingAmountMinor: AmountMinor;
    completed: boolean;
  }>;
}

export interface CreateInstallmentPlanPayload {
  movementType: FinancialMovementType;
  categoryId: DocId;
  baseAmountMinor: AmountMinor;
  installmentCount?: number;
  interestPctBps: Bps;
  operationDate: string;
  thirdPartyType?: ThirdPartyType | null;
  thirdPartyId?: DocId | null;
  paymentReference?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateInstallmentPlanResult {
  movementId: DocId;
  installmentPlanId: DocId;
  installmentCount: number | null;
  interestAmountMinor: AmountMinor;
  totalAmountMinor: AmountMinor;
  monthlyInterestAmountsMinor: AmountMinor[];
  installmentAmountsMinor: AmountMinor[];
}

export interface RegisterInstallmentPaymentPayload {
  installmentPlanId: DocId;
  paymentMethodId: DocId;
  operationDate: string;
  amountMinor?: AmountMinor;
  paymentReference?: string | null;
  notes?: string | null;
}

export interface RegisterInstallmentPaymentResult {
  movementId: DocId;
  installmentPlanId: DocId;
  installmentNumber: number;
  installmentCount: number | null;
  scheduledAmountMinor: AmountMinor;
  grossAmountMinor: AmountMinor;
  netAmountMinor: AmountMinor;
  paidAmountMinor: AmountMinor;
  totalAmountMinor: AmountMinor;
  completed: boolean;
  receiptNumber?: string | null;
}

export interface MyReceiptRecord {
  id: DocId;
  receiptNumber: string;
  movementId: DocId;
  categoryId: DocId;
  concept: string;
  operationDate: string;
  accountingPeriod: string;
  paymentMethodId: DocId | null;
  grossAmountMinor: AmountMinor;
  netAmountMinor: AmountMinor;
  appliedCommissionPctBps: Bps | null;
  appliedCommissionAmountMinor: AmountMinor | null;
  paymentReference: string | null;
  notes: string | null;
  status: FinancialMovementStatus;
}

export interface ListMyReceiptsResult {
  receipts: MyReceiptRecord[];
}

export interface UpsertFinancialConfigPayload {
  effectiveFrom?: string;
  fullMemberFeeMinor: AmountMinor;
  familyAssociatePctBps: Bps;
  lifetimePctBps: Bps;
  minorPctBps: Bps;
  licensePctBps: Bps;
  maxLicenseMonths: number;
  creditCommissionPctBps?: Bps;
  earlyPaymentDiscountPctBps?: Bps;
  earlyPaymentDiscountDayOfMonth?: number;
  familyGroupBillingMode: BillingMode;
  allowStandaloneMinor: boolean;
  membershipChargePersistenceMode: 'member_fee_charges';
  greenFeeAppliesToMembers: boolean;
  memberGreenFeeWeekdayMinor?: AmountMinor | null;
  memberGreenFeeSaturdayHolidayMinor?: AmountMinor | null;
  guestGreenFeeWeekdayMinor?: AmountMinor | null;
  guestGreenFeeSaturdayHolidayMinor?: AmountMinor | null;
  minorGreenFeeSaturdayHolidayPctBps?: Bps | null;
  nationalHolidayDates?: string[];
  cantineroContractMode: 'fixed_monthly' | 'fixed_plus_variable';
  advertisingDefaultPeriodicity: 'monthly' | 'one_time';
  requireApprovalForExpensePosting: boolean;
  requireApprovalForOvertimePosting: boolean;
  serverMonthlyExpenseMinor?: AmountMinor | null;
  serverMonthlyExpenseDueDay?: number | null;
  notes?: string | null;
}

export interface UpsertFinancialConfigResult {
  configId: DocId;
  version: number;
}

export interface SetCreditCommissionRulePayload {
  percentageBps: Bps;
  validFrom?: string;
  notes?: string | null;
}

export interface SetCreditCommissionRuleResult {
  ruleId: DocId;
  percentageBps: Bps;
}

export interface UpsertSalaryConfigurationPayload {
  employeeId: DocId;
  contractType: string;
  baseAmountMinor: AmountMinor;
  periodicity: SalaryPeriodicity;
  effectiveFrom: string;
  allowOvertime?: boolean;
  notes?: string | null;
}

export interface UpsertSalaryConfigurationResult {
  salaryConfigurationId: DocId;
}

export interface UpsertPayrollConfigPayload {
  paymentDay: number;
  prepareReceiptsDaysBefore?: number | null;
  effectiveFrom?: string;
}

export interface UpsertPayrollConfigResult {
  payrollConfigId: 'current';
  paymentDay: number;
  prepareReceiptsDaysBefore: number | null;
}

export interface ReviewExpensePayload {
  expenseSubmissionId: DocId;
  decision: 'approved' | 'rejected';
  rejectionReason?: string | null;
}

export interface SubmitExpensePayload {
  employeeId: DocId;
  categoryId: DocId;
  description: string;
  expenseDate: string;
  amountMinor: AmountMinor;
  liters?: number | null;
  vendorName?: string | null;
  receiptFileUrl?: string | null;
  paymentMethodId?: DocId | null;
}

export interface SubmitExpenseResult {
  expenseSubmissionId: DocId;
}

export interface RegisterExpenseMovementPayload {
  categoryId: DocId;
  employeeId?: DocId | null;
  description?: string | null;
  amountMinor: AmountMinor;
  vendorName?: string | null;
  paymentMethodId: DocId;
  metadata?: Record<string, unknown>;
  notes?: string | null;
}

export interface RegisterExpenseMovementResult {
  movementId: DocId;
  netAmountMinor: AmountMinor;
}

export interface TransferFundsPayload {
  sourcePaymentMethodId: DocId;
  destinationPaymentMethodId: DocId;
  amountMinor: AmountMinor;
  operationDate: string;
  reference?: string | null;
  notes?: string | null;
}

export interface TransferFundsResult {
  outgoingMovementId: DocId;
  incomingMovementId: DocId;
  amountMinor: AmountMinor;
  reference: string;
}

export interface EditInternalTransferPayload {
  movementId: DocId;
  sourcePaymentMethodId: DocId;
  destinationPaymentMethodId: DocId;
  reference?: string | null;
  notes?: string | null;
  reason: string;
}

export interface EditInternalTransferResult {
  outgoingMovementId: DocId;
  incomingMovementId: DocId;
  reference: string;
}

export interface CreateHandicapChargePayload {
  memberId: DocId;
  handicapId?: DocId | null;
  period: AccountingPeriod;
  collectionAmountMinor: AmountMinor;
  transferAmountMinor: AmountMinor;
  associationName: string;
  transferDueDate?: string | null;
  notes?: string | null;
  collectNow?: boolean;
  paymentMethodId?: DocId | null;
  operationDate?: string;
}

export interface CreateHandicapChargeResult {
  handicapChargeId: DocId;
  incomeMovementId?: DocId;
  receiptNumber?: string | null;
  grossAmountMinor?: AmountMinor;
  duplicate: boolean;
}

export interface TransferHandicapToAssociationPayload {
  handicapChargeId: DocId;
  paymentMethodId?: DocId | null;
  operationDate?: string;
  notes?: string | null;
}

export interface TransferHandicapToAssociationResult {
  handicapChargeId: DocId;
  expenseMovementId: DocId;
  duplicate: boolean;
}

export interface TransferPendingHandicapToAssociationPayload {
  associationName?: string | null;
  paymentMethodId?: DocId | null;
  operationDate?: string;
  notes?: string | null;
}

export interface TransferPendingHandicapToAssociationResult {
  expenseMovementId: DocId;
  handicapChargeIds: DocId[];
  amountMinor: AmountMinor;
  duplicate: boolean;
}

export interface ReviewExpenseResult {
  expenseSubmissionId: DocId;
  status: 'approved' | 'rejected';
}

export interface PostExpenseMovementPayload {
  expenseSubmissionId: DocId;
  notes?: string | null;
}

export interface PostExpenseMovementResult {
  movementId: DocId;
  duplicate: boolean;
}

export interface RecordExternalReferencePayload {
  employeeId?: DocId | null;
  referenceType: ExternalReferenceType;
  period: AccountingPeriod;
  amountMinor: AmountMinor;
  allocatedAmountMinor?: AmountMinor | null;
  providerName?: string | null;
  referenceNumber?: string | null;
  dueDate?: string | null;
  documentDate?: string | null;
  attachmentUrl?: string | null;
  linkedMovementId?: DocId | null;
  paidAt?: string | null;
  notes?: string | null;
}

export interface RecordExternalReferenceResult {
  referenceId: DocId;
  status: 'recorded' | 'linked' | 'paid';
}

export interface UpsertEmployeeExternalReferencePayload extends RecordExternalReferencePayload {
  employeeId: DocId;
}

export interface UpsertEmployeeExternalReferenceResult {
  referenceId: DocId;
  linkId: DocId;
  status: 'recorded' | 'linked' | 'paid';
  duplicate: boolean;
}

export interface ReconcileMacroSettlementPayload {
  settlementId: DocId;
  expectedGrossAmountMinor?: AmountMinor;
  expectedCommissionAmountMinor?: AmountMinor;
  expectedNetAmountMinor?: AmountMinor;
  close?: boolean;
}

export interface ReconcileMacroSettlementResult {
  settlementId: DocId;
  status: 'reconciled' | 'closed';
  movementCount: number;
}

export interface VoidFinancialMovementPayload {
  movementId: DocId;
  reason: string;
}

export interface VoidFinancialMovementResult {
  movementId: DocId;
  reversalMovementId?: DocId;
  duplicate: boolean;
}

export interface EditFinancialMovementPayload {
  movementId: DocId;
  categoryId: DocId;
  paymentMethodId?: DocId | null;
  grossAmountMinor: AmountMinor;
  operationDate: string;
  description?: string | null;
  paymentReference?: string | null;
  thirdPartyLabel?: string | null;
  notes?: string | null;
  reason: string;
}

export interface EditFinancialMovementResult {
  movementId: DocId;
  status: 'posted';
}

export interface SetFinancialMovementBalanceInclusionPayload {
  movementId: DocId;
  excluded: boolean;
  reason: string;
}

export interface SetFinancialMovementBalanceInclusionResult {
  movementId: DocId;
  excluded: boolean;
  affectedMovementIds: DocId[];
}

export interface CreateOvertimeEntryPayload {
  employeeId: DocId;
  period: AccountingPeriod;
  workDate: string;
  hours: number;
  amountMinor: AmountMinor;
  reason: string;
  notes?: string | null;
}

export interface CreateOvertimeEntryResult {
  overtimeEntryId: DocId;
  status: OvertimeEntryStatus;
}

export interface ReviewOvertimeEntryPayload {
  overtimeEntryId: DocId;
  decision: 'approved' | 'rejected';
  rejectionReason?: string | null;
}

export interface ReviewOvertimeEntryResult {
  overtimeEntryId: DocId;
  status: OvertimeEntryStatus;
}

export type AnnualBonusReferenceSource = 'salary_payment' | 'payroll_cycle' | 'active_salary_configuration';

export interface AnnualBonusPreview {
  period: AccountingPeriod;
  year: number;
  semester: 1 | 2;
  semesterPeriods: AccountingPeriod[];
  referenceAmountMinor: AmountMinor;
  referencePeriod: AccountingPeriod | null;
  referenceSource: AnnualBonusReferenceSource | null;
  defaultAmountMinor: AmountMinor;
  alreadyPosted: boolean;
  existingMovementId: DocId | null;
  existingAmountMinor: AmountMinor | null;
  postedAnnualBonusCount: number;
  remainingAnnualSlots: number;
}

export interface ListEmployeePayrollCyclePayload {
  employeeId: DocId;
  period: AccountingPeriod;
}

export interface ListEmployeePayrollCycleResult {
  payrollCycle: EntityWithId<EmployeePayrollCycleDocument> | null;
  salaryPayment: EntityWithId<SalaryPaymentDocument> | null;
  overtimeEntries: Array<EntityWithId<OvertimeEntryDocument>>;
  accountingLinks: Array<EntityWithId<EmployeeAccountingLinkDocument>>;
  certificates: Array<EntityWithId<EmployeeCertificateDocument>>;
  annualBonusPreview: AnnualBonusPreview;
}

export interface PostEmployeePayrollCyclePayload {
  employeeId: DocId;
  period: AccountingPeriod;
  salaryConfigurationId?: DocId | null;
  salaryGrossMinor?: AmountMinor;
  bankedAmountMinor?: AmountMinor;
  nonBankedAmountMinor?: AmountMinor;
  linkedExternalReferenceIds?: DocId[];
  operationDate?: string;
  notes?: string | null;
}

export interface PostEmployeePayrollCycleResult {
  payrollCycleId: DocId;
  salaryPaymentId: DocId;
  financialMovementIds: DocId[];
  duplicate: boolean;
}

export interface PostAnnualBonusPaymentPayload {
  employeeId: DocId;
  amountMinor?: AmountMinor;
  period?: AccountingPeriod;
  paymentMethodId?: DocId | null;
  operationDate: string;
  notes?: string | null;
}

export interface PostAnnualBonusPaymentResult {
  movementId: DocId;
  amountMinor: AmountMinor;
  defaultAmountMinor: AmountMinor;
  bonusNumber: number;
  remainingAnnualSlots: number;
  period: AccountingPeriod;
  year: number;
  semester: 1 | 2;
  referenceAmountMinor: AmountMinor;
  referencePeriod: AccountingPeriod | null;
}
export interface RecordEmployeeCertificatePayload {
  employeeId: DocId;
  period: AccountingPeriod;
  certificateType: string;
  documentNumber?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  attachmentUrl?: string | null;
  notes?: string | null;
}

export interface RecordEmployeeCertificateResult {
  certificateId: DocId;
  status: EmployeeCertificateStatus;
}

export interface LinkExternalReferenceToEmployeePayload {
  employeeId: DocId;
  period: AccountingPeriod;
  referenceId: DocId;
  allocatedAmountMinor?: AmountMinor | null;
  paidAt?: string | null;
  notes?: string | null;
}

export interface LinkExternalReferenceToEmployeeResult {
  linkId: DocId;
  duplicate: boolean;
}

export interface CreateCashClosurePayload {
  period: AccountingPeriod;
  closureDate: string;
  openingBalanceMinor?: AmountMinor;
  movementIds?: DocId[];
  notes?: string | null;
}

export interface CreateCashClosureResult {
  cashClosureId: DocId;
  cashExpectedMinor: AmountMinor;
  expectedByPaymentMethod?: Record<string, AmountMinor>;
  movementCount: number;
}

export interface CloseCashClosurePayload {
  cashClosureId: DocId;
  cashCountedMinor: AmountMinor;
  notes?: string | null;
}

export interface CloseCashClosureResult {
  cashClosureId: DocId;
  status: CashClosureStatus;
  differenceMinor: AmountMinor;
}
