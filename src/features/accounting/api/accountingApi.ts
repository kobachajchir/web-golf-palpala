import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { firestore } from '../../../lib/firebase';
import {
  createExternalAccountingReferencesRepository,
  createFinancialConfigsRepository,
  createFinancialMovementsRepository,
  createMacroDebitSettlementsRepository,
  createMemberFeeChargesRepository,
  createPaymentMethodsRepository,
  createSalaryPaymentsRepository,
} from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { AccountingPeriod, EntityWithId, GenerateAccountingReportPayload, MemberFeeChargeDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createEmployeesRepository, createMembersRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import type { EntityWithId as UserEntityWithId, MemberDocument } from '../../../modules/users/domain/models';
import type {
  AccountingReportDetailRow,
  AccountingReportHistoryDocument,
  AccountingReportSummary,
  AccountingSummary,
  ReportInclude,
  ReportScope,
} from '../types/accounting';
import { getCurrentAccountingPeriod, getSignedMovementAmount, normalizeAccountingPeriod, timestampToDate } from '../utils/accountingFormatters';
import { isMovementExcludedFromBalance, movementCountsTowardBalance } from '../utils/balanceInclusion';
import { buildChargesByMemberId, estimateMemberFeeAmountMinor, getChargeTargetMemberIds, getOpenFeeCharges } from '../utils/memberFeeEstimates';
import { isVisiblePaymentMethod } from '../utils/paymentMethods';

const ACCOUNTING_REPORTS_COLLECTION = 'accounting_reports';
const accountingCallables = createAccountingCallables();
export const MEMBER_FEE_RENEWAL_MIN_PERIOD = '2026-07' as AccountingPeriod;

function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error('Firestore no esta inicializado.');
  }

  return firestore;
}

function isOpenFeeCharge(charge: EntityWithId<MemberFeeChargeDocument>) {
  return (charge.status === 'pending' || charge.status === 'overdue')
    && getChargeOutstandingAmountMinor(charge) > 0;
}

function dedupeFeeCharges(charges: Array<EntityWithId<MemberFeeChargeDocument>>) {
  const uniqueCharges = new Map<string, EntityWithId<MemberFeeChargeDocument>>();
  charges.forEach((charge) => uniqueCharges.set(charge.id, charge));
  return [...uniqueCharges.values()]
    .sort((left, right) => right.period.localeCompare(left.period));
}

function getChargeOutstandingAmountMinor(charge: EntityWithId<MemberFeeChargeDocument>) {
  const paidClubAmountMinor = charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0;
  return charge.remainingAmountMinor
    ?? Math.max((charge.settlementAmountMinor ?? charge.finalAmountMinor) - paidClubAmountMinor, 0);
}

function getMemberJoinedPeriod(member: UserEntityWithId<MemberDocument>): AccountingPeriod | null {
  const joinedAt = timestampToDate(member.joinedAt);
  if (!joinedAt) return null;
  return `${joinedAt.getFullYear()}-${String(joinedAt.getMonth() + 1).padStart(2, '0')}` as AccountingPeriod;
}

function hasMemberJoinedByPeriod(member: UserEntityWithId<MemberDocument>, period: AccountingPeriod) {
  const joinedPeriod = getMemberJoinedPeriod(member);
  return !joinedPeriod || joinedPeriod <= period;
}

function canGenerateRenewalForPeriod(member: UserEntityWithId<MemberDocument>, period: AccountingPeriod) {
  return (member.status === 'active' || member.status === 'license')
    && !member.membershipBillingExempt
    && hasMemberJoinedByPeriod(member, period);
}

export function getMembersWithoutCurrentPeriodPayment({
  members,
  period,
  periodFeeCharges,
}: {
  members: Array<UserEntityWithId<MemberDocument>>;
  period: AccountingPeriod;
  periodFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
}) {
  const settledMemberIds = new Set<string>();
  const openSelectedPeriodMemberIds = new Set<string>();
  periodFeeCharges.forEach((charge) => {
    const targetMemberIds = getChargeTargetMemberIds(charge, members);
    if (charge.status === 'paid' || charge.status === 'exempt' || getChargeOutstandingAmountMinor(charge) <= 0) {
      targetMemberIds.forEach((memberId) => settledMemberIds.add(memberId));
      return;
    }
    if (charge.status === 'pending' || charge.status === 'overdue') {
      targetMemberIds.forEach((memberId) => openSelectedPeriodMemberIds.add(memberId));
    }
  });

  return members.filter((member) => {
    if (member.status === 'active' || member.status === 'license') {
      return canGenerateRenewalForPeriod(member, period) && !settledMemberIds.has(member.id);
    }

    if (member.status === 'inactive' || member.status === 'suspended') {
      return openSelectedPeriodMemberIds.has(member.id);
    }

    return false;
  });
}

function summarizeRenewalPending({
  renewalMembers,
  members,
  period,
  periodFeeCharges,
  pendingFeeCharges,
  activeConfig,
}: {
  renewalMembers: Array<UserEntityWithId<MemberDocument>>;
  members: Array<UserEntityWithId<MemberDocument>>;
  period: AccountingPeriod;
  periodFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
  pendingFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
  activeConfig: AccountingSummary['activeConfig'];
}) {
  const openChargesByMemberId = buildChargesByMemberId(
    members,
    dedupeFeeCharges(getOpenFeeCharges([...periodFeeCharges, ...pendingFeeCharges])),
  );
  const countedChargeIds = new Set<string>();

  return renewalMembers.reduce(
    (summary, member) => {
      const charges = openChargesByMemberId.get(member.id) ?? [];
      let openConceptCount = 0;
      let openTotalMinor = 0;
      charges.forEach((charge) => {
        if (countedChargeIds.has(charge.id)) return;
        countedChargeIds.add(charge.id);
        openConceptCount += 1;
        openTotalMinor += getChargeOutstandingAmountMinor(charge);
      });
      const hasSelectedPeriodOpenCharge = charges.some((charge) => charge.period === period);
      const missingSelectedAmountMinor = canGenerateRenewalForPeriod(member, period) && !hasSelectedPeriodOpenCharge
        ? estimateMemberFeeAmountMinor(member, activeConfig)
        : 0;

      return {
        conceptCount: summary.conceptCount + openConceptCount + (missingSelectedAmountMinor > 0 ? 1 : 0),
        totalMinor: summary.totalMinor + openTotalMinor + missingSelectedAmountMinor,
      };
    },
    { conceptCount: 0, totalMinor: 0 },
  );
}
export async function getAccountingSummary(period = getCurrentAccountingPeriod()): Promise<AccountingSummary> {
  const financialConfigsRepository = createFinancialConfigsRepository();
  const paymentMethodsRepository = createPaymentMethodsRepository();
  const financialMovementsRepository = createFinancialMovementsRepository();
  const macroDebitSettlementsRepository = createMacroDebitSettlementsRepository();
  const salaryPaymentsRepository = createSalaryPaymentsRepository();
  const externalAccountingReferencesRepository = createExternalAccountingReferencesRepository();
  const memberFeeChargesRepository = createMemberFeeChargesRepository();
  const membersRepository = createMembersRepository();
  const employeesRepository = createEmployeesRepository();

  const [
    activeConfig,
    allPaymentMethods,
    recentMovements,
    periodMovements,
    recentSettlements,
    recentSalaryPayments,
    periodReferences,
    periodFeeCharges,
    historicalFeeCharges,
    membersPreview,
    employeesPreview,
    activeMembersCount,
    activeEmployeesCount,
    pendingFeeCount,
  ] = await Promise.all([
    financialConfigsRepository.getActive(),
    paymentMethodsRepository.listActiveWithCommissions(),
    financialMovementsRepository.listRecent(10).catch(() => []),
    financialMovementsRepository.listByAccountingPeriod(period),
    macroDebitSettlementsRepository.listRecent(6).catch(() => []),
    salaryPaymentsRepository.listByPeriod(period).catch(() => []),
    externalAccountingReferencesRepository.listByPeriod(period).catch(() => []),
    memberFeeChargesRepository.listByPeriod(period),
    memberFeeChargesRepository.listByPeriodRange(MEMBER_FEE_RENEWAL_MIN_PERIOD, getCurrentAccountingPeriod()),
    membersRepository.listDirectory(),
    employeesRepository.listAlphabetical(10).catch(() => []),
    membersRepository.countActive(),
    employeesRepository.countActive(),
    memberFeeChargesRepository.countPendingByPeriod(period),
  ]);

  const pendingFeeCharges = dedupeFeeCharges(historicalFeeCharges.filter(isOpenFeeCharge));
  const renewalMembers = getMembersWithoutCurrentPeriodPayment({ members: membersPreview, period, periodFeeCharges });
  const renewalPending = summarizeRenewalPending({
    renewalMembers,
    members: membersPreview,
    period,
    periodFeeCharges,
    pendingFeeCharges,
    activeConfig,
  });

  return {
    period,
    activeConfig,
    paymentMethods: allPaymentMethods.filter(isVisiblePaymentMethod),
    recentMovements,
    periodMovements,
    recentSettlements,
    recentExpenses: [],
    recentSalaryPayments,
    periodReferences,
    periodFeeCharges,
    pendingFeeCharges,
    pendingExpenses: [],
    membersPreview,
    renewalMembers,
    renewalPendingConceptCount: renewalPending.conceptCount,
    renewalPendingTotalMinor: renewalPending.totalMinor,
    employeesPreview,
    activeMembersCount,
    activeEmployeesCount,
    pendingExpenseCount: 0,
    pendingExpenseTotalMinor: 0,
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
  const visibleMovements = movements.filter((movement) => (
    movementCountsTowardBalance(movement)
    && movement.installmentRole !== 'charge'
    && !isMovementExcludedFromBalance(movement)
  ));
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

export async function generateReport(payload: GenerateAccountingReportPayload | {
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
  const normalizedPayload: GenerateAccountingReportPayload = 'template' in payload
    ? payload
    : {
        requestId: crypto.randomUUID(),
        title: payload.title,
        template: 'custom',
        scope: payload.scope,
        period: normalizeAccountingPeriod(payload.period),
        dateFrom: payload.dateFrom ?? null,
        dateTo: payload.dateTo ?? null,
        movementTypes: ['income', 'expense'],
        categoryIds: [],
        includePaidDues: payload.includes.includes('fees'),
        includeUnpaidPeriod: payload.includes.includes('fees'),
        includeUnpaidAccumulated: payload.includes.includes('fees'),
        notes: payload.notes ?? null,
      };
  const result = await accountingCallables.generateReport(normalizedPayload);
  return result.reportId;
}

function readableReport(data: AccountingReportHistoryDocument): AccountingReportHistoryDocument {
  return { ...data, title: data.title?.trim() || 'Reporte histórico sin nombre', status: data.status ?? 'generated', scope: data.scope ?? 'period', summary: data.summary ?? { incomeTotalMinor: Number.NaN, expenseTotalMinor: Number.NaN, netTotalMinor: Number.NaN, movementCount: 0, feePendingMinor: 0, salaryTotalMinor: 0 } };
}

export async function listReportHistory() {
  const db = requireFirestore();
  const reports: Array<AccountingReportHistoryDocument & { id: string }> = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
  do {
    const snapshot = await getDocs(query(collection(db, ACCOUNTING_REPORTS_COLLECTION), orderBy('generatedAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(100)));
    reports.push(...snapshot.docs.map((entry) => ({ id: entry.id, ...readableReport(entry.data() as AccountingReportHistoryDocument) })));
    cursor = snapshot.size === 100 ? snapshot.docs.at(-1) : undefined;
  } while (cursor);
  return reports;
}

export async function getReportHistoryItem(reportId: string) {
  const db = requireFirestore();
  const snapshot = await getDoc(doc(db, ACCOUNTING_REPORTS_COLLECTION, reportId));
  if (!snapshot.exists()) return null;
  const report = readableReport(snapshot.data() as AccountingReportHistoryDocument);
  const chunkSnapshot = report.schemaVersion === 2
    ? await getDocs(query(collection(db, ACCOUNTING_REPORTS_COLLECTION, reportId, 'chunks'), orderBy('index', 'asc')))
    : null;
  const detailRows = chunkSnapshot?.docs.flatMap((entry) => (
    (entry.data().rows ?? []) as AccountingReportDetailRow[]
  )) ?? report.detailRows ?? [];
  return { id: snapshot.id, ...report, detailRows };
}

export async function listCashMovements(period: string) {
  const movementsRepository = createFinancialMovementsRepository();
  return movementsRepository.listByAccountingPeriod(period);
}

export async function listSubmittedExpenses() {
  return [];
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
