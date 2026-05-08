import { HttpsError } from 'firebase-functions/v2/https';
import {
  ACCOUNTING_TIME_ZONE,
  ACCOUNTING_TIME_ZONE_OFFSET,
  DEFAULT_EARLY_PAYMENT_DISCOUNT_DAY_OF_MONTH,
  DEFAULT_EARLY_PAYMENT_DISCOUNT_PCT_BPS,
  MAX_PAGE_SIZE,
  MAX_BPS,
  MEMBERSHIP_RENEWAL_TERM_DAYS,
} from '../domain/constants.js';
import { AppError, assertCondition, isRecord } from '../domain/errors.js';
import type {
  AccountingPeriod,
  Actor,
  Bps,
  EntityWithId,
  FeePreview,
  FinancialConfigDocument,
  ReferencedMemberDocument,
} from '../domain/models.js';
import type { AccountingDataAccess, PageInput } from '../domain/ports.js';

export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) {
    return error;
  }

  if (error instanceof AppError) {
    return new HttpsError(error.code, error.message, error.details);
  }

  if (error instanceof Error) {
    return new HttpsError('internal', error.message);
  }

  return new HttpsError('internal', 'Unexpected error.');
}

export function ensureAuthenticatedActor(actor: Actor | null): Actor {
  assertCondition(actor, 'unauthenticated', 'Debes iniciar sesión para realizar esta operación.');
  return actor;
}

export function ensureDirectivo(actor: Actor | null): Actor {
  const authenticatedActor = ensureAuthenticatedActor(actor);
  const isDirectivo = authenticatedActor.user.roleIds.includes('directivo') && authenticatedActor.claims.directivo === true;
  assertCondition(authenticatedActor.user.active, 'permission-denied', 'El usuario no está activo.');
  assertCondition(isDirectivo, 'permission-denied', 'Solo un directivo puede realizar esta operación.');
  return authenticatedActor;
}

export function ensureStaff(actor: Actor | null): Actor {
  const authenticatedActor = ensureAuthenticatedActor(actor);
  const isAdministrative = authenticatedActor.user.roleIds.includes('administrativo') && authenticatedActor.claims.administrativo === true;
  const isDirectivo = authenticatedActor.user.roleIds.includes('directivo') && authenticatedActor.claims.directivo === true;
  assertCondition(authenticatedActor.user.active, 'permission-denied', 'El usuario no está activo.');
  assertCondition(isAdministrative || isDirectivo, 'permission-denied', 'Solo administrativo o directivo puede realizar esta operación.');
  return authenticatedActor;
}

export function ensureEmployeeOrStaff(actor: Actor | null): Actor {
  const authenticatedActor = ensureAuthenticatedActor(actor);
  const isEmployee = authenticatedActor.user.roleIds.includes('empleado') && authenticatedActor.claims.empleado === true;
  const isStaff = (authenticatedActor.user.roleIds.includes('administrativo') && authenticatedActor.claims.administrativo === true)
    || (authenticatedActor.user.roleIds.includes('directivo') && authenticatedActor.claims.directivo === true);
  assertCondition(authenticatedActor.user.active, 'permission-denied', 'El usuario no está activo.');
  assertCondition(isEmployee || isStaff, 'permission-denied', 'Solo empleados, administrativos o directivos pueden realizar esta operación.');
  return authenticatedActor;
}

export function assertIsRecord(value: unknown): Record<string, unknown> {
  assertCondition(isRecord(value), 'invalid-argument', 'El payload debe ser un objeto.');
  return value;
}

export function parseRequiredString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  assertCondition(typeof value === 'string' && value.trim().length > 0, 'invalid-argument', `El campo ${field} es obligatorio.`);
  return value.trim();
}

export function parseOptionalString(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  assertCondition(typeof value === 'string', 'invalid-argument', `El campo ${field} debe ser string.`);
  return value.trim();
}

export function parseOptionalNullableString(data: Record<string, unknown>, field: string): string | null | undefined {
  if (!(field in data)) {
    return undefined;
  }

  const value = data[field];
  if (value === null || value === '') {
    return null;
  }

  assertCondition(typeof value === 'string', 'invalid-argument', `El campo ${field} debe ser string o null.`);
  return value.trim();
}

export function parseRequiredBoolean(data: Record<string, unknown>, field: string): boolean {
  const value = data[field];
  assertCondition(typeof value === 'boolean', 'invalid-argument', `El campo ${field} debe ser boolean.`);
  return value;
}

export function parseOptionalBoolean(data: Record<string, unknown>, field: string): boolean | undefined {
  const value = data[field];
  if (value === undefined) {
    return undefined;
  }

  assertCondition(typeof value === 'boolean', 'invalid-argument', `El campo ${field} debe ser boolean.`);
  return value;
}

export function parseRequiredFiniteNumber(data: Record<string, unknown>, field: string): number {
  const value = data[field];
  assertCondition(typeof value === 'number' && Number.isFinite(value), 'invalid-argument', `El campo ${field} debe ser numérico.`);
  return value;
}

export function parseOptionalFiniteNumber(data: Record<string, unknown>, field: string): number | undefined {
  const value = data[field];
  if (value === undefined) {
    return undefined;
  }

  assertCondition(typeof value === 'number' && Number.isFinite(value), 'invalid-argument', `El campo ${field} debe ser numérico.`);
  return value;
}

export function parseRequiredInteger(data: Record<string, unknown>, field: string): number {
  const value = parseRequiredFiniteNumber(data, field);
  assertCondition(Number.isInteger(value), 'invalid-argument', `El campo ${field} debe ser entero.`);
  return value;
}

export function parseOptionalInteger(data: Record<string, unknown>, field: string): number | undefined {
  const value = parseOptionalFiniteNumber(data, field);
  if (value === undefined) {
    return undefined;
  }

  assertCondition(Number.isInteger(value), 'invalid-argument', `El campo ${field} debe ser entero.`);
  return value;
}

export function parseRequiredAmountMinor(data: Record<string, unknown>, field: string): number {
  const value = parseRequiredInteger(data, field);
  assertCondition(value >= 0, 'invalid-argument', `El campo ${field} no puede ser negativo.`);
  return value;
}

export function parseOptionalAmountMinor(data: Record<string, unknown>, field: string): number | undefined {
  const value = parseOptionalInteger(data, field);
  if (value === undefined) {
    return undefined;
  }

  assertCondition(value >= 0, 'invalid-argument', `El campo ${field} no puede ser negativo.`);
  return value;
}

export function parseRequiredBps(data: Record<string, unknown>, field: string): Bps {
  const value = parseRequiredInteger(data, field);
  validateBps(value, field);
  return value;
}

export function parseOptionalBps(data: Record<string, unknown>, field: string): Bps | undefined {
  const value = parseOptionalInteger(data, field);
  if (value === undefined) {
    return undefined;
  }

  validateBps(value, field);
  return value;
}

export function parseRequiredIsoDate(data: Record<string, unknown>, field: string): Date {
  return parseIsoDate(parseRequiredString(data, field), field);
}

export function parseOptionalIsoDate(data: Record<string, unknown>, field: string): Date | undefined {
  const value = parseOptionalString(data, field);
  return value ? parseIsoDate(value, field) : undefined;
}

export function parseOptionalNullableIsoDate(data: Record<string, unknown>, field: string): Date | null | undefined {
  if (!(field in data)) {
    return undefined;
  }

  const value = data[field];
  if (value === null || value === '') {
    return null;
  }

  assertCondition(typeof value === 'string', 'invalid-argument', `El campo ${field} debe ser fecha ISO o null.`);
  return parseIsoDate(value, field);
}

export function parseIsoDate(value: string, field: string): Date {
  const parsedDate = new Date(value);
  assertCondition(Number.isFinite(parsedDate.getTime()), 'invalid-argument', `El campo ${field} debe ser una fecha ISO válida.`);
  return parsedDate;
}

export function parseRequiredStringArray(data: Record<string, unknown>, field: string): string[] {
  const value = data[field];
  assertCondition(Array.isArray(value), 'invalid-argument', `El campo ${field} debe ser un arreglo.`);

  return Array.from(new Set(value.map((item) => {
    assertCondition(typeof item === 'string' && item.trim().length > 0, 'invalid-argument', `Todos los elementos de ${field} deben ser strings.`);
    return item.trim();
  })));
}

export function parseOptionalStringArray(data: Record<string, unknown>, field: string): string[] | undefined {
  if (!(field in data)) {
    return undefined;
  }

  return parseRequiredStringArray(data, field);
}

export function parseOptionalRecord(data: Record<string, unknown>, field: string): Record<string, unknown> | undefined {
  const value = data[field];
  if (value === undefined) {
    return undefined;
  }

  assertCondition(isRecord(value), 'invalid-argument', `El campo ${field} debe ser un objeto.`);
  return value;
}

export function parseRequiredAccountingPeriod(data: Record<string, unknown>, field: string): AccountingPeriod {
  const value = parseRequiredString(data, field);
  validateAccountingPeriod(value, field);
  return value;
}

export function parseOptionalAccountingPeriod(data: Record<string, unknown>, field: string): AccountingPeriod | undefined {
  const value = parseOptionalString(data, field);
  if (!value) {
    return undefined;
  }

  validateAccountingPeriod(value, field);
  return value;
}

export function parsePageInput(data: Record<string, unknown>): PageInput {
  const limit = parseOptionalInteger(data, 'limit');
  const cursorId = parseOptionalString(data, 'cursorId');

  if (limit !== undefined) {
    assertCondition(limit > 0 && limit <= MAX_PAGE_SIZE, 'invalid-argument', `El campo limit debe estar entre 1 y ${MAX_PAGE_SIZE}.`);
  }

  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(cursorId ? { cursorId } : {}),
  };
}

export function parseRequiredEnum<T extends string>(
  data: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = parseRequiredString(data, field) as T;
  assertCondition(allowed.includes(value), 'invalid-argument', `El campo ${field} debe ser uno de: ${allowed.join(', ')}.`);
  return value;
}

export function parseOptionalEnum<T extends string>(
  data: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const value = parseOptionalString(data, field) as T | undefined;
  if (!value) {
    return undefined;
  }

  assertCondition(allowed.includes(value), 'invalid-argument', `El campo ${field} debe ser uno de: ${allowed.join(', ')}.`);
  return value;
}

export function validateBps(value: number, field = 'bps'): asserts value is Bps {
  assertCondition(value >= 0 && value <= MAX_BPS, 'invalid-argument', `El campo ${field} debe estar entre 0 y ${MAX_BPS}.`);
}

export function validateAccountingPeriod(value: string, field = 'period'): asserts value is AccountingPeriod {
  assertCondition(/^\d{4}-(0[1-9]|1[0-2])$/.test(value), 'invalid-argument', `El campo ${field} debe tener formato YYYY-MM.`);
}

export function toAccountingPeriod(date: Date): AccountingPeriod {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function calculateAmountFromBps(baseAmountMinor: number, pctBps: Bps): number {
  return Math.round((baseAmountMinor * pctBps) / 10_000);
}

function getClubDatePart(date: Date, part: 'year' | 'month' | 'day'): number {
  const value = new Intl.DateTimeFormat('en-CA', {
    timeZone: ACCOUNTING_TIME_ZONE,
    [part]: '2-digit',
  }).format(date);
  return Number(value);
}

export function getClubDayOfMonth(date: Date): number {
  return getClubDatePart(date, 'day');
}

export function getClubDateStart(date: Date): Date {
  const year = getClubDatePart(date, 'year');
  const month = String(getClubDatePart(date, 'month')).padStart(2, '0');
  const day = String(getClubDatePart(date, 'day')).padStart(2, '0');
  return new Date(`${year}-${month}-${day}T00:00:00${ACCOUNTING_TIME_ZONE_OFFSET}`);
}

export function calculateEarlyPaymentDiscount(params: {
  chargeAmountMinor: number;
  config: EntityWithId<FinancialConfigDocument>;
  operationDate: Date;
}): {
  paidAmountMinor: number;
  discountPctBps: Bps;
  discountAmountMinor: number;
  qualifies: boolean;
} {
  const discountPctBps = params.config.earlyPaymentDiscountPctBps ?? DEFAULT_EARLY_PAYMENT_DISCOUNT_PCT_BPS;
  const discountDayOfMonth = params.config.earlyPaymentDiscountDayOfMonth ?? DEFAULT_EARLY_PAYMENT_DISCOUNT_DAY_OF_MONTH;
  const operationDay = getClubDayOfMonth(params.operationDate);
  const qualifies = discountPctBps > 0 && operationDay >= 1 && operationDay <= discountDayOfMonth;
  const discountAmountMinor = qualifies ? calculateAmountFromBps(params.chargeAmountMinor, discountPctBps) : 0;

  return {
    paidAmountMinor: Math.max(params.chargeAmountMinor - discountAmountMinor, 0),
    discountPctBps: qualifies ? discountPctBps : 0,
    discountAmountMinor,
    qualifies,
  };
}

export function calculateMembershipRenewalDueDate(paymentDate: Date): Date {
  const renewalDueDate = getClubDateStart(paymentDate);
  renewalDueDate.setUTCDate(renewalDueDate.getUTCDate() + MEMBERSHIP_RENEWAL_TERM_DAYS);
  return renewalDueDate;
}

export function getLicenseMaxEndDate(startAt: Date, maxLicenseMonths: number): Date {
  const limit = new Date(startAt);
  limit.setUTCMonth(limit.getUTCMonth() + maxLicenseMonths);
  return limit;
}

export function validateLicenseRange(startAt: Date, endAt: Date, maxLicenseMonths: number): void {
  assertCondition(endAt.getTime() >= startAt.getTime(), 'invalid-argument', 'La licencia debe terminar después de comenzar.');
  const maxEndDate = getLicenseMaxEndDate(startAt, maxLicenseMonths);
  assertCondition(endAt.getTime() <= maxEndDate.getTime(), 'failed-precondition', `La licencia no puede superar ${maxLicenseMonths} meses.`);
}

export function buildFeePreview(params: {
  member: EntityWithId<ReferencedMemberDocument>;
  config: EntityWithId<FinancialConfigDocument>;
  period: AccountingPeriod;
}): FeePreview {
  const { config, member, period } = params;
  const explanation: string[] = [`Configuración financiera v${config.version}.`];

  let appliedPctBps: Bps;
  switch (member.typeCodeSnapshot) {
    case 'pleno':
    case 'grupo_familiar_titular':
      appliedPctBps = 10_000;
      explanation.push('Socio pleno o titular de grupo familiar: 100%.');
      break;
    case 'grupo_familiar_asociado':
      appliedPctBps = config.familyAssociatePctBps;
      explanation.push(`Integrante de grupo familiar asociado: ${config.familyAssociatePctBps / 100}%.`);
      break;
    case 'vitalicio':
      appliedPctBps = config.lifetimePctBps;
      explanation.push(`Socio vitalicio: ${config.lifetimePctBps / 100}%.`);
      break;
    case 'menor':
      appliedPctBps = config.minorPctBps;
      explanation.push(`Socio menor: ${config.minorPctBps / 100}%.`);
      break;
    case 'licencia':
      appliedPctBps = config.licensePctBps;
      explanation.push('Socio en licencia: 0% según configuración.');
      break;
    default:
      appliedPctBps = 10_000;
      explanation.push(`Tipo ${member.typeCodeSnapshot} sin mapeo específico, se usa 100%.`);
      break;
  }

  if (member.status === 'license') {
    appliedPctBps = config.licensePctBps;
    explanation.push('Estado license activo: se aplica porcentaje de licencia.');
  }

  const finalAmountMinor = calculateAmountFromBps(config.fullMemberFeeMinor, appliedPctBps);
  const earlyPaymentDiscountPctBps = config.earlyPaymentDiscountPctBps ?? DEFAULT_EARLY_PAYMENT_DISCOUNT_PCT_BPS;
  const earlyPaymentDiscountDayOfMonth = config.earlyPaymentDiscountDayOfMonth ?? DEFAULT_EARLY_PAYMENT_DISCOUNT_DAY_OF_MONTH;
  if (earlyPaymentDiscountPctBps > 0) {
    explanation.push(`Pronto pago disponible: ${earlyPaymentDiscountPctBps / 100}% hasta el día ${earlyPaymentDiscountDayOfMonth}.`);
  }

  return {
    memberId: member.id,
    period,
    baseAmountMinor: config.fullMemberFeeMinor,
    appliedPctBps,
    finalAmountMinor,
    configVersion: config.version,
    billingMode: config.familyGroupBillingMode,
    memberTypeCodeSnapshot: member.typeCodeSnapshot,
    familyGroupId: member.familyGroupId ?? null,
    holderMemberId: member.isFamilyHolder ? member.id : null,
    explanation,
  };
}

export function ensureMemberCanBeBilled(params: {
  member: EntityWithId<ReferencedMemberDocument>;
  config: EntityWithId<FinancialConfigDocument>;
  forceAdministrativeExceptionReason?: string | null | undefined;
}): void {
  const { config, forceAdministrativeExceptionReason, member } = params;

  if (member.isFamilyHolder) {
    assertCondition(member.familyGroupId, 'failed-precondition', 'Un titular de grupo familiar debe tener familyGroupId.');
  }

  if (member.typeCodeSnapshot === 'menor' && !config.allowStandaloneMinor) {
    assertCondition(member.familyGroupId, 'failed-precondition', 'Los menores deben pertenecer a un grupo familiar.');
  }

  if (member.status === 'inactive' || member.status === 'suspended') {
    assertCondition(
      typeof forceAdministrativeExceptionReason === 'string' && forceAdministrativeExceptionReason.trim().length > 0,
      'failed-precondition',
      'No se puede generar cuota para socios inactivos o suspendidos sin excepción administrativa documentada.',
    );
  }
}

export async function resolveActor(
  dataAccess: AccountingDataAccess,
  authContext:
    | {
        uid?: string | undefined;
        token?: Record<string, unknown> | undefined;
      }
    | null
    | undefined,
): Promise<Actor | null> {
  const uid = authContext?.uid;
  if (!uid) {
    return null;
  }

  const user = await dataAccess.users.getById(uid);
  if (!user) {
    return null;
  }

  const token = authContext?.token ?? {};
  return {
    uid,
    claims: {
      directivo: token.directivo === true,
      administrativo: token.administrativo === true,
      empleado: token.empleado === true,
      socio: token.socio === true,
      claimsVersion: typeof token.claimsVersion === 'number' ? token.claimsVersion : user.claimsVersion,
    },
    user,
  };
}
