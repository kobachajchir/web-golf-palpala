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
export type ThirdPartyType = 'member' | 'employee' | 'vendor' | 'association' | 'tenant' | 'advertiser' | 'external';
export type BillingMode = 'per_member' | 'single_group_charge';
export type MemberFeeChargeStatus = 'pending' | 'paid' | 'exempt' | 'cancelled' | 'overdue';
export type ExpenseSubmissionStatus = 'submitted' | 'approved' | 'rejected' | 'posted';
export type SalaryPaymentStatus = 'draft' | 'posted' | 'voided';
export type SalaryPeriodicity = 'monthly' | 'daily' | 'hourly' | 'seasonal' | 'honorarios';
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
  cantineroContractMode: 'fixed_monthly' | 'fixed_plus_variable';
  advertisingDefaultPeriodicity: 'monthly' | 'one_time';
  requireApprovalForExpensePosting: boolean;
  requireApprovalForOvertimePosting: boolean;
  notes?: string | null;
}

export interface PaymentMethodDocument extends AuditFields {
  name: string;
  bancarizado: boolean;
  specialReportingType?: 'macro_debit' | null;
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
  bancarizado: boolean;
  imputableImpositivo: boolean;
  settlementId?: DocId | null;
  registeredByUid: UID;
  approvedByUid?: UID | null;
  approvedAt?: Timestamp | null;
  reversalOfMovementId?: DocId | null;
  voidReason?: string | null;
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
  paidAt?: Timestamp | null;
  paidAmountMinor?: AmountMinor | null;
  paymentDiscountPctBps?: Bps | null;
  paymentDiscountAmountMinor?: AmountMinor | null;
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
  notes?: string | null;
}

export interface ExternalAccountingReferenceDocument extends AuditFields {
  referenceType: ExternalReferenceType;
  providerName?: string | null;
  period: AccountingPeriod;
  referenceNumber?: string | null;
  amountMinor: AmountMinor;
  dueDate?: Timestamp | null;
  documentDate?: Timestamp | null;
  attachmentUrl?: string | null;
  linkedMovementId?: DocId | null;
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
  netAmountMinor: AmountMinor;
  duplicate: boolean;
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
  cantineroContractMode: 'fixed_monthly' | 'fixed_plus_variable';
  advertisingDefaultPeriodicity: 'monthly' | 'one_time';
  requireApprovalForExpensePosting: boolean;
  requireApprovalForOvertimePosting: boolean;
  notes?: string | null;
}

export interface UpsertFinancialConfigResult {
  configId: DocId;
  version: number;
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
  referenceType: ExternalReferenceType;
  period: AccountingPeriod;
  amountMinor: AmountMinor;
  providerName?: string | null;
  referenceNumber?: string | null;
  dueDate?: string | null;
  documentDate?: string | null;
  attachmentUrl?: string | null;
  linkedMovementId?: DocId | null;
  notes?: string | null;
}

export interface RecordExternalReferenceResult {
  referenceId: DocId;
  status: 'recorded' | 'linked';
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
