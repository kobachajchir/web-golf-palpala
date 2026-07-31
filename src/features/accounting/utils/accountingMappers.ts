import type { EntityWithId, MemberFeeChargeDocument } from '../../../modules/accounting/domain/models';
import type { OpenItem } from '../types/payment';
import { formatPeriod, formatTimestamp } from './accountingFormatters';

export function memberFeeChargeToOpenItem(charge: EntityWithId<MemberFeeChargeDocument>): OpenItem {
  return {
    id: charge.id,
    kind: 'member_fee_charge',
    memberId: charge.memberId ?? charge.holderMemberId ?? null,
    period: charge.period,
    description: `Cuota societaria ${formatPeriod(charge.period)}`,
    amountMinor: charge.remainingAmountMinor
      ?? Math.max((charge.settlementAmountMinor ?? charge.finalAmountMinor) - (charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0), 0),
    settlementLocked: typeof charge.settlementAmountMinor === 'number',
    status: charge.status === 'overdue' ? 'overdue' : charge.status === 'paid' ? 'paid' : 'pending',
    ...(charge.dueDate ? { dueLabel: `Vence ${formatTimestamp(charge.dueDate)}` } : {}),
  };
}
