import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  Filter,
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { DEFAULT_PRIMARY_ROLE_ID, SYSTEM_ACTOR_UID, USERS_COLLECTIONS } from '../../domain/constants.js';
import type {
  AuthSyncUserInput,
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
} from '../../domain/models.js';
import type {
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
  StoreCreate,
  StorePatch,
  UsersDataAccess,
  UsersStore,
  UsersTransactionManager,
} from '../../domain/ports.js';
import { createAdminConverter } from './converters.js';

function getOrInitializeApp() {
  return getApps().length > 0 ? getApp() : initializeApp();
}

function getDatabase(): Firestore {
  return getFirestore(getOrInitializeApp());
}

function getCollection<T extends DocumentData>(
  db: Firestore,
  path: string,
): CollectionReference<T> {
  return db.collection(path).withConverter(createAdminConverter<T>());
}

function stripUndefined<T extends DocumentData>(data: T): DocumentData {
  const result: DocumentData = {};

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

function createAuditedDocument<T extends DocumentData>(data: T, actorUid: string): DocumentData {
  return {
    ...stripUndefined(data),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  };
}

function createAuditedPatch<T extends DocumentData>(patch: StorePatch<T>, actorUid: string): DocumentData {
  const result: DocumentData = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  };

  for (const key of Object.keys(patch) as Array<keyof T>) {
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

async function getSnapshot<T extends DocumentData>(
  ref: DocumentReference<T>,
  transaction?: Transaction,
) {
  return transaction ? transaction.get(ref) : ref.get();
}

async function getQuerySnapshot<T extends DocumentData>(
  query: Query<T>,
  transaction?: Transaction,
) {
  return transaction ? transaction.get(query) : query.get();
}

async function writeSet<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: DocumentData,
  transaction?: Transaction,
) {
  if (transaction) {
    transaction.set(ref, data as never, { merge: false });
    return;
  }

  await ref.set(data as never);
}

async function writeUpdate<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: DocumentData,
  transaction?: Transaction,
) {
  if (transaction) {
    transaction.update(ref, data as never);
    return;
  }

  await ref.update(data as never);
}

async function createDocument<T extends DocumentData>(
  collection: CollectionReference<T>,
  data: DocumentData,
  transaction?: Transaction,
): Promise<string> {
  const docRef = collection.doc();
  if (transaction) {
    transaction.create(docRef, data as never);
    return docRef.id;
  }

  await docRef.create(data as never);
  return docRef.id;
}

function withId<T extends DocumentData>(snapshot: QueryDocumentSnapshot<T>): EntityWithId<T> {
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

class FirestoreUsersStore implements UsersStore {
  private readonly collection: CollectionReference<UserDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly clock: Clock,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<UserDocument>(db, USERS_COLLECTIONS.users);
  }

  public async getById(uid: string): Promise<EntityWithId<UserDocument> | null> {
    const snapshot = await getSnapshot(this.collection.doc(uid), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<UserDocument>) : null;
  }

  public async syncFromAuthUser(input: AuthSyncUserInput): Promise<EntityWithId<UserDocument>> {
    const docRef = this.collection.doc(input.uid);
    const existingSnapshot = await getSnapshot(docRef, this.transaction);

    if (existingSnapshot.exists) {
      const existingUser = withId(existingSnapshot as QueryDocumentSnapshot<UserDocument>);
      const patch: Partial<UserDocument> = {
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

    const createdUser: Omit<UserDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> = {
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

  public async assignRoles(params: {
    uid: string;
    roleIds: string[];
    primaryRoleId: string;
    nextClaimsVersion: number;
    actorUid: string;
  }): Promise<void> {
    await writeUpdate(
      this.collection.doc(params.uid),
      createAuditedPatch<UserDocument>(
        {
          roleIds: Array.from(new Set(params.roleIds)),
          primaryRoleId: params.primaryRoleId,
          claimsVersion: params.nextClaimsVersion,
        },
        params.actorUid,
      ),
      this.transaction,
    );
  }

  public async setProfileLink(params: {
    uid: string;
    profileType: UserProfileType;
    profileId: string;
    actorUid: string;
  }): Promise<void> {
    await writeUpdate(
      this.collection.doc(params.uid),
      createAuditedPatch<UserDocument>(
        {
          profileType: params.profileType,
          profileId: params.profileId,
        },
        params.actorUid,
      ),
      this.transaction,
    );
  }

  public async clearProfileLink(params: {
    uid: string;
    actorUid: string;
    expectedProfileType?: UserProfileType;
    expectedProfileId?: string;
  }): Promise<void> {
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

    await writeUpdate(
      this.collection.doc(params.uid),
      createAuditedPatch<UserDocument>(
        {
          profileType: 'none',
          profileId: null,
        },
        params.actorUid,
      ),
      this.transaction,
    );
  }
}

class FirestoreRolesStore implements RolesStore {
  private readonly collection: CollectionReference<RoleDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<RoleDocument>(db, USERS_COLLECTIONS.roles);
  }

  public async getById(roleId: string): Promise<EntityWithId<RoleDocument> | null> {
    const snapshot = await getSnapshot(this.collection.doc(roleId), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<RoleDocument>) : null;
  }

  public async getByIds(roleIds: readonly string[]): Promise<Array<EntityWithId<RoleDocument>>> {
    const documents = await Promise.all(roleIds.map((roleId) => this.getById(roleId)));
    return documents.filter((document): document is EntityWithId<RoleDocument> => document !== null);
  }
}

class FirestorePermissionsStore implements PermissionsStore {
  private readonly collection: CollectionReference<PermissionDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<PermissionDocument>(db, USERS_COLLECTIONS.permissions);
  }

  public async getById(permissionId: string): Promise<EntityWithId<PermissionDocument> | null> {
    const snapshot = await getSnapshot(this.collection.doc(permissionId), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<PermissionDocument>) : null;
  }
}

class FirestoreRolePermissionsStore implements RolePermissionsStore {
  private readonly collection: CollectionReference<RolePermissionDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<RolePermissionDocument>(db, USERS_COLLECTIONS.rolePermissions);
  }

  public async listByRoleId(roleId: string): Promise<Array<EntityWithId<RolePermissionDocument>>> {
    const query = this.collection.where(Filter.where('roleId', '==', roleId));
    const snapshot = await getQuerySnapshot(query, this.transaction);
    return snapshot.docs.map((doc) => withId(doc));
  }
}

class FirestoreMemberTypesStore implements MemberTypesStore {
  private readonly collection: CollectionReference<MemberTypeDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<MemberTypeDocument>(db, USERS_COLLECTIONS.memberTypes);
  }

  public async getById(memberTypeId: string): Promise<EntityWithId<MemberTypeDocument> | null> {
    const snapshot = await getSnapshot(this.collection.doc(memberTypeId), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<MemberTypeDocument>) : null;
  }
}

class FirestoreFamilyGroupsStore implements FamilyGroupsStore {
  private readonly collection: CollectionReference<FamilyGroupDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<FamilyGroupDocument>(db, USERS_COLLECTIONS.familyGroups);
  }

  public async getById(groupId: string): Promise<EntityWithId<FamilyGroupDocument> | null> {
    const snapshot = await getSnapshot(this.collection.doc(groupId), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<FamilyGroupDocument>) : null;
  }

  public async create(
    data: StoreCreate<Omit<FamilyGroupDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>>,
    actorUid: string,
  ): Promise<string> {
    return createDocument(this.collection, createAuditedDocument(data, actorUid), this.transaction);
  }

  public async update(groupId: string, patch: StorePatch<FamilyGroupDocument>, actorUid: string): Promise<void> {
    await writeUpdate(
      this.collection.doc(groupId),
      createAuditedPatch(patch, actorUid),
      this.transaction,
    );
  }
}

class FirestoreMembersStore implements MembersStore {
  private readonly collection: CollectionReference<MemberDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<MemberDocument>(db, USERS_COLLECTIONS.members);
  }

  public async getById(memberId: string): Promise<EntityWithId<MemberDocument> | null> {
    const snapshot = await getSnapshot(this.collection.doc(memberId), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<MemberDocument>) : null;
  }

  public async getByIds(memberIds: readonly string[]): Promise<Array<EntityWithId<MemberDocument>>> {
    const members = await Promise.all(memberIds.map((memberId) => this.getById(memberId)));
    return members.filter((member): member is EntityWithId<MemberDocument> => member !== null);
  }

  public async create(
    data: StoreCreate<Omit<MemberDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>>,
    actorUid: string,
  ): Promise<string> {
    return createDocument(this.collection, createAuditedDocument(data, actorUid), this.transaction);
  }

  public async createWithId(
    memberId: string,
    data: StoreCreate<Omit<MemberDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>>,
    actorUid: string,
  ): Promise<void> {
    await writeSet(
      this.collection.doc(memberId),
      createAuditedDocument(data, actorUid),
      this.transaction,
    );
  }

  public async update(memberId: string, patch: StorePatch<MemberDocument>, actorUid: string): Promise<void> {
    await writeUpdate(
      this.collection.doc(memberId),
      createAuditedPatch(patch, actorUid),
      this.transaction,
    );
  }
}

class FirestoreMemberLoginIdentifiersStore implements MemberLoginIdentifiersStore {
  private readonly collection: CollectionReference<MemberLoginIdentifierDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<MemberLoginIdentifierDocument>(db, USERS_COLLECTIONS.memberLoginIdentifiers);
  }

  public async getById(normalizedMemberNumber: string): Promise<EntityWithId<MemberLoginIdentifierDocument> | null> {
    const snapshot = await getSnapshot(this.collection.doc(normalizedMemberNumber), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<MemberLoginIdentifierDocument>) : null;
  }

  public async set(
    normalizedMemberNumber: string,
    data: StorePatch<MemberLoginIdentifierDocument>,
    actorUid: string,
  ): Promise<void> {
    const docRef = this.collection.doc(normalizedMemberNumber);
    const payload = {
      uid: data.uid ?? null,
      memberId: data.memberId ?? null,
      memberNumber: data.memberNumber ?? normalizedMemberNumber,
      active: data.active ?? true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    };

    if (this.transaction) {
      this.transaction.set(
        docRef,
        {
          ...payload,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actorUid,
        } as never,
        { merge: true },
      );
      return;
    }

    await docRef.set(
      {
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
      } as never,
      { merge: true },
    );
  }
}

class FirestoreEmployeesStore implements EmployeesStore {
  private readonly collection: CollectionReference<EmployeeDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<EmployeeDocument>(db, USERS_COLLECTIONS.employees);
  }

  public async getById(employeeId: string): Promise<EntityWithId<EmployeeDocument> | null> {
    const snapshot = await getSnapshot(this.collection.doc(employeeId), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<EmployeeDocument>) : null;
  }

  public async create(
    data: StoreCreate<Omit<EmployeeDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>>,
    actorUid: string,
  ): Promise<string> {
    return createDocument(this.collection, createAuditedDocument(data, actorUid), this.transaction);
  }

  public async update(employeeId: string, patch: StorePatch<EmployeeDocument>, actorUid: string): Promise<void> {
    await writeUpdate(
      this.collection.doc(employeeId),
      createAuditedPatch(patch, actorUid),
      this.transaction,
    );
  }
}

class FirestoreHandicapsStore implements HandicapsStore {
  private readonly collection: CollectionReference<HandicapDocument>;

  public constructor(
    private readonly db: Firestore,
    private readonly transaction?: Transaction,
  ) {
    this.collection = getCollection<HandicapDocument>(db, USERS_COLLECTIONS.handicaps);
  }

  public async getById(handicapId: string): Promise<EntityWithId<HandicapDocument> | null> {
    const snapshot = await getSnapshot(this.collection.doc(handicapId), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<HandicapDocument>) : null;
  }

  public async listActiveByMemberId(memberId: string): Promise<Array<EntityWithId<HandicapDocument>>> {
    const handicaps = await this.listByMemberId(memberId);
    return handicaps.filter((handicap) => handicap.status === 'active');
  }

  public async listByMemberId(memberId: string): Promise<Array<EntityWithId<HandicapDocument>>> {
    const query = this.collection.where(Filter.where('memberId', '==', memberId)).orderBy('validFrom', 'desc');
    const snapshot = await getQuerySnapshot(query, this.transaction);
    return snapshot.docs.map((doc) => withId(doc));
  }

  public async create(
    data: StoreCreate<Omit<HandicapDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>>,
    actorUid: string,
  ): Promise<string> {
    return createDocument(this.collection, createAuditedDocument(data, actorUid), this.transaction);
  }

  public async update(handicapId: string, patch: StorePatch<HandicapDocument>, actorUid: string): Promise<void> {
    await writeUpdate(
      this.collection.doc(handicapId),
      createAuditedPatch(patch, actorUid),
      this.transaction,
    );
  }
}

function createDataAccess(
  db: Firestore,
  clock: Clock,
  transaction?: Transaction,
): UsersDataAccess {
  return {
    users: new FirestoreUsersStore(db, clock, transaction),
    roles: new FirestoreRolesStore(db, transaction),
    permissions: new FirestorePermissionsStore(db, transaction),
    rolePermissions: new FirestoreRolePermissionsStore(db, transaction),
    memberTypes: new FirestoreMemberTypesStore(db, transaction),
    familyGroups: new FirestoreFamilyGroupsStore(db, transaction),
    members: new FirestoreMembersStore(db, transaction),
    memberLoginIdentifiers: new FirestoreMemberLoginIdentifiersStore(db, transaction),
    employees: new FirestoreEmployeesStore(db, transaction),
    handicaps: new FirestoreHandicapsStore(db, transaction),
  };
}

export class FirestoreUsersTransactionManager implements UsersTransactionManager {
  private readonly db = getDatabase();

  public constructor(private readonly clock: Clock) {}

  public async runInTransaction<T>(handler: (dataAccess: UsersDataAccess) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => handler(createDataAccess(this.db, this.clock, transaction)));
  }

  public getDataAccess(): UsersDataAccess {
    return createDataAccess(this.db, this.clock);
  }
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
