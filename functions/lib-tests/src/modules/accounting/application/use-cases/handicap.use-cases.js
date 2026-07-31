import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS, } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureStaff, parseOptionalAccountingPeriod, parseOptionalAmountMinor, parseOptionalBoolean, parseOptionalIsoDate, parseOptionalNullableString, parseRequiredAccountingPeriod, parseRequiredAmountMinor, parseRequiredString, } from '../shared.js';
import { createPostedMovement } from '../movement-helpers.js';
import { assertCashOperationDateAllowed } from '../cash-closure-guards.js';
function buildReceiptNumber(operationDate, movementId) {
    const date = operationDate.toISOString().slice(0, 10).replaceAll('-', '');
    return `REC-${date}-${movementId.slice(0, 8).toUpperCase()}`;
}
function readReceiptNumber(metadata) {
    return typeof metadata?.receiptNumber === 'string' ? metadata.receiptNumber : null;
}
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
            const existingMovement = await dataAccess.financialMovements.getById(existingCharge.incomeMovementId);
            return {
                handicapChargeId: existingCharge.id,
                incomeMovementId: existingCharge.incomeMovementId ?? undefined,
                receiptNumber: readReceiptNumber(existingMovement?.metadata),
                grossAmountMinor: existingMovement?.grossAmountMinor ?? existingCharge.collectionAmountMinor,
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
        const paymentMethodId = params.input.paymentMethodId ?? PAYMENT_METHOD_IDS.transferMacro;
        const paymentMethod = await dataAccess.paymentMethods.getById(paymentMethodId);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${paymentMethodId}.`);
        const operationDate = params.input.operationDate ?? new Date(`${params.input.period}-01T00:00:00.000Z`);
        const receiptNumber = buildReceiptNumber(operationDate, handicapChargeId);
        const movement = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'income',
            categoryId: category.id,
            categoryCodeSnapshot: category.id,
            grossAmountMinor: params.input.collectionAmountMinor,
            operationDate,
            originType: 'handicap',
            originCollection: 'handicap_charges',
            originId: handicapChargeId,
            thirdPartyType: 'member',
            thirdPartyId: member.id,
            paymentMethodId: paymentMethod.id,
            bancarizado: paymentMethod.bancarizado,
            imputableImpositivo: true,
            metadata: {
                receiptNumber,
                receiptIssuedAt: Timestamp.fromDate(operationDate),
                receiptSource: 'handicap',
            },
            notes: params.input.notes ?? null,
            applyPaymentCommission: true,
            paymentCommissionMode: 'add_to_charge',
        });
        await dataAccess.handicapCharges.update(handicapChargeId, {
            incomeMovementId: movement.movementId,
            status: 'collected',
        }, actor.uid);
        return {
            handicapChargeId,
            incomeMovementId: movement.movementId,
            receiptNumber,
            grossAmountMinor: movement.grossAmountMinor,
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
        const paymentMethodId = params.input.paymentMethodId ?? PAYMENT_METHOD_IDS.transferMacro;
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
function normalizeAssociationName(value) {
    return (value ?? '').trim().toLowerCase();
}
export async function transferPendingHandicapToAssociationUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const associationName = params.input.associationName?.trim() || 'AAG';
        const associationKey = normalizeAssociationName(associationName);
        const collectedCharges = [];
        let cursorId;
        do {
            const page = await dataAccess.handicapCharges.listPage({
                status: 'collected',
                limit: 100,
                ...(cursorId ? { cursorId } : {}),
            });
            collectedCharges.push(...page.items);
            cursorId = page.nextCursorId;
        } while (cursorId);
        const pendingCharges = collectedCharges.filter((charge) => !charge.expenseMovementId
            && normalizeAssociationName(charge.associationName) === associationKey
            && charge.transferAmountMinor > 0);
        assertCondition(pendingCharges.length > 0, 'failed-precondition', `No hay cobros de handicap pendientes de transferir a ${associationName}.`);
        const amountMinor = pendingCharges.reduce((total, charge) => total + charge.transferAmountMinor, 0);
        const operationDate = params.input.operationDate ?? new Date();
        await assertCashOperationDateAllowed({
            dataAccess,
            operationDate,
        });
        const paymentMethodId = params.input.paymentMethodId ?? PAYMENT_METHOD_IDS.transferMacro;
        const paymentMethod = await dataAccess.paymentMethods.getById(paymentMethodId);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${paymentMethodId}.`);
        const movement = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'expense',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.handicap,
            categoryCodeSnapshot: FINANCIAL_INCOME_CATEGORY_IDS.handicap,
            grossAmountMinor: amountMinor,
            operationDate,
            originType: 'handicap_transfer',
            originCollection: 'handicap_charges',
            originId: null,
            thirdPartyType: 'association',
            thirdPartyId: null,
            paymentMethodId: paymentMethod.id,
            bancarizado: paymentMethod.bancarizado,
            imputableImpositivo: true,
            metadata: {
                associationName,
                handicapChargeIds: pendingCharges.map((charge) => charge.id),
                handicapChargeCount: pendingCharges.length,
                handicapChargePeriods: Array.from(new Set(pendingCharges.map((charge) => charge.period))).sort(),
            },
            notes: params.input.notes ?? `Transferencia acumulada ${associationName}.`,
            applyPaymentCommission: false,
        });
        await Promise.all(pendingCharges.map((charge) => dataAccess.handicapCharges.update(charge.id, {
            expenseMovementId: movement.movementId,
            status: 'closed',
        }, actor.uid)));
        return {
            expenseMovementId: movement.movementId,
            handicapChargeIds: pendingCharges.map((charge) => charge.id),
            amountMinor,
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
export function parseTransferPendingHandicapToAssociationInput(payload) {
    const data = assertIsRecord(payload);
    return {
        associationName: parseOptionalNullableString(data, 'associationName'),
        paymentMethodId: parseOptionalNullableString(data, 'paymentMethodId'),
        operationDate: parseOptionalIsoDate(data, 'operationDate'),
        notes: parseOptionalNullableString(data, 'notes'),
    };
}
//# sourceMappingURL=handicap.use-cases.js.map