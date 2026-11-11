import { Timestamp } from 'firebase-admin/firestore';
import type { AccountingDataAccess } from '../domain/ports.js';
import type { MemberFeeChargeDocument } from '../domain/models.js';
import { toClubAccountingPeriod, calculateMembershipRenewalDueDateFromPeriod } from './shared.js';

type StatusRow = { id: string; period: string; status: string };

const SETTLED_STATUSES = new Set(['paid', 'exempt']);
const OPEN_STATUSES = new Set(['pending', 'overdue']);

/**
 * Una cuota le corresponde al socio si es suya (cargo individual o grupal del que es titular)
 * o si es el cargo unico de su grupo familiar. Los cargos individuales de otros integrantes
 * del grupo no afectan su estado.
 */
function chargeAppliesToMember(
  charge: Pick<MemberFeeChargeDocument, 'memberId' | 'holderMemberId' | 'familyGroupId' | 'billingMode'>,
  memberId: string,
  familyGroupId: string | null,
) {
  if (charge.billingMode === 'single_group_charge') {
    return Boolean(familyGroupId && charge.familyGroupId === familyGroupId)
      || charge.memberId === memberId
      || charge.holderMemberId === memberId;
  }
  return charge.memberId === memberId;
}

export async function prepareMemberFeeStatus(dataAccess: AccountingDataAccess, memberId: string, updates: Array<{ id?: string | undefined; period?: string; status: string }>) {
  const member = await dataAccess.members.getById(memberId);
  const familyGroupId = member?.familyGroupId ?? null;
  // Las consultas por socio y por grupo familiar se solapan: se deduplica por id.
  const rowsById = new Map<string, StatusRow>();
  for (const filter of [{ memberId }, ...(familyGroupId ? [{ familyGroupId }] : [])]) {
    let cursorId: string | undefined;
    do {
      const page = await dataAccess.memberFeeCharges.listPage({ ...filter, limit: 100, ...(cursorId ? { cursorId } : {}) });
      for (const charge of page.items) {
        if (chargeAppliesToMember(charge, memberId, familyGroupId)) {
          rowsById.set(charge.id, { id: charge.id, period: charge.period, status: charge.status });
        }
      }
      cursorId = page.nextCursorId;
    } while (cursorId);
  }
  const extraRows: StatusRow[] = [];
  for (const update of updates) {
    const existing = update.id ? rowsById.get(update.id) : undefined;
    if (existing) existing.status = update.status;
    else if (update.period) extraRows.push({ id: update.id ?? '', period: update.period, status: update.status });
  }
  const rows = [...rowsById.values(), ...extraRows];

  // Si un mismo mes tiene una cuota saldada, el mes se considera cubierto aunque exista otra copia.
  const settledPeriods = new Set(rows.filter((row) => SETTLED_STATUSES.has(row.status)).map((row) => row.period));
  const current = toClubAccountingPeriod(new Date());
  const debt = rows
    .filter((row) => row.period <= current && OPEN_STATUSES.has(row.status) && !settledPeriods.has(row.period))
    .sort((a, b) => a.period.localeCompare(b.period));
  let next = current;
  for (let count = 0; count < 12000 && settledPeriods.has(next); count++) {
    next = toClubAccountingPeriod(calculateMembershipRenewalDueDateFromPeriod(next));
  }
  return {
    membershipRenewalStatus: debt.length || next === current ? 'needs_renewal' as const : 'current' as const,
    membershipRenewalDueAt: Timestamp.fromDate(new Date(`${debt[0]?.period ?? next}-01T00:00:00-03:00`)),
  };
}
