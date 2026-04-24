import { ROLES } from '../constants/roles';
import type { User } from '../context/AuthContext';
import { DEV_USER, DEV_USER_PASSWORD } from './devUser';

type StoredUserRecord = User & {
  password: string;
};

type NewUserInput = {
  first_name: string;
  last_name: string;
  dni: string;
  password: string;
};

const STORAGE_KEY = 'mock_user_directory';

const SEEDED_USERS: StoredUserRecord[] = [
  {
    ...DEV_USER,
    password: DEV_USER_PASSWORD,
  },
  {
    id: 'user-lucia-member',
    auth_uid: 'firebase-uid-lucia-member',
    user_number: '100002',
    first_name: 'Lucia',
    last_name: 'Suarez',
    dni: '27888999',
    role_id: ROLES.MEMBER,
    profile_type: 'socio',
    profile_id: 'member-lucia-001',
    status: 'activo',
    must_change_password: false,
    last_login_at: '2026-04-18T19:15:00.000Z',
    created_at: '2025-09-12T15:00:00.000Z',
    updated_at: '2026-04-18T19:15:00.000Z',
    password: '12345678',
  },
  {
    id: 'user-marcos-employee',
    auth_uid: 'firebase-uid-marcos-employee',
    user_number: '100003',
    first_name: 'Marcos',
    last_name: 'Lopez',
    dni: '25666777',
    role_id: ROLES.EMPLOYEE,
    profile_type: 'empleado',
    profile_id: 'employee-marcos-001',
    status: 'activo',
    must_change_password: false,
    last_login_at: '2026-04-19T13:40:00.000Z',
    created_at: '2024-11-03T12:20:00.000Z',
    updated_at: '2026-04-19T13:40:00.000Z',
    password: '12345678',
  },
  {
    id: 'user-elena-owner',
    auth_uid: 'firebase-uid-elena-owner',
    user_number: '100004',
    first_name: 'Elena',
    last_name: 'Vargas',
    dni: '24555111',
    role_id: ROLES.OWNER,
    profile_type: 'administrativo',
    profile_id: 'owner-elena-001',
    status: 'activo',
    must_change_password: false,
    last_login_at: '2026-04-20T08:05:00.000Z',
    created_at: '2024-02-10T09:30:00.000Z',
    updated_at: '2026-04-20T08:05:00.000Z',
    password: '12345678',
  },
];

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function stripPassword(record: StoredUserRecord): User {
  const { password: _password, ...user } = record;
  return user;
}

function readStoredRecords(): StoredUserRecord[] {
  if (!canUseStorage()) {
    return [...SEEDED_USERS];
  }

  const storedValue = window.localStorage.getItem(STORAGE_KEY);
  if (!storedValue) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(SEEDED_USERS));
    return [...SEEDED_USERS];
  }

  try {
    const parsed = JSON.parse(storedValue) as StoredUserRecord[];
    const hasValidShape =
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (record) =>
          typeof record?.id === 'string' &&
          typeof record?.user_number === 'string' &&
          typeof record?.first_name === 'string' &&
          typeof record?.last_name === 'string' &&
          typeof record?.dni === 'string' &&
          typeof record?.password === 'string',
      );

    if (!hasValidShape) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(SEEDED_USERS));
      return [...SEEDED_USERS];
    }

    return parsed;
  } catch (error) {
    console.error('Error al leer el directorio mock de usuarios:', error);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(SEEDED_USERS));
    return [...SEEDED_USERS];
  }
}

function writeStoredRecords(records: StoredUserRecord[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function getStoredRecords(): StoredUserRecord[] {
  return readStoredRecords();
}

function generateNextUserNumber(records: StoredUserRecord[]): string {
  const currentMax = records.reduce((maxValue, record) => {
    const numericValue = Number(record.user_number);
    return Number.isNaN(numericValue) ? maxValue : Math.max(maxValue, numericValue);
  }, 100000);

  return String(currentMax + 1);
}

export function findUserByLogin(userNumber: string, password: string): User | null {
  const normalizedUserNumber = userNumber.trim();
  const records = getStoredRecords();
  const match = records.find(
    (record) => record.user_number === normalizedUserNumber && record.password === password,
  );

  return match ? stripPassword(match) : null;
}

export function isDniAlreadyRegistered(dni: string): boolean {
  const normalizedDni = dni.trim();
  return getStoredRecords().some((record) => record.dni === normalizedDni);
}

export function registerMockUser(input: NewUserInput): User {
  const records = getStoredRecords();
  const now = new Date().toISOString();
  const userNumber = generateNextUserNumber(records);

  const createdRecord: StoredUserRecord = {
    id: `user-${userNumber}`,
    auth_uid: `firebase-uid-${userNumber}`,
    user_number: userNumber,
    first_name: input.first_name.trim(),
    last_name: input.last_name.trim(),
    dni: input.dni.trim(),
    role_id: ROLES.MEMBER,
    profile_type: 'socio',
    profile_id: `member-${userNumber}`,
    status: 'activo',
    must_change_password: false,
    created_at: now,
    updated_at: now,
    password: input.password,
  };

  writeStoredRecords([...records, createdRecord]);
  return stripPassword(createdRecord);
}

export function updateMockUserTimestamps(userId: string, timestamp: string): User | null {
  const records = getStoredRecords();
  let updatedUser: User | null = null;

  const updatedRecords = records.map((record) => {
    if (record.id !== userId) {
      return record;
    }

    const nextRecord: StoredUserRecord = {
      ...record,
      last_login_at: timestamp,
      updated_at: timestamp,
    };

    updatedUser = stripPassword(nextRecord);
    return nextRecord;
  });

  writeStoredRecords(updatedRecords);
  return updatedUser;
}

export function getDirectoryUserById(id: string | undefined, currentUser?: User | null): User | null {
  if (!id) {
    return null;
  }

  if (currentUser?.id === id) {
    return currentUser;
  }

  const match = getStoredRecords().find((record) => record.id === id);
  return match ? stripPassword(match) : null;
}
