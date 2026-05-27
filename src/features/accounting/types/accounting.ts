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
  MercadoPagoCheckoutSessionDocument,
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
  recentExpenses: Array<EntityWithId<ExpenseSubmissionDocument>>;
  recentMercadoPagoSessions: Array<EntityWithId<MercadoPagoCheckoutSessionDocument>>;
  recentSettlements: Array<EntityWithId<MacroDebitSettlementDocument>>;
  periodReferences: Array<EntityWithId<ExternalAccountingReferenceDocument>>;
  recentSalaryPayments: Array<EntityWithId<SalaryPaymentDocument>>;
  membersPreview: Array<EntityWithId<MemberDocument>>;
  renewalMembers: Array<EntityWithId<MemberDocument>>;
  employeesPreview: Array<EntityWithId<EmployeeDocument>>;
  activeMembersCount: number;
  activeEmployeesCount: number;
  pendingExpenseCount: number;
  pendingFeeCount: number;
};

export type ReportInclude = 'movements' | 'cash_flow' | 'payment_methods' | 'categories' | 'fees' | 'salaries';
export type ReportScope = 'period' | 'date_range';
export type ReportStatus = 'generated' | 'failed';

export type AccountingReportSummary = {
  incomeTotalMinor: number;
  expenseTotalMinor: number;
  netTotalMinor: number;
  movementCount: number;
  feePendingMinor: number;
  salaryTotalMinor: number;
};

export type AccountingReportHistoryDocument = {
  title: string;
  kind: 'accounting_summary';
  scope: ReportScope;
  period?: AccountingPeriod | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  includes: ReportInclude[];
  filters: Record<string, unknown>;
  format: 'screen';
  generatedAt: Timestamp;
  generatedBy: string;
  generatedByRole: string;
  status: ReportStatus;
  downloadUrl?: string | null;
  notes?: string | null;
  summary: AccountingReportSummary;
};

export type CashClosureSnapshot = {
  closures: Array<EntityWithId<CashClosureDocument>>;
  movements: Array<EntityWithId<FinancialMovementDocument>>;
};
