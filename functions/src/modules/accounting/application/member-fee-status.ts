import { Timestamp } from 'firebase-admin/firestore';
import type { AccountingDataAccess } from '../domain/ports.js';
import { toClubAccountingPeriod, calculateMembershipRenewalDueDateFromPeriod } from './shared.js';

export async function prepareMemberFeeStatus(dataAccess: AccountingDataAccess, memberId: string, updates: Array<{ id?: string; period?: string; status: string }>) {
  const member = await dataAccess.members.getById(memberId);
  const rows: Array<{ id: string; period: string; status: string }> = [];
  for (const filter of [{ memberId }, ...(member?.familyGroupId ? [{ familyGroupId: member.familyGroupId }] : [])]) {
    let cursorId: string | undefined;
    do {
      const page = await dataAccess.memberFeeCharges.listPage({ ...filter, limit: 100, cursorId });
      rows.push(...page.items);
      cursorId = page.nextCursorId;
    } while (cursorId);
  }
  for (const update of updates) {
    const existing = rows.find((row) => update.id && row.id === update.id);
    if (existing) existing.status = update.status;
    else if (update.period) rows.push({ id: update.id ?? '', period: update.period, status: update.status });
  }
  const current = toClubAccountingPeriod(new Date());
  const debt = rows.filter((row) => row.period <= current && (row.status === 'pending' || row.status === 'overdue')).sort((a,b) => a.period.localeCompare(b.period));
  let next = current;
  for (let count = 0; count < 12000 && rows.some((row) => row.period === next && (row.status === 'paid' || row.status === 'exempt')); count++) {
    next = toClubAccountingPeriod(calculateMembershipRenewalDueDateFromPeriod(next));
  }
  return { membershipRenewalStatus: debt.length ? 'needs_renewal' as const : 'current' as const, membershipRenewalDueAt: Timestamp.fromDate(new Date(`${debt[0]?.period ?? next}-01T00:00:00-03:00`)) };
}
