import { Timestamp } from 'firebase-admin/firestore';
function timestampNow() {
    return Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z'));
}
function applyPatch(entity, patch) {
    const nextEntity = { ...entity };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
            continue;
        }
        if (value === null) {
            delete nextEntity[key];
            continue;
        }
        nextEntity[key] = value;
    }
    return nextEntity;
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
class InMemoryUsersStore {
    items;
    clock;
    constructor(items, clock) {
        this.items = items;
        this.clock = clock;
    }
    async getById(uid) {
        return this.items.get(uid) ?? null;
    }
    async syncFromAuthUser(input) {
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
        const createdUser = {
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
    async assignRoles(params) {
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
    async setProfileLink(params) {
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
    async clearProfileLink(params) {
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
class InMemoryRolesStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(roleId) {
        return this.items.get(roleId) ?? null;
    }
    async getByIds(roleIds) {
        return roleIds.flatMap((roleId) => {
            const role = this.items.get(roleId);
            return role ? [role] : [];
        });
    }
}
class InMemoryPermissionsStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(permissionId) {
        return this.items.get(permissionId) ?? null;
    }
}
class InMemoryRolePermissionsStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async listByRoleId(roleId) {
        return Array.from(this.items.values()).filter((item) => item.roleId === roleId);
    }
}
class InMemoryMemberTypesStore {
    items;
    constructor(items) {
        this.items = items;
    }
    async getById(memberTypeId) {
        return this.items.get(memberTypeId) ?? null;
    }
}
class InMemoryFamilyGroupsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(groupId) {
        return this.items.get(groupId) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, {
            id,
            ...data,
            ...createAudit(actorUid),
        });
        return id;
    }
    async update(groupId, patch, actorUid) {
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
class InMemoryMembersStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(memberId) {
        return this.items.get(memberId) ?? null;
    }
    async getByIds(memberIds) {
        return memberIds.flatMap((memberId) => {
            const member = this.items.get(memberId);
            return member ? [member] : [];
        });
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, {
            id,
            ...data,
            ...createAudit(actorUid),
        });
        return id;
    }
    async update(memberId, patch, actorUid) {
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
class InMemoryEmployeesStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(employeeId) {
        return this.items.get(employeeId) ?? null;
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, {
            id,
            ...data,
            ...createAudit(actorUid),
        });
        return id;
    }
    async update(employeeId, patch, actorUid) {
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
class InMemoryHandicapsStore {
    items;
    nextId;
    constructor(items, nextId) {
        this.items = items;
        this.nextId = nextId;
    }
    async getById(handicapId) {
        return this.items.get(handicapId) ?? null;
    }
    async listActiveByMemberId(memberId) {
        return Array.from(this.items.values()).filter((item) => item.memberId === memberId && item.status === 'active');
    }
    async listByMemberId(memberId) {
        return Array.from(this.items.values()).filter((item) => item.memberId === memberId);
    }
    async create(data, actorUid) {
        const id = this.nextId();
        this.items.set(id, {
            id,
            ...data,
            ...createAudit(actorUid),
        });
        return id;
    }
    async update(handicapId, patch, actorUid) {
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
export class FakeAuthGateway {
    claimsByUid = new Map();
    async setCustomClaims(uid, claims) {
        this.claimsByUid.set(uid, claims);
    }
}
export class FixedClock {
    now() {
        return new Date('2026-01-01T00:00:00.000Z');
    }
}
export class InMemoryUsersTransactionManager {
    users = new Map();
    roles = new Map();
    permissions = new Map();
    rolePermissions = new Map();
    memberTypes = new Map();
    familyGroups = new Map();
    members = new Map();
    employees = new Map();
    handicaps = new Map();
    clock = new FixedClock();
    familyGroupCounter = 0;
    memberCounter = 0;
    employeeCounter = 0;
    handicapCounter = 0;
    dataAccess = {
        users: new InMemoryUsersStore(this.users, this.clock),
        roles: new InMemoryRolesStore(this.roles),
        permissions: new InMemoryPermissionsStore(this.permissions),
        rolePermissions: new InMemoryRolePermissionsStore(this.rolePermissions),
        memberTypes: new InMemoryMemberTypesStore(this.memberTypes),
        familyGroups: new InMemoryFamilyGroupsStore(this.familyGroups, () => `family-group-${++this.familyGroupCounter}`),
        members: new InMemoryMembersStore(this.members, () => `member-${++this.memberCounter}`),
        employees: new InMemoryEmployeesStore(this.employees, () => `employee-${++this.employeeCounter}`),
        handicaps: new InMemoryHandicapsStore(this.handicaps, () => `handicap-${++this.handicapCounter}`),
    };
    async runInTransaction(handler) {
        return handler(this.dataAccess);
    }
    getDataAccess() {
        return this.dataAccess;
    }
}
export function seedRole(manager, roleId, overrides) {
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
export function seedMemberType(manager, memberTypeId, overrides) {
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
export function seedUser(manager, uid, overrides) {
    const user = {
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
export function createActor(user, claims) {
    return {
        uid: user.id,
        user,
        claims: {
            directivo: user.roleIds.includes('directivo'),
            administrativo: user.roleIds.includes('administrativo'),
            empleado: user.roleIds.includes('empleado'),
            socio: user.roleIds.includes('socio'),
            claimsVersion: user.claimsVersion,
            ...claims,
        },
    };
}
export function seedMember(manager, memberId, overrides) {
    const member = {
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
export function seedEmployee(manager, employeeId, overrides) {
    const employee = {
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
export function seedHandicap(manager, handicapId, overrides) {
    const handicap = {
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
//# sourceMappingURL=fakes.js.map