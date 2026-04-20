export const ROLES = {
  ADMIN: 'admin',
  OWNER: 'owner',
  MEMBER: 'member',
  EMPLOYEE: 'employee',
} as const;

export type RoleType = typeof ROLES[keyof typeof ROLES];
