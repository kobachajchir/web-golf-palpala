import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildCustomClaims, pickPrimaryRoleId } from '../modules/users/application/shared.js';
import {
  DEVELOPER_ROLE_ID,
  USERS_COLLECTIONS,
} from '../modules/users/domain/constants.js';
import type { MemberDocument, UserDocument } from '../modules/users/domain/models.js';
import type { MemberFeeChargeDocument } from '../modules/accounting/domain/models.js';

const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'webgolfclub';
const TARGET_MEMBER_NUMBER = '999';
const TARGET_MEMBER_NUMBER_VARIANTS = ['999', '000999'] as const;
const MIGRATION_ACTOR_UID = 'migration-member-999-developer';
const MIGRATION_NOTE = 'Saldo pendiente eximido por migracion exclusiva del usuario tecnico 999.';
const MAX_TRANSACTION_WRITES = 450;
const CONFIRMATION_FLAGS = '--execute --yes-member-999-only';
const REPORT_PATH = resolve(
  process.env.MEMBER_999_MIGRATION_REPORT_PATH
    ?? resolve(process.cwd(), 'migration-reports', `member-999-developer-${Date.now()}.json`),
);

type ScriptOptions = {
  projectId: string;
  execute: boolean;
};

type ChargeCandidate = {
  id: string;
  ref: DocumentReference<MemberFeeChargeDocument>;
  data: MemberFeeChargeDocument;
};

function parseOptions(): ScriptOptions {
  const args = process.argv.slice(2);
  const projectArg = args.find((arg) => arg.startsWith('--project='));
  return {
    projectId: projectArg?.split('=')[1]?.trim() || DEFAULT_PROJECT_ID,
    execute: args.includes('--execute') && args.includes('--yes-member-999-only'),
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function appendMigrationNote(current: string | null | undefined): string {
  const normalized = current?.trim() ?? '';
  if (normalized.includes(MIGRATION_NOTE)) {
    return normalized;
  }
  return [normalized, MIGRATION_NOTE].filter(Boolean).join('\n');
}

function comparableClaims(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

async function waitForUserWriteClaimSync(uid: string, expectedClaimsVersion: number): Promise<Record<string, unknown>> {
  const auth = getAuth();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const currentClaims = (await auth.getUser(uid)).customClaims ?? {};
    if (currentClaims.claimsVersion === expectedClaimsVersion && currentClaims.socio === false) {
      return currentClaims;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error('El trigger de sincronizacion de claims no termino dentro de 30 segundos. No se aplico el claim desarrollador.');
}

async function findTargetMember() {
  const firestore = getFirestore();
  const snapshots = await Promise.all(
    TARGET_MEMBER_NUMBER_VARIANTS.map((memberNumber) =>
      firestore.collection(USERS_COLLECTIONS.members).where('memberNumber', '==', memberNumber).get()),
  );
  const candidates = new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((entry) => [entry.id, entry]));

  if (candidates.size !== 1) {
    throw new Error(
      `La migracion exige exactamente un socio con numero ${TARGET_MEMBER_NUMBER}; se encontraron ${candidates.size}. No se modifico nada.`,
    );
  }

  const memberSnapshot = [...candidates.values()][0];
  if (!memberSnapshot) {
    throw new Error('No se pudo resolver el socio 999. No se modifico nada.');
  }
  return {
    id: memberSnapshot.id,
    ref: memberSnapshot.ref,
    data: memberSnapshot.data() as MemberDocument,
  };
}

async function run() {
  const options = parseOptions();
  if (getApps().length === 0) {
    initializeApp({ projectId: options.projectId });
  }

  const firestore = getFirestore();
  firestore.settings({ ignoreUndefinedProperties: true });
  const member = await findTargetMember();
  const linkedUserId = member.data.linkedUserId?.trim();
  if (!linkedUserId) {
    throw new Error('El socio 999 no tiene linkedUserId. No se modifico nada.');
  }

  const userRef = firestore.collection(USERS_COLLECTIONS.users).doc(linkedUserId);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists) {
    throw new Error(`No existe users/${linkedUserId}. No se modifico nada.`);
  }
  const user = userSnapshot.data() as UserDocument;
  if (user.profileType !== 'member' || user.profileId !== member.id) {
    throw new Error('El usuario vinculado no apunta exclusivamente a la ficha del socio 999. No se modifico nada.');
  }

  const authUser = await getAuth().getUser(linkedUserId);
  const chargeSnapshots = await Promise.all([
    firestore.collection('member_fee_charges').where('memberId', '==', member.id).get(),
    firestore.collection('member_fee_charges').where('holderMemberId', '==', member.id).get(),
  ]);
  const chargeDocuments = new Map(chargeSnapshots.flatMap((snapshot) => snapshot.docs).map((entry) => [entry.id, entry]));
  const charges: ChargeCandidate[] = [...chargeDocuments.values()].map((entry) => ({
    id: entry.id,
    ref: entry.ref as DocumentReference<MemberFeeChargeDocument>,
    data: entry.data() as MemberFeeChargeDocument,
  }));
  const openCharges = charges.filter((entry) => entry.data.status === 'pending' || entry.data.status === 'overdue');
  const unsafeGroupedCharges = openCharges.filter(
    (entry) => entry.data.billingMode === 'single_group_charge'
      || Boolean(entry.data.familyGroupId)
      || Boolean(entry.data.holderMemberId && entry.data.holderMemberId !== member.id),
  );
  const safeOpenCharges = openCharges.filter(
    (entry) => entry.data.billingMode !== 'single_group_charge'
      && !entry.data.familyGroupId
      && (!entry.data.holderMemberId || entry.data.holderMemberId === member.id),
  );

  if (unsafeGroupedCharges.length > 0) {
    throw new Error(
      `Se detectaron ${unsafeGroupedCharges.length} cuotas grupales vinculadas al socio 999. La migracion se cancela para no afectar a otras personas.`,
    );
  }
  if (safeOpenCharges.length + 2 > MAX_TRANSACTION_WRITES) {
    throw new Error(`La migracion requeriria mas de ${MAX_TRANSACTION_WRITES} escrituras. No se modifico nada.`);
  }

  const currentRoleIds = Array.from(new Set(user.roleIds));
  const nextRoleIds = currentRoleIds.filter((roleId) => roleId !== 'socio' && roleId !== DEVELOPER_ROLE_ID);
  if (nextRoleIds.length === 0) {
    throw new Error('El socio 999 no posee otro rol operativo para conservar. No se modifico nada.');
  }
  const rolesChanged = !arraysEqual(currentRoleIds, nextRoleIds);
  const nextPrimaryRoleId = nextRoleIds.includes(user.primaryRoleId)
    ? user.primaryRoleId
    : pickPrimaryRoleId(nextRoleIds);
  const developerClaimChanged = authUser.customClaims?.desarrollador !== true;
  const userAccessNeedsUpdate = rolesChanged
    || nextPrimaryRoleId !== user.primaryRoleId
    || developerClaimChanged;
  const nextClaimsVersion = user.claimsVersion + (userAccessNeedsUpdate ? 1 : 0);
  const memberNeedsUpdate = member.data.membershipBillingExempt !== true
    || member.data.membershipRenewalStatus !== 'current'
    || member.data.membershipBillingExemptReason !== 'Usuario tecnico 999: no genera deuda ni admite cobros.';
  const chargeChanges = safeOpenCharges.filter((entry) =>
    entry.data.status !== 'exempt'
      || (entry.data.remainingAmountMinor ?? entry.data.finalAmountMinor) !== 0
      || !entry.data.notes?.includes(MIGRATION_NOTE));

  const plannedChanges = {
    userAccess: userAccessNeedsUpdate,
    memberExemption: memberNeedsUpdate,
    openChargesToExempt: chargeChanges.map((entry) => entry.id),
  };

  if (options.execute && (plannedChanges.userAccess || plannedChanges.memberExemption || chargeChanges.length > 0)) {
    await firestore.runTransaction(async (transaction) => {
      const currentMemberSnapshot = await transaction.get(member.ref);
      const currentUserSnapshot = await transaction.get(userRef);
      const currentChargeSnapshots = [];
      for (const charge of chargeChanges) {
        currentChargeSnapshots.push(await transaction.get(charge.ref));
      }

      if (!currentMemberSnapshot.exists || !currentUserSnapshot.exists) {
        throw new Error('El usuario o la ficha dejaron de existir durante la migracion. No se aplicaron cambios.');
      }
      const currentMember = currentMemberSnapshot.data() as MemberDocument;
      const currentUser = currentUserSnapshot.data() as UserDocument;
      if (
        currentMember.memberNumber !== member.data.memberNumber
        || currentMember.linkedUserId !== linkedUserId
        || currentUser.profileType !== 'member'
        || currentUser.profileId !== member.id
      ) {
        throw new Error('Los vinculos del socio 999 cambiaron durante la migracion. No se aplicaron cambios.');
      }

      currentChargeSnapshots.forEach((snapshot) => {
        const charge = snapshot.data() as MemberFeeChargeDocument | undefined;
        if (
          !charge
          || charge.memberId !== member.id
          || (charge.status !== 'pending' && charge.status !== 'overdue')
          || charge.billingMode === 'single_group_charge'
          || Boolean(charge.familyGroupId)
          || Boolean(charge.holderMemberId && charge.holderMemberId !== member.id)
        ) {
          throw new Error('Una cuota candidata cambio o podria involucrar a otras personas. No se aplicaron cambios.');
        }
      });

      if (plannedChanges.userAccess) {
        transaction.update(userRef, {
          roleIds: nextRoleIds,
          primaryRoleId: nextPrimaryRoleId,
          claimsVersion: nextClaimsVersion,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: MIGRATION_ACTOR_UID,
        });
      }
      if (plannedChanges.memberExemption) {
        transaction.update(member.ref, {
          membershipBillingExempt: true,
          membershipBillingExemptReason: 'Usuario tecnico 999: no genera deuda ni admite cobros.',
          membershipRenewalStatus: 'current',
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: MIGRATION_ACTOR_UID,
        });
      }
      currentChargeSnapshots.forEach((snapshot) => {
        const charge = snapshot.data() as MemberFeeChargeDocument;
        transaction.update(snapshot.ref, {
          status: 'exempt',
          remainingAmountMinor: 0,
          notes: appendMigrationNote(charge.notes),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: MIGRATION_ACTOR_UID,
        });
      });
    });
  }

  const currentCustomClaims = options.execute && plannedChanges.userAccess
    ? await waitForUserWriteClaimSync(linkedUserId, nextClaimsVersion)
    : (authUser.customClaims ?? {});
  const desiredStandardClaims = {
    ...buildCustomClaims(nextRoleIds, nextClaimsVersion, user.active),
    desarrollador: true,
  };
  const nextCustomClaims = { ...currentCustomClaims, ...desiredStandardClaims };
  const authClaimsNeedUpdate = comparableClaims(currentCustomClaims) !== comparableClaims(nextCustomClaims);
  if (options.execute && authClaimsNeedUpdate) {
    await getAuth().setCustomUserClaims(linkedUserId, nextCustomClaims);
    const verifiedClaims = (await getAuth().getUser(linkedUserId)).customClaims ?? {};
    if (verifiedClaims.desarrollador !== true || verifiedClaims.claimsVersion !== nextClaimsVersion) {
      throw new Error('Auth no confirmo el claim desarrollador para el socio 999. Revisa el reporte antes de reintentar.');
    }
  }

  const report = {
    ok: true,
    mode: options.execute ? 'execute' : 'dry-run',
    projectId: options.projectId,
    target: {
      memberNumber: TARGET_MEMBER_NUMBER,
      memberId: member.id,
      uid: linkedUserId,
    },
    safety: {
      exactMemberMatchCount: 1,
      linkedUserValidated: true,
      groupedChargesFound: unsafeGroupedCharges.length,
      otherMembersReadOrWritten: false,
      financialMovementsWritten: false,
      paidChargesWritten: false,
    },
    plannedChanges,
    untouchedPaidChargeCount: charges.filter((entry) => entry.data.status === 'paid').length,
    authClaimsNeedUpdate,
    confirmationRequiredForExecution: CONFIRMATION_FLAGS,
    reportPath: REPORT_PATH,
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  console.error(`No pudimos migrar exclusivamente al socio 999. Motivo: ${message}`);
  process.exitCode = 1;
});