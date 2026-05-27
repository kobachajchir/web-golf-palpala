import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseAuthUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  normalizeRoleId,
  normalizeRoleIds,
  ROLES,
  type RoleType,
} from '../constants/roles';
import { auth, firestore } from '../lib/firebase';
import { buildSyntheticAuthEmail } from '../lib/memberAuth';
import type { EntityWithId, MemberDocument, UserDocument } from '../modules/users/domain/models';
import { createUsersCallables } from '../modules/users/functions/users.callables';

export type ThemeMode = 'light' | 'dark';
export type User = EntityWithId<
  Omit<UserDocument, 'primaryRoleId' | 'roleIds'> & {
    primaryRoleId: RoleType;
    roleIds: RoleType[];
  }
>;

const INTERFACE_MODE_STORAGE_KEY = 'interface_mode';
const THEME_STORAGE_KEY = 'theme_mode';
const LICENSE_LOGIN_MESSAGE = 'No podes ingresar porque tu membresia esta en licencia. Consulta con administracion.';

export interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseAuthUser | null;
  loading: boolean;
  authError: string;
  isAuthenticated: boolean;
  interfaceMode: RoleType;
  themeMode: ThemeMode;
  login: (memberNumber: string, password: string) => Promise<void>;
  refreshUser: () => Promise<User | null>;
  updateUser: (userData: User) => void;
  setInterfaceMode: (mode: RoleType) => void;
  setThemeMode: (mode: ThemeMode) => void;
  hasRole: (role: RoleType) => boolean;
  hasAnyRole: (roles: readonly RoleType[]) => boolean;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

function asThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

function normalizeUserDocument(uid: string, data: UserDocument): User {
  const roleIds = normalizeRoleIds(data.roleIds);
  const primaryRoleId = normalizeRoleId(data.primaryRoleId) ?? roleIds[0] ?? ROLES.SOCIO;

  return {
    id: uid,
    ...data,
    primaryRoleId,
    roleIds: roleIds.length > 0 ? roleIds : [primaryRoleId],
    profileId: data.profileId ?? null,
    memberNumber: data.memberNumber ?? null,
    authProviderMode: data.authProviderMode ?? 'member_number_password',
    mustChangePassword: data.mustChangePassword ?? false,
    passwordResetRequiredReason: data.passwordResetRequiredReason ?? null,
    quickActionIdsByRole: data.quickActionIdsByRole ?? {},
  };
}

function pickInterfaceMode(user: User | null, storedMode: unknown): RoleType {
  const storedRole = normalizeRoleId(storedMode);
  if (!user) {
    return storedRole ?? ROLES.SOCIO;
  }

  if (storedRole && user.roleIds.includes(storedRole)) {
    return storedRole;
  }

  if (user.roleIds.includes(user.primaryRoleId)) {
    return user.primaryRoleId;
  }

  return user.roleIds[0] ?? ROLES.SOCIO;
}

async function ensureCurrentUserProfile(firebaseUser: FirebaseAuthUser) {
  const callables = createUsersCallables();
  await callables.ensureCurrentUserProfile();
  await firebaseUser.getIdTokenResult(true);
}

async function loadUserDocument(firebaseUser: FirebaseAuthUser): Promise<User> {
  if (!firestore) {
    throw new Error('Firestore no esta inicializado.');
  }

  const userRef = doc(firestore, 'users', firebaseUser.uid);
  let snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    await ensureCurrentUserProfile(firebaseUser);
    snapshot = await getDoc(userRef);
  }

  if (!snapshot.exists()) {
    throw new Error('No existe el perfil de usuario en Firestore.');
  }

  const user = normalizeUserDocument(firebaseUser.uid, snapshot.data() as UserDocument);
  if (!user.active) {
    throw new Error('El usuario esta inactivo.');
  }

  if (user.profileType === 'member' && user.profileId) {
    const memberSnapshot = await getDoc(doc(firestore, 'members', user.profileId));
    if (memberSnapshot.exists()) {
      const member = memberSnapshot.data() as MemberDocument;
      if (member.status === 'license') {
        throw new Error(LICENSE_LOGIN_MESSAGE);
      }
    }
  }

  const tokenResult = await firebaseUser.getIdTokenResult();
  const tokenClaimsVersion =
    typeof tokenResult.claims.claimsVersion === 'number' ? tokenResult.claims.claimsVersion : 0;

  if (tokenClaimsVersion < user.claimsVersion) {
    await firebaseUser.getIdTokenResult(true);
  }

  return user;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseAuthUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [interfaceMode, setInterfaceModeState] = useState<RoleType>(ROLES.SOCIO);
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    setThemeModeState(asThemeMode(localStorage.getItem(THEME_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    const authInstance = auth;
    if (!authInstance) {
      setAuthError('Firebase Auth no esta inicializado.');
      setLoading(false);
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(authInstance, (nextFirebaseUser) => {
      void (async () => {
        setLoading(true);
        setAuthError('');
        setFirebaseUser(nextFirebaseUser);

        if (!nextFirebaseUser) {
          setUser(null);
          setInterfaceModeState(pickInterfaceMode(null, localStorage.getItem(INTERFACE_MODE_STORAGE_KEY)));
          setLoading(false);
          return;
        }

        try {
          const loadedUser = await loadUserDocument(nextFirebaseUser);
          setUser(loadedUser);
          const nextMode = pickInterfaceMode(loadedUser, localStorage.getItem(INTERFACE_MODE_STORAGE_KEY));
          setInterfaceModeState(nextMode);
          localStorage.setItem(INTERFACE_MODE_STORAGE_KEY, nextMode);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No pudimos cargar el usuario.';
          setAuthError(message);
          setUser(null);
          await signOut(authInstance);
        } finally {
          setLoading(false);
        }
      })();
    });

    return unsubscribe;
  }, []);

  const refreshUser = async (): Promise<User | null> => {
    if (!auth?.currentUser) {
      setUser(null);
      return null;
    }

    const loadedUser = await loadUserDocument(auth.currentUser);
    setUser(loadedUser);
    setInterfaceModeState((currentMode) => pickInterfaceMode(loadedUser, currentMode));
    return loadedUser;
  };

  const login = async (memberNumber: string, password: string) => {
    if (!auth) {
      throw new Error('Firebase Auth no esta inicializado.');
    }

    setAuthError('');
    const internalEmail = buildSyntheticAuthEmail(memberNumber);

    try {
      const credential = await signInWithEmailAndPassword(auth, internalEmail, password);
      const loadedUser = await loadUserDocument(credential.user);
      setFirebaseUser(credential.user);
      setUser(loadedUser);
      const nextMode = pickInterfaceMode(loadedUser, localStorage.getItem(INTERFACE_MODE_STORAGE_KEY));
      setInterfaceModeState(nextMode);
      localStorage.setItem(INTERFACE_MODE_STORAGE_KEY, nextMode);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      const message =
        errorMessage === LICENSE_LOGIN_MESSAGE
          ? LICENSE_LOGIN_MESSAGE
          : 'El numero de socio o la contrasena no coinciden.';
      if (auth.currentUser) {
        await signOut(auth);
      }
      setAuthError(message);
      throw new Error(message, { cause: error });
    }
  };

  const updateUser = (userData: User) => {
    setUser(userData);
    setInterfaceModeState((currentMode) => pickInterfaceMode(userData, currentMode));
  };

  const setInterfaceMode = (mode: RoleType) => {
    if (user && !user.roleIds.includes(mode)) {
      return;
    }

    localStorage.setItem(INTERFACE_MODE_STORAGE_KEY, mode);
    setInterfaceModeState(mode);
  };

  const setThemeMode = (mode: ThemeMode) => {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    setThemeModeState(mode);
  };

  const hasRole = (role: RoleType) => Boolean(user?.roleIds.includes(role));
  const hasAnyRole = (roles: readonly RoleType[]) => roles.some((role) => hasRole(role));

  const logout = async () => {
    if (auth) {
      await signOut(auth);
    }
    localStorage.removeItem(INTERFACE_MODE_STORAGE_KEY);
    setFirebaseUser(null);
    setUser(null);
    setInterfaceModeState(ROLES.SOCIO);
  };

  const value: AuthContextType = useMemo(
    () => ({
      user,
      firebaseUser,
      loading,
      authError,
      isAuthenticated: Boolean(user && firebaseUser),
      interfaceMode,
      themeMode,
      login,
      refreshUser,
      updateUser,
      setInterfaceMode,
      setThemeMode,
      hasRole,
      hasAnyRole,
      logout,
    }),
    [authError, firebaseUser, interfaceMode, loading, themeMode, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
