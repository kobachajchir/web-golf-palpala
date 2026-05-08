import type { Timestamp } from 'firebase-admin/firestore';

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

export type EntityWithId<T extends object> = T & {
  id: string;
};

export interface CustomClaims {
  directivo: boolean;
  administrativo: boolean;
  empleado: boolean;
  socio: boolean;
  claimsVersion: number;
}

export interface Actor {
  uid: string;
  claims: Partial<CustomClaims>;
  user: EntityWithId<UserDocument>;
}

export interface AuthSyncUserInput {
  uid: string;
  email?: string | null | undefined;
  displayName?: string | null | undefined;
}
