export type AmountMinor = number;
export type DocId = string;
export type UID = string;
export type TournamentFormat = 'medal' | 'stableford' | 'scramble' | 'laguneada';
export type TournamentStatus = 'draft' | 'scheduled' | 'registration_open' | 'registration_closed' | 'in_progress' | 'results_review' | 'finished';
export type TournamentStartType = 'regular' | 'simultaneous';
export type TournamentRegistrationStatus = 'pending_approval' | 'pending_payment' | 'confirmed' | 'cancelled' | 'waitlisted';
export type TournamentRegistrationPaymentStatus = 'unpaid' | 'paid' | 'refunded';
export type TournamentRegistrationOrigin = 'member' | 'external';
export type TournamentRegistrationApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export type TournamentPaymentMethodId =
  | 'cash'
  | 'transfer_macro'
  | 'qr_macro'
  | 'transfer_galicia'
  | 'qr_galicia'
  | 'debit_galicia'
  | 'credit_galicia';

export type EntityWithId<T extends object> = T & { id: DocId };

export interface TournamentFlight {
  name: string;
  minHandicap?: number;
  maxHandicap: number;
}

export interface TournamentCategory {
  name: string;
  gender: 'male' | 'female' | 'mixed';
  flights: TournamentFlight[];
}

export interface TournamentLeaderboardRow {
  registrationId?: DocId;
  memberNumber?: string | null;
  teeOrder?: number | null;
  player: string;
  category: string;
  gross: number;
  handicap: number;
  net: number;
  status: 'provisional' | 'final';
}

export interface TournamentTeeWindow {
  first: string;
  last: string;
  interval: number;
}

export interface TournamentTeeWindows {
  morning: TournamentTeeWindow;
  afternoon: TournamentTeeWindow;
}

export interface TournamentCostItem {
  id: string;
  concept: string;
  amountMinor: AmountMinor;
}

export interface TournamentDocument {
  name: string;
  date: string;
  status: TournamentStatus;
  format: TournamentFormat;
  startType: TournamentStartType;
  capacity: number;
  registered: number;
  openDaysBefore: number;
  membersOnly: boolean;
  allowNoHandicap: boolean;
  recurring: boolean;
  recurrencePeriod?: 'weekly' | 'biweekly' | 'monthly' | 'annual' | null;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  registrationFeeMinor: AmountMinor;
  reducedRegistrationFeeMinor?: AmountMinor;
  operatingCostMinor: AmountMinor;
  operatingCostItems?: TournamentCostItem[];
  prizeCostMinor: AmountMinor;
  costNotes?: string | null;
  teeWindow: TournamentTeeWindow;
  teeWindows?: TournamentTeeWindows;
  categories: TournamentCategory[];
  pendingCards: number;
  approvedCards: number;
  leaderboard: TournamentLeaderboardRow[];
  isDeleted?: boolean;
  createdAt?: unknown;
  createdBy?: UID;
  updatedAt?: unknown;
  updatedBy?: UID;
}

export interface TournamentRegistrationDocument {
  tournamentId: DocId;
  tournamentNameSnapshot: string;
  tournamentDate: string;
  userId: UID;
  memberId?: DocId | null;
  participantName: string;
  participantEmail?: string | null;
  participantEmailNormalized?: string | null;
  origin: TournamentRegistrationOrigin;
  approvalStatus?: TournamentRegistrationApprovalStatus | null;
  externalPhone?: string | null;
  externalGender?: 'male' | 'female' | 'mixed' | null;
  externalHandicap?: number | null;
  externalAagLicense?: string | null;
  amountMinor: AmountMinor;
  status: TournamentRegistrationStatus;
  paymentStatus: TournamentRegistrationPaymentStatus;
  receiptId?: DocId | null;
  financialMovementId?: DocId | null;
  registeredAt: string;
  paidAt?: string | null;
  paymentMethodId?: TournamentPaymentMethodId | null;
  paymentReference?: string | null;
  notes?: string | null;
  approvedAt?: string | null;
  approvedByUid?: UID | null;
}

export interface TournamentReceiptDocument {
  registrationId: DocId;
  tournamentId: DocId;
  receiptNumber: string;
  amountMinor: AmountMinor;
  paymentMethodId: TournamentPaymentMethodId;
  movementId: DocId;
  issuedAt: string;
}

export interface RegisterTournamentParticipantPayload {
  tournamentId: string;
  memberId?: string | null;
  participantName?: string | null;
  participantEmail?: string | null;
  notes?: string | null;
}

export interface RegisterTournamentParticipantResult {
  registrationId: string;
  duplicate: boolean;
  paymentStatus: TournamentRegistrationPaymentStatus;
  status: TournamentRegistrationStatus;
  amountMinor: AmountMinor;
  tournamentName: string;
}

export interface RegisterExternalTournamentParticipantPayload {
  tournamentId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  handicap?: number | null;
  aagLicense?: string | null;
  amountMinor?: AmountMinor;
  managedByStaff?: boolean;
  notes?: string | null;
}

export interface RegisterExternalTournamentParticipantResult {
  registrationId: string;
  duplicate: boolean;
  paymentStatus: TournamentRegistrationPaymentStatus;
  status: TournamentRegistrationStatus;
  amountMinor: AmountMinor;
  tournamentName: string;
}

export interface ApproveTournamentRegistrationPayload {
  registrationId: string;
}

export interface ApproveTournamentRegistrationResult {
  registrationId: string;
  duplicate: boolean;
  status: TournamentRegistrationStatus;
  paymentStatus: TournamentRegistrationPaymentStatus;
  userId: string;
  tournamentName: string;
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
  userId: string;
  tournamentName: string;
}
