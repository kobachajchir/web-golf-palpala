import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Firestore,
} from 'firebase/firestore';
import { firestore } from '../../../lib/firebase';
import {
  createExpenseSubmissionsRepository,
  createExternalAccountingReferencesRepository,
  createFinancialConfigsRepository,
  createFinancialMovementsRepository,
  createMacroDebitSettlementsRepository,
  createMemberFeeChargesRepository,
  createMercadoPagoCheckoutSessionsRepository,
  createPaymentMethodsRepository,
  createSalaryPaymentsRepository,
} from '../../../modules/accounting/infrastructure/firestore/repositories';
import { createEmployeesRepository, createMembersRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import type {
  AccountingReportHistoryDocument,
  AccountingReportSummary,
  AccountingSummary,
  ReportInclude,
  ReportScope,
} from '../types/accounting';
import { getCurrentAccountingPeriod, getSignedMovementAmount, normalizeAccountingPeriod, timestampToDate } from '../utils/accountingFormatters';

const ACCOUNTING_REPORTS_COLLECTION = 'accounting_reports';

function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error('Firestore no esta inicializado.');
  }

  return firestore;
}

function isMemberMembershipNotCurrent(member: { membershipRenewalStatus?: string | null }) {
  return member.membershipRenewalStatus === 'needs_renewal';
}

export async function getAccountingSummary(period = getCurrentAccountingPeriod()): Promise<AccountingSummary> {
  const financialConfigsRepository = createFinancialConfigsRepository();
  const paymentMethodsRepository = createPaymentMethodsRepository();
  const financialMovementsRepository = createFinancialMovementsRepository();
  const macroDebitSettlementsRepository = createMacroDebitSettlementsRepository();
  const expenseSubmissionsRepository = createExpenseSubmissionsRepository();
  const salaryPaymentsRepository = createSalaryPaymentsRepository();
  const externalAccountingReferencesRepository = createExternalAccountingReferencesRepository();
  const memberFeeChargesRepository = createMemberFeeChargesRepository();
  const mercadoPagoCheckoutSessionsRepository = createMercadoPagoCheckoutSessionsRepository();
  const membersRepository = createMembersRepository();
  const employeesRepository = createEmployeesRepository();

  const [
    activeConfig,
    paymentMethods,
    recentMovements,
    periodMovements,
    recentSettlements,
    recentExpenses,
    recentSalaryPayments,
    periodReferences,
    periodFeeCharges,
    pendingFeeCharges,
    recentMercadoPagoSessions,
    membersPreview,
    employeesPreview,
    activeMembersCount,
    activeEmployeesCount,
    pendingExpenseCount,
    pendingFeeCount,
  ] = await Promise.all([
    financialConfigsRepository.getActive(),
    paymentMethodsRepository.listActiveSorted(),
    financialMovementsRepository.listRecent(10),
    financialMovementsRepository.listByAccountingPeriod(period),
    macroDebitSettlementsRepository.listRecent(6),
    expenseSubmissionsRepository.listRecent(10),
    salaryPaymentsRepository.listByPeriod(period),
    externalAccountingReferencesRepository.listByPeriod(period),
    memberFeeChargesRepository.listByPeriod(period),
    memberFeeChargesRepository.listPending(100),
    mercadoPagoCheckoutSessionsRepository.listRecent(8),
    membersRepository.listDirectory(),
    employeesRepository.listAlphabetical(10),
    membersRepository.countActive(),
    employeesRepository.countActive(),
    expenseSubmissionsRepository.countByStatus('submitted'),
    memberFeeChargesRepository.countPendingByPeriod(period),
  ]);

  return {
    period,
    activeConfig,
    paymentMethods,
    recentMovements,
    periodMovements,
    recentSettlements,
    recentExpenses,
    recentSalaryPayments,
    periodReferences,
    periodFeeCharges,
    pendingFeeCharges,
    recentMercadoPagoSessions,
    membersPreview,
    renewalMembers: membersPreview.filter(isMemberMembershipNotCurrent),
    employeesPreview,
    activeMembersCount,
    activeEmployeesCount,
    pendingExpenseCount,
    pendingFeeCount,
  };
}

export async function summarizeReportData({
  scope,
  period,
  dateFrom,
  dateTo,
  includes,
}: {
  scope: ReportScope;
  period: string;
  dateFrom?: string;
  dateTo?: string;
  includes: ReportInclude[];
}): Promise<AccountingReportSummary> {
  const periods = scope === 'period' ? [normalizeAccountingPeriod(period)] : enumeratePeriods(dateFrom ?? '', dateTo ?? '');
  const movementsRepository = createFinancialMovementsRepository();
  const feeChargesRepository = createMemberFeeChargesRepository();
  const salaryPaymentsRepository = createSalaryPaymentsRepository();

  const [movementGroups, feeGroups, salaryGroups] = await Promise.all([
    Promise.all(periods.map((entry) => movementsRepository.listByAccountingPeriod(entry))),
    includes.includes('fees') ? Promise.all(periods.map((entry) => feeChargesRepository.listByPeriod(entry))) : Promise.resolve([]),
    includes.includes('salaries') ? Promise.all(periods.map((entry) => salaryPaymentsRepository.listByPeriod(entry))) : Promise.resolve([]),
  ]);

  const movements = movementGroups
    .flat()
    .filter((movement) => scope === 'period' || isMovementInsideRange(movement.operationDate, dateFrom ?? '', dateTo ?? ''));
  const visibleMovements = movements.filter((movement) => movement.status !== 'voided');
  const feeCharges = feeGroups.flat();
  const salaryPayments = salaryGroups.flat();

  return {
    incomeTotalMinor: visibleMovements
      .filter((movement) => movement.movementType === 'income')
      .reduce((total, movement) => total + movement.netAmountMinor, 0),
    expenseTotalMinor: visibleMovements
      .filter((movement) => movement.movementType === 'expense')
      .reduce((total, movement) => total + movement.netAmountMinor, 0),
    netTotalMinor: visibleMovements.reduce((total, movement) => total + getSignedMovementAmount(movement), 0),
    movementCount: visibleMovements.length,
    feePendingMinor: feeCharges
      .filter((charge) => charge.status === 'pending' || charge.status === 'overdue')
      .reduce((total, charge) => total + charge.finalAmountMinor, 0),
    salaryTotalMinor: salaryPayments.reduce((total, salary) => total + salary.salaryGrossMinor, 0),
  };
}

export async function generateReport({
  title,
  scope,
  period,
  dateFrom,
  dateTo,
  includes,
  notes,
  generatedBy,
  generatedByRole,
}: {
  title: string;
  scope: ReportScope;
  period: string;
  dateFrom?: string;
  dateTo?: string;
  includes: ReportInclude[];
  notes?: string;
  generatedBy: string;
  generatedByRole: string;
}) {
  const db = requireFirestore();
  const summary = await summarizeReportData({
    scope,
    period,
    includes,
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  });
  const payload = {
    title,
    kind: 'accounting_summary',
    scope,
    period: scope === 'period' ? normalizeAccountingPeriod(period) : null,
    dateFrom: scope === 'date_range' ? dateFrom ?? null : null,
    dateTo: scope === 'date_range' ? dateTo ?? null : null,
    includes,
    filters: {
      scope,
      period,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      includes,
    },
    format: 'screen',
    generatedAt: serverTimestamp(),
    generatedBy,
    generatedByRole,
    status: 'generated',
    downloadUrl: null,
    notes: notes?.trim() || null,
    summary,
  };

  const reportRef = await addDoc(collection(db, ACCOUNTING_REPORTS_COLLECTION), payload);
  return reportRef.id;
}

export async function listReportHistory() {
  const db = requireFirestore();
  const snapshot = await getDocs(
    query(collection(db, ACCOUNTING_REPORTS_COLLECTION), orderBy('generatedAt', 'desc'), limit(30)),
  );

  return snapshot.docs.map((entry) => ({
    id: entry.id,
    ...(entry.data() as AccountingReportHistoryDocument),
  }));
}

export async function getReportHistoryItem(reportId: string) {
  const db = requireFirestore();
  const snapshot = await getDoc(doc(db, ACCOUNTING_REPORTS_COLLECTION, reportId));
  return snapshot.exists()
    ? {
        id: snapshot.id,
        ...(snapshot.data() as AccountingReportHistoryDocument),
      }
    : null;
}

export async function listCashMovements(period: string) {
  const movementsRepository = createFinancialMovementsRepository();
  return movementsRepository.listByAccountingPeriod(period);
}

export async function listSubmittedExpenses() {
  const repository = createExpenseSubmissionsRepository();
  return repository.listRecent(30).then((expenses) => expenses.filter((expense) => expense.status === 'submitted'));
}

function enumeratePeriods(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000-03:00`);
  const end = new Date(`${to}T00:00:00.000-03:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const periods = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endCursor = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= endCursor) {
    periods.push(normalizeAccountingPeriod(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return periods;
}

function isMovementInsideRange(value: Parameters<typeof timestampToDate>[0], from: string, to: string) {
  const date = timestampToDate(value);
  if (!date || !from || !to) {
    return false;
  }

  return date >= new Date(`${from}T00:00:00.000-03:00`) && date <= new Date(`${to}T23:59:59.999-03:00`);
}
