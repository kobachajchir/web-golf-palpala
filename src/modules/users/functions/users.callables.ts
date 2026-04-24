import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { app } from '../../../lib/firebase';
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

const CALLABLE_NAMES = {
  createMember: 'usersCreateMember',
  updateMember: 'usersUpdateMember',
  createFamilyGroup: 'usersCreateFamilyGroup',
  addMemberToFamilyGroup: 'usersAddMemberToFamilyGroup',
  removeMemberFromFamilyGroup: 'usersRemoveMemberFromFamilyGroup',
  startLicense: 'usersStartLicense',
  endLicense: 'usersEndLicense',
  createEmployee: 'usersCreateEmployee',
  updateEmployee: 'usersUpdateEmployee',
  assignRole: 'usersAssignRole',
  syncCustomClaims: 'usersSyncCustomClaims',
  recordHandicap: 'usersRecordHandicap',
} as const;

type CreateMemberResult = { memberId: string };
type CreateFamilyGroupResult = { familyGroupId: string };
type CreateEmployeeResult = { employeeId: string };
type RecordHandicapResult = { handicapId: string; memberId: string };
type AssignRoleResult = { uid: string; claimsVersion: number };

function getUsersFunctions(functionsInstance?: Functions): Functions {
  return functionsInstance ?? getFunctions(app);
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
  };
}

export type UsersCallableApi = ReturnType<typeof createUsersCallables>;
