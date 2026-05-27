import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, } from 'firebase-admin/firestore';
import { ACCOUNTING_COLLECTIONS, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { USERS_COLLECTIONS } from '../../../users/domain/constants.js';
import { TOURNAMENTS_COLLECTIONS } from '../../../tournaments/domain/constants.js';
import { createAdminConverter } from '../../../users/infrastructure/firestore/converters.js';
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
async function getSnapshot(ref, transaction) {
    return transaction ? transaction.get(ref) : ref.get();
}
async function getQuerySnapshot(query, transaction) {
    return transaction ? transaction.get(query) : query.get();
}
async function writeSet(ref, data, transaction) {
    if (transaction) {
        transaction.set(ref, data, { merge: false });
        return;
    }
    await ref.set(data);
}
async function writeUpdate(ref, data, transaction) {
    if (transaction) {
        transaction.update(ref, data);
        return;
    }
    await ref.update(data);
}
async function createDocument(collection, data, transaction) {
    const docRef = collection.doc();
    if (transaction) {
        transaction.create(docRef, data);
        return docRef.id;
    }
    await docRef.create(data);
    return docRef.id;
}
function withId(snapshot) {
    return {
        id: snapshot.id,
        ...snapshot.data(),
    };
}
function normalizeLimit(limit) {
    if (limit === undefined) {
        return DEFAULT_PAGE_SIZE;
    }
    return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
}
class FirestoreCollectionStore {
    collection;
    transaction;
    constructor(collection, transaction) {
        this.collection = collection;
        this.transaction = transaction;
    }
    async getByIdInternal(id) {
        const snapshot = await getSnapshot(this.collection.doc(id), this.transaction);
        return snapshot.exists ? withId(snapshot) : null;
    }
    async createInternal(data, actorUid) {
        return createDocument(this.collection, createAuditedDocument(data, actorUid), this.transaction);
    }
    async setInternal(id, data, actorUid) {
        await writeSet(this.collection.doc(id), createAuditedDocument(data, actorUid), this.transaction);
    }
    async updateInternal(id, patch, actorUid) {
        await writeUpdate(this.collection.doc(id), createAuditedPatch(patch, actorUid), this.transaction);
    }
    async applyCursor(query, cursorId) {
        if (!cursorId) {
            return query;
        }
        const cursorSnapshot = await getSnapshot(this.collection.doc(cursorId), this.transaction);
        assertCondition(cursorSnapshot.exists, 'not-found', `No existe cursor ${this.collection.path}/${cursorId}.`);
        return query.startAfter(cursorSnapshot);
    }
    async listPageFromQuery(query, limit) {
        const normalizedLimit = normalizeLimit(limit);
        const snapshot = await getQuerySnapshot(query.limit(normalizedLimit), this.transaction);
        const items = snapshot.docs.map((doc) => withId(doc));
        const nextCursorId = items.length === normalizedLimit ? items.at(-1)?.id : undefined;
        return {
            items,
            ...(nextCursorId ? { nextCursorId } : {}),
        };
    }
    async listFromQuery(query) {
        const snapshot = await getQuerySnapshot(query, this.transaction);
        return snapshot.docs.map((doc) => withId(doc));
    }
}
class FirestoreUsersReferenceStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, USERS_COLLECTIONS.users), transaction);
    }
    getById(uid) {
        return this.getByIdInternal(uid);
    }
}
class FirestoreMembersReferenceStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, USERS_COLLECTIONS.members), transaction);
    }
    getById(memberId) {
        return this.getByIdInternal(memberId);
    }
    update(memberId, patch, actorUid) {
        return this.updateInternal(memberId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = query.orderBy(FieldPath.documentId());
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreFamilyGroupsReferenceStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, USERS_COLLECTIONS.familyGroups), transaction);
    }
    getById(groupId) {
        return this.getByIdInternal(groupId);
    }
}
class FirestoreEmployeesReferenceStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, USERS_COLLECTIONS.employees), transaction);
    }
    getById(employeeId) {
        return this.getByIdInternal(employeeId);
    }
}
class FirestoreHandicapsReferenceStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, USERS_COLLECTIONS.handicaps), transaction);
    }
    getById(handicapId) {
        return this.getByIdInternal(handicapId);
    }
}
class FirestoreTournamentRegistrationsReferenceStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, TOURNAMENTS_COLLECTIONS.registrations), transaction);
    }
    getById(registrationId) {
        return this.getByIdInternal(registrationId);
    }
    update(registrationId, patch, actorUid) {
        return this.updateInternal(registrationId, patch, actorUid);
    }
}
class FirestoreFinancialConfigsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.financialConfigs), transaction);
    }
    getById(configId) {
        return this.getByIdInternal(configId);
    }
    async getActive() {
        const snapshot = await getQuerySnapshot(this.collection.where('isActive', '==', true).limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    async getLatestVersion() {
        const snapshot = await getQuerySnapshot(this.collection.orderBy('version', 'desc').limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(configId, patch, actorUid) {
        return this.updateInternal(configId, patch, actorUid);
    }
}
class FirestorePaymentMethodsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.paymentMethods), transaction);
    }
    getById(paymentMethodId) {
        return this.getByIdInternal(paymentMethodId);
    }
    set(paymentMethodId, data, actorUid) {
        return this.setInternal(paymentMethodId, data, actorUid);
    }
}
class FirestorePaymentCommissionRulesStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.paymentCommissionRules), transaction);
    }
    getById(ruleId) {
        return this.getByIdInternal(ruleId);
    }
    async getActiveByPaymentMethodId(paymentMethodId) {
        const query = this.collection
            .where('paymentMethodId', '==', paymentMethodId)
            .where('isActive', '==', true)
            .orderBy('validFrom', 'desc')
            .limit(1);
        const snapshot = await getQuerySnapshot(query, this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(ruleId, patch, actorUid) {
        return this.updateInternal(ruleId, patch, actorUid);
    }
}
class FirestoreFinancialIncomeCategoriesStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.financialIncomeCategories), transaction);
    }
    getById(categoryId) {
        return this.getByIdInternal(categoryId);
    }
    set(categoryId, data, actorUid) {
        return this.setInternal(categoryId, data, actorUid);
    }
}
class FirestoreFinancialExpenseCategoriesStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.financialExpenseCategories), transaction);
    }
    getById(categoryId) {
        return this.getByIdInternal(categoryId);
    }
    set(categoryId, data, actorUid) {
        return this.setInternal(categoryId, data, actorUid);
    }
}
class FirestoreFinancialMovementsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.financialMovements), transaction);
    }
    getById(movementId) {
        return this.getByIdInternal(movementId);
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(movementId, patch, actorUid) {
        return this.updateInternal(movementId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.movementType) {
            query = query.where('movementType', '==', filters.movementType);
        }
        if (filters.categoryCodeSnapshot) {
            query = query.where('categoryCodeSnapshot', '==', filters.categoryCodeSnapshot);
        }
        if (filters.paymentMethodCodeSnapshot) {
            query = query.where('paymentMethodCodeSnapshot', '==', filters.paymentMethodCodeSnapshot);
        }
        if (filters.thirdPartyType) {
            query = query.where('thirdPartyType', '==', filters.thirdPartyType);
        }
        if (filters.thirdPartyId) {
            query = query.where('thirdPartyId', '==', filters.thirdPartyId);
        }
        if (filters.accountingPeriod) {
            query = query.where('accountingPeriod', '==', filters.accountingPeriod);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        if (filters.settlementId) {
            query = query.where('settlementId', '==', filters.settlementId).orderBy('operationDate', 'asc');
        }
        else {
            if (filters.bancarizado !== undefined) {
                query = query.where('bancarizado', '==', filters.bancarizado);
            }
            if (filters.imputableImpositivo !== undefined) {
                query = query.where('imputableImpositivo', '==', filters.imputableImpositivo);
            }
            query = query.orderBy('operationDate', 'desc');
        }
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
    async listBySettlementId(settlementId) {
        const query = this.collection.where('settlementId', '==', settlementId).orderBy('operationDate', 'asc');
        return this.listFromQuery(query);
    }
}
class FirestoreMacroDebitSettlementsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.macroDebitSettlements), transaction);
    }
    getById(settlementId) {
        return this.getByIdInternal(settlementId);
    }
    async getByExternalBatchRef(externalBatchRef) {
        const snapshot = await getQuerySnapshot(this.collection.where('externalBatchRef', '==', externalBatchRef).limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(settlementId, patch, actorUid) {
        return this.updateInternal(settlementId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.month) {
            query = query.where('month', '==', filters.month).orderBy('month', 'desc');
        }
        else {
            query = query.orderBy('month', 'desc');
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreSalaryConfigurationsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.salaryConfigurations), transaction);
    }
    getById(configurationId) {
        return this.getByIdInternal(configurationId);
    }
    async getActiveByEmployeeId(employeeId) {
        const query = this.collection
            .where('employeeId', '==', employeeId)
            .where('isActive', '==', true)
            .orderBy('effectiveFrom', 'desc')
            .limit(1);
        const snapshot = await getQuerySnapshot(query, this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(configurationId, patch, actorUid) {
        return this.updateInternal(configurationId, patch, actorUid);
    }
}
class FirestoreSalaryPaymentsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.salaryPayments), transaction);
    }
    getById(paymentId) {
        return this.getByIdInternal(paymentId);
    }
    async findByEmployeeAndPeriod(employeeId, period) {
        const snapshot = await getQuerySnapshot(this.collection
            .where('employeeId', '==', employeeId)
            .where('period', '==', period)
            .limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(paymentId, patch, actorUid) {
        return this.updateInternal(paymentId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.employeeId) {
            query = query.where('employeeId', '==', filters.employeeId);
        }
        if (filters.period) {
            query = query.where('period', '==', filters.period);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = query.orderBy('period', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestorePayrollConfigsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.payrollConfigs), transaction);
    }
    getCurrent() {
        return this.getByIdInternal('current');
    }
    setCurrent(data, actorUid) {
        return this.setInternal('current', data, actorUid);
    }
}
class FirestoreOvertimeEntriesStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.overtimeEntries), transaction);
    }
    getById(overtimeEntryId) {
        return this.getByIdInternal(overtimeEntryId);
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(overtimeEntryId, patch, actorUid) {
        return this.updateInternal(overtimeEntryId, patch, actorUid);
    }
    async listApprovedByEmployeeAndPeriod(employeeId, period) {
        return this.listFromQuery(this.collection
            .where('employeeId', '==', employeeId)
            .where('period', '==', period)
            .where('status', '==', 'approved')
            .orderBy('workDate', 'asc'));
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.employeeId) {
            query = query.where('employeeId', '==', filters.employeeId);
        }
        if (filters.period) {
            query = query.where('period', '==', filters.period);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = query.orderBy('workDate', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreEmployeePayrollCyclesStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.employeePayrollCycles), transaction);
    }
    getById(cycleId) {
        return this.getByIdInternal(cycleId);
    }
    async findByEmployeeAndPeriod(employeeId, period) {
        const snapshot = await getQuerySnapshot(this.collection.where('employeeId', '==', employeeId).where('period', '==', period).limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(cycleId, patch, actorUid) {
        return this.updateInternal(cycleId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.employeeId) {
            query = query.where('employeeId', '==', filters.employeeId);
        }
        if (filters.period) {
            query = query.where('period', '==', filters.period);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = query.orderBy('period', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreEmployeeAccountingLinksStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.employeeAccountingLinks), transaction);
    }
    getById(linkId) {
        return this.getByIdInternal(linkId);
    }
    async findDuplicate(params) {
        const snapshot = await getQuerySnapshot(this.collection
            .where('employeeId', '==', params.employeeId)
            .where('period', '==', params.period)
            .where('referenceId', '==', params.referenceId)
            .limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    async findByEmployeePeriodAndReferenceType(params) {
        const snapshot = await getQuerySnapshot(this.collection
            .where('employeeId', '==', params.employeeId)
            .where('period', '==', params.period)
            .where('referenceType', '==', params.referenceType)
            .limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(linkId, patch, actorUid) {
        return this.updateInternal(linkId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.employeeId) {
            query = query.where('employeeId', '==', filters.employeeId);
        }
        if (filters.period) {
            query = query.where('period', '==', filters.period);
        }
        if (filters.referenceId) {
            query = query.where('referenceId', '==', filters.referenceId);
        }
        if (filters.referenceType) {
            query = query.where('referenceType', '==', filters.referenceType);
        }
        query = query.orderBy('period', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreEmployeeCertificatesStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.employeeCertificates), transaction);
    }
    getById(certificateId) {
        return this.getByIdInternal(certificateId);
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(certificateId, patch, actorUid) {
        return this.updateInternal(certificateId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.employeeId) {
            query = query.where('employeeId', '==', filters.employeeId);
        }
        if (filters.period) {
            query = query.where('period', '==', filters.period);
        }
        if (filters.certificateType) {
            query = query.where('certificateType', '==', filters.certificateType);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = query.orderBy('period', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreCashClosuresStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.cashClosures), transaction);
    }
    getById(cashClosureId) {
        return this.getByIdInternal(cashClosureId);
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(cashClosureId, patch, actorUid) {
        return this.updateInternal(cashClosureId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.period) {
            query = query.where('period', '==', filters.period);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = query.orderBy('closureDate', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreExternalAccountingReferencesStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.externalAccountingReferences), transaction);
    }
    getById(referenceId) {
        return this.getByIdInternal(referenceId);
    }
    async findByEmployeePeriodAndReferenceType(params) {
        const snapshot = await getQuerySnapshot(this.collection
            .where('employeeId', '==', params.employeeId)
            .where('period', '==', params.period)
            .where('referenceType', '==', params.referenceType)
            .limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(referenceId, patch, actorUid) {
        return this.updateInternal(referenceId, patch, actorUid);
    }
}
class FirestoreExpenseSubmissionsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.expenseSubmissions), transaction);
    }
    getById(expenseSubmissionId) {
        return this.getByIdInternal(expenseSubmissionId);
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(expenseSubmissionId, patch, actorUid) {
        return this.updateInternal(expenseSubmissionId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.employeeId) {
            query = query.where('employeeId', '==', filters.employeeId);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = query.orderBy('expenseDate', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreConcessionContractsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.concessionContracts), transaction);
    }
    getById(contractId) {
        return this.getByIdInternal(contractId);
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(contractId, patch, actorUid) {
        return this.updateInternal(contractId, patch, actorUid);
    }
}
class FirestoreAdvertisingContractsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.advertisingContracts), transaction);
    }
    getById(contractId) {
        return this.getByIdInternal(contractId);
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(contractId, patch, actorUid) {
        return this.updateInternal(contractId, patch, actorUid);
    }
}
class FirestoreHandicapChargesStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.handicapCharges), transaction);
    }
    getById(handicapChargeId) {
        return this.getByIdInternal(handicapChargeId);
    }
    async findByMemberAndPeriod(memberId, period) {
        const snapshot = await getQuerySnapshot(this.collection.where('memberId', '==', memberId).where('period', '==', period).limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(handicapChargeId, patch, actorUid) {
        return this.updateInternal(handicapChargeId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.memberId) {
            query = query.where('memberId', '==', filters.memberId);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = query.orderBy('period', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreMemberFeeChargesStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.memberFeeCharges), transaction);
    }
    getById(memberFeeChargeId) {
        return this.getByIdInternal(memberFeeChargeId);
    }
    async findDuplicate(params) {
        let query = this.collection
            .where('period', '==', params.period)
            .where('billingMode', '==', params.billingMode);
        if (params.billingMode === 'single_group_charge') {
            query = query.where('familyGroupId', '==', params.familyGroupId ?? null);
        }
        else {
            query = query.where('memberId', '==', params.memberId ?? null);
        }
        const snapshot = await getQuerySnapshot(query.limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    create(data, actorUid) {
        return this.createInternal(data, actorUid);
    }
    update(memberFeeChargeId, patch, actorUid) {
        return this.updateInternal(memberFeeChargeId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.memberId) {
            query = query.where('memberId', '==', filters.memberId);
        }
        if (filters.familyGroupId) {
            query = query.where('familyGroupId', '==', filters.familyGroupId);
        }
        if (filters.period) {
            query = query.where('period', '==', filters.period);
        }
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        query = query.orderBy('period', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreMercadoPagoCheckoutSessionsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.mercadoPagoCheckoutSessions), transaction);
    }
    getById(sessionId) {
        return this.getByIdInternal(sessionId);
    }
    async getByExternalReference(externalReference) {
        const snapshot = await getQuerySnapshot(this.collection.where('externalReference', '==', externalReference).limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    async getByPaymentId(paymentId) {
        const snapshot = await getQuerySnapshot(this.collection.where('paymentId', '==', paymentId).limit(1), this.transaction);
        return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
    }
    set(sessionId, data, actorUid) {
        return this.setInternal(sessionId, data, actorUid);
    }
    update(sessionId, patch, actorUid) {
        return this.updateInternal(sessionId, patch, actorUid);
    }
    async listPage(filters) {
        let query = this.collection;
        if (filters.status) {
            query = query.where('status', '==', filters.status);
        }
        if (filters.createdByUid) {
            query = query.where('createdByUid', '==', filters.createdByUid);
        }
        query = query.orderBy('updatedAt', 'desc');
        query = await this.applyCursor(query, filters.cursorId);
        return this.listPageFromQuery(query, filters.limit);
    }
}
class FirestoreMercadoPagoEventsStore extends FirestoreCollectionStore {
    constructor(db, transaction) {
        super(getCollection(db, ACCOUNTING_COLLECTIONS.mercadoPagoEvents), transaction);
    }
    getById(eventId) {
        return this.getByIdInternal(eventId);
    }
    set(eventId, data, actorUid) {
        return this.setInternal(eventId, data, actorUid);
    }
    update(eventId, patch, actorUid) {
        return this.updateInternal(eventId, patch, actorUid);
    }
}
export function createFirestoreAccountingDataAccess(db, clock, transaction) {
    void clock;
    return {
        users: new FirestoreUsersReferenceStore(db, transaction),
        members: new FirestoreMembersReferenceStore(db, transaction),
        familyGroups: new FirestoreFamilyGroupsReferenceStore(db, transaction),
        employees: new FirestoreEmployeesReferenceStore(db, transaction),
        handicaps: new FirestoreHandicapsReferenceStore(db, transaction),
        tournamentRegistrations: new FirestoreTournamentRegistrationsReferenceStore(db, transaction),
        financialConfigs: new FirestoreFinancialConfigsStore(db, transaction),
        paymentMethods: new FirestorePaymentMethodsStore(db, transaction),
        paymentCommissionRules: new FirestorePaymentCommissionRulesStore(db, transaction),
        financialIncomeCategories: new FirestoreFinancialIncomeCategoriesStore(db, transaction),
        financialExpenseCategories: new FirestoreFinancialExpenseCategoriesStore(db, transaction),
        financialMovements: new FirestoreFinancialMovementsStore(db, transaction),
        macroDebitSettlements: new FirestoreMacroDebitSettlementsStore(db, transaction),
        salaryConfigurations: new FirestoreSalaryConfigurationsStore(db, transaction),
        salaryPayments: new FirestoreSalaryPaymentsStore(db, transaction),
        payrollConfigs: new FirestorePayrollConfigsStore(db, transaction),
        overtimeEntries: new FirestoreOvertimeEntriesStore(db, transaction),
        employeePayrollCycles: new FirestoreEmployeePayrollCyclesStore(db, transaction),
        employeeAccountingLinks: new FirestoreEmployeeAccountingLinksStore(db, transaction),
        employeeCertificates: new FirestoreEmployeeCertificatesStore(db, transaction),
        cashClosures: new FirestoreCashClosuresStore(db, transaction),
        externalAccountingReferences: new FirestoreExternalAccountingReferencesStore(db, transaction),
        expenseSubmissions: new FirestoreExpenseSubmissionsStore(db, transaction),
        concessionContracts: new FirestoreConcessionContractsStore(db, transaction),
        advertisingContracts: new FirestoreAdvertisingContractsStore(db, transaction),
        handicapCharges: new FirestoreHandicapChargesStore(db, transaction),
        memberFeeCharges: new FirestoreMemberFeeChargesStore(db, transaction),
        mercadoPagoCheckoutSessions: new FirestoreMercadoPagoCheckoutSessionsStore(db, transaction),
        mercadoPagoEvents: new FirestoreMercadoPagoEventsStore(db, transaction),
    };
}
export class FirestoreAccountingTransactionManager {
    clock;
    db = getDatabase();
    constructor(clock) {
        this.clock = clock;
    }
    async runInTransaction(handler) {
        return this.db.runTransaction(async (transaction) => handler(createFirestoreAccountingDataAccess(this.db, this.clock, transaction)));
    }
    getDataAccess() {
        return createFirestoreAccountingDataAccess(this.db, this.clock);
    }
}
export class SystemClock {
    now() {
        return new Date();
    }
}
//# sourceMappingURL=repositories.js.map