import type { Timestamp } from 'firebase-admin/firestore';

export type UID = string;
export type DocId = string;
export type AmountMinor = number;

export type TournamentFormat = 'medal' | 'stableford' | 'scramble' | 'laguneada';
export type TournamentStatus = 'draft' | 'scheduled' | 'registration_open' | 'registration_closed' | 'in_progress' | 'results_review' | 'finished';
export type TournamentStartType = 'regular' | 'simultaneous';
export type TournamentRegistrationStatus = 'pending_approval' | 'pending_payment' | 'confirmed' | 'cancelled' | 'waitlisted';
export type TournamentRegistrationPaymentStatus = 'unpaid' | 'paid' | 'refunded';
export type TournamentRegistrationOrigin = 'member' | 'external';
export type TournamentRegistrationApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export type TournamentReceiptStatus = 'issued' | 'voided';
export type TournamentPaymentMethodId =
  | 'cash'
  | 'transfer_macro'
  | 'qr_macro'
  | 'transfer_galicia'
  | 'qr_galicia'
  | 'debit_galicia'
  | 'credit_galicia';

export interface AuditFields {
  createdAt: Timestamp;
  createdBy: UID;
  updatedAt: Timestamp;
  updatedBy: UID;
  isDeleted?: boolean;
  deletedAt?: Timestamp;
  deletedBy?: UID;
}

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

export interface TournamentDocument extends AuditFields {
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
}

export interface TournamentRegistrationDocument extends AuditFields {
  tournamentId: DocId;
  tournamentNameSnapshot: string;
  tournamentDate: Timestamp;
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
  registeredAt: Timestamp;
  approvedAt?: Timestamp | null;
  approvedByUid?: UID | null;
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
