import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  DEFAULT_MEMBER_TYPES,
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLES,
  SYSTEM_ACTOR_UID,
  USERS_COLLECTIONS,
} from '../modules/users/domain/constants.js';
import type { MemberDocument, UserDocument } from '../modules/users/domain/models.js';
import { buildCustomClaims, pickPrimaryRoleId } from '../modules/users/application/shared.js';
import { buildSyntheticAuthEmail, normalizeMemberNumber } from '../modules/auth/member-number-auth.js';

type BoardSeedTarget = {
  fullNameSnapshot: string;
  positionCode: string;
  positionLabel: string;
  order: number;
};

type MemberWithId = MemberDocument & { id: string };

const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-web-golf-palpala';
const TERM_ID = process.env.EXECUTIVE_BOARD_TERM_ID ?? 'comision-ejecutiva-2026';
const TERM_LABEL = process.env.EXECUTIVE_BOARD_TERM_LABEL ?? 'Comisión Ejecutiva 2026';
const DEFAULT_PASSWORD = process.env.EXECUTIVE_BOARD_DEFAULT_PASSWORD;
const REPORT_PATH = resolve(
  process.env.EXECUTIVE_BOARD_SEED_REPORT_PATH ?? resolve(process.cwd(), 'seed-reports', 'executive-board-seed-report.json'),
);

const BOARD_TARGETS: BoardSeedTarget[] = [
  {
    fullNameSnapshot: 'NOCETI, JORGE ANTONIO',
    positionCode: 'presidente',
    positionLabel: 'Presidente',
    order: 1,
  },
  {
    fullNameSnapshot: 'SOLER, JUAN MANUEL',
    positionCode: 'vicepresidente',
    positionLabel: 'Vicepresidente',
    order: 2,
  },
  {
    fullNameSnapshot: 'SOLER, SEBASTIÁN',
    positionCode: 'tesorero',
    positionLabel: 'Tesorero',
    order: 3,
  },
  {
    fullNameSnapshot: 'RODRÍGUEZ FRANCILE, HÉCTOR',
    positionCode: 'protesorero',
    positionLabel: 'Protesorero',
    order: 4,
  },
  {
    fullNameSnapshot: 'HINOJO, FRANCISCO JAVIER',
    positionCode: 'capitan_cancha',
    positionLabel: 'Cap. de Cancha',
    order: 5,
  },
  {
    fullNameSnapshot: 'NAZARIO, FEDERICO',
    positionCode: 'subcapitan_cancha',
    positionLabel: 'Subcap. de Cancha',
    order: 6,
  },
];

function ensureAdminApp() {
  if (getApps().length === 0) {
    initializeApp({ projectId: DEFAULT_PROJECT_ID });
  }
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBoardName(value: string): string {
  const [lastName = '', firstName = ''] = value.split(',').map((part) => part.trim());
  return normalizeSearchText(`${lastName} ${firstName}`);
}

function normalizeMemberName(member: MemberWithId): string {
  return normalizeSearchText(`${member.lastName} ${member.firstName}`);
}

async function seedReferenceData() {
  const firestore = getFirestore();
  const batch = firestore.batch();
  const roleIds = ['directivo', 'administrativo', 'empleado', 'socio'];

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

async function getOrCreateBoardAuthUser(member: MemberWithId, email: string, displayName: string) {
  const auth = getAuth();

  try {
    const existingUser = await auth.getUserByEmail(email);
    const updatedUser = await auth.updateUser(existingUser.uid, {
      displayName,
      disabled: false,
      ...(DEFAULT_PASSWORD ? { password: DEFAULT_PASSWORD } : {}),
    });

    return {
      user: updatedUser,
      created: false,
      generatedTemporaryPassword: false,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'auth/user-not-found') {
      throw error;
    }
  }

  const generatedTemporaryPassword = !DEFAULT_PASSWORD;
  const user = await auth.createUser({
    email,
    password: DEFAULT_PASSWORD ?? randomUUID(),
    displayName,
    disabled: false,
  });

  return {
    user,
    created: true,
    generatedTemporaryPassword,
  };
}

async function run() {
  ensureAdminApp();
  const firestore = getFirestore();
  firestore.settings({ ignoreUndefinedProperties: true });

  await seedReferenceData();

  const membersSnapshot = await firestore.collection(USERS_COLLECTIONS.members).get();
  const members = membersSnapshot.docs.map((entry) => ({
    id: entry.id,
    ...(entry.data() as MemberDocument),
  }));
  const unresolved: Array<{
    positionCode: string;
    positionLabel: string;
    fullNameSnapshot: string;
    reason: 'not_found' | 'multiple_matches';
    matches?: string[];
  }> = [];
  const linked: Array<{
    positionCode: string;
    fullNameSnapshot: string;
    memberId: string;
    memberNumber: string;
    uid: string;
    authUserCreated: boolean;
    generatedTemporaryPassword: boolean;
  }> = [];

  await firestore.collection('executive_board_terms').doc(TERM_ID).set(
    {
      label: TERM_LABEL,
      active: true,
      startsAt: null,
      endsAt: null,
      unresolvedBoardMembers: [],
      createdAt: FieldValue.serverTimestamp(),
      createdBy: SYSTEM_ACTOR_UID,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: SYSTEM_ACTOR_UID,
    },
    { merge: true },
  );

  for (const target of BOARD_TARGETS) {
    const normalizedTargetName = normalizeBoardName(target.fullNameSnapshot);
    const matches = members.filter((member) => normalizeMemberName(member) === normalizedTargetName);

    if (matches.length !== 1) {
      unresolved.push({
        positionCode: target.positionCode,
        positionLabel: target.positionLabel,
        fullNameSnapshot: target.fullNameSnapshot,
        reason: matches.length === 0 ? 'not_found' : 'multiple_matches',
        ...(matches.length > 1
          ? { matches: matches.map((member) => `${member.id} #${member.memberNumber}`) }
          : {}),
      });
      continue;
    }

    const member = matches[0]!;
    const normalizedMemberNumber = normalizeMemberNumber(member.memberNumber);
    const email = buildSyntheticAuthEmail(member.memberNumber);
    const displayName = `${member.firstName} ${member.lastName}`.trim() || target.fullNameSnapshot;
    const authUserResult = await getOrCreateBoardAuthUser(member, email, displayName);
    const userRef = firestore.collection(USERS_COLLECTIONS.users).doc(authUserResult.user.uid);
    const userSnapshot = await userRef.get();
    const existingUser = userSnapshot.exists ? (userSnapshot.data() as UserDocument) : null;
    const roleIds = Array.from(new Set([...(existingUser?.roleIds ?? []), 'socio', 'directivo']));
    const claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;
    const userPayload: Omit<UserDocument, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> = {
      email,
      displayName,
      primaryRoleId: pickPrimaryRoleId(roleIds),
      roleIds,
      profileType: 'member',
      profileId: member.id,
      active: true,
      claimsVersion,
      memberNumber: normalizedMemberNumber,
      authProviderMode: 'member_number_password',
    };

    await firestore.runTransaction(async (transaction) => {
      const memberRef = firestore.collection(USERS_COLLECTIONS.members).doc(member.id);
      const identifierRef = firestore
        .collection(USERS_COLLECTIONS.memberLoginIdentifiers)
        .doc(normalizedMemberNumber);
      const identifierSnapshot = await transaction.get(identifierRef);
      const identifierData = identifierSnapshot.exists ? identifierSnapshot.data() : null;

      if (identifierData?.memberId && identifierData.memberId !== member.id) {
        throw new Error(`Numero de socio duplicado para ${member.memberNumber}.`);
      }

      if (identifierData?.uid && identifierData.uid !== authUserResult.user.uid) {
        throw new Error(`Numero de socio duplicado para ${member.memberNumber}.`);
      }

      if (identifierSnapshot.exists) {
        transaction.update(identifierRef, {
          uid: authUserResult.user.uid,
          memberId: member.id,
          memberNumber: member.memberNumber,
          active: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.create(identifierRef, {
          uid: authUserResult.user.uid,
          memberId: member.id,
          memberNumber: member.memberNumber,
          active: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      if (existingUser) {
        transaction.update(userRef, {
          ...userPayload,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: SYSTEM_ACTOR_UID,
        });
      } else {
        transaction.create(userRef, {
          ...userPayload,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: SYSTEM_ACTOR_UID,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: SYSTEM_ACTOR_UID,
        });
      }

      transaction.update(memberRef, {
        linkedUserId: authUserResult.user.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
      });

      transaction.set(
        firestore.collection('executive_board_members').doc(`${TERM_ID}_${target.positionCode}`),
        {
          termId: TERM_ID,
          uid: authUserResult.user.uid,
          memberId: member.id,
          memberNumber: member.memberNumber,
          positionCode: target.positionCode,
          positionLabel: target.positionLabel,
          fullNameSnapshot: target.fullNameSnapshot,
          order: target.order,
          active: true,
          appointedAt: null,
          endedAt: null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: SYSTEM_ACTOR_UID,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: SYSTEM_ACTOR_UID,
        },
        { merge: true },
      );
    });

    await getAuth().setCustomUserClaims(authUserResult.user.uid, buildCustomClaims(roleIds, claimsVersion, true));

    linked.push({
      positionCode: target.positionCode,
      fullNameSnapshot: target.fullNameSnapshot,
      memberId: member.id,
      memberNumber: normalizedMemberNumber,
      uid: authUserResult.user.uid,
      authUserCreated: authUserResult.created,
      generatedTemporaryPassword: authUserResult.generatedTemporaryPassword,
    });
  }

  await firestore.collection('executive_board_terms').doc(TERM_ID).set(
    {
      unresolvedBoardMembers: unresolved,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: SYSTEM_ACTOR_UID,
    },
    { merge: true },
  );

  const report = {
    ok: unresolved.length === 0,
    projectId: DEFAULT_PROJECT_ID,
    emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
    termId: TERM_ID,
    linked,
    unresolved,
    passwordMode: DEFAULT_PASSWORD ? 'env-default-password' : 'generated-temporary-passwords',
  };

  await mkdir(resolve(REPORT_PATH, '..'), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  console.error(`No pudimos seedear la comision directiva. Motivo: ${message}`);
  process.exitCode = 1;
});
