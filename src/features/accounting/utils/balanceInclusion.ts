import type { FinancialMovementDocument } from '../../../modules/accounting/domain/models';

export function isMovementExcludedFromBalance(
  movement: Pick<FinancialMovementDocument, 'excludeFromBalance'>,
) {
  return movement.excludeFromBalance === true;
}

export function getMovementBalanceRowClassName(
  movement: Pick<FinancialMovementDocument, 'excludeFromBalance'>,
) {
  return isMovementExcludedFromBalance(movement) ? 'accounting-row--excluded-balance' : '';
}

/**
 * Un movimiento anulado con contraasiento queda `reversed` y su reverso `posted`.
 * Ambos cuentan en los saldos para compensarse entre si.
 */
export function movementCountsTowardBalance(
  movement: Pick<FinancialMovementDocument, 'status' | 'reversalOfMovementId'>,
) {
  return movement.status === 'posted' || (movement.status === 'reversed' && Boolean(movement.reversalOfMovementId));
}
