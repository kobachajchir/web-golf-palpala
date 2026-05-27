export const TOURNAMENTS_COLLECTIONS = {
  tournaments: 'tournaments',
  registrations: 'tournament_registrations',
  receipts: 'tournament_receipts',
} as const;

export const TOURNAMENTS_CALLABLE_NAMES = {
  registerParticipant: 'tournamentsRegisterParticipant',
  recordRegistrationPayment: 'tournamentsRecordRegistrationPayment',
} as const;
