import { assertCondition } from '../domain/errors.js';
/**
 * Una cuota incluida en un plan de pagos parciales queda reservada para ese plan
 * mientras el plan siga pendiente. Evita cobrarla tambien por Renovaciones u otra via.
 */
export async function getActivePartialPlanIdForCharge(dataAccess, charge) {
    const planId = charge.activePartialPlanId;
    if (!planId)
        return null;
    const plan = await dataAccess.financialMovements.getById(planId);
    return plan && plan.installmentRole === 'charge' && plan.status === 'pending' ? plan.id : null;
}
export async function assertChargeNotLockedByPartialPlan(dataAccess, charge, allowedPlanId) {
    const activePlanId = await getActivePartialPlanIdForCharge(dataAccess, charge);
    assertCondition(!activePlanId || activePlanId === allowedPlanId, 'failed-precondition', `La cuota ${charge.period} tiene un plan de pagos parciales activo. Registra los abonos restantes desde el detalle del plan en lugar de cobrarla por otra via.`, { installmentPlanId: activePlanId });
}
//# sourceMappingURL=member-fee-plan-lock.js.map