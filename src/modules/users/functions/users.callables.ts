import { httpsCallable, type Functions } from 'firebase/functions';
import { getFirebaseFunctions } from '../../../lib/firebaseFunctions';
import type {
  AssignRolePayload,
  CreateEmployeePayload,
  CreateFamilyGroupPayload,
  CreateMemberPayload,
  EndLicensePayload,
  FamilyGroupMembershipPayload,
  RecordHandicapPayload,
  StartLicensePayload,
  SyncCustomClaimsPayload,
  UpdateEmployeePayload,
  UpdateMemberPayload,
} from '../domain/models';
import type {
  CreateMemberAuthUserPayload,
  MemberAuthStatus,
  RequestMemberPasswordResetPayload,
  RequestMemberPasswordResetResult,
  ResetMemberAuthPasswordPayload,
  SetMemberAuthAccessActivePayload,
  TemporaryMemberCredentials,
} from '../types/user.types';

const CALLABLE_NAMES = {
  createMember: 'usersCreateMember',
  updateMember: 'usersUpdateMember',
  createFamilyGroup: 'usersCreateFamilyGroup',
  addMemberToFamilyGroup: 'usersAddMemberToFamilyGroup',
  removeMemberFromFamilyGroup: 'usersRemoveMemberFromFamilyGroup',
  startLicense: 'usersStartLicense',
  endLicense: 'usersEndLicense',
  getNextMemberNumber: 'usersGetNextMemberNumber',
  createEmployee: 'usersCreateEmployee',
  updateEmployee: 'usersUpdateEmployee',
  assignRole: 'usersAssignRole',
  syncCustomClaims: 'usersSyncCustomClaims',
  recordHandicap: 'usersRecordHandicap',
  createMemberAuthUser: 'authOnboardingCreateMemberAuthUser',
  requestMemberPasswordReset: 'authOnboardingRequestMemberPasswordReset',
  completeOwnPasswordChange: 'authOnboardingCompleteOwnPasswordChange',
  getMemberAuthStatus: 'authOnboardingGetMemberAuthStatus',
  resetMemberAuthPassword: 'authOnboardingResetMemberAuthPassword',
  setMemberAuthAccessActive: 'authOnboardingSetMemberAuthAccessActive',
} as const;

type CreateMemberResult = {
  memberId: string;
  linkedUserId?: string;
  mustChangePassword?: boolean;
} & Partial<TemporaryMemberCredentials>;
type CreateFamilyGroupResult = { familyGroupId: string };
type CreateEmployeeResult = { employeeId: string };
type RecordHandicapResult = { handicapId: string; memberId: string };
type AssignRoleResult = { uid: string; claimsVersion: number };
export type NextMemberNumberResult = {
  nextNumericId: number;
  nextMemberNumber: string;
  normalizedNextMemberNumber: string;
  highestNumericId: number | null;
  highestMemberNumber: string | null;
  inspectedCount: number;
  numericCount: number;
};
type CreateMemberAuthUserResult = {
  uid: string;
  memberId: string;
  memberNumber: string;
  claimsVersion: number;
} & Partial<TemporaryMemberCredentials>;
type ResetMemberAuthPasswordResult = {
  uid: string;
  memberId: string;
} & Partial<TemporaryMemberCredentials>;
type SetMemberAuthAccessActiveResult = { uid: string; memberId: string; active: boolean; claimsVersion: number };

function getUsersFunctions(functionsInstance?: Functions): Functions {
  return getFirebaseFunctions(functionsInstance);
}

export function createUsersCallables(functionsInstance?: Functions) {
  const functionsRef = getUsersFunctions(functionsInstance);

  return {
    async createMember(payload: CreateMemberPayload) {
      return (await httpsCallable<CreateMemberPayload, CreateMemberResult>(
        functionsRef,
        CALLABLE_NAMES.createMember,
      )(payload)).data;
    },
    async updateMember(payload: UpdateMemberPayload) {
      return (await httpsCallable<UpdateMemberPayload, CreateMemberResult>(
        functionsRef,
        CALLABLE_NAMES.updateMember,
      )(payload)).data;
    },
    async createFamilyGroup(payload: CreateFamilyGroupPayload) {
      return (await httpsCallable<CreateFamilyGroupPayload, CreateFamilyGroupResult>(
        functionsRef,
        CALLABLE_NAMES.createFamilyGroup,
      )(payload)).data;
    },
    async addMemberToFamilyGroup(payload: FamilyGroupMembershipPayload) {
      return (await httpsCallable<FamilyGroupMembershipPayload, CreateFamilyGroupResult>(
        functionsRef,
        CALLABLE_NAMES.addMemberToFamilyGroup,
      )(payload)).data;
    },
    async removeMemberFromFamilyGroup(payload: FamilyGroupMembershipPayload) {
      return (await httpsCallable<FamilyGroupMembershipPayload, CreateFamilyGroupResult>(
        functionsRef,
        CALLABLE_NAMES.removeMemberFromFamilyGroup,
      )(payload)).data;
    },
    async startLicense(payload: StartLicensePayload) {
      return (await httpsCallable<StartLicensePayload, CreateMemberResult>(
        functionsRef,
        CALLABLE_NAMES.startLicense,
      )(payload)).data;
    },
    async endLicense(payload: EndLicensePayload) {
      return (await httpsCallable<EndLicensePayload, CreateMemberResult>(
        functionsRef,
        CALLABLE_NAMES.endLicense,
      )(payload)).data;
    },
    async getNextMemberNumber() {
      return (await httpsCallable<Record<string, never>, NextMemberNumberResult>(
        functionsRef,
        CALLABLE_NAMES.getNextMemberNumber,
      )({})).data;
    },
    async createEmployee(payload: CreateEmployeePayload) {
      return (await httpsCallable<CreateEmployeePayload, CreateEmployeeResult>(
        functionsRef,
        CALLABLE_NAMES.createEmployee,
      )(payload)).data;
    },
    async updateEmployee(payload: UpdateEmployeePayload) {
      return (await httpsCallable<UpdateEmployeePayload, CreateEmployeeResult>(
        functionsRef,
        CALLABLE_NAMES.updateEmployee,
      )(payload)).data;
    },
    async assignRole(payload: AssignRolePayload) {
      return (await httpsCallable<AssignRolePayload, AssignRoleResult>(
        functionsRef,
        CALLABLE_NAMES.assignRole,
      )(payload)).data;
    },
    async syncCustomClaims(payload: SyncCustomClaimsPayload) {
      return (await httpsCallable<SyncCustomClaimsPayload, AssignRoleResult>(
        functionsRef,
        CALLABLE_NAMES.syncCustomClaims,
      )(payload)).data;
    },
    async recordHandicap(payload: RecordHandicapPayload) {
      return (await httpsCallable<RecordHandicapPayload, RecordHandicapResult>(
        functionsRef,
        CALLABLE_NAMES.recordHandicap,
      )(payload)).data;
    },
    async createMemberAuthUser(payload: CreateMemberAuthUserPayload) {
      return (await httpsCallable<CreateMemberAuthUserPayload, CreateMemberAuthUserResult>(
        functionsRef,
        CALLABLE_NAMES.createMemberAuthUser,
      )(payload)).data;
    },
    async requestMemberPasswordReset(payload: RequestMemberPasswordResetPayload) {
      return (await httpsCallable<RequestMemberPasswordResetPayload, RequestMemberPasswordResetResult>(
        functionsRef,
        CALLABLE_NAMES.requestMemberPasswordReset,
      )(payload)).data;
    },
    async completeOwnPasswordChange() {
      return (await httpsCallable<Record<string, never>, { uid: string }>(
        functionsRef,
        CALLABLE_NAMES.completeOwnPasswordChange,
      )({})).data;
    },
    async getMemberAuthStatus(payload: { memberId: string }) {
      return (await httpsCallable<{ memberId: string }, MemberAuthStatus>(
        functionsRef,
        CALLABLE_NAMES.getMemberAuthStatus,
      )(payload)).data;
    },
    async resetMemberAuthPassword(payload: ResetMemberAuthPasswordPayload) {
      return (await httpsCallable<ResetMemberAuthPasswordPayload, ResetMemberAuthPasswordResult>(
        functionsRef,
        CALLABLE_NAMES.resetMemberAuthPassword,
      )(payload)).data;
    },
    async setMemberAuthAccessActive(payload: SetMemberAuthAccessActivePayload) {
      return (await httpsCallable<SetMemberAuthAccessActivePayload, SetMemberAuthAccessActiveResult>(
        functionsRef,
        CALLABLE_NAMES.setMemberAuthAccessActive,
      )(payload)).data;
    },
  };
}

export type UsersCallableApi = ReturnType<typeof createUsersCallables>;
