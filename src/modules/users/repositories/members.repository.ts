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
import { normalizeMemberNumber } from '../../../lib/memberAuth';
import type { EntityWithId, MemberDocument, MemberTypeDocument } from '../domain/models';
import { createWebConverter } from '../infrastructure/firestore/converters';
import { matchesMemberSearch } from '../services/memberSearch.service';
import type { ListMembersParams, ListMembersResult } from '../types/member.types';

function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error('Firestore is not initialized in this environment.');
  }

  return firestore;
}

function withId<T extends DocumentData>(snapshot: { id: string; data(): T }): EntityWithId<T> {
  return { id: snapshot.id, ...snapshot.data() } as EntityWithId<T>;
}

function matchesClientFilters(member: EntityWithId<MemberDocument>, params: ListMembersParams): boolean {
  const linkedUser = params.linkedUser ?? 'all';

  if (linkedUser === 'linked' && !member.linkedUserId) {
    return false;
  }

  if (linkedUser === 'unlinked' && member.linkedUserId) {
    return false;
  }

  return matchesMemberSearch(member, params.search ?? '');
}

export function createMembersRepository(db: Firestore = requireFirestore()) {
  const membersRef = collection(db, 'members').withConverter(createWebConverter<MemberDocument>());
  const memberTypesRef = collection(db, 'member_types').withConverter(createWebConverter<MemberTypeDocument>());

  return {
    async listMembers(params: ListMembersParams = {}): Promise<ListMembersResult> {
      const pageSize = Math.max(1, Math.min(params.pageSize ?? 25, 100));
      const needsClientFiltering = Boolean(params.search?.trim()) || (params.linkedUser ?? 'all') !== 'all';
      const fetchSize = needsClientFiltering ? Math.min(pageSize * 4, 100) : pageSize;
      const baseConstraints: QueryConstraint[] = [];

      if (params.status && params.status !== 'all') {
        baseConstraints.push(where('status', '==', params.status));
      }

      if (params.typeId && params.typeId !== 'all') {
        baseConstraints.push(where('typeId', '==', params.typeId));
      }

      if (params.familyGroupId && params.familyGroupId !== 'all') {
        baseConstraints.push(where('familyGroupId', '==', params.familyGroupId));
      }

      baseConstraints.push(orderBy('lastName', 'asc'));

      const acceptedMembers: Array<EntityWithId<MemberDocument>> = [];
      let nextCursor = params.cursor ?? null;
      let hasMore = false;
      let currentCursor = params.cursor ?? null;

      for (let attempts = 0; attempts < 5 && acceptedMembers.length < pageSize; attempts += 1) {
        const pageConstraints = [...baseConstraints];
        if (currentCursor) {
          pageConstraints.push(startAfter(currentCursor));
        }
        pageConstraints.push(limit(fetchSize));

        const snapshot = await getDocs(query(membersRef, ...pageConstraints));
        const docs = snapshot.docs;

        if (docs.length === 0) {
          nextCursor = null;
          hasMore = false;
          break;
        }

        currentCursor = docs[docs.length - 1] ?? null;
        nextCursor = currentCursor;

        for (const entry of docs) {
          const member = withId(entry);
          if (matchesClientFilters(member, params)) {
            acceptedMembers.push(member);
          }

          if (acceptedMembers.length >= pageSize) {
            break;
          }
        }

        hasMore = docs.length === fetchSize;
        if (!hasMore) {
          break;
        }
      }

      return {
        members: acceptedMembers.slice(0, pageSize),
        nextCursor,
        hasMore,
      };
    },

    async getMember(memberId: string): Promise<EntityWithId<MemberDocument> | null> {
      const snapshot = await getDoc(doc(membersRef, memberId));
      return snapshot.exists() ? withId(snapshot) : null;
    },

    async findByMemberNumber(memberNumber: string): Promise<EntityWithId<MemberDocument> | null> {
      const compactMemberNumber = memberNumber.trim().replace(/\s+/g, '');
      const normalizedMemberNumber = normalizeMemberNumber(compactMemberNumber);
      const deterministicMemberId = `member-${normalizedMemberNumber}`;
      const deterministicSnapshot = await getDoc(doc(membersRef, deterministicMemberId));

      if (deterministicSnapshot.exists()) {
        return withId(deterministicSnapshot);
      }

      const candidates = Array.from(new Set([compactMemberNumber, normalizedMemberNumber].filter(Boolean)));
      if (candidates.length === 0) {
        return null;
      }

      const snapshot = await getDocs(
        query(
          membersRef,
          candidates.length === 1 ? where('memberNumber', '==', candidates[0]) : where('memberNumber', 'in', candidates),
          limit(1),
        ),
      );

      const entry = snapshot.docs[0];
      return entry ? withId(entry) : null;
    },

    async listMemberTypes(): Promise<Array<EntityWithId<MemberTypeDocument>>> {
      const snapshot = await getDocs(query(memberTypesRef, where('active', '==', true), orderBy('sortOrder', 'asc')));
      return snapshot.docs.map((entry) => withId(entry));
    },
  };
}

export type MembersRepository = ReturnType<typeof createMembersRepository>;
