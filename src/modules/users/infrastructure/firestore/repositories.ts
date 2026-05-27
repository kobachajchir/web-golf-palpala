import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { firestore } from '../../../../lib/firebase';
import type {
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
} from '../../domain/models';
import { createWebConverter } from './converters';

function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error('Firestore is not initialized in this environment.');
  }

  return firestore;
}

function createRepository<T extends DocumentData>(db: Firestore, path: string) {
  const collectionRef = collection(db, path).withConverter(createWebConverter<T>());

  return {
    collectionRef,
    docRef: (id: string) => doc(collectionRef, id),
    async getById(id: string): Promise<EntityWithId<T> | null> {
      const snapshot = await getDoc(doc(collectionRef, id));
      return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as EntityWithId<T>) : null;
    },
    async listByQuery(queryRef: Query<T>): Promise<Array<EntityWithId<T>>> {
      const snapshot = await getDocs(queryRef);
      return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as EntityWithId<T>);
    },
    async listAll(): Promise<Array<EntityWithId<T>>> {
      const snapshot = await getDocs(collectionRef);
      return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as EntityWithId<T>);
    },
    async countByQuery(queryRef: Query<T>): Promise<number> {
      return (await getCountFromServer(queryRef)).data().count;
    },
  };
}

export function createUsersRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<UserDocument>(db, 'users');

  return {
    ...repository,
    listByActiveAndPrimaryRole(active: boolean, primaryRoleId: string) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('active', '==', active),
          where('primaryRoleId', '==', primaryRoleId),
        ),
      );
    },
    listByProfileTypeAndActive(profileType: UserProfileType, active: boolean) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('profileType', '==', profileType),
          where('active', '==', active),
        ),
      );
    },
  };
}

export function createRolesRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<RoleDocument>(db, 'roles');

  return {
    ...repository,
    listActiveSorted() {
      return repository.listByQuery(
        query(repository.collectionRef, where('active', '==', true), orderBy('sortOrder', 'asc')),
      );
    },
  };
}

export function createPermissionsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<PermissionDocument>(db, 'permissions');

  return {
    ...repository,
    listByModule(moduleName: string, active = true) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('module', '==', moduleName),
          where('active', '==', active),
        ),
      );
    },
  };
}

export function createRolePermissionsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<RolePermissionDocument>(db, 'role_permissions');

  return {
    ...repository,
    listByRoleId(roleId: string, active = true) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('roleId', '==', roleId),
          where('active', '==', active),
        ),
      );
    },
    listByPermissionId(permissionId: string, active = true) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('permissionId', '==', permissionId),
          where('active', '==', active),
        ),
      );
    },
  };
}

export function createMemberTypesRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<MemberTypeDocument>(db, 'member_types');

  return {
    ...repository,
    listActiveSorted() {
      return repository.listByQuery(
        query(repository.collectionRef, where('active', '==', true), orderBy('sortOrder', 'asc')),
      );
    },
  };
}

export function createFamilyGroupsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<FamilyGroupDocument>(db, 'family_groups');

  return {
    ...repository,
    listActive() {
      return repository.listByQuery(query(repository.collectionRef, where('active', '==', true)));
    },
    listByHolder(holderMemberId: string, active = true) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('holderMemberId', '==', holderMemberId),
          where('active', '==', active),
        ),
      );
    },
  };
}

export function createMembersRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<MemberDocument>(db, 'members');

  return {
    ...repository,
    async listDirectory() {
      const members = await repository.listAll();
      return [...members].sort((left, right) => {
        const lastNameOrder = left.lastName.localeCompare(right.lastName, 'es-AR');
        if (lastNameOrder !== 0) {
          return lastNameOrder;
        }

        const firstNameOrder = left.firstName.localeCompare(right.firstName, 'es-AR');
        if (firstNameOrder !== 0) {
          return firstNameOrder;
        }

        return left.memberNumber.localeCompare(right.memberNumber, 'es-AR', { numeric: true });
      });
    },
    listByStatusAndType(status: string, typeId: string, pageSize = 50) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('status', '==', status),
          where('typeId', '==', typeId),
          orderBy('lastName', 'asc'),
          limit(pageSize),
        ),
      );
    },
    listByFamilyGroup(familyGroupId: string) {
      return repository
        .listByQuery(
          query(
            repository.collectionRef,
            where('familyGroupId', '==', familyGroupId),
            orderBy('isFamilyHolder', 'asc'),
          ),
        )
        .then((members) =>
          [...members].sort((left, right) => Number(right.isFamilyHolder) - Number(left.isFamilyHolder)),
        );
    },
    async listByLicenseEnd(status: string, pageSize = 50) {
      const members = await repository.listByQuery(
        query(
          repository.collectionRef,
          where('status', '==', status),
        ),
      );
      return [...members]
        .sort((left, right) => {
          const leftTime = left.licenseEndAt?.toMillis?.() ?? 0;
          const rightTime = right.licenseEndAt?.toMillis?.() ?? 0;
          return leftTime - rightTime;
        })
        .slice(0, pageSize);
    },
    listByLinkedUserId(linkedUserId: string) {
      return repository.listByQuery(
        query(repository.collectionRef, where('linkedUserId', '==', linkedUserId)),
      );
    },
    async listAlphabetical(pageSize = 12) {
      const members = await repository.listByQuery(
        query(repository.collectionRef, orderBy('lastName', 'asc'), limit(pageSize)),
      );
      return [...members].sort((left, right) => {
        const lastNameOrder = left.lastName.localeCompare(right.lastName, 'es-AR');
        return lastNameOrder || left.firstName.localeCompare(right.firstName, 'es-AR');
      });
    },
    countActive() {
      return repository.countByQuery(
        query(repository.collectionRef, where('status', '==', 'active')),
      );
    },
    listMembershipRenewals(status: 'current' | 'needs_renewal', pageSize = 25) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('membershipRenewalStatus', '==', status),
          orderBy('membershipRenewalDueAt', 'asc'),
          limit(pageSize),
        ),
      );
    },
  };
}

export function createEmployeesRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<EmployeeDocument>(db, 'employees');

  return {
    ...repository,
    listByStatusAndPosition(status: string, position: string, pageSize = 50) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('status', '==', status),
          where('position', '==', position),
          orderBy('lastName', 'asc'),
          limit(pageSize),
        ),
      );
    },
    listByLinkedUserId(linkedUserId: string) {
      return repository.listByQuery(
        query(repository.collectionRef, where('linkedUserId', '==', linkedUserId)),
      );
    },
    async listAlphabetical(pageSize = 12) {
      const employees = await repository.listByQuery(
        query(repository.collectionRef, orderBy('lastName', 'asc'), limit(pageSize)),
      );
      return [...employees].sort((left, right) => {
        const lastNameOrder = left.lastName.localeCompare(right.lastName, 'es-AR');
        return lastNameOrder || left.firstName.localeCompare(right.firstName, 'es-AR');
      });
    },
    countActive() {
      return repository.countByQuery(
        query(repository.collectionRef, where('status', '==', 'active')),
      );
    },
  };
}

export function createHandicapsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<HandicapDocument>(db, 'handicaps');

  return {
    ...repository,
    listByMemberId(memberId: string, pageSize = 50) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('memberId', '==', memberId),
          orderBy('validFrom', 'desc'),
          limit(pageSize),
        ),
      );
    },
    listByStatus(status: string, pageSize = 50) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('status', '==', status),
          orderBy('validTo', 'asc'),
          limit(pageSize),
        ),
      );
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
export type RolesRepository = ReturnType<typeof createRolesRepository>;
export type PermissionsRepository = ReturnType<typeof createPermissionsRepository>;
export type RolePermissionsRepository = ReturnType<typeof createRolePermissionsRepository>;
export type MemberTypesRepository = ReturnType<typeof createMemberTypesRepository>;
export type FamilyGroupsRepository = ReturnType<typeof createFamilyGroupsRepository>;
export type MembersRepository = ReturnType<typeof createMembersRepository>;
export type EmployeesRepository = ReturnType<typeof createEmployeesRepository>;
export type HandicapsRepository = ReturnType<typeof createHandicapsRepository>;
