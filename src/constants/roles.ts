export const ROLES = {
  DIRECTIVO: 'directivo',
  ADMINISTRATIVO: 'administrativo',
  SOCIO: 'socio',
  EMPLEADO: 'empleado',
} as const;

export type RoleType = typeof ROLES[keyof typeof ROLES];

export const ROLE_LABELS: Record<RoleType, string> = {
  [ROLES.DIRECTIVO]: 'Junta Directiva',
  [ROLES.ADMINISTRATIVO]: 'Administrativo',
  [ROLES.SOCIO]: 'Socio',
  [ROLES.EMPLEADO]: 'Empleado',
};

const LEGACY_ROLE_MAP: Record<string, RoleType> = {
  owner: ROLES.DIRECTIVO,
  admin: ROLES.ADMINISTRATIVO,
  member: ROLES.SOCIO,
  employee: ROLES.EMPLEADO,
};

export function normalizeRoleId(value: unknown): RoleType | null {
  if (typeof value !== 'string') {
    return null;
  }

  if (value === ROLES.DIRECTIVO || value === ROLES.ADMINISTRATIVO || value === ROLES.SOCIO || value === ROLES.EMPLEADO) {
    return value;
  }

  return LEGACY_ROLE_MAP[value] ?? null;
}

export function normalizeRoleIds(values: unknown): RoleType[] {
  if (!Array.isArray(values)) {
    const singleRole = normalizeRoleId(values);
    return singleRole ? [singleRole] : [];
  }

  return Array.from(
    new Set(values.map((value) => normalizeRoleId(value)).filter((value): value is RoleType => value !== null)),
  );
}
