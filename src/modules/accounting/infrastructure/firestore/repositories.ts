import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { firestore } from '../../../../lib/firebase';
import {
  ACCOUNTING_COLLECTIONS,
  ACCOUNTING_PAYMENT_METHOD_IDS,
} from '../../domain/constants';
import type {
  EntityWithId,
  ExpenseSubmissionDocument,
  ExternalAccountingReferenceDocument,
  FinancialConfigDocument,
  FinancialMovementDocument,
  HandicapChargeDocument,
  MacroDebitSettlementDocument,
  MemberFeeChargeDocument,
  PaymentMethodDocument,
  SalaryPaymentDocument,
} from '../../domain/models';
import { createWebConverter } from '../../../users/infrastructure/firestore/converters';

function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error('Firestore is not initialized in this environment.');
  }

  return firestore;
}

function createRepository<T extends DocumentData>(db: Firestore, path: string) {
  const collectionRef = collection(db, path).withConverter(createWebConverter<T>());

  return {
    collectionRef,
    docRef: (id: string) => doc(collectionRef, id),
    async getById(id: string): Promise<EntityWithId<T> | null> {
      const snapshot = await getDoc(doc(collectionRef, id));
      return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as EntityWithId<T>) : null;
    },
    async listByQuery(queryRef: Query<T>): Promise<Array<EntityWithId<T>>> {
      const snapshot = await getDocs(queryRef);
      return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as EntityWithId<T>);
    },
    async countByQuery(queryRef: Query<T>): Promise<number> {
      return (await getCountFromServer(queryRef)).data().count;
    },
  };
}

function sortByTimestampDesc<T extends { id: string }>(
  items: T[],
  getTimestampValue: (item: T) => Date | null,
): T[] {
  return [...items].sort((left, right) => {
    const leftTime = getTimestampValue(left)?.getTime() ?? 0;
    const rightTime = getTimestampValue(right)?.getTime() ?? 0;
    return rightTime - leftTime;
  });
}

function sortByPeriodDesc<T extends { period: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.period.localeCompare(left.period));
}

export function createFinancialConfigsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<FinancialConfigDocument>(db, ACCOUNTING_COLLECTIONS.financialConfigs);

  return {
    ...repository,
    async getActive() {
      const items = await repository.listByQuery(
        query(repository.collectionRef, where('isActive', '==', true), limit(1)),
      );
      return items[0] ?? null;
    },
  };
}

export function createPaymentMethodsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<PaymentMethodDocument>(db, ACCOUNTING_COLLECTIONS.paymentMethods);

  return {
    ...repository,
    listActiveSorted() {
      return repository.listByQuery(
        query(repository.collectionRef, where('active', '==', true), orderBy('sortOrder', 'asc')),
      );
    },
  };
}

export function createFinancialMovementsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<FinancialMovementDocument>(db, ACCOUNTING_COLLECTIONS.financialMovements);

  return {
    ...repository,
    listRecent(pageSize = 12) {
      return repository.listByQuery(
        query(repository.collectionRef, orderBy('operationDate', 'desc'), limit(pageSize)),
      );
    },
    async listByAccountingPeriod(period: string) {
      const items = await repository.listByQuery(
        query(repository.collectionRef, where('accountingPeriod', '==', period)),
      );
      return sortByTimestampDesc(items, (item) => item.operationDate?.toDate() ?? null);
    },
    listRecentBanked(pageSize = 12) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('bancarizado', '==', true),
          orderBy('operationDate', 'desc'),
          limit(pageSize),
        ),
      );
    },
    listRecentByPaymentMethod(paymentMethodCodeSnapshot: string, pageSize = 12) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('paymentMethodCodeSnapshot', '==', paymentMethodCodeSnapshot),
          orderBy('operationDate', 'desc'),
          limit(pageSize),
        ),
      );
    },
    listRecentDebitMacro(pageSize = 12) {
      return repository.listByQuery(
        query(
          repository.collectionRef,
          where('paymentMethodCodeSnapshot', '==', ACCOUNTING_PAYMENT_METHOD_IDS.debitMacro),
          orderBy('operationDate', 'desc'),
          limit(pageSize),
        ),
      );
    },
  };
}

export function createMacroDebitSettlementsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<MacroDebitSettlementDocument>(db, ACCOUNTING_COLLECTIONS.macroDebitSettlements);

  return {
    ...repository,
    listRecent(pageSize = 8) {
      return repository.listByQuery(
        query(repository.collectionRef, orderBy('month', 'desc'), limit(pageSize)),
      );
    },
    async listByMonth(month: string) {
      const items = await repository.listByQuery(
        query(repository.collectionRef, where('month', '==', month)),
      );
      return [...items].sort((left, right) => left.externalBatchRef.localeCompare(right.externalBatchRef));
    },
  };
}

export function createExpenseSubmissionsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<ExpenseSubmissionDocument>(db, ACCOUNTING_COLLECTIONS.expenseSubmissions);

  return {
    ...repository,
    listRecent(pageSize = 12) {
      return repository.listByQuery(
        query(repository.collectionRef, orderBy('expenseDate', 'desc'), limit(pageSize)),
      );
    },
    countByStatus(status: ExpenseSubmissionDocument['status']) {
      return repository.countByQuery(
        query(repository.collectionRef, where('status', '==', status)),
      );
    },
  };
}

export function createSalaryPaymentsRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<SalaryPaymentDocument>(db, ACCOUNTING_COLLECTIONS.salaryPayments);

  return {
    ...repository,
    async listByPeriod(period: string) {
      const items = await repository.listByQuery(
        query(repository.collectionRef, where('period', '==', period)),
      );
      return sortByPeriodDesc(items);
    },
    listRecent(pageSize = 8) {
      return repository.listByQuery(
        query(repository.collectionRef, orderBy('period', 'desc'), limit(pageSize)),
      );
    },
  };
}

export function createExternalAccountingReferencesRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<ExternalAccountingReferenceDocument>(
    db,
    ACCOUNTING_COLLECTIONS.externalAccountingReferences,
  );

  return {
    ...repository,
    async listByPeriod(period: string) {
      const items = await repository.listByQuery(
        query(repository.collectionRef, where('period', '==', period)),
      );
      return sortByPeriodDesc(items);
    },
    listRecent(pageSize = 8) {
      return repository.listByQuery(
        query(repository.collectionRef, orderBy('updatedAt', 'desc'), limit(pageSize)),
      );
    },
  };
}

export function createHandicapChargesRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<HandicapChargeDocument>(db, ACCOUNTING_COLLECTIONS.handicapCharges);

  return {
    ...repository,
    async listByPeriod(period: string) {
      const items = await repository.listByQuery(
        query(repository.collectionRef, where('period', '==', period)),
      );
      return sortByPeriodDesc(items);
    },
  };
}

export function createMemberFeeChargesRepository(db: Firestore = requireFirestore()) {
  const repository = createRepository<MemberFeeChargeDocument>(db, ACCOUNTING_COLLECTIONS.memberFeeCharges);

  return {
    ...repository,
    async listByPeriod(period: string) {
      const items = await repository.listByQuery(
        query(repository.collectionRef, where('period', '==', period)),
      );
      return sortByPeriodDesc(items);
    },
    countPendingByPeriod(period: string) {
      return repository.countByQuery(
        query(
          repository.collectionRef,
          where('period', '==', period),
          where('status', '==', 'pending'),
        ),
      );
    },
  };
}
