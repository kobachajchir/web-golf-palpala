import { ROLES } from '../constants/roles';
import type { User } from '../context/AuthContext';

export const DEV_USER_NUMBER = '100001';
export const DEV_USER_PASSWORD = '12345678';

export const DEV_USER: User = {
  id: 'user-koba-dev',
  auth_uid: 'firebase-uid-koba-dev',
  user_number: DEV_USER_NUMBER,
  first_name: 'Koba',
  last_name: 'Dev',
  dni: '30111222',
  role_id: ROLES.ADMIN,
  profile_type: 'administrativo',
  profile_id: 'admin-koba-dev',
  status: 'activo',
  must_change_password: false,
  last_login_at: '2026-04-20T18:00:00.000Z',
  created_at: '2026-04-20T18:00:00.000Z',
  updated_at: '2026-04-20T18:00:00.000Z',
};
