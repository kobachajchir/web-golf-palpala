import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureFamilyHolderEligibility, ensureMinimumFamilyGroup, ensureStaff, parseOptionalString, parseRequiredString, parseRequiredStringArray, } from '../shared.js';
export async function createFamilyGroupUseCase(params) {
    const actor = ensureStaff(params.actor);
    ensureMinimumFamilyGroup(params.input.memberIds);
    return params.transactions.runInTransaction(async (dataAccess) => {
        assertCondition(params.input.memberIds.includes(params.input.holderMemberId), 'failed-precondition', 'El titular debe pertenecer al grupo familiar.');
        const members = await dataAccess.members.getByIds(params.input.memberIds);
        assertCondition(members.length === Array.from(new Set(params.input.memberIds)).length, 'not-found', 'Uno o más socios no existen.');
        const holderMember = members.find((member) => member.id === params.input.holderMemberId);
        assertCondition(holderMember, 'not-found', `No existe members/${params.input.holderMemberId}.`);
        const holderType = await dataAccess.memberTypes.getById(holderMember.typeId);
        assertCondition(holderType, 'not-found', `No existe member_types/${holderMember.typeId}.`);
        ensureFamilyHolderEligibility(holderMember, holderType);
        for (const member of members) {
            assertCondition(!member.familyGroupId, 'failed-precondition', `El socio ${member.id} ya pertenece a un grupo familiar.`);
        }
        const familyGroupId = await dataAccess.familyGroups.create({
            code: params.input.code,
            holderMemberId: params.input.holderMemberId,
            memberIds: Array.from(new Set(params.input.memberIds)),
            active: true,
            notes: params.input.notes,
        }, actor.uid);
        await Promise.all(members.map((member) => dataAccess.members.update(member.id, {
            familyGroupId,
            isFamilyHolder: member.id === params.input.holderMemberId,
        }, actor.uid)));
        return { familyGroupId };
    });
}
export async function addMemberToFamilyGroupUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const group = await dataAccess.familyGroups.getById(params.input.groupId);
        assertCondition(group, 'not-found', `No existe family_groups/${params.input.groupId}.`);
        assertCondition(group.active, 'failed-precondition', 'El grupo familiar está inactivo.');
        const member = await dataAccess.members.getById(params.input.memberId);
        assertCondition(member, 'not-found', `No existe members/${params.input.memberId}.`);
        if (group.memberIds.includes(params.input.memberId)) {
            return { familyGroupId: params.input.groupId };
        }
        assertCondition(!member.familyGroupId, 'failed-precondition', `El socio ${member.id} ya pertenece a otro grupo familiar.`);
        const nextMemberIds = [...group.memberIds, member.id];
        await dataAccess.familyGroups.update(params.input.groupId, {
            memberIds: nextMemberIds,
        }, actor.uid);
        await dataAccess.members.update(params.input.memberId, {
            familyGroupId: params.input.groupId,
            isFamilyHolder: false,
        }, actor.uid);
        return { familyGroupId: params.input.groupId };
    });
}
export async function removeMemberFromFamilyGroupUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const group = await dataAccess.familyGroups.getById(params.input.groupId);
        assertCondition(group, 'not-found', `No existe family_groups/${params.input.groupId}.`);
        assertCondition(group.memberIds.includes(params.input.memberId), 'failed-precondition', 'El socio no pertenece a ese grupo familiar.');
        assertCondition(group.holderMemberId !== params.input.memberId, 'failed-precondition', 'Debes reasignar el titular antes de removerlo del grupo.');
        const nextMemberIds = group.memberIds.filter((memberId) => memberId !== params.input.memberId);
        ensureMinimumFamilyGroup(nextMemberIds);
        await dataAccess.familyGroups.update(params.input.groupId, {
            memberIds: nextMemberIds,
        }, actor.uid);
        await dataAccess.members.update(params.input.memberId, {
            familyGroupId: null,
            isFamilyHolder: false,
        }, actor.uid);
        return { familyGroupId: params.input.groupId };
    });
}
export function parseCreateFamilyGroupInput(payload) {
    const data = assertIsRecord(payload);
    return {
        holderMemberId: parseRequiredString(data, 'holderMemberId'),
        memberIds: parseRequiredStringArray(data, 'memberIds'),
        code: parseOptionalString(data, 'code'),
        notes: parseOptionalString(data, 'notes'),
    };
}
export function parseAddMemberToFamilyGroupInput(payload) {
    const data = assertIsRecord(payload);
    return {
        groupId: parseRequiredString(data, 'groupId'),
        memberId: parseRequiredString(data, 'memberId'),
    };
}
export function parseRemoveMemberFromFamilyGroupInput(payload) {
    const data = assertIsRecord(payload);
    return {
        groupId: parseRequiredString(data, 'groupId'),
        memberId: parseRequiredString(data, 'memberId'),
    };
}
//# sourceMappingURL=family-group.use-cases.js.map