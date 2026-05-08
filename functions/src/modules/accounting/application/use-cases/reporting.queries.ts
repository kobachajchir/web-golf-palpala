import type { AccountingTransactionManager, CursorPage, FinancialMovementFilters, HandicapChargeFilters, MemberFeeChargeFilters, SalaryPaymentsFilters } from '../../domain/ports.js';
import type { EntityWithId, FinancialMovementDocument, HandicapChargeDocument, MemberFeeChargeDocument, SalaryPaymentDocument } from '../../domain/models.js';

export function listMovementsByPeriod(
  transactions: AccountingTransactionManager,
  filters: FinancialMovementFilters,
): Promise<CursorPage<EntityWithId<FinancialMovementDocument>>> {
  return transactions.getDataAccess().financialMovements.listPage(filters);
}

export function listMovementsByCategory(
  transactions: AccountingTransactionManager,
  filters: FinancialMovementFilters,
): Promise<CursorPage<EntityWithId<FinancialMovementDocument>>> {
  return transactions.getDataAccess().financialMovements.listPage(filters);
}

export function listMovementsByPaymentMethod(
  transactions: AccountingTransactionManager,
  filters: FinancialMovementFilters,
): Promise<CursorPage<EntityWithId<FinancialMovementDocument>>> {
  return transactions.getDataAccess().financialMovements.listPage(filters);
}

export function listMovementsByThirdParty(
  transactions: AccountingTransactionManager,
  filters: FinancialMovementFilters,
): Promise<CursorPage<EntityWithId<FinancialMovementDocument>>> {
  return transactions.getDataAccess().financialMovements.listPage(filters);
}

export function listMovementsByBankingFlag(
  transactions: AccountingTransactionManager,
  filters: FinancialMovementFilters,
): Promise<CursorPage<EntityWithId<FinancialMovementDocument>>> {
  return transactions.getDataAccess().financialMovements.listPage(filters);
}

export function listMovementsByTaxFlag(
  transactions: AccountingTransactionManager,
  filters: FinancialMovementFilters,
): Promise<CursorPage<EntityWithId<FinancialMovementDocument>>> {
  return transactions.getDataAccess().financialMovements.listPage(filters);
}

export function listSalaryPayments(
  transactions: AccountingTransactionManager,
  filters: SalaryPaymentsFilters,
): Promise<CursorPage<EntityWithId<SalaryPaymentDocument>>> {
  return transactions.getDataAccess().salaryPayments.listPage(filters);
}

export function listHandicapCharges(
  transactions: AccountingTransactionManager,
  filters: HandicapChargeFilters,
): Promise<CursorPage<EntityWithId<HandicapChargeDocument>>> {
  return transactions.getDataAccess().handicapCharges.listPage(filters);
}

export function listMemberFeeCharges(
  transactions: AccountingTransactionManager,
  filters: MemberFeeChargeFilters,
): Promise<CursorPage<EntityWithId<MemberFeeChargeDocument>>> {
  return transactions.getDataAccess().memberFeeCharges.listPage(filters);
}
