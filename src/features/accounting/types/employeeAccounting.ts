import type {
  AccountingPeriod,
  EmployeeAccountingLinkDocument,
  EmployeeCertificateDocument,
  EmployeePayrollCycleDocument,
  EntityWithId,
  ExternalAccountingReferenceDocument,
  OvertimeEntryDocument,
  SalaryConfigurationDocument,
  SalaryPaymentDocument,
} from '../../../modules/accounting/domain/models';
import type { EmployeeDocument } from '../../../modules/users/domain/models';

export type EmployeeCycleSection =
  | 'summary'
  | 'overtime'
  | 'certificates'
  | 'external-docs'
  | 'expenses'
  | 'settlement'
  | 'payment';

export type EmployeePeriodSummary = {
  baseSalary: number;
  overtimeTotal: number;
  expenseReimbursements: number;
  externalDocsLinked: number;
  status: string;
};

export type EmployeePeriodState = {
  employeeId: string;
  period: AccountingPeriod;
  expandedSection: EmployeeCycleSection;
  isLocked: boolean;
  summary: EmployeePeriodSummary;
  employee: EntityWithId<EmployeeDocument> | null;
  salaryConfiguration: EntityWithId<SalaryConfigurationDocument> | null;
  payrollCycle: EntityWithId<EmployeePayrollCycleDocument> | null;
  salaryPayment: EntityWithId<SalaryPaymentDocument> | null;
  overtimeItems: Array<EntityWithId<OvertimeEntryDocument>>;
  expenseClaims: unknown[];
  externalAssignments: Array<EntityWithId<EmployeeAccountingLinkDocument>>;
  externalReferences: Array<EntityWithId<ExternalAccountingReferenceDocument>>;
  certificates: Array<EntityWithId<EmployeeCertificateDocument>>;
  settlement: EntityWithId<SalaryPaymentDocument> | null;
};
