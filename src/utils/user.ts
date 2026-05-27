import { normalizeRoleId, ROLE_LABELS } from '../constants/roles';
import type { User } from '../context/AuthContext';

function toTitleCase(value: string): string {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

export function getUserDisplayName(
  user:
    | (Partial<Pick<User, 'displayName' | 'memberNumber' | 'profileId'>> & {
        first_name?: string;
        last_name?: string;
        user_number?: string;
        profile_id?: string;
      })
    | null
    | undefined,
): string {
  if (!user) {
    return 'invitado';
  }

  const legacyFullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return toTitleCase(
    user.displayName ||
      legacyFullName ||
      user.memberNumber ||
      user.user_number ||
      user.profileId ||
      user.profile_id ||
      'usuario',
  );
}

export function getUserInitial(
  user: Parameters<typeof getUserDisplayName>[0],
): string {
  return getUserDisplayName(user).charAt(0).toUpperCase();
}

export function getRoleLabel(roleId: string | undefined): string {
  const normalizedRoleId = normalizeRoleId(roleId);

  return normalizedRoleId
    ? ROLE_LABELS[normalizedRoleId]
    : roleId || 'Sin rol';
}

export function formatTimestamp(value?: string | Date | { toDate: () => Date } | null): string {
  if (!value) {
    return 'Sin registro';
  }

  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : value.toDate();
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : 'Sin registro';
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
