import type { Timestamp } from 'firebase-admin/firestore';
import type {
  Actor as UsersActor,
  EmployeeDocument,
  EntityWithId as UsersEntityWithId,
  FamilyGroupDocument,
  HandicapDocument,
  MemberDocument,
  UserDocument,
} from '../../users/domain/models.js';

export type UID = string;
export type DocId = string;
export type AmountMinor = number;
export type Bps = number;
export type AccountingPeriod = string;
export type CurrencyCode = 'ARS';
export type FamilyGroupBillingMode = 'per_member' | 'single_group_charge';
export type MembershipChargePersistenceMode = 'member_fee_charges';
export type CantineroContractMode = 'fixed_monthly' | 'fixed_plus_variable';
export type AdvertisingDefaultPeriodicity = 'monthly' | 'one_time';

export type PaymentMethodId = 'debit_macro' | 'debit' | 'transfer' | 'credit' | 'cash' | 'mercado_pago';
export type PaymentMethodSpecialReportingType = 'macro_debit';
export type FinancialMovementType = 'income' | 'expense';
export type FinancialMovementStatus = 'draft' | 'pending' | 'posted' | 'voided' | 'reversed';
export type ExpenseSubmissionStatus = 'submitted' | 'approved' | 'rejected' | 'posted';
export type SalaryPeriodicity = 'monthly' | 'daily' | 'hourly' | 'seasonal' | 'honorarios';
export type SalaryPaymentStatus = 'draft' | 'ready_to_liquidate' | 'liquidated' | 'paid' | 'posted' | 'voided';
export type OvertimeEntryStatus = 'submitted' | 'approved' | 'rejected' | 'liquidated';
export type EmployeePayrollCycleStatus = 'draft' | 'ready_to_liquidate' | 'liquidated' | 'paid' | 'ready' | 'posted' | 'voided';
export type EmployeeAccountingLinkStatus = 'recorded' | 'linked' | 'paid';
export type EmployeeCertificateStatus = 'active' | 'expired' | 'archived';
export type CashClosureStatus = 'open' | 'closed' | 'voided';
export type ExternalReferenceType = 'F931' | 'OBRA_SOCIAL' | 'ART' | 'OTHER';
export type ExternalReferenceStatus = 'recorded' | 'linked' | 'paid';
export type MacroDebitSettlementStatus = 'imported' | 'reconciled' | 'closed';
export type ConcessionKind = 'cantinero' | 'monthly_concession' | 'other';
export type AdvertisingKind = 'board' | 'antenna';
export type HandicapChargeStatus = 'pending_collection' | 'collected' | 'transferred' | 'closed';
export type MemberFeeChargeStatus = 'pending' | 'paid' | 'exempt' | 'cancelled' | 'overdue';
export type ThirdPartyType = 'member' | 'employee' | 'vendor' | 'association' | 'tenant' | 'advertiser' | 'external';
export type MercadoPagoCheckoutSourceType =
  | 'member_fee_charge'
  | 'tournament_registration'
  | 'green_fee'
  | 'handicap_charge'
  | 'concession_charge'
  | 'advertising_charge'
  | 'manual_income';
export type MercadoPagoCheckoutSessionStatus =
  | 'creating'
  | 'ready'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'failed';

export interface AuditFields {
  createdAt: Timestamp;
  createdBy: UID;
  updatedAt: Timestamp;
  updatedBy: UID;
  isDeleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: UID;
}

export interface FinancialConfigDocument extends AuditFields {
  version: number;
  isActive: boolean;
  effectiveFrom: Timestamp;
  effectiveTo?: Timestamp | null;
  currency: CurrencyCode;
  fullMemberFeeMinor: AmountMinor;
  familyAssociatePctBps: Bps;
  lifetimePctBps: Bps;
  minorPctBps: Bps;
  licensePctBps: Bps;
  maxLicenseMonths: number;
  creditCommissionPctBps: Bps;
  earlyPaymentDiscountPctBps?: Bps | null;
  earlyPaymentDiscountDayOfMonth?: number | null;
  familyGroupBillingMode: FamilyGroupBillingMode;
  allowStandaloneMinor: boolean;
  membershipChargePersistenceMode: MembershipChargePersistenceMode;
  greenFeeAppliesToMembers: boolean;
  cantineroContractMode: CantineroContractMode;
  advertisingDefaultPeriodicity: AdvertisingDefaultPeriodicity;
  requireApprovalForExpensePosting: boolean;
  requireApprovalForOvertimePosting: boolean;
  notes?: string | null;
}

export interface PaymentMethodDocument extends AuditFields {
  name: string;
  bancarizado: boolean;
  specialReportingType?: PaymentMethodSpecialReportingType | null;
  active: boolean;
  sortOrder: number;
}

export interface PaymentCommissionRuleDocument extends AuditFields {
  paymentMethodId: DocId;
  percentageBps: Bps;
  isActive: boolean;
  validFrom: Timestamp;
  validTo?: Timestamp | null;
  setByUid: UID;
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
  bankName: 'Banco Macro' | string;
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

export interface ConcessionContractDocument extends AuditFields {
  kind: ConcessionKind;
  conceptName: string;
  counterpartyName: string;
  fixedMonthlyAmountMinor: AmountMinor;
  billingDay: number;
  isActive: boolean;
  effectiveFrom: Timestamp;
  effectiveTo?: Timestamp | null;
  autoGenerateCharge: boolean;
  notes?: string | null;
}

export interface AdvertisingContractDocument extends AuditFields {
  kind: AdvertisingKind;
  advertiserName: string;
  amountMinor: AmountMinor;
  periodicity: AdvertisingDefaultPeriodicity;
  billingDay?: number | null;
  isActive: boolean;
  effectiveFrom: Timestamp;
  effectiveTo?: Timestamp | null;
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

export interface MemberFeeChargeDocument extends AuditFields {
  memberId?: DocId | null;
  familyGroupId?: DocId | null;
  holderMemberId?: DocId | null;
  period: AccountingPeriod;
  configVersion: number;
  memberTypeCodeSnapshot: string;
  billingMode: FamilyGroupBillingMode;
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

export interface MercadoPagoCheckoutSessionItem {
  sourceType: MercadoPagoCheckoutSourceType;
  sourceId?: DocId | null | undefined;
  memberId?: DocId | null | undefined;
  thirdPartyType?: ThirdPartyType | null | undefined;
  thirdPartyId?: DocId | null | undefined;
  categoryId: DocId;
  description: string;
  amountMinor: AmountMinor;
  originCollection?: string | null | undefined;
  originId?: DocId | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface MercadoPagoCheckoutSessionDocument extends AuditFields {
  items: MercadoPagoCheckoutSessionItem[];
  memberIds: DocId[];
  grossAmountMinor: AmountMinor;
  currency: CurrencyCode;
  status: MercadoPagoCheckoutSessionStatus;
  preferenceId?: string | null;
  checkoutUrl?: string | null;
  paymentId?: string | null;
  merchantOrderId?: string | null;
  externalReference: string;
  providerStatus?: string | null;
  providerStatusDetail?: string | null;
  financialMovementIds: DocId[];
  idempotencyKey: string;
  createdByUid: UID;
  notes?: string | null;
}

export interface MercadoPagoEventDocument extends AuditFields {
  eventId: string;
  type: string;
  action: string;
  dataId: string;
  paymentId?: string | null;
  merchantOrderId?: string | null;
  externalReference?: string | null;
  payloadSnapshot: Record<string, unknown>;
  headersSnapshot: Record<string, string>;
  processed: boolean;
  processedAt?: Timestamp | null;
  processingError?: string | null;
}

export type EntityWithId<T extends object> = UsersEntityWithId<T>;
export type Actor = UsersActor;
export type ReferencedUserDocument = UserDocument;
export type ReferencedMemberDocument = MemberDocument;
export type ReferencedEmployeeDocument = EmployeeDocument;
export type ReferencedHandicapDocument = HandicapDocument;
export type ReferencedFamilyGroupDocument = FamilyGroupDocument;

export interface FeePreview {
  memberId: DocId;
  period: AccountingPeriod;
  baseAmountMinor: AmountMinor;
  appliedPctBps: Bps;
  finalAmountMinor: AmountMinor;
  configVersion: number;
  billingMode: FamilyGroupBillingMode;
  memberTypeCodeSnapshot: string;
  familyGroupId?: DocId | null;
  holderMemberId?: DocId | null;
  explanation: string[];
}
