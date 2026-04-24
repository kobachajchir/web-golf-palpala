import type {
  AuthSyncUserInput,
  CustomClaims,
  EmployeeDocument,
  EntityWithId,
  FamilyGroupDocument,
  HandicapDocument,
  MemberDocument,
  MemberTypeDocument,
  PermissionDocument,
  RoleDocument,
  RolePermissionDocument,
  UserDocument,
  UserProfileType,
} from './models.js';

export type StorePatch<T extends object> = {
  [K in keyof T]?: T[K] | null | undefined;
};

export type StoreCreate<T extends object> = {
  [K in keyof T]: T[K] | undefined;
};

export interface UsersStore {
  getById(uid: string): Promise<EntityWithId<UserDocument> | null>;
  syncFromAuthUser(input: AuthSyncUserInput): Promise<EntityWithId<UserDocument>>;
  assignRoles(params: {
    uid: string;
    roleIds: string[];
    primaryRoleId: string;
    nextClaimsVersion: number;
    actorUid: string;
  }): Promise<void>;
  setProfileLink(params: {
    uid: string;
    profileType: UserProfileType;
    profileId: string;
    actorUid: string;
  }): Promise<void>;
  clearProfileLink(params: {
    uid: string;
    actorUid: string;
    expectedProfileType?: UserProfileType;
    expectedProfileId?: string;
  }): Promise<void>;
}

export interface RolesStore {
  getById(roleId: string): Promise<EntityWithId<RoleDocument> | null>;
  getByIds(roleIds: readonly string[]): Promise<Array<EntityWithId<RoleDocument>>>;
}

export interface PermissionsStore {
  getById(permissionId: string): Promise<EntityWithId<PermissionDocument> | null>;
}

export interface RolePermissionsStore {
  listByRoleId(roleId: string): Promise<Array<EntityWithId<RolePermissionDocument>>>;
}

export interface MemberTypesStore {
  getById(memberTypeId: string): Promise<EntityWithId<MemberTypeDocument> | null>;
}

export interface FamilyGroupsStore {
  getById(groupId: string): Promise<EntityWithId<FamilyGroupDocument> | null>;
  create(
    data: StoreCreate<Omit<FamilyGroupDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(groupId: string, patch: StorePatch<FamilyGroupDocument>, actorUid: string): Promise<void>;
}

export interface MembersStore {
  getById(memberId: string): Promise<EntityWithId<MemberDocument> | null>;
  getByIds(memberIds: readonly string[]): Promise<Array<EntityWithId<MemberDocument>>>;
  create(
    data: StoreCreate<Omit<MemberDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(memberId: string, patch: StorePatch<MemberDocument>, actorUid: string): Promise<void>;
}

export interface EmployeesStore {
  getById(employeeId: string): Promise<EntityWithId<EmployeeDocument> | null>;
  create(
    data: StoreCreate<Omit<EmployeeDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(employeeId: string, patch: StorePatch<EmployeeDocument>, actorUid: string): Promise<void>;
}

export interface HandicapsStore {
  getById(handicapId: string): Promise<EntityWithId<HandicapDocument> | null>;
  listActiveByMemberId(memberId: string): Promise<Array<EntityWithId<HandicapDocument>>>;
  listByMemberId(memberId: string): Promise<Array<EntityWithId<HandicapDocument>>>;
  create(
    data: StoreCreate<Omit<HandicapDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(handicapId: string, patch: StorePatch<HandicapDocument>, actorUid: string): Promise<void>;
}

export interface UsersDataAccess {
  users: UsersStore;
  roles: RolesStore;
  permissions: PermissionsStore;
  rolePermissions: RolePermissionsStore;
  memberTypes: MemberTypesStore;
  familyGroups: FamilyGroupsStore;
  members: MembersStore;
  employees: EmployeesStore;
  handicaps: HandicapsStore;
}

export interface UsersTransactionManager {
  runInTransaction<T>(handler: (dataAccess: UsersDataAccess) => Promise<T>): Promise<T>;
  getDataAccess(): UsersDataAccess;
}

export interface AuthGateway {
  setCustomClaims(uid: string, claims: CustomClaims): Promise<void>;
}

export interface Clock {
  now(): Date;
}
