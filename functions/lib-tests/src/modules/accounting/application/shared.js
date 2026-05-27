import { HttpsError } from 'firebase-functions/v2/https';
import { ACCOUNTING_TIME_ZONE, ACCOUNTING_TIME_ZONE_OFFSET, DEFAULT_EARLY_PAYMENT_DISCOUNT_DAY_OF_MONTH, DEFAULT_EARLY_PAYMENT_DISCOUNT_PCT_BPS, MAX_PAGE_SIZE, MAX_BPS, } from '../domain/constants.js';
import { AppError, assertCondition, isRecord } from '../domain/errors.js';
export function toHttpsError(error) {
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
export function ensureAuthenticatedActor(actor) {
    assertCondition(actor, 'unauthenticated', 'Debes iniciar sesión para realizar esta operación.');
    return actor;
}
export function hasExecutiveAccess(actor) {
    const hasExecutiveRole = actor.user.roleIds.includes('comite_ejecutivo') ||
        actor.user.roleIds.includes('directivo');
    const hasExecutiveClaim = actor.claims.comite_ejecutivo === true ||
        actor.claims.directivo === true;
    return actor.user.active && hasExecutiveRole && hasExecutiveClaim;
}
export function ensureDirectivo(actor) {
    const authenticatedActor = ensureAuthenticatedActor(actor);
    assertCondition(authenticatedActor.user.active, 'permission-denied', 'El usuario no está activo.');
    assertCondition(hasExecutiveAccess(authenticatedActor), 'permission-denied', 'Solo el Comité Ejecutivo puede realizar esta operación.');
    return authenticatedActor;
}
export function ensureStaff(actor) {
    const authenticatedActor = ensureAuthenticatedActor(actor);
    const isAdministrative = authenticatedActor.user.roleIds.includes('administrativo') && authenticatedActor.claims.administrativo === true;
    assertCondition(authenticatedActor.user.active, 'permission-denied', 'El usuario no está activo.');
    assertCondition(isAdministrative || hasExecutiveAccess(authenticatedActor), 'permission-denied', 'Solo administrativo o Comité Ejecutivo puede realizar esta operación.');
    return authenticatedActor;
}
export function ensureEmployeeOrStaff(actor) {
    const authenticatedActor = ensureAuthenticatedActor(actor);
    const isEmployee = authenticatedActor.user.roleIds.includes('empleado') && authenticatedActor.claims.empleado === true;
    const isStaff = (authenticatedActor.user.roleIds.includes('administrativo') && authenticatedActor.claims.administrativo === true)
        || hasExecutiveAccess(authenticatedActor);
    assertCondition(authenticatedActor.user.active, 'permission-denied', 'El usuario no está activo.');
    assertCondition(isEmployee || isStaff, 'permission-denied', 'Solo empleados, administrativos o Comité Ejecutivo pueden realizar esta operación.');
    return authenticatedActor;
}
export function assertIsRecord(value) {
    assertCondition(isRecord(value), 'invalid-argument', 'El payload debe ser un objeto.');
    return value;
}
export function parseRequiredString(data, field) {
    const value = data[field];
    assertCondition(typeof value === 'string' && value.trim().length > 0, 'invalid-argument', `El campo ${field} es obligatorio.`);
    return value.trim();
}
export function parseOptionalString(data, field) {
    const value = data[field];
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    assertCondition(typeof value === 'string', 'invalid-argument', `El campo ${field} debe ser string.`);
    return value.trim();
}
export function parseOptionalNullableString(data, field) {
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
export function parseRequiredBoolean(data, field) {
    const value = data[field];
    assertCondition(typeof value === 'boolean', 'invalid-argument', `El campo ${field} debe ser boolean.`);
    return value;
}
export function parseOptionalBoolean(data, field) {
    const value = data[field];
    if (value === undefined) {
        return undefined;
    }
    assertCondition(typeof value === 'boolean', 'invalid-argument', `El campo ${field} debe ser boolean.`);
    return value;
}
export function parseRequiredFiniteNumber(data, field) {
    const value = data[field];
    assertCondition(typeof value === 'number' && Number.isFinite(value), 'invalid-argument', `El campo ${field} debe ser numérico.`);
    return value;
}
export function parseOptionalFiniteNumber(data, field) {
    const value = data[field];
    if (value === undefined) {
        return undefined;
    }
    assertCondition(typeof value === 'number' && Number.isFinite(value), 'invalid-argument', `El campo ${field} debe ser numérico.`);
    return value;
}
export function parseRequiredInteger(data, field) {
    const value = parseRequiredFiniteNumber(data, field);
    assertCondition(Number.isInteger(value), 'invalid-argument', `El campo ${field} debe ser entero.`);
    return value;
}
export function parseOptionalInteger(data, field) {
    const value = parseOptionalFiniteNumber(data, field);
    if (value === undefined) {
        return undefined;
    }
    assertCondition(Number.isInteger(value), 'invalid-argument', `El campo ${field} debe ser entero.`);
    return value;
}
export function parseRequiredAmountMinor(data, field) {
    const value = parseRequiredInteger(data, field);
    assertCondition(value >= 0, 'invalid-argument', `El campo ${field} no puede ser negativo.`);
    return value;
}
export function parseOptionalAmountMinor(data, field) {
    const value = parseOptionalInteger(data, field);
    if (value === undefined) {
        return undefined;
    }
    assertCondition(value >= 0, 'invalid-argument', `El campo ${field} no puede ser negativo.`);
    return value;
}
export function parseRequiredBps(data, field) {
    const value = parseRequiredInteger(data, field);
    validateBps(value, field);
    return value;
}
export function parseOptionalBps(data, field) {
    const value = parseOptionalInteger(data, field);
    if (value === undefined) {
        return undefined;
    }
    validateBps(value, field);
    return value;
}
export function parseRequiredIsoDate(data, field) {
    return parseIsoDate(parseRequiredString(data, field), field);
}
export function parseOptionalIsoDate(data, field) {
    const value = parseOptionalString(data, field);
    return value ? parseIsoDate(value, field) : undefined;
}
export function parseOptionalNullableIsoDate(data, field) {
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
export function parseIsoDate(value, field) {
    const parsedDate = new Date(value);
    assertCondition(Number.isFinite(parsedDate.getTime()), 'invalid-argument', `El campo ${field} debe ser una fecha ISO válida.`);
    return parsedDate;
}
export function parseRequiredStringArray(data, field) {
    const value = data[field];
    assertCondition(Array.isArray(value), 'invalid-argument', `El campo ${field} debe ser un arreglo.`);
    return Array.from(new Set(value.map((item) => {
        assertCondition(typeof item === 'string' && item.trim().length > 0, 'invalid-argument', `Todos los elementos de ${field} deben ser strings.`);
        return item.trim();
    })));
}
export function parseOptionalStringArray(data, field) {
    if (!(field in data)) {
        return undefined;
    }
    return parseRequiredStringArray(data, field);
}
export function parseOptionalRecord(data, field) {
    const value = data[field];
    if (value === undefined) {
        return undefined;
    }
    assertCondition(isRecord(value), 'invalid-argument', `El campo ${field} debe ser un objeto.`);
    return value;
}
export function parseRequiredAccountingPeriod(data, field) {
    const value = parseRequiredString(data, field);
    validateAccountingPeriod(value, field);
    return value;
}
export function parseOptionalAccountingPeriod(data, field) {
    const value = parseOptionalString(data, field);
    if (!value) {
        return undefined;
    }
    validateAccountingPeriod(value, field);
    return value;
}
export function parsePageInput(data) {
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
export function parseRequiredEnum(data, field, allowed) {
    const value = parseRequiredString(data, field);
    assertCondition(allowed.includes(value), 'invalid-argument', `El campo ${field} debe ser uno de: ${allowed.join(', ')}.`);
    return value;
}
export function parseOptionalEnum(data, field, allowed) {
    const value = parseOptionalString(data, field);
    if (!value) {
        return undefined;
    }
    assertCondition(allowed.includes(value), 'invalid-argument', `El campo ${field} debe ser uno de: ${allowed.join(', ')}.`);
    return value;
}
export function validateBps(value, field = 'bps') {
    assertCondition(value >= 0 && value <= MAX_BPS, 'invalid-argument', `El campo ${field} debe estar entre 0 y ${MAX_BPS}.`);
}
export function validateAccountingPeriod(value, field = 'period') {
    assertCondition(/^\d{4}-(0[1-9]|1[0-2])$/.test(value), 'invalid-argument', `El campo ${field} debe tener formato YYYY-MM.`);
}
export function toAccountingPeriod(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}
export function toClubAccountingPeriod(date) {
    const year = getClubDatePart(date, 'year');
    const month = String(getClubDatePart(date, 'month')).padStart(2, '0');
    return `${year}-${month}`;
}
export function calculateAmountFromBps(baseAmountMinor, pctBps) {
    return Math.round((baseAmountMinor * pctBps) / 10_000);
}
function getClubDatePart(date, part) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: ACCOUNTING_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const value = parts.find((entry) => entry.type === part)?.value;
    assertCondition(value, 'invalid-argument', 'No se pudo resolver la fecha contable.');
    return Number(value);
}
export function getClubDayOfMonth(date) {
    return getClubDatePart(date, 'day');
}
export function getClubDateStart(date) {
    const year = getClubDatePart(date, 'year');
    const month = String(getClubDatePart(date, 'month')).padStart(2, '0');
    const day = String(getClubDatePart(date, 'day')).padStart(2, '0');
    return new Date(`${year}-${month}-${day}T00:00:00${ACCOUNTING_TIME_ZONE_OFFSET}`);
}
export function calculateEarlyPaymentDiscount(params) {
    const discountPctBps = params.config.earlyPaymentDiscountPctBps ?? DEFAULT_EARLY_PAYMENT_DISCOUNT_PCT_BPS;
    const discountDayOfMonth = params.config.earlyPaymentDiscountDayOfMonth ?? DEFAULT_EARLY_PAYMENT_DISCOUNT_DAY_OF_MONTH;
    const operationDay = getClubDayOfMonth(params.operationDate);
    const operationPeriod = toClubAccountingPeriod(params.operationDate);
    const isSameChargePeriod = !params.chargePeriod || params.chargePeriod === operationPeriod;
    const qualifies = discountPctBps > 0 && isSameChargePeriod && operationDay >= 1 && operationDay <= discountDayOfMonth;
    const discountAmountMinor = qualifies ? calculateAmountFromBps(params.chargeAmountMinor, discountPctBps) : 0;
    return {
        paidAmountMinor: Math.max(params.chargeAmountMinor - discountAmountMinor, 0),
        discountPctBps: qualifies ? discountPctBps : 0,
        discountAmountMinor,
        qualifies,
    };
}
export function calculateMembershipRenewalDueDate(paymentDate) {
    const year = getClubDatePart(paymentDate, 'year');
    const month = getClubDatePart(paymentDate, 'month');
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00${ACCOUNTING_TIME_ZONE_OFFSET}`);
}
export function getLicenseMaxEndDate(startAt, maxLicenseMonths) {
    const limit = new Date(startAt);
    limit.setUTCMonth(limit.getUTCMonth() + maxLicenseMonths);
    return limit;
}
export function validateLicenseRange(startAt, endAt, maxLicenseMonths) {
    assertCondition(endAt.getTime() >= startAt.getTime(), 'invalid-argument', 'La licencia debe terminar después de comenzar.');
    const maxEndDate = getLicenseMaxEndDate(startAt, maxLicenseMonths);
    assertCondition(endAt.getTime() <= maxEndDate.getTime(), 'failed-precondition', `La licencia no puede superar ${maxLicenseMonths} meses.`);
}
export function buildFeePreview(params) {
    const { config, member, period } = params;
    const explanation = [`Configuración financiera v${config.version}.`];
    let appliedPctBps;
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
export function ensureMemberCanBeBilled(params) {
    const { config, forceAdministrativeExceptionReason, member } = params;
    if (member.isFamilyHolder) {
        assertCondition(member.familyGroupId, 'failed-precondition', 'Un titular de grupo familiar debe tener familyGroupId.');
    }
    if (member.typeCodeSnapshot === 'menor' && !config.allowStandaloneMinor) {
        assertCondition(member.familyGroupId, 'failed-precondition', 'Los menores deben pertenecer a un grupo familiar.');
    }
    const memberStatus = member.status;
    assertCondition(memberStatus !== 'inactive' && memberStatus !== 'suspended', 'failed-precondition', 'No se puede generar cuota para socios dados de baja o suspendidos.');
    if (member.status === 'inactive' || member.status === 'suspended') {
        assertCondition(typeof forceAdministrativeExceptionReason === 'string' && forceAdministrativeExceptionReason.trim().length > 0, 'failed-precondition', 'No se puede generar cuota para socios inactivos o suspendidos sin excepción administrativa documentada.');
    }
}
export async function resolveActor(dataAccess, authContext) {
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
            comite_ejecutivo: token.comite_ejecutivo === true,
            directivo: token.directivo === true,
            administrativo: token.administrativo === true,
            empleado: token.empleado === true,
            comision_directiva: token.comision_directiva === true,
            socio: token.socio === true,
            claimsVersion: typeof token.claimsVersion === 'number' ? token.claimsVersion : user.claimsVersion,
        },
        user,
    };
}
//# sourceMappingURL=shared.js.map