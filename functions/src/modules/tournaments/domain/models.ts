import type { Timestamp } from 'firebase-admin/firestore';

export type UID = string;
export type DocId = string;
export type AmountMinor = number;

export type TournamentRegistrationStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'waitlisted';
export type TournamentRegistrationPaymentStatus = 'unpaid' | 'paid' | 'refunded';
export type TournamentReceiptStatus = 'issued' | 'voided';
export type TournamentPaymentMethodId = 'debit_macro' | 'debit' | 'transfer' | 'credit' | 'cash' | 'mercado_pago';

export interface AuditFields {
  createdAt: Timestamp;
  createdBy: UID;
  updatedAt: Timestamp;
  updatedBy: UID;
  isDeleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: UID;
}

export interface TournamentRegistrationDocument extends AuditFields {
  tournamentId: DocId;
  tournamentNameSnapshot: string;
  tournamentDate: Timestamp;
  userId: UID;
  memberId?: DocId | null;
  participantName: string;
  participantEmail?: string | null;
  amountMinor: AmountMinor;
  status: TournamentRegistrationStatus;
  paymentStatus: TournamentRegistrationPaymentStatus;
  receiptId?: DocId | null;
  financialMovementId?: DocId | null;
  registeredAt: Timestamp;
  paidAt?: Timestamp | null;
  paymentMethodId?: TournamentPaymentMethodId | null;
  paymentReference?: string | null;
  notes?: string | null;
}

export interface TournamentReceiptDocument extends AuditFields {
  registrationId: DocId;
  tournamentId: DocId;
  tournamentNameSnapshot: string;
  memberId?: DocId | null;
  userId: UID;
  receiptNumber: string;
  amountMinor: AmountMinor;
  paymentMethodId: TournamentPaymentMethodId;
  paymentReference?: string | null;
  movementId: DocId;
  issuedAt: Timestamp;
  issuedByUid: UID;
  status: TournamentReceiptStatus;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export type EntityWithId<T extends object> = T & { id: DocId };
