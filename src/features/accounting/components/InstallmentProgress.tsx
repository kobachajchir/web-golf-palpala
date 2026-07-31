import { useEffect, useState } from 'react';
import type { EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import { createFinancialMovementsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { formatCurrency } from '../utils/accountingFormatters';

export function getInstallmentProgress(movement: EntityWithId<FinancialMovementDocument>) {
  const totalAmountMinor = movement.installmentTotalAmountMinor ?? movement.netAmountMinor;
  const paidAmountMinor = Math.min(movement.installmentPaidAmountMinor ?? 0, totalAmountMinor);
  const percentage = totalAmountMinor > 0 ? Math.min(100, Math.round((paidAmountMinor * 100) / totalAmountMinor)) : 0;
  return { totalAmountMinor, paidAmountMinor, percentage };
}

export function InstallmentProgress({ movement, compact = false }: {
  movement: EntityWithId<FinancialMovementDocument>;
  compact?: boolean;
}) {
  const [rootMovement, setRootMovement] = useState(movement);

  useEffect(() => {
    let cancelled = false;
    const planId = movement.installmentPlanId;
    if (!planId || movement.installmentRole === 'charge' || planId === movement.id) {
      setRootMovement(movement);
      return () => {
        cancelled = true;
      };
    }

    void createFinancialMovementsRepository().getById(planId).then((root) => {
      if (!cancelled && root) {
        setRootMovement(root);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [movement]);

  if (!movement.installmentPlanId) {
    return null;
  }

  const progress = getInstallmentProgress(rootMovement);
  return (
    <div className={`accounting-installment-progress ${compact ? 'accounting-installment-progress--compact' : ''}`}>
      <div className="accounting-installment-progress__labels">
        <span>{progress.percentage}% pagado</span>
        {!compact && <small>{formatCurrency(progress.paidAmountMinor)} de {formatCurrency(progress.totalAmountMinor)}</small>}
      </div>
      <div className="accounting-installment-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percentage}>
        <span style={{ width: `${progress.percentage}%` }} />
      </div>
    </div>
  );
}
