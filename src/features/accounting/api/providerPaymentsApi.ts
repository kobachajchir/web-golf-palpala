import type { AccountingPeriod, MacroDebitSettlementDocument } from '../../../modules/accounting/domain/models';
import { createMacroDebitSettlementsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';

export async function getSettlements({
  provider,
  dateFrom,
  dateTo,
  status,
  period,
}: {
  provider?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: MacroDebitSettlementDocument['status'];
  period: AccountingPeriod;
}) {
  const repository = createMacroDebitSettlementsRepository();
  const settlements = await repository.listByMonth(period);

  return settlements.filter((settlement) => {
    const providerMatches = !provider || settlement.bankName.toLowerCase().includes(provider.toLowerCase());
    const statusMatches = !status || settlement.status === status;
    const accreditedAt = settlement.accreditedAt?.toDate?.();
    const fromMatches = !dateFrom || !accreditedAt || accreditedAt >= new Date(`${dateFrom}T00:00:00.000-03:00`);
    const toMatches = !dateTo || !accreditedAt || accreditedAt <= new Date(`${dateTo}T23:59:59.999-03:00`);
    return providerMatches && statusMatches && fromMatches && toMatches;
  });
}
