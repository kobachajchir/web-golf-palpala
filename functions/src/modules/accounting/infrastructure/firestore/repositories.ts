import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  getFirestore,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  ACCOUNTING_COLLECTIONS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type {
  AdvertisingContractDocument,
  CashClosureDocument,
  ConcessionContractDocument,
  EmployeeAccountingLinkDocument,
  EmployeeCertificateDocument,
  EmployeePayrollCycleDocument,
  EntityWithId,
  ExpenseSubmissionDocument,
  ExternalAccountingReferenceDocument,
  FinancialConfigDocument,
  FinancialExpenseCategoryDocument,
  FinancialIncomeCategoryDocument,
  FinancialMovementDocument,
  HandicapChargeDocument,
  MacroDebitSettlementDocument,
  MemberFeeChargeDocument,
  OvertimeEntryDocument,
  PayrollConfigDocument,
  PaymentCommissionRuleDocument,
  PaymentMethodDocument,
  ReferencedEmployeeDocument,
  ReferencedFamilyGroupDocument,
  ReferencedHandicapDocument,
  ReferencedMemberDocument,
  ReferencedUserDocument,
  SalaryConfigurationDocument,
  SalaryPaymentDocument,
} from '../../domain/models.js';
import type {
  AccountingDataAccess,
  AccountingTransactionManager,
  AdvertisingContractsStore,
  CashClosureFilters,
  CashClosuresStore,
  Clock,
  ConcessionContractsStore,
  CursorPage,
  EmployeeAccountingLinkFilters,
  EmployeeAccountingLinksStore,
  EmployeeCertificateFilters,
  EmployeeCertificatesStore,
  EmployeePayrollCycleFilters,
  EmployeePayrollCyclesStore,
  EmployeesReferenceStore,
  ExpenseSubmissionsStore,
  ExternalAccountingReferencesStore,
  FamilyGroupsReferenceStore,
  FinancialConfigsStore,
  FinancialExpenseCategoriesStore,
  FinancialIncomeCategoriesStore,
  FinancialMovementFilters,
  FinancialMovementsStore,
  HandicapsReferenceStore,
  HandicapChargeFilters,
  HandicapChargesStore,
  MacroDebitSettlementFilters,
  MacroDebitSettlementsStore,
  MemberReferenceFilters,
  MemberFeeChargeFilters,
  MemberFeeChargesStore,
  MembersReferenceStore,
  OvertimeEntriesStore,
  OvertimeEntryFilters,
  PayrollConfigsStore,
  PaymentCommissionRulesStore,
  PaymentMethodsStore,
  SalaryConfigurationsStore,
  SalaryPaymentsFilters,
  SalaryPaymentsStore,
  StoreCreate,
  StorePatch,
  UsersReferenceStore,
  TournamentRegistrationsReferenceStore,
} from '../../domain/ports.js';
import { USERS_COLLECTIONS } from '../../../users/domain/constants.js';
import { TOURNAMENTS_COLLECTIONS } from '../../../tournaments/domain/constants.js';
import type { TournamentRegistrationDocument } from '../../../tournaments/domain/models.js';
import { createAdminConverter } from '../../../users/infrastructure/firestore/converters.js';

function getOrInitializeApp() {
  return getApps().length > 0 ? getApp() : initializeApp();
}

function getDatabase(): Firestore {
  return getFirestore(getOrInitializeApp());
}

function getCollection<T extends DocumentData>(
  db: Firestore,
  path: string,
): CollectionReference<T> {
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

async function getSnapshot<T extends DocumentData>(
  ref: DocumentReference<T>,
  transaction?: Transaction,
) {
  return transaction ? transaction.get(ref) : ref.get();
}

async function getQuerySnapshot<T extends DocumentData>(
  query: Query<T>,
  transaction?: Transaction,
) {
  return transaction ? transaction.get(query) : query.get();
}

async function writeSet<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: DocumentData,
  transaction?: Transaction,
) {
  if (transaction) {
    transaction.set(ref, data as never, { merge: false });
    return;
  }

  await ref.set(data as never);
}

async function writeUpdate<T extends DocumentData>(
  ref: DocumentReference<T>,
  data: DocumentData,
  transaction?: Transaction,
) {
  if (transaction) {
    transaction.update(ref, data as never);
    return;
  }

  await ref.update(data as never);
}

async function createDocument<T extends DocumentData>(
  collection: CollectionReference<T>,
  data: DocumentData,
  transaction?: Transaction,
): Promise<string> {
  const docRef = collection.doc();
  if (transaction) {
    transaction.create(docRef, data as never);
    return docRef.id;
  }

  await docRef.create(data as never);
  return docRef.id;
}

function withId<T extends DocumentData>(snapshot: QueryDocumentSnapshot<T>): EntityWithId<T> {
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
}

abstract class FirestoreCollectionStore<T extends DocumentData> {
  protected constructor(
    protected readonly collection: CollectionReference<T>,
    protected readonly transaction?: Transaction,
  ) {}

  protected async getByIdInternal(id: string): Promise<EntityWithId<T> | null> {
    const snapshot = await getSnapshot(this.collection.doc(id), this.transaction);
    return snapshot.exists ? withId(snapshot as QueryDocumentSnapshot<T>) : null;
  }

  protected async createInternal(
    data: StoreCreate<Omit<T, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return createDocument(this.collection, createAuditedDocument(data as DocumentData, actorUid), this.transaction);
  }

  protected async setInternal(
    id: string,
    data: StoreCreate<Omit<T, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<void> {
    await writeSet(
      this.collection.doc(id),
      createAuditedDocument(data as DocumentData, actorUid),
      this.transaction,
    );
  }

  protected async updateInternal(id: string, patch: StorePatch<T>, actorUid: string): Promise<void> {
    await writeUpdate(this.collection.doc(id), createAuditedPatch(patch, actorUid), this.transaction);
  }

  protected async applyCursor(query: Query<T>, cursorId?: string): Promise<Query<T>> {
    if (!cursorId) {
      return query;
    }

    const cursorSnapshot = await getSnapshot(this.collection.doc(cursorId), this.transaction);
    assertCondition(cursorSnapshot.exists, 'not-found', `No existe cursor ${this.collection.path}/${cursorId}.`);
    return query.startAfter(cursorSnapshot);
  }

  protected async listPageFromQuery(
    query: Query<T>,
    limit?: number,
  ): Promise<CursorPage<EntityWithId<T>>> {
    const normalizedLimit = normalizeLimit(limit);
    const snapshot = await getQuerySnapshot(query.limit(normalizedLimit), this.transaction);
    const items = snapshot.docs.map((doc) => withId(doc));
    const nextCursorId = items.length === normalizedLimit ? items.at(-1)?.id : undefined;
    return {
      items,
      ...(nextCursorId ? { nextCursorId } : {}),
    };
  }

  protected async listFromQuery(query: Query<T>): Promise<Array<EntityWithId<T>>> {
    const snapshot = await getQuerySnapshot(query, this.transaction);
    return snapshot.docs.map((doc) => withId(doc));
  }
}

class FirestoreUsersReferenceStore extends FirestoreCollectionStore<ReferencedUserDocument> implements UsersReferenceStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<ReferencedUserDocument>(db, USERS_COLLECTIONS.users), transaction);
  }

  public getById(uid: string): Promise<EntityWithId<ReferencedUserDocument> | null> {
    return this.getByIdInternal(uid);
  }
}

class FirestoreMembersReferenceStore extends FirestoreCollectionStore<ReferencedMemberDocument> implements MembersReferenceStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<ReferencedMemberDocument>(db, USERS_COLLECTIONS.members), transaction);
  }

  public getById(memberId: string): Promise<EntityWithId<ReferencedMemberDocument> | null> {
    return this.getByIdInternal(memberId);
  }

  public update(memberId: string, patch: StorePatch<ReferencedMemberDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(memberId, patch, actorUid);
  }

  public async listPage(filters: MemberReferenceFilters): Promise<CursorPage<EntityWithId<ReferencedMemberDocument>>> {
    let query: Query<ReferencedMemberDocument> = this.collection;
    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }
    query = query.orderBy(FieldPath.documentId());
    query = await this.applyCursor(query, filters.cursorId);
    return this.listPageFromQuery(query, filters.limit);
  }
}

class FirestoreFamilyGroupsReferenceStore extends FirestoreCollectionStore<ReferencedFamilyGroupDocument> implements FamilyGroupsReferenceStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<ReferencedFamilyGroupDocument>(db, USERS_COLLECTIONS.familyGroups), transaction);
  }

  public getById(groupId: string): Promise<EntityWithId<ReferencedFamilyGroupDocument> | null> {
    return this.getByIdInternal(groupId);
  }
}

class FirestoreEmployeesReferenceStore extends FirestoreCollectionStore<ReferencedEmployeeDocument> implements EmployeesReferenceStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<ReferencedEmployeeDocument>(db, USERS_COLLECTIONS.employees), transaction);
  }

  public getById(employeeId: string): Promise<EntityWithId<ReferencedEmployeeDocument> | null> {
    return this.getByIdInternal(employeeId);
  }
}

class FirestoreHandicapsReferenceStore extends FirestoreCollectionStore<ReferencedHandicapDocument> implements HandicapsReferenceStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<ReferencedHandicapDocument>(db, USERS_COLLECTIONS.handicaps), transaction);
  }

  public getById(handicapId: string): Promise<EntityWithId<ReferencedHandicapDocument> | null> {
    return this.getByIdInternal(handicapId);
  }
}

class FirestoreTournamentRegistrationsReferenceStore extends FirestoreCollectionStore<TournamentRegistrationDocument> implements TournamentRegistrationsReferenceStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<TournamentRegistrationDocument>(db, TOURNAMENTS_COLLECTIONS.registrations), transaction);
  }

  public getById(registrationId: string): Promise<EntityWithId<TournamentRegistrationDocument> | null> {
    return this.getByIdInternal(registrationId);
  }

  public update(registrationId: string, patch: StorePatch<TournamentRegistrationDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(registrationId, patch, actorUid);
  }
}

class FirestoreFinancialConfigsStore extends FirestoreCollectionStore<FinancialConfigDocument> implements FinancialConfigsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<FinancialConfigDocument>(db, ACCOUNTING_COLLECTIONS.financialConfigs), transaction);
  }

  public getById(configId: string): Promise<EntityWithId<FinancialConfigDocument> | null> {
    return this.getByIdInternal(configId);
  }

  public async getActive(): Promise<EntityWithId<FinancialConfigDocument> | null> {
    const snapshot = await getQuerySnapshot(this.collection.where('isActive', '==', true).limit(1), this.transaction);
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public async getLatestVersion(): Promise<EntityWithId<FinancialConfigDocument> | null> {
    const snapshot = await getQuerySnapshot(this.collection.orderBy('version', 'desc').limit(1), this.transaction);
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<FinancialConfigDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(configId: string, patch: StorePatch<FinancialConfigDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(configId, patch, actorUid);
  }
}

class FirestorePaymentMethodsStore extends FirestoreCollectionStore<PaymentMethodDocument> implements PaymentMethodsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<PaymentMethodDocument>(db, ACCOUNTING_COLLECTIONS.paymentMethods), transaction);
  }

  public getById(paymentMethodId: string): Promise<EntityWithId<PaymentMethodDocument> | null> {
    return this.getByIdInternal(paymentMethodId);
  }

  public set(
    paymentMethodId: string,
    data: StoreCreate<Omit<PaymentMethodDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<void> {
    return this.setInternal(paymentMethodId, data, actorUid);
  }
}

class FirestorePaymentCommissionRulesStore extends FirestoreCollectionStore<PaymentCommissionRuleDocument> implements PaymentCommissionRulesStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<PaymentCommissionRuleDocument>(db, ACCOUNTING_COLLECTIONS.paymentCommissionRules), transaction);
  }

  public getById(ruleId: string): Promise<EntityWithId<PaymentCommissionRuleDocument> | null> {
    return this.getByIdInternal(ruleId);
  }

  public async getActiveByPaymentMethodId(paymentMethodId: string): Promise<EntityWithId<PaymentCommissionRuleDocument> | null> {
    const query = this.collection
      .where('paymentMethodId', '==', paymentMethodId)
      .where('isActive', '==', true)
      .orderBy('validFrom', 'desc')
      .limit(1);
    const snapshot = await getQuerySnapshot(query, this.transaction);
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<PaymentCommissionRuleDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(ruleId: string, patch: StorePatch<PaymentCommissionRuleDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(ruleId, patch, actorUid);
  }
}

class FirestoreFinancialIncomeCategoriesStore extends FirestoreCollectionStore<FinancialIncomeCategoryDocument> implements FinancialIncomeCategoriesStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<FinancialIncomeCategoryDocument>(db, ACCOUNTING_COLLECTIONS.financialIncomeCategories), transaction);
  }

  public getById(categoryId: string): Promise<EntityWithId<FinancialIncomeCategoryDocument> | null> {
    return this.getByIdInternal(categoryId);
  }

  public set(
    categoryId: string,
    data: StoreCreate<Omit<FinancialIncomeCategoryDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<void> {
    return this.setInternal(categoryId, data, actorUid);
  }
}

class FirestoreFinancialExpenseCategoriesStore extends FirestoreCollectionStore<FinancialExpenseCategoryDocument> implements FinancialExpenseCategoriesStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<FinancialExpenseCategoryDocument>(db, ACCOUNTING_COLLECTIONS.financialExpenseCategories), transaction);
  }

  public getById(categoryId: string): Promise<EntityWithId<FinancialExpenseCategoryDocument> | null> {
    return this.getByIdInternal(categoryId);
  }

  public set(
    categoryId: string,
    data: StoreCreate<Omit<FinancialExpenseCategoryDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<void> {
    return this.setInternal(categoryId, data, actorUid);
  }
}

class FirestoreFinancialMovementsStore extends FirestoreCollectionStore<FinancialMovementDocument> implements FinancialMovementsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<FinancialMovementDocument>(db, ACCOUNTING_COLLECTIONS.financialMovements), transaction);
  }

  public getById(movementId: string): Promise<EntityWithId<FinancialMovementDocument> | null> {
    return this.getByIdInternal(movementId);
  }

  public create(
    data: StoreCreate<Omit<FinancialMovementDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(movementId: string, patch: StorePatch<FinancialMovementDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(movementId, patch, actorUid);
  }

  public async listPage(filters: FinancialMovementFilters): Promise<CursorPage<EntityWithId<FinancialMovementDocument>>> {
    let query: Query<FinancialMovementDocument> = this.collection;

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
    if (filters.installmentPlanId) {
      query = query.where('installmentPlanId', '==', filters.installmentPlanId);
    }
    if (filters.settlementId) {
      query = query.where('settlementId', '==', filters.settlementId).orderBy('operationDate', 'asc');
    } else {
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

  public async listBySettlementId(settlementId: string): Promise<Array<EntityWithId<FinancialMovementDocument>>> {
    const query = this.collection.where('settlementId', '==', settlementId).orderBy('operationDate', 'asc');
    return this.listFromQuery(query);
  }

  public async listByInstallmentPlanId(installmentPlanId: string): Promise<Array<EntityWithId<FinancialMovementDocument>>> {
    const query = this.collection.where('installmentPlanId', '==', installmentPlanId).orderBy('operationDate', 'asc');
    return this.listFromQuery(query);
  }
}

class FirestoreMacroDebitSettlementsStore extends FirestoreCollectionStore<MacroDebitSettlementDocument> implements MacroDebitSettlementsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<MacroDebitSettlementDocument>(db, ACCOUNTING_COLLECTIONS.macroDebitSettlements), transaction);
  }

  public getById(settlementId: string): Promise<EntityWithId<MacroDebitSettlementDocument> | null> {
    return this.getByIdInternal(settlementId);
  }

  public async getByExternalBatchRef(externalBatchRef: string): Promise<EntityWithId<MacroDebitSettlementDocument> | null> {
    const snapshot = await getQuerySnapshot(this.collection.where('externalBatchRef', '==', externalBatchRef).limit(1), this.transaction);
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<MacroDebitSettlementDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(settlementId: string, patch: StorePatch<MacroDebitSettlementDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(settlementId, patch, actorUid);
  }

  public async listPage(filters: MacroDebitSettlementFilters): Promise<CursorPage<EntityWithId<MacroDebitSettlementDocument>>> {
    let query: Query<MacroDebitSettlementDocument> = this.collection;

    if (filters.month) {
      query = query.where('month', '==', filters.month).orderBy('month', 'desc');
    } else {
      query = query.orderBy('month', 'desc');
    }

    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }

    query = await this.applyCursor(query, filters.cursorId);
    return this.listPageFromQuery(query, filters.limit);
  }
}

class FirestoreSalaryConfigurationsStore extends FirestoreCollectionStore<SalaryConfigurationDocument> implements SalaryConfigurationsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<SalaryConfigurationDocument>(db, ACCOUNTING_COLLECTIONS.salaryConfigurations), transaction);
  }

  public getById(configurationId: string): Promise<EntityWithId<SalaryConfigurationDocument> | null> {
    return this.getByIdInternal(configurationId);
  }

  public async getActiveByEmployeeId(employeeId: string): Promise<EntityWithId<SalaryConfigurationDocument> | null> {
    const query = this.collection
      .where('employeeId', '==', employeeId)
      .where('isActive', '==', true)
      .orderBy('effectiveFrom', 'desc')
      .limit(1);
    const snapshot = await getQuerySnapshot(query, this.transaction);
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<SalaryConfigurationDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(configurationId: string, patch: StorePatch<SalaryConfigurationDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(configurationId, patch, actorUid);
  }
}

class FirestoreSalaryPaymentsStore extends FirestoreCollectionStore<SalaryPaymentDocument> implements SalaryPaymentsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<SalaryPaymentDocument>(db, ACCOUNTING_COLLECTIONS.salaryPayments), transaction);
  }

  public getById(paymentId: string): Promise<EntityWithId<SalaryPaymentDocument> | null> {
    return this.getByIdInternal(paymentId);
  }

  public async findByEmployeeAndPeriod(employeeId: string, period: string): Promise<EntityWithId<SalaryPaymentDocument> | null> {
    const snapshot = await getQuerySnapshot(
      this.collection
        .where('employeeId', '==', employeeId)
        .where('period', '==', period)
        .limit(1),
      this.transaction,
    );
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<SalaryPaymentDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(paymentId: string, patch: StorePatch<SalaryPaymentDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(paymentId, patch, actorUid);
  }

  public async listPage(filters: SalaryPaymentsFilters): Promise<CursorPage<EntityWithId<SalaryPaymentDocument>>> {
    let query: Query<SalaryPaymentDocument> = this.collection;

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

class FirestorePayrollConfigsStore extends FirestoreCollectionStore<PayrollConfigDocument> implements PayrollConfigsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<PayrollConfigDocument>(db, ACCOUNTING_COLLECTIONS.payrollConfigs), transaction);
  }

  public getCurrent(): Promise<EntityWithId<PayrollConfigDocument> | null> {
    return this.getByIdInternal('current');
  }

  public setCurrent(
    data: StoreCreate<Omit<PayrollConfigDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<void> {
    return this.setInternal('current', data, actorUid);
  }
}

class FirestoreOvertimeEntriesStore extends FirestoreCollectionStore<OvertimeEntryDocument> implements OvertimeEntriesStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<OvertimeEntryDocument>(db, ACCOUNTING_COLLECTIONS.overtimeEntries), transaction);
  }

  public getById(overtimeEntryId: string): Promise<EntityWithId<OvertimeEntryDocument> | null> {
    return this.getByIdInternal(overtimeEntryId);
  }

  public create(
    data: StoreCreate<Omit<OvertimeEntryDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(overtimeEntryId: string, patch: StorePatch<OvertimeEntryDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(overtimeEntryId, patch, actorUid);
  }

  public async listApprovedByEmployeeAndPeriod(employeeId: string, period: string): Promise<Array<EntityWithId<OvertimeEntryDocument>>> {
    return this.listFromQuery(
      this.collection
        .where('employeeId', '==', employeeId)
        .where('period', '==', period)
        .where('status', '==', 'approved')
        .orderBy('workDate', 'asc'),
    );
  }

  public async listPage(filters: OvertimeEntryFilters): Promise<CursorPage<EntityWithId<OvertimeEntryDocument>>> {
    let query: Query<OvertimeEntryDocument> = this.collection;
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

class FirestoreEmployeePayrollCyclesStore extends FirestoreCollectionStore<EmployeePayrollCycleDocument> implements EmployeePayrollCyclesStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<EmployeePayrollCycleDocument>(db, ACCOUNTING_COLLECTIONS.employeePayrollCycles), transaction);
  }

  public getById(cycleId: string): Promise<EntityWithId<EmployeePayrollCycleDocument> | null> {
    return this.getByIdInternal(cycleId);
  }

  public async findByEmployeeAndPeriod(employeeId: string, period: string): Promise<EntityWithId<EmployeePayrollCycleDocument> | null> {
    const snapshot = await getQuerySnapshot(
      this.collection.where('employeeId', '==', employeeId).where('period', '==', period).limit(1),
      this.transaction,
    );
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<EmployeePayrollCycleDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(cycleId: string, patch: StorePatch<EmployeePayrollCycleDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(cycleId, patch, actorUid);
  }

  public async listPage(filters: EmployeePayrollCycleFilters): Promise<CursorPage<EntityWithId<EmployeePayrollCycleDocument>>> {
    let query: Query<EmployeePayrollCycleDocument> = this.collection;
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

class FirestoreEmployeeAccountingLinksStore extends FirestoreCollectionStore<EmployeeAccountingLinkDocument> implements EmployeeAccountingLinksStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<EmployeeAccountingLinkDocument>(db, ACCOUNTING_COLLECTIONS.employeeAccountingLinks), transaction);
  }

  public getById(linkId: string): Promise<EntityWithId<EmployeeAccountingLinkDocument> | null> {
    return this.getByIdInternal(linkId);
  }

  public async findDuplicate(params: {
    employeeId: string;
    period: string;
    referenceId: string;
  }): Promise<EntityWithId<EmployeeAccountingLinkDocument> | null> {
    const snapshot = await getQuerySnapshot(
      this.collection
        .where('employeeId', '==', params.employeeId)
        .where('period', '==', params.period)
        .where('referenceId', '==', params.referenceId)
        .limit(1),
      this.transaction,
    );
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public async findByEmployeePeriodAndReferenceType(params: {
    employeeId: string;
    period: string;
    referenceType: EmployeeAccountingLinkDocument['referenceType'];
  }): Promise<EntityWithId<EmployeeAccountingLinkDocument> | null> {
    const snapshot = await getQuerySnapshot(
      this.collection
        .where('employeeId', '==', params.employeeId)
        .where('period', '==', params.period)
        .where('referenceType', '==', params.referenceType)
        .limit(1),
      this.transaction,
    );
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<EmployeeAccountingLinkDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(linkId: string, patch: StorePatch<EmployeeAccountingLinkDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(linkId, patch, actorUid);
  }

  public async listPage(filters: EmployeeAccountingLinkFilters): Promise<CursorPage<EntityWithId<EmployeeAccountingLinkDocument>>> {
    let query: Query<EmployeeAccountingLinkDocument> = this.collection;
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

class FirestoreEmployeeCertificatesStore extends FirestoreCollectionStore<EmployeeCertificateDocument> implements EmployeeCertificatesStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<EmployeeCertificateDocument>(db, ACCOUNTING_COLLECTIONS.employeeCertificates), transaction);
  }

  public getById(certificateId: string): Promise<EntityWithId<EmployeeCertificateDocument> | null> {
    return this.getByIdInternal(certificateId);
  }

  public create(
    data: StoreCreate<Omit<EmployeeCertificateDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(certificateId: string, patch: StorePatch<EmployeeCertificateDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(certificateId, patch, actorUid);
  }

  public async listPage(filters: EmployeeCertificateFilters): Promise<CursorPage<EntityWithId<EmployeeCertificateDocument>>> {
    let query: Query<EmployeeCertificateDocument> = this.collection;
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

class FirestoreCashClosuresStore extends FirestoreCollectionStore<CashClosureDocument> implements CashClosuresStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<CashClosureDocument>(db, ACCOUNTING_COLLECTIONS.cashClosures), transaction);
  }

  public getById(cashClosureId: string): Promise<EntityWithId<CashClosureDocument> | null> {
    return this.getByIdInternal(cashClosureId);
  }

  public create(
    data: StoreCreate<Omit<CashClosureDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(cashClosureId: string, patch: StorePatch<CashClosureDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(cashClosureId, patch, actorUid);
  }

  public async listPage(filters: CashClosureFilters): Promise<CursorPage<EntityWithId<CashClosureDocument>>> {
    let query: Query<CashClosureDocument> = this.collection;
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

  public listOpen(): Promise<Array<EntityWithId<CashClosureDocument>>> {
    return this.listFromQuery(this.collection.where('status', '==', 'open'));
  }

}

class FirestoreExternalAccountingReferencesStore extends FirestoreCollectionStore<ExternalAccountingReferenceDocument> implements ExternalAccountingReferencesStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<ExternalAccountingReferenceDocument>(db, ACCOUNTING_COLLECTIONS.externalAccountingReferences), transaction);
  }

  public getById(referenceId: string): Promise<EntityWithId<ExternalAccountingReferenceDocument> | null> {
    return this.getByIdInternal(referenceId);
  }

  public async findByEmployeePeriodAndReferenceType(params: {
    employeeId: string;
    period: string;
    referenceType: ExternalAccountingReferenceDocument['referenceType'];
  }): Promise<EntityWithId<ExternalAccountingReferenceDocument> | null> {
    const snapshot = await getQuerySnapshot(
      this.collection
        .where('employeeId', '==', params.employeeId)
        .where('period', '==', params.period)
        .where('referenceType', '==', params.referenceType)
        .limit(1),
      this.transaction,
    );
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<ExternalAccountingReferenceDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(referenceId: string, patch: StorePatch<ExternalAccountingReferenceDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(referenceId, patch, actorUid);
  }
}

class FirestoreExpenseSubmissionsStore extends FirestoreCollectionStore<ExpenseSubmissionDocument> implements ExpenseSubmissionsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<ExpenseSubmissionDocument>(db, ACCOUNTING_COLLECTIONS.expenseSubmissions), transaction);
  }

  public getById(expenseSubmissionId: string): Promise<EntityWithId<ExpenseSubmissionDocument> | null> {
    return this.getByIdInternal(expenseSubmissionId);
  }

  public create(
    data: StoreCreate<Omit<ExpenseSubmissionDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(expenseSubmissionId: string, patch: StorePatch<ExpenseSubmissionDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(expenseSubmissionId, patch, actorUid);
  }

  public async listPage(filters: import('../../domain/ports.js').ExpenseSubmissionFilters): Promise<CursorPage<EntityWithId<ExpenseSubmissionDocument>>> {
    let query: Query<ExpenseSubmissionDocument> = this.collection;
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

class FirestoreConcessionContractsStore extends FirestoreCollectionStore<ConcessionContractDocument> implements ConcessionContractsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<ConcessionContractDocument>(db, ACCOUNTING_COLLECTIONS.concessionContracts), transaction);
  }

  public getById(contractId: string): Promise<EntityWithId<ConcessionContractDocument> | null> {
    return this.getByIdInternal(contractId);
  }

  public create(
    data: StoreCreate<Omit<ConcessionContractDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(contractId: string, patch: StorePatch<ConcessionContractDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(contractId, patch, actorUid);
  }
}

class FirestoreAdvertisingContractsStore extends FirestoreCollectionStore<AdvertisingContractDocument> implements AdvertisingContractsStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<AdvertisingContractDocument>(db, ACCOUNTING_COLLECTIONS.advertisingContracts), transaction);
  }

  public getById(contractId: string): Promise<EntityWithId<AdvertisingContractDocument> | null> {
    return this.getByIdInternal(contractId);
  }

  public create(
    data: StoreCreate<Omit<AdvertisingContractDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(contractId: string, patch: StorePatch<AdvertisingContractDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(contractId, patch, actorUid);
  }
}

class FirestoreHandicapChargesStore extends FirestoreCollectionStore<HandicapChargeDocument> implements HandicapChargesStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<HandicapChargeDocument>(db, ACCOUNTING_COLLECTIONS.handicapCharges), transaction);
  }

  public getById(handicapChargeId: string): Promise<EntityWithId<HandicapChargeDocument> | null> {
    return this.getByIdInternal(handicapChargeId);
  }

  public async findByMemberAndPeriod(memberId: string, period: string): Promise<EntityWithId<HandicapChargeDocument> | null> {
    const snapshot = await getQuerySnapshot(
      this.collection.where('memberId', '==', memberId).where('period', '==', period).limit(1),
      this.transaction,
    );
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<HandicapChargeDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(handicapChargeId: string, patch: StorePatch<HandicapChargeDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(handicapChargeId, patch, actorUid);
  }

  public async listPage(filters: HandicapChargeFilters): Promise<CursorPage<EntityWithId<HandicapChargeDocument>>> {
    let query: Query<HandicapChargeDocument> = this.collection;
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

class FirestoreMemberFeeChargesStore extends FirestoreCollectionStore<MemberFeeChargeDocument> implements MemberFeeChargesStore {
  public constructor(db: Firestore, transaction?: Transaction) {
    super(getCollection<MemberFeeChargeDocument>(db, ACCOUNTING_COLLECTIONS.memberFeeCharges), transaction);
  }

  public getById(memberFeeChargeId: string): Promise<EntityWithId<MemberFeeChargeDocument> | null> {
    return this.getByIdInternal(memberFeeChargeId);
  }

  public async findDuplicate(params: {
    memberId?: string | null;
    familyGroupId?: string | null;
    period: string;
    billingMode: MemberFeeChargeDocument['billingMode'];
  }): Promise<EntityWithId<MemberFeeChargeDocument> | null> {
    let query: Query<MemberFeeChargeDocument> = this.collection
      .where('period', '==', params.period)
      .where('billingMode', '==', params.billingMode);

    if (params.billingMode === 'single_group_charge') {
      query = query.where('familyGroupId', '==', params.familyGroupId ?? null);
    } else {
      query = query.where('memberId', '==', params.memberId ?? null);
    }

    const snapshot = await getQuerySnapshot(query.limit(1), this.transaction);
    return snapshot.docs[0] ? withId(snapshot.docs[0]) : null;
  }

  public create(
    data: StoreCreate<Omit<MemberFeeChargeDocument, keyof import('../../domain/models.js').AuditFields>>,
    actorUid: string,
  ): Promise<string> {
    return this.createInternal(data, actorUid);
  }

  public update(memberFeeChargeId: string, patch: StorePatch<MemberFeeChargeDocument>, actorUid: string): Promise<void> {
    return this.updateInternal(memberFeeChargeId, patch, actorUid);
  }

  public async listPage(filters: MemberFeeChargeFilters): Promise<CursorPage<EntityWithId<MemberFeeChargeDocument>>> {
    let query: Query<MemberFeeChargeDocument> = this.collection;
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

export function createFirestoreAccountingDataAccess(
  db: Firestore,
  clock: Clock,
  transaction?: Transaction,
): AccountingDataAccess {
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
  };
}

export class FirestoreAccountingTransactionManager implements AccountingTransactionManager {
  private readonly db = getDatabase();

  public constructor(private readonly clock: Clock) {}

  public async runInTransaction<T>(handler: (dataAccess: AccountingDataAccess) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => handler(createFirestoreAccountingDataAccess(this.db, this.clock, transaction)));
  }

  public getDataAccess(): AccountingDataAccess {
    return createFirestoreAccountingDataAccess(this.db, this.clock);
  }
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
