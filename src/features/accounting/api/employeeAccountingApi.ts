import type { AccountingPeriod } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createExternalAccountingReferencesRepository, createSalaryConfigurationsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { createEmployeesRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import type { EmployeePeriodState } from '../types/employeeAccounting';

const accountingCallables = createAccountingCallables();

export async function getEmployeePeriod(employeeId: string, period: AccountingPeriod): Promise<EmployeePeriodState> {
  const employeesRepository = createEmployeesRepository();
  const externalReferencesRepository = createExternalAccountingReferencesRepository();
  const salaryConfigurationsRepository = createSalaryConfigurationsRepository();
  const [employee, cycle, externalReferences, salaryConfiguration] = await Promise.all([
    employeesRepository.getById(employeeId),
    accountingCallables.listEmployeePayrollCycle({ employeeId, period }),
    externalReferencesRepository.listByPeriod(period),
    salaryConfigurationsRepository.getActiveByEmployeeId(employeeId),
  ]);

  const payrollCycle = cycle.payrollCycle;
  const salaryPayment = cycle.salaryPayment;

  return {
    employeeId,
    period,
    expandedSection: 'summary',
    isLocked: payrollCycle?.status === 'posted' || payrollCycle?.status === 'paid',
    summary: {
      baseSalary: payrollCycle?.salaryGrossMinor ?? salaryPayment?.salaryGrossMinor ?? salaryConfiguration?.baseAmountMinor ?? 0,
      overtimeTotal: payrollCycle?.overtimeTotalMinor ?? salaryPayment?.overtimeAmountMinor ?? 0,
      expenseReimbursements: 0,
      externalDocsLinked: cycle.accountingLinks.length,
      status: payrollCycle?.status ?? salaryPayment?.status ?? 'draft',
    },
    employee,
    salaryConfiguration,
    payrollCycle,
    salaryPayment,
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
