import { createUsersCallables } from '../functions/users.callables';
import { createFamilyGroupsRepository } from '../repositories/familyGroups.repository';
import { createMembersRepository } from '../repositories/members.repository';
import type {
  CreateFamilyGroupPayload,
  CreateMemberPayload,
  EndLicensePayload,
  FamilyGroupMembershipPayload,
  RecordHandicapPayload,
  StartLicensePayload,
  UpdateMemberPayload,
} from '../domain/models';
import type { ListFamilyGroupsParams } from '../types/family.types';
import type { ListMembersParams, MemberUpdateInput } from '../types/member.types';
import type { CreateMemberAuthUserPayload } from '../types/user.types';

export function createMemberRegistryService() {
  const membersRepository = createMembersRepository();
  const familyGroupsRepository = createFamilyGroupsRepository();
  const callables = createUsersCallables();

  return {
    listMembers(params?: ListMembersParams) {
      return membersRepository.listMembers(params);
    },
    getMember(memberId: string) {
      return membersRepository.getMember(memberId);
    },
    createMember(payload: CreateMemberPayload) {
      return callables.createMember(payload);
    },
    updateMember(memberId: string, payload: MemberUpdateInput) {
      return callables.updateMember({ memberId, ...payload } satisfies UpdateMemberPayload);
    },
    activateMember(memberId: string) {
      return callables.updateMember({ memberId, status: 'active' });
    },
    deactivateMember(memberId: string) {
      return callables.updateMember({ memberId, status: 'inactive' });
    },
    startLicense(memberId: string, startAt: string, endAt: string) {
      return callables.startLicense({ memberId, startAt, endAt } satisfies StartLicensePayload);
    },
    endLicense(memberId: string) {
      return callables.endLicense({ memberId } satisfies EndLicensePayload);
    },
    getNextMemberNumber() {
      return callables.getNextMemberNumber();
    },
    createFamilyGroup(holderMemberId: string, memberIds: string[]) {
      return callables.createFamilyGroup({ holderMemberId, memberIds } satisfies CreateFamilyGroupPayload);
    },
    addMemberToFamilyGroup(groupId: string, memberId: string) {
      return callables.addMemberToFamilyGroup({ groupId, memberId } satisfies FamilyGroupMembershipPayload);
    },
    removeMemberFromFamilyGroup(groupId: string, memberId: string, replacementHolderMemberId?: string) {
      const payload: FamilyGroupMembershipPayload = {
        groupId,
        memberId,
      };

      if (replacementHolderMemberId) {
        payload.replacementHolderMemberId = replacementHolderMemberId;
      }

      return callables.removeMemberFromFamilyGroup(payload);
    },
    linkMemberToAuthUser(memberId: string, linkedUserId: string) {
      return callables.updateMember({ memberId, linkedUserId });
    },
    createMemberAuthUser(memberId: string, payload: Omit<CreateMemberAuthUserPayload, 'memberId'>) {
      return callables.createMemberAuthUser({ memberId, ...payload });
    },
    recordHandicap(memberId: string, handicapNumber: number, validFrom: string) {
      return callables.recordHandicap({ memberId, handicapNumber, validFrom } satisfies RecordHandicapPayload);
    },
    listMemberTypes() {
      return membersRepository.listMemberTypes();
    },
    listFamilyGroups(params?: ListFamilyGroupsParams) {
      return familyGroupsRepository.listFamilyGroups(params);
    },
  };
}

export type MemberRegistryService = ReturnType<typeof createMemberRegistryService>;
