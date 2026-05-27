import { assertCondition } from '../../domain/errors.js';
import { MEMBER_TYPE_IDS } from '../../domain/constants.js';
import { assertIsRecord, ensureAuthenticatedActor, ensureFamilyHolderEligibility, ensureMinimumFamilyGroup, ensureStaff, hasExecutiveAccess, parseOptionalString, parseRequiredString, parseRequiredStringArray, } from '../shared.js';
function actorHasStaffClaims(actor) {
    const roleIds = new Set(actor.user.roleIds);
    return (actor.user.active &&
        (hasExecutiveAccess(actor) ||
            (roleIds.has('administrativo') && actor.claims.administrativo === true)));
}
function getActorMemberId(actor) {
    return actor.user.profileType === 'member' ? actor.user.profileId ?? null : null;
}
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
            typeId: member.id === params.input.holderMemberId ? 'grupo_familiar_titular' : 'grupo_familiar_asociado',
            typeCodeSnapshot: member.id === params.input.holderMemberId ? 'grupo_familiar_titular' : 'grupo_familiar_asociado',
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
            typeId: 'grupo_familiar_asociado',
            typeCodeSnapshot: 'grupo_familiar_asociado',
        }, actor.uid);
        await dataAccess.members.update(group.holderMemberId, {
            isFamilyHolder: true,
            typeId: 'grupo_familiar_titular',
            typeCodeSnapshot: 'grupo_familiar_titular',
        }, actor.uid);
        return { familyGroupId: params.input.groupId };
    });
}
export async function removeMemberFromFamilyGroupUseCase(params) {
    const actor = ensureAuthenticatedActor(params.actor);
    assertCondition(actor.user.active, 'permission-denied', 'El usuario no estÃ¡ activo.');
    return params.transactions.runInTransaction(async (dataAccess) => {
        const group = await dataAccess.familyGroups.getById(params.input.groupId);
        assertCondition(group, 'not-found', `No existe family_groups/${params.input.groupId}.`);
        assertCondition(group.memberIds.includes(params.input.memberId), 'failed-precondition', 'El socio no pertenece a ese grupo familiar.');
        const actorMemberId = getActorMemberId(actor);
        const isStaffActor = actorHasStaffClaims(actor);
        const isHolderManagingGroup = actorMemberId === group.holderMemberId && params.input.memberId !== actorMemberId;
        const isAssociatedLeavingSelf = actorMemberId === params.input.memberId && group.holderMemberId !== params.input.memberId;
        assertCondition(isStaffActor || isHolderManagingGroup || isAssociatedLeavingSelf, 'permission-denied', 'No tenÃ©s permisos para modificar este grupo familiar.');
        const nextMemberIds = group.memberIds.filter((memberId) => memberId !== params.input.memberId);
        const isRemovingHolder = group.holderMemberId === params.input.memberId;
        const nextHolderMemberId = isRemovingHolder ? params.input.replacementHolderMemberId : group.holderMemberId;
        if (nextMemberIds.length < 2) {
            const remainingMemberId = nextMemberIds[0];
            await dataAccess.familyGroups.update(params.input.groupId, {
                memberIds: nextMemberIds,
                holderMemberId: remainingMemberId ?? group.holderMemberId,
                active: false,
            }, actor.uid);
            await dataAccess.members.update(params.input.memberId, {
                familyGroupId: null,
                isFamilyHolder: false,
                typeId: 'pleno',
                typeCodeSnapshot: 'pleno',
            }, actor.uid);
            if (remainingMemberId) {
                await dataAccess.members.update(remainingMemberId, {
                    familyGroupId: null,
                    isFamilyHolder: false,
                    typeId: 'pleno',
                    typeCodeSnapshot: 'pleno',
                }, actor.uid);
            }
            return { familyGroupId: params.input.groupId };
        }
        ensureMinimumFamilyGroup(nextMemberIds);
        assertCondition(nextHolderMemberId && nextMemberIds.includes(nextHolderMemberId), 'failed-precondition', 'Debes indicar un titular de reemplazo que pertenezca al grupo.');
        if (isRemovingHolder) {
            const replacementHolder = await dataAccess.members.getById(nextHolderMemberId);
            assertCondition(replacementHolder, 'not-found', `No existe members/${nextHolderMemberId}.`);
            const replacementType = await dataAccess.memberTypes.getById(replacementHolder.typeId);
            assertCondition(replacementType, 'not-found', `No existe member_types/${replacementHolder.typeId}.`);
            if (replacementType.id !== MEMBER_TYPE_IDS.grupoFamiliarAsociado) {
                ensureFamilyHolderEligibility(replacementHolder, replacementType);
            }
        }
        await dataAccess.familyGroups.update(params.input.groupId, {
            memberIds: nextMemberIds,
            holderMemberId: nextHolderMemberId,
        }, actor.uid);
        await dataAccess.members.update(params.input.memberId, {
            familyGroupId: null,
            isFamilyHolder: false,
            typeId: 'pleno',
            typeCodeSnapshot: 'pleno',
        }, actor.uid);
        if (isRemovingHolder) {
            await dataAccess.members.update(nextHolderMemberId, {
                isFamilyHolder: true,
                typeId: 'grupo_familiar_titular',
                typeCodeSnapshot: 'grupo_familiar_titular',
            }, actor.uid);
        }
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
        replacementHolderMemberId: parseOptionalString(data, 'replacementHolderMemberId'),
    };
}
//# sourceMappingURL=family-group.use-cases.js.map