export type AmountMinor = number;
export type TournamentRegistrationStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'waitlisted';
export type TournamentRegistrationPaymentStatus = 'unpaid' | 'paid' | 'refunded';
export type TournamentPaymentMethodId = 'debit_macro' | 'debit' | 'transfer' | 'credit' | 'cash';

export interface RegisterTournamentParticipantPayload {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  tournamentStatus?: string;
  memberId?: string | null;
  participantName?: string | null;
  participantEmail?: string | null;
  registrationFeeMinor: AmountMinor;
  notes?: string | null;
}

export interface RegisterTournamentParticipantResult {
  registrationId: string;
  duplicate: boolean;
  paymentStatus: TournamentRegistrationPaymentStatus;
}

export interface RecordTournamentRegistrationPaymentPayload {
  registrationId: string;
  paymentMethodId: TournamentPaymentMethodId;
  operationDate: string;
  amountMinor?: AmountMinor;
  paymentReference?: string | null;
  notes?: string | null;
}

export interface RecordTournamentRegistrationPaymentResult {
  registrationId: string;
  receiptId: string;
  receiptNumber: string;
  movementId: string;
  netAmountMinor: AmountMinor;
  duplicate: boolean;
}
