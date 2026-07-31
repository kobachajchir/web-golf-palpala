import { ACCOUNTING_EXPENSE_CATEGORY_IDS } from '../../../modules/accounting/domain/constants';
import type { AccountingPeriod, EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import { getCurrentAccountingPeriod } from './accountingFormatters';
import { isMovementExcludedFromBalance } from './balanceInclusion';

export const DEFAULT_SERVER_EXPENSE_DUE_DAY = 20;
export const DEFAULT_SERVER_MONTHLY_USD_MINOR = 6500;

function getClubDayOfMonth(date: Date) {
  const dayText = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
  }).format(date);
  return Number(dayText);
}

function formatUsdMinor(value: number | null | undefined) {
  const normalized = value && value > 0 ? value : DEFAULT_SERVER_MONTHLY_USD_MINOR;
  return `USD ${(normalized / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

export function hasPostedServerExpense(movements: Array<EntityWithId<FinancialMovementDocument>>) {
  return movements.some((movement) => (
    movement.movementType === 'expense'
    && movement.status === 'posted'
    && !isMovementExcludedFromBalance(movement)
    && (
      movement.categoryId === ACCOUNTING_EXPENSE_CATEGORY_IDS.servidor
      || movement.categoryCodeSnapshot === ACCOUNTING_EXPENSE_CATEGORY_IDS.servidor
    )
  ));
}

export function getServerExpenseAlertMessage(
  period: AccountingPeriod | null | undefined,
  movements: Array<EntityWithId<FinancialMovementDocument>>,
  configuredAmountMinor?: number | null,
  configuredDueDay?: number | null,
  now = new Date(),
) {
  if (!period || period !== getCurrentAccountingPeriod(now)) {
    return null;
  }
  const dueDay = configuredDueDay && configuredDueDay >= 1 ? configuredDueDay : DEFAULT_SERVER_EXPENSE_DUE_DAY;
  if (getClubDayOfMonth(now) <= dueDay) {
    return null;
  }
  if (hasPostedServerExpense(movements)) {
    return null;
  }

  return `Alerta: no se registro el egreso SERVIDOR de este mes. Vencimiento: dia ${dueDay}. Monto configurado: ${formatUsdMinor(configuredAmountMinor)}.`;
}
