import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { createAdminConverter } from '../../../users/infrastructure/firestore/converters.js';
import { createFirestoreAccountingDataAccess } from '../../../accounting/infrastructure/firestore/repositories.js';
import type { AccountingDataAccess, Clock } from '../../../accounting/domain/ports.js';
import { TOURNAMENTS_COLLECTIONS } from '../../domain/constants.js';
import type {
  EntityWithId,
  TournamentReceiptDocument,
  TournamentRegistrationDocument,
} from '../../domain/models.js';
import type {
  StorePatch,
  TournamentsDataAccess,
  TournamentsTransactionManager,
  TournamentReceiptsStore,
  TournamentRegistrationsStore,
} from '../../domain/ports.js';

function getOrInitializeApp() {
  return getApps().length > 0 ? getApp() : initializeApp();
}

function getDatabase(): Firestore {
  return getFirestore(getOrInitializeApp());
}

function getCollection<T extends DocumentData>(db: Firestore, path: string): CollectionReference<T> {
  return db.collection(path).withConverter(createAdminConverter<T>()) as CollectionReference<T>;
}

function stripUndefined<T extends DocumentData>(data: T): DocumentData {
  const result: DocumentData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function createAuditedDocument<T extends DocumentData>(data: T, actorUid: string): DocumentData {
  return {
    ...stripUndefined(data),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  };
}

function createAuditedPatch<T extends DocumentData>(patch: StorePatch<T>, actorUid: string): DocumentData {
  const result: DocumentData = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  };

  for (const key of Object.keys(patch) as Array<keyof T>) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) {
      continue;
    }

    const value = patch[key];
    if (value === undefined) {
      continue;
    }

    result[String(key)] = value === null ? FieldValue.delete() : value;
  }

  return result;
}

function withId<T extends DocumentData>(snapshot: QueryDocumentSnapshot<T>): EntityWithId<T> {
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

class FirestoreTournamentRegistrationsStore implements TournamentRegistrationsStore {
  private readonly collection: CollectionReference<TournamentRegistrationDocument>;

  public constructor(db: Firestore, private readonly transaction?: Transaction) {
    this.collection = getCollection<TournamentRegistrationDocument>(db, TOURNAMENTS_COLLECTIONS.registrations);
  }

  public async getById(registrationId: string): Promise<EntityWithId<TournamentRegistrationDocument> | null> {
    const snapshot = this.transaction
      ? await this.transaction.get(this.collection.doc(registrationId))
      : await this.collection.doc(registrationId).get();
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<TournamentRegistrationDocument>) : null;
  }

  public async findDuplicate(params: {
    tournamentId: string;
    userId: string;
    memberId?: string | null;
  }): Promise<EntityWithId<TournamentRegistrationDocument> | null> {
    let query = this.collection
      .where('tournamentId', '==', params.tournamentId)
      .where('userId', '==', params.userId)
      .limit(1);

    if (params.memberId) {
      query = this.collection
        .where('tournamentId', '==', params.tournamentId)
        .where('memberId', '==', params.memberId)
        .limit(1);
    }

    const snapshot = this.transaction ? await this.transaction.get(query) : await query.get();
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public async create(
    data: Omit<TournamentRegistrationDocument, keyof import('../../domain/models.js').AuditFields>,
    actorUid: string,
  ): Promise<string> {
    const docRef = this.collection.doc();
    const document = createAuditedDocument(data, actorUid);
    if (this.transaction) {
      this.transaction.create(docRef, document as never);
      return docRef.id;
    }

    await docRef.create(document as never);
    return docRef.id;
  }

  public async update(
    registrationId: string,
    patch: StorePatch<TournamentRegistrationDocument>,
    actorUid: string,
  ): Promise<void> {
    const document = createAuditedPatch(patch, actorUid);
    const docRef = this.collection.doc(registrationId);
    if (this.transaction) {
      this.transaction.update(docRef, document as never);
      return;
    }

    await docRef.update(document as never);
  }
}

class FirestoreTournamentReceiptsStore implements TournamentReceiptsStore {
  private readonly collection: CollectionReference<TournamentReceiptDocument>;

  public constructor(db: Firestore, private readonly transaction?: Transaction) {
    this.collection = getCollection<TournamentReceiptDocument>(db, TOURNAMENTS_COLLECTIONS.receipts);
  }

  public async getById(receiptId: string): Promise<EntityWithId<TournamentReceiptDocument> | null> {
    const snapshot = this.transaction
      ? await this.transaction.get(this.collection.doc(receiptId))
      : await this.collection.doc(receiptId).get();
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<TournamentReceiptDocument>) : null;
  }

  public async create(
    data: Omit<TournamentReceiptDocument, keyof import('../../domain/models.js').AuditFields>,
    actorUid: string,
  ): Promise<string> {
    const docRef = this.collection.doc();
    const document = createAuditedDocument(data, actorUid);
    if (this.transaction) {
      this.transaction.create(docRef, document as never);
      return docRef.id;
    }

    await docRef.create(document as never);
    return docRef.id;
  }
}

function createDataAccess(db: Firestore, transaction?: Transaction): TournamentsDataAccess {
  return {
    registrations: new FirestoreTournamentRegistrationsStore(db, transaction),
    receipts: new FirestoreTournamentReceiptsStore(db, transaction),
  };
}

export class FirestoreTournamentsTransactionManager implements TournamentsTransactionManager {
  private readonly db = getDatabase();

  public async runInTransaction<T>(handler: (dataAccess: TournamentsDataAccess) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => handler(createDataAccess(this.db, transaction)));
  }

  public async runWithAccountingInTransaction<T>(
    clock: Clock,
    handler: (dataAccess: TournamentsDataAccess, accountingDataAccess: AccountingDataAccess) => Promise<T>,
  ): Promise<T> {
    return this.db.runTransaction(async (transaction) =>
      handler(
        createDataAccess(this.db, transaction),
        createFirestoreAccountingDataAccess(this.db, clock, transaction),
      ),
    );
  }

  public getDataAccess(): TournamentsDataAccess {
    return createDataAccess(this.db);
  }
}
