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
