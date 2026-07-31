export const ROLES = {
  COMITE_EJECUTIVO: 'comite_ejecutivo',
  DIRECTIVO: 'comite_ejecutivo',
  ADMINISTRATIVO: 'administrativo',
  COMISION_DIRECTIVA: 'comision_directiva',
  SOCIO: 'socio',
  EMPLEADO: 'empleado',
  DESARROLLADOR: 'desarrollador',
} as const;

export type RoleType = typeof ROLES[keyof typeof ROLES];

export const ROLE_LABELS: Record<RoleType, string> = {
  [ROLES.COMITE_EJECUTIVO]: 'Comité Ejecutivo',
  [ROLES.ADMINISTRATIVO]: 'Administrativo',
  [ROLES.COMISION_DIRECTIVA]: 'Comisión Directiva',
  [ROLES.SOCIO]: 'Socio',
  [ROLES.EMPLEADO]: 'Empleado',
  [ROLES.DESARROLLADOR]: 'Desarrollador',
};

export const INTERNAL_ROLE_IDS = [ROLES.DESARROLLADOR] as const;

export function isInternalRoleId(roleId: string): boolean {
  return (INTERNAL_ROLE_IDS as readonly string[]).includes(roleId);
}

export function getVisibleRoleIds(roleIds: readonly RoleType[], includeInternal = false): RoleType[] {
  return includeInternal ? [...roleIds] : roleIds.filter((roleId) => !isInternalRoleId(roleId));
}

const LEGACY_ROLE_MAP: Record<string, RoleType> = {
  owner: ROLES.COMITE_EJECUTIVO,
  directivo: ROLES.COMITE_EJECUTIVO,
  admin: ROLES.ADMINISTRATIVO,
  member: ROLES.SOCIO,
  employee: ROLES.EMPLEADO,
};

export function normalizeRoleId(value: unknown): RoleType | null {
  if (typeof value !== 'string') {
    return null;
  }

  if (
    value === ROLES.COMITE_EJECUTIVO ||
    value === ROLES.ADMINISTRATIVO ||
    value === ROLES.COMISION_DIRECTIVA ||
    value === ROLES.SOCIO ||
    value === ROLES.EMPLEADO ||
    value === ROLES.DESARROLLADOR
  ) {
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
