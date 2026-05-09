import type { QueryDocumentSnapshot } from 'firebase/firestore';
import type { EmployeeDocument, EmployeeContractType, EmployeeStatus, EntityWithId } from '../domain/models';

export type EmployeeListCursor = QueryDocumentSnapshot<EmployeeDocument> | null;
export type EmployeeStatusFilter = EmployeeStatus | 'all';
export type EmployeeContractFilter = EmployeeContractType | 'all';
export type EmployeeExpenseFilter = 'all' | 'enabled' | 'disabled';

export interface ListEmployeesParams {
  search?: string;
  status?: EmployeeStatusFilter;
  contractType?: EmployeeContractFilter;
  expenseAccess?: EmployeeExpenseFilter;
  cursor?: EmployeeListCursor;
  pageSize?: number;
}

export interface ListEmployeesResult {
  employees: Array<EntityWithId<EmployeeDocument>>;
  nextCursor: EmployeeListCursor;
  hasMore: boolean;
}
