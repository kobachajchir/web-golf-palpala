import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentData,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { USERS_COLLECTIONS } from '../users/domain/constants.js';
import { assertCondition } from '../users/domain/errors.js';
import type { Actor, MemberDocument, UserDocument } from '../users/domain/models.js';
import {
  generateMemberTemporaryPassword,
  normalizeMemberNumber,
} from '../auth/member-number-auth.js';

export const NOTIFICATIONS_COLLECTIONS = {
  notifications: 'notifications',
  notificationDeliveries: 'notification_deliveries',
  notificationActionLogs: 'notification_action_logs',
  contactInquiries: 'contact_inquiries',
} as const;

export const NOTIFICATION_ROLE_IDS = ['directivo', 'administrativo', 'empleado', 'socio', 'comision_directiva'] as const;
export type NotificationRoleId = (typeof NOTIFICATION_ROLE_IDS)[number];
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'danger';
export type NotificationDeliveryScope = 'per_user' | 'role_info' | 'shared_role_action';
export type NotificationDeliveryStatus = 'unread' | 'read' | 'dismissed' | 'actioned';

export type NotificationAttachment = {
  id: string;
  label: string;
  url?: string | null;
  contentType?: string | null;
};

export type NotificationAction = {
  key: string;
  label: string;
  requiresConfirmation: boolean;
  route?: string | null;
  payload?: Record<string, unknown>;
};

export type NotificationAudience = {
  userIds?: string[];
  roleIds?: NotificationRoleId[];
};

export type NotificationActorSnapshot = {
  uid: string;
  displayName: string;
  primaryRoleId?: string | null;
  roleIds: string[];
  profileType?: string | null;
  profileId?: string | null;
  memberNumber?: string | null;
};

export type NotificationDocument = {
  type: string;
  sourceModule: string;
  sourceCollection?: string | null;
  sourceId?: string | null;
  title: string;
  body: string;
  severity: NotificationSeverity;
  audienceUserIds: string[];
  audienceRoleIds: NotificationRoleId[];
  deliveryScope: NotificationDeliveryScope;
  route?: string | null;
  action?: NotificationAction | null;
  attachments: NotificationAttachment[];
  metadata?: Record<string, unknown>;
  status: 'open' | 'actioned' | 'closed';
  recipientCount: number;
  dedupeKey?: string | null;
  createdAt: FieldValue | Timestamp;
  createdBy: string;
  updatedAt: FieldValue | Timestamp;
  updatedBy: string;
};

export type NotificationDeliveryDocument = {
  notificationId: string;
  type: string;
  sourceModule: string;
  sourceCollection?: string | null;
  sourceId?: string | null;
  recipientUserId: string;
  recipientDisplayName?: string | null;
  recipientMemberNumber?: string | null;
  recipientProfileType?: string | null;
  recipientProfileId?: string | null;
  recipientRoleIds: NotificationRoleId[];
  titleSnapshot: string;
  bodySnapshot: string;
  severity: NotificationSeverity;
  deliveryScope: NotificationDeliveryScope;
  route?: string | null;
  action?: NotificationAction | null;
  attachments: NotificationAttachment[];
  metadata?: Record<string, unknown>;
  status: NotificationDeliveryStatus;
  readAt?: FieldValue | Timestamp | null;
  readByUid?: string | null;
  readBySnapshot?: NotificationActorSnapshot | null;
  actionedAt?: FieldValue | Timestamp | null;
  actionedByUid?: string | null;
  actionedBySnapshot?: NotificationActorSnapshot | null;
  dismissedAt?: FieldValue | Timestamp | null;
  dismissedByUid?: string | null;
  createdAt: FieldValue | Timestamp;
  createdBy: string;
  updatedAt: FieldValue | Timestamp;
  updatedBy: string;
};

export type EmitNotificationInput = {
  type: string;
  sourceModule: string;
  sourceCollection?: string | null;
  sourceId?: string | null;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  audience: NotificationAudience;
  deliveryScope?: NotificationDeliveryScope;
  route?: string | null;
  action?: NotificationAction | null;
  attachments?: NotificationAttachment[];
  metadata?: Record<string, unknown>;
  dedupeKey?: string | null;
  actorUid?: string;
};

type DeliveryTarget = {
  uid: string;
  displayName?: string | null;
  memberNumber?: string | null;
  profileType?: string | null;
  profileId?: string | null;
  recipientRoleIds: NotificationRoleId[];
};

function getOrInitializeApp() {
  return getApps().length > 0 ? getApp() : initializeApp();
}

export function getNotificationsDb() {
  return getFirestore(getOrInitializeApp());
}

function withId<T extends DocumentData>(snapshot: QueryDocumentSnapshot<T>): T & { id: string } {
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

function asNotificationRoleId(value: string): NotificationRoleId | null {
  return (NOTIFICATION_ROLE_IDS as readonly string[]).includes(value) ? value as NotificationRoleId : null;
}

function normalizeRoleIds(roleIds: readonly string[] | undefined): NotificationRoleId[] {
  return Array.from(
    new Set((roleIds ?? []).map((roleId) => asNotificationRoleId(roleId)).filter((roleId): roleId is NotificationRoleId => Boolean(roleId))),
  );
}

function normalizeUserIds(userIds: readonly string[] | undefined): string[] {
  return Array.from(new Set((userIds ?? []).map((uid) => uid.trim()).filter(Boolean)));
}

function buildDedupeId(dedupeKey: string): string {
  return dedupeKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'notification';
}

export function buildActorSnapshot(actor: Actor): NotificationActorSnapshot {
  return {
    uid: actor.uid,
    displayName: actor.user.displayName,
    primaryRoleId: actor.user.primaryRoleId,
    roleIds: actor.user.roleIds,
    profileType: actor.user.profileType,
    profileId: actor.user.profileId ?? null,
    memberNumber: actor.user.memberNumber ?? null,
  };
}

export function actorHasRole(actor: Actor, roleId: string): boolean {
  return actor.user.roleIds.includes(roleId) && actor.claims[roleId as keyof typeof actor.claims] === true;
}

export function isStaffActor(actor: Actor): boolean {
  return actorHasRole(actor, 'directivo') || actorHasRole(actor, 'administrativo');
}

async function getUsersByIds(userIds: readonly string[]): Promise<DeliveryTarget[]> {
  if (userIds.length === 0) {
    return [];
  }

  const db = getNotificationsDb();
  const targets: DeliveryTarget[] = [];

  await Promise.all(userIds.map(async (uid) => {
    const snapshot = await db.collection(USERS_COLLECTIONS.users).doc(uid).get();
    if (!snapshot.exists) {
      return;
    }

    const user = snapshot.data() as UserDocument;
    if (!user.active) {
      return;
    }

    targets.push({
      uid,
      displayName: user.displayName,
      memberNumber: user.memberNumber ?? null,
      profileType: user.profileType,
      profileId: user.profileId ?? null,
      recipientRoleIds: [],
    });
  }));

  return targets;
}

async function getUsersByRoles(roleIds: readonly NotificationRoleId[]): Promise<DeliveryTarget[]> {
  if (roleIds.length === 0) {
    return [];
  }

  const db = getNotificationsDb();
  const snapshot = await db.collection(USERS_COLLECTIONS.users)
    .where('active', '==', true)
    .get();
  const roleSet = new Set(roleIds);

  return snapshot.docs.flatMap((doc) => {
    const user = doc.data() as UserDocument;
    const matchedRoleIds = normalizeRoleIds(user.roleIds).filter((roleId) => roleSet.has(roleId));
    if (matchedRoleIds.length === 0) {
      return [];
    }

    return [{
      uid: doc.id,
      displayName: user.displayName,
      memberNumber: user.memberNumber ?? null,
      profileType: user.profileType,
      profileId: user.profileId ?? null,
      recipientRoleIds: matchedRoleIds,
    }];
  });
}

async function resolveDeliveryTargets(audience: NotificationAudience): Promise<DeliveryTarget[]> {
  const directTargets = await getUsersByIds(normalizeUserIds(audience.userIds));
  const roleTargets = await getUsersByRoles(normalizeRoleIds(audience.roleIds));
  const byUid = new Map<string, DeliveryTarget>();

  for (const target of [...roleTargets, ...directTargets]) {
    const existing = byUid.get(target.uid);
    if (!existing) {
      byUid.set(target.uid, target);
      continue;
    }

    byUid.set(target.uid, {
      ...existing,
      recipientRoleIds: Array.from(new Set([...existing.recipientRoleIds, ...target.recipientRoleIds])),
    });
  }

  return Array.from(byUid.values());
}

async function commitBatchWrites(writes: Array<(batch: WriteBatch) => void>) {
  const db = getNotificationsDb();
  for (let start = 0; start < writes.length; start += 400) {
    const batch = db.batch();
    const slice = writes.slice(start, start + 400);
    for (const write of slice) {
      write(batch);
    }
    await batch.commit();
  }
}

export async function emitNotification(input: EmitNotificationInput): Promise<{ notificationId: string; recipientCount: number; duplicate: boolean }> {
  const db = getNotificationsDb();
  const actorUid = input.actorUid ?? 'system';
  const audienceUserIds = normalizeUserIds(input.audience.userIds);
  const audienceRoleIds = normalizeRoleIds(input.audience.roleIds);
  assertCondition(audienceUserIds.length > 0 || audienceRoleIds.length > 0, 'invalid-argument', 'La notificación necesita al menos un destinatario.');

  const targets = await resolveDeliveryTargets({
    userIds: audienceUserIds,
    roleIds: audienceRoleIds,
  });
  assertCondition(targets.length > 0, 'failed-precondition', 'No hay usuarios activos para recibir la notificación.');

  const notificationRef = input.dedupeKey
    ? db.collection(NOTIFICATIONS_COLLECTIONS.notifications).doc(buildDedupeId(input.dedupeKey))
    : db.collection(NOTIFICATIONS_COLLECTIONS.notifications).doc();

  if (input.dedupeKey) {
    const existing = await notificationRef.get();
    if (existing.exists) {
      return {
        notificationId: notificationRef.id,
        recipientCount: Number(existing.get('recipientCount') ?? 0),
        duplicate: true,
      };
    }
  }

  const notificationId = notificationRef.id;
  const deliveryScope = input.deliveryScope ?? (audienceRoleIds.length > 0 ? 'role_info' : 'per_user');
  const notification: NotificationDocument = {
    type: input.type,
    sourceModule: input.sourceModule,
    sourceCollection: input.sourceCollection ?? null,
    sourceId: input.sourceId ?? null,
    title: input.title,
    body: input.body,
    severity: input.severity ?? 'info',
    audienceUserIds,
    audienceRoleIds,
    deliveryScope,
    route: input.route ?? null,
    action: input.action ?? null,
    attachments: input.attachments ?? [],
    ...(input.metadata ? { metadata: input.metadata } : {}),
    status: 'open',
    recipientCount: targets.length,
    dedupeKey: input.dedupeKey ?? null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  };

  const batch = db.batch();
  batch.create(notificationRef, notification);
  await batch.commit();

  await commitBatchWrites(targets.map((target) => (deliveryBatch) => {
    const deliveryRef = db.collection(NOTIFICATIONS_COLLECTIONS.notificationDeliveries).doc(`${notificationId}_${target.uid}`);
    const delivery: NotificationDeliveryDocument = {
      notificationId,
      type: input.type,
      sourceModule: input.sourceModule,
      sourceCollection: input.sourceCollection ?? null,
      sourceId: input.sourceId ?? null,
      recipientUserId: target.uid,
      recipientDisplayName: target.displayName ?? null,
      recipientMemberNumber: target.memberNumber ?? null,
      recipientProfileType: target.profileType ?? null,
      recipientProfileId: target.profileId ?? null,
      recipientRoleIds: target.recipientRoleIds,
      titleSnapshot: input.title,
      bodySnapshot: input.body,
      severity: input.severity ?? 'info',
      deliveryScope,
      route: input.route ?? null,
      action: input.action ?? null,
      attachments: input.attachments ?? [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
      status: 'unread',
      readAt: null,
      readByUid: null,
      readBySnapshot: null,
      actionedAt: null,
      actionedByUid: null,
      actionedBySnapshot: null,
      dismissedAt: null,
      dismissedByUid: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    };
    deliveryBatch.create(deliveryRef, delivery);
  }));

  return {
    notificationId,
    recipientCount: targets.length,
    duplicate: false,
  };
}

export async function emitRoleNotification(input: Omit<EmitNotificationInput, 'audience'> & { roleIds: NotificationRoleId[] }) {
  return emitNotification({
    ...input,
    audience: { roleIds: input.roleIds },
  });
}

export async function emitUserNotification(input: Omit<EmitNotificationInput, 'audience'> & { userIds: string[] }) {
  return emitNotification({
    ...input,
    audience: { userIds: input.userIds },
  });
}

export async function emitMemberPaymentNotification(params: {
  memberId: string;
  movementId: string;
  amountMinor: number;
  receiptNumber?: string | null;
  actorUid: string;
}) {
  const db = getNotificationsDb();
  const memberSnapshot = await db.collection(USERS_COLLECTIONS.members).doc(params.memberId).get();
  if (!memberSnapshot.exists) {
    return null;
  }

  const member = memberSnapshot.data() as MemberDocument;
  if (!member.linkedUserId) {
    return null;
  }
  const movementSnapshot = await db.collection('financial_movements').doc(params.movementId).get();
  const movement = movementSnapshot.exists ? movementSnapshot.data() as Record<string, unknown> : null;
  const movementMetadata = movement?.metadata && typeof movement.metadata === 'object'
    ? movement.metadata as Record<string, unknown>
    : {};
  const conceptLabel = typeof movementMetadata.description === 'string' && movementMetadata.description.trim()
    ? movementMetadata.description.trim()
    : typeof movementMetadata.tournamentName === 'string' && movementMetadata.tournamentName.trim()
      ? movementMetadata.tournamentName.trim()
      : typeof movement?.categoryCodeSnapshot === 'string' && movement.categoryCodeSnapshot.trim()
        ? movement.categoryCodeSnapshot.replaceAll('_', ' ')
        : 'Pago al club';
  const receiptSnapshot = {
    receiptNumber: params.receiptNumber ?? null,
    conceptLabel,
    movementId: params.movementId,
    memberId: params.memberId,
    memberNumber: member.memberNumber,
    memberName: `${member.lastName}, ${member.firstName}`.trim(),
    amountMinor: params.amountMinor,
    grossAmountMinor: typeof movement?.grossAmountMinor === 'number' ? movement.grossAmountMinor : params.amountMinor,
    netAmountMinor: typeof movement?.netAmountMinor === 'number' ? movement.netAmountMinor : params.amountMinor,
    categoryId: typeof movement?.categoryId === 'string' ? movement.categoryId : 'cuota_societaria',
    paymentMethodId: typeof movement?.paymentMethodId === 'string' ? movement.paymentMethodId : null,
    operationDate: movement?.operationDate ?? null,
    accountingPeriod: typeof movement?.accountingPeriod === 'string' ? movement.accountingPeriod : null,
    status: typeof movement?.status === 'string' ? movement.status : 'posted',
    reference: typeof movementMetadata.paymentReference === 'string' ? movementMetadata.paymentReference : null,
    notes: typeof movement?.notes === 'string' ? movement.notes : null,
  };

  return emitUserNotification({
    type: 'member_payment_receipt',
    sourceModule: 'accounting',
    sourceCollection: 'financial_movements',
    sourceId: params.movementId,
    title: params.receiptNumber ? `Recibo ${params.receiptNumber} disponible` : 'Recibo disponible',
    body: `Se registró un pago al club por ${formatAmountMinor(params.amountMinor)}.`,
    severity: 'success',
    userIds: [member.linkedUserId],
    deliveryScope: 'per_user',
    route: '/mis-recibos',
    attachments: [
      {
        id: 'receipt',
        label: params.receiptNumber ? `Recibo ${params.receiptNumber}` : 'Recibo de pago',
        contentType: 'application/x-internal-receipt',
      },
    ],
    metadata: {
      memberId: params.memberId,
      movementId: params.movementId,
      amountMinor: params.amountMinor,
      receiptNumber: params.receiptNumber ?? null,
      receipt: receiptSnapshot,
    },
    actorUid: params.actorUid,
  });
}

export function formatAmountMinor(amountMinor: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export async function resetMemberPasswordFromNotification(params: {
  actor: Actor;
  memberId: string;
}) {
  const db = getNotificationsDb();
  const memberSnapshot = await db.collection(USERS_COLLECTIONS.members).doc(params.memberId).get();
  assertCondition(memberSnapshot.exists, 'not-found', `No existe members/${params.memberId}.`);

  const member = memberSnapshot.data() as MemberDocument;
  assertCondition(member.linkedUserId, 'failed-precondition', 'El socio todavía no tiene acceso a la app.');

  const userSnapshot = await db.collection(USERS_COLLECTIONS.users).doc(member.linkedUserId).get();
  const user = userSnapshot.exists ? (userSnapshot.data() as UserDocument) : null;
  assertCondition(user, 'not-found', `No existe users/${member.linkedUserId}.`);
  if (user.roleIds.includes('directivo')) {
    assertCondition(actorHasRole(params.actor, 'directivo'), 'permission-denied', 'Solo un directivo puede restablecer la clave de otro directivo.');
  } else {
    assertCondition(isStaffActor(params.actor), 'permission-denied', 'Solo administración o Junta Directiva puede restablecer contraseñas.');
  }

  const normalizedMemberNumber = normalizeMemberNumber(member.memberNumber);
  const generatedPassword = generateMemberTemporaryPassword(normalizedMemberNumber);

  await getAuth(getOrInitializeApp()).updateUser(member.linkedUserId, {
    password: generatedPassword.temporaryPassword,
    disabled: false,
  });

  await db.runTransaction(async (transaction) => {
    transaction.update(userSnapshot.ref, {
      active: true,
      mustChangePassword: true,
      passwordResetRequiredReason: 'staff_reset',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: params.actor.uid,
    });
    transaction.set(
      db.collection(USERS_COLLECTIONS.passwordResetRequests).doc(normalizedMemberNumber),
      {
        memberNumber: member.memberNumber,
        normalizedMemberNumber,
        memberId: params.memberId,
        uid: member.linkedUserId,
        displayName: `${member.firstName} ${member.lastName}`.trim(),
        status: 'completed',
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedBy: params.actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: params.actor.uid,
      },
      { merge: true },
    );
  });

  return {
    uid: member.linkedUserId,
    memberId: params.memberId,
    memberNumber: normalizedMemberNumber,
    temporaryPassword: generatedPassword.temporaryPassword,
    passwordGeneratedAt: generatedPassword.passwordGeneratedAt,
  };
}
