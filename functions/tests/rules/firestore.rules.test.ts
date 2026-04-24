import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

const projectId = 'demo-web-golf-palpala';
const rulesPath = path.resolve(process.cwd(), '..', 'rules', 'firestore.rules');

let testEnv: RulesTestEnvironment;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await fs.readFile(rulesPath, 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    const now = Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z'));

    await setDoc(doc(adminDb, 'users/user-1'), {
      email: 'user-1@club.test',
      displayName: 'User 1',
      primaryRoleId: 'socio',
      roleIds: ['socio'],
      profileType: 'member',
      profileId: 'member-1',
      active: true,
      claimsVersion: 1,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'users/user-2'), {
      email: 'user-2@club.test',
      displayName: 'User 2',
      primaryRoleId: 'socio',
      roleIds: ['socio'],
      profileType: 'member',
      profileId: 'member-2',
      active: true,
      claimsVersion: 1,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'members/member-1'), {
      memberNumber: '0001',
      firstName: 'Socio',
      lastName: 'Uno',
      linkedUserId: 'user-1',
      typeId: 'pleno',
      typeCodeSnapshot: 'pleno',
      status: 'active',
      isFamilyHolder: false,
      joinedAt: now,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'members/member-2'), {
      memberNumber: '0002',
      firstName: 'Socio',
      lastName: 'Dos',
      linkedUserId: 'user-2',
      typeId: 'pleno',
      typeCodeSnapshot: 'pleno',
      status: 'active',
      isFamilyHolder: false,
      joinedAt: now,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'employees/employee-1'), {
      firstName: 'Empleado',
      lastName: 'Uno',
      linkedUserId: 'employee-user-1',
      position: 'Recepcion',
      contractType: 'monthly',
      status: 'active',
      startDate: now,
      canSubmitExpenses: false,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

test('user solo lee su propio users/{uid}', async () => {
  const ownDb = testEnv.authenticatedContext('user-1').firestore();
  const otherDb = testEnv.authenticatedContext('user-2').firestore();

  await assertSucceeds(getDoc(doc(ownDb, 'users/user-1')));
  await assertFails(getDoc(doc(otherDb, 'users/user-1')));
});

test('socio vinculado puede leer su member doc', async () => {
  const ownDb = testEnv.authenticatedContext('user-1').firestore();
  const otherDb = testEnv.authenticatedContext('user-2').firestore();

  await assertSucceeds(getDoc(doc(ownDb, 'members/member-1')));
  await assertFails(getDoc(doc(otherDb, 'members/member-1')));
});

test('un empleado sin staff no puede leer employees ajenos', async () => {
  const employeeDb = testEnv.authenticatedContext('employee-user-1', { empleado: true }).firestore();
  const adminDb = testEnv.authenticatedContext('admin-1', { administrativo: true }).firestore();

  await assertFails(getDoc(doc(employeeDb, 'employees/employee-1')));
  await assertSucceeds(getDoc(doc(adminDb, 'employees/employee-1')));
});
