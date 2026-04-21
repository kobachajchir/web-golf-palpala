import { ROLES } from '../constants/roles';
import type { User } from '../context/AuthContext';
import { DEV_USER } from './devUser';

const SEEDED_USERS: User[] = [
  DEV_USER,
  {
    id: 'user-lucia-member',
    auth_uid: 'firebase-uid-lucia-member',
    display_name: 'Lucia Suarez',
    email: 'lucia@club.com',
    role_id: ROLES.MEMBER,
    profile_type: 'socio',
    profile_id: 'member-lucia-001',
    status: 'activo',
    must_change_password: false,
    last_login_at: '2026-04-18T19:15:00.000Z',
    created_at: '2025-09-12T15:00:00.000Z',
    updated_at: '2026-04-18T19:15:00.000Z',
  },
  {
    id: 'user-marcos-employee',
    auth_uid: 'firebase-uid-marcos-employee',
    display_name: 'Marcos Lopez',
    email: 'marcos@club.com',
    role_id: ROLES.EMPLOYEE,
    profile_type: 'empleado',
    profile_id: 'employee-marcos-001',
    status: 'activo',
    must_change_password: false,
    last_login_at: '2026-04-19T13:40:00.000Z',
    created_at: '2024-11-03T12:20:00.000Z',
    updated_at: '2026-04-19T13:40:00.000Z',
  },
  {
    id: 'user-elena-owner',
    auth_uid: 'firebase-uid-elena-owner',
    display_name: 'Elena Vargas',
    email: 'elena@club.com',
    role_id: ROLES.OWNER,
    profile_type: 'administrativo',
    profile_id: 'owner-elena-001',
    status: 'activo',
    must_change_password: false,
    last_login_at: '2026-04-20T08:05:00.000Z',
    created_at: '2024-02-10T09:30:00.000Z',
    updated_at: '2026-04-20T08:05:00.000Z',
  },
];

export function getDirectoryUserById(id: string | undefined, currentUser?: User | null): User | null {
  if (!id) {
    return null;
  }

  if (currentUser?.id === id) {
    return currentUser;
  }

  const users = new Map<string, User>();
  for (const seededUser of SEEDED_USERS) {
    users.set(seededUser.id, seededUser);
  }

  return users.get(id) ?? null;
}
