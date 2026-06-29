import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../../accounting/domain/constants.js';
import { assertCondition } from '../../../accounting/domain/errors.js';
import type { Actor } from '../../../accounting/domain/models.js';
import type { Clock } from '../../../accounting/domain/ports.js';
import {
  assertIsRecord,
  ensureAuthenticatedActor,
  ensureStaff,
  parseOptionalAmountMinor,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseRequiredIsoDate,
  parseRequiredString,
} from '../../../accounting/application/shared.js';
import { createPostedMovement } from '../../../accounting/application/movement-helpers.js';
import type {
  EntityWithId,
  TournamentDocument,
  TournamentPaymentMethodId,
  TournamentRegistrationDocument,
} from '../../domain/models.js';
import type { TournamentsTransactionManager } from '../../domain/ports.js';

const PUBLIC_TOURNAMENT_REGISTRATION_ACTOR_UID = 'public-tournament-registration';
const PUBLIC_TOURNAMENT_USER_ID = 'external-public';

const TOURNAMENT_PAYMENT_METHOD_IDS = [
  PAYMENT_METHOD_IDS.debitMacro,
  PAYMENT_METHOD_IDS.debit,
  PAYMENT_METHOD_IDS.transfer,
  PAYMENT_METHOD_IDS.credit,
  PAYMENT_METHOD_IDS.cash,
] as const;

export interface RegisterTournamentParticipantInput {
  tournamentId: string;
  memberId?: string | null | undefined;
  participantName?: string | null | undefined;
  participantEmail?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface RegisterExternalTournamentParticipantInput {
  tournamentId: string;
  fullName: string;
  email: string;
  phone?: string | null | undefined;
  handicap?: number | null | undefined;
  aagLicense?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface ApproveTournamentRegistrationInput {
  registrationId: string;
}

export interface RecordTournamentRegistrationPaymentInput {
  registrationId: string;
  paymentMethodId: TournamentPaymentMethodId;
  operationDate: Date;
  amountMinor?: number | undefined;
  paymentReference?: string | null | undefined;
  notes?: string | null | undefined;
}

type RegisterTournamentParticipantResult = {
  registrationId: string;
  duplicate: boolean;
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  status: TournamentRegistrationDocument['status'];
  amountMinor: number;
  tournamentName: string;
};

type ApproveTournamentRegistrationResult = {
  registrationId: string;
  duplicate: boolean;
  status: TournamentRegistrationDocument['status'];
  paymentStatus: TournamentRegistrationDocument['paymentStatus'];
  userId: string;
  tournamentName: string;
};

function actorHasStaffRole(actor: Actor): boolean {
  const isAdministrative = actor.user.roleIds.includes('administrativo') && actor.claims.administrativo === true;
  const isDirectivo =
    (actor.user.roleIds.includes('comite_ejecutivo') || actor.user.roleIds.includes('directivo')) &&
    (actor.claims.comite_ejecutivo === true || actor.claims.directivo === true);
  return isAdministrative || isDirectivo;
}

function parsePaymentMethodId(value: string): TournamentPaymentMethodId {
  assertCondition(
    (TOURNAMENT_PAYMENT_METHOD_IDS as readonly string[]).includes(value),
    'invalid-argument',
    'El medio de pago no es valido para una inscripcion de torneo.',
  );
  return value as TournamentPaymentMethodId;
}

function parseOptionalNullableFiniteNumber(data: Record<string, unknown>, field: string): number | null | undefined {
  if (!(field in data)) {
    return undefined;
  }

  const value = data[field];
  if (value === null || value === '') {
    return null;
  }

  assertCondition(typeof value === 'number' && Number.isFinite(value), 'invalid-argument', `El campo ${field} debe ser numerico o null.`);
  return value;
}

function buildReceiptNumber(params: { registrationId: string; operationDate: Date }): string {
  const year = params.operationDate.getUTCFullYear();
  const month = String(params.operationDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(params.operationDate.getUTCDate()).padStart(2, '0');
  return `TOR-${year}${month}${day}-${params.registrationId.slice(0, 8).toUpperCase()}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function buildRegistrationResult(params: {
  registrationId: string;
  registration: Pick<TournamentRegistrationDocument, 'paymentStatus' | 'status' | 'amountMinor' | 'tournamentNameSnapshot'>;
  duplicate: boolean;
}): RegisterTournamentParticipantResult {
  return {
    registrationId: params.registrationId,
    duplicate: params.duplicate,
    paymentStatus: params.registration.paymentStatus,
    status: params.registration.status,
    amountMinor: params.registration.amountMinor,
    tournamentName: params.registration.tournamentNameSnapshot,
  };
}

function parseTournamentDate(tournament: EntityWithId<TournamentDocument>): Date {
  const dateText = tournament.date.includes('T') ? tournament.date : `${tournament.date}T12:00:00.000Z`;
  const parsedDate = new Date(dateText);
  assertCondition(!Number.isNaN(parsedDate.getTime()), 'failed-precondition', `El torneo ${tournament.id} tiene una fecha invalida.`);
  return parsedDate;
}

export async function registerTournamentParticipantUseCase(params: {
  actor: Actor | null;
  input: RegisterTournamentParticipantInput;
  transactions: TournamentsTransactionManager;
  clock: Clock;
}): Promise<RegisterTournamentParticipantResult> {
  const actor = ensureAuthenticatedActor(params.actor);
  const isStaff = actorHasStaffRole(actor);
  assertCondition(actor.user.active, 'permission-denied', 'El usuario no esta activo.');

  if (!isStaff) {
    assertCondition(actor.user.profileType === 'member' && actor.user.profileId, 'permission-denied', 'Solo socios vinculados pueden inscribirse.');
  }

  const memberId = params.input.memberId ?? (actor.user.profileType === 'member' ? actor.user.profileId ?? null : null);
  if (!isStaff) {
    assertCondition(memberId === actor.user.profileId, 'permission-denied', 'Un socio solo puede inscribirse a si mismo.');
  }

  const participantName = params.input.participantName?.trim()
    || actor.user.displayName
    || 'Participante';

  return params.transactions.runInTransaction(async (dataAccess) => {
    const tournament = await dataAccess.tournaments.getById(params.input.tournamentId);
    assertCondition(tournament, 'not-found', `No existe tournaments/${params.input.tournamentId}.`);
    assertCondition(tournament.isDeleted !== true, 'not-found', `No existe tournaments/${params.input.tournamentId}.`);
    assertCondition(
      tournament.status === 'registration_open',
      'failed-precondition',
      'El torneo no tiene la inscripcion abierta.',
    );
    assertCondition(
      tournament.capacity <= 0 || tournament.registered < tournament.capacity,
      'failed-precondition',
      'El torneo no tiene cupos disponibles.',
    );
    assertCondition(!tournament.membersOnly || Boolean(memberId), 'failed-precondition', 'Este torneo es solo para socios.');

    const duplicate = await dataAccess.registrations.findDuplicate({
      tournamentId: params.input.tournamentId,
      userId: actor.uid,
      memberId,
    });

    if (duplicate) {
      return buildRegistrationResult({
        registrationId: duplicate.id,
        duplicate: true,
        registration: duplicate,
      });
    }

    const participantEmail = params.input.participantEmail ?? actor.user.email ?? null;
    const registrationDocument = {
      tournamentId: tournament.id,
      tournamentNameSnapshot: tournament.name,
      tournamentDate: Timestamp.fromDate(parseTournamentDate(tournament)),
      userId: actor.uid,
      memberId,
      participantName,
      participantEmail,
      participantEmailNormalized: participantEmail ? normalizeEmail(participantEmail) : null,
      origin: 'member' as const,
      approvalStatus: 'not_required' as const,
      externalPhone: null,
      externalHandicap: null,
      externalAagLicense: null,
      amountMinor: tournament.registrationFeeMinor,
      status: 'pending_payment' as const,
      paymentStatus: 'unpaid' as const,
      receiptId: null,
      financialMovementId: null,
      registeredAt: Timestamp.fromDate(params.clock.now()),
      approvedAt: null,
      approvedByUid: null,
      paidAt: null,
      paymentMethodId: null,
      paymentReference: null,
      notes: params.input.notes ?? null,
    };

    const registrationId = await dataAccess.registrations.create(registrationDocument, actor.uid);

    await dataAccess.tournaments.update(
      tournament.id,
      {
        registered: tournament.registered + 1,
      },
      actor.uid,
    );

    return buildRegistrationResult({
      registrationId,
      duplicate: false,
      registration: registrationDocument,
    });
  });
}

export async function registerExternalTournamentParticipantUseCase(params: {
  input: RegisterExternalTournamentParticipantInput;
  transactions: TournamentsTransactionManager;
  clock: Clock;
}): Promise<RegisterTournamentParticipantResult> {
  const participantName = params.input.fullName.trim();
  const participantEmail = normalizeEmail(params.input.email);
  assertCondition(participantName.length > 0, 'invalid-argument', 'El nombre del participante es obligatorio.');
  assertCondition(participantEmail.length > 0, 'invalid-argument', 'El email del participante es obligatorio.');

  return params.transactions.runInTransaction(async (dataAccess) => {
    const tournament = await dataAccess.tournaments.getById(params.input.tournamentId);
    assertCondition(tournament, 'not-found', `No existe tournaments/${params.input.tournamentId}.`);
    assertCondition(tournament.isDeleted !== true, 'not-found', `No existe tournaments/${params.input.tournamentId}.`);
    assertCondition(
      tournament.status === 'registration_open',
      'failed-precondition',
      'El torneo no tiene la inscripcion abierta.',
    );
    assertCondition(!tournament.membersOnly, 'failed-precondition', 'Este torneo es solo para socios.');

    const duplicate = await dataAccess.registrations.findExternalDuplicate({
      tournamentId: params.input.tournamentId,
      participantEmailNormalized: participantEmail,
    });

    if (duplicate) {
      return buildRegistrationResult({
        registrationId: duplicate.id,
        duplicate: true,
        registration: duplicate,
      });
    }

    const registrationDocument = {
      tournamentId: tournament.id,
      tournamentNameSnapshot: tournament.name,
      tournamentDate: Timestamp.fromDate(parseTournamentDate(tournament)),
      userId: PUBLIC_TOURNAMENT_USER_ID,
      memberId: null,
      participantName,
      participantEmail,
      participantEmailNormalized: participantEmail,
      origin: 'external' as const,
      approvalStatus: 'pending' as const,
      externalPhone: params.input.phone?.trim() || null,
      externalHandicap: params.input.handicap ?? null,
      externalAagLicense: params.input.aagLicense?.trim() || null,
      amountMinor: tournament.registrationFeeMinor,
      status: 'pending_approval' as const,
      paymentStatus: 'unpaid' as const,
      receiptId: null,
      financialMovementId: null,
      registeredAt: Timestamp.fromDate(params.clock.now()),
      approvedAt: null,
      approvedByUid: null,
      paidAt: null,
      paymentMethodId: null,
      paymentReference: null,
      notes: params.input.notes ?? null,
    };

    const registrationId = await dataAccess.registrations.create(
      registrationDocument,
      PUBLIC_TOURNAMENT_REGISTRATION_ACTOR_UID,
    );

    return buildRegistrationResult({
      registrationId,
      duplicate: false,
      registration: registrationDocument,
    });
  });
}

export async function approveTournamentRegistrationUseCase(params: {
  actor: Actor | null;
  input: ApproveTournamentRegistrationInput;
  transactions: TournamentsTransactionManager;
  clock: Clock;
}): Promise<ApproveTournamentRegistrationResult> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const registration = await dataAccess.registrations.getById(params.input.registrationId);
    assertCondition(registration, 'not-found', `No existe tournament_registrations/${params.input.registrationId}.`);

    if (registration.approvalStatus === 'approved' && registration.status !== 'pending_approval') {
      return {
        registrationId: registration.id,
        duplicate: true,
        status: registration.status,
        paymentStatus: registration.paymentStatus,
        userId: registration.userId,
        tournamentName: registration.tournamentNameSnapshot,
      };
    }

    assertCondition(
      registration.status === 'pending_approval',
      'failed-precondition',
      'Solo se pueden aprobar inscripciones pendientes de aprobacion.',
    );

    const tournament = await dataAccess.tournaments.getById(registration.tournamentId);
    assertCondition(tournament, 'not-found', `No existe tournaments/${registration.tournamentId}.`);
    assertCondition(tournament.isDeleted !== true, 'not-found', `No existe tournaments/${registration.tournamentId}.`);
    assertCondition(
      tournament.capacity <= 0 || tournament.registered < tournament.capacity,
      'failed-precondition',
      'El torneo no tiene cupos disponibles para aprobar esta inscripcion.',
    );

    await dataAccess.registrations.update(
      registration.id,
      {
        status: 'pending_payment',
        approvalStatus: 'approved',
        approvedAt: Timestamp.fromDate(params.clock.now()),
        approvedByUid: actor.uid,
      },
      actor.uid,
    );

    await dataAccess.tournaments.update(
      tournament.id,
      {
        registered: tournament.registered + 1,
      },
      actor.uid,
    );

    return {
      registrationId: registration.id,
      duplicate: false,
      status: 'pending_payment',
      paymentStatus: registration.paymentStatus,
      userId: registration.userId,
      tournamentName: registration.tournamentNameSnapshot,
    };
  });
}

export async function recordTournamentRegistrationPaymentUseCase(params: {
  actor: Actor | null;
  input: RecordTournamentRegistrationPaymentInput;
  transactions: TournamentsTransactionManager;
  clock: Clock;
}): Promise<{
  registrationId: string;
  receiptId: string;
  receiptNumber: string;
  movementId: string;
  netAmountMinor: number;
  duplicate: boolean;
  userId: string;
  tournamentName: string;
}> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runWithAccountingInTransaction(params.clock, async (dataAccess, accountingDataAccess) => {
    const registration = await dataAccess.registrations.getById(params.input.registrationId);
    assertCondition(registration, 'not-found', `No existe tournament_registrations/${params.input.registrationId}.`);

    if (registration.paymentStatus === 'paid' && registration.receiptId && registration.financialMovementId) {
      const receipt = await dataAccess.receipts.getById(registration.receiptId);
      return {
        registrationId: registration.id,
        receiptId: registration.receiptId,
        receiptNumber: receipt?.receiptNumber ?? buildReceiptNumber({ registrationId: registration.id, operationDate: params.input.operationDate }),
        movementId: registration.financialMovementId,
        netAmountMinor: registration.amountMinor,
        duplicate: true,
        userId: registration.userId,
        tournamentName: registration.tournamentNameSnapshot,
      };
    }

    assertCondition(
      registration.status !== 'pending_approval',
      'failed-precondition',
      'La inscripcion debe estar aprobada por administracion antes de registrar el pago.',
    );
    assertCondition(
      registration.paymentStatus === 'unpaid',
      'failed-precondition',
      'Solo se puede registrar pago sobre inscripciones impagas.',
    );

    const paymentMethod = await accountingDataAccess.paymentMethods.getById(params.input.paymentMethodId);
    assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.input.paymentMethodId}.`);
    assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.input.paymentMethodId} esta inactivo.`);
    const paymentReference = params.input.paymentReference?.trim() || null;
    assertCondition(
      paymentMethod.id === PAYMENT_METHOD_IDS.cash || Boolean(paymentReference),
      'invalid-argument',
      'La referencia de pago es obligatoria para medios distintos de efectivo.',
    );

    const category = await accountingDataAccess.financialIncomeCategories.getById(FINANCIAL_INCOME_CATEGORY_IDS.tournamentRegistration);
    assertCondition(category, 'not-found', 'No existe la categoria contable tournament_registration.');
    assertCondition(category.active, 'failed-precondition', 'La categoria contable tournament_registration esta inactiva.');

    const amountMinor = params.input.amountMinor ?? registration.amountMinor;
    const receiptNumber = buildReceiptNumber({
      registrationId: registration.id,
      operationDate: params.input.operationDate,
    });

    const movement = await createPostedMovement({
      dataAccess: accountingDataAccess,
      actorUid: actor.uid,
      movementType: 'income',
      categoryId: category.id,
      categoryCodeSnapshot: category.id,
      grossAmountMinor: amountMinor,
      operationDate: params.input.operationDate,
      originType: 'tournament_registration',
      originCollection: 'tournament_registrations',
      originId: registration.id,
      thirdPartyType: registration.memberId ? 'member' : 'external',
      thirdPartyId: registration.memberId ?? null,
      paymentMethodId: paymentMethod.id,
      bancarizado: paymentMethod.bancarizado,
      imputableImpositivo: true,
      metadata: {
        tournamentId: registration.tournamentId,
        tournamentName: registration.tournamentNameSnapshot,
        receiptNumber,
        ...(paymentReference ? { paymentReference } : {}),
        specialReportingType: paymentMethod.specialReportingType ?? null,
      },
      notes: params.input.notes ?? null,
      applyPaymentCommission: paymentMethod.id === PAYMENT_METHOD_IDS.credit,
    });

    const receiptId = await dataAccess.receipts.create(
      {
        registrationId: registration.id,
        tournamentId: registration.tournamentId,
        tournamentNameSnapshot: registration.tournamentNameSnapshot,
        memberId: registration.memberId ?? null,
        userId: registration.userId,
        receiptNumber,
        amountMinor,
        paymentMethodId: paymentMethod.id as TournamentPaymentMethodId,
        paymentReference,
        movementId: movement.movementId,
        issuedAt: Timestamp.fromDate(params.input.operationDate),
        issuedByUid: actor.uid,
        status: 'issued',
        notes: params.input.notes ?? null,
        metadata: {
          netAmountMinor: movement.netAmountMinor,
          appliedCommissionPctBps: movement.appliedCommissionPctBps,
          appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
        },
      },
      actor.uid,
    );

    // TODO(notifications): notificar al socio/invitado con el recibo emitido cuando el modulo de notificaciones este conectado.
    await dataAccess.registrations.update(
      registration.id,
      {
        status: 'confirmed',
        paymentStatus: 'paid',
        receiptId,
        financialMovementId: movement.movementId,
        paidAt: Timestamp.fromDate(params.input.operationDate),
        paymentMethodId: paymentMethod.id as TournamentPaymentMethodId,
        paymentReference,
      },
      actor.uid,
    );

    return {
      registrationId: registration.id,
      receiptId,
      receiptNumber,
      movementId: movement.movementId,
      netAmountMinor: movement.netAmountMinor,
      duplicate: false,
      userId: registration.userId,
      tournamentName: registration.tournamentNameSnapshot,
    };
  });
}

export function parseRegisterTournamentParticipantInput(payload: unknown): RegisterTournamentParticipantInput {
  const data = assertIsRecord(payload);

  return {
    tournamentId: parseRequiredString(data, 'tournamentId'),
    memberId: parseOptionalNullableString(data, 'memberId'),
    participantName: parseOptionalNullableString(data, 'participantName'),
    participantEmail: parseOptionalNullableString(data, 'participantEmail'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseRegisterExternalTournamentParticipantInput(payload: unknown): RegisterExternalTournamentParticipantInput {
  const data = assertIsRecord(payload);

  return {
    tournamentId: parseRequiredString(data, 'tournamentId'),
    fullName: parseRequiredString(data, 'fullName'),
    email: parseRequiredString(data, 'email'),
    phone: parseOptionalNullableString(data, 'phone'),
    handicap: parseOptionalNullableFiniteNumber(data, 'handicap') ?? null,
    aagLicense: parseOptionalNullableString(data, 'aagLicense'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseApproveTournamentRegistrationInput(payload: unknown): ApproveTournamentRegistrationInput {
  const data = assertIsRecord(payload);

  return {
    registrationId: parseRequiredString(data, 'registrationId'),
  };
}

export function parseRecordTournamentRegistrationPaymentInput(payload: unknown): RecordTournamentRegistrationPaymentInput {
  const data = assertIsRecord(payload);
  const paymentMethodId = parsePaymentMethodId(parseRequiredString(data, 'paymentMethodId'));

  return {
    registrationId: parseRequiredString(data, 'registrationId'),
    paymentMethodId,
    operationDate: parseOptionalIsoDate(data, 'operationDate') ?? parseRequiredIsoDate(data, 'operationDate'),
    amountMinor: parseOptionalAmountMinor(data, 'amountMinor'),
    paymentReference: parseOptionalNullableString(data, 'paymentReference'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}
