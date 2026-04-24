import { Timestamp } from 'firebase-admin/firestore';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureStaff, parseOptionalString, parseRequiredIsoDate, parseRequiredString, } from '../shared.js';
export async function recordHandicapUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const member = await dataAccess.members.getById(params.input.memberId);
        assertCondition(member, 'not-found', `No existe members/${params.input.memberId}.`);
        const activeHandicaps = await dataAccess.handicaps.listActiveByMemberId(params.input.memberId);
        for (const activeHandicap of activeHandicaps) {
            await dataAccess.handicaps.update(activeHandicap.id, {
                status: 'inactive',
                validTo: Timestamp.fromDate(params.input.validFrom),
            }, actor.uid);
        }
        const handicapId = await dataAccess.handicaps.create({
            memberId: params.input.memberId,
            handicapNumber: params.input.handicapNumber,
            sourceAssociation: params.input.sourceAssociation,
            validFrom: Timestamp.fromDate(params.input.validFrom),
            status: 'active',
            issuedByUid: actor.uid,
            notes: params.input.notes,
        }, actor.uid);
        await dataAccess.members.update(params.input.memberId, {
            currentHandicapId: handicapId,
            currentHandicapNumber: params.input.handicapNumber,
        }, actor.uid);
        return {
            handicapId,
            memberId: params.input.memberId,
        };
    });
}
export async function refreshMemberHandicapSnapshotUseCase(params) {
    await params.transactions.runInTransaction(async (dataAccess) => {
        const member = await dataAccess.members.getById(params.memberId);
        if (!member) {
            return;
        }
        const activeHandicaps = await dataAccess.handicaps.listActiveByMemberId(params.memberId);
        const currentHandicap = activeHandicaps
            .sort((left, right) => right.validFrom.toMillis() - left.validFrom.toMillis())
            .at(0);
        await dataAccess.members.update(params.memberId, {
            currentHandicapId: currentHandicap?.id,
            currentHandicapNumber: currentHandicap?.handicapNumber,
        }, 'system');
    });
}
export function ensureSingleActiveHandicap(handicaps, member) {
    const activeCount = handicaps.filter((handicap) => handicap.status === 'active').length;
    assertCondition(activeCount <= 1, 'failed-precondition', `El socio ${member.id} tiene más de un handicap activo.`);
}
export function parseRecordHandicapInput(payload) {
    const data = assertIsRecord(payload);
    const handicapNumber = data.handicapNumber;
    assertCondition(typeof handicapNumber === 'number' && Number.isFinite(handicapNumber), 'invalid-argument', 'El handicap debe ser numérico.');
    return {
        memberId: parseRequiredString(data, 'memberId'),
        handicapNumber,
        validFrom: parseRequiredIsoDate(data, 'validFrom'),
        sourceAssociation: parseOptionalString(data, 'sourceAssociation'),
        notes: parseOptionalString(data, 'notes'),
    };
}
//# sourceMappingURL=handicap.use-cases.js.map