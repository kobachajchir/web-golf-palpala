import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {
  FINANCIAL_INCOME_CATEGORY_IDS,
  PAYMENT_METHOD_IDS,
  SYSTEM_ACTOR_UID,
} from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type {
  Actor,
  AmountMinor,
  EntityWithId,
  MercadoPagoCheckoutSessionDocument,
  MercadoPagoCheckoutSessionItem,
  MercadoPagoCheckoutSessionStatus,
  MercadoPagoCheckoutSourceType,
  ThirdPartyType,
} from '../../domain/models.js';
import type { AccountingDataAccess, AccountingTransactionManager, Clock } from '../../domain/ports.js';
import {
  assertIsRecord,
  calculateEarlyPaymentDiscount,
  calculateMembershipRenewalDueDate,
  ensureAuthenticatedActor,
  ensureStaff,
  parseOptionalAmountMinor,
  parseOptionalNullableString,
  parseOptionalRecord,
  parseRequiredAmountMinor,
  parseRequiredEnum,
  parseRequiredString,
  toClubAccountingPeriod,
} from '../shared.js';
import { createPostedMovement } from '../movement-helpers.js';

const MERCADO_PAGO_SOURCE_TYPES = [
  'member_fee_charge',
  'tournament_registration',
  'green_fee',
  'handicap_charge',
  'concession_charge',
  'advertising_charge',
  'manual_income',
] as const;

const ACTIVE_SESSION_STATUSES: readonly MercadoPagoCheckoutSessionStatus[] = [
  'creating',
  'ready',
  'pending',
  'approved',
];

export interface MercadoPagoCheckoutInputItem {
  sourceType: MercadoPagoCheckoutSourceType;
  sourceId?: string | null | undefined;
  memberId?: string | null | undefined;
  thirdPartyType?: ThirdPartyType | null | undefined;
  thirdPartyId?: string | null | undefined;
  categoryId?: string | null | undefined;
  description?: string | null | undefined;
  amountMinor?: AmountMinor | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateMercadoPagoCheckoutInput {
  items: MercadoPagoCheckoutInputItem[];
  notes?: string | null | undefined;
}

export interface MercadoPagoPreferenceItem {
  id: string;
  title: string;
  description?: string;
  quantity: 1;
  currency_id: 'ARS';
  unit_price: number;
}

export interface MercadoPagoPreferencePayload {
  items: MercadoPagoPreferenceItem[];
  external_reference: string;
  metadata: Record<string, unknown>;
  back_urls: {
    success: string;
    pending: string;
    failure: string;
  };
  auto_return: 'approved';
  notification_url: string;
  expires: boolean;
  expiration_date_from: string;
  expiration_date_to: string;
  payment_methods: {
    excluded_payment_types: Array<{ id: string }>;
    installments: number;
  };
}

export interface MercadoPagoPreferenceResult {
  preferenceId: string;
  checkoutUrl: string;
  rawResponse?: Record<string, unknown>;
}

export interface MercadoPagoPaymentSnapshot {
  paymentId: string;
  status: string;
  statusDetail?: string | null;
  externalReference?: string | null;
  merchantOrderId?: string | null;
  transactionAmountMinor: AmountMinor;
  netAmountMinor?: AmountMinor | null;
  feeAmountMinor?: AmountMinor | null;
  moneyReleaseDate?: string | null;
  paymentTypeId?: string | null;
  providerPaymentMethodId?: string | null;
  dateApproved?: string | null;
}

export interface MercadoPagoClient {
  createPreference(payload: MercadoPagoPreferencePayload): Promise<MercadoPagoPreferenceResult>;
  getPayment(paymentId: string): Promise<MercadoPagoPaymentSnapshot>;
}

export interface MercadoPagoPostedReceipt {
  movementId: string;
  memberId: string | null;
  amountMinor: AmountMinor;
  receiptNumber: string;
}

export interface MercadoPagoRuntimeConfig {
  appBaseUrl: string;
  webhookUrl: string;
}

function centsToMercadoPagoAmount(amountMinor: number): number {
  return Number((amountMinor / 100).toFixed(2));
}

function amountToMinor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  }
  return null;
}

function nowPlusMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function createStableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function getActorIsStaff(actor: Actor): boolean {
  const isAdministrative = actor.user.roleIds.includes('administrativo') && actor.claims.administrativo === true;
  const isExecutive =
    (actor.user.roleIds.includes('comite_ejecutivo') || actor.user.roleIds.includes('directivo')) &&
    (actor.claims.comite_ejecutivo === true || actor.claims.directivo === true);
  return isAdministrative || isExecutive;
}

function ensureActorCanPayItem(actor: Actor, item: MercadoPagoCheckoutSessionItem) {
  if (getActorIsStaff(actor)) {
    return;
  }

  assertCondition(
    actor.user.profileType === 'member' && actor.user.profileId && item.memberId === actor.user.profileId,
    'permission-denied',
    'Solo podés pagar cargos propios desde Mercado Pago.',
  );
}

function buildCheckoutIdempotencyKey(items: MercadoPagoCheckoutSessionItem[], actor: Actor): string {
  const normalizedItems = items
    .map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId ?? null,
      categoryId: item.categoryId,
      amountMinor: item.amountMinor,
      memberId: item.memberId ?? null,
    }))
    .sort((left, right) => `${left.sourceType}:${left.sourceId}`.localeCompare(`${right.sourceType}:${right.sourceId}`));

  return createStableHash({
    actorScope: getActorIsStaff(actor) ? 'staff' : actor.uid,
    items: normalizedItems,
  });
}

function buildSessionId(idempotencyKey: string): string {
  return `mp_${idempotencyKey.slice(0, 40)}`;
}

function normalizeMercadoPagoSessionStatus(payment: MercadoPagoPaymentSnapshot): MercadoPagoCheckoutSessionStatus {
  if (payment.status === 'approved') {
    return 'approved';
  }
  if (payment.status === 'pending' || payment.status === 'in_process') {
    return 'pending';
  }
  if (payment.status === 'rejected') {
    return 'rejected';
  }
  if (payment.status === 'cancelled') {
    return 'cancelled';
  }
  if (payment.status === 'refunded' || payment.status === 'charged_back') {
    return 'refunded';
  }
  return 'failed';
}

function buildReceiptNumber(operationDate: Date, movementId: string): string {
  const year = operationDate.getUTCFullYear();
  const month = String(operationDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(operationDate.getUTCDate()).padStart(2, '0');
  return `REC-${year}${month}${day}-${movementId.slice(0, 8).toUpperCase()}`;
}

async function assertMemberCanPay(dataAccess: AccountingDataAccess, memberId: string | null | undefined) {
  if (!memberId) {
    return;
  }
  const member = await dataAccess.members.getById(memberId);
  assertCondition(member, 'not-found', `No existe members/${memberId}.`);
  assertCondition(
    member.status !== 'inactive' && member.status !== 'suspended',
    'failed-precondition',
    'No se pueden crear pagos para socios dados de baja o suspendidos.',
  );
}

async function resolveCheckoutItem(params: {
  dataAccess: AccountingDataAccess;
  input: MercadoPagoCheckoutInputItem;
  actor: Actor;
  now: Date;
}): Promise<MercadoPagoCheckoutSessionItem> {
  const { dataAccess, input, actor, now } = params;

  if (input.sourceType === 'member_fee_charge') {
    assertCondition(input.sourceId, 'invalid-argument', 'sourceId es obligatorio para member_fee_charge.');
    const charge = await dataAccess.memberFeeCharges.getById(input.sourceId);
    assertCondition(charge, 'not-found', `No existe member_fee_charges/${input.sourceId}.`);
    assertCondition(
      charge.status === 'pending' || charge.status === 'overdue',
      'failed-precondition',
      'Solo se pueden pagar cuotas pendientes o vencidas.',
    );

    const memberId = charge.memberId ?? charge.holderMemberId ?? null;
    await assertMemberCanPay(dataAccess, memberId);
    const activeConfig = await dataAccess.financialConfigs.getActive();
    assertCondition(activeConfig, 'failed-precondition', 'No existe una configuración financiera activa.');
    const discount = calculateEarlyPaymentDiscount({
      chargeAmountMinor: charge.finalAmountMinor,
      config: activeConfig,
      chargePeriod: charge.period,
      operationDate: now,
    });

    return {
      sourceType: input.sourceType,
      sourceId: charge.id,
      memberId,
      thirdPartyType: 'member',
      thirdPartyId: memberId,
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
      description: `Cuota societaria ${charge.period}`,
      amountMinor: discount.paidAmountMinor,
      originCollection: 'member_fee_charges',
      originId: charge.id,
      metadata: {
        period: charge.period,
        originalFeeAmountMinor: charge.finalAmountMinor,
        earlyPaymentDiscountPctBps: discount.discountPctBps,
        earlyPaymentDiscountAmountMinor: discount.discountAmountMinor,
        paidWithinEarlyPaymentWindow: discount.qualifies,
        feePaymentAccountingPeriod: toClubAccountingPeriod(now),
      },
    };
  }

  if (input.sourceType === 'tournament_registration') {
    assertCondition(input.sourceId, 'invalid-argument', 'sourceId es obligatorio para tournament_registration.');
    const registration = await dataAccess.tournamentRegistrations.getById(input.sourceId);
    assertCondition(registration, 'not-found', `No existe tournament_registrations/${input.sourceId}.`);
    assertCondition(registration.status !== 'pending_approval', 'failed-precondition', 'La inscripción debe estar aprobada antes de cobrar.');
    assertCondition(registration.paymentStatus === 'unpaid', 'failed-precondition', 'La inscripción ya está pagada o no se puede cobrar.');
    await assertMemberCanPay(dataAccess, registration.memberId ?? null);

    return {
      sourceType: input.sourceType,
      sourceId: registration.id,
      memberId: registration.memberId ?? null,
      thirdPartyType: registration.memberId ? 'member' : 'external',
      thirdPartyId: registration.memberId ?? null,
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.tournamentRegistration,
      description: `Inscripción ${registration.tournamentNameSnapshot}`,
      amountMinor: registration.amountMinor,
      originCollection: 'tournament_registrations',
      originId: registration.id,
      metadata: {
        tournamentId: registration.tournamentId,
        tournamentName: registration.tournamentNameSnapshot,
      },
    };
  }

  if (input.sourceType === 'handicap_charge') {
    assertCondition(input.sourceId, 'invalid-argument', 'sourceId es obligatorio para handicap_charge.');
    const charge = await dataAccess.handicapCharges.getById(input.sourceId);
    assertCondition(charge, 'not-found', `No existe handicap_charges/${input.sourceId}.`);
    assertCondition(!charge.incomeMovementId && charge.status === 'pending_collection', 'failed-precondition', 'El handicap ya fue cobrado o no está pendiente.');
    await assertMemberCanPay(dataAccess, charge.memberId);

    return {
      sourceType: input.sourceType,
      sourceId: charge.id,
      memberId: charge.memberId,
      thirdPartyType: 'member',
      thirdPartyId: charge.memberId,
      categoryId: FINANCIAL_INCOME_CATEGORY_IDS.handicap,
      description: `Handicap ${charge.period}`,
      amountMinor: charge.collectionAmountMinor,
      originCollection: 'handicap_charges',
      originId: charge.id,
      metadata: {
        period: charge.period,
        associationName: charge.associationName,
      },
    };
  }

  if (input.sourceType === 'concession_charge') {
    ensureStaff(actor);
    assertCondition(input.sourceId, 'invalid-argument', 'sourceId es obligatorio para concession_charge.');
    const contract = await dataAccess.concessionContracts.getById(input.sourceId);
    assertCondition(contract, 'not-found', `No existe concession_contracts/${input.sourceId}.`);
    assertCondition(contract.isActive, 'failed-precondition', 'La concesión no está activa.');
    return {
      sourceType: input.sourceType,
      sourceId: contract.id,
      thirdPartyType: 'tenant',
      thirdPartyId: contract.id,
      categoryId: contract.kind === 'cantinero' ? FINANCIAL_INCOME_CATEGORY_IDS.concessionCantinero : FINANCIAL_INCOME_CATEGORY_IDS.concessionMonthly,
      description: contract.conceptName,
      amountMinor: contract.fixedMonthlyAmountMinor,
      originCollection: 'concession_contracts',
      originId: contract.id,
      metadata: {
        counterpartyName: contract.counterpartyName,
        kind: contract.kind,
      },
    };
  }

  if (input.sourceType === 'advertising_charge') {
    ensureStaff(actor);
    assertCondition(input.sourceId, 'invalid-argument', 'sourceId es obligatorio para advertising_charge.');
    const contract = await dataAccess.advertisingContracts.getById(input.sourceId);
    assertCondition(contract, 'not-found', `No existe advertising_contracts/${input.sourceId}.`);
    assertCondition(contract.isActive, 'failed-precondition', 'La publicidad no está activa.');
    return {
      sourceType: input.sourceType,
      sourceId: contract.id,
      thirdPartyType: 'advertiser',
      thirdPartyId: contract.id,
      categoryId: contract.kind === 'antenna' ? FINANCIAL_INCOME_CATEGORY_IDS.advertisingAntenna : FINANCIAL_INCOME_CATEGORY_IDS.advertisingBoard,
      description: `Publicidad ${contract.advertiserName}`,
      amountMinor: contract.amountMinor,
      originCollection: 'advertising_contracts',
      originId: contract.id,
      metadata: {
        advertiserName: contract.advertiserName,
        kind: contract.kind,
      },
    };
  }

  ensureStaff(actor);
  const categoryId = input.categoryId ?? (input.sourceType === 'green_fee' ? FINANCIAL_INCOME_CATEGORY_IDS.greenFee : null);
  assertCondition(categoryId, 'invalid-argument', 'categoryId es obligatorio para ingresos manuales o green fee.');
  const category = await dataAccess.financialIncomeCategories.getById(categoryId);
  assertCondition(category, 'not-found', `No existe financial_income_categories/${categoryId}.`);
  assertCondition(category.active, 'failed-precondition', `La categoría ${categoryId} está inactiva.`);
  const amountMinor = input.amountMinor ?? null;
  assertCondition(typeof amountMinor === 'number' && amountMinor > 0, 'invalid-argument', 'amountMinor es obligatorio y debe ser mayor a cero.');
  await assertMemberCanPay(dataAccess, input.memberId ?? null);

  return {
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    memberId: input.memberId ?? null,
    thirdPartyType: input.thirdPartyType ?? (input.memberId ? 'member' : 'external'),
    thirdPartyId: input.thirdPartyId ?? input.memberId ?? null,
    categoryId,
    description: input.description ?? category.name,
    amountMinor,
    originCollection: null,
    originId: input.sourceId ?? null,
    metadata: input.metadata,
  };
}

function buildPreferencePayload(params: {
  sessionId: string;
  session: MercadoPagoCheckoutSessionDocument;
  config: MercadoPagoRuntimeConfig;
}): MercadoPagoPreferencePayload {
  const returnBase = `${params.config.appBaseUrl.replace(/\/$/, '')}/payments/mercado-pago/return`;
  return {
    items: params.session.items.map((item) => ({
      id: `${item.sourceType}:${item.sourceId ?? item.categoryId}`,
      title: item.description,
      description: item.sourceType.replaceAll('_', ' '),
      quantity: 1,
      currency_id: 'ARS',
      unit_price: centsToMercadoPagoAmount(item.amountMinor),
    })),
    external_reference: params.session.externalReference,
    metadata: {
      sessionId: params.sessionId,
      source: 'web_golf_palpala',
      itemCount: params.session.items.length,
    },
    back_urls: {
      success: `${returnBase}/success?sessionId=${encodeURIComponent(params.sessionId)}`,
      pending: `${returnBase}/pending?sessionId=${encodeURIComponent(params.sessionId)}`,
      failure: `${returnBase}/failure?sessionId=${encodeURIComponent(params.sessionId)}`,
    },
    auto_return: 'approved',
    notification_url: `${params.config.webhookUrl}${params.config.webhookUrl.includes('?') ? '&' : '?'}source_news=webhooks`,
    expires: true,
    expiration_date_from: new Date().toISOString(),
    expiration_date_to: nowPlusMinutes(30),
    payment_methods: {
      excluded_payment_types: [{ id: 'ticket' }],
      installments: 1,
    },
  };
}

export async function createMercadoPagoCheckoutUseCase(params: {
  actor: Actor | null;
  input: CreateMercadoPagoCheckoutInput;
  transactions: AccountingTransactionManager;
  clock: Clock;
  mercadoPagoClient: MercadoPagoClient;
  runtimeConfig: MercadoPagoRuntimeConfig;
}): Promise<{
  sessionId: string;
  preferenceId: string | null;
  checkoutUrl: string | null;
  status: MercadoPagoCheckoutSessionStatus;
  reused: boolean;
}> {
  const actor = ensureAuthenticatedActor(params.actor);
  assertCondition(actor.user.active, 'permission-denied', 'El usuario no está activo.');
  assertCondition(params.input.items.length > 0, 'invalid-argument', 'Debes incluir al menos un ítem para cobrar.');

  const prepared = await params.transactions.runInTransaction(async (dataAccess) => {
    const resolvedItems: MercadoPagoCheckoutSessionItem[] = [];
    for (const item of params.input.items) {
      const resolved = await resolveCheckoutItem({
        dataAccess,
        input: item,
        actor,
        now: params.clock.now(),
      });
      ensureActorCanPayItem(actor, resolved);
      resolvedItems.push(resolved);
    }

    const grossAmountMinor = resolvedItems.reduce((total, item) => total + item.amountMinor, 0);
    assertCondition(grossAmountMinor > 0, 'failed-precondition', 'El total a cobrar debe ser mayor a cero.');
    const idempotencyKey = buildCheckoutIdempotencyKey(resolvedItems, actor);
    const sessionId = buildSessionId(idempotencyKey);
    const existing = await dataAccess.mercadoPagoCheckoutSessions.getById(sessionId);

    if (existing && ACTIVE_SESSION_STATUSES.includes(existing.status)) {
      return {
        sessionId,
        session: existing,
        reused: true,
      };
    }

    const session: MercadoPagoCheckoutSessionDocument = {
      items: resolvedItems,
      memberIds: Array.from(new Set(resolvedItems.map((item) => item.memberId).filter((memberId): memberId is string => Boolean(memberId)))),
      grossAmountMinor,
      currency: 'ARS',
      status: 'creating',
      preferenceId: null,
      checkoutUrl: null,
      paymentId: null,
      merchantOrderId: null,
      externalReference: sessionId,
      providerStatus: null,
      providerStatusDetail: null,
      financialMovementIds: [],
      idempotencyKey,
      createdByUid: actor.uid,
      notes: params.input.notes ?? null,
      createdAt: Timestamp.fromDate(params.clock.now()),
      createdBy: actor.uid,
      updatedAt: Timestamp.fromDate(params.clock.now()),
      updatedBy: actor.uid,
    };

    await dataAccess.mercadoPagoCheckoutSessions.set(sessionId, session, actor.uid);
    return {
      sessionId,
      session: { id: sessionId, ...session },
      reused: false,
    };
  });

  if (prepared.reused && prepared.session.preferenceId && prepared.session.checkoutUrl) {
    return {
      sessionId: prepared.sessionId,
      preferenceId: prepared.session.preferenceId,
      checkoutUrl: prepared.session.checkoutUrl,
      status: prepared.session.status,
      reused: true,
    };
  }

  const preferencePayload = buildPreferencePayload({
    sessionId: prepared.sessionId,
    session: prepared.session,
    config: params.runtimeConfig,
  });

  try {
    const preference = await params.mercadoPagoClient.createPreference(preferencePayload);
    await params.transactions.runInTransaction(async (dataAccess) => {
      await dataAccess.mercadoPagoCheckoutSessions.update(
        prepared.sessionId,
        {
          status: 'ready',
          preferenceId: preference.preferenceId,
          checkoutUrl: preference.checkoutUrl,
          providerStatus: 'preference_created',
          providerStatusDetail: null,
        },
        actor.uid,
      );
    });

    return {
      sessionId: prepared.sessionId,
      preferenceId: preference.preferenceId,
      checkoutUrl: preference.checkoutUrl,
      status: 'ready',
      reused: false,
    };
  } catch (error) {
    await params.transactions.runInTransaction(async (dataAccess) => {
      await dataAccess.mercadoPagoCheckoutSessions.update(
        prepared.sessionId,
        {
          status: 'failed',
          providerStatus: 'preference_failed',
          providerStatusDetail: error instanceof Error ? error.message : 'unknown_error',
        },
        actor.uid,
      );
    });
    throw error;
  }
}

export async function getMercadoPagoCheckoutStatusUseCase(params: {
  actor: Actor | null;
  sessionId: string;
  transactions: AccountingTransactionManager;
}): Promise<{
  session: EntityWithId<MercadoPagoCheckoutSessionDocument>;
  message: string;
}> {
  const actor = ensureAuthenticatedActor(params.actor);
  return params.transactions.runInTransaction(async (dataAccess) => {
    const session = await dataAccess.mercadoPagoCheckoutSessions.getById(params.sessionId);
    assertCondition(session, 'not-found', `No existe mercado_pago_checkout_sessions/${params.sessionId}.`);
    const canRead = getActorIsStaff(actor) || session.createdByUid === actor.uid || session.items.some((item) => item.memberId === actor.user.profileId);
    assertCondition(canRead, 'permission-denied', 'No tenés permiso para ver este checkout.');

    const message =
      session.status === 'approved'
        ? 'Pago acreditado y registrado en contabilidad.'
        : session.status === 'pending'
          ? 'Mercado Pago todavía está procesando el pago.'
          : session.status === 'rejected'
            ? 'Mercado Pago rechazó el pago.'
            : session.status === 'ready'
              ? 'Checkout listo para pagar.'
              : 'Estado de Mercado Pago actualizado.';

    return { session, message };
  });
}

async function updateSourceAfterApprovedPayment(params: {
  dataAccess: AccountingDataAccess;
  item: MercadoPagoCheckoutSessionItem;
  movementId: string;
  payment: MercadoPagoPaymentSnapshot;
  actorUid: string;
  operationDate: Date;
}) {
  const { dataAccess, item, movementId, payment, actorUid, operationDate } = params;

  if (item.sourceType === 'member_fee_charge' && item.sourceId) {
    const charge = await dataAccess.memberFeeCharges.getById(item.sourceId);
    if (charge?.status === 'paid' && charge.paidMovementId) {
      return;
    }
    await dataAccess.memberFeeCharges.update(
      item.sourceId,
      {
        status: 'paid',
        paidMovementId: movementId,
        paidAt: Timestamp.fromDate(operationDate),
        paidAmountMinor: item.amountMinor,
        paymentDiscountPctBps: typeof item.metadata?.earlyPaymentDiscountPctBps === 'number' ? item.metadata.earlyPaymentDiscountPctBps : 0,
        paymentDiscountAmountMinor: typeof item.metadata?.earlyPaymentDiscountAmountMinor === 'number' ? item.metadata.earlyPaymentDiscountAmountMinor : 0,
      },
      actorUid,
    );

    const memberId = item.memberId;
    if (memberId) {
      await dataAccess.members.update(
        memberId,
        {
          lastFeePaymentAt: Timestamp.fromDate(operationDate),
          membershipRenewalDueAt: Timestamp.fromDate(calculateMembershipRenewalDueDate(operationDate)),
          membershipRenewalStatus: 'current',
          lastFeePaidAmountMinor: item.amountMinor,
          lastFeeDiscountPctBps: typeof item.metadata?.earlyPaymentDiscountPctBps === 'number' ? item.metadata.earlyPaymentDiscountPctBps : 0,
          lastFeeDiscountAmountMinor: typeof item.metadata?.earlyPaymentDiscountAmountMinor === 'number' ? item.metadata.earlyPaymentDiscountAmountMinor : 0,
        },
        actorUid,
      );
    }
  }

  if (item.sourceType === 'tournament_registration' && item.sourceId) {
    await dataAccess.tournamentRegistrations.update(
      item.sourceId,
      {
        status: 'confirmed',
        paymentStatus: 'paid',
        financialMovementId: movementId,
        paidAt: Timestamp.fromDate(operationDate),
        paymentMethodId: PAYMENT_METHOD_IDS.mercadoPago,
        paymentReference: payment.paymentId,
      },
      actorUid,
    );
  }

  if (item.sourceType === 'handicap_charge' && item.sourceId) {
    const handicapCharge = await dataAccess.handicapCharges.getById(item.sourceId);
    if (!handicapCharge?.incomeMovementId) {
      await dataAccess.handicapCharges.update(
        item.sourceId,
        {
          incomeMovementId: movementId,
          status: 'collected',
        },
        actorUid,
      );
    }
  }
}

export async function postMercadoPagoApprovedCheckout(params: {
  dataAccess: AccountingDataAccess;
  session: EntityWithId<MercadoPagoCheckoutSessionDocument>;
  payment: MercadoPagoPaymentSnapshot;
  operationDate: Date;
  actorUid: string;
}): Promise<{ movementIds: string[]; receipts: MercadoPagoPostedReceipt[] }> {
  if (params.session.status === 'approved' && params.session.financialMovementIds.length > 0) {
    return { movementIds: params.session.financialMovementIds, receipts: [] };
  }

  const paymentMethod = await params.dataAccess.paymentMethods.getById(PAYMENT_METHOD_IDS.mercadoPago);
  assertCondition(paymentMethod, 'failed-precondition', 'No existe payment_methods/mercado_pago.');
  assertCondition(paymentMethod.active, 'failed-precondition', 'El medio Mercado Pago está inactivo.');

  const movementIds: string[] = [];
  const receipts: MercadoPagoPostedReceipt[] = [];
  const providerMetadata = {
    name: 'mercado_pago',
    paymentId: params.payment.paymentId,
    preferenceId: params.session.preferenceId ?? null,
    merchantOrderId: params.payment.merchantOrderId ?? params.session.merchantOrderId ?? null,
    externalReference: params.session.externalReference,
    status: params.payment.status,
    statusDetail: params.payment.statusDetail ?? null,
    moneyReleaseDate: params.payment.moneyReleaseDate ?? null,
    paymentTypeId: params.payment.paymentTypeId ?? null,
    providerPaymentMethodId: params.payment.providerPaymentMethodId ?? null,
  };
  const grossSessionAmountMinor = params.session.items.reduce((total, item) => total + item.amountMinor, 0);
  const providerFeeAmountMinor = params.payment.feeAmountMinor
    ?? (params.payment.netAmountMinor !== null && params.payment.netAmountMinor !== undefined
      ? Math.max(grossSessionAmountMinor - params.payment.netAmountMinor, 0)
      : null);
  let remainingProviderFeeMinor = providerFeeAmountMinor ?? 0;

  for (const [index, item] of params.session.items.entries()) {
    const category = await params.dataAccess.financialIncomeCategories.getById(item.categoryId);
    assertCondition(category, 'not-found', `No existe financial_income_categories/${item.categoryId}.`);
    const allocatedFeeAmountMinor = providerFeeAmountMinor === null
      ? null
      : index === params.session.items.length - 1
        ? remainingProviderFeeMinor
        : Math.round((providerFeeAmountMinor * item.amountMinor) / grossSessionAmountMinor);
    if (allocatedFeeAmountMinor !== null) {
      remainingProviderFeeMinor -= allocatedFeeAmountMinor;
    }

    const movement = await createPostedMovement({
      dataAccess: params.dataAccess,
      actorUid: params.actorUid,
      movementType: 'income',
      categoryId: item.categoryId,
      categoryCodeSnapshot: item.categoryId,
      grossAmountMinor: item.amountMinor,
      operationDate: params.operationDate,
      originType: item.sourceType,
      originCollection: item.originCollection ?? null,
      originId: item.originId ?? item.sourceId ?? null,
      thirdPartyType: item.thirdPartyType ?? null,
      thirdPartyId: item.thirdPartyId ?? null,
      paymentMethodId: PAYMENT_METHOD_IDS.mercadoPago,
      bancarizado: true,
      imputableImpositivo: true,
      metadata: {
        ...(item.metadata ?? {}),
        mercadoPagoSessionId: params.session.id,
        provider: providerMetadata,
      },
      notes: params.session.notes ?? null,
      netAmountMinorOverride: allocatedFeeAmountMinor === null ? undefined : item.amountMinor - allocatedFeeAmountMinor,
      appliedCommissionAmountMinorOverride: allocatedFeeAmountMinor ?? undefined,
    });

    movementIds.push(movement.movementId);
    const receiptNumber = buildReceiptNumber(params.operationDate, movement.movementId);
    await params.dataAccess.financialMovements.update(
      movement.movementId,
      {
        metadata: {
          ...(item.metadata ?? {}),
          mercadoPagoSessionId: params.session.id,
          paymentReference: params.payment.paymentId,
          receiptNumber,
          receiptIssuedAt: Timestamp.fromDate(params.operationDate),
          receiptSource: item.sourceType,
          specialReportingType: paymentMethod.specialReportingType ?? null,
          provider: providerMetadata,
        },
      },
      params.actorUid,
    );
    receipts.push({
      movementId: movement.movementId,
      memberId: item.memberId ?? null,
      amountMinor: item.amountMinor,
      receiptNumber,
    });
    await updateSourceAfterApprovedPayment({
      dataAccess: params.dataAccess,
      item,
      movementId: movement.movementId,
      payment: params.payment,
      actorUid: params.actorUid,
      operationDate: params.operationDate,
    });
  }

  await params.dataAccess.mercadoPagoCheckoutSessions.update(
    params.session.id,
    {
      status: 'approved',
      paymentId: params.payment.paymentId,
      merchantOrderId: params.payment.merchantOrderId ?? params.session.merchantOrderId ?? null,
      providerStatus: params.payment.status,
      providerStatusDetail: params.payment.statusDetail ?? null,
      financialMovementIds: movementIds,
    },
    params.actorUid,
  );

  return { movementIds, receipts };
}

export async function processMercadoPagoPaymentUseCase(params: {
  payment: MercadoPagoPaymentSnapshot;
  transactions: AccountingTransactionManager;
  clock: Clock;
}): Promise<{ sessionId: string | null; status: MercadoPagoCheckoutSessionStatus; movementIds: string[]; receipts: MercadoPagoPostedReceipt[] }> {
  const status = normalizeMercadoPagoSessionStatus(params.payment);
  return params.transactions.runInTransaction(async (dataAccess) => {
    const session = params.payment.externalReference
      ? await dataAccess.mercadoPagoCheckoutSessions.getByExternalReference(params.payment.externalReference)
      : await dataAccess.mercadoPagoCheckoutSessions.getByPaymentId(params.payment.paymentId);

    assertCondition(session, 'not-found', 'No encontramos una sesión de Mercado Pago para este pago.');

    if (status !== 'approved') {
      await dataAccess.mercadoPagoCheckoutSessions.update(
        session.id,
        {
          status,
          paymentId: params.payment.paymentId,
          merchantOrderId: params.payment.merchantOrderId ?? session.merchantOrderId ?? null,
          providerStatus: params.payment.status,
          providerStatusDetail: params.payment.statusDetail ?? null,
        },
        SYSTEM_ACTOR_UID,
      );
      return { sessionId: session.id, status, movementIds: session.financialMovementIds, receipts: [] };
    }

    const operationDate = params.payment.dateApproved ? new Date(params.payment.dateApproved) : params.clock.now();
    const posted = await postMercadoPagoApprovedCheckout({
      dataAccess,
      session,
      payment: params.payment,
      operationDate,
      actorUid: SYSTEM_ACTOR_UID,
    });
    return { sessionId: session.id, status: 'approved', movementIds: posted.movementIds, receipts: posted.receipts };
  });
}

export async function recordMercadoPagoEventUseCase(params: {
  eventId: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  payment: MercadoPagoPaymentSnapshot;
  transactions: AccountingTransactionManager;
  clock: Clock;
}): Promise<{ eventId: string; duplicate: boolean; processed: boolean; sessionId: string | null; movementIds: string[]; receipts: MercadoPagoPostedReceipt[] }> {
  return params.transactions.runInTransaction(async (dataAccess) => {
    const existing = await dataAccess.mercadoPagoEvents.getById(params.eventId);
    if (existing?.processed) {
      return {
        eventId: params.eventId,
        duplicate: true,
        processed: true,
        sessionId: params.payment.externalReference ?? null,
        movementIds: [],
        receipts: [],
      };
    }

    await dataAccess.mercadoPagoEvents.set(
      params.eventId,
      {
        eventId: params.eventId,
        type: typeof params.payload.type === 'string' ? params.payload.type : 'payment',
        action: typeof params.payload.action === 'string' ? params.payload.action : 'payment.updated',
        dataId: params.payment.paymentId,
        paymentId: params.payment.paymentId,
        merchantOrderId: params.payment.merchantOrderId ?? null,
        externalReference: params.payment.externalReference ?? null,
        payloadSnapshot: params.payload,
        headersSnapshot: params.headers,
        processed: false,
        processedAt: null,
        processingError: null,
      },
      SYSTEM_ACTOR_UID,
    );

    return {
      eventId: params.eventId,
      duplicate: false,
      processed: false,
      sessionId: null,
      movementIds: [],
      receipts: [],
    };
  }).then(async (eventResult) => {
    if (eventResult.duplicate) {
      return eventResult;
    }

    try {
      const processed = await processMercadoPagoPaymentUseCase({
        payment: params.payment,
        transactions: params.transactions,
        clock: params.clock,
      });
      await params.transactions.runInTransaction(async (dataAccess) => {
        await dataAccess.mercadoPagoEvents.update(
          params.eventId,
          {
            processed: true,
            processedAt: Timestamp.fromDate(params.clock.now()),
            processingError: null,
          },
          SYSTEM_ACTOR_UID,
        );
      });
      return {
        eventId: params.eventId,
        duplicate: false,
        processed: true,
        sessionId: processed.sessionId,
        movementIds: processed.movementIds,
        receipts: processed.receipts,
      };
    } catch (error) {
      await params.transactions.runInTransaction(async (dataAccess) => {
        await dataAccess.mercadoPagoEvents.update(
          params.eventId,
          {
            processed: false,
            processingError: error instanceof Error ? error.message : 'unknown_error',
          },
          SYSTEM_ACTOR_UID,
        );
      });
      throw error;
    }
  });
}

export async function reconcileMercadoPagoPaymentsUseCase(params: {
  transactions: AccountingTransactionManager;
  mercadoPagoClient: MercadoPagoClient;
  clock: Clock;
}): Promise<{ checked: number; updated: number; receipts: MercadoPagoPostedReceipt[] }> {
  const sessions = await params.transactions.getDataAccess().mercadoPagoCheckoutSessions.listPage({
    status: 'pending',
    limit: 25,
  });
  let updated = 0;
  const receipts: MercadoPagoPostedReceipt[] = [];

  for (const session of sessions.items) {
    if (!session.paymentId) {
      continue;
    }

    const payment = await params.mercadoPagoClient.getPayment(session.paymentId);
    const result = await processMercadoPagoPaymentUseCase({
      payment,
      transactions: params.transactions,
      clock: params.clock,
    });
    if (result.status !== session.status) {
      updated += 1;
    }
    receipts.push(...result.receipts);
  }

  return { checked: sessions.items.length, updated, receipts };
}

export function parseCreateMercadoPagoCheckoutInput(payload: unknown): CreateMercadoPagoCheckoutInput {
  const data = assertIsRecord(payload);
  const rawItems = data.items;
  const sourceType = data.sourceType;
  const sourceId = data.sourceId;
  const itemsInput = Array.isArray(rawItems)
    ? rawItems
    : sourceType
      ? [{ sourceType, sourceId, ...data }]
      : null;
  assertCondition(Array.isArray(itemsInput), 'invalid-argument', 'El campo items debe ser un arreglo.');

  return {
    items: itemsInput.map((rawItem) => {
      const item = assertIsRecord(rawItem);
      return {
        sourceType: parseRequiredEnum(item, 'sourceType', MERCADO_PAGO_SOURCE_TYPES),
        sourceId: parseOptionalNullableString(item, 'sourceId'),
        memberId: parseOptionalNullableString(item, 'memberId'),
        thirdPartyType: parseOptionalNullableString(item, 'thirdPartyType') as ThirdPartyType | null | undefined,
        thirdPartyId: parseOptionalNullableString(item, 'thirdPartyId'),
        categoryId: parseOptionalNullableString(item, 'categoryId'),
        description: parseOptionalNullableString(item, 'description'),
        amountMinor: parseOptionalAmountMinor(item, 'amountMinor') ?? null,
        metadata: parseOptionalRecord(item, 'metadata'),
      };
    }),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseGetMercadoPagoCheckoutStatusInput(payload: unknown): { sessionId: string } {
  const data = assertIsRecord(payload);
  return { sessionId: parseRequiredString(data, 'sessionId') };
}

export function parseMercadoPagoPaymentResponse(payload: Record<string, unknown>): MercadoPagoPaymentSnapshot {
  const paymentId = String(payload.id ?? '');
  assertCondition(paymentId.length > 0, 'invalid-argument', 'El pago de Mercado Pago no incluye id.');
  const transactionDetails = typeof payload.transaction_details === 'object' && payload.transaction_details !== null
    ? payload.transaction_details as Record<string, unknown>
    : {};
  const feeDetails = Array.isArray(payload.fee_details) ? payload.fee_details : [];
  const feeAmountMinor = feeDetails.reduce((total, detail) => {
    if (typeof detail !== 'object' || detail === null) {
      return total;
    }
    const amount = amountToMinor((detail as Record<string, unknown>).amount);
    return total + (amount ?? 0);
  }, 0);

  return {
    paymentId,
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    statusDetail: typeof payload.status_detail === 'string' ? payload.status_detail : null,
    externalReference: typeof payload.external_reference === 'string' ? payload.external_reference : null,
    merchantOrderId: typeof payload.order === 'object' && payload.order !== null
      ? String((payload.order as Record<string, unknown>).id ?? '')
      : null,
    transactionAmountMinor: amountToMinor(payload.transaction_amount) ?? 0,
    netAmountMinor: amountToMinor(transactionDetails.net_received_amount),
    feeAmountMinor: feeAmountMinor > 0 ? feeAmountMinor : null,
    moneyReleaseDate: typeof payload.money_release_date === 'string' ? payload.money_release_date : null,
    paymentTypeId: typeof payload.payment_type_id === 'string' ? payload.payment_type_id : null,
    providerPaymentMethodId: typeof payload.payment_method_id === 'string' ? payload.payment_method_id : null,
    dateApproved: typeof payload.date_approved === 'string' ? payload.date_approved : null,
  };
}

export function verifyMercadoPagoSignature(params: {
  dataId: string;
  xRequestId: string;
  xSignature: string;
  secret: string;
}): boolean {
  const entries = params.xSignature.split(',').map((part) => part.trim().split('='));
  const signatureParts = Object.fromEntries(entries.filter((entry) => entry.length === 2));
  const ts = signatureParts.ts;
  const v1 = signatureParts.v1;
  if (!ts || !v1 || !params.xRequestId || !params.dataId) {
    return false;
  }

  const manifest = `id:${params.dataId};request-id:${params.xRequestId};ts:${ts};`;
  const expected = createHmac('sha256', params.secret).update(manifest).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(v1);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}
