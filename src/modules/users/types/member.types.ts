import type { DocumentSnapshot } from 'firebase/firestore';
import type {
  CreateMemberPayload,
  EntityWithId,
  HandicapDocument,
  MemberDocument,
  MemberStatus,
  MemberTypeDocument,
  UpdateMemberPayload,
} from '../domain/models';

export type MemberListCursor = DocumentSnapshot<MemberDocument> | null;
export type LinkedUserFilter = 'all' | 'linked' | 'unlinked';

export interface ListMembersParams {
  search?: string;
  status?: MemberStatus | 'all';
  typeId?: string | 'all';
  familyGroupId?: string | 'all';
  linkedUser?: LinkedUserFilter;
  pageSize?: number;
  cursor?: MemberListCursor;
}

export interface ListMembersResult {
  members: Array<EntityWithId<MemberDocument>>;
  nextCursor: MemberListCursor;
  hasMore: boolean;
}

export type MemberCreateInput = CreateMemberPayload;
export type MemberUpdateInput = Omit<UpdateMemberPayload, 'memberId'>;
export type MemberTypeRecord = EntityWithId<MemberTypeDocument>;
export type HandicapRecord = EntityWithId<HandicapDocument>;

