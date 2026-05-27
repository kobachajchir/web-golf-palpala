import type { EntityWithId, RoleId, UserDocument } from '../domain/models';

export type UserRecord = EntityWithId<UserDocument>;

export interface CreateMemberAuthUserPayload {
  memberId: string;
  roleIds?: RoleId[];
  active?: boolean;
}

export interface MemberAuthStatus {
  memberId: string;
  memberNumber: string;
  linkedUserId: string | null;
  hasAuthUser: boolean;
  authDisabled: boolean | null;
  hasUserDocument: boolean;
  userActive: boolean | null;
  roleIds: RoleId[];
  claimsVersion: number | null;
  identifierExists: boolean;
  identifierActive: boolean | null;
  mustChangePassword?: boolean | null;
  lastLoginAt?: unknown;
}

export interface ResetMemberAuthPasswordPayload {
  memberId: string;
}

export interface TemporaryMemberCredentials {
  memberNumber: string;
  temporaryPassword: string;
  passwordGeneratedAt?: string | undefined;
}

export interface SetMemberAuthAccessActivePayload {
  memberId: string;
  active: boolean;
}

export interface LinkEmployeeAuthUserPayload {
  employeeId: string;
  email: string;
  displayName?: string;
}

export interface EmployeeAuthInviteResult {
  uid: string;
  employeeId: string;
  email: string;
  inviteLink: string;
  createdAuthUser?: boolean;
  claimsVersion?: number;
}

export interface RequestMemberPasswordResetPayload {
  memberNumber: string;
}

export interface RequestMemberPasswordResetResult {
  ok: boolean;
}
