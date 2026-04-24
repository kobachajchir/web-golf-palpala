import { createContext, useEffect, useState, type ReactNode } from 'react';
import { ROLES, type RoleType } from '../constants/roles';
import type {
  estado_usuario_type,
  timestamp_type,
  tipo_perfil_usuario_type,
  user_type,
} from '../types';

export type {
  estado_usuario_type,
  id_type,
  timestamp_type,
  tipo_perfil_usuario_type,
  user_type,
} from '../types';

export type User = user_type;
export type ThemeMode = 'light' | 'dark';

const INTERFACE_MODE_STORAGE_KEY = 'interface_mode';
const THEME_STORAGE_KEY = 'theme_mode';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  interfaceMode: RoleType;
  themeMode: ThemeMode;
  login: (userData: User) => void;
  updateUser: (userData: User) => void;
  setInterfaceMode: (mode: RoleType) => void;
  setThemeMode: (mode: ThemeMode) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

const timestampNow = (): timestamp_type => new Date().toISOString();

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asProfileType(value: unknown): tipo_perfil_usuario_type {
  return value === 'empleado' || value === 'administrativo' ? value : 'socio';
}

function asUserStatus(value: unknown): estado_usuario_type {
  return value === 'inactivo' || value === 'bloqueado' ? value : 'activo';
}

function asRoleType(value: unknown): RoleType {
  return value === ROLES.ADMIN || value === ROLES.OWNER || value === ROLES.EMPLOYEE
    ? value
    : ROLES.MEMBER;
}

function asThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

function splitName(value: string): { firstName: string; lastName: string } {
  const sanitizedValue = value.trim().replace(/\s+/g, ' ');
  if (!sanitizedValue) {
    return {
      firstName: 'Usuario',
      lastName: '',
    };
  }

  const [firstName, ...rest] = sanitizedValue.split(' ');
  return {
    firstName: firstName || 'Usuario',
    lastName: rest.join(' '),
  };
}

function normalizeStoredUser(value: unknown): User | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const legacyRole = asString(record.role, ROLES.MEMBER);
  const now = timestampNow();
  const legacyDisplayName = asString(
    record.display_name,
    asString(record.email, asString(record.profile_id, 'Usuario')),
  );
  const { firstName, lastName } = splitName(legacyDisplayName);

  const normalizedUser: User = {
    id: asString(record.id, 'user-demo'),
    auth_uid: asString(record.auth_uid, 'firebase-uid-demo'),
    user_number: asString(record.user_number, '100000'),
    first_name: asString(record.first_name, firstName),
    last_name: asString(record.last_name, lastName),
    dni: asString(record.dni, '00000000'),
    role_id: asString(record.role_id, legacyRole),
    profile_type: asProfileType(record.profile_type),
    profile_id: asString(record.profile_id, 'socio-001'),
    status: asUserStatus(record.status),
    must_change_password: Boolean(record.must_change_password),
    created_at: asString(record.created_at, now),
    updated_at: asString(record.updated_at, now),
  };

  if (typeof record.last_login_at === 'string' && record.last_login_at) {
    normalizedUser.last_login_at = record.last_login_at;
  }

  return normalizedUser;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [interfaceMode, setInterfaceModeState] = useState<RoleType>(ROLES.MEMBER);
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    const storedMode = localStorage.getItem(INTERFACE_MODE_STORAGE_KEY);
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const storedUser = localStorage.getItem('user');

    setThemeModeState(asThemeMode(storedTheme));

    if (storedUser) {
      try {
        const normalizedUser = normalizeStoredUser(JSON.parse(storedUser));
        setUser(normalizedUser);
        setInterfaceModeState(asRoleType(storedMode || normalizedUser?.role_id));
      } catch (error) {
        console.error('Error al parsear usuario de localStorage:', error);
        localStorage.removeItem('user');
        setInterfaceModeState(asRoleType(storedMode));
      }
    } else {
      setInterfaceModeState(asRoleType(storedMode));
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  const login = (userData: User) => {
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    setInterfaceModeState(asRoleType(userData.role_id));
    localStorage.setItem(INTERFACE_MODE_STORAGE_KEY, asRoleType(userData.role_id));
  };

  const updateUser = (userData: User) => {
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const setInterfaceMode = (mode: RoleType) => {
    localStorage.setItem(INTERFACE_MODE_STORAGE_KEY, mode);
    setInterfaceModeState(mode);
  };

  const setThemeMode = (mode: ThemeMode) => {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    setThemeModeState(mode);
  };

  const logout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem(INTERFACE_MODE_STORAGE_KEY);
    setUser(null);
    setInterfaceModeState(ROLES.MEMBER);
  };

  const value: AuthContextType = {
    user,
    loading,
    isAuthenticated: !!user,
    interfaceMode,
    themeMode,
    login,
    updateUser,
    setInterfaceMode,
    setThemeMode,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
