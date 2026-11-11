import type { OvertimeEntryDocument } from '../../../modules/accounting/domain/models';

export function summarizeEmployeeOvertime(entries: OvertimeEntryDocument[], payrollOvertimeMinor = 0) {
  let totalMinor = 0;
  let pendingMinor = 0;
  let paidMinor = 0;
  let payrollPaidMinor = 0;
  for (const entry of entries) {
    if (entry.status === 'rejected') continue;
    totalMinor += entry.amountMinor;
    if (entry.status === 'liquidated') {
      paidMinor += entry.amountMinor;
      if (entry.linkedSalaryPaymentId) payrollPaidMinor += entry.amountMinor;
    } else {
      pendingMinor += entry.amountMinor;
    }
  }
  // Preserve payments made before individual overtime records were introduced.
  const historicalPaidMinor = Math.max(payrollOvertimeMinor - payrollPaidMinor, 0);
  return { totalMinor: totalMinor + historicalPaidMinor, pendingMinor, paidMinor: paidMinor + historicalPaidMinor };
}
