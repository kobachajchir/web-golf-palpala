import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { USERS_COLLECTIONS } from '../users/domain/constants.js';
import { assertCondition, isRecord } from '../users/domain/errors.js';
import type { Actor, MemberDocument } from '../users/domain/models.js';
import {
  assertIsRecord,
  parseOptionalNullableString,
  parseOptionalString,
  parseRequiredString,
  resolveActor,
  toHttpsError,
} from '../users/application/shared.js';
import { FirestoreUsersTransactionManager, SystemClock } from '../users/infrastructure/firestore/repositories.js';
import {
  NOTIFICATIONS_COLLECTIONS,
  actorHasRole,
  buildActorSnapshot,
  emitNotification,
  emitRoleNotification,
  isStaffActor,
  resetMemberPasswordFromNotification,
  type NotificationDeliveryDocument,
  type NotificationDocument,
  type NotificationRoleId,
} from './notifications.service.js';

const transactions = new FirestoreUsersTransactionManager(new SystemClock());
const STAFF_NOTIFICATION_ROLE_IDS: NotificationRoleId[] = ['administrativo', 'directivo'];
const MEMBER_LIFECYCLE_LOOKAHEAD_DAYS = 15;
const LICENSE_MAX_MONTHS = 6;

function getOrInitializeApp() {
  return getApps().length > 0 ? getApp() : initializeApp();
}

function getDb() {
  return getFirestore(getOrInitializeApp());
}

async function getActorFromCallableRequest(
  auth:
    | {
        uid?: string;
        token?: Record<string, unknown>;
      }
    | undefined,
) {
  return resolveActor(
    transactions.getDataAccess(),
    auth
      ? {
          uid: auth.uid,
          token: auth.token,
        }
      : null,
  );
}

function withCallableLogging(functionName: string, error: unknown): never {
  logger.error(`${functionName} failed`, error);
  throw toHttpsError(error);
}

function ensureNotificationAccess(actor: Actor | null): Actor {
  assertCondition(actor, 'unauthenticated', 'Debes iniciar sesión para administrar notificaciones.');
  assertCondition(actor.user.active, 'permission-denied', 'El usuario no está activo.');
  return actor;
}

function ensureNotificationStaff(actor: Actor | null): Actor {
  const authenticatedActor = ensureNotificationAccess(actor);
  assertCondition(isStaffActor(authenticatedActor), 'permission-denied', 'Solo administración o Junta Directiva puede ver el portal administrativo.');
  return authenticatedActor;
}

function parseOptionalStringArray(data: Record<string, unknown>, field: string): string[] | undefined {
  if (!(field in data)) {
    return undefined;
  }

  const value = data[field];
  if (value === null) {
    return undefined;
  }

  assertCondition(Array.isArray(value), 'invalid-argument', `El campo ${field} debe ser un arreglo.`);
  return Array.from(new Set(value.map((entry) => {
    assertCondition(typeof entry === 'string' && entry.trim().length > 0, 'invalid-argument', `Todos los valores de ${field} deben ser texto.`);
    return entry.trim();
  })));
}

function parsePublicInquiryInput(payload: unknown) {
  const data = assertIsRecord(payload);
  const senderName = parseRequiredString(data, 'senderName');
  const senderEmail = parseOptionalNullableString(data, 'senderEmail') ?? null;
  const senderPhone = parseOptionalNullableString(data, 'senderPhone') ?? null;
  const subject = parseRequiredString(data, 'subject');
  const message = parseRequiredString(data, 'message');

  assertCondition(Boolean(senderEmail || senderPhone), 'invalid-argument', 'Ingresá un email o teléfono de contacto.');
  assertCondition(senderName.length <= 120, 'invalid-argument', 'El nombre no puede superar 120 caracteres.');
  assertCondition((senderEmail?.length ?? 0) <= 160, 'invalid-argument', 'El email no puede superar 160 caracteres.');
  assertCondition((senderPhone?.length ?? 0) <= 80, 'invalid-argument', 'El teléfono no puede superar 80 caracteres.');
  assertCondition(subject.length <= 140, 'invalid-argument', 'El asunto no puede superar 140 caracteres.');
  assertCondition(message.length <= 2_000, 'invalid-argument', 'El mensaje no puede superar 2000 caracteres.');

  return {
    senderName,
    senderEmail,
    senderPhone,
    subject,
    message,
  };
}

function parseMemberInquiryInput(payload: unknown) {
  const data = assertIsRecord(payload);
  const subject = parseRequiredString(data, 'subject');
  const message = parseRequiredString(data, 'message');
  assertCondition(subject.length <= 140, 'invalid-argument', 'El asunto no puede superar 140 caracteres.');
  assertCondition(message.length <= 2_000, 'invalid-argument', 'El mensaje no puede superar 2000 caracteres.');
  return { subject, message };
}

function parseDeliveryId(payload: unknown) {
  return parseRequiredString(assertIsRecord(payload), 'deliveryId');
}

function canActorAccessDelivery(actor: Actor, delivery: NotificationDeliveryDocument): boolean {
  if (delivery.recipientUserId === actor.uid) {
    return true;
  }

  if (isStaffActor(actor)) {
    return true;
  }

  return delivery.recipientRoleIds.some((roleId) => actorHasRole(actor, roleId));
}

async function getDeliveryForActor(deliveryId: string, actor: Actor): Promise<NotificationDeliveryDocument & { id: string }> {
  const snapshot = await getDb().collection(NOTIFICATIONS_COLLECTIONS.notificationDeliveries).doc(deliveryId).get();
  assertCondition(snapshot.exists, 'not-found', `No existe notification_deliveries/${deliveryId}.`);
  const delivery = {
    id: snapshot.id,
    ...snapshot.data(),
  } as NotificationDeliveryDocument & { id: string };
  assertCondition(canActorAccessDelivery(actor, delivery), 'permission-denied', 'No podés acceder a esta notificación.');
  return delivery;
}

function buildActionLog(params: {
  notificationId: string;
  deliveryId: string;
  actor: Actor;
  eventType: 'read' | 'dismissed' | 'actioned';
  actionKey?: string | null;
}) {
  return {
    notificationId: params.notificationId,
    deliveryId: params.deliveryId,
    eventType: params.eventType,
    actionKey: params.actionKey ?? null,
    actorUid: params.actor.uid,
    actorSnapshot: buildActorSnapshot(params.actor),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: params.actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: params.actor.uid,
  };
}

async function markDeliveryReadInternal(params: {
  deliveryId: string;
  actor: Actor;
}) {
  const delivery = await getDeliveryForActor(params.deliveryId, params.actor);
  if (delivery.status !== 'unread') {
    return delivery;
  }

  const actorSnapshot = buildActorSnapshot(params.actor);
  const db = getDb();
  await db.runTransaction(async (transaction) => {
    const deliveryRef = db.collection(NOTIFICATIONS_COLLECTIONS.notificationDeliveries).doc(params.deliveryId);
    transaction.update(deliveryRef, {
      status: 'read',
      readAt: FieldValue.serverTimestamp(),
      readByUid: params.actor.uid,
      readBySnapshot: actorSnapshot,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: params.actor.uid,
    });
    transaction.create(db.collection(NOTIFICATIONS_COLLECTIONS.notificationActionLogs).doc(), buildActionLog({
      notificationId: delivery.notificationId,
      deliveryId: params.deliveryId,
      actor: params.actor,
      eventType: 'read',
    }));
  });

  return {
    ...delivery,
    status: 'read' as const,
    readByUid: params.actor.uid,
    readBySnapshot: actorSnapshot,
  };
}

export const notificationsMarkRead = onCall(async (request) => {
  try {
    const actor = ensureNotificationAccess(await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined));
    const delivery = await markDeliveryReadInternal({
      deliveryId: parseDeliveryId(request.data),
      actor,
    });
    return { deliveryId: delivery.id, status: delivery.status };
  } catch (error) {
    withCallableLogging('notificationsMarkRead', error);
  }
});

export const notificationsDismiss = onCall(async (request) => {
  try {
    const actor = ensureNotificationAccess(await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined));
    const deliveryId = parseDeliveryId(request.data);
    const delivery = await getDeliveryForActor(deliveryId, actor);
    if (delivery.status === 'dismissed' || delivery.status === 'actioned') {
      return { deliveryId, status: delivery.status };
    }

    const db = getDb();
    await db.runTransaction(async (transaction) => {
      transaction.update(db.collection(NOTIFICATIONS_COLLECTIONS.notificationDeliveries).doc(deliveryId), {
        status: 'dismissed',
        dismissedAt: FieldValue.serverTimestamp(),
        dismissedByUid: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      });
      transaction.create(db.collection(NOTIFICATIONS_COLLECTIONS.notificationActionLogs).doc(), buildActionLog({
        notificationId: delivery.notificationId,
        deliveryId,
        actor,
        eventType: 'dismissed',
      }));
    });

    return { deliveryId, status: 'dismissed' };
  } catch (error) {
    withCallableLogging('notificationsDismiss', error);
  }
});

export const notificationsExecuteAction = onCall(async (request) => {
  try {
    const actor = ensureNotificationAccess(await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined));
    const deliveryId = parseDeliveryId(request.data);
    const delivery = await getDeliveryForActor(deliveryId, actor);
    assertCondition(delivery.action, 'failed-precondition', 'Esta notificación no tiene una acción asociada.');
    assertCondition(delivery.status !== 'dismissed', 'failed-precondition', 'La notificación fue descartada.');

    assertCondition(delivery.status !== 'actioned', 'failed-precondition', 'Esta accion ya fue tomada.');

    const db = getDb();
    if (delivery.deliveryScope === 'shared_role_action') {
      const relatedSnapshot = await db.collection(NOTIFICATIONS_COLLECTIONS.notificationDeliveries)
        .where('notificationId', '==', delivery.notificationId)
        .get();
      const alreadyActioned = relatedSnapshot.docs.some((doc) => doc.get('status') === 'actioned');
      assertCondition(!alreadyActioned, 'failed-precondition', 'Esta accion ya fue tomada por otro usuario.');
    }

    let actionResult: Record<string, unknown> = {};
    if (delivery.action.key === 'users.reset_member_password_request') {
      const memberId = typeof delivery.action.payload?.memberId === 'string'
        ? delivery.action.payload.memberId
        : delivery.sourceId;
      assertCondition(memberId, 'invalid-argument', 'La acción no tiene socio asociado.');
      actionResult = await resetMemberPasswordFromNotification({ actor, memberId });
    } else if (delivery.action.key === 'members.review_lifecycle' || delivery.action.key === 'notifications.open_route') {
      actionResult = { ok: true };
    } else {
      throw new Error(`Acción no soportada: ${delivery.action.key}`);
    }

    const actorSnapshot = buildActorSnapshot(actor);
    await db.runTransaction(async (transaction) => {
      const nowPatch = {
        status: 'actioned',
        readAt: FieldValue.serverTimestamp(),
        readByUid: actor.uid,
        readBySnapshot: actorSnapshot,
        actionedAt: FieldValue.serverTimestamp(),
        actionedByUid: actor.uid,
        actionedBySnapshot: actorSnapshot,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      };

      if (delivery.deliveryScope === 'shared_role_action') {
        const relatedSnapshot = await transaction.get(
          db.collection(NOTIFICATIONS_COLLECTIONS.notificationDeliveries)
            .where('notificationId', '==', delivery.notificationId),
        );
        const alreadyActioned = relatedSnapshot.docs.some((doc) => doc.get('status') === 'actioned' && doc.id !== deliveryId);
        assertCondition(!alreadyActioned, 'failed-precondition', 'Esta acción ya fue tomada por otro usuario.');
        relatedSnapshot.docs.forEach((doc) => {
          transaction.update(doc.ref, nowPatch);
        });
        transaction.update(db.collection(NOTIFICATIONS_COLLECTIONS.notifications).doc(delivery.notificationId), {
          status: 'actioned',
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        });
      } else {
        transaction.update(db.collection(NOTIFICATIONS_COLLECTIONS.notificationDeliveries).doc(deliveryId), nowPatch);
      }

      transaction.create(db.collection(NOTIFICATIONS_COLLECTIONS.notificationActionLogs).doc(), buildActionLog({
        notificationId: delivery.notificationId,
        deliveryId,
        actor,
        eventType: 'actioned',
        actionKey: delivery.action?.key ?? null,
      }));
    });

    return {
      deliveryId,
      notificationId: delivery.notificationId,
      status: 'actioned',
      actionKey: delivery.action.key,
      result: actionResult,
    };
  } catch (error) {
    withCallableLogging('notificationsExecuteAction', error);
  }
});

export const notificationsListAdmin = onCall(async (request) => {
  try {
    ensureNotificationStaff(await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined));
    const data = isRecord(request.data) ? request.data : {};
    const status = parseOptionalString(data, 'status');
    const type = parseOptionalString(data, 'type');
    const roleId = parseOptionalString(data, 'roleId');
    const userQuery = parseOptionalString(data, 'userQuery')?.toLowerCase();
    const actionKey = parseOptionalString(data, 'actionKey');
    const limit = Math.min(Math.max(Number(data.limit ?? 120), 1), 300);
    const db = getDb();
    const snapshot = await db.collection(NOTIFICATIONS_COLLECTIONS.notificationDeliveries)
      .orderBy('createdAt', 'desc')
      .limit(300)
      .get();

    const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as NotificationDeliveryDocument & { id: string }))
      .filter((item) => !status || item.status === status)
      .filter((item) => !type || item.type === type)
      .filter((item) => !roleId || item.recipientRoleIds.includes(roleId as NotificationRoleId))
      .filter((item) => !actionKey || item.action?.key === actionKey)
      .filter((item) => {
        if (!userQuery) {
          return true;
        }
        const haystack = [
          item.recipientUserId,
          item.recipientDisplayName,
          item.recipientMemberNumber,
          item.titleSnapshot,
          item.bodySnapshot,
        ].join(' ').toLowerCase();
        return haystack.includes(userQuery);
      })
      .slice(0, limit);

    return { items };
  } catch (error) {
    withCallableLogging('notificationsListAdmin', error);
  }
});

export const contactSubmitPublicInquiry = onCall(async (request) => {
  try {
    const input = parsePublicInquiryInput(request.data);
    const db = getDb();
    const inquiryRef = db.collection(NOTIFICATIONS_COLLECTIONS.contactInquiries).doc();
    await inquiryRef.create({
      origin: 'public',
      senderName: input.senderName,
      senderEmail: input.senderEmail,
      senderPhone: input.senderPhone,
      subject: input.subject,
      message: input.message,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'public-contact',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'public-contact',
    });

    try {
      await emitRoleNotification({
        type: 'contact_inquiry',
        sourceModule: 'contact',
        sourceCollection: NOTIFICATIONS_COLLECTIONS.contactInquiries,
        sourceId: inquiryRef.id,
        title: 'Nueva consulta de contacto',
        body: `${input.senderName} envió una consulta: ${input.subject}.`,
        severity: 'info',
        roleIds: STAFF_NOTIFICATION_ROLE_IDS,
        deliveryScope: 'role_info',
        route: `/notificaciones?inquiry=${inquiryRef.id}`,
        metadata: {
          origin: 'public',
          inquiryId: inquiryRef.id,
          senderName: input.senderName,
        },
        actorUid: 'public-contact',
      });
    } catch (notificationError) {
      logger.warn('contactSubmitPublicInquiry notification emit failed', notificationError);
    }

    return { inquiryId: inquiryRef.id };
  } catch (error) {
    withCallableLogging('contactSubmitPublicInquiry', error);
  }
});

export const contactSubmitMemberInquiry = onCall(async (request) => {
  try {
    const actor = ensureNotificationAccess(await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined));
    assertCondition(actor.user.profileType === 'member' && actor.user.profileId, 'failed-precondition', 'Solo un socio vinculado puede enviar esta consulta interna.');
    const input = parseMemberInquiryInput(request.data);
    const db = getDb();
    const inquiryRef = db.collection(NOTIFICATIONS_COLLECTIONS.contactInquiries).doc();
    await inquiryRef.create({
      origin: 'member',
      senderUid: actor.uid,
      senderProfileId: actor.user.profileId,
      senderMemberNumber: actor.user.memberNumber ?? null,
      senderName: actor.user.displayName,
      senderEmail: actor.user.email,
      subject: input.subject,
      message: input.message,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    });

    try {
      await emitRoleNotification({
        type: 'contact_inquiry',
        sourceModule: 'contact',
        sourceCollection: NOTIFICATIONS_COLLECTIONS.contactInquiries,
        sourceId: inquiryRef.id,
        title: 'Consulta interna de socio',
        body: `${actor.user.displayName} envió una consulta: ${input.subject}.`,
        severity: 'info',
        roleIds: STAFF_NOTIFICATION_ROLE_IDS,
        deliveryScope: 'role_info',
        route: `/admin/members/${actor.user.profileId}`,
        metadata: {
          origin: 'member',
          inquiryId: inquiryRef.id,
          memberId: actor.user.profileId,
          memberNumber: actor.user.memberNumber ?? null,
        },
        actorUid: actor.uid,
      });
    } catch (notificationError) {
      logger.warn('contactSubmitMemberInquiry notification emit failed', notificationError);
    }

    return { inquiryId: inquiryRef.id };
  } catch (error) {
    withCallableLogging('contactSubmitMemberInquiry', error);
  }
});

function timestampToDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  return null;
}

function addMonths(date: Date, months: number): Date {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysUntil(targetDate: Date, now: Date): number {
  return Math.ceil((targetDate.getTime() - now.getTime()) / 86_400_000);
}

async function emitMembershipLifecycleNotifications(now = new Date()) {
  const db = getDb();
  const snapshot = await db.collection(USERS_COLLECTIONS.members).get();
  let emitted = 0;

  for (const doc of snapshot.docs) {
    const member = doc.data() as MemberDocument;
    const displayName = `${member.firstName} ${member.lastName}`.trim() || member.memberNumber;
    const renewalDueAt = timestampToDate(member.membershipRenewalDueAt);

    if (member.linkedUserId && renewalDueAt) {
      const remainingDays = daysUntil(renewalDueAt, now);
      if (remainingDays >= 0 && remainingDays <= MEMBER_LIFECYCLE_LOOKAHEAD_DAYS) {
        const result = await emitNotification({
          type: 'member_lifecycle_alert',
          sourceModule: 'users',
          sourceCollection: USERS_COLLECTIONS.members,
          sourceId: doc.id,
          title: 'Membresía próxima a vencer',
          body: `Tu membresía vence el ${dateKey(renewalDueAt)}.`,
          severity: 'warning',
          audience: { userIds: [member.linkedUserId] },
          deliveryScope: 'per_user',
          route: '/mi-membresia',
          metadata: {
            lifecycleKind: 'membership_due',
            memberId: doc.id,
            dueAt: renewalDueAt.toISOString(),
          },
          dedupeKey: `member-lifecycle:membership-due:${doc.id}:${dateKey(renewalDueAt)}`,
          actorUid: 'system',
        });
        if (!result.duplicate) {
          emitted += 1;
        }
      }

      if (remainingDays < 0) {
        const result = await emitNotification({
          type: 'member_lifecycle_alert',
          sourceModule: 'users',
          sourceCollection: USERS_COLLECTIONS.members,
          sourceId: doc.id,
          title: 'Membresía vencida',
          body: `Tu membresía venció el ${dateKey(renewalDueAt)}.`,
          severity: 'danger',
          audience: { userIds: [member.linkedUserId] },
          deliveryScope: 'per_user',
          route: '/mi-membresia',
          metadata: {
            lifecycleKind: 'membership_expired',
            memberId: doc.id,
            dueAt: renewalDueAt.toISOString(),
          },
          dedupeKey: `member-lifecycle:membership-expired:${doc.id}:${dateKey(renewalDueAt)}`,
          actorUid: 'system',
        });
        if (!result.duplicate) {
          emitted += 1;
        }
      }
    }

    if (member.status === 'license') {
      const licenseStartAt = timestampToDate(member.licenseStartAt);
      const licenseEndAt = timestampToDate(member.licenseEndAt) ?? (licenseStartAt ? addMonths(licenseStartAt, LICENSE_MAX_MONTHS) : null);
      if (!licenseEndAt) {
        continue;
      }

      const remainingLicenseDays = daysUntil(licenseEndAt, now);
      if (remainingLicenseDays >= 0 && remainingLicenseDays <= MEMBER_LIFECYCLE_LOOKAHEAD_DAYS) {
        const result = await emitRoleNotification({
          type: 'member_lifecycle_alert',
          sourceModule: 'users',
          sourceCollection: USERS_COLLECTIONS.members,
          sourceId: doc.id,
          title: 'Licencia próxima a revisión',
          body: `${displayName} está cerca del límite de licencia (${dateKey(licenseEndAt)}).`,
          severity: 'warning',
          roleIds: STAFF_NOTIFICATION_ROLE_IDS,
          deliveryScope: 'shared_role_action',
          route: `/admin/members/${doc.id}`,
          action: {
            key: 'members.review_lifecycle',
            label: 'Marcar revisión',
            requiresConfirmation: false,
            route: `/admin/members/${doc.id}`,
            payload: { memberId: doc.id, lifecycleKind: 'license_due' },
          },
          metadata: {
            lifecycleKind: 'license_due',
            memberId: doc.id,
            licenseLimitAt: licenseEndAt.toISOString(),
          },
          dedupeKey: `member-lifecycle:license-due:${doc.id}:${dateKey(licenseEndAt)}`,
          actorUid: 'system',
        });
        if (!result.duplicate) {
          emitted += 1;
        }
      }

      if (remainingLicenseDays < 0) {
        const result = await emitRoleNotification({
          type: 'member_lifecycle_alert',
          sourceModule: 'users',
          sourceCollection: USERS_COLLECTIONS.members,
          sourceId: doc.id,
          title: 'Licencia vencida para revisar',
          body: `${displayName} alcanzó el límite de licencia. Revisar pase a inactivo.`,
          severity: 'danger',
          roleIds: STAFF_NOTIFICATION_ROLE_IDS,
          deliveryScope: 'shared_role_action',
          route: `/admin/members/${doc.id}`,
          action: {
            key: 'members.review_lifecycle',
            label: 'Marcar revisión',
            requiresConfirmation: false,
            route: `/admin/members/${doc.id}`,
            payload: { memberId: doc.id, lifecycleKind: 'license_expired' },
          },
          metadata: {
            lifecycleKind: 'license_expired',
            memberId: doc.id,
            licenseLimitAt: licenseEndAt.toISOString(),
          },
          dedupeKey: `member-lifecycle:license-expired:${doc.id}:${dateKey(licenseEndAt)}`,
          actorUid: 'system',
        });
        if (!result.duplicate) {
          emitted += 1;
        }
      }
    }
  }

  return emitted;
}

export const notificationsScanMemberLifecycle = onSchedule(
  {
    schedule: 'every day 08:00',
    timeZone: 'America/Argentina/Buenos_Aires',
  },
  async () => {
    const emitted = await emitMembershipLifecycleNotifications();
    logger.info('notificationsScanMemberLifecycle completed', { emitted });
  },
);

export const notifications = {
  markRead: notificationsMarkRead,
  dismiss: notificationsDismiss,
  executeAction: notificationsExecuteAction,
  listAdmin: notificationsListAdmin,
  scanMemberLifecycle: notificationsScanMemberLifecycle,
};
