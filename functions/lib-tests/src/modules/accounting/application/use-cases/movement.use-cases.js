import { Timestamp } from 'firebase-admin/firestore';
import { ACCOUNTING_COLLECTIONS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureDirectivo, parseRequiredString, } from '../shared.js';
import { buildMovementPatchForVoid } from '../movement-helpers.js';
function reverseMovementType(movementType) {
    return movementType === 'income' ? 'expense' : 'income';
}
export async function voidFinancialMovementUseCase(params) {
    const actor = ensureDirectivo(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const movement = await dataAccess.financialMovements.getById(params.input.movementId);
        assertCondition(movement, 'not-found', `No existe financial_movements/${params.input.movementId}.`);
        if (movement.status === 'voided') {
            return {
                movementId: movement.id,
                duplicate: true,
            };
        }
        if (movement.status !== 'posted') {
            await dataAccess.financialMovements.update(movement.id, buildMovementPatchForVoid({
                existingMovement: movement,
                reason: params.input.reason,
            }), actor.uid);
            return {
                movementId: movement.id,
                duplicate: false,
            };
        }
        const reversalMovementId = await dataAccess.financialMovements.create({
            movementType: reverseMovementType(movement.movementType),
            categoryId: movement.categoryId,
            categoryCodeSnapshot: movement.categoryCodeSnapshot,
            status: 'posted',
            operationDate: Timestamp.fromDate(new Date()),
            postingDate: Timestamp.fromDate(new Date()),
            accountingPeriod: movement.accountingPeriod,
            originType: 'movement_reversal',
            originCollection: ACCOUNTING_COLLECTIONS.financialMovements,
            originId: movement.id,
            thirdPartyType: movement.thirdPartyType ?? null,
            thirdPartyId: movement.thirdPartyId ?? null,
            paymentMethodId: movement.paymentMethodId ?? null,
            paymentMethodCodeSnapshot: movement.paymentMethodCodeSnapshot ?? null,
            grossAmountMinor: movement.grossAmountMinor,
            appliedCommissionPctBps: movement.appliedCommissionPctBps ?? null,
            appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor ?? null,
            netAmountMinor: movement.netAmountMinor,
            bancarizado: movement.bancarizado,
            imputableImpositivo: movement.imputableImpositivo,
            settlementId: movement.settlementId ?? null,
            registeredByUid: actor.uid,
            approvedByUid: actor.uid,
            approvedAt: Timestamp.fromDate(new Date()),
            reversalOfMovementId: movement.id,
            voidReason: null,
            metadata: {
                reversesMovementId: movement.id,
            },
            notes: `Reverso de ${movement.id}.`,
        }, actor.uid);
        await dataAccess.financialMovements.update(movement.id, {
            status: 'voided',
            voidReason: params.input.reason,
        }, actor.uid);
        if (movement.originCollection === 'member_fee_charges' && movement.originId) {
            await dataAccess.memberFeeCharges.update(movement.originId, {
                status: 'pending',
                paidMovementId: null,
            }, actor.uid);
        }
        if (movement.originCollection === 'handicap_charges' && movement.originId) {
            const handicapCharge = await dataAccess.handicapCharges.getById(movement.originId);
            if (handicapCharge) {
                await dataAccess.handicapCharges.update(handicapCharge.id, movement.movementType === 'income'
                    ? { incomeMovementId: null, status: 'pending_collection' }
                    : { expenseMovementId: null, status: handicapCharge.incomeMovementId ? 'collected' : 'pending_collection' }, actor.uid);
            }
        }
        if (movement.originCollection === 'expense_submissions' && movement.originId) {
            await dataAccess.expenseSubmissions.update(movement.originId, {
                status: 'approved',
                linkedMovementId: null,
            }, actor.uid);
        }
        return {
            movementId: movement.id,
            reversalMovementId,
            duplicate: false,
        };
    });
}
export function parseVoidFinancialMovementInput(payload) {
    const data = assertIsRecord(payload);
    return {
        movementId: parseRequiredString(data, 'movementId'),
        reason: parseRequiredString(data, 'reason'),
    };
}
//# sourceMappingURL=movement.use-cases.js.map