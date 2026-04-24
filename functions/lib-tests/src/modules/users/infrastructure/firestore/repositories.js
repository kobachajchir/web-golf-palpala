import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Filter, getFirestore, Timestamp, } from 'firebase-admin/firestore';
import { DEFAULT_PRIMARY_ROLE_ID, SYSTEM_ACTOR_UID, USERS_COLLECTIONS } from '../../domain/constants.js';
import { createAdminConverter } from './converters.js';
function getOrInitializeApp() {
    return getApps().length > 0 ? getApp() : initializeApp();
}
function getDatabase() {
    return getFirestore(getOrInitializeApp());
}
function getCollection(db, path) {
    return db.collection(path).withConverter(createAdminConverter());
}
function stripUndefined(data) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}
function createAuditedDocument(data, actorUid) {
    return {
        ...stripUndefined(data),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
    };
}
function createAuditedPatch(patch, actorUid) {
    const result = {
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
    };
    for (const key of Object.keys(patch)) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) {
            continue;
        }
        const value = patch[key];
        if (value === undefined) {
            continue;
        }
        result[String(key)] = value === null ? FieldValue.delete() : value;
    }
    return result;
}
async function getSnapshot(ref, transaction) {
    return transaction ? transaction.get(ref) : ref.get();
}
async function getQuerySnapshot(query, transaction) {
    return transaction ? transaction.get(query) : query.get();
}
async function writeSet(ref, data, transaction) {
    if (transaction) {
        transaction.set(ref, data, { merge: false });
        return;
    }
    await ref.set(data);
}
async function writeUpdate(ref, data, transaction) {
    if (transaction) {
        transaction.update(ref, data);
        return;
    }
    await ref.update(data);
}
async function createDocument(collection, data, transaction) {
    const docRef = collection.doc();
    if (transaction) {
        transaction.create(docRef, data);
        return docRef.id;
    }
    await docRef.create(data);
    return docRef.id;
}
function withId(snapshot) {
    return {
        id: snapshot.id,
        ...snapshot.data(),
    };
}
class FirestoreUsersStore {
    db;
    clock;
    transaction;
    collection;
    constructor(db, clock, transaction) {
        this.db = db;
        this.clock = clock;
        this.transaction = transaction;
        this.collection = getCollection(db, USERS_COLLECTIONS.users);
    }
    async getById(uid) {
        const snapshot = await getSnapshot(this.collection.doc(uid), this.transaction);
        return snapshot.exists ? withId(snapshot) : null;
    }
    async syncFromAuthUser(input) {
        const docRef = this.collection.doc(input.uid);
        const existingSnapshot = await getSnapshot(docRef, this.transaction);
        if (existingSnapshot.exists) {
            const existingUser = withId(existingSnapshot);
            const patch = {
                lastLoginAt: Timestamp.fromDate(this.clock.now()),
            };
            if (!existingUser.email && input.email) {
                patch.email = input.email;
            }
            if (existingUser.displayName === 'Usuario' && input.displayName) {
                patch.displayName = input.displayName;
            }
            await writeUpdate(docRef, createAuditedPatch(patch, SYSTEM_ACTOR_UID), this.transaction);
            return {
                ...existingUser,
                ...patch,
            };
        }
        const createdUser = {
            email: input.email ?? '',
            displayName: input.displayName?.trim() || 'Usuario',
            primaryRoleId: DEFAULT_PRIMARY_ROLE_ID,
            roleIds: [DEFAULT_PRIMARY_ROLE_ID],
            profileType: 'none',
            active: true,
            claimsVersion: 1,
            lastLoginAt: Timestamp.fromDate(this.clock.now()),
        };
        await writeSet(docRef, createAuditedDocument(createdUser, SYSTEM_ACTOR_UID), this.transaction);
        return {
            id: input.uid,
            ...createdUser,
            createdAt: Timestamp.fromDate(this.clock.now()),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: Timestamp.fromDate(this.clock.now()),
            updatedBy: SYSTEM_ACTOR_UID,
        };
    }
    async assignRoles(params) {
        await writeUpdate(this.collection.doc(params.uid), createAuditedPatch({
            roleIds: Array.from(new Set(params.roleIds)),
            primaryRoleId: params.primaryRoleId,
            claimsVersion: params.nextClaimsVersion,
        }, params.actorUid), this.transaction);
    }
    async setProfileLink(params) {
        await writeUpdate(this.collection.doc(params.uid), createAuditedPatch({
            profileType: params.profileType,
            profileId: params.profileId,
        }, params.actorUid), this.transaction);
    }
    async clearProfileLink(params) {
        const user = await this.getById(params.uid);
        if (!user) {
            return;
        }
        if (params.expectedProfileType && user.profileType !== params.expectedProfileType) {
            return;
        }
        if (params.expectedProfileId && user.profileId !== params.expectedProfileId) {
            return;
        }
        await writeUpdate(this.collection.doc(params.uid), createAuditedPatch({
            profileType: 'none',
            profileId: null,
        }, params.actorUid), this.transaction);
    }
}
class FirestoreRolesStore {
    db;
    transaction;
    collection;
    constructor(db, transaction) {
        this.db = db;
        this.transaction = transaction;
        this.collection = getCollection(db, USERS_COLLECTIONS.roles);
    }
    async getById(roleId) {
        const snapshot = await getSnapshot(this.collection.doc(roleId), this.transaction);
        return snapshot.exists ? withId(snapshot) : null;
    }
    async getByIds(roleIds) {
        const documents = await Promise.all(roleIds.map((roleId) => this.getById(roleId)));
        return documents.filter((document) => document !== null);
    }
}
class FirestorePermissionsStore {
    db;
    transaction;
    collection;
    constructor(db, transaction) {
        this.db = db;
        this.transaction = transaction;
        this.collection = getCollection(db, USERS_COLLECTIONS.permissions);
    }
    async getById(permissionId) {
        const snapshot = await getSnapshot(this.collection.doc(permissionId), this.transaction);
        return snapshot.exists ? withId(snapshot) : null;
    }
}
class FirestoreRolePermissionsStore {
    db;
    transaction;
    collection;
    constructor(db, transaction) {
        this.db = db;
        this.transaction = transaction;
        this.collection = getCollection(db, USERS_COLLECTIONS.rolePermissions);
    }
    async listByRoleId(roleId) {
        const query = this.collection.where(Filter.where('roleId', '==', roleId));
        const snapshot = await getQuerySnapshot(query, this.transaction);
        return snapshot.docs.map((doc) => withId(doc));
    }
}
class FirestoreMemberTypesStore {
    db;
    transaction;
    collection;
    constructor(db, transaction) {
        this.db = db;
        this.transaction = transaction;
        this.collection = getCollection(db, USERS_COLLECTIONS.memberTypes);
    }
    async getById(memberTypeId) {
        const snapshot = await getSnapshot(this.collection.doc(memberTypeId), this.transaction);
        return snapshot.exists ? withId(snapshot) : null;
    }
}
class FirestoreFamilyGroupsStore {
    db;
    transaction;
    collection;
    constructor(db, transaction) {
        this.db = db;
        this.transaction = transaction;
        this.collection = getCollection(db, USERS_COLLECTIONS.familyGroups);
    }
    async getById(groupId) {
        const snapshot = await getSnapshot(this.collection.doc(groupId), this.transaction);
        return snapshot.exists ? withId(snapshot) : null;
    }
    async create(data, actorUid) {
        return createDocument(this.collection, createAuditedDocument(data, actorUid), this.transaction);
    }
    async update(groupId, patch, actorUid) {
        await writeUpdate(this.collection.doc(groupId), createAuditedPatch(patch, actorUid), this.transaction);
    }
}
class FirestoreMembersStore {
    db;
    transaction;
    collection;
    constructor(db, transaction) {
        this.db = db;
        this.transaction = transaction;
        this.collection = getCollection(db, USERS_COLLECTIONS.members);
    }
    async getById(memberId) {
        const snapshot = await getSnapshot(this.collection.doc(memberId), this.transaction);
        return snapshot.exists ? withId(snapshot) : null;
    }
    async getByIds(memberIds) {
        const members = await Promise.all(memberIds.map((memberId) => this.getById(memberId)));
        return members.filter((member) => member !== null);
    }
    async create(data, actorUid) {
        return createDocument(this.collection, createAuditedDocument(data, actorUid), this.transaction);
    }
    async update(memberId, patch, actorUid) {
        await writeUpdate(this.collection.doc(memberId), createAuditedPatch(patch, actorUid), this.transaction);
    }
}
class FirestoreEmployeesStore {
    db;
    transaction;
    collection;
    constructor(db, transaction) {
        this.db = db;
        this.transaction = transaction;
        this.collection = getCollection(db, USERS_COLLECTIONS.employees);
    }
    async getById(employeeId) {
        const snapshot = await getSnapshot(this.collection.doc(employeeId), this.transaction);
        return snapshot.exists ? withId(snapshot) : null;
    }
    async create(data, actorUid) {
        return createDocument(this.collection, createAuditedDocument(data, actorUid), this.transaction);
    }
    async update(employeeId, patch, actorUid) {
        await writeUpdate(this.collection.doc(employeeId), createAuditedPatch(patch, actorUid), this.transaction);
    }
}
class FirestoreHandicapsStore {
    db;
    transaction;
    collection;
    constructor(db, transaction) {
        this.db = db;
        this.transaction = transaction;
        this.collection = getCollection(db, USERS_COLLECTIONS.handicaps);
    }
    async getById(handicapId) {
        const snapshot = await getSnapshot(this.collection.doc(handicapId), this.transaction);
        return snapshot.exists ? withId(snapshot) : null;
    }
    async listActiveByMemberId(memberId) {
        const handicaps = await this.listByMemberId(memberId);
        return handicaps.filter((handicap) => handicap.status === 'active');
    }
    async listByMemberId(memberId) {
        const query = this.collection.where(Filter.where('memberId', '==', memberId)).orderBy('validFrom', 'desc');
        const snapshot = await getQuerySnapshot(query, this.transaction);
        return snapshot.docs.map((doc) => withId(doc));
    }
    async create(data, actorUid) {
        return createDocument(this.collection, createAuditedDocument(data, actorUid), this.transaction);
    }
    async update(handicapId, patch, actorUid) {
        await writeUpdate(this.collection.doc(handicapId), createAuditedPatch(patch, actorUid), this.transaction);
    }
}
function createDataAccess(db, clock, transaction) {
    return {
        users: new FirestoreUsersStore(db, clock, transaction),
        roles: new FirestoreRolesStore(db, transaction),
        permissions: new FirestorePermissionsStore(db, transaction),
        rolePermissions: new FirestoreRolePermissionsStore(db, transaction),
        memberTypes: new FirestoreMemberTypesStore(db, transaction),
        familyGroups: new FirestoreFamilyGroupsStore(db, transaction),
        members: new FirestoreMembersStore(db, transaction),
        employees: new FirestoreEmployeesStore(db, transaction),
        handicaps: new FirestoreHandicapsStore(db, transaction),
    };
}
export class FirestoreUsersTransactionManager {
    clock;
    db = getDatabase();
    constructor(clock) {
        this.clock = clock;
    }
    async runInTransaction(handler) {
        return this.db.runTransaction(async (transaction) => handler(createDataAccess(this.db, this.clock, transaction)));
    }
    getDataAccess() {
        return createDataAccess(this.db, this.clock);
    }
}
export class SystemClock {
    now() {
        return new Date();
    }
}
//# sourceMappingURL=repositories.js.map