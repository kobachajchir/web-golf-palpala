import { Timestamp } from 'firebase-admin/firestore';
import type {
  Actor,
  CustomClaims,
  EmployeeDocument,
  EntityWithId,
  FamilyGroupDocument,
  HandicapDocument,
  MemberLoginIdentifierDocument,
  MemberDocument,
  MemberTypeDocument,
  PermissionDocument,
  RoleDocument,
  RolePermissionDocument,
  UserDocument,
  UserProfileType,
} from '../../src/modules/users/domain/models.js';
import type {
  AuthGateway,
  Clock,
  EmployeesStore,
  FamilyGroupsStore,
  HandicapsStore,
  MemberLoginIdentifiersStore,
  MemberTypesStore,
  MembersStore,
  PermissionsStore,
  RolePermissionsStore,
  RolesStore,
  StorePatch,
  UsersDataAccess,
  UsersStore,
  UsersTransactionManager,
} from '../../src/modules/users/domain/ports.js';

function timestampNow(): Timestamp {
  return Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z'));
}

function applyPatch<T extends object>(entity: T, patch: StorePatch<T>): T {
  const nextEntity = { ...entity } as Record<string, unknown>;

  for (const [key, value] of Object.entries(patch) as Array<[keyof T, T[keyof T] | null | undefined]>) {
    if (value === undefined) {
      continue;
    }

    if (value === null) {
      delete nextEntity[key as string];
      continue;
    }

    nextEntity[key as string] = value;
  }

  return nextEntity as T;
}

function createAudit(actorUid = 'system') {
  const now = timestampNow();
  return {
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  };
}

class InMemoryUsersStore implements UsersStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<UserDocument>>,
    private readonly clock: Clock,
  ) {}

  public async getById(uid: string): Promise<EntityWithId<UserDocument> | null> {
    return this.items.get(uid) ?? null;
  }

  public async syncFromAuthUser(input: { uid: string; email?: string | null; displayName?: string | null }): Promise<EntityWithId<UserDocument>> {
    const existing = this.items.get(input.uid);
    if (existing) {
      const nextUser = {
        ...existing,
        email: existing.email || input.email || '',
        displayName: existing.displayName === 'Usuario' && input.displayName ? input.displayName : existing.displayName,
        lastLoginAt: Timestamp.fromDate(this.clock.now()),
      };
      this.items.set(input.uid, nextUser);
      return nextUser;
    }

    const createdUser: EntityWithId<UserDocument> = {
      id: input.uid,
      email: input.email ?? '',
      displayName: input.displayName?.trim() || 'Usuario',
      primaryRoleId: 'socio',
      roleIds: ['socio'],
      profileType: 'none',
      active: true,
      claimsVersion: 1,
      lastLoginAt: Timestamp.fromDate(this.clock.now()),
      ...createAudit('system'),
    };
    this.items.set(input.uid, createdUser);
    return createdUser;
  }

  public async assignRoles(params: {
    uid: string;
    roleIds: string[];
    primaryRoleId: string;
    nextClaimsVersion: number;
    actorUid: string;
  }): Promise<void> {
    const existing = this.items.get(params.uid);
    if (!existing) {
      return;
    }

    this.items.set(params.uid, {
      ...existing,
      roleIds: [...params.roleIds],
      primaryRoleId: params.primaryRoleId,
      claimsVersion: params.nextClaimsVersion,
      updatedBy: params.actorUid,
      updatedAt: timestampNow(),
    });
  }

  public async setProfileLink(params: {
    uid: string;
    profileType: UserProfileType;
    profileId: string;
    actorUid: string;
  }): Promise<void> {
    const existing = this.items.get(params.uid);
    if (!existing) {
      return;
    }

    this.items.set(params.uid, {
      ...existing,
      profileType: params.profileType,
      profileId: params.profileId,
      updatedBy: params.actorUid,
      updatedAt: timestampNow(),
    });
  }

  public async clearProfileLink(params: {
    uid: string;
    actorUid: string;
    expectedProfileType?: UserProfileType;
    expectedProfileId?: string;
  }): Promise<void> {
    const existing = this.items.get(params.uid);
    if (!existing) {
      return;
    }

    if (params.expectedProfileType && existing.profileType !== params.expectedProfileType) {
      return;
    }

    if (params.expectedProfileId && existing.profileId !== params.expectedProfileId) {
      return;
    }

    const nextUser = { ...existing };
    delete nextUser.profileId;
    nextUser.profileType = 'none';
    nextUser.updatedBy = params.actorUid;
    nextUser.updatedAt = timestampNow();
    this.items.set(params.uid, nextUser);
  }
}

class InMemoryRolesStore implements RolesStore {
  public constructor(private readonly items: Map<string, EntityWithId<RoleDocument>>) {}

  public async getById(roleId: string): Promise<EntityWithId<RoleDocument> | null> {
    return this.items.get(roleId) ?? null;
  }

  public async getByIds(roleIds: readonly string[]): Promise<Array<EntityWithId<RoleDocument>>> {
    return roleIds.flatMap((roleId) => {
      const role = this.items.get(roleId);
      return role ? [role] : [];
    });
  }
}

class InMemoryPermissionsStore implements PermissionsStore {
  public constructor(private readonly items: Map<string, EntityWithId<PermissionDocument>>) {}

  public async getById(permissionId: string): Promise<EntityWithId<PermissionDocument> | null> {
    return this.items.get(permissionId) ?? null;
  }
}

class InMemoryRolePermissionsStore implements RolePermissionsStore {
  public constructor(private readonly items: Map<string, EntityWithId<RolePermissionDocument>>) {}

  public async listByRoleId(roleId: string): Promise<Array<EntityWithId<RolePermissionDocument>>> {
    return Array.from(this.items.values()).filter((item) => item.roleId === roleId);
  }
}

class InMemoryMemberTypesStore implements MemberTypesStore {
  public constructor(private readonly items: Map<string, EntityWithId<MemberTypeDocument>>) {}

  public async getById(memberTypeId: string): Promise<EntityWithId<MemberTypeDocument> | null> {
    return this.items.get(memberTypeId) ?? null;
  }
}

class InMemoryFamilyGroupsStore implements FamilyGroupsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<FamilyGroupDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(groupId: string): Promise<EntityWithId<FamilyGroupDocument> | null> {
    return this.items.get(groupId) ?? null;
  }

  public async create(
    data: Omit<FamilyGroupDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, {
      id,
      ...data,
      ...createAudit(actorUid),
    });
    return id;
  }

  public async update(groupId: string, patch: StorePatch<FamilyGroupDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(groupId);
    if (!existing) {
      return;
    }

    this.items.set(groupId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedBy: actorUid,
      updatedAt: timestampNow(),
    });
  }
}

class InMemoryMembersStore implements MembersStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<MemberDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(memberId: string): Promise<EntityWithId<MemberDocument> | null> {
    return this.items.get(memberId) ?? null;
  }

  public async getByIds(memberIds: readonly string[]): Promise<Array<EntityWithId<MemberDocument>>> {
    return memberIds.flatMap((memberId) => {
      const member = this.items.get(memberId);
      return member ? [member] : [];
    });
  }

  public async create(
    data: Omit<MemberDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, {
      id,
      ...data,
      ...createAudit(actorUid),
    });
    return id;
  }

  public async createWithId(
    memberId: string,
    data: Omit<MemberDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<void> {
    this.items.set(memberId, {
      id: memberId,
      ...data,
      ...createAudit(actorUid),
    });
  }

  public async update(memberId: string, patch: StorePatch<MemberDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(memberId);
    if (!existing) {
      return;
    }

    this.items.set(memberId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedBy: actorUid,
      updatedAt: timestampNow(),
    });
  }
}

class InMemoryMemberLoginIdentifiersStore implements MemberLoginIdentifiersStore {
  public constructor(private readonly items: Map<string, EntityWithId<MemberLoginIdentifierDocument>>) {}

  public async getById(normalizedMemberNumber: string): Promise<EntityWithId<MemberLoginIdentifierDocument> | null> {
    return this.items.get(normalizedMemberNumber) ?? null;
  }

  public async set(
    normalizedMemberNumber: string,
    data: StorePatch<MemberLoginIdentifierDocument>,
    actorUid: string,
  ): Promise<void> {
    const existing = this.items.get(normalizedMemberNumber);
    if (existing) {
      this.items.set(normalizedMemberNumber, {
        id: existing.id,
        ...applyPatch(existing, data),
        updatedBy: actorUid,
        updatedAt: timestampNow(),
      });
      return;
    }

    this.items.set(normalizedMemberNumber, {
      id: normalizedMemberNumber,
      uid: data.uid ?? null,
      memberId: data.memberId ?? null,
      memberNumber: data.memberNumber ?? normalizedMemberNumber,
      active: data.active ?? true,
      ...createAudit(actorUid),
    });
  }
}

class InMemoryEmployeesStore implements EmployeesStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<EmployeeDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(employeeId: string): Promise<EntityWithId<EmployeeDocument> | null> {
    return this.items.get(employeeId) ?? null;
  }

  public async create(
    data: Omit<EmployeeDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, {
      id,
      ...data,
      ...createAudit(actorUid),
    });
    return id;
  }

  public async update(employeeId: string, patch: StorePatch<EmployeeDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(employeeId);
    if (!existing) {
      return;
    }

    this.items.set(employeeId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedBy: actorUid,
      updatedAt: timestampNow(),
    });
  }
}

class InMemoryHandicapsStore implements HandicapsStore {
  public constructor(
    private readonly items: Map<string, EntityWithId<HandicapDocument>>,
    private readonly nextId: () => string,
  ) {}

  public async getById(handicapId: string): Promise<EntityWithId<HandicapDocument> | null> {
    return this.items.get(handicapId) ?? null;
  }

  public async listActiveByMemberId(memberId: string): Promise<Array<EntityWithId<HandicapDocument>>> {
    return Array.from(this.items.values()).filter((item) => item.memberId === memberId && item.status === 'active');
  }

  public async listByMemberId(memberId: string): Promise<Array<EntityWithId<HandicapDocument>>> {
    return Array.from(this.items.values()).filter((item) => item.memberId === memberId);
  }

  public async create(
    data: Omit<HandicapDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
    actorUid: string,
  ): Promise<string> {
    const id = this.nextId();
    this.items.set(id, {
      id,
      ...data,
      ...createAudit(actorUid),
    });
    return id;
  }

  public async update(handicapId: string, patch: StorePatch<HandicapDocument>, actorUid: string): Promise<void> {
    const existing = this.items.get(handicapId);
    if (!existing) {
      return;
    }

    this.items.set(handicapId, {
      id: existing.id,
      ...applyPatch(existing, patch),
      updatedBy: actorUid,
      updatedAt: timestampNow(),
    });
  }
}

export class FakeAuthGateway implements AuthGateway {
  public readonly claimsByUid = new Map<string, CustomClaims>();

  public async setCustomClaims(uid: string, claims: CustomClaims): Promise<void> {
    this.claimsByUid.set(uid, claims);
  }
}

export class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-01-01T00:00:00.000Z');
  }
}

export class InMemoryUsersTransactionManager implements UsersTransactionManager {
  public readonly users = new Map<string, EntityWithId<UserDocument>>();
  public readonly roles = new Map<string, EntityWithId<RoleDocument>>();
  public readonly permissions = new Map<string, EntityWithId<PermissionDocument>>();
  public readonly rolePermissions = new Map<string, EntityWithId<RolePermissionDocument>>();
  public readonly memberTypes = new Map<string, EntityWithId<MemberTypeDocument>>();
  public readonly familyGroups = new Map<string, EntityWithId<FamilyGroupDocument>>();
  public readonly members = new Map<string, EntityWithId<MemberDocument>>();
  public readonly memberLoginIdentifiers = new Map<string, EntityWithId<MemberLoginIdentifierDocument>>();
  public readonly employees = new Map<string, EntityWithId<EmployeeDocument>>();
  public readonly handicaps = new Map<string, EntityWithId<HandicapDocument>>();

  private readonly clock = new FixedClock();
  private familyGroupCounter = 0;
  private memberCounter = 0;
  private employeeCounter = 0;
  private handicapCounter = 0;

  public readonly dataAccess: UsersDataAccess = {
    users: new InMemoryUsersStore(this.users, this.clock),
    roles: new InMemoryRolesStore(this.roles),
    permissions: new InMemoryPermissionsStore(this.permissions),
    rolePermissions: new InMemoryRolePermissionsStore(this.rolePermissions),
    memberTypes: new InMemoryMemberTypesStore(this.memberTypes),
    familyGroups: new InMemoryFamilyGroupsStore(this.familyGroups, () => `family-group-${++this.familyGroupCounter}`),
    members: new InMemoryMembersStore(this.members, () => `member-${++this.memberCounter}`),
    memberLoginIdentifiers: new InMemoryMemberLoginIdentifiersStore(this.memberLoginIdentifiers),
    employees: new InMemoryEmployeesStore(this.employees, () => `employee-${++this.employeeCounter}`),
    handicaps: new InMemoryHandicapsStore(this.handicaps, () => `handicap-${++this.handicapCounter}`),
  };

  public async runInTransaction<T>(handler: (dataAccess: UsersDataAccess) => Promise<T>): Promise<T> {
    return handler(this.dataAccess);
  }

  public getDataAccess(): UsersDataAccess {
    return this.dataAccess;
  }
}

export function seedRole(manager: InMemoryUsersTransactionManager, roleId: string, overrides?: Partial<RoleDocument>) {
  manager.roles.set(roleId, {
    id: roleId,
    name: roleId,
    permissionIds: [],
    system: true,
    active: true,
    sortOrder: 1,
    ...createAudit(),
    ...overrides,
  });
}

export function seedMemberType(
  manager: InMemoryUsersTransactionManager,
  memberTypeId: string,
  overrides?: Partial<MemberTypeDocument>,
) {
  manager.memberTypes.set(memberTypeId, {
    id: memberTypeId,
    label: memberTypeId,
    billingConfigKey: 'FULL',
    requiresFamilyGroup: false,
    canBeFamilyHolder: true,
    active: true,
    sortOrder: 1,
    ...createAudit(),
    ...overrides,
  });
}

export function seedUser(
  manager: InMemoryUsersTransactionManager,
  uid: string,
  overrides?: Partial<UserDocument>,
): EntityWithId<UserDocument> {
  const user: EntityWithId<UserDocument> = {
    id: uid,
    email: `${uid}@club.test`,
    displayName: uid,
    primaryRoleId: 'socio',
    roleIds: ['socio'],
    profileType: 'none',
    active: true,
    claimsVersion: 1,
    ...createAudit(),
    ...overrides,
  };
  manager.users.set(uid, user);
  return user;
}

export function createActor(user: EntityWithId<UserDocument>, claims?: Partial<CustomClaims>): Actor {
  return {
    uid: user.id,
    user,
    claims: {
      comite_ejecutivo: user.roleIds.includes('comite_ejecutivo') || user.roleIds.includes('directivo'),
      directivo: user.roleIds.includes('comite_ejecutivo') || user.roleIds.includes('directivo'),
      administrativo: user.roleIds.includes('administrativo'),
      empleado: user.roleIds.includes('empleado'),
      comision_directiva: user.roleIds.includes('comision_directiva'),
      socio: user.roleIds.includes('socio'),
      claimsVersion: user.claimsVersion,
      ...claims,
    },
  };
}

export function seedMember(
  manager: InMemoryUsersTransactionManager,
  memberId: string,
  overrides?: Partial<MemberDocument>,
): EntityWithId<MemberDocument> {
  const member: EntityWithId<MemberDocument> = {
    id: memberId,
    memberNumber: memberId,
    firstName: 'Nombre',
    lastName: 'Apellido',
    typeId: 'pleno',
    typeCodeSnapshot: 'pleno',
    status: 'active',
    isFamilyHolder: false,
    joinedAt: timestampNow(),
    ...createAudit(),
    ...overrides,
  };
  manager.members.set(memberId, member);
  return member;
}

export function seedEmployee(
  manager: InMemoryUsersTransactionManager,
  employeeId: string,
  overrides?: Partial<EmployeeDocument>,
): EntityWithId<EmployeeDocument> {
  const employee: EntityWithId<EmployeeDocument> = {
    id: employeeId,
    firstName: 'Empleado',
    lastName: 'Club',
    position: 'Recepcion',
    contractType: 'monthly',
    status: 'active',
    startDate: timestampNow(),
    canSubmitExpenses: false,
    ...createAudit(),
    ...overrides,
  };
  manager.employees.set(employeeId, employee);
  return employee;
}

export function seedHandicap(
  manager: InMemoryUsersTransactionManager,
  handicapId: string,
  overrides?: Partial<HandicapDocument>,
): EntityWithId<HandicapDocument> {
  const handicap: EntityWithId<HandicapDocument> = {
    id: handicapId,
    memberId: 'member-1',
    handicapNumber: 20.5,
    validFrom: timestampNow(),
    status: 'active',
    issuedByUid: 'staff-1',
    ...createAudit(),
    ...overrides,
  };
  manager.handicaps.set(handicapId, handicap);
  return handicap;
}
