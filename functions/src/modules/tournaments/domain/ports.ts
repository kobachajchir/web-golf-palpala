import type {
  EntityWithId,
  TournamentReceiptDocument,
  TournamentRegistrationDocument,
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

export interface TournamentsDataAccess {
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
