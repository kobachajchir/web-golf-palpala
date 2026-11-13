import { assertCondition } from '../domain/errors.js';
import type { MemberFeeChargeDocument } from '../domain/models.js';
import type { AccountingDataAccess } from '../domain/ports.js';

/**
 * Una cuota incluida en un plan de pagos parciales queda reservada para ese plan
 * mientras el plan siga pendiente. Evita cobrarla tambien por Renovaciones u otra via.
 */
export async function getActivePartialPlanIdForCharge(
  dataAccess: AccountingDataAccess,
  charge: Pick<MemberFeeChargeDocument, 'activePartialPlanId'>,
): Promise<string | null> {
  const planId = charge.activePartialPlanId;
  if (!planId) return null;
  const plan = await dataAccess.financialMovements.getById(planId);
  return plan && plan.installmentRole === 'charge' && plan.status === 'pending' ? plan.id : null;
}

export async function assertChargeNotLockedByPartialPlan(
  dataAccess: AccountingDataAccess,
  charge: Pick<MemberFeeChargeDocument, 'activePartialPlanId' | 'period'>,
  allowedPlanId?: string | null,
) {
  const activePlanId = await getActivePartialPlanIdForCharge(dataAccess, charge);
  assertCondition(
    !activePlanId || activePlanId === allowedPlanId,
    'failed-precondition',
    `La cuota ${charge.period} tiene un plan de pagos parciales activo. Registra los abonos restantes desde el detalle del plan en lugar de cobrarla por otra via.`,
    { businessCode: 'ACTIVE_PAYMENT_PLAN', action: 'OPEN_PLAN', installmentPlanId: activePlanId },
  );
}
