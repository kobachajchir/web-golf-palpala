import { HttpsError } from 'firebase-functions/v2/https';
import { CLAIM_ROLE_IDS, DEFAULT_PRIMARY_ROLE_ID, MAX_LICENSE_MONTHS, PRIMARY_ROLE_PRECEDENCE, STAFF_ROLE_IDS } from '../domain/constants.js';
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
export function ensureDirectivo(actor) {
    const authenticatedActor = ensureAuthenticatedActor(actor);
    const roleIds = new Set(authenticatedActor.user.roleIds);
    assertCondition(authenticatedActor.user.active, 'permission-denied', 'El usuario no está activo.');
    assertCondition(roleIds.has('directivo') && authenticatedActor.claims.directivo === true, 'permission-denied', 'Solo un directivo puede realizar esta operación.');
    return authenticatedActor;
}
export function ensureStaff(actor) {
    const authenticatedActor = ensureAuthenticatedActor(actor);
    const roleIds = new Set(authenticatedActor.user.roleIds);
    const isStaffByRole = STAFF_ROLE_IDS.some((roleId) => roleIds.has(roleId));
    const isStaffByClaim = authenticatedActor.claims.directivo === true || authenticatedActor.claims.administrativo === true;
    assertCondition(authenticatedActor.user.active, 'permission-denied', 'El usuario no está activo.');
    assertCondition(isStaffByRole && isStaffByClaim, 'permission-denied', 'Solo personal staff puede realizar esta operación.');
    return authenticatedActor;
}
export function pickPrimaryRoleId(roleIds) {
    const uniqueRoleIds = Array.from(new Set(roleIds));
    assertCondition(uniqueRoleIds.length > 0, 'invalid-argument', 'Debes asignar al menos un rol.');
    for (const preferredRoleId of PRIMARY_ROLE_PRECEDENCE) {
        if (uniqueRoleIds.includes(preferredRoleId)) {
            return preferredRoleId;
        }
    }
    return uniqueRoleIds[0] ?? DEFAULT_PRIMARY_ROLE_ID;
}
export function buildCustomClaims(roleIds, claimsVersion, active) {
    const roleSet = new Set(roleIds);
    const baseClaims = Object.fromEntries(CLAIM_ROLE_IDS.map((roleId) => [roleId, active && roleSet.has(roleId)]));
    return {
        ...baseClaims,
        claimsVersion,
    };
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
export function parseOptionalBoolean(data, field) {
    const value = data[field];
    if (value === undefined) {
        return undefined;
    }
    assertCondition(typeof value === 'boolean', 'invalid-argument', `El campo ${field} debe ser boolean.`);
    return value;
}
export function parseOptionalNumber(data, field) {
    const value = data[field];
    if (value === undefined) {
        return undefined;
    }
    assertCondition(typeof value === 'number' && Number.isFinite(value), 'invalid-argument', `El campo ${field} debe ser numérico.`);
    return value;
}
export function parseRequiredStringArray(data, field) {
    const value = data[field];
    assertCondition(Array.isArray(value), 'invalid-argument', `El campo ${field} debe ser un arreglo.`);
    const normalizedValues = value.map((item) => {
        assertCondition(typeof item === 'string' && item.trim().length > 0, 'invalid-argument', `Todos los elementos de ${field} deben ser strings.`);
        return item.trim();
    });
    return Array.from(new Set(normalizedValues));
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
export function validateLicenseRange(startAt, endAt) {
    assertCondition(endAt.getTime() >= startAt.getTime(), 'invalid-argument', 'La licencia debe terminar después de comenzar.');
    const maxEndDate = new Date(startAt);
    maxEndDate.setMonth(maxEndDate.getMonth() + MAX_LICENSE_MONTHS);
    assertCondition(endAt.getTime() <= maxEndDate.getTime(), 'failed-precondition', `La licencia no puede superar ${MAX_LICENSE_MONTHS} meses.`);
}
export function ensureFamilyHolderEligibility(holderMember, holderType) {
    assertCondition(holderType.active, 'failed-precondition', `El tipo de socio ${holderType.id} no está activo.`);
    assertCondition(holderType.canBeFamilyHolder, 'failed-precondition', `El socio ${holderMember.id} no puede ser titular del grupo familiar.`);
}
export function ensureMinimumFamilyGroup(memberIds) {
    const uniqueMemberIds = Array.from(new Set(memberIds));
    assertCondition(uniqueMemberIds.length >= 2, 'failed-precondition', 'Un grupo familiar debe tener al menos 2 miembros.');
}
export function ensureNoSalaryFields(payload) {
    const forbiddenFields = ['salary', 'salaryAmount', 'salaryAmountMinor', 'salaryConfigurationId', 'grossSalary'];
    const foundField = forbiddenFields.find((field) => field in payload);
    assertCondition(!foundField, 'invalid-argument', `El módulo USERS no admite ${foundField}. Esa información pertenece a ACCOUNTING.`);
}
export async function syncProfileLink(params) {
    const { actorUid, dataAccess, nextLinkedUserId, previousLinkedUserId, profileId, profileType } = params;
    if (previousLinkedUserId && previousLinkedUserId !== nextLinkedUserId) {
        await dataAccess.users.clearProfileLink({
            uid: previousLinkedUserId,
            actorUid,
            expectedProfileId: profileId,
            expectedProfileType: profileType,
        });
    }
    if (!nextLinkedUserId) {
        return;
    }
    const linkedUser = await dataAccess.users.getById(nextLinkedUserId);
    assertCondition(linkedUser, 'not-found', `No existe users/${nextLinkedUserId}.`);
    assertCondition(linkedUser.active, 'failed-precondition', 'No se puede vincular un usuario inactivo.');
    const currentProfileType = linkedUser.profileType;
    const currentProfileId = linkedUser.profileId;
    const isSameLink = currentProfileType === profileType && currentProfileId === profileId;
    const isAvailable = currentProfileType === 'none' || currentProfileId === undefined;
    assertCondition(isSameLink || isAvailable, 'failed-precondition', `El usuario ${nextLinkedUserId} ya está vinculado a otro perfil.`);
    await dataAccess.users.setProfileLink({
        uid: nextLinkedUserId,
        profileType,
        profileId,
        actorUid,
    });
}
export function assertIsRecord(value) {
    assertCondition(isRecord(value), 'invalid-argument', 'El payload debe ser un objeto.');
    return value;
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
            directivo: token.directivo === true,
            administrativo: token.administrativo === true,
            empleado: token.empleado === true,
            socio: token.socio === true,
            claimsVersion: typeof token.claimsVersion === 'number' ? token.claimsVersion : user.claimsVersion,
        },
        user,
    };
}
//# sourceMappingURL=shared.js.map