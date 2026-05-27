import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { UiActionButton } from '../components/UiActionButton';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import { createTournamentCallables } from '../modules/tournaments/functions/tournaments.callables';
import type { TournamentPaymentMethodId } from '../modules/tournaments/domain/models';

type TournamentFormat = 'medal' | 'stableford' | 'scramble' | 'laguneada';
type TournamentStatus = 'draft' | 'scheduled' | 'registration_open' | 'registration_closed' | 'in_progress' | 'finished';
type StartType = 'regular' | 'simultaneous';
type TournamentTab = 'calendar' | 'leaderboard' | 'settings' | 'details';

const TOURNAMENT_TABS: readonly TournamentTab[] = ['calendar', 'leaderboard', 'settings', 'details'];
const TOURNAMENT_STATUS_FILTERS: ReadonlyArray<'all' | TournamentStatus> = [
  'all',
  'draft',
  'scheduled',
  'registration_open',
  'registration_closed',
  'in_progress',
  'finished',
];

function isTournamentTab(value: string | null): value is TournamentTab {
  return Boolean(value && TOURNAMENT_TABS.includes(value as TournamentTab));
}

function isTournamentStatusFilter(value: string | null): value is 'all' | TournamentStatus {
  return Boolean(value && TOURNAMENT_STATUS_FILTERS.includes(value as 'all' | TournamentStatus));
}

type Flight = {
  name: string;
  minHandicap?: number;
  maxHandicap: number;
};

type TournamentCategory = {
  name: string;
  gender: 'male' | 'female' | 'mixed';
  flights: Flight[];
};

type TournamentLeaderboardRow = {
  player: string;
  category: string;
  gross: number;
  handicap: number;
  net: number;
  status: 'provisional' | 'final';
};

type TeeWindow = {
  first: string;
  last: string;
  interval: number;
};

type TournamentTeeWindows = {
  morning: TeeWindow;
  afternoon: TeeWindow;
};

type TournamentCostItem = {
  id: string;
  concept: string;
  amountMinor: number;
};

type Tournament = {
  id: string;
  name: string;
  date: string;
  status: TournamentStatus;
  format: TournamentFormat;
  startType: StartType;
  capacity: number;
  registered: number;
  openDaysBefore: number;
  membersOnly: boolean;
  allowNoHandicap: boolean;
  recurring: boolean;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  registrationFeeMinor: number;
  reducedRegistrationFeeMinor?: number;
  operatingCostMinor: number;
  operatingCostItems?: TournamentCostItem[];
  prizeCostMinor: number;
  costNotes?: string | null;
  teeWindow: TeeWindow;
  teeWindows?: TournamentTeeWindows;
  categories: TournamentCategory[];
  pendingCards: number;
  approvedCards: number;
  leaderboard: TournamentLeaderboardRow[];
};

type TournamentDraft = {
  name: string;
  date: string;
  format: TournamentFormat;
  startType: StartType;
  capacity: string;
  openDaysBefore: string;
  membersOnly: boolean;
  allowNoHandicap: boolean;
  recurring: boolean;
  registrationOpenAt: string;
  registrationCloseAt: string;
  registrationFee: string;
  reducedRegistrationFee: string;
  morningFirstTeeTime: string;
  morningLastTeeTime: string;
  afternoonFirstTeeTime: string;
  afternoonLastTeeTime: string;
  interval: string;
  recurrencePeriod: 'weekly' | 'biweekly' | 'monthly';
  categories: TournamentDraftCategory[];
};

type TournamentDraftCategory = {
  id: string;
  gender: 'male' | 'female';
  name: string;
  minHandicap: string;
  maxHandicap: string;
};

type TournamentCostDraft = {
  registrationFee: string;
  reducedRegistrationFee: string;
  operatingCostConcept: string;
  operatingCostAmount: string;
  operatingCostItems: TournamentCostItem[];
  extraCost: string;
  costNotes: string;
};

type PendingTournamentStatusAction = {
  tournamentId: string;
  tournamentName: string;
  nextStatus: 'registration_open' | 'registration_closed';
};

type PendingTournamentCostAction = {
  tournamentId: string;
  tournamentName: string;
  registrationFeeMinor: number;
  reducedRegistrationFeeMinor: number;
  operatingCostMinor: number;
  operatingCostItems: TournamentCostItem[];
  prizeCostMinor: number;
  costNotes: string | null;
};

type TournamentRegistrationStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'waitlisted';
type TournamentRegistrationPaymentStatus = 'unpaid' | 'paid' | 'refunded';

type TournamentRegistrationRecord = {
  id: string;
  tournamentId: string;
  tournamentNameSnapshot: string;
  tournamentDate: string;
  userId: string;
  memberId?: string | null;
  participantName: string;
  participantEmail?: string | null;
  amountMinor: number;
  status: TournamentRegistrationStatus;
  paymentStatus: TournamentRegistrationPaymentStatus;
  receiptId?: string | null;
  financialMovementId?: string | null;
  registeredAt: string;
  paidAt?: string | null;
  paymentMethodId?: TournamentPaymentMethodId | null;
  paymentReference?: string | null;
  notes?: string | null;
};

type TournamentReceiptRecord = {
  id: string;
  registrationId: string;
  tournamentId: string;
  receiptNumber: string;
  amountMinor: number;
  paymentMethodId: TournamentPaymentMethodId;
  movementId: string;
  issuedAt: string;
};

type TournamentPaymentDraft = {
  paymentMethodId: TournamentPaymentMethodId;
  operationDate: string;
  amount: string;
  paymentReference: string;
  notes: string;
};

type TournamentScorecardDraft = {
  player: string;
  category: string;
  gross: string;
  handicap: string;
  net: string;
};

type IconType =
  | 'calendar'
  | 'check'
  | 'clock'
  | 'chevron'
  | 'flag'
  | 'list'
  | 'minus'
  | 'plus'
  | 'search'
  | 'settings'
  | 'score'
  | 'trophy'
  | 'users';

const TOURNAMENT_FORMATS: Array<{
  value: TournamentFormat;
  label: string;
  helper: string;
}> = [
  { value: 'medal', label: 'Medal', helper: 'Score por golpes, gana el menor neto.' },
  { value: 'stableford', label: 'Stableford', helper: 'Puntos por hoyo segun resultado.' },
  { value: 'scramble', label: 'Scramble', helper: 'Juego por equipos con mejor pelota.' },
  { value: 'laguneada', label: 'Laguneada', helper: 'Formato social por equipos.' },
];

const STATUS_OPTIONS: Array<{ value: 'all' | TournamentStatus; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'registration_open', label: 'Inscripcion abierta' },
  { value: 'registration_closed', label: 'Inscripcion cerrada' },
  { value: 'scheduled', label: 'Programados' },
  { value: 'in_progress', label: 'En juego' },
  { value: 'finished', label: 'Finalizados' },
  { value: 'draft', label: 'Borradores' },
];

const TOURNAMENT_PAYMENT_METHODS: Array<{ value: TournamentPaymentMethodId; label: string; requiresReference: boolean }> = [
  { value: 'cash', label: 'Efectivo', requiresReference: false },
  { value: 'transfer', label: 'Transferencia', requiresReference: true },
  { value: 'credit', label: 'Credito', requiresReference: true },
  { value: 'debit', label: 'Debito', requiresReference: true },
  { value: 'debit_macro', label: 'Debito Macro', requiresReference: true },
];

const tournamentCallables = createTournamentCallables();

const COURSE_SETTINGS = {
  morningFirstTeeTime: '07:00',
  morningLastTeeTime: '12:00',
  afternoonFirstTeeTime: '14:00',
  afternoonLastTeeTime: '17:00',
  interval: 8,
  courseOpen: true,
  membersOnly: false,
  cancelHours: 24,
  maxNoShows: 3,
};

const DEFAULT_TOURNAMENT_CATEGORIES: TournamentDraftCategory[] = [
  { id: 'men-1', gender: 'male', name: 'Categoria 1', minHandicap: '0', maxHandicap: '12' },
  { id: 'men-2', gender: 'male', name: 'Categoria 2', minHandicap: '13', maxHandicap: '24' },
  { id: 'women-1', gender: 'female', name: 'Categoria 1', minHandicap: '0', maxHandicap: '18' },
  { id: 'women-2', gender: 'female', name: 'Categoria 2', minHandicap: '19', maxHandicap: '36' },
];

const INITIAL_TOURNAMENTS: Tournament[] = [
  {
    id: 'apertura-palpala-2026',
    name: 'Apertura Palpala 2026',
    date: '2026-05-24',
    status: 'registration_open',
    format: 'medal',
    startType: 'regular',
    capacity: 72,
    registered: 48,
    openDaysBefore: 14,
    membersOnly: false,
    allowNoHandicap: true,
    recurring: false,
    registrationOpenAt: '2026-05-10',
    registrationCloseAt: '2026-05-22',
    registrationFeeMinor: 1500000,
    reducedRegistrationFeeMinor: 1000000,
    operatingCostMinor: 4500000,
    operatingCostItems: [
      { id: 'apertura-cancha', concept: 'Preparacion de cancha', amountMinor: 2600000 },
      { id: 'apertura-staff', concept: 'Staff de salida', amountMinor: 1900000 },
    ],
    prizeCostMinor: 1200000,
    costNotes: 'Incluye extras de refrigerio.',
    teeWindow: { first: '07:20', last: '12:24', interval: 8 },
    categories: [
      {
        name: 'Caballeros',
        gender: 'male',
        flights: [
          { name: '0 a 12', maxHandicap: 12 },
          { name: '13 a 24', maxHandicap: 24 },
        ],
      },
      {
        name: 'Damas',
        gender: 'female',
        flights: [
          { name: '0 a 18', maxHandicap: 18 },
          { name: '19 a 36', maxHandicap: 36 },
        ],
      },
    ],
    pendingCards: 0,
    approvedCards: 0,
    leaderboard: [],
  },
  {
    id: 'stableford-invierno-2026',
    name: 'Stableford de Invierno',
    date: '2026-06-07',
    status: 'scheduled',
    format: 'stableford',
    startType: 'regular',
    capacity: 56,
    registered: 18,
    openDaysBefore: 10,
    membersOnly: true,
    allowNoHandicap: false,
    recurring: false,
    registrationOpenAt: '2026-05-28',
    registrationCloseAt: '2026-06-05',
    registrationFeeMinor: 1200000,
    reducedRegistrationFeeMinor: 800000,
    operatingCostMinor: 2800000,
    operatingCostItems: [
      { id: 'stableford-cancha', concept: 'Marcacion y control', amountMinor: 1800000 },
      { id: 'stableford-administracion', concept: 'Administracion del torneo', amountMinor: 1000000 },
    ],
    prizeCostMinor: 900000,
    costNotes: null,
    teeWindow: { first: '08:00', last: '11:44', interval: 8 },
    categories: [
      {
        name: 'Mixta',
        gender: 'mixed',
        flights: [
          { name: 'Hasta 18', maxHandicap: 18 },
          { name: '19 a 36', maxHandicap: 36 },
        ],
      },
    ],
    pendingCards: 0,
    approvedCards: 0,
    leaderboard: [],
  },
  {
    id: 'laguneada-aniversario-2026',
    name: 'Laguneada Aniversario',
    date: '2026-05-10',
    status: 'in_progress',
    format: 'laguneada',
    startType: 'simultaneous',
    capacity: 80,
    registered: 76,
    openDaysBefore: 21,
    membersOnly: false,
    allowNoHandicap: true,
    recurring: false,
    registrationOpenAt: '2026-04-19',
    registrationCloseAt: '2026-05-08',
    registrationFeeMinor: 1800000,
    reducedRegistrationFeeMinor: 1200000,
    operatingCostMinor: 6100000,
    operatingCostItems: [
      { id: 'laguneada-catering', concept: 'Catering operativo', amountMinor: 3200000 },
      { id: 'laguneada-cancha', concept: 'Preparacion especial', amountMinor: 2900000 },
    ],
    prizeCostMinor: 2200000,
    costNotes: 'Salida simultanea con catering.',
    teeWindow: { first: '09:00', last: '09:00', interval: 8 },
    categories: [
      {
        name: 'Equipos',
        gender: 'mixed',
        flights: [
          { name: 'General', maxHandicap: 54 },
        ],
      },
    ],
    pendingCards: 6,
    approvedCards: 12,
    leaderboard: [
      { player: 'Equipo Norte', category: 'Equipos', gross: 69, handicap: 11, net: 58, status: 'provisional' },
      { player: 'Equipo Quebrada', category: 'Equipos', gross: 71, handicap: 12, net: 59, status: 'provisional' },
      { player: 'Equipo Palpala', category: 'Equipos', gross: 73, handicap: 10, net: 63, status: 'provisional' },
    ],
  },
  {
    id: 'copa-palpala-2025',
    name: 'Copa Palpala 2025',
    date: '2025-08-22',
    status: 'finished',
    format: 'scramble',
    startType: 'regular',
    capacity: 64,
    registered: 64,
    openDaysBefore: 14,
    membersOnly: false,
    allowNoHandicap: true,
    recurring: false,
    registrationOpenAt: '2025-08-08',
    registrationCloseAt: '2025-08-20',
    registrationFeeMinor: 1000000,
    reducedRegistrationFeeMinor: 700000,
    operatingCostMinor: 3500000,
    operatingCostItems: [
      { id: 'copa-operacion', concept: 'Operacion general', amountMinor: 3500000 },
    ],
    prizeCostMinor: 1500000,
    costNotes: null,
    teeWindow: { first: '07:30', last: '12:42', interval: 8 },
    categories: [
      {
        name: 'Equipos',
        gender: 'mixed',
        flights: [
          { name: 'General', maxHandicap: 54 },
        ],
      },
    ],
    pendingCards: 0,
    approvedCards: 18,
    leaderboard: [
      { player: 'Equipo Las Lomas', category: 'Equipos', gross: 66, handicap: 8, net: 58, status: 'final' },
      { player: 'Equipo Los Cedros', category: 'Equipos', gross: 70, handicap: 10, net: 60, status: 'final' },
      { player: 'Equipo Centro', category: 'Equipos', gross: 72, handicap: 9, net: 63, status: 'final' },
    ],
  },
];

const INITIAL_TOURNAMENT_REGISTRATIONS: TournamentRegistrationRecord[] = [
  {
    id: 'reg-apertura-palpala-001',
    tournamentId: 'apertura-palpala-2026',
    tournamentNameSnapshot: 'Apertura Palpala 2026',
    tournamentDate: '2026-05-24',
    userId: 'demo-socio-001',
    memberId: 'demo-socio-001',
    participantName: 'Socio Demo',
    participantEmail: null,
    amountMinor: 1500000,
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    receiptId: null,
    financialMovementId: null,
    registeredAt: '2026-05-13',
    paidAt: null,
    paymentMethodId: null,
    paymentReference: null,
    notes: null,
  },
  {
    id: 'reg-apertura-palpala-002',
    tournamentId: 'apertura-palpala-2026',
    tournamentNameSnapshot: 'Apertura Palpala 2026',
    tournamentDate: '2026-05-24',
    userId: 'demo-socio-002',
    memberId: 'demo-socio-002',
    participantName: 'Invitado Pagado',
    participantEmail: null,
    amountMinor: 1500000,
    status: 'confirmed',
    paymentStatus: 'paid',
    receiptId: 'receipt-apertura-palpala-002',
    financialMovementId: 'movement-demo-tournament-002',
    registeredAt: '2026-05-12',
    paidAt: '2026-05-12',
    paymentMethodId: 'transfer',
    paymentReference: 'TR-20260512-002',
    notes: null,
  },
];

const INITIAL_TOURNAMENT_RECEIPTS: TournamentReceiptRecord[] = [
  {
    id: 'receipt-apertura-palpala-002',
    registrationId: 'reg-apertura-palpala-002',
    tournamentId: 'apertura-palpala-2026',
    receiptNumber: 'TOR-20260512-REGAPERT',
    amountMinor: 1500000,
    paymentMethodId: 'transfer',
    movementId: 'movement-demo-tournament-002',
    issuedAt: '2026-05-12',
  },
];

function createDefaultDraft(): TournamentDraft {
  return {
    name: '',
    date: '',
    format: 'medal',
    startType: 'regular',
    capacity: '72',
    openDaysBefore: '14',
    membersOnly: COURSE_SETTINGS.membersOnly,
    allowNoHandicap: false,
    recurring: false,
    registrationOpenAt: '',
    registrationCloseAt: '',
    registrationFee: '',
    reducedRegistrationFee: '',
    morningFirstTeeTime: COURSE_SETTINGS.morningFirstTeeTime,
    morningLastTeeTime: COURSE_SETTINGS.morningLastTeeTime,
    afternoonFirstTeeTime: COURSE_SETTINGS.afternoonFirstTeeTime,
    afternoonLastTeeTime: COURSE_SETTINGS.afternoonLastTeeTime,
    interval: String(COURSE_SETTINGS.interval),
    recurrencePeriod: 'monthly',
    categories: DEFAULT_TOURNAMENT_CATEGORIES.map((category) => ({ ...category })),
  };
}

function Icon({ type }: { type: IconType }) {
  const icons: Record<IconType, ReactNode> = {
    calendar: (
      <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 22 6.5v12A2.5 2.5 0 0 1 19.5 21h-15A2.5 2.5 0 0 1 2 18.5v-12A2.5 2.5 0 0 1 4.5 4H6V3a1 1 0 0 1 1-1Zm12.5 8h-15v8.5a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5V10ZM5 6a.5.5 0 0 0-.5.5V8h15V6.5A.5.5 0 0 0 19 6H5Z" />
    ),
    check: (
      <path d="M9.2 16.6 4.8 12.2a1 1 0 0 1 1.4-1.4l3 3 8.6-8.6a1 1 0 0 1 1.4 1.4l-9.3 9.3a1 1 0 0 1-1.4 0Z" />
    ),
    clock: (
      <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5a1 1 0 1 0-2 0v5a1 1 0 0 0 .45.83l3.5 2.3a1 1 0 0 0 1.1-1.66L13 11.47V7Z" />
    ),
    chevron: (
      <path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.17l3.9-3.88a1 1 0 1 1 1.4 1.42l-4.6 4.58a1 1 0 0 1-1.4 0L6.7 10.7a1 1 0 0 1 0-1.42Z" />
    ),
    flag: (
      <path d="M5 3a1 1 0 0 1 2 0v1h8.7a1 1 0 0 1 .86 1.5L15 8l1.56 2.5A1 1 0 0 1 15.7 12H7v8a1 1 0 1 1-2 0V3Z" />
    ),
    list: (
      <path d="M5 6.5A1.5 1.5 0 1 1 2 6.5a1.5 1.5 0 0 1 3 0ZM8 5.5h13a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2ZM5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm3-1h13a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Zm-3 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm3-1h13a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Z" />
    ),
    minus: (
      <path d="M5 11h14a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2Z" />
    ),
    plus: (
      <path d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z" />
    ),
    search: (
      <path d="M10.5 4a6.5 6.5 0 0 1 5.15 10.47l4.44 4.44a1 1 0 0 1-1.42 1.42l-4.44-4.44A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
    ),
    settings: (
      <path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8.7 3.2-.93-.54a7.8 7.8 0 0 0-.7-1.7l.28-1.04a1 1 0 0 0-.26-.98l-1.03-1.03a1 1 0 0 0-.98-.26l-1.04.28a7.8 7.8 0 0 0-1.7-.7l-.54-.93A1 1 0 0 0 13.03 3h-2.06a1 1 0 0 0-.87.5l-.54.93a7.8 7.8 0 0 0-1.7.7l-1.04-.28a1 1 0 0 0-.98.26L4.81 6.14a1 1 0 0 0-.26.98l.28 1.04a7.8 7.8 0 0 0-.7 1.7l-.93.54a1 1 0 0 0-.5.87v2.06a1 1 0 0 0 .5.87l.93.54c.17.6.4 1.17.7 1.7l-.28 1.04a1 1 0 0 0 .26.98l1.03 1.03a1 1 0 0 0 .98.26l1.04-.28c.53.3 1.1.53 1.7.7l.54.93a1 1 0 0 0 .87.5h2.06a1 1 0 0 0 .87-.5l.54-.93c.6-.17 1.17-.4 1.7-.7l1.04.28a1 1 0 0 0 .98-.26l1.03-1.03a1 1 0 0 0 .26-.98l-.28-1.04c.3-.53.53-1.1.7-1.7l.93-.54a1 1 0 0 0 .5-.87v-2.06a1 1 0 0 0-.5-.87Z" />
    ),
    score: (
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4v2h10V7H7Zm0 4v2h4v-2H7Zm6 0v2h4v-2h-4Zm-6 4v2h4v-2H7Zm6 0v2h4v-2h-4Z" />
    ),
    trophy: (
      <path d="M7 3h10v2h3a1 1 0 0 1 1 1v2a5 5 0 0 1-5 5h-.28A5 5 0 0 1 13 15.9V19h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.1A5 5 0 0 1 8.28 13H8a5 5 0 0 1-5-5V6a1 1 0 0 1 1-1h3V3Zm0 4H5v1a3 3 0 0 0 2.25 2.9A7.5 7.5 0 0 1 7 9V7Zm10 0v2c0 .66-.09 1.3-.25 1.9A3 3 0 0 0 19 8V7h-2Z" />
    ),
    users: (
      <path d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7 1a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM2 20a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1H2v-1Zm15 1a4 4 0 0 0-2.15-3.54A4.96 4.96 0 0 1 20 21h-3Z" />
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      {icons[type]}
    </svg>
  );
}

function parseTournamentDateTime(date?: string | null) {
  if (!date) {
    return null;
  }

  const parsedDate = new Date(date.includes('T') ? date : `${date}T12:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function formatDate(date?: string | null) {
  const parsedDate = parseTournamentDateTime(date);
  if (!parsedDate) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsedDate);
}

function formatShortDateTime(date?: string | null) {
  const parsedDate = parseTournamentDateTime(date);
  if (!parsedDate) {
    return 'Sin fecha';
  }

  const hasExplicitTime = Boolean(date?.includes('T'));
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    ...(hasExplicitTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(parsedDate);
}

function formatDateTimeForDisplay(date?: string | null) {
  const parsedDate = parseTournamentDateTime(date);
  if (!parsedDate) {
    return 'Sin programar';
  }

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsedDate);
}

function toDateTimeInputValue(date?: string | null, fallbackTime = '09:00') {
  if (!date) {
    return '';
  }

  if (date.includes('T')) {
    return date.slice(0, 16);
  }

  return `${date}T${fallbackTime}`;
}

function formatAmountMinor(amountMinor: number) {
  const formattedAmount = new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);

  return `$${formattedAmount}`;
}

function getRegistrationReference(registration: TournamentRegistrationRecord, receipt?: TournamentReceiptRecord) {
  return receipt?.receiptNumber ?? registration.paymentReference ?? registration.financialMovementId ?? 'Sin referencia';
}

function getParticipantNumber(registration: TournamentRegistrationRecord) {
  return registration.memberId ? registration.memberId.replace(/^demo-socio-/i, 'Socio #') : 'Invitado';
}

function getOccupancyPercentage(tournament: Tournament) {
  return tournament.capacity ? Math.round((tournament.registered / tournament.capacity) * 100) : 0;
}

function parseMoneyToMinor(value: string) {
  const normalizedValue = value.replace(/\./g, '').replace(',', '.').trim();
  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? Math.round(parsedValue * 100) : Number.NaN;
}

function amountMinorToInput(amountMinor: number) {
  return amountMinor > 0 ? String(Math.round(amountMinor / 100)) : '';
}

function getTournamentOperatingCostItems(tournament: Tournament): TournamentCostItem[] {
  if (tournament.operatingCostItems?.length) {
    return tournament.operatingCostItems;
  }

  return tournament.operatingCostMinor > 0
    ? [{ id: `${tournament.id}-operativo`, concept: 'Costos operativos', amountMinor: tournament.operatingCostMinor }]
    : [];
}

function sumTournamentCostItems(items: TournamentCostItem[]) {
  return items.reduce((total, item) => total + item.amountMinor, 0);
}

function getReducedFeeMinor(tournament: Tournament) {
  return tournament.reducedRegistrationFeeMinor ?? tournament.registrationFeeMinor;
}

function userQualifiesForReducedTournamentFee(user: unknown) {
  const profile = user as {
    profileType?: string | null;
    memberTypeCode?: string | null;
    memberTypeCodeSnapshot?: string | null;
    typeCodeSnapshot?: string | null;
    memberTypeLabel?: string | null;
  } | null;
  const memberText = [
    profile?.memberTypeCode,
    profile?.memberTypeCodeSnapshot,
    profile?.typeCodeSnapshot,
    profile?.memberTypeLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return profile?.profileType === 'member' && memberText.includes('menor');
}

function getTournamentRegistrationFee(tournament: Tournament, user: unknown) {
  const isReduced = userQualifiesForReducedTournamentFee(user);
  const reducedAmountMinor = getReducedFeeMinor(tournament);
  return {
    kind: isReduced ? 'reduced' : 'regular',
    label: isReduced ? 'Inscripcion reducida' : 'Inscripcion regular',
    amountMinor: isReduced ? reducedAmountMinor : tournament.registrationFeeMinor,
  };
}

function groupLeaderboardRows(rows: TournamentLeaderboardRow[]) {
  const groups = new Map<string, TournamentLeaderboardRow[]>();
  rows.forEach((row) => {
    const key = row.category || 'General';
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });

  return Array.from(groups.entries())
    .sort(([categoryA], [categoryB]) => categoryA.localeCompare(categoryB))
    .map(([category, groupRows]) => ({
      category,
      rows: groupRows.slice().sort((a, b) => a.net - b.net),
    }));
}

function getTournamentCategoryLabels(tournament: Tournament) {
  return tournament.categories.flatMap((category) =>
    category.flights.map((flight) => `${category.gender === 'female' ? 'Damas' : category.gender === 'male' ? 'Caballeros' : category.name}: ${flight.name}`),
  );
}

function getTournamentFlightLabel(flight: Flight) {
  if (typeof flight.minHandicap === 'number') {
    const categoryName = flight.name.split(':')[0]?.replace(/\(.+\)/, '').trim() || flight.name;
    return `${categoryName}: ${flight.minHandicap} a ${flight.maxHandicap}`;
  }

  return flight.name;
}

function getTodayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

function getPaymentMethodLabel(paymentMethodId?: TournamentPaymentMethodId | null) {
  return TOURNAMENT_PAYMENT_METHODS.find((method) => method.value === paymentMethodId)?.label ?? 'Sin medio';
}

function getRegistrationStatusLabel(registration: TournamentRegistrationRecord) {
  if (registration.paymentStatus === 'paid') {
    return 'Pagada';
  }

  if (registration.status === 'cancelled') {
    return 'Cancelada';
  }

  if (registration.status === 'waitlisted') {
    return 'Lista de espera';
  }

  return 'Pago pendiente';
}

function buildLocalRegistrationId(tournamentId: string, userId: string) {
  return `reg-${tournamentId}-${userId}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function buildLocalReceiptNumber(registrationId: string, operationDate: string) {
  const safeId = registrationId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return `TOR-${operationDate.replace(/-/g, '')}-${safeId}`;
}

function getFormatLabel(format: TournamentFormat) {
  return TOURNAMENT_FORMATS.find((option) => option.value === format)?.label ?? format;
}

function getStatusLabel(status: TournamentStatus) {
  const labels: Record<TournamentStatus, string> = {
    draft: 'Borrador',
    scheduled: 'Programado',
    registration_open: 'Inscripcion abierta',
    registration_closed: 'Inscripcion cerrada',
    in_progress: 'En juego',
    finished: 'Finalizado',
  };

  return labels[status];
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function countTeeSlots(window: TeeWindow) {
  const first = timeToMinutes(window.first);
  const last = timeToMinutes(window.last);
  const interval = Math.max(window.interval, 1);

  if (last < first) {
    return 0;
  }

  return Math.floor((last - first) / interval) + 1;
}

function countTeeWindowsSlots(windows: TournamentTeeWindows) {
  return countTeeSlots(windows.morning) + countTeeSlots(windows.afternoon);
}

function getTournamentTeeWindows(tournament: Tournament): TournamentTeeWindows {
  return tournament.teeWindows ?? {
    morning: tournament.teeWindow,
    afternoon: {
      first: tournament.teeWindow.last,
      last: tournament.teeWindow.last,
      interval: tournament.teeWindow.interval,
    },
  };
}

function createDraftTeeWindows(draft: TournamentDraft): TournamentTeeWindows {
  const interval = Number(draft.interval) || COURSE_SETTINGS.interval;
  return {
    morning: {
      first: draft.morningFirstTeeTime,
      last: draft.morningLastTeeTime,
      interval,
    },
    afternoon: {
      first: draft.afternoonFirstTeeTime,
      last: draft.afternoonLastTeeTime,
      interval,
    },
  };
}

function validateDraftTeeWindows(draft: TournamentDraft): string | null {
  const windows = createDraftTeeWindows(draft);
  const morningStart = timeToMinutes(windows.morning.first);
  const morningEnd = timeToMinutes(windows.morning.last);
  const afternoonStart = timeToMinutes(windows.afternoon.first);
  const afternoonEnd = timeToMinutes(windows.afternoon.last);

  if (morningEnd < morningStart) {
    return 'El cierre de salidas de manana no puede ser anterior al inicio.';
  }

  if (afternoonEnd < afternoonStart) {
    return 'El cierre de salidas de tarde no puede ser anterior al inicio.';
  }

  if (afternoonStart <= morningEnd) {
    return 'El turno tarde debe empezar despues del corte del turno manana.';
  }

  return null;
}

function validateDraftCategories(categories: TournamentDraftCategory[]): string | null {
  const groups: Array<'male' | 'female'> = ['male', 'female'];

  for (const gender of groups) {
    const sortedCategories = categories
      .filter((category) => category.gender === gender)
      .map((category) => ({
        ...category,
        min: Number(category.minHandicap),
        max: Number(category.maxHandicap),
      }))
      .filter((category) => category.name.trim() || category.minHandicap.trim() || category.maxHandicap.trim())
      .sort((a, b) => a.min - b.min);

    if (sortedCategories.length === 0) {
      return gender === 'male'
        ? 'Carga al menos una categoria para caballeros.'
        : 'Carga al menos una categoria para damas.';
    }

    for (const category of sortedCategories) {
      if (!category.name.trim()) {
        return 'Todas las categorias necesitan nombre.';
      }

      if (!Number.isFinite(category.min) || !Number.isFinite(category.max) || category.min < 0 || category.max < 0) {
        return 'Los handicaps de categoria deben ser numeros validos.';
      }

      if (category.max < category.min) {
        return `La categoria ${category.name} tiene maximo menor que minimo.`;
      }
    }

    for (let index = 1; index < sortedCategories.length; index += 1) {
      const previous = sortedCategories[index - 1];
      const current = sortedCategories[index];

      if (!previous || !current) {
        continue;
      }

      if (current.min <= previous.max) {
        return `Las categorias ${previous.name} y ${current.name} se solapan.`;
      }
    }
  }

  return null;
}

function buildTournamentCategories(categories: TournamentDraftCategory[]): TournamentCategory[] {
  const groups: Array<{ gender: 'male' | 'female'; name: string }> = [
    { gender: 'male', name: 'Caballeros' },
    { gender: 'female', name: 'Damas' },
  ];

  return groups.map((group) => ({
    name: group.name,
    gender: group.gender,
    flights: categories
      .filter((category) => category.gender === group.gender)
      .sort((a, b) => Number(a.minHandicap) - Number(b.minHandicap))
      .map((category) => {
        const minHandicap = Number(category.minHandicap);
        const maxHandicap = Number(category.maxHandicap);
        return {
          name: `${category.name.trim()}: ${minHandicap} a ${maxHandicap}`,
          minHandicap,
          maxHandicap,
        };
      }),
  }));
}

function createTournamentFromDraft(draft: TournamentDraft): Tournament {
  const capacity = Number(draft.capacity) || 0;
  const teeWindows = createDraftTeeWindows(draft);
  const registrationFeeMinor = parseMoneyToMinor(draft.registrationFee || '0');
  const reducedRegistrationFeeMinor = parseMoneyToMinor(draft.reducedRegistrationFee || draft.registrationFee || '0');

  return {
    id: `${draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
    name: draft.name.trim(),
    date: draft.date,
    status: 'scheduled',
    format: draft.format,
    startType: draft.startType,
    capacity,
    registered: 0,
    openDaysBefore: 0,
    membersOnly: draft.membersOnly,
    allowNoHandicap: false,
    recurring: draft.recurring,
    registrationOpenAt: draft.registrationOpenAt || null,
    registrationCloseAt: draft.registrationCloseAt || null,
    registrationFeeMinor: Number.isNaN(registrationFeeMinor) ? 0 : registrationFeeMinor,
    reducedRegistrationFeeMinor: Number.isNaN(reducedRegistrationFeeMinor) ? 0 : reducedRegistrationFeeMinor,
    operatingCostMinor: 0,
    operatingCostItems: [],
    prizeCostMinor: 0,
    costNotes: null,
    teeWindow: {
      first: teeWindows.morning.first,
      last: teeWindows.afternoon.last,
      interval: teeWindows.morning.interval,
    },
    teeWindows,
    categories: buildTournamentCategories(draft.categories),
    pendingCards: 0,
    approvedCards: 0,
    leaderboard: [],
  };
}

export function TournamentRegistration() {
  const { interfaceMode, user } = useAuth();
  const [searchParams] = useSearchParams();
  const canManageTournaments = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;
  const requestedTab = searchParams.get('tab');
  const requestedOpen = searchParams.get('open');
  const requestedStatus = searchParams.get('status');
  const [tournaments, setTournaments] = useState<Tournament[]>(INITIAL_TOURNAMENTS);
  const [registrations, setRegistrations] = useState<TournamentRegistrationRecord[]>(INITIAL_TOURNAMENT_REGISTRATIONS);
  const [receipts, setReceipts] = useState<TournamentReceiptRecord[]>(INITIAL_TOURNAMENT_RECEIPTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TournamentStatus>('all');
  const [formatFilter, setFormatFilter] = useState<'all' | TournamentFormat>('all');
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(false);
  const [openLeaderboardTournamentId, setOpenLeaderboardTournamentId] = useState<string | null>(null);
  const [selectedLeaderboardCategory, setSelectedLeaderboardCategory] = useState<{ tournamentId: string; category: string } | null>(null);
  const [isCardsListOpen, setIsCardsListOpen] = useState(false);
  const [isRegistrationsListOpen, setIsRegistrationsListOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TournamentTab>('calendar');
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [editorValidationMessage, setEditorValidationMessage] = useState('');
  const [draft, setDraft] = useState<TournamentDraft>(createDefaultDraft);
  const [wizardStep, setWizardStep] = useState(1);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [registrationTournamentId, setRegistrationTournamentId] = useState<string | null>(null);
  const [pendingStatusAction, setPendingStatusAction] = useState<PendingTournamentStatusAction | null>(null);
  const [pendingCostAction, setPendingCostAction] = useState<PendingTournamentCostAction | null>(null);
  const [costTournamentId, setCostTournamentId] = useState<string | null>(null);
  const [paymentRegistrationId, setPaymentRegistrationId] = useState<string | null>(null);
  const [costDraft, setCostDraft] = useState<TournamentCostDraft>({
    registrationFee: '',
    reducedRegistrationFee: '',
    operatingCostConcept: '',
    operatingCostAmount: '',
    operatingCostItems: [],
    extraCost: '',
    costNotes: '',
  });
  const [areOperatingCostsOpen, setAreOperatingCostsOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<TournamentPaymentDraft>({
    paymentMethodId: 'cash',
    operationDate: getTodayInputDate(),
    amount: '',
    paymentReference: '',
    notes: '',
  });
  const [scorecardDraft, setScorecardDraft] = useState<TournamentScorecardDraft>({
    player: '',
    category: '',
    gross: '',
    handicap: '',
    net: '',
  });

  const visibleTournaments = useMemo(
    () => (canManageTournaments ? tournaments : tournaments.filter((tournament) => tournament.status === 'registration_open')),
    [canManageTournaments, tournaments],
  );

  const filteredTournaments = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return visibleTournaments.filter((tournament) => {
      const matchesSearch = normalizedQuery
        ? `${tournament.name} ${getFormatLabel(tournament.format)} ${tournament.categories
            .map((category) => category.name)
            .join(' ')}`
            .toLowerCase()
            .includes(normalizedQuery)
        : true;
      const matchesStatus = statusFilter === 'all' ? true : tournament.status === statusFilter;
      const matchesFormat = formatFilter === 'all' ? true : tournament.format === formatFilter;
      const matchesDateFrom = dateFromFilter ? tournament.date >= dateFromFilter : true;
      const matchesDateTo = dateToFilter ? tournament.date <= dateToFilter : true;

      return matchesSearch && matchesStatus && matchesFormat && matchesDateFrom && matchesDateTo;
    });
  }, [dateFromFilter, dateToFilter, formatFilter, searchQuery, statusFilter, visibleTournaments]);
  const activeSearchCount =
    Number(searchQuery.trim().length > 0) +
    Number(statusFilter !== 'all') +
    Number(formatFilter !== 'all') +
    Number(Boolean(dateFromFilter)) +
    Number(Boolean(dateToFilter));

  const selectedTournament = useMemo(() => {
    return selectedTournamentId
      ? visibleTournaments.find((tournament) => tournament.id === selectedTournamentId) ?? null
      : null;
  }, [selectedTournamentId, visibleTournaments]);

  const hasScorecards = (tournament: Tournament | null | undefined) =>
    Boolean(tournament && (tournament.pendingCards > 0 || tournament.approvedCards > 0 || tournament.leaderboard.length > 0));

  const hasVisibleScorecards = useMemo(
    () => visibleTournaments.some((tournament) => hasScorecards(tournament)),
    [visibleTournaments],
  );
  const tournamentsWithResults = useMemo(
    () => visibleTournaments.filter((tournament) => hasScorecards(tournament)),
    [visibleTournaments],
  );

  const registrationTournament = useMemo(
    () => tournaments.find((tournament) => tournament.id === registrationTournamentId) ?? null,
    [registrationTournamentId, tournaments],
  );
  const registrationFeeSelection = useMemo(
    () => (registrationTournament ? getTournamentRegistrationFee(registrationTournament, user) : null),
    [registrationTournament, user],
  );
  const costTournament = useMemo(
    () => tournaments.find((tournament) => tournament.id === costTournamentId) ?? null,
    [costTournamentId, tournaments],
  );
  const paymentRegistration = useMemo(
    () => registrations.find((registration) => registration.id === paymentRegistrationId) ?? null,
    [paymentRegistrationId, registrations],
  );
  const currentParticipantKey = user?.profileId ?? user?.id ?? 'current-user';
  const currentParticipantRegistrationByTournament = useMemo(() => {
    const entries = registrations
      .filter((registration) => registration.memberId === currentParticipantKey || registration.userId === user?.id)
      .map((registration) => [registration.tournamentId, registration] as const);
    return new Map(entries);
  }, [currentParticipantKey, registrations, user?.id]);
  const selectedTournamentRegistrations = useMemo(
    () =>
      selectedTournament
        ? registrations.filter((registration) => registration.tournamentId === selectedTournament.id)
        : [],
    [registrations, selectedTournament],
  );
  const selectedTournamentPaymentSummary = useMemo(() => {
    return selectedTournamentRegistrations.reduce(
      (summary, registration) => ({
        paid: summary.paid + (registration.paymentStatus === 'paid' ? 1 : 0),
        unpaid: summary.unpaid + (registration.paymentStatus === 'unpaid' ? 1 : 0),
        paidAmountMinor: summary.paidAmountMinor + (registration.paymentStatus === 'paid' ? registration.amountMinor : 0),
        pendingAmountMinor: summary.pendingAmountMinor + (registration.paymentStatus === 'unpaid' ? registration.amountMinor : 0),
      }),
      { paid: 0, unpaid: 0, paidAmountMinor: 0, pendingAmountMinor: 0 },
    );
  }, [selectedTournamentRegistrations]);

  useEffect(() => {
    if (isTournamentStatusFilter(requestedStatus)) {
      setStatusFilter(requestedStatus);
    }

    if (requestedOpen === 'search') {
      setIsSearchPanelOpen(true);
    }

    if (isTournamentTab(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedOpen, requestedStatus, requestedTab]);

  useEffect(() => {
    if (requestedOpen === 'results' && tournamentsWithResults[0]) {
      setActiveTab('leaderboard');
      setOpenLeaderboardTournamentId(tournamentsWithResults[0].id);
      return;
    }

    if (requestedOpen === 'registrations' || requestedOpen === 'cards' || requestedOpen === 'costs') {
      const focusTournament = selectedTournament ?? filteredTournaments[0] ?? null;

      if (!focusTournament) {
        return;
      }

      setSelectedTournamentId(focusTournament.id);
      setActiveTab('details');

      if (requestedOpen === 'registrations') {
        setIsRegistrationsListOpen(true);
      }

      if (requestedOpen === 'cards') {
        setIsCardsListOpen(true);
      }

      if (requestedOpen === 'costs' && canManageTournaments) {
        setCostTournamentId(focusTournament.id);
      }
    }
  }, [canManageTournaments, filteredTournaments, requestedOpen, selectedTournament, tournamentsWithResults]);

  useEffect(() => {
    if (activeTab === 'leaderboard' && !hasVisibleScorecards) {
      setActiveTab('calendar');
    }
    if (activeTab === 'settings') {
      setActiveTab('calendar');
    }
    if (activeTab === 'details' && !selectedTournament) {
      setActiveTab('calendar');
    }
  }, [activeTab, canManageTournaments, hasVisibleScorecards, selectedTournament]);

  const summary = useMemo(() => {
    const source = canManageTournaments ? tournaments : visibleTournaments;
    const openTournaments = source.filter((tournament) => tournament.status === 'registration_open').length;
    const pendingCards = source.reduce((total, tournament) => total + tournament.pendingCards, 0);
    const sourceIds = new Set(source.map((tournament) => tournament.id));
    const pendingPayments = registrations.filter(
      (registration) => sourceIds.has(registration.tournamentId) && registration.paymentStatus === 'unpaid',
    ).length;

    return {
      openTournaments,
      pendingCards,
      pendingPayments,
      upcoming: source.filter((tournament) => ['draft', 'scheduled', 'registration_open'].includes(tournament.status)).length,
    };
  }, [canManageTournaments, registrations, tournaments, visibleTournaments]);

  const handleDraftChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, type, value } = event.target;
    const nextValue = type === 'checkbox' ? (event.target as HTMLInputElement).checked : value;

    setEditorValidationMessage('');
    setDraft((current) => ({
      ...current,
      [name]: nextValue,
    }));
  };

  const updateDraftCategory = (
    categoryId: string,
    field: keyof Pick<TournamentDraftCategory, 'name' | 'minHandicap' | 'maxHandicap'>,
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      categories: current.categories.map((category) =>
        category.id === categoryId ? { ...category, [field]: value } : category,
      ),
    }));
  };

  const addDraftCategory = (gender: TournamentDraftCategory['gender']) => {
    setDraft((current) => {
      const nextNumber = current.categories.filter((category) => category.gender === gender).length + 1;
      return {
        ...current,
        categories: [
          ...current.categories,
          {
            id: `${gender}-${Date.now()}`,
            gender,
            name: `Categoria ${nextNumber}`,
            minHandicap: '',
            maxHandicap: '',
          },
        ],
      };
    });
  };

  const removeDraftCategory = (categoryId: string) => {
    setDraft((current) => ({
      ...current,
      categories: current.categories.filter((category) => category.id !== categoryId),
    }));
  };

  const openCreateTournament = () => {
    setDraft(createDefaultDraft());
    setWizardStep(1);
    setNotice('');
    setEditorValidationMessage('');
    setIsEditorOpen(true);
  };

  const closeCreateTournament = () => {
    setIsEditorOpen(false);
  };

  const handleCreateTournament = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const registrationFeeMinor = parseMoneyToMinor(draft.registrationFee || '0');
    const reducedRegistrationFeeMinor = parseMoneyToMinor(draft.reducedRegistrationFee || draft.registrationFee || '0');
    const validationMessage = validateDraftCategories(draft.categories)
      ?? validateDraftTeeWindows(draft)
      ?? (!Number.isFinite(registrationFeeMinor) || registrationFeeMinor <= 0
        ? 'Carga el costo de inscripcion regular antes de crear el torneo.'
        : null)
      ?? (!Number.isFinite(reducedRegistrationFeeMinor) || reducedRegistrationFeeMinor < 0
        ? 'Revisa el costo de inscripcion reducida.'
        : null);
    if (validationMessage) {
      setEditorValidationMessage(validationMessage);
      return;
    }

    const newTournament = createTournamentFromDraft(draft);

    setTournaments((current) => [newTournament, ...current]);
    setSelectedTournamentId(newTournament.id);
    setIsEditorOpen(false);
    setActiveTab('details');
    setNotice(`Torneo "${newTournament.name}" preparado. Queda programado para abrir inscripcion.`);
  };

  const handleSelectTournament = (tournament: Tournament) => {
    setSelectedTournamentId(tournament.id);
    setCostTournamentId((current) => (current === tournament.id ? current : null));
    setActiveTab('details');
  };

  const updateTournamentStatus = (tournamentId: string, status: TournamentStatus, message: string) => {
    setTournaments((current) =>
      current.map((tournament) =>
        tournament.id === tournamentId ? { ...tournament, status } : tournament,
      ),
    );
    setNotice(message);
  };

  const requestTournamentStatusChange = (
    tournament: Tournament,
    nextStatus: PendingTournamentStatusAction['nextStatus'],
  ) => {
    setPendingStatusAction({
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      nextStatus,
    });
  };

  const confirmTournamentStatusChange = () => {
    if (!pendingStatusAction) {
      return;
    }

    updateTournamentStatus(
      pendingStatusAction.tournamentId,
      pendingStatusAction.nextStatus,
      pendingStatusAction.nextStatus === 'registration_open'
        ? `Se activo la inscripcion de "${pendingStatusAction.tournamentName}".`
        : `Se cerro la inscripcion de "${pendingStatusAction.tournamentName}".`,
    );
    setPendingStatusAction(null);
  };

  const openCostEditor = (tournament: Tournament) => {
    setSelectedTournamentId(tournament.id);
    setActiveTab('details');
    setCostTournamentId(tournament.id);
    setAreOperatingCostsOpen(false);
    setCostDraft({
      registrationFee: amountMinorToInput(tournament.registrationFeeMinor),
      reducedRegistrationFee: amountMinorToInput(getReducedFeeMinor(tournament)),
      operatingCostConcept: '',
      operatingCostAmount: '',
      operatingCostItems: getTournamentOperatingCostItems(tournament),
      extraCost: amountMinorToInput(tournament.prizeCostMinor),
      costNotes: tournament.costNotes ?? '',
    });
  };

  const closeCostEditor = () => {
    setCostTournamentId(null);
    setAreOperatingCostsOpen(false);
    setCostDraft({
      registrationFee: '',
      reducedRegistrationFee: '',
      operatingCostConcept: '',
      operatingCostAmount: '',
      operatingCostItems: [],
      extraCost: '',
      costNotes: '',
    });
  };

  const handleCostDraftChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setCostDraft((current) => ({ ...current, [name]: value }));
  };

  const addOperatingCostItem = () => {
    const concept = costDraft.operatingCostConcept.trim();
    const amountMinor = parseMoneyToMinor(costDraft.operatingCostAmount || '0');

    if (!concept) {
      setNotice('Indica el concepto del costo operativo.');
      return;
    }

    if (Number.isNaN(amountMinor) || amountMinor <= 0) {
      setNotice('Revisa el monto del costo operativo.');
      return;
    }

    setCostDraft((current) => ({
      ...current,
      operatingCostConcept: '',
      operatingCostAmount: '',
      operatingCostItems: [
        ...current.operatingCostItems,
        {
          id: `cost-${Date.now()}-${current.operatingCostItems.length}`,
          concept,
          amountMinor,
        },
      ],
    }));
  };

  const removeOperatingCostItem = (itemId: string) => {
    setCostDraft((current) => ({
      ...current,
      operatingCostItems: current.operatingCostItems.filter((item) => item.id !== itemId),
    }));
  };

  const handleSaveTournamentCosts = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!costTournament) {
      return;
    }

    const registrationFeeMinor = parseMoneyToMinor(costDraft.registrationFee || '0');
    const reducedRegistrationFeeMinor = parseMoneyToMinor(costDraft.reducedRegistrationFee || '0');
    const operatingCostMinor = sumTournamentCostItems(costDraft.operatingCostItems);
    const prizeCostMinor = parseMoneyToMinor(costDraft.extraCost || '0');

    if ([registrationFeeMinor, reducedRegistrationFeeMinor, operatingCostMinor, prizeCostMinor].some(Number.isNaN)) {
      setNotice('Revisa los montos del torneo. Usa valores numericos en pesos.');
      return;
    }

    setPendingCostAction({
      tournamentId: costTournament.id,
      tournamentName: costTournament.name,
      registrationFeeMinor,
      reducedRegistrationFeeMinor,
      operatingCostMinor,
      operatingCostItems: costDraft.operatingCostItems,
      prizeCostMinor,
      costNotes: costDraft.costNotes.trim() || null,
    });
  };

  const confirmTournamentCostChange = () => {
    if (!pendingCostAction) {
      return;
    }

    setTournaments((current) =>
      current.map((tournament) =>
        tournament.id === pendingCostAction.tournamentId
          ? {
              ...tournament,
              registrationFeeMinor: pendingCostAction.registrationFeeMinor,
              reducedRegistrationFeeMinor: pendingCostAction.reducedRegistrationFeeMinor,
              operatingCostMinor: pendingCostAction.operatingCostMinor,
              operatingCostItems: pendingCostAction.operatingCostItems,
              prizeCostMinor: pendingCostAction.prizeCostMinor,
              costNotes: pendingCostAction.costNotes,
            }
          : tournament,
      ),
    );
    setNotice(`Costos actualizados para "${pendingCostAction.tournamentName}".`);
    setPendingCostAction(null);
    closeCostEditor();
  };

  const updateTournamentSchedule = (tournamentId: string, field: 'registrationOpenAt' | 'registrationCloseAt', value: string) => {
    setTournaments((current) =>
      current.map((tournament) =>
        tournament.id === tournamentId ? { ...tournament, [field]: value ? value.slice(0, 16) : null } : tournament,
      ),
    );
  };

  const handleTournamentAction = (tournament: Tournament) => {
    if (tournament.status === 'registration_open') {
      const existingRegistration = currentParticipantRegistrationByTournament.get(tournament.id);
      if (existingRegistration) {
        setSelectedTournamentId(tournament.id);
        setActiveTab('details');
        setNotice(
          existingRegistration.paymentStatus === 'paid'
            ? `Ya estas inscripto y con pago registrado en "${tournament.name}".`
            : `Tu inscripcion a "${tournament.name}" esta pendiente de pago.`,
        );
        return;
      }

      setRegistrationTournamentId(tournament.id);
      return;
    }

    if (!canManageTournaments) {
      setNotice('Este torneo todavia no esta abierto para inscripcion.');
      return;
    }

    if (tournament.status === 'scheduled' || tournament.status === 'draft') {
      requestTournamentStatusChange(tournament, 'registration_open');
      return;
    }

    if (tournament.status === 'in_progress' && tournament.pendingCards > 0) {
      setTournaments((current) =>
        current.map((entry) =>
          entry.id === tournament.id
            ? {
                ...entry,
                pendingCards: entry.pendingCards - 1,
                approvedCards: entry.approvedCards + 1,
                leaderboard: entry.leaderboard.length > 0
                  ? entry.leaderboard
                  : [
                      {
                        player: `Tarjeta aprobada ${entry.approvedCards + 1}`,
                        category: 'General',
                        gross: 72,
                        handicap: 0,
                        net: 72,
                        status: 'provisional',
                      },
                    ],
              }
            : entry,
        ),
      );
      setSelectedTournamentId(tournament.id);
      setActiveTab('leaderboard');
      setNotice(`Se aprobo una tarjeta pendiente de "${tournament.name}".`);
      return;
    }

    setSelectedTournamentId(tournament.id);
    setActiveTab('leaderboard');
  };

  const confirmRegistration = async () => {
    if (!registrationTournament || !registrationFeeSelection) {
      return;
    }

    const userId = user?.id ?? 'current-user';
    const memberId = user?.profileType === 'member' ? user.profileId ?? null : null;
    const localRegistrationId = buildLocalRegistrationId(registrationTournament.id, memberId ?? userId);
    const existingRegistration = registrations.find(
      (registration) =>
        registration.tournamentId === registrationTournament.id
        && (registration.memberId === memberId || registration.userId === userId),
    );

    if (existingRegistration) {
      setNotice(`Ya existe una inscripcion para "${registrationTournament.name}".`);
      setRegistrationTournamentId(null);
      return;
    }

    const localRegistration: TournamentRegistrationRecord = {
      id: localRegistrationId,
      tournamentId: registrationTournament.id,
      tournamentNameSnapshot: registrationTournament.name,
      tournamentDate: registrationTournament.date,
      userId,
      memberId,
      participantName: user?.displayName ?? 'Participante',
      participantEmail: user?.email ?? null,
      amountMinor: registrationFeeSelection.amountMinor,
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      receiptId: null,
      financialMovementId: null,
      registeredAt: getTodayInputDate(),
      paidAt: null,
      paymentMethodId: null,
      paymentReference: null,
      notes: null,
    };

    setRegistrations((current) => [localRegistration, ...current]);
    setTournaments((current) =>
      current.map((tournament) =>
        tournament.id === registrationTournament.id
          ? { ...tournament, registered: Math.min(tournament.capacity, tournament.registered + 1) }
          : tournament,
      ),
    );
    setRegistrationTournamentId(null);

    try {
      const result = await tournamentCallables.registerParticipant({
        tournamentId: registrationTournament.id,
        tournamentName: registrationTournament.name,
        tournamentDate: registrationTournament.date,
        tournamentStatus: registrationTournament.status,
        memberId,
        participantName: user?.displayName ?? null,
        participantEmail: user?.email ?? null,
        registrationFeeMinor: registrationFeeSelection.amountMinor,
        notes: registrationFeeSelection.label,
      });

      if (result.registrationId !== localRegistrationId) {
        setRegistrations((current) =>
          current.map((registration) =>
            registration.id === localRegistrationId
              ? { ...registration, id: result.registrationId }
              : registration,
          ),
        );
      }

      setNotice(
        result.duplicate
          ? `La inscripcion de "${registrationTournament.name}" ya estaba registrada.`
          : `Inscripcion registrada para "${registrationTournament.name}". Queda pendiente de pago y recibo.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No pudimos persistir la inscripcion.';
      setNotice(`Inscripcion cargada en pantalla. Falta sincronizar con Functions: ${message}`);
    }
  };

  const openPaymentModal = (registration: TournamentRegistrationRecord) => {
    setPaymentRegistrationId(registration.id);
    setPaymentDraft({
      paymentMethodId: registration.paymentMethodId ?? 'cash',
      operationDate: getTodayInputDate(),
      amount: amountMinorToInput(registration.amountMinor),
      paymentReference: registration.paymentReference ?? '',
      notes: '',
    });
  };

  const closePaymentModal = () => {
    setPaymentRegistrationId(null);
    setPaymentDraft({
      paymentMethodId: 'cash',
      operationDate: getTodayInputDate(),
      amount: '',
      paymentReference: '',
      notes: '',
    });
  };

  const handleScorecardDraftChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setScorecardDraft((current) => ({ ...current, [name]: value }));
  };

  const handleAddScorecard = () => {
    if (!selectedTournament) {
      return;
    }

    const gross = Number(scorecardDraft.gross);
    const handicap = Number(scorecardDraft.handicap);
    const net = scorecardDraft.net ? Number(scorecardDraft.net) : gross - handicap;

    if (!scorecardDraft.player.trim() || !scorecardDraft.category || [gross, handicap, net].some((value) => !Number.isFinite(value))) {
      setNotice('Completa jugador, categoria, gross y handicap para cargar la tarjeta.');
      return;
    }

    const row: TournamentLeaderboardRow = {
      player: scorecardDraft.player.trim(),
      category: scorecardDraft.category,
      gross,
      handicap,
      net,
      status: 'final',
    };

    setTournaments((current) =>
      current.map((tournament) =>
        tournament.id === selectedTournament.id
          ? {
              ...tournament,
              approvedCards: tournament.approvedCards + 1,
              leaderboard: [...tournament.leaderboard, row],
            }
          : tournament,
      ),
    );
    setScorecardDraft({ player: '', category: '', gross: '', handicap: '', net: '' });
    setNotice(`Tarjeta cargada para ${row.player}. El ranking se actualizo por categoria.`);
  };

  const handlePaymentDraftChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setPaymentDraft((current) => ({ ...current, [name]: value }));
  };

  const handleRecordRegistrationPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentRegistration) {
      return;
    }

    const selectedMethod = TOURNAMENT_PAYMENT_METHODS.find((method) => method.value === paymentDraft.paymentMethodId);
    if (selectedMethod?.requiresReference && paymentDraft.paymentReference.trim().length === 0) {
      setNotice('La referencia es obligatoria para pagos bancarizados.');
      return;
    }

    const amountMinor = parseMoneyToMinor(paymentDraft.amount || '0');
    if (Number.isNaN(amountMinor) || amountMinor <= 0) {
      setNotice('Revisa el monto del pago de inscripcion.');
      return;
    }

    const receiptNumber = buildLocalReceiptNumber(paymentRegistration.id, paymentDraft.operationDate);
    const localReceiptId = `receipt-${paymentRegistration.id}`;
    const localMovementId = `movement-${paymentRegistration.id}`;

    // TODO(notifications): cuando quede cerrado el modulo de notificaciones, enviar el recibo emitido al socio o invitado.
    setReceipts((current) => [
      {
        id: localReceiptId,
        registrationId: paymentRegistration.id,
        tournamentId: paymentRegistration.tournamentId,
        receiptNumber,
        amountMinor,
        paymentMethodId: paymentDraft.paymentMethodId,
        movementId: localMovementId,
        issuedAt: paymentDraft.operationDate,
      },
      ...current.filter((receipt) => receipt.registrationId !== paymentRegistration.id),
    ]);
    setRegistrations((current) =>
      current.map((registration) =>
        registration.id === paymentRegistration.id
          ? {
              ...registration,
              amountMinor,
              status: 'confirmed',
              paymentStatus: 'paid',
              receiptId: localReceiptId,
              financialMovementId: localMovementId,
              paidAt: paymentDraft.operationDate,
              paymentMethodId: paymentDraft.paymentMethodId,
              paymentReference: paymentDraft.paymentReference.trim() || null,
              notes: paymentDraft.notes.trim() || null,
            }
          : registration,
      ),
    );
    closePaymentModal();

    try {
      const result = await tournamentCallables.recordRegistrationPayment({
        registrationId: paymentRegistration.id,
        paymentMethodId: paymentDraft.paymentMethodId,
        operationDate: paymentDraft.operationDate,
        amountMinor,
        paymentReference: paymentDraft.paymentReference.trim() || null,
        notes: paymentDraft.notes.trim() || null,
      });

      setReceipts((current) =>
        current.map((receipt) =>
          receipt.registrationId === paymentRegistration.id
            ? {
                ...receipt,
                id: result.receiptId,
                receiptNumber: result.receiptNumber,
                movementId: result.movementId,
              }
            : receipt,
        ),
      );
      setRegistrations((current) =>
        current.map((registration) =>
          registration.id === paymentRegistration.id
            ? {
                ...registration,
                receiptId: result.receiptId,
                financialMovementId: result.movementId,
              }
            : registration,
        ),
      );
      setNotice(`Pago registrado. Recibo ${result.receiptNumber} y movimiento contable vinculados.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No pudimos persistir el pago.';
      setNotice(`Pago reflejado en pantalla. Falta sincronizar con Functions: ${message}`);
    }
  };

  const draftTeeWindows = createDraftTeeWindows(draft);
  const currentStepSlots = countTeeWindowsSlots(draftTeeWindows);
  const categoryValidationMessage = validateDraftCategories(draft.categories);
  const teeValidationMessage = validateDraftTeeWindows(draft);
  const draftRegistrationFeeMinor = parseMoneyToMinor(draft.registrationFee || '0');
  const draftReducedRegistrationFeeMinor = parseMoneyToMinor(draft.reducedRegistrationFee || draft.registrationFee || '0');
  const isTournamentDraftReady =
    Boolean(draft.name.trim()) &&
    Boolean(draft.date) &&
    Number(draft.capacity) > 0 &&
    Boolean(draft.registrationOpenAt) &&
    Boolean(draft.registrationCloseAt) &&
    Number.isFinite(draftRegistrationFeeMinor) &&
    draftRegistrationFeeMinor > 0 &&
    Number.isFinite(draftReducedRegistrationFeeMinor) &&
    draftReducedRegistrationFeeMinor >= 0 &&
    !categoryValidationMessage &&
    !teeValidationMessage;

  return (
    <div className="page-container tournament-page">
      <div className="tournament-shell">
        <section className="floating-card tournament-hero">
          <div className="tournament-hero__copy">
            <p className="eyebrow">Torneos</p>
            <h1>{canManageTournaments ? 'Gestion de torneos' : 'Torneos del club'}</h1>
            <p>
              Calendario, inscripciones, categorias, salidas, tarjetas y resultados
            </p>
          </div>

          <div className="tournament-hero__actions">
            {canManageTournaments && (
              <button type="button" className="ui-action-button ui-action-button--positive" onClick={openCreateTournament}>
                <Icon type="plus" />
                <span>Crear torneo</span>
              </button>
            )}
          </div>
        </section>

        {notice && <div className="accounting-success tournament-notice">{notice}</div>}

        <section className="tournament-summary-grid" aria-label="Resumen de torneos">
          <article className="summary-card">
            <span>Inscripciones abiertas</span>
            <strong>{summary.openTournaments}</strong>
            <small>Torneos listos para socios e invitados.</small>
          </article>
          {canManageTournaments && (
            <article className="summary-card">
              <span>Proximos torneos</span>
              <strong>{summary.upcoming}</strong>
              <small>Incluye borradores y programados.</small>
            </article>
          )}
          {canManageTournaments && (
            <article className="summary-card">
              <span>Tarjetas pendientes</span>
              <strong>{summary.pendingCards}</strong>
              <small>Scorecards esperando control.</small>
            </article>
          )}
          {canManageTournaments && (
            <article className="summary-card">
              <span>Pagos pendientes</span>
              <strong>{summary.pendingPayments}</strong>
              <small>Inscripciones con recibo todavia no emitido.</small>
            </article>
          )}
        </section>

        <div className="tournament-layout">
          <section className="floating-card tournament-main-panel">
            <div className="tournament-tabs" role="tablist" aria-label="Vistas de torneos">
              <button
                type="button"
                className={`tournament-tab ${activeTab === 'calendar' ? 'tournament-tab--active' : ''}`}
                onClick={() => setActiveTab('calendar')}
              >
                <Icon type="list" />
                Calendario
              </button>
              {hasVisibleScorecards && (
                <button
                  type="button"
                  className={`tournament-tab ${activeTab === 'leaderboard' ? 'tournament-tab--active' : ''}`}
                  onClick={() => setActiveTab('leaderboard')}
                >
                  <Icon type="trophy" />
                  Resultados
                </button>
              )}
              {selectedTournament && (
                <button
                  type="button"
                  className={`tournament-tab tournament-tab--info ${activeTab === 'details' ? 'tournament-tab--active' : ''}`}
                  onClick={() => setActiveTab('details')}
                >
                  <Icon type="score" />
                  Detalle del torneo
                </button>
              )}
            </div>

            {activeTab === 'calendar' && (
              <>
                <div className={`search-collapse ${isSearchPanelOpen ? 'search-collapse--open' : ''}`}>
                  <button
                    type="button"
                    className="search-collapse__trigger"
                    aria-expanded={isSearchPanelOpen}
                    onClick={() => setIsSearchPanelOpen((current) => !current)}
                  >
                    <span className="search-collapse__title">
                      <span className="search-collapse__icon">
                        <Icon type="search" />
                      </span>
                      <span>
                        <strong>Busqueda y filtros</strong>
                        <small>
                          {activeSearchCount > 0
                            ? `${activeSearchCount} criterio${activeSearchCount === 1 ? '' : 's'} activo${activeSearchCount === 1 ? '' : 's'}`
                            : 'Buscar por torneo, fecha, formato o estado'}
                        </small>
                      </span>
                    </span>
                    <span className="search-collapse__meta">
                      {activeSearchCount > 0 && <span className="status-chip">{activeSearchCount}</span>}
                      <span className="search-collapse__chevron">
                        <Icon type="chevron" />
                      </span>
                    </span>
                  </button>

                  {isSearchPanelOpen && (
                    <div className="search-collapse__body">
                      <div className="member-toolbar tournament-toolbar">
                        <div className="member-toolbar__row tournament-toolbar__row">
                          <label className="member-search member-search--wide" htmlFor="tournamentSearch">
                            <span>Buscar torneo</span>
                            <input
                              id="tournamentSearch"
                              type="search"
                              value={searchQuery}
                              onChange={(event) => setSearchQuery(event.target.value)}
                              placeholder="Nombre, formato o categoria"
                            />
                          </label>

                          {canManageTournaments && (
                            <label className="form-field member-filter" htmlFor="tournamentStatusFilter">
                              <span>Estado</span>
                              <select
                                id="tournamentStatusFilter"
                                value={statusFilter}
                                onChange={(event) => setStatusFilter(event.target.value as 'all' | TournamentStatus)}
                              >
                                {STATUS_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}

                          <label className="form-field member-filter" htmlFor="tournamentFormatFilter">
                            <span>Formato</span>
                            <select
                              id="tournamentFormatFilter"
                              value={formatFilter}
                              onChange={(event) => setFormatFilter(event.target.value as 'all' | TournamentFormat)}
                            >
                              <option value="all">Todos</option>
                              {TOURNAMENT_FORMATS.map((format) => (
                                <option key={format.value} value={format.value}>
                                  {format.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="form-field member-filter" htmlFor="tournamentDateFrom">
                            <span>Desde</span>
                            <input
                              id="tournamentDateFrom"
                              type="date"
                              value={dateFromFilter}
                              onChange={(event) => setDateFromFilter(event.target.value)}
                            />
                          </label>

                          <label className="form-field member-filter" htmlFor="tournamentDateTo">
                            <span>Hasta</span>
                            <input
                              id="tournamentDateTo"
                              type="date"
                              value={dateToFilter}
                              onChange={(event) => setDateToFilter(event.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="directory-results">
                  <strong>{filteredTournaments.length} torneos encontrados</strong>
                  <small>
                    {canManageTournaments
                      ? 'Usa la busqueda si necesitas acotar el listado antes de operar.'
                      : 'Solo se muestran torneos con inscripcion abierta.'}
                  </small>
                </div>

                <div className="tournament-table">
                  <div className="tournament-table__head">
                    <span>Torneo</span>
                    <span>Formato</span>
                    <span>Inscripcion</span>
                    <span>Salidas</span>
                    <span>Estado</span>
                    <span>Accion</span>
                  </div>

                  <div className="tournament-table__body">
                    {filteredTournaments.length === 0 ? (
                      <div className="empty-state empty-state--inline">
                        No encontramos torneos con esos filtros.
                      </div>
                    ) : (
                      filteredTournaments.map((tournament) => {
                        const availableSlots = Math.max(tournament.capacity - tournament.registered, 0);
                        const isSelected = selectedTournament?.id === tournament.id;
                        const tournamentRegistrations = registrations.filter((registration) => registration.tournamentId === tournament.id);
                        const paidRegistrations = tournamentRegistrations.filter((registration) => registration.paymentStatus === 'paid').length;
                        const pendingRegistrations = tournamentRegistrations.filter((registration) => registration.paymentStatus === 'unpaid').length;
                        const currentRegistration = currentParticipantRegistrationByTournament.get(tournament.id);

                        return (
                          <article
                            key={tournament.id}
                            className={`tournament-row ${isSelected ? 'tournament-row--selected' : ''}`}
                            onClick={() => handleSelectTournament(tournament)}
                          >
                            <div className="member-cell">
                              <strong>{tournament.name}</strong>
                              <small>{formatDate(tournament.date)}</small>
                            </div>

                            <div className="member-cell">
                              <span className="member-type-badge">{getFormatLabel(tournament.format)}</span>
                              <small>{tournament.startType === 'regular' ? 'Salida regular' : 'Salida simultanea'}</small>
                            </div>

                            <div className="member-cell">
                              <strong>
                                {tournament.registered}/{tournament.capacity}
                              </strong>
                              <small>
                                {canManageTournaments
                                  ? `${paidRegistrations} pagos / ${pendingRegistrations} pendientes`
                                  : currentRegistration
                                    ? getRegistrationStatusLabel(currentRegistration)
                                    : `${availableSlots} cupos libres`}
                              </small>
                            </div>

                            <div className="member-cell">
                              <strong>
                                {getTournamentTeeWindows(tournament).morning.first} - {getTournamentTeeWindows(tournament).morning.last}
                              </strong>
                              <small>
                                Tarde {getTournamentTeeWindows(tournament).afternoon.first} - {getTournamentTeeWindows(tournament).afternoon.last}
                              </small>
                              <small>{countTeeWindowsSlots(getTournamentTeeWindows(tournament))} horarios</small>
                            </div>

                            <div className="member-cell">
                              <span className={`status-pill status-pill--${tournament.status}`}>
                                {getStatusLabel(tournament.status)}
                              </span>
                              <small>
                                {tournament.pendingCards > 0
                                  ? `${tournament.pendingCards} tarjetas pendientes`
                                  : `${tournament.approvedCards} tarjetas aprobadas`}
                              </small>
                            </div>

                            <div className="tournament-row__actions">
                              {canManageTournaments ? (
                                <>
                                  {['draft', 'scheduled', 'registration_closed'].includes(tournament.status) && (
                                    <button
                                      type="button"
                                      className="ui-action-button ui-action-button--positive tournament-row__button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        requestTournamentStatusChange(tournament, 'registration_open');
                                      }}
                                    >
                                      Activar inscripcion
                                    </button>
                                  )}
                                  {tournament.status === 'registration_open' && (
                                    <button
                                      type="button"
                                      className="ui-action-button ui-action-button--danger tournament-row__button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        requestTournamentStatusChange(tournament, 'registration_closed');
                                      }}
                                    >
                                      Cerrar inscripcion
                                    </button>
                                  )}
                                  {tournament.status === 'in_progress' && tournament.pendingCards > 0 && (
                                    <button
                                      type="button"
                                      className="ui-action-button ui-action-button--positive tournament-row__button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleTournamentAction(tournament);
                                      }}
                                    >
                                      Aprobar tarjeta
                                    </button>
                                  )}
                                  {hasScorecards(tournament) && (
                                    <button
                                      type="button"
                                      className="ui-action-button ui-action-button--secondary tournament-row__button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setSelectedTournamentId(tournament.id);
                                        setActiveTab('leaderboard');
                                      }}
                                    >
                                      Resultados
                                    </button>
                                  )}
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className={currentRegistration ? 'ui-action-button ui-action-button--secondary tournament-row__button' : 'ui-action-button ui-action-button--positive tournament-row__button'}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleTournamentAction(tournament);
                                  }}
                                >
                                  {currentRegistration ? getRegistrationStatusLabel(currentRegistration) : 'Inscribirme'}
                                </button>
                              )}
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'leaderboard' && (
              <div className="tournament-leaderboard">
                <div className="tournament-section-header">
                  <div>
                    <p className="eyebrow">Resultados</p>
                    <h2>Torneos con tarjetas cargadas</h2>
                  </div>
                </div>

                {tournamentsWithResults.length === 0 ? (
                  <div className="empty-state empty-state--inline">
                    La tabla de resultados se activa cuando hay tarjetas cargadas y resultados publicados.
                  </div>
                ) : (
                  <div className="tournament-result-list">
                    {tournamentsWithResults.map((tournament) => {
                      const isOpen = openLeaderboardTournamentId === tournament.id;
                      const leaderboardGroups = groupLeaderboardRows(tournament.leaderboard);
                      return (
                        <article key={tournament.id} className={`tournament-result-card ${isOpen ? 'tournament-result-card--open' : ''}`}>
                          <button
                            type="button"
                            className="tournament-result-card__header"
                            aria-expanded={isOpen}
                            onClick={() => {
                              setSelectedLeaderboardCategory(null);
                              setOpenLeaderboardTournamentId((current) => (current === tournament.id ? null : tournament.id));
                            }}
                          >
                            <span>
                              <strong>{tournament.name}</strong>
                              <small>
                                {formatDate(tournament.date)} · {tournament.leaderboard.length} resultados · {getStatusLabel(tournament.status)}
                              </small>
                            </span>
                            <span className="search-collapse__chevron">
                              <Icon type="chevron" />
                            </span>
                          </button>

                          {isOpen && (
                            <div className="tournament-leaderboard-groups">
                              {selectedLeaderboardCategory?.tournamentId === tournament.id ? (
                                (() => {
                                  const selectedGroup = leaderboardGroups.find((group) => group.category === selectedLeaderboardCategory.category);
                                  if (!selectedGroup) {
                                    return null;
                                  }

                                  return (
                                    <section className="tournament-leaderboard-group tournament-leaderboard-group--focused">
                                      <div className="tournament-leaderboard-group__header">
                                        <div>
                                          <span>{selectedGroup.category}</span>
                                          <small>Ranking interno</small>
                                        </div>
                                        <UiActionButton
                                          type="button"
                                          variant="secondary"
                                          compact
                                          onClick={() => setSelectedLeaderboardCategory(null)}
                                        >
                                          Volver
                                        </UiActionButton>
                                      </div>
                                      <div className="tournament-score-table">
                                        <div className="tournament-score-table__head">
                                          <span>Pos.</span>
                                          <span>Jugador / equipo</span>
                                          <span>Gross</span>
                                          <span>Hcp</span>
                                          <span>Neto</span>
                                        </div>
                                        {selectedGroup.rows.map((row, index) => (
                                          <div key={`${tournament.id}-${selectedGroup.category}-${row.player}-${row.net}`} className="tournament-score-row">
                                            <strong>{index + 1}</strong>
                                            <span>{row.player}</span>
                                            <span>{row.gross}</span>
                                            <span>{row.handicap}</span>
                                            <strong>{row.net}</strong>
                                          </div>
                                        ))}
                                      </div>
                                    </section>
                                  );
                                })()
                              ) : (
                                <div className="tournament-ranking-picker">
                                  <div>
                                    <strong>Selecciona una categoria</strong>
                                    <small>Las tarjetas cargadas por administracion alimentan cada ranking interno.</small>
                                  </div>
                                  <div className="tournament-ranking-picker__items">
                                    {leaderboardGroups.map((group) => (
                                      <button
                                        key={`${tournament.id}-${group.category}`}
                                        type="button"
                                        className="tournament-ranking-choice"
                                        onClick={() => setSelectedLeaderboardCategory({ tournamentId: tournament.id, category: group.category })}
                                      >
                                        <span>{group.category}</span>
                                        <small>{group.rows.length} tarjetas</small>
                                        <span className="search-collapse__chevron">
                                          <Icon type="chevron" />
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="tournament-settings-grid">
                <article className="tournament-policy">
                  <span className="action-icon">
                    <Icon type="clock" />
                  </span>
                  <div>
                    <strong>Horarios predeterminados</strong>
                    <p>
                      Manana {COURSE_SETTINGS.morningFirstTeeTime} a {COURSE_SETTINGS.morningLastTeeTime}; tarde{' '}
                      {COURSE_SETTINGS.afternoonFirstTeeTime} a {COURSE_SETTINGS.afternoonLastTeeTime}, cada {COURSE_SETTINGS.interval} minutos.
                    </p>
                  </div>
                </article>
                <article className="tournament-policy">
                  <span className="action-icon">
                    <Icon type="flag" />
                  </span>
                  <div>
                    <strong>Estado de cancha</strong>
                    <p>{COURSE_SETTINGS.courseOpen ? 'Abierta para juego y reservas.' : 'Cerrada para operaciones.'}</p>
                  </div>
                </article>
                <article className="tournament-policy">
                  <span className="action-icon">
                    <Icon type="users" />
                  </span>
                  <div>
                    <strong>Reglas de inscripcion</strong>
                    <p>
                      {COURSE_SETTINGS.membersOnly ? 'Solo socios.' : 'Socios e invitados.'}{' '}
                      El alcance se define por torneo.
                    </p>
                  </div>
                </article>
                <article className="tournament-policy">
                  <span className="action-icon">
                    <Icon type="check" />
                  </span>
                  <div>
                    <strong>Cancelaciones y ausencias</strong>
                    <p>
                      Cancelacion hasta {COURSE_SETTINGS.cancelHours} h antes. Bloqueo sugerido desde{' '}
                      {COURSE_SETTINGS.maxNoShows} ausencias.
                    </p>
                  </div>
                </article>
              </div>
            )}
            {activeTab === 'details' && selectedTournament && (
              <div className="tournament-detail-panel">
                <div className="tournament-section-header">
                  <div>
                    <p className="eyebrow">Detalle del torneo</p>
                    <h2>{selectedTournament.name}</h2>
                    <div className="tournament-meter tournament-meter--compact" aria-label="Ocupacion del torneo">
                      <span>
                        <strong>{getOccupancyPercentage(selectedTournament)}%</strong>
                        de ocupacion
                      </span>
                      <div className="tournament-meter__track">
                        <span style={{ width: `${getOccupancyPercentage(selectedTournament)}%` }} />
                      </div>
                    </div>
                  </div>
                  <span className={`status-pill status-pill--${selectedTournament.status}`}>
                    {getStatusLabel(selectedTournament.status)}
                  </span>
                </div>

                <div className="tournament-detail-grid">
                  <div>
                    <span>Formato</span>
                    <strong>{getFormatLabel(selectedTournament.format)}</strong>
                  </div>
                  <div>
                    <span>Fecha</span>
                    <strong>{formatDate(selectedTournament.date)}</strong>
                  </div>
                  <div>
                    <span>Cupos</span>
                    <strong>
                      {selectedTournament.registered}/{selectedTournament.capacity}
                    </strong>
                  </div>
                  <div>
                    <span>Tarjetas</span>
                    <strong>{selectedTournament.approvedCards + selectedTournament.pendingCards}</strong>
                    {canManageTournaments && (
                      <UiActionButton type="button" variant="secondary" compact onClick={() => setIsCardsListOpen((current) => !current)}>
                        Modificar
                      </UiActionButton>
                    )}
                  </div>
                </div>

                {isCardsListOpen && (
                  <div className="tournament-scorecard-admin" aria-label="Administracion de tarjetas">
                    {canManageTournaments && (
                      <div className="tournament-scorecard-form">
                        <div>
                          <p className="eyebrow">Tarjetas</p>
                          <h3>Cargar tarjeta validada</h3>
                          <p>Administracion carga las tarjetas aprobadas y el ranking se actualiza por categoria.</p>
                        </div>
                        <div className="tournament-cost-form__row">
                          <label className="form-field">
                            <span>Jugador o equipo</span>
                            <input name="player" value={scorecardDraft.player} onChange={handleScorecardDraftChange} />
                          </label>
                          <label className="form-field">
                            <span>Categoria</span>
                            <select name="category" value={scorecardDraft.category} onChange={handleScorecardDraftChange}>
                              <option value="">Seleccionar</option>
                              {getTournamentCategoryLabels(selectedTournament).map((categoryLabel) => (
                                <option key={categoryLabel} value={categoryLabel}>
                                  {categoryLabel}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="tournament-cost-form__row">
                          <label className="form-field">
                            <span>Gross</span>
                            <input name="gross" type="number" value={scorecardDraft.gross} onChange={handleScorecardDraftChange} />
                          </label>
                          <label className="form-field">
                            <span>Handicap</span>
                            <input name="handicap" type="number" step="0.1" value={scorecardDraft.handicap} onChange={handleScorecardDraftChange} />
                          </label>
                          <label className="form-field">
                            <span>Neto</span>
                            <input name="net" type="number" step="0.1" value={scorecardDraft.net} onChange={handleScorecardDraftChange} placeholder="Auto" />
                          </label>
                          <UiActionButton type="button" variant="positive" compact onClick={handleAddScorecard}>
                            <Icon type="plus" />
                            <span>Cargar tarjeta</span>
                          </UiActionButton>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {canManageTournaments && (
                  <div className="tournament-side-section">
                    <div className="tournament-section-header">
                      <div>
                        <p className="eyebrow">Monto</p>
                        <h3>Costos del torneo</h3>
                      </div>
                      {costTournament?.id !== selectedTournament.id && (
                        <UiActionButton type="button" variant="secondary" compact onClick={() => openCostEditor(selectedTournament)}>
                          Editar monto
                        </UiActionButton>
                      )}
                    </div>
                    <div className="tournament-detail-grid tournament-detail-grid--costs">
                      <div>
                        <span>Monto regular</span>
                        <strong>{formatAmountMinor(selectedTournament.registrationFeeMinor)}</strong>
                      </div>
                      <div>
                        <span>Monto reducido</span>
                        <strong>{formatAmountMinor(getReducedFeeMinor(selectedTournament))}</strong>
                      </div>
                      <div>
                        <span>Costos operativos</span>
                        <strong>{formatAmountMinor(selectedTournament.operatingCostMinor)}</strong>
                      </div>
                      <div>
                        <span>Extras</span>
                        <strong>{formatAmountMinor(selectedTournament.prizeCostMinor)}</strong>
                      </div>
                    </div>

                    {costTournament?.id === selectedTournament.id ? (
                      <form className="tournament-cost-form" onSubmit={handleSaveTournamentCosts}>
                        <div className="tournament-cost-form__row">
                          <label className="form-field">
                            <span>Inscripcion regular</span>
                            <input
                              name="registrationFee"
                              type="text"
                              inputMode="decimal"
                              value={costDraft.registrationFee}
                              onChange={handleCostDraftChange}
                              placeholder="Ej. 15000"
                            />
                          </label>
                          <label className="form-field">
                            <span>Inscripcion reducida</span>
                            <input
                              name="reducedRegistrationFee"
                              type="text"
                              inputMode="decimal"
                              value={costDraft.reducedRegistrationFee}
                              onChange={handleCostDraftChange}
                              placeholder="Ej. 10000"
                            />
                          </label>
                        </div>
                        <div className="tournament-operating-costs">
                          <div className="tournament-cost-form__header">
                            <div>
                              <span>Costos operativos</span>
                              <strong>{formatAmountMinor(sumTournamentCostItems(costDraft.operatingCostItems))}</strong>
                            </div>
                            <UiActionButton
                              type="button"
                              variant="secondary"
                              compact
                              onClick={() => setAreOperatingCostsOpen((current) => !current)}
                            >
                              <span>{areOperatingCostsOpen ? 'Ocultar costos operativos' : 'Ver costos operativos'}</span>
                              <span className={`search-collapse__chevron ${areOperatingCostsOpen ? 'search-collapse__chevron--open' : ''}`}>
                                <Icon type="chevron" />
                              </span>
                            </UiActionButton>
                          </div>
                          {areOperatingCostsOpen && (
                            <div className="tournament-operating-costs__body">
                              <div className="tournament-cost-form__row">
                                <label className="form-field">
                                  <span>Concepto</span>
                                  <input
                                    name="operatingCostConcept"
                                    type="text"
                                    value={costDraft.operatingCostConcept}
                                    onChange={handleCostDraftChange}
                                    placeholder="Ej. Preparacion de cancha"
                                  />
                                </label>
                                <label className="form-field">
                                  <span>Monto</span>
                                  <input
                                    name="operatingCostAmount"
                                    type="text"
                                    inputMode="decimal"
                                    value={costDraft.operatingCostAmount}
                                    onChange={handleCostDraftChange}
                                    placeholder="Ej. 25000"
                                  />
                                </label>
                                <UiActionButton type="button" variant="positive" compact onClick={addOperatingCostItem}>
                                  <Icon type="plus" />
                                  <span>Agregar</span>
                                </UiActionButton>
                              </div>
                              <div className="tournament-cost-items-list">
                                {costDraft.operatingCostItems.length === 0 ? (
                                  <div className="empty-state empty-state--inline">Todavia no hay costos operativos cargados.</div>
                                ) : (
                                  costDraft.operatingCostItems.map((item) => (
                                    <article key={item.id} className="tournament-cost-line">
                                      <span>{item.concept}</span>
                                      <strong>{formatAmountMinor(item.amountMinor)}</strong>
                                      <UiActionButton type="button" variant="danger" compact onClick={() => removeOperatingCostItem(item.id)}>
                                        Eliminar
                                      </UiActionButton>
                                    </article>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="tournament-cost-form__row tournament-cost-form__row--extras">
                          <div>
                            <span>Extras</span>
                            <p>Refrigerios, premios simbólicos u otros adicionales del torneo.</p>
                          </div>
                          <label className="form-field">
                            <span>Monto de extras</span>
                            <input
                              name="extraCost"
                              type="text"
                              inputMode="decimal"
                              value={costDraft.extraCost}
                              onChange={handleCostDraftChange}
                              placeholder="Ej. 12000"
                            />
                          </label>
                        </div>
                        <label className="form-field">
                          <span>Notas</span>
                          <textarea
                            name="costNotes"
                            value={costDraft.costNotes}
                            onChange={handleCostDraftChange}
                            rows={3}
                          />
                        </label>
                        <div className="form-actions">
                          <UiActionButton type="button" variant="danger" onClick={closeCostEditor}>
                            Cancelar
                          </UiActionButton>
                          <UiActionButton type="submit" variant="positive">
                            Guardar monto
                          </UiActionButton>
                        </div>
                      </form>
                    ) : null}
                  </div>
                )}

                {canManageTournaments ? (
                  <div className="tournament-side-section">
                    <div className="tournament-section-header">
                      <div>
                        <p className="eyebrow">Inscripciones</p>
                        <h3>Pagos y recibos</h3>
                      </div>
                      <div className="tournament-header-actions">
                        <span className="member-type-badge">
                          {selectedTournamentPaymentSummary.paid} pagas / {selectedTournamentPaymentSummary.unpaid} pendientes
                        </span>
                        <UiActionButton type="button" variant="secondary" compact onClick={() => setIsRegistrationsListOpen((current) => !current)}>
                          Ver listado
                        </UiActionButton>
                      </div>
                    </div>
                    <div className="tournament-receipt-summary tournament-money-summary tournament-payment-summary">
                      <div>
                        <span>Cobrado</span>
                        <strong>{formatAmountMinor(selectedTournamentPaymentSummary.paidAmountMinor)}</strong>
                      </div>
                      <div>
                        <span>Pendiente</span>
                        <strong>{formatAmountMinor(selectedTournamentPaymentSummary.pendingAmountMinor)}</strong>
                      </div>
                    </div>
                    {isRegistrationsListOpen && (
                      <div className="tournament-registration-list">
                        {selectedTournamentRegistrations.length === 0 ? (
                          <div className="empty-state empty-state--inline">Todavia no hay inscripciones cargadas.</div>
                        ) : (
                          selectedTournamentRegistrations.map((registration) => {
                            const receipt = receipts.find((entry) => entry.id === registration.receiptId);
                            return (
                              <article key={registration.id} className="tournament-registration-item tournament-registration-item--detailed">
                                <div>
                                  <span>Socio</span>
                                  <strong>{getParticipantNumber(registration)}</strong>
                                </div>
                                <div>
                                  <span>Nombre</span>
                                  <strong>{registration.participantName}</strong>
                                </div>
                                <div>
                                  <span>Estado</span>
                                  <strong>{getRegistrationStatusLabel(registration)}</strong>
                                </div>
                                <div>
                                  <span>Referencia</span>
                                  <strong>{getRegistrationReference(registration, receipt)}</strong>
                                </div>
                                <div className="tournament-registration-payment">
                                  {registration.paymentStatus === 'unpaid' ? (
                                    <button type="button" className="status-chip status-chip--pending tournament-pay-chip" onClick={() => openPaymentModal(registration)}>
                                      Pagar
                                    </button>
                                  ) : (
                                    <span className="status-pill status-pill--registration_open">Recibo emitido</span>
                                  )}
                                </div>
                              </article>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="tournament-side-section">
                    <h3>Mi inscripcion</h3>
                    {currentParticipantRegistrationByTournament.get(selectedTournament.id) ? (
                      <div className="tournament-registration-item">
                        <div>
                          <strong>{getRegistrationStatusLabel(currentParticipantRegistrationByTournament.get(selectedTournament.id)!)}</strong>
                          <small>
                            {formatAmountMinor(currentParticipantRegistrationByTournament.get(selectedTournament.id)!.amountMinor)}
                          </small>
                          {currentParticipantRegistrationByTournament.get(selectedTournament.id)!.receiptId && (
                            <small>Recibo disponible cuando administracion registra el pago.</small>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p>Elegis inscribirte y queda pendiente de pago hasta que administracion registre el cobro.</p>
                    )}
                  </div>
                )}

                {canManageTournaments && (
                  <div className="tournament-side-section">
                    <h3>Inscripcion</h3>
                    <div className="tournament-schedule-grid tournament-schedule-grid--polished">
                      <label className="form-field">
                        <span>Apertura programada</span>
                        <input
                          type="datetime-local"
                          value={toDateTimeInputValue(selectedTournament.registrationOpenAt, '09:00')}
                          onChange={(event) => updateTournamentSchedule(selectedTournament.id, 'registrationOpenAt', event.target.value)}
                        />
                      </label>
                      <label className="form-field">
                        <span>Cierre programado</span>
                        <input
                          type="datetime-local"
                          value={toDateTimeInputValue(selectedTournament.registrationCloseAt, '18:00')}
                          onChange={(event) => updateTournamentSchedule(selectedTournament.id, 'registrationCloseAt', event.target.value)}
                        />
                      </label>
                    </div>
                    <p className="profile-note">
                      Abre {formatDateTimeForDisplay(selectedTournament.registrationOpenAt)} y cierra {formatDateTimeForDisplay(selectedTournament.registrationCloseAt)}. La apertura y cierre automaticos requieren una funcion programada que compare fecha/hora y cambie el estado del torneo.
                    </p>
                    <div className="tournament-mode-actions tournament-mode-actions--bottom">
                      {['draft', 'scheduled', 'registration_closed'].includes(selectedTournament.status) && (
                        <UiActionButton
                          type="button"
                          variant="positive"
                          onClick={() => requestTournamentStatusChange(selectedTournament, 'registration_open')}
                        >
                          Abrir inscripcion
                        </UiActionButton>
                      )}
                      {selectedTournament.status === 'registration_open' && (
                        <UiActionButton
                          type="button"
                          variant="danger"
                          onClick={() => requestTournamentStatusChange(selectedTournament, 'registration_closed')}
                        >
                          Cerrar inscripcion
                        </UiActionButton>
                      )}
                      {!['draft', 'scheduled', 'registration_open', 'registration_closed'].includes(selectedTournament.status) && (
                        <small>La inscripcion no se modifica cuando el torneo ya esta en juego o finalizado.</small>
                      )}
                    </div>
                  </div>
                )}

                <div className="tournament-side-section">
                  <h3>Organizacion del evento</h3>
                  <div className="tournament-category-overview">
                    {selectedTournament.categories.map((category) => (
                      <article key={`${selectedTournament.id}-${category.name}-${category.gender}`} className={`tournament-category-group tournament-category-group--${category.gender}`}>
                        <strong>{category.gender === 'female' ? 'Damas' : category.gender === 'male' ? 'Caballeros' : category.name}</strong>
                        <div>
                          {category.flights.map((flight) => (
                            <span key={`${category.name}-${flight.name}`}>
                              {getTournamentFlightLabel(flight)}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="tournament-side-section">
                  <h3>Resumen</h3>
                  <div className="tournament-timeline">
                    <div>
                      <Icon type="score" />
                      <span>
                        Regular {formatAmountMinor(selectedTournament.registrationFeeMinor)} / reducida{' '}
                        {formatAmountMinor(getReducedFeeMinor(selectedTournament))}. Costos{' '}
                        {formatAmountMinor(selectedTournament.operatingCostMinor)} / extras{' '}
                        {formatAmountMinor(selectedTournament.prizeCostMinor)}
                      </span>
                    </div>
                    <div>
                      <Icon type="clock" />
                      <span>
                        Manana {getTournamentTeeWindows(selectedTournament).morning.first} -{' '}
                        {getTournamentTeeWindows(selectedTournament).morning.last}; tarde{' '}
                        {getTournamentTeeWindows(selectedTournament).afternoon.first} -{' '}
                        {getTournamentTeeWindows(selectedTournament).afternoon.last}, cada{' '}
                        {selectedTournament.teeWindow.interval} min
                      </span>
                    </div>
                    <div>
                      <Icon type="users" />
                      <span>
                        {selectedTournament.membersOnly ? 'Solo socios' : 'Torneo abierto'}
                      </span>
                    </div>
                    <div>
                      <Icon type="calendar" />
                      <span>
                        {selectedTournament.registrationOpenAt
                          ? `Inscripcion abre ${formatShortDateTime(selectedTournament.registrationOpenAt)}`
                          : `Inscripcion abre ${selectedTournament.openDaysBefore} dias antes`}
                        {selectedTournament.registrationCloseAt
                          ? ` y cierra ${formatShortDateTime(selectedTournament.registrationCloseAt)}`
                          : ''}
                      </span>
                    </div>
                    <div>
                      <Icon type="flag" />
                      <span>
                        Se generaran {countTeeWindowsSlots(getTournamentTeeWindows(selectedTournament))} horarios de salida:
                        {' '}
                        {countTeeSlots(getTournamentTeeWindows(selectedTournament).morning)} por la manana y{' '}
                        {countTeeSlots(getTournamentTeeWindows(selectedTournament).afternoon)} por la tarde.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {isEditorOpen && (
        <div className="modal-overlay" onClick={closeCreateTournament}>
          <section
            className="floating-card tournament-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tournament-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header">
              <div className="member-modal__title">
                <p className="eyebrow">Nuevo torneo</p>
                <h2 id="tournament-editor-title">Crear torneo</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Cerrar formulario" onClick={closeCreateTournament}>
                X
              </button>
            </div>

            <div className="tournament-stepper tournament-editor-tabs" aria-label="Pasos de creacion">
              <button
                type="button"
                className={wizardStep === 1 ? 'tournament-stepper__item tournament-stepper__item--active' : 'tournament-stepper__item'}
                onClick={() => setWizardStep(1)}
              >
                Datos
              </button>
              <button
                type="button"
                className={wizardStep === 2 ? 'tournament-stepper__item tournament-stepper__item--active' : 'tournament-stepper__item'}
                onClick={() => setWizardStep(2)}
              >
                Categorias
              </button>
              <button
                type="button"
                className={wizardStep === 3 ? 'tournament-stepper__item tournament-stepper__item--active' : 'tournament-stepper__item'}
                onClick={() => setWizardStep(3)}
              >
                Salidas
              </button>
            </div>

            <form className="member-editor-form tournament-editor-form" onSubmit={handleCreateTournament}>
              {wizardStep === 1 && (
                <>
                  <label className="form-field member-editor-form__wide" htmlFor="tournamentName">
                    <span>Nombre del torneo</span>
                    <input
                      id="tournamentName"
                      name="name"
                      type="text"
                      value={draft.name}
                      onChange={handleDraftChange}
                      placeholder="Ej. Copa Palpala"
                      required
                    />
                  </label>
                  <label className="form-field" htmlFor="tournamentDate">
                    <span>Fecha</span>
                    <input
                      id="tournamentDate"
                      name="date"
                      type="date"
                      value={draft.date}
                      onChange={handleDraftChange}
                      required
                    />
                  </label>
                  <label className="form-field" htmlFor="tournamentCapacity">
                    <span>Capacidad</span>
                    <input
                      id="tournamentCapacity"
                      name="capacity"
                      type="number"
                      min="1"
                      value={draft.capacity}
                      onChange={handleDraftChange}
                      required
                    />
                  </label>
                  <label className="form-field" htmlFor="tournamentStartType">
                    <span>Formato de salida</span>
                    <select id="tournamentStartType" name="startType" value={draft.startType} onChange={handleDraftChange}>
                      <option value="regular">Regular</option>
                      <option value="simultaneous">Salida simultanea</option>
                    </select>
                  </label>
                  <div className="tournament-editor-section tournament-editor-section--costs member-editor-form__wide">
                    <div>
                      <p className="eyebrow">Costos</p>
                      <h3>Inscripcion del torneo</h3>
                      <p>Los extras y costos operativos se agregan una vez creado el torneo.</p>
                    </div>
                    <div className="tournament-cost-form__row">
                      <label className="form-field" htmlFor="draftRegistrationFee">
                        <span>Inscripcion regular</span>
                        <input
                          id="draftRegistrationFee"
                          name="registrationFee"
                          type="text"
                          inputMode="decimal"
                          value={draft.registrationFee}
                          onChange={handleDraftChange}
                          placeholder="Ej. 15000"
                          required
                        />
                      </label>
                      <label className="form-field" htmlFor="draftReducedRegistrationFee">
                        <span>Inscripcion reducida</span>
                        <input
                          id="draftReducedRegistrationFee"
                          name="reducedRegistrationFee"
                          type="text"
                          inputMode="decimal"
                          value={draft.reducedRegistrationFee}
                          onChange={handleDraftChange}
                          placeholder="Ej. 10000"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="tournament-format-help tournament-format-selector member-editor-form__wide" role="radiogroup" aria-label="Formato del torneo">
                    {TOURNAMENT_FORMATS.map((format) => (
                      <button
                        key={format.value}
                        type="button"
                        className={draft.format === format.value ? 'tournament-format-help__item tournament-format-help__item--active' : 'tournament-format-help__item'}
                        aria-pressed={draft.format === format.value}
                        onClick={() => setDraft((current) => ({ ...current, format: format.value }))}
                      >
                        <strong>{format.label}</strong>
                        <small>{format.helper}</small>
                      </button>
                    ))}
                  </div>
                  <div className="membership-note tournament-format-summary member-editor-form__wide">
                    <span>Resumen del torneo</span>
                    <p>
                      {getFormatLabel(draft.format)} con {draft.startType === 'regular' ? 'salidas por horario' : 'salida simultanea'}.
                      La capacidad maxima sera de {Number(draft.capacity) || 0} jugadores.
                    </p>
                  </div>
                </>
              )}

              {wizardStep === 2 && (
                <>
                  {(['male', 'female'] as const).map((gender) => {
                    const genderCategories = draft.categories.filter((category) => category.gender === gender);
                    return (
                      <div key={gender} className="tournament-editor-section member-editor-form__wide">
                        <div className="tournament-section-header">
                          <div>
                            <p className="eyebrow">{gender === 'male' ? 'Caballeros' : 'Damas'}</p>
                            <h3>Categorias por handicap</h3>
                          </div>
                          <UiActionButton
                            type="button"
                            variant="secondary"
                            compact
                            onClick={() => addDraftCategory(gender)}
                          >
                            <Icon type="plus" />
                            <span>
                            Agregar categoria
                            </span>
                          </UiActionButton>
                        </div>

                        <div className="tournament-category-editor-list">
                          {genderCategories.map((category) => (
                            <article key={category.id} className="tournament-category-editor-row">
                              <label className="form-field" htmlFor={`${category.id}-name`}>
                                <span>Categoria</span>
                                <input
                                  id={`${category.id}-name`}
                                  type="text"
                                  value={category.name}
                                  onChange={(event) => updateDraftCategory(category.id, 'name', event.target.value)}
                                />
                              </label>
                              <label className="form-field" htmlFor={`${category.id}-min`}>
                                <span>Handicap minimo</span>
                                <input
                                  id={`${category.id}-min`}
                                  type="number"
                                  min="0"
                                  value={category.minHandicap}
                                  onChange={(event) => updateDraftCategory(category.id, 'minHandicap', event.target.value)}
                                />
                              </label>
                              <label className="form-field" htmlFor={`${category.id}-max`}>
                                <span>Handicap maximo</span>
                                <input
                                  id={`${category.id}-max`}
                                  type="number"
                                  min="0"
                                  value={category.maxHandicap}
                                  onChange={(event) => updateDraftCategory(category.id, 'maxHandicap', event.target.value)}
                                />
                              </label>
                              <UiActionButton
                                type="button"
                                variant="danger"
                                compact
                                disabled={genderCategories.length <= 1}
                                onClick={() => removeDraftCategory(category.id)}
                              >
                                <Icon type="minus" />
                                <span>
                                Quitar
                                </span>
                              </UiActionButton>
                            </article>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {categoryValidationMessage && (
                    <div className="field-error-message member-editor-form__wide">{categoryValidationMessage}</div>
                  )}
                </>
              )}

              {wizardStep === 3 && (
                <>
                  <label className="form-field" htmlFor="registrationOpenAt">
                    <span>Apertura programada</span>
                    <input
                      id="registrationOpenAt"
                      name="registrationOpenAt"
                      type="datetime-local"
                      value={draft.registrationOpenAt}
                      onChange={handleDraftChange}
                    />
                  </label>
                  <label className="form-field" htmlFor="registrationCloseAt">
                    <span>Cierre programado</span>
                    <input
                      id="registrationCloseAt"
                      name="registrationCloseAt"
                      type="datetime-local"
                      value={draft.registrationCloseAt}
                      onChange={handleDraftChange}
                    />
                  </label>
                  <label className="form-field" htmlFor="interval">
                    <span>Intervalo</span>
                    <select id="interval" name="interval" value={draft.interval} onChange={handleDraftChange}>
                      {Array.from({ length: 16 }, (_, index) => index + 5).map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} minutos
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="tournament-editor-section member-editor-form__wide">
                    <div>
                      <p className="eyebrow">Turno manana</p>
                      <h3>Franja de salidas</h3>
                    </div>
                    <div className="tournament-flight-grid">
                      <label className="form-field" htmlFor="morningFirstTeeTime">
                        <span>Inicio manana</span>
                        <input
                          id="morningFirstTeeTime"
                          name="morningFirstTeeTime"
                          type="time"
                          value={draft.morningFirstTeeTime}
                          onChange={handleDraftChange}
                        />
                      </label>
                      <label className="form-field" htmlFor="morningLastTeeTime">
                        <span>Corte manana</span>
                        <input
                          id="morningLastTeeTime"
                          name="morningLastTeeTime"
                          type="time"
                          value={draft.morningLastTeeTime}
                          onChange={handleDraftChange}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="tournament-editor-section member-editor-form__wide">
                    <div>
                      <p className="eyebrow">Turno tarde</p>
                      <h3>Franja de salidas</h3>
                    </div>
                    <div className="tournament-flight-grid">
                      <label className="form-field" htmlFor="afternoonFirstTeeTime">
                        <span>Inicio tarde</span>
                        <input
                          id="afternoonFirstTeeTime"
                          name="afternoonFirstTeeTime"
                          type="time"
                          value={draft.afternoonFirstTeeTime}
                          onChange={handleDraftChange}
                        />
                      </label>
                      <label className="form-field" htmlFor="afternoonLastTeeTime">
                        <span>Corte tarde</span>
                        <input
                          id="afternoonLastTeeTime"
                          name="afternoonLastTeeTime"
                          type="time"
                          value={draft.afternoonLastTeeTime}
                          onChange={handleDraftChange}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="tournament-access-mode tournament-access-mode--inline member-editor-form__wide" role="radiogroup" aria-label="Alcance del torneo">
                    <button
                      type="button"
                      className={draft.membersOnly ? 'tournament-access-mode__item tournament-access-mode__item--active' : 'tournament-access-mode__item'}
                      aria-pressed={draft.membersOnly}
                      onClick={() => setDraft((current) => ({ ...current, membersOnly: true }))}
                    >
                      <span className="tournament-radio-indicator" aria-hidden="true" />
                      <strong>Solo socios</strong>
                      <small>Inscripcion limitada al padron del club.</small>
                    </button>
                    <button
                      type="button"
                      className={!draft.membersOnly ? 'tournament-access-mode__item tournament-access-mode__item--active' : 'tournament-access-mode__item'}
                      aria-pressed={!draft.membersOnly}
                      onClick={() => setDraft((current) => ({ ...current, membersOnly: false }))}
                    >
                      <span className="tournament-radio-indicator" aria-hidden="true" />
                      <strong>Torneo abierto</strong>
                      <small>Permite participantes externos al club.</small>
                    </button>
                  </div>

                  <div className="tournament-recurring-row member-editor-form__wide">
                    <label className="check-field" htmlFor="recurring">
                      <input
                        id="recurring"
                        name="recurring"
                        type="checkbox"
                        checked={draft.recurring}
                        onChange={handleDraftChange}
                      />
                      <span>Torneo recurrente</span>
                    </label>
                    {draft.recurring && (
                      <label className="form-field" htmlFor="recurrencePeriod">
                        <span>Plazo</span>
                        <select id="recurrencePeriod" name="recurrencePeriod" value={draft.recurrencePeriod} onChange={handleDraftChange}>
                          <option value="weekly">Semanal</option>
                          <option value="biweekly">Quincenal</option>
                          <option value="monthly">Mensual</option>
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="membership-note tournament-preview-card member-editor-form__wide">
                    <span>Vista previa</span>
                    <p>
                      Se generaran {currentStepSlots} horarios: {countTeeSlots(draftTeeWindows.morning)} entre{' '}
                      {draftTeeWindows.morning.first} y {draftTeeWindows.morning.last} para el turno manana, y{' '}
                      {countTeeSlots(draftTeeWindows.afternoon)} entre {draftTeeWindows.afternoon.first} y{' '}
                      {draftTeeWindows.afternoon.last} para el turno tarde.
                    </p>
                  </div>
                  {teeValidationMessage && (
                    <div className="field-error-message member-editor-form__wide">{teeValidationMessage}</div>
                  )}
                </>
              )}

              {editorValidationMessage && (
                <div className="field-error-message tournament-editor-alert member-editor-form__wide">{editorValidationMessage}</div>
              )}

              <div className="form-actions form-actions--split tournament-editor-actions">
                <UiActionButton type="button" variant="danger" onClick={closeCreateTournament}>
                  Cancelar
                </UiActionButton>
                {wizardStep > 1 && (
                  <UiActionButton type="button" variant="secondary" onClick={() => setWizardStep((step) => step - 1)}>
                    Volver
                  </UiActionButton>
                )}
                {wizardStep < 3 ? (
                  <UiActionButton type="button" variant="positive" onClick={() => setWizardStep((step) => step + 1)}>
                    Continuar
                  </UiActionButton>
                ) : (
                  <UiActionButton type="submit" variant="positive" disabled={!isTournamentDraftReady}>
                    Crear torneo
                  </UiActionButton>
                )}
              </div>
            </form>
          </section>
        </div>
      )}

      {registrationTournament && (
        <div className="modal-overlay" onClick={() => setRegistrationTournamentId(null)}>
          <section
            className="floating-card info-dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="registration-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="info-dialog-card__header">
              <div>
                <p className="eyebrow">Inscripcion</p>
                <h2 id="registration-dialog-title">{registrationTournament.name}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Cerrar inscripcion"
                onClick={() => setRegistrationTournamentId(null)}
              >
                X
              </button>
            </div>
            <p className="profile-note">
              La solicitud queda registrada con estado pendiente de pago. Administracion registra el cobro, emite el
              recibo y lo vincula al movimiento contable.
            </p>
            <div className="tournament-receipt-summary">
              <div>
                <span>{registrationFeeSelection?.label ?? 'Monto'}</span>
                <strong>{formatAmountMinor(registrationFeeSelection?.amountMinor ?? registrationTournament.registrationFeeMinor)}</strong>
              </div>
              <div>
                <span>Regular / reducido</span>
                <strong>
                  {formatAmountMinor(registrationTournament.registrationFeeMinor)} / {formatAmountMinor(getReducedFeeMinor(registrationTournament))}
                </strong>
              </div>
              <div>
                <span>Estado inicial</span>
                <strong>Pago pendiente</strong>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn-danger" onClick={() => setRegistrationTournamentId(null)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={confirmRegistration}>
                Confirmar inscripcion
              </button>
            </div>
          </section>
        </div>
      )}

      {paymentRegistration && (
        <div className="modal-overlay" onClick={closePaymentModal}>
          <section
            className="floating-card info-dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tournament-payment-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="info-dialog-card__header">
              <div>
                <p className="eyebrow">Pago de inscripcion</p>
                <h2 id="tournament-payment-dialog-title">{paymentRegistration.participantName}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Cerrar pago" onClick={closePaymentModal}>
                X
              </button>
            </div>

            <form className="accounting-entry-form" onSubmit={handleRecordRegistrationPayment}>
              <label className="form-field">
                <span>Monto cobrado</span>
                <input
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  value={paymentDraft.amount}
                  onChange={handlePaymentDraftChange}
                  placeholder="Ej. 15000"
                  required
                />
              </label>
              <label className="form-field">
                <span>Medio de pago</span>
                <select name="paymentMethodId" value={paymentDraft.paymentMethodId} onChange={handlePaymentDraftChange}>
                  {TOURNAMENT_PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Fecha de cobro</span>
                <input
                  name="operationDate"
                  type="date"
                  value={paymentDraft.operationDate}
                  onChange={handlePaymentDraftChange}
                  required
                />
              </label>
              <label className="form-field">
                <span>Referencia</span>
                <input
                  name="paymentReference"
                  type="text"
                  value={paymentDraft.paymentReference}
                  onChange={handlePaymentDraftChange}
                  placeholder="Transferencia, lote, autorizacion"
                />
              </label>
              <label className="form-field">
                <span>Notas</span>
                <textarea
                  name="notes"
                  value={paymentDraft.notes}
                  onChange={handlePaymentDraftChange}
                  rows={3}
                />
              </label>

              <div className="form-actions">
                <button type="button" className="btn-danger" onClick={closePaymentModal}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  Registrar pago y recibo
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingCostAction)}
        title="Guardar monto"
        description={
          pendingCostAction
            ? `Vas a actualizar el monto de inscripcion y costos de "${pendingCostAction.tournamentName}".`
            : null
        }
        confirmLabel="Guardar"
        tone="default"
        onCancel={() => setPendingCostAction(null)}
        onConfirm={confirmTournamentCostChange}
      />

      <ConfirmDialog
        open={Boolean(pendingStatusAction)}
        title={pendingStatusAction?.nextStatus === 'registration_open' ? 'Abrir inscripcion' : 'Cerrar inscripcion'}
        description={
          pendingStatusAction
            ? `Vas a ${pendingStatusAction.nextStatus === 'registration_open' ? 'abrir' : 'cerrar'} la inscripcion de "${pendingStatusAction.tournamentName}".`
            : null
        }
        confirmLabel={pendingStatusAction?.nextStatus === 'registration_open' ? 'Abrir' : 'Cerrar'}
        tone={pendingStatusAction?.nextStatus === 'registration_closed' ? 'danger' : 'default'}
        onCancel={() => setPendingStatusAction(null)}
        onConfirm={confirmTournamentStatusChange}
      />
    </div>
  );
}
