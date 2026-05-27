import type { ReactNode } from 'react';
import { AuthContext, type AuthContextType } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

export function renderWithAuth(children: ReactNode, overrides: Partial<AuthContextType> = {}) {
  const authValue: AuthContextType = {
    user: {
      id: 'user_test',
      email: 'admin@test.local',
      displayName: 'Admin Test',
      primaryRoleId: ROLES.DIRECTIVO,
      roleIds: [ROLES.DIRECTIVO, ROLES.ADMINISTRATIVO],
      profileType: 'none',
      profileId: null,
      active: true,
      claimsVersion: 1,
      createdAt: {} as never,
      createdBy: 'seed',
      updatedAt: {} as never,
      updatedBy: 'seed',
    },
    firebaseUser: null,
    loading: false,
    authError: '',
    isAuthenticated: true,
    interfaceMode: ROLES.DIRECTIVO,
    themeMode: 'light',
    login: async () => undefined,
    refreshUser: async () => null,
    updateUser: () => undefined,
    setInterfaceMode: () => undefined,
    setThemeMode: () => undefined,
    hasRole: (role) => role === ROLES.DIRECTIVO || role === ROLES.ADMINISTRATIVO,
    hasAnyRole: (roles) => roles.includes(ROLES.DIRECTIVO) || roles.includes(ROLES.ADMINISTRATIVO),
    logout: async () => undefined,
    ...overrides,
  };

  return <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>;
}

export function fakeTimestamp() {
  return {
    toDate: () => new Date('2026-05-23T12:00:00.000-03:00'),
  } as never;
}
