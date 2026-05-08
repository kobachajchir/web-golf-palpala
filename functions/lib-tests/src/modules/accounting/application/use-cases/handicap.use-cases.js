import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS, } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureStaff, parseOptionalAccountingPeriod, parseOptionalAmountMinor, parseOptionalBoolean, parseOptionalIsoDate, parseOptionalNullableString, parseRequiredAccountingPeriod, parseRequiredAmountMinor, parseRequiredString, } from '../shared.js';
import { createPostedMovement } from '../movement-helpers.js';
export async function createHandicapChargeUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const member = await dataAccess.members.getById(params.input.memberId);
        assertCondition(member, 'not-found', `No existe members/${params.input.memberId}.`);
        if (params.input.handicapId) {
            const handicap = await dataAccess.handicaps.getById(params.input.handicapId);
            assertCondition(handicap, 'not-found', `No existe handicaps/${params.input.handicapId}.`);
        }
        const existingCharge = await dataAccess.handicapCharges.findByMemberAndPeriod(params.input.memberId, params.input.period);
        if (existingCharge?.incomeMovementId && params.input.collectNow) {
            return {
                handicapChargeId: existingCharge.id,
                incomeMovementId: existingCharge.incomeMovementId ?? undefined,
                duplicate: true,
            };
        }
        const handicapChargeId = existingCharge?.id
            ?? await dataAccess.handicapCharges.create({
                memberId: member.id,
                handicapId: params.input.handicapId ?? null,
                period: params.input.period,
                collectionAmountMinor: params.input.collectionAmountMinor,
                transferAmountMinor: params.input.transferAmountMinor,
                associationName: params.input.associationName,
                incomeMovementId: null,
                expenseMovementId: null,
                status: 'pending_collection',
                transferDueDate: params.input.transferDueDate ? Timestamp.fromDate(params.input.transferDueDate) : null,
                notes: params.input.notes ?? null,
            }, actor.uid);
        if (!params.input.collectNow) {
            return { handicapChargeId, duplicate: false };
        }
        const category = await dataAccess.financialIncomeCategories.getById(FINANCIAL_INCOME_CATEGORY_IDS.handicap);
        assertCondition(category, 'not-found', `No existe financial_income_categories/${FINANCIAL_INCOME_CATEGORY_IDS.handicap}.`);
        const paymentMethodId = params.input.paymentMethodId ?? PAYMENT_METHOD_IDS.transfer;
        const paymentMethod = await dataAccess.paymentMethods.getById(paymentMethodId);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${paymentMethodId}.`);
        const movement = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'income',
            categoryId: category.id,
            categoryCodeSnapshot: category.id,
            grossAmountMinor: params.input.collectionAmountMinor,
            operationDate: params.input.operationDate ?? new Date(`${params.input.period}-01T00:00:00.000Z`),
            originType: 'handicap',
            originCollection: 'handicap_charges',
            originId: handicapChargeId,
            thirdPartyType: 'member',
            thirdPartyId: member.id,
            paymentMethodId: paymentMethod.id,
            bancarizado: paymentMethod.bancarizado,
            imputableImpositivo: true,
            notes: params.input.notes ?? null,
            applyPaymentCommission: paymentMethod.id === 'credit',
        });
        await dataAccess.handicapCharges.update(handicapChargeId, {
            incomeMovementId: movement.movementId,
            status: 'collected',
        }, actor.uid);
        return {
            handicapChargeId,
            incomeMovementId: movement.movementId,
            duplicate: false,
        };
    });
}
export async function transferHandicapToAssociationUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const handicapCharge = await dataAccess.handicapCharges.getById(params.input.handicapChargeId);
        assertCondition(handicapCharge, 'not-found', `No existe handicap_charges/${params.input.handicapChargeId}.`);
        assertCondition(handicapCharge.status === 'collected' || handicapCharge.status === 'closed', 'failed-precondition', 'Solo se puede transferir un handicap previamente cobrado.');
        if (handicapCharge.expenseMovementId) {
            return {
                handicapChargeId: handicapCharge.id,
                expenseMovementId: handicapCharge.expenseMovementId,
                duplicate: true,
            };
        }
        const paymentMethodId = params.input.paymentMethodId ?? PAYMENT_METHOD_IDS.transfer;
        const paymentMethod = await dataAccess.paymentMethods.getById(paymentMethodId);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${paymentMethodId}.`);
        const movement = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'expense',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.handicap,
            categoryCodeSnapshot: FINANCIAL_INCOME_CATEGORY_IDS.handicap,
            grossAmountMinor: handicapCharge.transferAmountMinor,
            operationDate: params.input.operationDate ?? new Date(`${handicapCharge.period}-01T00:00:00.000Z`),
            originType: 'handicap_transfer',
            originCollection: 'handicap_charges',
            originId: handicapCharge.id,
            thirdPartyType: 'association',
            thirdPartyId: null,
            paymentMethodId: paymentMethod.id,
            bancarizado: paymentMethod.bancarizado,
            imputableImpositivo: true,
            notes: params.input.notes ?? null,
            applyPaymentCommission: false,
        });
        await dataAccess.handicapCharges.update(handicapCharge.id, {
            expenseMovementId: movement.movementId,
            status: 'closed',
        }, actor.uid);
        return {
            handicapChargeId: handicapCharge.id,
            expenseMovementId: movement.movementId,
            duplicate: false,
        };
    });
}
export function parseCreateHandicapChargeInput(payload) {
    const data = assertIsRecord(payload);
    return {
        memberId: parseRequiredString(data, 'memberId'),
        handicapId: parseOptionalNullableString(data, 'handicapId'),
        period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
        collectionAmountMinor: parseRequiredAmountMinor(data, 'collectionAmountMinor'),
        transferAmountMinor: parseOptionalAmountMinor(data, 'transferAmountMinor') ?? parseRequiredAmountMinor(data, 'transferAmountMinor'),
        associationName: parseRequiredString(data, 'associationName'),
        transferDueDate: parseOptionalIsoDate(data, 'transferDueDate') ?? null,
        notes: parseOptionalNullableString(data, 'notes'),
        collectNow: parseOptionalBoolean(data, 'collectNow'),
        paymentMethodId: parseOptionalNullableString(data, 'paymentMethodId'),
        operationDate: parseOptionalIsoDate(data, 'operationDate'),
    };
}
export function parseTransferHandicapToAssociationInput(payload) {
    const data = assertIsRecord(payload);
    return {
        handicapChargeId: parseRequiredString(data, 'handicapChargeId'),
        paymentMethodId: parseOptionalNullableString(data, 'paymentMethodId'),
        operationDate: parseOptionalIsoDate(data, 'operationDate'),
        notes: parseOptionalNullableString(data, 'notes'),
    };
}
//# sourceMappingURL=handicap.use-cases.js.map