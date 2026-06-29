import type {
  AccountingPeriod,
  CreateMercadoPagoCheckoutResult,
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
  status: 'pending' | 'overdue' | 'ready' | 'paid';
  dueLabel?: string;
};

export type PaymentMethod = PaymentMethodDocument & { id: DocId };

export type PaymentComposerMode = 'manual' | 'mercadopago';

export type CheckoutSession = CreateMercadoPagoCheckoutResult & {
  totalAmountMinor: number;
  itemCount: number;
};

export type ManualPaymentRequest = {
  memberId: string;
  openItemIds: string[];
  paymentMethodId: string;
  paymentDate: string;
  reference?: string | null;
  amount: number;
  notes?: string | null;
};

export type ManualPaymentReceipt = {
  movementIds: string[];
  receiptNumbers: string[];
  totalAmountMinor: number;
  duplicate: boolean;
};

export type MercadoPagoCheckoutRequest = {
  memberId: string;
  openItemIds: string[];
  returnBaseUrl?: string;
  payer?: {
    name?: string;
    email?: string;
  };
};

export type PaymentComposerState = {
  selectedOpenItemIds: string[];
  paymentMethodId: string | null;
  paymentDate: string;
  reference: string;
  notes: string;
  mode: PaymentComposerMode;
  isSubmitting: boolean;
  checkoutSession: CheckoutSession | null;
};
