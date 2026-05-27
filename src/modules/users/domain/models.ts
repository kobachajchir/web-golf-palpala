import type { Timestamp } from 'firebase/firestore';

export type RoleId = string;
export type PermissionId = string;
export type MemberTypeId = string;
export type UserProfileType = 'member' | 'employee' | 'none';
export type MemberStatus = 'active' | 'inactive' | 'license' | 'suspended';
export type MembershipRenewalStatus = 'current' | 'needs_renewal';
export type EmployeeStatus = 'active' | 'inactive';
export type EmployeeContractType = 'monthly' | 'seasonal' | 'daily' | 'honorarios' | 'eventual';
export type HandicapStatus = 'active' | 'inactive' | 'expired';
export type BillingConfigKey = 'FULL' | 'FAMILY_ASSOC' | 'LIFETIME' | 'MINOR' | 'LICENSE';
export type QuickActionPreferences = Record<string, string[]>;

export interface AuditFields {
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
  isDeleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: string;
}

export interface UserDocument extends AuditFields {
  email: string;
  displayName: string;
  primaryRoleId: RoleId;
  roleIds: RoleId[];
  profileType: UserProfileType;
  profileId?: string | null;
  active: boolean;
  claimsVersion: number;
  memberNumber?: string | null;
  authProviderMode?: 'member_number_password';
  mustChangePassword?: boolean;
  passwordResetRequiredReason?: 'initial_default' | 'staff_reset' | null;
  passwordUpdatedAt?: Timestamp;
  lastLoginAt?: Timestamp;
  quickActionIdsByRole?: QuickActionPreferences;
}

export interface PasswordResetRequestDocument extends AuditFields {
  memberNumber: string;
  normalizedMemberNumber: string;
  memberId?: string | null;
  uid?: string | null;
  displayName?: string | null;
  status: 'pending' | 'completed' | 'cancelled';
  requestedAt: Timestamp;
  resolvedAt?: Timestamp | null;
  resolvedBy?: string | null;
}

export interface RoleDocument extends AuditFields {
  name: string;
  description?: string;
  permissionIds: PermissionId[];
  system: boolean;
  active: boolean;
  sortOrder: number;
}

export interface PermissionDocument extends AuditFields {
  module: string;
  action: string;
  name: string;
  description?: string;
  active: boolean;
}

export interface RolePermissionDocument extends AuditFields {
  roleId: RoleId;
  permissionId: PermissionId;
  active: boolean;
  grantedByUid: string;
  grantedAt: Timestamp;
  revokedAt?: Timestamp;
}

export interface MemberTypeDocument extends AuditFields {
  label: string;
  billingConfigKey: BillingConfigKey;
  requiresFamilyGroup: boolean;
  canBeFamilyHolder: boolean;
  active: boolean;
  sortOrder: number;
}

export interface FamilyGroupDocument extends AuditFields {
  code?: string;
  holderMemberId: string;
  memberIds: string[];
  active: boolean;
  notes?: string;
}

export interface MemberDocument extends AuditFields {
  memberNumber: string;
  firstName: string;
  lastName: string;
  aagMembershipNumber?: string;
  dni?: string;
  birthDate?: Timestamp;
  email?: string;
  phoneNumber?: string;
  linkedUserId?: string;
  typeId: MemberTypeId;
  typeCodeSnapshot: string;
  status: MemberStatus;
  familyGroupId?: string;
  isFamilyHolder: boolean;
  joinedAt: Timestamp;
  licenseStartAt?: Timestamp;
  licenseEndAt?: Timestamp;
  currentHandicapId?: string;
  currentHandicapNumber?: number;
  lastFeePaymentAt?: Timestamp;
  membershipRenewalStatus?: MembershipRenewalStatus;
  membershipRenewalDueAt?: Timestamp;
  lastFeePaidAmountMinor?: number;
  lastFeeDiscountPctBps?: number;
  lastFeeDiscountAmountMinor?: number;
  notes?: string;
}

export interface MemberLoginIdentifierDocument extends AuditFields {
  uid?: string | null;
  memberId?: string | null;
  memberNumber: string;
  active: boolean;
}

export interface EmployeeDocument extends AuditFields {
  employeeCode?: string;
  firstName: string;
  lastName: string;
  dni?: string;
  linkedUserId?: string;
  position: string;
  contractType: EmployeeContractType;
  status: EmployeeStatus;
  startDate: Timestamp;
  endDate?: Timestamp;
  canSubmitExpenses: boolean;
  notes?: string;
}

export interface HandicapDocument extends AuditFields {
  memberId: string;
  handicapNumber: number;
  sourceAssociation?: string;
  validFrom: Timestamp;
  validTo?: Timestamp;
  status: HandicapStatus;
  issuedByUid: string;
  notes?: string;
}

export type EntityWithId<T extends object> = T & { id: string };

export interface CreateMemberPayload {
  memberNumber: string;
  firstName: string;
  lastName: string;
  typeId: string;
  aagMembershipNumber?: string;
  joinedAt?: string;
  dni?: string;
  birthDate?: string;
  email?: string;
  phoneNumber?: string;
  linkedUserId?: string | null;
  notes?: string;
}

export interface UpdateMemberPayload {
  memberId: string;
  memberNumber?: string;
  firstName?: string;
  lastName?: string;
  typeId?: string;
  aagMembershipNumber?: string | null;
  joinedAt?: string;
  dni?: string | null;
  birthDate?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  linkedUserId?: string | null;
  notes?: string | null;
  status?: MemberStatus;
  familyGroupId?: string | null;
  isFamilyHolder?: boolean;
}

export interface CreateFamilyGroupPayload {
  holderMemberId: string;
  memberIds: string[];
  code?: string;
  notes?: string;
}

export interface FamilyGroupMembershipPayload {
  groupId: string;
  memberId: string;
  replacementHolderMemberId?: string;
}

export interface StartLicensePayload {
  memberId: string;
  startAt: string;
  endAt?: string | null;
}

export interface EndLicensePayload {
  memberId: string;
}

export interface CreateEmployeePayload {
  firstName: string;
  lastName: string;
  position: string;
  contractType: EmployeeContractType;
  startDate: string;
  canSubmitExpenses: boolean;
  employeeCode?: string;
  dni?: string;
  linkedUserId?: string | null;
  endDate?: string | null;
  notes?: string;
}

export interface UpdateEmployeePayload {
  employeeId: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  contractType?: EmployeeContractType;
  startDate?: string;
  endDate?: string | null;
  canSubmitExpenses?: boolean;
  employeeCode?: string | null;
  dni?: string | null;
  linkedUserId?: string | null;
  status?: EmployeeStatus;
  notes?: string | null;
}

export interface AssignRolePayload {
  uid: string;
  roleIds: string[];
}

export interface SyncCustomClaimsPayload {
  uid: string;
}

export interface RecordHandicapPayload {
  memberId: string;
  handicapNumber: number;
  validFrom: string;
  sourceAssociation?: string;
  notes?: string;
}
