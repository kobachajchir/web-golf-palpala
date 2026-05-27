import { Timestamp } from 'firebase-admin/firestore';
import { ACCOUNTING_TIME_ZONE_OFFSET, SYSTEM_ACTOR_UID, } from '../../domain/constants.js';
import { generateCuotaUseCase } from './fee.use-cases.js';
import { ensureStaff, toClubAccountingPeriod } from '../shared.js';
const MEMBERSHIP_EMISSION_PAGE_SIZE = 100;
function createSystemAccountingActor() {
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
            claimsVersion: 1,
        },
    };
}
function getClubMonthStart(period) {
    return new Date(`${period}-01T00:00:00${ACCOUNTING_TIME_ZONE_OFFSET}`);
}
function getFailureReason(error) {
    return error instanceof Error ? error.message : 'No se pudo emitir la cuota mensual.';
}
export async function markMembershipRenewalsUseCase(params) {
    const actor = params.actor ? ensureStaff(params.actor) : createSystemAccountingActor();
    const period = toClubAccountingPeriod(params.now ?? new Date());
    const renewalDueDate = getClubMonthStart(period);
    const renewalDueAt = Timestamp.fromDate(renewalDueDate);
    let activeMemberCount = 0;
    let markedCount = 0;
    let generatedCount = 0;
    let duplicateCount = 0;
    let skippedCount = 0;
    const failures = [];
    let cursorId;
    do {
        const page = await params.transactions.getDataAccess().members.listPage({
            status: 'active',
            limit: MEMBERSHIP_EMISSION_PAGE_SIZE,
            ...(cursorId ? { cursorId } : {}),
        });
        for (const member of page.items) {
            activeMemberCount += 1;
            const dueAt = member.membershipRenewalDueAt;
            const shouldMark = member.membershipRenewalStatus !== 'needs_renewal' &&
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
                }
                else {
                    generatedCount += 1;
                }
                if (shouldMark) {
                    await params.transactions.getDataAccess().members.update(member.id, {
                        membershipRenewalStatus: 'needs_renewal',
                        membershipRenewalDueAt: renewalDueAt,
                    }, actor.uid);
                    markedCount += 1;
                }
            }
            catch (error) {
                skippedCount += 1;
                failures.push({
                    memberId: member.id,
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
//# sourceMappingURL=membership-renewal.use-cases.js.map