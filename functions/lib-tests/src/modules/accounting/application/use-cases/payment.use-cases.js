import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureStaff, parseOptionalIsoDate, parseOptionalNullableString, parseOptionalRecord, parseRequiredAmountMinor, parseRequiredIsoDate, parseRequiredString, } from '../shared.js';
import { createPostedMovement } from '../movement-helpers.js';
function getMembershipValidUntil(period) {
    const [yearRaw, monthRaw] = period.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return null;
    }
    return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}
export async function registerPaymentUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const category = await dataAccess.financialIncomeCategories.getById(params.input.categoryId);
        assertCondition(category, 'not-found', `No existe financial_income_categories/${params.input.categoryId}.`);
        assertCondition(category.active, 'failed-precondition', `La categoría ${params.input.categoryId} está inactiva.`);
        const paymentMethod = await dataAccess.paymentMethods.getById(params.input.paymentMethodId);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.input.paymentMethodId}.`);
        assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.input.paymentMethodId} está inactivo.`);
        const paymentReference = params.input.paymentReference?.trim() || null;
        const paymentReferenceRequired = params.input.sourceType !== 'manual_income' && paymentMethod.id !== PAYMENT_METHOD_IDS.cash;
        assertCondition(!paymentReferenceRequired || Boolean(paymentReference), 'invalid-argument', 'La referencia de pago es obligatoria para medios distintos de efectivo.');
        if (params.input.memberId) {
            const member = await dataAccess.members.getById(params.input.memberId);
            assertCondition(member, 'not-found', `No existe members/${params.input.memberId}.`);
        }
        let memberFeeChargeToPay = null;
        if (params.input.sourceType === 'member_fee_charge') {
            assertCondition(params.input.sourceId, 'invalid-argument', 'sourceId es obligatorio para member_fee_charge.');
            const memberFeeCharge = await dataAccess.memberFeeCharges.getById(params.input.sourceId);
            assertCondition(memberFeeCharge, 'not-found', `No existe member_fee_charges/${params.input.sourceId}.`);
            memberFeeChargeToPay = memberFeeCharge;
            if (memberFeeCharge.status === 'paid' && memberFeeCharge.paidMovementId) {
                const existingMovement = await dataAccess.financialMovements.getById(memberFeeCharge.paidMovementId);
                assertCondition(existingMovement, 'failed-precondition', 'La cuota ya fue pagada y el movimiento vinculado no existe.');
                return {
                    movementId: existingMovement.id,
                    netAmountMinor: existingMovement.netAmountMinor,
                    duplicate: true,
                };
            }
            assertCondition(memberFeeCharge.status === 'pending' || memberFeeCharge.status === 'overdue', 'failed-precondition', 'Solo se pueden cobrar cuotas pendientes o vencidas.');
        }
        let handicapChargeId = null;
        if (params.input.sourceType === 'handicap' && params.input.sourceId) {
            const handicapCharge = await dataAccess.handicapCharges.getById(params.input.sourceId);
            assertCondition(handicapCharge, 'not-found', `No existe handicap_charges/${params.input.sourceId}.`);
            if (handicapCharge.incomeMovementId) {
                const existingMovement = await dataAccess.financialMovements.getById(handicapCharge.incomeMovementId);
                if (existingMovement) {
                    return {
                        movementId: existingMovement.id,
                        netAmountMinor: existingMovement.netAmountMinor,
                        duplicate: true,
                    };
                }
            }
            handicapChargeId = handicapCharge.id;
        }
        if (params.input.sourceType === 'handicap' && !params.input.sourceId) {
            const metadata = params.input.metadata ?? {};
            const period = typeof metadata.period === 'string' ? metadata.period : null;
            const associationName = typeof metadata.associationName === 'string' ? metadata.associationName : null;
            const transferAmountMinor = typeof metadata.transferAmountMinor === 'number' ? metadata.transferAmountMinor : params.input.grossAmountMinor;
            assertCondition(params.input.memberId, 'invalid-argument', 'memberId es obligatorio para crear handicap_charges al cobrar handicap.');
            assertCondition(period, 'invalid-argument', 'metadata.period es obligatorio para crear handicap_charges.');
            assertCondition(associationName, 'invalid-argument', 'metadata.associationName es obligatorio para crear handicap_charges.');
            const existingCharge = await dataAccess.handicapCharges.findByMemberAndPeriod(params.input.memberId, period);
            if (existingCharge?.incomeMovementId) {
                const existingMovement = await dataAccess.financialMovements.getById(existingCharge.incomeMovementId);
                if (existingMovement) {
                    return {
                        movementId: existingMovement.id,
                        netAmountMinor: existingMovement.netAmountMinor,
                        duplicate: true,
                    };
                }
            }
            handicapChargeId = existingCharge?.id
                ?? await dataAccess.handicapCharges.create({
                    memberId: params.input.memberId,
                    handicapId: typeof metadata.handicapId === 'string' ? metadata.handicapId : null,
                    period,
                    collectionAmountMinor: params.input.grossAmountMinor,
                    transferAmountMinor,
                    associationName,
                    incomeMovementId: null,
                    expenseMovementId: null,
                    status: 'pending_collection',
                    transferDueDate: null,
                    notes: params.input.notes ?? null,
                }, actor.uid);
        }
        const thirdPartyType = params.input.thirdPartyType
            ?? (params.input.memberId ? 'member' : null);
        const thirdPartyId = params.input.thirdPartyId
            ?? params.input.memberId
            ?? null;
        const movement = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'income',
            categoryId: category.id,
            categoryCodeSnapshot: category.id,
            grossAmountMinor: params.input.grossAmountMinor,
            operationDate: params.input.operationDate,
            originType: params.input.sourceType,
            originCollection: params.input.sourceType === 'member_fee_charge'
                ? 'member_fee_charges'
                : params.input.sourceType === 'handicap'
                    ? 'handicap_charges'
                    : null,
            originId: params.input.sourceId ?? handicapChargeId,
            thirdPartyType,
            thirdPartyId,
            paymentMethodId: paymentMethod.id,
            bancarizado: paymentMethod.bancarizado,
            imputableImpositivo: true,
            metadata: {
                ...(params.input.metadata ?? {}),
                ...(paymentReference ? { paymentReference } : {}),
                specialReportingType: paymentMethod.specialReportingType ?? null,
            },
            notes: params.input.notes ?? null,
            applyPaymentCommission: paymentMethod.id === 'credit',
        });
        if (params.input.sourceType === 'member_fee_charge' && params.input.sourceId) {
            await dataAccess.memberFeeCharges.update(params.input.sourceId, {
                status: 'paid',
                paidMovementId: movement.movementId,
                paidAt: Timestamp.fromDate(params.input.operationDate),
                paidAmountMinor: movement.netAmountMinor,
            }, actor.uid);
            const memberIdToUpdate = memberFeeChargeToPay?.memberId ?? memberFeeChargeToPay?.holderMemberId ?? null;
            const membershipValidUntil = memberFeeChargeToPay ? getMembershipValidUntil(memberFeeChargeToPay.period) : null;
            if (memberIdToUpdate) {
                await dataAccess.members.update(memberIdToUpdate, {
                    lastFeePaymentAt: Timestamp.fromDate(params.input.operationDate),
                    ...(membershipValidUntil ? { membershipRenewalDueAt: Timestamp.fromDate(membershipValidUntil) } : {}),
                    membershipRenewalStatus: 'current',
                }, actor.uid);
            }
        }
        if (handicapChargeId) {
            await dataAccess.handicapCharges.update(handicapChargeId, {
                collectionAmountMinor: params.input.grossAmountMinor,
                incomeMovementId: movement.movementId,
                status: 'collected',
            }, actor.uid);
        }
        if (params.input.sourceType === 'member_fee_charge' && category.id !== FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria) {
            await dataAccess.financialMovements.update(movement.movementId, {
                metadata: {
                    ...(params.input.metadata ?? {}),
                    warning: 'El cobro de cuota se registró con una categoría distinta de cuota_societaria.',
                },
            }, actor.uid);
        }
        return {
            movementId: movement.movementId,
            netAmountMinor: movement.netAmountMinor,
            duplicate: false,
        };
    });
}
export function parseRegisterPaymentInput(payload) {
    const data = assertIsRecord(payload);
    return {
        sourceType: parseRequiredString(data, 'sourceType'),
        sourceId: parseOptionalNullableString(data, 'sourceId'),
        memberId: parseOptionalNullableString(data, 'memberId'),
        thirdPartyType: parseOptionalNullableString(data, 'thirdPartyType'),
        thirdPartyId: parseOptionalNullableString(data, 'thirdPartyId'),
        categoryId: parseRequiredString(data, 'categoryId'),
        paymentMethodId: parseRequiredString(data, 'paymentMethodId'),
        paymentReference: parseOptionalNullableString(data, 'paymentReference'),
        grossAmountMinor: parseRequiredAmountMinor(data, 'grossAmountMinor'),
        operationDate: parseOptionalIsoDate(data, 'operationDate') ?? parseRequiredIsoDate(data, 'operationDate'),
        notes: parseOptionalNullableString(data, 'notes'),
        metadata: parseOptionalRecord(data, 'metadata'),
    };
}
//# sourceMappingURL=payment.use-cases.js.map