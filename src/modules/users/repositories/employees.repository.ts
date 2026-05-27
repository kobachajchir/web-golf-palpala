import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';
import { firestore } from '../../../lib/firebase';
import type { EmployeeDocument, EntityWithId } from '../domain/models';
import { createWebConverter } from '../infrastructure/firestore/converters';
import type { ListEmployeesParams, ListEmployeesResult } from '../types/employee.types';

function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error('Firestore is not initialized in this environment.');
  }

  return firestore;
}

function withId<T extends DocumentData>(snapshot: { id: string; data(): T }): EntityWithId<T> {
  return { id: snapshot.id, ...snapshot.data() } as EntityWithId<T>;
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesEmployeeSearch(employee: EntityWithId<EmployeeDocument>, search: string): boolean {
  const normalizedSearch = normalizeSearch(search);
  if (!normalizedSearch) {
    return true;
  }

  const haystack = [
    employee.employeeCode,
    employee.firstName,
    employee.lastName,
    employee.dni,
    employee.position,
    employee.contractType,
    employee.status,
    employee.id,
  ]
    .filter(Boolean)
    .map((value) => normalizeSearch(String(value)))
    .join(' ');

  return haystack.includes(normalizedSearch);
}

function matchesClientFilters(employee: EntityWithId<EmployeeDocument>, params: ListEmployeesParams): boolean {
  if (params.status && params.status !== 'all' && employee.status !== params.status) {
    return false;
  }

  if (params.contractType && params.contractType !== 'all' && employee.contractType !== params.contractType) {
    return false;
  }

  if (params.expenseAccess === 'enabled' && !employee.canSubmitExpenses) {
    return false;
  }

  if (params.expenseAccess === 'disabled' && employee.canSubmitExpenses) {
    return false;
  }

  return matchesEmployeeSearch(employee, params.search ?? '');
}

export function createEmployeesRepository(db: Firestore = requireFirestore()) {
  const employeesRef = collection(db, 'employees').withConverter(createWebConverter<EmployeeDocument>());

  return {
    async listEmployees(params: ListEmployeesParams = {}): Promise<ListEmployeesResult> {
      const pageSize = Math.max(1, Math.min(params.pageSize ?? 25, 100));
      const needsClientFiltering = Boolean(params.search?.trim()) ||
        (params.status ?? 'all') !== 'all' ||
        (params.contractType ?? 'all') !== 'all' ||
        (params.expenseAccess ?? 'all') !== 'all';
      const fetchSize = needsClientFiltering ? Math.min(pageSize * 4, 100) : pageSize;
      const baseConstraints: QueryConstraint[] = [orderBy('lastName', 'asc')];
      const acceptedEmployees: Array<EntityWithId<EmployeeDocument>> = [];
      let nextCursor = params.cursor ?? null;
      let hasMore = false;
      let currentCursor = params.cursor ?? null;

      for (let attempts = 0; attempts < 5 && acceptedEmployees.length < pageSize; attempts += 1) {
        const pageConstraints = [...baseConstraints];
        if (currentCursor) {
          pageConstraints.push(startAfter(currentCursor));
        }
        pageConstraints.push(limit(fetchSize));

        const snapshot = await getDocs(query(employeesRef, ...pageConstraints));
        const docs = snapshot.docs;

        if (docs.length === 0) {
          nextCursor = null;
          hasMore = false;
          break;
        }

        currentCursor = docs[docs.length - 1] ?? null;
        nextCursor = currentCursor;

        for (const entry of docs) {
          const employee = withId(entry);
          if (matchesClientFilters(employee, params)) {
            acceptedEmployees.push(employee);
          }

          if (acceptedEmployees.length >= pageSize) {
            break;
          }
        }

        hasMore = docs.length === fetchSize;
        if (!hasMore) {
          break;
        }
      }

      return {
        employees: acceptedEmployees
          .slice(0, pageSize)
          .sort((left, right) => {
            const lastNameOrder = left.lastName.localeCompare(right.lastName, 'es-AR');
            return lastNameOrder || left.firstName.localeCompare(right.firstName, 'es-AR');
          }),
        nextCursor,
        hasMore,
      };
    },

    async getEmployee(employeeId: string): Promise<EntityWithId<EmployeeDocument> | null> {
      const snapshot = await getDoc(doc(employeesRef, employeeId));
      return snapshot.exists() ? withId(snapshot) : null;
    },

    async countAll(): Promise<number> {
      return (await getCountFromServer(employeesRef)).data().count;
    },

    async countActive(): Promise<number> {
      return (await getCountFromServer(query(employeesRef, where('status', '==', 'active')))).data().count;
    },

    async countExpenseEnabled(): Promise<number> {
      return (await getCountFromServer(query(employeesRef, where('canSubmitExpenses', '==', true)))).data().count;
    },
  };
}

export type EmployeesRepository = ReturnType<typeof createEmployeesRepository>;
