import { Timestamp } from 'firebase-admin/firestore';
import { PAYMENT_METHOD_IDS } from '../domain/constants.js';
import { assertCondition } from '../domain/errors.js';
import { calculateAmountFromBps, toAccountingPeriod } from './shared.js';
export async function createPostedMovement(params) {
    const paymentMethod = params.paymentMethodId
        ? await params.dataAccess.paymentMethods.getById(params.paymentMethodId)
        : null;
    if (params.paymentMethodId) {
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.paymentMethodId}.`);
        assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.paymentMethodId} está inactivo.`);
    }
    let appliedCommissionPctBps = null;
    let appliedCommissionAmountMinor = null;
    let netAmountMinor = params.grossAmountMinor;
    if (params.applyPaymentCommission === true
        && paymentMethod?.id === PAYMENT_METHOD_IDS.credit) {
        const activeRule = await params.dataAccess.paymentCommissionRules.getActiveByPaymentMethodId(paymentMethod.id);
        assertCondition(activeRule, 'failed-precondition', 'No existe una regla de comisión activa para crédito.');
        appliedCommissionPctBps = activeRule.percentageBps;
        appliedCommissionAmountMinor = calculateAmountFromBps(params.grossAmountMinor, activeRule.percentageBps);
        netAmountMinor = params.grossAmountMinor - appliedCommissionAmountMinor;
    }
    const operationTimestamp = Timestamp.fromDate(params.operationDate);
    const approvedAtDate = params.approvedAt ?? params.operationDate;
    const movementId = await params.dataAccess.financialMovements.create({
        movementType: params.movementType,
        categoryId: params.categoryId,
        categoryCodeSnapshot: params.categoryCodeSnapshot,
        status: 'posted',
        operationDate: operationTimestamp,
        postingDate: Timestamp.fromDate(approvedAtDate),
        accountingPeriod: toAccountingPeriod(params.operationDate),
        originType: params.originType,
        originCollection: params.originCollection ?? null,
        originId: params.originId ?? null,
        thirdPartyType: params.thirdPartyType ?? null,
        thirdPartyId: params.thirdPartyId ?? null,
        paymentMethodId: paymentMethod?.id ?? null,
        paymentMethodCodeSnapshot: paymentMethod?.id ?? null,
        grossAmountMinor: params.grossAmountMinor,
        appliedCommissionPctBps,
        appliedCommissionAmountMinor,
        netAmountMinor,
        bancarizado: params.bancarizado,
        imputableImpositivo: params.imputableImpositivo,
        settlementId: params.settlementId ?? null,
        registeredByUid: params.actorUid,
        approvedByUid: params.approvedByUid ?? params.actorUid,
        approvedAt: Timestamp.fromDate(approvedAtDate),
        reversalOfMovementId: null,
        voidReason: null,
        metadata: params.metadata,
        notes: params.notes ?? null,
    }, params.actorUid);
    return {
        movementId,
        grossAmountMinor: params.grossAmountMinor,
        netAmountMinor,
        appliedCommissionPctBps,
        appliedCommissionAmountMinor,
        paymentMethodCodeSnapshot: paymentMethod?.id ?? null,
    };
}
export function buildMovementPatchForVoid(params) {
    return {
        status: 'voided',
        voidReason: params.reason,
    };
}
//# sourceMappingURL=movement-helpers.js.map