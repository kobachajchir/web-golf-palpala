import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../../accounting/domain/constants.js';
import { assertCondition } from '../../../accounting/domain/errors.js';
import { assertIsRecord, ensureAuthenticatedActor, ensureStaff, parseOptionalAmountMinor, parseOptionalIsoDate, parseOptionalNullableString, parseOptionalString, parseRequiredAmountMinor, parseRequiredIsoDate, parseRequiredString, } from '../../../accounting/application/shared.js';
import { createPostedMovement } from '../../../accounting/application/movement-helpers.js';
const TOURNAMENT_PAYMENT_METHOD_IDS = [
    PAYMENT_METHOD_IDS.debitMacro,
    PAYMENT_METHOD_IDS.debit,
    PAYMENT_METHOD_IDS.transfer,
    PAYMENT_METHOD_IDS.credit,
    PAYMENT_METHOD_IDS.cash,
];
function actorHasStaffRole(actor) {
    const isAdministrative = actor.user.roleIds.includes('administrativo') && actor.claims.administrativo === true;
    const isDirectivo = (actor.user.roleIds.includes('comite_ejecutivo') || actor.user.roleIds.includes('directivo')) &&
        (actor.claims.comite_ejecutivo === true || actor.claims.directivo === true);
    return isAdministrative || isDirectivo;
}
function parsePaymentMethodId(value) {
    assertCondition(TOURNAMENT_PAYMENT_METHOD_IDS.includes(value), 'invalid-argument', 'El medio de pago no es valido para una inscripcion de torneo.');
    return value;
}
function buildReceiptNumber(params) {
    const year = params.operationDate.getUTCFullYear();
    const month = String(params.operationDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(params.operationDate.getUTCDate()).padStart(2, '0');
    return `TOR-${year}${month}${day}-${params.registrationId.slice(0, 8).toUpperCase()}`;
}
export async function registerTournamentParticipantUseCase(params) {
    const actor = ensureAuthenticatedActor(params.actor);
    const isStaff = actorHasStaffRole(actor);
    assertCondition(actor.user.active, 'permission-denied', 'El usuario no esta activo.');
    if (!isStaff) {
        assertCondition(actor.user.profileType === 'member' && actor.user.profileId, 'permission-denied', 'Solo socios vinculados pueden inscribirse.');
    }
    assertCondition(!params.input.tournamentStatus || params.input.tournamentStatus === 'registration_open', 'failed-precondition', 'El torneo no tiene la inscripcion abierta.');
    const memberId = params.input.memberId ?? (actor.user.profileType === 'member' ? actor.user.profileId ?? null : null);
    if (!isStaff) {
        assertCondition(memberId === actor.user.profileId, 'permission-denied', 'Un socio solo puede inscribirse a si mismo.');
    }
    const participantName = params.input.participantName?.trim()
        || actor.user.displayName
        || 'Participante';
    return params.transactions.runInTransaction(async (dataAccess) => {
        const duplicate = await dataAccess.registrations.findDuplicate({
            tournamentId: params.input.tournamentId,
            userId: actor.uid,
            memberId,
        });
        if (duplicate) {
            return {
                registrationId: duplicate.id,
                duplicate: true,
                paymentStatus: duplicate.paymentStatus,
            };
        }
        const registrationId = await dataAccess.registrations.create({
            tournamentId: params.input.tournamentId,
            tournamentNameSnapshot: params.input.tournamentName,
            tournamentDate: Timestamp.fromDate(params.input.tournamentDate),
            userId: actor.uid,
            memberId,
            participantName,
            participantEmail: params.input.participantEmail ?? actor.user.email ?? null,
            amountMinor: params.input.registrationFeeMinor,
            status: 'pending_payment',
            paymentStatus: 'unpaid',
            receiptId: null,
            financialMovementId: null,
            registeredAt: Timestamp.fromDate(params.clock.now()),
            paidAt: null,
            paymentMethodId: null,
            paymentReference: null,
            notes: params.input.notes ?? null,
        }, actor.uid);
        return {
            registrationId,
            duplicate: false,
            paymentStatus: 'unpaid',
        };
    });
}
export async function recordTournamentRegistrationPaymentUseCase(params) {
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
            };
        }
        assertCondition(registration.paymentStatus === 'unpaid', 'failed-precondition', 'Solo se puede registrar pago sobre inscripciones impagas.');
        const paymentMethod = await accountingDataAccess.paymentMethods.getById(params.input.paymentMethodId);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.input.paymentMethodId}.`);
        assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.input.paymentMethodId} esta inactivo.`);
        const paymentReference = params.input.paymentReference?.trim() || null;
        assertCondition(paymentMethod.id === PAYMENT_METHOD_IDS.cash || Boolean(paymentReference), 'invalid-argument', 'La referencia de pago es obligatoria para medios distintos de efectivo.');
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
        const receiptId = await dataAccess.receipts.create({
            registrationId: registration.id,
            tournamentId: registration.tournamentId,
            tournamentNameSnapshot: registration.tournamentNameSnapshot,
            memberId: registration.memberId ?? null,
            userId: registration.userId,
            receiptNumber,
            amountMinor,
            paymentMethodId: paymentMethod.id,
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
        }, actor.uid);
        // TODO(notifications): notificar al socio/invitado con el recibo emitido cuando el modulo de notificaciones este conectado.
        await dataAccess.registrations.update(registration.id, {
            status: 'confirmed',
            paymentStatus: 'paid',
            receiptId,
            financialMovementId: movement.movementId,
            paidAt: Timestamp.fromDate(params.input.operationDate),
            paymentMethodId: paymentMethod.id,
            paymentReference,
        }, actor.uid);
        return {
            registrationId: registration.id,
            receiptId,
            receiptNumber,
            movementId: movement.movementId,
            netAmountMinor: movement.netAmountMinor,
            duplicate: false,
        };
    });
}
export function parseRegisterTournamentParticipantInput(payload) {
    const data = assertIsRecord(payload);
    return {
        tournamentId: parseRequiredString(data, 'tournamentId'),
        tournamentName: parseRequiredString(data, 'tournamentName'),
        tournamentDate: parseRequiredIsoDate(data, 'tournamentDate'),
        tournamentStatus: parseOptionalString(data, 'tournamentStatus'),
        memberId: parseOptionalNullableString(data, 'memberId'),
        participantName: parseOptionalNullableString(data, 'participantName'),
        participantEmail: parseOptionalNullableString(data, 'participantEmail'),
        registrationFeeMinor: parseRequiredAmountMinor(data, 'registrationFeeMinor'),
        notes: parseOptionalNullableString(data, 'notes'),
    };
}
export function parseRecordTournamentRegistrationPaymentInput(payload) {
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
//# sourceMappingURL=registration.use-cases.js.map