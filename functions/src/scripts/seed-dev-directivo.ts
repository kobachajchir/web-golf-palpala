import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_MEMBER_TYPES,
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLES,
  MEMBER_TYPE_IDS,
  SYSTEM_ACTOR_UID,
  USERS_COLLECTIONS,
} from '../modules/users/domain/constants.js';
import type { UserDocument } from '../modules/users/domain/models.js';
import { buildCustomClaims, pickPrimaryRoleId } from '../modules/users/application/shared.js';
import {
  buildSyntheticAuthEmail,
  generateMemberTemporaryPassword,
  normalizeMemberNumber,
} from '../modules/auth/member-number-auth.js';

const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-web-golf-palpala';
const MEMBER_ID = process.env.DEV_DIRECTIVO_MEMBER_ID ?? 'dev-member-999-koba-chajchir';
const MEMBER_NUMBER = process.env.DEV_DIRECTIVO_MEMBER_NUMBER ?? '999';
const FIRST_NAME = process.env.DEV_DIRECTIVO_FIRST_NAME ?? 'Koba';
const LAST_NAME = process.env.DEV_DIRECTIVO_LAST_NAME ?? 'Chajchir';
const DNI = process.env.DEV_DIRECTIVO_DNI ?? '41041601';
const GENERATED_PASSWORD = generateMemberTemporaryPassword(MEMBER_NUMBER);
const DEFAULT_PASSWORD = process.env.DEV_DIRECTIVO_PASSWORD ?? GENERATED_PASSWORD.temporaryPassword;
const PASSWORD_MODE = process.env.DEV_DIRECTIVO_PASSWORD ? 'env-default-password' : 'generated-temporary-password';
const REPORT_PATH = resolve(
  process.env.DEV_DIRECTIVO_SEED_REPORT_PATH ?? resolve(process.cwd(), 'seed-reports', 'dev-directivo-seed-report.json'),
);

function ensureAdminApp() {
  if (getApps().length === 0) {
    initializeApp({ projectId: DEFAULT_PROJECT_ID });
  }
}

async function seedReferenceData() {
  const firestore = getFirestore();
  const batch = firestore.batch();
  const roleIds = ['comite_ejecutivo', 'directivo', 'administrativo', 'empleado', 'comision_directiva', 'socio'];

  DEFAULT_ROLES.forEach((role, index) => {
    batch.set(
      firestore.collection(USERS_COLLECTIONS.roles).doc(roleIds[index] ?? role.name.toLowerCase()),
      {
        ...role,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      },
      { merge: true },
    );
  });

  DEFAULT_PERMISSIONS.forEach((permission) => {
    batch.set(
      firestore.collection(USERS_COLLECTIONS.permissions).doc(permission.id),
      {
        ...permission,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      },
      { merge: true },
    );
  });

  DEFAULT_ROLE_PERMISSIONS.forEach((rolePermission) => {
    batch.set(
      firestore.collection(USERS_COLLECTIONS.rolePermissions).doc(rolePermission.id),
      {
        ...rolePermission,
        grantedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      },
      { merge: true },
    );
  });

  DEFAULT_MEMBER_TYPES.forEach((memberType) => {
    batch.set(
      firestore.collection(USERS_COLLECTIONS.memberTypes).doc(memberType.id),
      {
        ...memberType,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      },
      { merge: true },
    );
  });

  await batch.commit();
}

async function getOrCreateDevAuthUser(email: string, displayName: string) {
  const auth = getAuth();

  try {
    const existingUser = await auth.getUserByEmail(email);
    return {
      user: await auth.updateUser(existingUser.uid, {
        displayName,
        disabled: false,
        password: DEFAULT_PASSWORD,
      }),
      created: false,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  return {
    user: await auth.createUser({
      email,
      password: DEFAULT_PASSWORD,
      displayName,
      disabled: false,
    }),
    created: true,
  };
}

async function assertMemberNumberIsAvailable() {
  const firestore = getFirestore();
  const memberSnapshots = await Promise.all([
    firestore.collection(USERS_COLLECTIONS.members).where('memberNumber', '==', MEMBER_NUMBER).get(),
    firestore.collection(USERS_COLLECTIONS.members).where('memberNumber', '==', normalizeMemberNumber(MEMBER_NUMBER)).get(),
  ]);
  const conflictingMember = memberSnapshots
    .flatMap((snapshot) => snapshot.docs)
    .find((snapshot) => snapshot.id !== MEMBER_ID);

  if (conflictingMember) {
    throw new Error(`El numero de socio ${MEMBER_NUMBER} ya pertenece a ${conflictingMember.id}.`);
  }
}

async function run() {
  ensureAdminApp();
  const firestore = getFirestore();
  firestore.settings({ ignoreUndefinedProperties: true });

  await seedReferenceData();
  await assertMemberNumberIsAvailable();

  const normalizedMemberNumber = normalizeMemberNumber(MEMBER_NUMBER);
  const email = buildSyntheticAuthEmail(MEMBER_NUMBER);
  const displayName = `${FIRST_NAME} ${LAST_NAME}`.trim();
  const authUserResult = await getOrCreateDevAuthUser(email, displayName);
  const userRef = firestore.collection(USERS_COLLECTIONS.users).doc(authUserResult.user.uid);
  const userSnapshot = await userRef.get();
  const existingUser = userSnapshot.exists ? (userSnapshot.data() as UserDocument) : null;
  const roleIds = ['comite_ejecutivo', 'administrativo', 'empleado'];
  const claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;
  const userPayload = {
    email,
    displayName,
    primaryRoleId: pickPrimaryRoleId(roleIds),
    roleIds,
    profileType: 'member',
    profileId: MEMBER_ID,
    active: true,
    claimsVersion,
    memberNumber: normalizedMemberNumber,
    authProviderMode: 'member_number_password',
  };

  await firestore.runTransaction(async (transaction) => {
    const memberRef = firestore.collection(USERS_COLLECTIONS.members).doc(MEMBER_ID);
    const identifierRef = firestore.collection(USERS_COLLECTIONS.memberLoginIdentifiers).doc(normalizedMemberNumber);
    const identifierSnapshot = await transaction.get(identifierRef);
    const identifierData = identifierSnapshot.exists ? identifierSnapshot.data() : null;

    if (identifierData?.memberId && identifierData.memberId !== MEMBER_ID) {
      throw new Error(`El identificador ${normalizedMemberNumber} ya apunta al socio ${identifierData.memberId}.`);
    }

    if (identifierData?.uid && identifierData.uid !== authUserResult.user.uid) {
      throw new Error(`El identificador ${normalizedMemberNumber} ya apunta al usuario ${identifierData.uid}.`);
    }

    transaction.set(
      memberRef,
      {
        memberNumber: MEMBER_NUMBER,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
        dni: DNI,
        linkedUserId: authUserResult.user.uid,
        typeId: MEMBER_TYPE_IDS.pleno,
        typeCodeSnapshot: MEMBER_TYPE_IDS.pleno,
        status: 'active',
        isFamilyHolder: false,
        membershipBillingExempt: true,
        membershipBillingExemptReason: 'Usuario operativo 999: no genera cuota societaria ni green fee.',
        membershipRenewalStatus: 'current',
        joinedAt: FieldValue.serverTimestamp(),
        notes: 'Usuario dev directivo creado por seed local.',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      },
      { merge: true },
    );

    transaction.set(
      identifierRef,
      {
        uid: authUserResult.user.uid,
        memberId: MEMBER_ID,
        memberNumber: MEMBER_NUMBER,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      },
      { merge: true },
    );

    transaction.set(
      userRef,
      {
        ...userPayload,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      },
      { merge: true },
    );
  });


  await getAuth().setCustomUserClaims(
    authUserResult.user.uid,
    {
      ...buildCustomClaims(roleIds, claimsVersion, true),
      desarrollador: true,
    },
  );

  const report = {
    ok: true,
    projectId: DEFAULT_PROJECT_ID,
    emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST),
    memberId: MEMBER_ID,
    uid: authUserResult.user.uid,
    memberNumber: MEMBER_NUMBER,
    normalizedMemberNumber,
    displayName,
    dni: DNI,
    roleIds,
    authEmail: email,
    authUserCreated: authUserResult.created,
    passwordMode: PASSWORD_MODE,
    passwordGeneratedAt: PASSWORD_MODE === 'generated-temporary-password' ? GENERATED_PASSWORD.passwordGeneratedAt : null,
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, temporaryPassword: DEFAULT_PASSWORD }, null, 2));
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  console.error(`No pudimos seedear el usuario dev directivo. Motivo: ${message}`);
  process.exitCode = 1;
});
