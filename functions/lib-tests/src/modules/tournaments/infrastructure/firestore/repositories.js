import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, } from 'firebase-admin/firestore';
import { createAdminConverter } from '../../../users/infrastructure/firestore/converters.js';
import { createFirestoreAccountingDataAccess } from '../../../accounting/infrastructure/firestore/repositories.js';
import { TOURNAMENTS_COLLECTIONS } from '../../domain/constants.js';
function getOrInitializeApp() {
    return getApps().length > 0 ? getApp() : initializeApp();
}
function getDatabase() {
    return getFirestore(getOrInitializeApp());
}
function getCollection(db, path) {
    return db.collection(path).withConverter(createAdminConverter());
}
function stripUndefined(data) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}
function createAuditedDocument(data, actorUid) {
    return {
        ...stripUndefined(data),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
    };
}
function createAuditedPatch(patch, actorUid) {
    const result = {
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
    };
    for (const key of Object.keys(patch)) {
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
function withId(snapshot) {
    return {
        id: snapshot.id,
        ...snapshot.data(),
    };
}
class FirestoreTournamentRegistrationsStore {
    transaction;
    collection;
    constructor(db, transaction) {
        this.transaction = transaction;
        this.collection = getCollection(db, TOURNAMENTS_COLLECTIONS.registrations);
    }
    async getById(registrationId) {
        const snapshot = this.transaction
            ? await this.transaction.get(this.collection.doc(registrationId))
            : await this.collection.doc(registrationId).get();
        return snapshot.exists ? withId(snapshot) : null;
    }
    async findDuplicate(params) {
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
    async create(data, actorUid) {
        const docRef = this.collection.doc();
        const document = createAuditedDocument(data, actorUid);
        if (this.transaction) {
            this.transaction.create(docRef, document);
            return docRef.id;
        }
        await docRef.create(document);
        return docRef.id;
    }
    async update(registrationId, patch, actorUid) {
        const document = createAuditedPatch(patch, actorUid);
        const docRef = this.collection.doc(registrationId);
        if (this.transaction) {
            this.transaction.update(docRef, document);
            return;
        }
        await docRef.update(document);
    }
}
class FirestoreTournamentReceiptsStore {
    transaction;
    collection;
    constructor(db, transaction) {
        this.transaction = transaction;
        this.collection = getCollection(db, TOURNAMENTS_COLLECTIONS.receipts);
    }
    async getById(receiptId) {
        const snapshot = this.transaction
            ? await this.transaction.get(this.collection.doc(receiptId))
            : await this.collection.doc(receiptId).get();
        return snapshot.exists ? withId(snapshot) : null;
    }
    async create(data, actorUid) {
        const docRef = this.collection.doc();
        const document = createAuditedDocument(data, actorUid);
        if (this.transaction) {
            this.transaction.create(docRef, document);
            return docRef.id;
        }
        await docRef.create(document);
        return docRef.id;
    }
}
function createDataAccess(db, transaction) {
    return {
        registrations: new FirestoreTournamentRegistrationsStore(db, transaction),
        receipts: new FirestoreTournamentReceiptsStore(db, transaction),
    };
}
export class FirestoreTournamentsTransactionManager {
    db = getDatabase();
    async runInTransaction(handler) {
        return this.db.runTransaction(async (transaction) => handler(createDataAccess(this.db, transaction)));
    }
    async runWithAccountingInTransaction(clock, handler) {
        return this.db.runTransaction(async (transaction) => handler(createDataAccess(this.db, transaction), createFirestoreAccountingDataAccess(this.db, clock, transaction)));
    }
    getDataAccess() {
        return createDataAccess(this.db);
    }
}
//# sourceMappingURL=repositories.js.map