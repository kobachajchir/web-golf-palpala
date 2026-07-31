import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { firestore } from '../../lib/firebase';
import { TOURNAMENTS_COLLECTIONS } from './domain/constants';
import type {
  EntityWithId,
  TournamentDocument,
  TournamentReceiptDocument,
  TournamentRegistrationDocument,
  TournamentStatus,
} from './domain/models';

type TimestampLike = { toDate: () => Date };
type SnapshotHandler<T extends object> = (items: Array<EntityWithId<T>>) => void;

function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error('Firestore is not initialized in this environment.');
  }

  return firestore;
}

function isTimestampLike(value: unknown): value is TimestampLike {
  return Boolean(value && typeof value === 'object' && 'toDate' in value && typeof (value as TimestampLike).toDate === 'function');
}

function toIsoDate(value: unknown, fallback = ''): string {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (isTimestampLike(value)) {
    return value.toDate().toISOString().slice(0, 10);
  }

  return fallback;
}

function toIsoDateTime(value: unknown, fallback = ''): string {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 16);
  }

  if (isTimestampLike(value)) {
    return value.toDate().toISOString().slice(0, 16);
  }

  return fallback;
}

function cleanPatch<T extends Record<string, unknown>>(patch: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

function sortByDateDesc<T extends { date?: string; registeredAt?: string; issuedAt?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftDate = left.date ?? left.registeredAt ?? left.issuedAt ?? '';
    const rightDate = right.date ?? right.registeredAt ?? right.issuedAt ?? '';
    return rightDate.localeCompare(leftDate);
  });
}

function normalizeTournament(id: string, data: Record<string, unknown>): EntityWithId<TournamentDocument> {
  const teeWindow = (data.teeWindow as TournamentDocument['teeWindow'] | undefined) ?? {
    first: '08:00',
    last: '12:00',
    interval: 8,
  };
  const tournament: EntityWithId<TournamentDocument> = {
    id,
    name: typeof data.name === 'string' ? data.name : 'Torneo sin nombre',
    date: toIsoDate(data.date),
    status: typeof data.status === 'string' ? data.status as TournamentDocument['status'] : 'scheduled',
    format: typeof data.format === 'string' ? data.format as TournamentDocument['format'] : 'medal',
    startType: typeof data.startType === 'string' ? data.startType as TournamentDocument['startType'] : 'regular',
    capacity: typeof data.capacity === 'number' ? data.capacity : 0,
    registered: typeof data.registered === 'number' ? data.registered : 0,
    openDaysBefore: typeof data.openDaysBefore === 'number' ? data.openDaysBefore : 0,
    membersOnly: data.membersOnly === true,
    allowNoHandicap: data.allowNoHandicap === true,
    recurring: data.recurring === true,
    recurrencePeriod: data.recurrencePeriod === 'weekly' || data.recurrencePeriod === 'biweekly' || data.recurrencePeriod === 'monthly' || data.recurrencePeriod === 'annual'
      ? data.recurrencePeriod
      : null,
    registrationOpenAt: toIsoDateTime(data.registrationOpenAt, '') || null,
    registrationCloseAt: toIsoDateTime(data.registrationCloseAt, '') || null,
    registrationFeeMinor: typeof data.registrationFeeMinor === 'number' ? data.registrationFeeMinor : 0,
    operatingCostMinor: typeof data.operatingCostMinor === 'number' ? data.operatingCostMinor : 0,
    operatingCostItems: Array.isArray(data.operatingCostItems)
      ? data.operatingCostItems as NonNullable<TournamentDocument['operatingCostItems']>
      : [],
    prizeCostMinor: typeof data.prizeCostMinor === 'number' ? data.prizeCostMinor : 0,
    costNotes: typeof data.costNotes === 'string' ? data.costNotes : null,
    teeWindow,
    categories: Array.isArray(data.categories) ? data.categories as TournamentDocument['categories'] : [],
    pendingCards: typeof data.pendingCards === 'number' ? data.pendingCards : 0,
    approvedCards: typeof data.approvedCards === 'number' ? data.approvedCards : 0,
    leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard as TournamentDocument['leaderboard'] : [],
    isDeleted: data.isDeleted === true,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };

  if (typeof data.reducedRegistrationFeeMinor === 'number') {
    tournament.reducedRegistrationFeeMinor = data.reducedRegistrationFeeMinor;
  }
  if (data.teeWindows) {
    tournament.teeWindows = data.teeWindows as NonNullable<TournamentDocument['teeWindows']>;
  }
  if (typeof data.createdBy === 'string') {
    tournament.createdBy = data.createdBy;
  }
  if (typeof data.updatedBy === 'string') {
    tournament.updatedBy = data.updatedBy;
  }

  return tournament;
}

function normalizeRegistration(id: string, data: Record<string, unknown>): EntityWithId<TournamentRegistrationDocument> {
  return {
    id,
    tournamentId: typeof data.tournamentId === 'string' ? data.tournamentId : '',
    tournamentNameSnapshot: typeof data.tournamentNameSnapshot === 'string' ? data.tournamentNameSnapshot : 'Torneo',
    tournamentDate: toIsoDate(data.tournamentDate),
    userId: typeof data.userId === 'string' ? data.userId : '',
    memberId: typeof data.memberId === 'string' ? data.memberId : null,
    participantName: typeof data.participantName === 'string' ? data.participantName : 'Participante',
    participantEmail: typeof data.participantEmail === 'string' ? data.participantEmail : null,
    participantEmailNormalized: typeof data.participantEmailNormalized === 'string' ? data.participantEmailNormalized : null,
    origin: data.origin === 'external' ? 'external' : 'member',
    approvalStatus: typeof data.approvalStatus === 'string'
      ? data.approvalStatus as NonNullable<TournamentRegistrationDocument['approvalStatus']>
      : data.status === 'pending_approval' ? 'pending' : 'not_required',
    externalPhone: typeof data.externalPhone === 'string' ? data.externalPhone : null,
    externalGender: data.externalGender === 'male' || data.externalGender === 'female' || data.externalGender === 'mixed'
      ? data.externalGender
      : null,
    externalHandicap: typeof data.externalHandicap === 'number' ? data.externalHandicap : null,
    externalAagLicense: typeof data.externalAagLicense === 'string' ? data.externalAagLicense : null,
    amountMinor: typeof data.amountMinor === 'number' ? data.amountMinor : 0,
    status: typeof data.status === 'string' ? data.status as TournamentRegistrationDocument['status'] : 'pending_payment',
    paymentStatus: typeof data.paymentStatus === 'string' ? data.paymentStatus as TournamentRegistrationDocument['paymentStatus'] : 'unpaid',
    receiptId: typeof data.receiptId === 'string' ? data.receiptId : null,
    financialMovementId: typeof data.financialMovementId === 'string' ? data.financialMovementId : null,
    registeredAt: toIsoDate(data.registeredAt),
    paidAt: toIsoDate(data.paidAt, '') || null,
    paymentMethodId: typeof data.paymentMethodId === 'string'
      ? data.paymentMethodId as NonNullable<TournamentRegistrationDocument['paymentMethodId']>
      : null,
    paymentReference: typeof data.paymentReference === 'string' ? data.paymentReference : null,
    notes: typeof data.notes === 'string' ? data.notes : null,
    approvedAt: toIsoDate(data.approvedAt, '') || null,
    approvedByUid: typeof data.approvedByUid === 'string' ? data.approvedByUid : null,
  };
}

function normalizeReceipt(id: string, data: Record<string, unknown>): EntityWithId<TournamentReceiptDocument> {
  return {
    id,
    registrationId: typeof data.registrationId === 'string' ? data.registrationId : '',
    tournamentId: typeof data.tournamentId === 'string' ? data.tournamentId : '',
    receiptNumber: typeof data.receiptNumber === 'string' ? data.receiptNumber : id,
    amountMinor: typeof data.amountMinor === 'number' ? data.amountMinor : 0,
    paymentMethodId: typeof data.paymentMethodId === 'string' ? data.paymentMethodId as TournamentReceiptDocument['paymentMethodId'] : 'cash',
    movementId: typeof data.movementId === 'string' ? data.movementId : '',
    issuedAt: toIsoDate(data.issuedAt),
  };
}

function subscribeCollection<T extends object>(
  queryRef: Query,
  normalize: (id: string, data: Record<string, unknown>) => EntityWithId<T>,
  onNext: SnapshotHandler<T>,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    queryRef,
    (snapshot) => {
      onNext(snapshot.docs.map((entry) => normalize(entry.id, entry.data())));
    },
    (error) => {
      onError?.(error);
    },
  );
}

export function subscribeTournaments(params: {
  includeAll: boolean;
  publicStatuses?: TournamentStatus[];
  onNext: SnapshotHandler<TournamentDocument>;
  onError?: (error: Error) => void;
  db?: Firestore;
}): Unsubscribe {
  const db = params.db ?? requireFirestore();
  const ref = collection(db, TOURNAMENTS_COLLECTIONS.tournaments);
  const publicStatuses = params.publicStatuses?.length ? params.publicStatuses : ['registration_open'];
  const queryRef = params.includeAll
    ? query(ref)
    : publicStatuses.length === 1
      ? query(ref, where('status', '==', publicStatuses[0]))
      : query(ref, where('status', 'in', publicStatuses));

  return subscribeCollection<TournamentDocument>(
    queryRef,
    normalizeTournament,
    (items) => params.onNext(sortByDateDesc(items).filter((tournament) => !tournament.isDeleted)),
    params.onError,
  );
}

export function subscribeOpenTournaments(params: {
  onNext: SnapshotHandler<TournamentDocument>;
  onError?: (error: Error) => void;
  db?: Firestore;
}): Unsubscribe {
  return subscribeTournaments({
    includeAll: false,
    publicStatuses: ['registration_open'],
    onNext: params.onNext,
    ...(params.onError ? { onError: params.onError } : {}),
    ...(params.db ? { db: params.db } : {}),
  });
}

export function subscribeTournamentRegistrations(params: {
  includeAll: boolean;
  userId: string;
  onNext: SnapshotHandler<TournamentRegistrationDocument>;
  onError?: (error: Error) => void;
  db?: Firestore;
}): Unsubscribe {
  const db = params.db ?? requireFirestore();
  const ref = collection(db, TOURNAMENTS_COLLECTIONS.registrations);
  const queryRef = params.includeAll ? query(ref) : query(ref, where('userId', '==', params.userId));

  return subscribeCollection<TournamentRegistrationDocument>(
    queryRef,
    normalizeRegistration,
    (items) => params.onNext(sortByDateDesc(items)),
    params.onError,
  );
}

export function subscribeTournamentReceipts(params: {
  includeAll: boolean;
  userId: string;
  onNext: SnapshotHandler<TournamentReceiptDocument>;
  onError?: (error: Error) => void;
  db?: Firestore;
}): Unsubscribe {
  const db = params.db ?? requireFirestore();
  const ref = collection(db, TOURNAMENTS_COLLECTIONS.receipts);
  const queryRef = params.includeAll ? query(ref) : query(ref, where('userId', '==', params.userId));

  return subscribeCollection<TournamentReceiptDocument>(
    queryRef,
    normalizeReceipt,
    (items) => params.onNext(sortByDateDesc(items)),
    params.onError,
  );
}

export async function listOpenTournaments(db: Firestore = requireFirestore()): Promise<Array<EntityWithId<TournamentDocument>>> {
  const ref = collection(db, TOURNAMENTS_COLLECTIONS.tournaments);
  const snapshot = await getDocs(query(ref, where('status', '==', 'registration_open')));
  return sortByDateDesc(snapshot.docs.map((entry) => normalizeTournament(entry.id, entry.data())));
}

export async function createTournamentRecord(
  tournament: EntityWithId<TournamentDocument>,
  actorUid: string,
  db: Firestore = requireFirestore(),
): Promise<void> {
  const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = tournament;
  await setDoc(doc(db, TOURNAMENTS_COLLECTIONS.tournaments, id), cleanPatch({
    ...data,
    isDeleted: false,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }));
}

export async function createTournamentRegistrationRecord(
  registration: EntityWithId<TournamentRegistrationDocument>,
  actorUid: string,
  db: Firestore = requireFirestore(),
): Promise<void> {
  const { id, ...data } = registration;
  const docRef = doc(db, TOURNAMENTS_COLLECTIONS.registrations, id);
  const finalData = cleanPatch({
    ...data,
    isDeleted: false,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });

  try {
    await setDoc(docRef, finalData);
  } catch (error) {
    await setDoc(docRef, cleanPatch({
      ...finalData,
      userId: actorUid,
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      receiptId: null,
      financialMovementId: null,
    }));
    await updateDoc(docRef, cleanPatch({
      ...data,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
    }));
  }
}

export async function updateTournamentRecord(
  tournamentId: string,
  patch: Partial<TournamentDocument>,
  actorUid: string,
  db: Firestore = requireFirestore(),
): Promise<void> {
  await updateDoc(doc(db, TOURNAMENTS_COLLECTIONS.tournaments, tournamentId), cleanPatch({
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  }));
}
