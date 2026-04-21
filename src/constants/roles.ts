export const ROLES = {
  ADMIN: 'admin',
  OWNER: 'owner',
  MEMBER: 'member',
  EMPLOYEE: 'employee',
} as const;

export type RoleType = typeof ROLES[keyof typeof ROLES];

export const ROLE_LABELS: Record<RoleType, string> = {
  [ROLES.ADMIN]: 'Administrativo',
  [ROLES.OWNER]: 'Propietario',
  [ROLES.MEMBER]: 'Socio',
  [ROLES.EMPLOYEE]: 'Empleado',
};
