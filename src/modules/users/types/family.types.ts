import type { DocumentSnapshot } from 'firebase/firestore';
import type { EntityWithId, FamilyGroupDocument } from '../domain/models';

export type FamilyGroupListCursor = DocumentSnapshot<FamilyGroupDocument> | null;

export interface ListFamilyGroupsParams {
  active?: boolean | 'all';
  holderMemberId?: string;
  pageSize?: number;
  cursor?: FamilyGroupListCursor;
}

export interface ListFamilyGroupsResult {
  familyGroups: Array<EntityWithId<FamilyGroupDocument>>;
  nextCursor: FamilyGroupListCursor;
  hasMore: boolean;
}

export type FamilyGroupRecord = EntityWithId<FamilyGroupDocument>;

