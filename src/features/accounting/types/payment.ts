import type {
  AccountingPeriod,
  DocId,
  PaymentMethodDocument,
} from '../../../modules/accounting/domain/models';

export type OpenItemKind = 'member_fee_charge' | 'manual_income';

export type OpenItem = {
  id: DocId;
  kind: OpenItemKind;
  memberId: DocId | null;
  period?: AccountingPeriod;
  description: string;
  amountMinor: number;
  settlementLocked?: boolean;
  isGenerated?: boolean;
  status: 'pending' | 'overdue' | 'ready' | 'paid';
  dueLabel?: string;
};

export type PaymentMethod = PaymentMethodDocument & { id: DocId };

export type ManualPaymentRequest = {
  memberId: string;
  openItemIds: string[];
  paymentMethodId: string;
  paymentDate: string;
  reference?: string | null;
  amount: number;
  allocationAmountsByChargeId?: Record<string, number>;
  settlementAmountsByChargeId?: Record<string, number>;
  periodAllocations?: Array<{
    period: AccountingPeriod;
    amountMinor: number;
    settlementAmountMinor?: number;
  }>;
  applyEarlyPaymentDiscount?: boolean;
  notes?: string | null;
};

export type ManualPaymentReceipt = {
  movementIds: string[];
  receiptNumbers: string[];
  totalAmountMinor: number;
  duplicate: boolean;
};

export type PaymentComposerState = {
  selectedOpenItemIds: string[];
  paymentMethodId: string | null;
  paymentDate: string;
  reference: string;
  notes: string;
  isSubmitting: boolean;
};
