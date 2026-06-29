import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  approveTournamentRegistrationUseCase,
  parseApproveTournamentRegistrationInput,
  parseRecordTournamentRegistrationPaymentInput,
  parseRegisterExternalTournamentParticipantInput,
  parseRegisterTournamentParticipantInput,
  recordTournamentRegistrationPaymentUseCase,
  registerExternalTournamentParticipantUseCase,
  registerTournamentParticipantUseCase,
} from '../application/use-cases/registration.use-cases.js';
import { syncTournamentRegistrationWindowsUseCase } from '../application/use-cases/registration-window.use-cases.js';
import { resolveActor, toHttpsError } from '../../accounting/application/shared.js';
import type { Actor } from '../../accounting/domain/models.js';
import { FirestoreAccountingTransactionManager, SystemClock } from '../../accounting/infrastructure/firestore/repositories.js';
import {
  emitRoleNotification,
  emitUserNotification,
  formatAmountMinor,
  type NotificationRoleId,
} from '../../notifications/notifications.service.js';
import { FirestoreTournamentsTransactionManager } from '../infrastructure/firestore/repositories.js';

const STAFF_NOTIFICATION_ROLE_IDS: NotificationRoleId[] = ['administrativo', 'directivo'];
const PUBLIC_TOURNAMENT_USER_ID = 'external-public';
const clock = new SystemClock();
const accountingTransactions = new FirestoreAccountingTransactionManager(clock);
const tournamentTransactions = new FirestoreTournamentsTransactionManager();

async function getActorFromCallableRequest(
  auth:
    | {
        uid?: string;
        token?: Record<string, unknown>;
      }
    | undefined,
) {
  return resolveActor(
    accountingTransactions.getDataAccess(),
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

function isAppUserId(userId: string): boolean {
  return userId !== PUBLIC_TOURNAMENT_USER_ID && !userId.startsWith('external:');
}

async function safelyEmitTournamentNotification(functionName: string, handler: () => Promise<unknown>) {
  try {
    await handler();
  } catch (error) {
    logger.warn(`${functionName} notification failed`, error);
  }
}

export const tournamentsRegisterParticipant = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const result = await registerTournamentParticipantUseCase({
      actor,
      input: parseRegisterTournamentParticipantInput(request.data),
      transactions: tournamentTransactions,
      clock,
    });
    if (!result.duplicate && actor?.uid) {
      await safelyEmitTournamentNotification('tournamentsRegisterParticipant', () => emitUserNotification({
        type: 'tournament_registration_created',
        sourceModule: 'tournaments',
        sourceCollection: 'tournament_registrations',
        sourceId: result.registrationId,
        title: 'Inscripcion registrada',
        body: `Tu inscripcion a ${result.tournamentName} quedo registrada por ${formatAmountMinor(result.amountMinor)}.`,
        severity: 'info',
        userIds: [actor.uid],
        deliveryScope: 'per_user',
        route: '/torneos?open=registrations',
        metadata: {
          registrationId: result.registrationId,
          amountMinor: result.amountMinor,
          status: result.status,
        },
        dedupeKey: `tournament-registration-created-${result.registrationId}-${actor.uid}`,
        actorUid: actor.uid,
      }));
    }
    return result;
  } catch (error) {
    withCallableLogging('tournamentsRegisterParticipant', error);
  }
});

export const tournamentsRegisterExternalParticipant = onCall(async (request) => {
  try {
    const input = parseRegisterExternalTournamentParticipantInput(request.data);
    const result = await registerExternalTournamentParticipantUseCase({
      input,
      transactions: tournamentTransactions,
      clock,
    });
    if (!result.duplicate) {
      const phoneText = input.phone?.trim() ? ` Telefono: ${input.phone.trim()}.` : '';
      const licenseText = input.aagLicense?.trim() ? ` Matricula AAG: ${input.aagLicense.trim()}.` : '';
      await safelyEmitTournamentNotification('tournamentsRegisterExternalParticipant', () => emitRoleNotification({
        type: 'tournament_external_registration_contact_required',
        sourceModule: 'tournaments',
        sourceCollection: 'tournament_registrations',
        sourceId: result.registrationId,
        title: 'Contactar inscripcion externa',
        body: `${input.fullName.trim()} solicito inscribirse a ${result.tournamentName} por ${formatAmountMinor(result.amountMinor)}. Email: ${input.email.trim()}.${phoneText}${licenseText} Contactar para confirmar datos y aprobacion.`,
        severity: 'warning',
        roleIds: STAFF_NOTIFICATION_ROLE_IDS,
        deliveryScope: 'shared_role_action',
        route: '/torneos?open=registrations',
        action: {
          key: 'notifications.open_route',
          label: 'Marcar contacto',
          requiresConfirmation: false,
          route: '/torneos?open=registrations',
          payload: {
            registrationId: result.registrationId,
            tournamentName: result.tournamentName,
            participantName: input.fullName.trim(),
            participantEmail: input.email.trim(),
          },
        },
        metadata: {
          registrationId: result.registrationId,
          amountMinor: result.amountMinor,
          status: result.status,
          participantName: input.fullName.trim(),
          participantEmail: input.email.trim(),
          participantPhone: input.phone?.trim() || null,
          externalAagLicense: input.aagLicense?.trim() || null,
        },
        dedupeKey: `tournament-external-registration-contact-${result.registrationId}`,
        actorUid: 'public',
      }));
    }
    return result;
  } catch (error) {
    withCallableLogging('tournamentsRegisterExternalParticipant', error);
  }
});

export const tournamentsApproveRegistration = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const result = await approveTournamentRegistrationUseCase({
      actor,
      input: parseApproveTournamentRegistrationInput(request.data),
      transactions: tournamentTransactions,
      clock,
    });
    const notificationActorUid = (actor as Actor | null)?.uid ?? 'system';
    if (!result.duplicate && isAppUserId(result.userId)) {
      await safelyEmitTournamentNotification('tournamentsApproveRegistration', () => emitUserNotification({
        type: 'tournament_registration_approved',
        sourceModule: 'tournaments',
        sourceCollection: 'tournament_registrations',
        sourceId: result.registrationId,
        title: 'Inscripcion aprobada',
        body: `Tu inscripcion a ${result.tournamentName} fue aprobada y queda pendiente de pago.`,
        severity: 'success',
        userIds: [result.userId],
        deliveryScope: 'per_user',
        route: '/torneos?open=registrations',
        metadata: {
          registrationId: result.registrationId,
          status: result.status,
          paymentStatus: result.paymentStatus,
        },
        dedupeKey: `tournament-registration-approved-${result.registrationId}-${result.userId}`,
        actorUid: notificationActorUid,
      }));
    }
    return result;
  } catch (error) {
    withCallableLogging('tournamentsApproveRegistration', error);
  }
});

export const tournamentsRecordRegistrationPayment = onCall(async (request) => {
  try {
    const actor = await getActorFromCallableRequest(request.auth as { uid?: string; token?: Record<string, unknown> } | undefined);
    const result = await recordTournamentRegistrationPaymentUseCase({
      actor,
      input: parseRecordTournamentRegistrationPaymentInput(request.data),
      transactions: tournamentTransactions,
      clock,
    });
    const notificationActorUid = (actor as Actor | null)?.uid ?? 'system';
    if (!result.duplicate && isAppUserId(result.userId)) {
      await safelyEmitTournamentNotification('tournamentsRecordRegistrationPayment', () => emitUserNotification({
        type: 'tournament_registration_confirmed',
        sourceModule: 'tournaments',
        sourceCollection: 'tournament_registrations',
        sourceId: result.registrationId,
        title: 'Inscripcion confirmada',
        body: `Se registro el pago de tu inscripcion a ${result.tournamentName}. Recibo ${result.receiptNumber}.`,
        severity: 'success',
        userIds: [result.userId],
        deliveryScope: 'per_user',
        route: '/torneos?open=registrations',
        metadata: {
          registrationId: result.registrationId,
          receiptId: result.receiptId,
          receiptNumber: result.receiptNumber,
          movementId: result.movementId,
          netAmountMinor: result.netAmountMinor,
        },
        dedupeKey: `tournament-registration-confirmed-${result.registrationId}-${result.userId}`,
        actorUid: notificationActorUid,
      }));
    }
    return result;
  } catch (error) {
    withCallableLogging('tournamentsRecordRegistrationPayment', error);
  }
});

export const tournamentsSyncRegistrationWindows = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 120,
  },
  async () => {
    const result = await syncTournamentRegistrationWindowsUseCase({
      transactions: tournamentTransactions,
      clock,
    });
    logger.info('tournamentsSyncRegistrationWindows completed', result);
  },
);

export const tournaments = {
  approveRegistration: tournamentsApproveRegistration,
  registerExternalParticipant: tournamentsRegisterExternalParticipant,
  registerParticipant: tournamentsRegisterParticipant,
  recordRegistrationPayment: tournamentsRecordRegistrationPayment,
  syncRegistrationWindows: tournamentsSyncRegistrationWindows,
};
