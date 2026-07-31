import { Timestamp } from 'firebase-admin/firestore';
import {
  ACCOUNTING_TIME_ZONE_OFFSET,
  SYSTEM_ACTOR_UID,
} from '../../domain/constants.js';
import type { AccountingPeriod, Actor } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import { generateCuotaUseCase } from './fee.use-cases.js';
import {
  calculateMembershipRenewalDueDateFromPeriod,
  ensureStaff,
  toClubAccountingPeriod,
} from '../shared.js';
import { reconcileMemberFeeRenewalsUseCase, type ReconcileMemberFeeRenewalsResult } from './member-fee-reconciliation.use-cases.js';

const MEMBERSHIP_EMISSION_PAGE_SIZE = 100;

export interface MarkMembershipRenewalsResult {
  period: AccountingPeriod;
  dueDate: string;
  activeMemberCount: number;
  markedCount: number;
  generatedCount: number;
  duplicateCount: number;
  skippedCount: number;
  failures: Array<{
    memberId: string;
    memberName: string;
    memberNumber: string;
    reason: string;
  }>;
}

export function createSystemAccountingActor(): Actor {
  const auditTimestamp = Timestamp.fromMillis(0);
  return {
    uid: SYSTEM_ACTOR_UID,
    user: {
      id: SYSTEM_ACTOR_UID,
      email: 'system@club.local',
      displayName: 'Sistema contable',
      primaryRoleId: 'administrativo',
      roleIds: ['administrativo'],
      profileType: 'none',
      active: true,
      claimsVersion: 1,
      createdAt: auditTimestamp,
      createdBy: SYSTEM_ACTOR_UID,
      updatedAt: auditTimestamp,
      updatedBy: SYSTEM_ACTOR_UID,
    },
    claims: {
      comite_ejecutivo: false,
      directivo: false,
      administrativo: true,
      empleado: false,
      comision_directiva: false,
      socio: false,
      desarrollador: false,
      claimsVersion: 1,
    },
  };
}

function getClubMonthStart(period: AccountingPeriod): Date {
  return new Date(`${period}-01T00:00:00${ACCOUNTING_TIME_ZONE_OFFSET}`);
}

function getFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo emitir la cuota mensual.';
}

export async function markMembershipRenewalsUseCase(params: {
  transactions: AccountingTransactionManager;
  actor?: Actor | null;
  now?: Date;
}): Promise<MarkMembershipRenewalsResult> {
  const actor = params.actor ? ensureStaff(params.actor) : createSystemAccountingActor();
  const period = toClubAccountingPeriod(params.now ?? new Date());
  const renewalDueDate = getClubMonthStart(period);
  const renewalDueAt = Timestamp.fromDate(renewalDueDate);

  let activeMemberCount = 0;
  let markedCount = 0;
  let generatedCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;
  const failures: MarkMembershipRenewalsResult['failures'] = [];

  let cursorId: string | undefined;
  do {
    const page = await params.transactions.getDataAccess().members.listPage({
      limit: MEMBERSHIP_EMISSION_PAGE_SIZE,
      ...(cursorId ? { cursorId } : {}),
    });

    for (const member of page.items) {
      if (member.status !== 'active' && member.status !== 'license') continue;
      activeMemberCount += 1;
      if (member.membershipBillingExempt) {
        skippedCount += 1;
        continue;
      }
      const dueAt = member.membershipRenewalDueAt;
      const shouldMark =
        member.membershipRenewalStatus !== 'needs_renewal' &&
        (!dueAt || dueAt.toMillis() <= renewalDueAt.toMillis());

      try {
        const result = await generateCuotaUseCase({
          actor,
          input: {
            memberId: member.id,
            period,
            dueDate: renewalDueDate,
            notes: `Emision automatica mensual ${period}.`,
          },
          transactions: params.transactions,
        });

        if (result.duplicate) {
          duplicateCount += 1;
        } else {
          generatedCount += 1;
        }

        const renewalIsAlreadySettled = result.status === 'paid' || result.status === 'exempt';
        if (renewalIsAlreadySettled) {
          const [pendingCharges, overdueCharges] = await Promise.all([
            params.transactions.getDataAccess().memberFeeCharges.listPage({
              memberId: member.id,
              status: 'pending',
              limit: 1,
            }),
            params.transactions.getDataAccess().memberFeeCharges.listPage({
              memberId: member.id,
              status: 'overdue',
              limit: 1,
            }),
          ]);
          if (pendingCharges.items.length > 0 || overdueCharges.items.length > 0) {
            continue;
          }
          const nextRenewalDueAt = Timestamp.fromDate(calculateMembershipRenewalDueDateFromPeriod(period));
          if (
            member.membershipRenewalStatus !== 'current'
            || !dueAt
            || dueAt.toMillis() <= renewalDueAt.toMillis()
          ) {
            await params.transactions.getDataAccess().members.update(
              member.id,
              {
                membershipRenewalStatus: 'current',
                membershipRenewalDueAt: nextRenewalDueAt,
              },
              actor.uid,
            );
          }
        } else if (shouldMark) {
          await params.transactions.getDataAccess().members.update(
            member.id,
            {
              membershipRenewalStatus: 'needs_renewal',
              membershipRenewalDueAt: renewalDueAt,
            },
            actor.uid,
          );
          markedCount += 1;
        }
      } catch (error) {
        skippedCount += 1;
        failures.push({
          memberId: member.id,
          memberName: `${member.lastName}, ${member.firstName}`,
          memberNumber: member.memberNumber,
          reason: getFailureReason(error),
        });
      }
    }

    cursorId = page.nextCursorId;
  } while (cursorId);

  return {
    period,
    dueDate: renewalDueDate.toISOString(),
    activeMemberCount,
    markedCount,
    generatedCount,
    duplicateCount,
    skippedCount,
    failures,
  };
}

export interface SyncMembershipRenewalsDailyResult {
  period: AccountingPeriod;
  issuance: MarkMembershipRenewalsResult;
  paymentReconciliation: ReconcileMemberFeeRenewalsResult;
}

export async function syncMembershipRenewalsDailyUseCase(params: {
  transactions: AccountingTransactionManager;
  now?: Date;
}): Promise<SyncMembershipRenewalsDailyResult> {
  const now = params.now ?? new Date();
  const actor = createSystemAccountingActor();
  const issuance = await markMembershipRenewalsUseCase({ transactions: params.transactions, actor, now });
  const paymentReconciliation = await reconcileMemberFeeRenewalsUseCase({
    actor,
    input: { period: issuance.period, execute: true },
    transactions: params.transactions,
  });
  return {
    period: issuance.period,
    issuance,
    paymentReconciliation,
  };
}
