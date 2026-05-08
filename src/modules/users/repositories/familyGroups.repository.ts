import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';
import { firestore } from '../../../lib/firebase';
import type { EntityWithId, FamilyGroupDocument } from '../domain/models';
import { createWebConverter } from '../infrastructure/firestore/converters';
import type { ListFamilyGroupsParams, ListFamilyGroupsResult } from '../types/family.types';

function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error('Firestore is not initialized in this environment.');
  }

  return firestore;
}

function withId<T extends DocumentData>(snapshot: { id: string; data(): T }): EntityWithId<T> {
  return { id: snapshot.id, ...snapshot.data() } as EntityWithId<T>;
}

export function createFamilyGroupsRepository(db: Firestore = requireFirestore()) {
  const familyGroupsRef = collection(db, 'family_groups').withConverter(createWebConverter<FamilyGroupDocument>());

  return {
    async listFamilyGroups(params: ListFamilyGroupsParams = {}): Promise<ListFamilyGroupsResult> {
      const pageSize = Math.max(1, Math.min(params.pageSize ?? 50, 100));
      const constraints: QueryConstraint[] = [];

      if (params.active !== undefined && params.active !== 'all') {
        constraints.push(where('active', '==', params.active));
      }

      if (params.holderMemberId) {
        constraints.push(where('holderMemberId', '==', params.holderMemberId));
      }

      constraints.push(orderBy('holderMemberId', 'asc'));

      if (params.cursor) {
        constraints.push(startAfter(params.cursor));
      }

      constraints.push(limit(pageSize));

      const snapshot = await getDocs(query(familyGroupsRef, ...constraints));
      const docs = snapshot.docs;

      return {
        familyGroups: docs.map((entry) => withId(entry)),
        nextCursor: docs[docs.length - 1] ?? null,
        hasMore: docs.length === pageSize,
      };
    },

    async getFamilyGroup(groupId: string): Promise<EntityWithId<FamilyGroupDocument> | null> {
      const snapshot = await getDoc(doc(familyGroupsRef, groupId));
      return snapshot.exists() ? withId(snapshot) : null;
    },
  };
}

export type FamilyGroupsRepository = ReturnType<typeof createFamilyGroupsRepository>;
