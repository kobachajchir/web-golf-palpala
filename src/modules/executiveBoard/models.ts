import type { Timestamp } from 'firebase/firestore';

export type ExecutiveBoardSeedIssue = {
  positionCode: string;
  positionLabel: string;
  fullNameSnapshot: string;
  reason: 'not_found' | 'multiple_matches';
  matches?: string[];
};

export interface ExecutiveBoardTermDocument {
  label: string;
  active: boolean;
  startsAt?: Timestamp | null;
  endsAt?: Timestamp | null;
  unresolvedBoardMembers?: ExecutiveBoardSeedIssue[];
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
}

export interface ExecutiveBoardMemberDocument {
  termId: string;
  uid: string;
  memberId: string;
  memberNumber: string;
  positionCode: string;
  positionLabel: string;
  fullNameSnapshot: string;
  order: number;
  active: boolean;
  appointedAt?: Timestamp | null;
  endedAt?: Timestamp | null;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
}

export type EntityWithId<T extends object> = T & { id: string };
