import type { AccountingPeriod } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createExternalAccountingReferencesRepository, createPaymentMethodsRepository, createSalaryConfigurationsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { createEmployeesRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import type { EmployeePeriodState } from '../types/employeeAccounting';
import { summarizeEmployeeOvertime } from '../utils/employeeOvertime';
import { withEmployeeOperationTimeout } from '../utils/employeeOperations';

const accountingCallables = createAccountingCallables();

export async function getEmployeePeriod(employeeId: string, period: AccountingPeriod): Promise<EmployeePeriodState> {
  const employeesRepository = createEmployeesRepository();
  const externalReferencesRepository = createExternalAccountingReferencesRepository();
  const salaryConfigurationsRepository = createSalaryConfigurationsRepository();
  const paymentMethodsRepository = createPaymentMethodsRepository();
  const [employee, cycle, externalReferences, salaryConfiguration, paymentMethods] = await withEmployeeOperationTimeout(Promise.all([
    employeesRepository.getById(employeeId),
    accountingCallables.listEmployeePayrollCycle({ employeeId, period }),
    externalReferencesRepository.listByPeriod(period),
    salaryConfigurationsRepository.getActiveByEmployeeId(employeeId),
    paymentMethodsRepository.listActiveSorted(),
  ]), 'La carga del ciclo no respondio a tiempo. Intenta actualizar nuevamente.');

  const payrollCycle = cycle.payrollCycle;
  const salaryPayment = cycle.salaryPayment;
  const salaryPaid = payrollCycle?.status === 'posted' || payrollCycle?.status === 'paid' || salaryPayment?.status === 'posted' || salaryPayment?.status === 'paid';
  const overtime = summarizeEmployeeOvertime(cycle.overtimeEntries, salaryPaid ? payrollCycle?.overtimeTotalMinor ?? salaryPayment?.overtimeAmountMinor ?? 0 : 0);

  return {
    employeeId,
    period,
    expandedSection: 'summary',
    isLocked: salaryPaid,
    summary: {
      baseSalary: payrollCycle?.salaryGrossMinor ?? salaryPayment?.salaryGrossMinor ?? salaryConfiguration?.baseAmountMinor ?? 0,
      overtimeTotal: overtime.totalMinor,
      overtimePending: overtime.pendingMinor,
      overtimePaid: overtime.paidMinor,
      expenseReimbursements: 0,
      externalDocsLinked: cycle.accountingLinks.length,
      status: payrollCycle?.status ?? salaryPayment?.status ?? 'draft',
    },
    employee,
    salaryConfiguration,
    payrollCycle,
    salaryPayment,
    annualBonusPreview: cycle.annualBonusPreview,
    paymentMethods,
    overtimeItems: cycle.overtimeEntries,
    expenseClaims: [],
    externalAssignments: cycle.accountingLinks,
    externalReferences,
    certificates: cycle.certificates,
    settlement: salaryPayment,
  };
}

export async function postPayrollSettlement(payload: {
  employeeId: string;
  period: AccountingPeriod;
  gross?: number;
  net?: number;
  links: string[];
  notes?: string | null;
}) {
  return accountingCallables.postEmployeePayrollCycle({
    employeeId: payload.employeeId,
    period: payload.period,
    linkedExternalReferenceIds: payload.links,
    notes: payload.notes ?? null,
    ...(payload.gross !== undefined ? { salaryGrossMinor: payload.gross } : {}),
    ...(payload.net !== undefined ? { bankedAmountMinor: payload.net } : {}),
  });
}
