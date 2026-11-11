import type { Timestamp } from 'firebase/firestore';
import type {
  AccountingPeriod,
  CashClosureDocument,
  EntityWithId,
  ExpenseSubmissionDocument,
  ExternalAccountingReferenceDocument,
  FinancialConfigDocument,
  FinancialMovementDocument,
  MacroDebitSettlementDocument,
  MemberFeeChargeDocument,
  PaymentMethodDocument,
  SalaryPaymentDocument,
} from '../../../modules/accounting/domain/models';
import type { EmployeeDocument, MemberDocument } from '../../../modules/users/domain/models';

export type AccountingNotice = {
  kind: 'success' | 'error' | 'info';
  message: string;
} | null;

export type AccountingSectionId =
  | 'overview'
  | 'collections'
  | 'member-dues'
  | 'expenses'
  | 'employees'
  | 'external-docs'
  | 'payment-methods'
  | 'bank-settlements'
  | 'reports'
  | 'cash-closures';

export type AccountingSummary = {
  period: AccountingPeriod;
  activeConfig: EntityWithId<FinancialConfigDocument> | null;
  paymentMethods: Array<EntityWithId<PaymentMethodDocument>>;
  recentMovements: Array<EntityWithId<FinancialMovementDocument>>;
  periodMovements: Array<EntityWithId<FinancialMovementDocument>>;
  pendingFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
  periodFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
  pendingExpenses: Array<EntityWithId<ExpenseSubmissionDocument>>;
  recentExpenses: Array<EntityWithId<ExpenseSubmissionDocument>>;
  recentSettlements: Array<EntityWithId<MacroDebitSettlementDocument>>;
  periodReferences: Array<EntityWithId<ExternalAccountingReferenceDocument>>;
  recentSalaryPayments: Array<EntityWithId<SalaryPaymentDocument>>;
  membersPreview: Array<EntityWithId<MemberDocument>>;
  renewalMembers: Array<EntityWithId<MemberDocument>>;
  renewalPendingConceptCount: number;
  renewalPendingTotalMinor: number;
  employeesPreview: Array<EntityWithId<EmployeeDocument>>;
  activeMembersCount: number;
  activeEmployeesCount: number;
  pendingExpenseCount: number;
  pendingExpenseTotalMinor: number;
  pendingFeeCount: number;
};

export type ReportInclude = 'movements' | 'cash_flow' | 'payment_methods' | 'categories' | 'fees' | 'salaries';
export type ReportScope = 'period' | 'date_range';
export type ReportStatus = 'generating' | 'generated' | 'failed';

export type AccountingReportSummary = {
  incomeTotalMinor: number;
  expenseTotalMinor: number;
  netTotalMinor: number;
  movementCount: number;
  feePendingMinor: number;
  salaryTotalMinor: number;
  paidDuesMinor?: number;
  unpaidPeriodMinor?: number;
  unpaidAccumulatedMinor?: number;
};

export type AccountingReportSection = {
  key: string;
  label: string;
  count: number;
  grossAmountMinor: number;
  commissionAmountMinor: number;
  netAmountMinor: number;
  outstandingAmountMinor: number;
};

export type AccountingReportDetailRow = {
  id: string;
  section: 'movements' | 'green_fee' | 'dues_paid' | 'dues_unpaid_period' | 'dues_unpaid_accumulated';
  date: string | null;
  label: string;
  categoryId: string | null;
  categoryLabel: string | null;
  groupKey: string | null;
  groupLabel: string | null;
  movementType: 'income' | 'expense' | null;
  memberId: string | null;
  memberName: string | null;
  period: string | null;
  paymentMethodId: string | null;
  paymentMethodLabel: string | null;
  grossAmountMinor: number;
  commissionAmountMinor: number;
  netAmountMinor: number;
  outstandingAmountMinor: number;
  status: string;
};

export type AccountingReportHistoryDocument = {
  schemaVersion?: number;
  title: string;
  kind: 'accounting_summary' | 'accounting_snapshot';
  template?: 'categories' | 'green_fee' | 'member_dues' | 'custom';
  scope: ReportScope;
  period?: AccountingPeriod | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  includes: ReportInclude[];
  filters: Record<string, unknown>;
  format: 'screen' | Array<'screen' | 'pdf' | 'excel'>;
  generatedAt: Timestamp;
  sourceCutoffAt?: Timestamp;
  completedAt?: Timestamp;
  generatedBy: string;
  generatedByRole: string | string[];
  status: ReportStatus;
  downloadUrl?: string | null;
  notes?: string | null;
  errorMessage?: string | null;
  summary: AccountingReportSummary;
  sections?: AccountingReportSection[];
  detailRowCount?: number;
  chunkCount?: number;
  detailRows?: AccountingReportDetailRow[];
};

export type CashClosureSnapshot = {
  closures: Array<EntityWithId<CashClosureDocument>>;
  movements: Array<EntityWithId<FinancialMovementDocument>>;
};
