import { ROLE_LABELS } from '../constants/roles';
import type { timestamp_type, User } from '../context/AuthContext';

function toTitleCase(value: string): string {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

export function getUserDisplayName(
  user: Pick<User, 'first_name' | 'last_name' | 'user_number' | 'profile_id'> | null | undefined,
): string {
  if (!user) {
    return 'invitado';
  }

  const fullName = `${user.first_name} ${user.last_name}`.trim();
  return toTitleCase(fullName || user.user_number || user.profile_id || 'usuario');
}

export function getUserInitial(
  user: Pick<User, 'first_name' | 'last_name' | 'user_number' | 'profile_id'> | null | undefined,
): string {
  return getUserDisplayName(user).charAt(0).toUpperCase();
}

export function getRoleLabel(roleId: string | undefined): string {
  return roleId && roleId in ROLE_LABELS
    ? ROLE_LABELS[roleId as keyof typeof ROLE_LABELS]
    : roleId || 'Sin rol';
}

export function formatTimestamp(value?: timestamp_type): string {
  if (!value) {
    return 'Sin registro';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
