import type {
  EntityWithId,
  TournamentReceiptDocument,
  TournamentRegistrationDocument,
  TournamentDocument,
} from './models.js';
import type { AccountingDataAccess, Clock } from '../../accounting/domain/ports.js';

export type StorePatch<T extends object> = {
  [K in keyof T]?: T[K] | null | undefined;
};

export type StoreCreate<T extends object> = {
  [K in keyof T]: T[K] | undefined;
};

export interface TournamentRegistrationsStore {
  getById(registrationId: string): Promise<EntityWithId<TournamentRegistrationDocument> | null>;
  findDuplicate(params: {
    tournamentId: string;
    userId: string;
    memberId?: string | null;
  }): Promise<EntityWithId<TournamentRegistrationDocument> | null>;
  findExternalDuplicate(params: {
    tournamentId: string;
    participantEmailNormalized: string;
  }): Promise<EntityWithId<TournamentRegistrationDocument> | null>;
  create(
    data: StoreCreate<Omit<TournamentRegistrationDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
  update(
    registrationId: string,
    patch: StorePatch<TournamentRegistrationDocument>,
    actorUid: string,
  ): Promise<void>;
}

export interface TournamentReceiptsStore {
  getById(receiptId: string): Promise<EntityWithId<TournamentReceiptDocument> | null>;
  create(
    data: StoreCreate<Omit<TournamentReceiptDocument, keyof import('./models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string>;
}

export interface TournamentsStore {
  getById(tournamentId: string): Promise<EntityWithId<TournamentDocument> | null>;
  listRegistrationWindowCandidates(): Promise<Array<EntityWithId<TournamentDocument>>>;
  update(
    tournamentId: string,
    patch: StorePatch<TournamentDocument>,
    actorUid: string,
  ): Promise<void>;
}

export interface TournamentsDataAccess {
  tournaments: TournamentsStore;
  registrations: TournamentRegistrationsStore;
  receipts: TournamentReceiptsStore;
}

export interface TournamentsTransactionManager {
  runInTransaction<T>(handler: (dataAccess: TournamentsDataAccess) => Promise<T>): Promise<T>;
  runWithAccountingInTransaction<T>(
    clock: Clock,
    handler: (dataAccess: TournamentsDataAccess, accountingDataAccess: AccountingDataAccess) => Promise<T>,
  ): Promise<T>;
  getDataAccess(): TournamentsDataAccess;
}
