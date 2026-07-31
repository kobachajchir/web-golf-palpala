import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchFiltersPanel } from '../../../components/SearchFiltersPanel';
import type { EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import type { EntityWithId as UserEntityWithId, UserDocument } from '../../../modules/users/domain/models';
import { createUsersRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import { getUserDisplayName } from '../../../utils/user';
import { AccountingEmptyState } from './AccountingEmptyState';
import type { PaymentMethod } from '../types/payment';
import type { ExpenseCategoryOption, IncomeCategoryOption } from '../utils/accountingCategories';
import { getCategoryLabel } from '../utils/accountingCategories';
import { getMovementBalanceRowClassName, isMovementExcludedFromBalance } from '../utils/balanceInclusion';
import {
  formatCurrency,
  formatTimestamp,
  getSignedMovementAmount,
  timestampToDate,
} from '../utils/accountingFormatters';
import {
  getMovementStatusLabel,
  getPaymentMethodDisplayName,
} from '../utils/paymentMethods';
import { AccountingMovementActions } from './AccountingMovementActions';
import { InstallmentProgress } from './InstallmentProgress';

const MOVEMENTS_PAGE_SIZE = 5;

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function getMovementDateKey(movement: EntityWithId<FinancialMovementDocument>) {
  const date = timestampToDate(movement.operationDate);
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isFlexiblePartialPaymentMovement(movement: EntityWithId<FinancialMovementDocument>) {
  return movement.metadata?.partialPaymentMode === 'flexible';
}

function canRegisterFlexiblePartialPayment(movement: EntityWithId<FinancialMovementDocument>) {
  if (!isFlexiblePartialPaymentMovement(movement) || movement.installmentRole !== 'charge') return false;
  if (movement.status === 'voided' || movement.status === 'reversed') return false;
  const totalAmountMinor = movement.installmentTotalAmountMinor ?? movement.netAmountMinor;
  const paidAmountMinor = movement.installmentPaidAmountMinor ?? 0;
  return totalAmountMinor - paidAmountMinor > 0;
}

function getMovementListAmountMinor(movement: EntityWithId<FinancialMovementDocument>) {
  const amountMinor = movement.originType === 'member_fee_payment'
    ? movement.grossAmountMinor
    : movement.netAmountMinor;
  return movement.movementType === 'income' ? amountMinor : -amountMinor;
}
function getPeriodDateRange(period: string | null | undefined) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return { dateFrom: '', dateTo: '' };
  }
  const [yearText, monthText] = period.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return { dateFrom: '', dateTo: '' };
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    dateFrom: `${period}-01`,
    dateTo: `${period}-${String(lastDay).padStart(2, '0')}`,
  };
}

function getMovementUserLabel(
  uid: string | null | undefined,
  usersById: Record<string, UserEntityWithId<UserDocument>>,
) {
  if (!uid) {
    return 'Sin usuario';
  }

  const user = usersById[uid];
  if (!user) {
    return 'Usuario no identificado';
  }

  const displayName = getUserDisplayName(user);
  return user.memberNumber ? `${displayName} (${user.memberNumber})` : displayName;
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M10.5 4a6.5 6.5 0 0 1 5.15 10.47l4.44 4.44a1 1 0 0 1-1.42 1.42l-4.44-4.44A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.17l3.9-3.88a1 1 0 1 1 1.4 1.42l-4.6 4.58a1 1 0 0 1-1.4 0L6.7 10.7a1 1 0 0 1 0-1.42Z" />
    </svg>
  );
}

function MovementSummary({ movements }: { movements: Array<EntityWithId<FinancialMovementDocument>> }) {
  const posted = movements.filter((movement) => movement.status !== 'voided');
  const resultMovements = posted.filter((movement) => (
    movement.originType !== 'internal_transfer'
    && !isMovementExcludedFromBalance(movement)
  ));
  const incomeMinor = resultMovements
    .filter((movement) => movement.movementType === 'income')
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
  const expenseMinor = resultMovements
    .filter((movement) => movement.movementType === 'expense')
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
  const netMinor = resultMovements.reduce((total, movement) => total + getSignedMovementAmount(movement), 0);

  return (
    <section className="summary-grid accounting-summary-grid">
      <article className="summary-card"><span>Ingresos</span><strong>{formatCurrency(incomeMinor)}</strong><small>Sin transferencias internas</small></article>
      <article className="summary-card"><span>Egresos</span><strong>{formatCurrency(expenseMinor)}</strong><small>Sin transferencias internas</small></article>
      <article className="summary-card"><span>Neto</span><strong>{formatCurrency(netMinor)}</strong><small>Resultado</small></article>
      <article className="summary-card"><span>Movimientos</span><strong>{resultMovements.length}</strong><small>Contados en balance</small></article>
    </section>
  );
}

export function AccountingMovementsPanel({
  movements,
  incomeCategories,
  expenseCategories,
  paymentMethods,
  loading = false,
  title = 'Ingresos y egresos del periodo',
  period,
  onSelectMovement,
  onRegisterPartialPayment,
  onMovementChanged,
}: {
  movements: Array<EntityWithId<FinancialMovementDocument>>;
  incomeCategories: IncomeCategoryOption[];
  expenseCategories: ExpenseCategoryOption[];
  paymentMethods: PaymentMethod[];
  loading?: boolean;
  title?: string;
  period?: string | undefined;
  onSelectMovement?: (movement: EntityWithId<FinancialMovementDocument>) => void;
  onRegisterPartialPayment?: (movement: EntityWithId<FinancialMovementDocument>) => void;
  onMovementChanged?: () => void | Promise<void>;
}) {
  const initialDateRange = getPeriodDateRange(period);
  const filtersPanelRef = useRef<HTMLDivElement | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [visibleMovementCount, setVisibleMovementCount] = useState(MOVEMENTS_PAGE_SIZE);
  const [filters, setFilters] = useState({
    categoryId: 'all',
    status: 'all',
    planMode: 'all',
    paymentMethodId: 'all',
    search: '',
    dateFrom: initialDateRange.dateFrom,
    dateTo: initialDateRange.dateTo,
  });
  const movementUserIds = useMemo(
    () => Array.from(new Set(movements.map((movement) => movement.createdBy).filter((uid): uid is string => Boolean(uid)))).sort(),
    [movements],
  );
  const [usersById, setUsersById] = useState<Record<string, UserEntityWithId<UserDocument>>>({});

  useEffect(() => {
    const nextRange = getPeriodDateRange(period);
    setFilters((current) => ({
      ...current,
      dateFrom: nextRange.dateFrom,
      dateTo: nextRange.dateTo,
    }));
  }, [period]);
  useEffect(() => {
    let cancelled = false;

    if (movementUserIds.length === 0) {
      setUsersById({});
      return () => {
        cancelled = true;
      };
    }

    let usersRepository: ReturnType<typeof createUsersRepository>;
    try {
      usersRepository = createUsersRepository();
    } catch {
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      movementUserIds.map(async (uid) => {
        try {
          const user = await usersRepository.getById(uid);
          return user ? [uid, user] as const : null;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      setUsersById(Object.fromEntries(entries.filter((entry): entry is readonly [string, UserEntityWithId<UserDocument>] => Boolean(entry))));
    });

    return () => {
      cancelled = true;
    };
  }, [movementUserIds]);
  useEffect(() => {
    if (!isFiltersOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!filtersPanelRef.current?.contains(event.target as Node)) {
        setIsFiltersOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isFiltersOpen]);

  const allCategories = useMemo(
    () => [...incomeCategories, ...expenseCategories],
    [expenseCategories, incomeCategories],
  );
  const filteredMovements = useMemo(
    () => movements.filter((movement) => {
      const movementDateKey = getMovementDateKey(movement);
      if (filters.categoryId !== 'all' && movement.categoryId !== filters.categoryId) {
        return false;
      }
      if (filters.status !== 'all' && movement.status !== filters.status) {
        return false;
      }
      if (filters.planMode === 'partial_payments' && !isFlexiblePartialPaymentMovement(movement)) {
        return false;
      }
      if (filters.paymentMethodId !== 'all' && movement.paymentMethodId !== filters.paymentMethodId) {
        return false;
      }
      if (filters.dateFrom && (!movementDateKey || movementDateKey < filters.dateFrom)) {
        return false;
      }
      if (filters.dateTo && (!movementDateKey || movementDateKey > filters.dateTo)) {
        return false;
      }
      if (filters.search.trim()) {
        const query = normalizeSearchText(filters.search);
        const searchable = normalizeSearchText([
          getCategoryLabel(movement.categoryId),
          movement.paymentMethodCodeSnapshot,
          movement.originType,
          movement.thirdPartyId,
          getMovementUserLabel(movement.createdBy, usersById),
          movement.notes,
        ].filter(Boolean).join(' '));
        if (!searchable.includes(query)) {
          return false;
        }
      }
      return true;
    }),
    [filters, movements, usersById],
  );
  const visibleMovements = useMemo(
    () => filteredMovements.slice(0, visibleMovementCount),
    [filteredMovements, visibleMovementCount],
  );
  useEffect(() => {
    setVisibleMovementCount(MOVEMENTS_PAGE_SIZE);
  }, [filteredMovements]);
  const hasActions = Boolean(onSelectMovement || onRegisterPartialPayment);
  const activeFilterCount = [
    filters.search.trim().length > 0,
    filters.categoryId !== 'all',
    filters.status !== 'all',
    filters.planMode !== 'all',
    filters.paymentMethodId !== 'all',
    Boolean(filters.dateFrom && filters.dateFrom !== initialDateRange.dateFrom),
    Boolean(filters.dateTo && filters.dateTo !== initialDateRange.dateTo),
  ].filter(Boolean).length;

  return (
    <div className="accounting-movements-panel">
      <MovementSummary movements={filteredMovements} />
      <section className="floating-card accounting-panel accounting-centered-panel">
        <div className="accounting-section-header">
          <div>
            <h2>{title}</h2>
          </div>
        </div>
        <SearchFiltersPanel
          open={isFiltersOpen}
          onToggle={() => setIsFiltersOpen((current) => !current)}
          title="Busqueda y filtros"
          helper="Buscar por persona, proveedor, periodo o medio de pago"
          activeCount={activeFilterCount}
          icon={<SearchIcon />}
          chevron={<ChevronIcon />}
          panelRef={filtersPanelRef}
          className="accounting-search-collapse accounting-movements-search-collapse"
          fields={[
            {
              id: 'movementSearch',
              label: 'Buscar persona/proveedor',
              value: filters.search,
              onChange: (value) => setFilters((current) => ({ ...current, search: value })),
              type: 'search',
              placeholder: 'Nombre, proveedor, categoria o referencia',
            },
            {
              id: 'movementCategory',
              label: 'Categoria',
              value: filters.categoryId,
              onChange: (value) => setFilters((current) => ({ ...current, categoryId: value })),
              type: 'select',
              options: [
                { value: 'all', label: 'Todas' },
                ...allCategories.map((category) => ({ value: category.id, label: category.name })),
              ],
            },
            {
              id: 'movementStatus',
              label: 'Estado',
              value: filters.status,
              onChange: (value) => setFilters((current) => ({ ...current, status: value })),
              type: 'select',
              options: [
                { value: 'all', label: 'Todos' },
                { value: 'posted', label: 'Pagado' },
                { value: 'pending', label: 'Pendiente' },
                { value: 'voided', label: 'Anulado' },
              ],
            },
            {
              id: 'movementPlanMode',
              label: 'Modalidad',
              value: filters.planMode,
              onChange: (value) => setFilters((current) => ({ ...current, planMode: value })),
              type: 'select',
              options: [
                { value: 'all', label: 'Todas' },
                { value: 'partial_payments', label: 'Pagos parciales' },
              ],
            },
            {
              id: 'movementPaymentMethod',
              label: 'Medio de pago',
              value: filters.paymentMethodId,
              onChange: (value) => setFilters((current) => ({ ...current, paymentMethodId: value })),
              type: 'select',
              options: [
                { value: 'all', label: 'Todos' },
                ...paymentMethods.map((method) => ({ value: method.id, label: getPaymentMethodDisplayName(method) })),
              ],
            },
            {
              id: 'movementDateFrom',
              label: 'Desde',
              value: filters.dateFrom,
              onChange: (value) => setFilters((current) => ({ ...current, dateFrom: value })),
              type: 'date',
            },
            {
              id: 'movementDateTo',
              label: 'Hasta',
              value: filters.dateTo,
              onChange: (value) => setFilters((current) => ({ ...current, dateTo: value })),
              type: 'date',
            },
          ]}
        />
        <div className="accounting-table-wrap">
          <table className="accounting-data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Categoria</th>
                <th>Tipo</th>
                <th>Medio</th>
                <th>Estado</th>
                <th>Usuario</th>
                <th>Monto</th>
                {hasActions && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {visibleMovements.map((movement) => (
                <tr key={movement.id} className={getMovementBalanceRowClassName(movement)}>
                  <td>{formatTimestamp(movement.operationDate)}</td>
                  <td>
                    <span>{getCategoryLabel(movement.categoryId)}</span>
                    {movement.installmentPlanId && (
                      <span className="status-chip status-chip--installments">
                        {movement.metadata?.partialPaymentMode === 'flexible' ? 'PAGOS PARCIALES' : 'CUOTAS'}
                      </span>
                    )}
                    {movement.installmentRole === 'charge' && <span className="status-chip status-chip--charge">CARGA</span>}
                  </td>
                  <td>{movement.movementType === 'income' ? 'Ingreso' : 'Egreso'}</td>
                  <td>{getPaymentMethodDisplayName(movement.paymentMethodCodeSnapshot)}</td>
                  <td><span className={`status-chip status-chip--${movement.status}`}>{getMovementStatusLabel(movement.status)}</span></td>
                  <td>{getMovementUserLabel(movement.createdBy, usersById)}</td>
                  <td>
                    <strong>{formatCurrency(getMovementListAmountMinor(movement))}</strong>
                    <InstallmentProgress movement={movement} compact />
                  </td>
                  {hasActions && (
                    <td>
                      <div className="accounting-movement-row-actions">
                        {onRegisterPartialPayment && canRegisterFlexiblePartialPayment(movement) && (
                          <button type="button" className="btn-primary" onClick={() => onRegisterPartialPayment(movement)}>
                            Registrar pago
                          </button>
                        )}
                        <button type="button" className="btn-secondary" onClick={() => onSelectMovement?.(movement)}>
                          Ver detalles
                        </button>
                        <AccountingMovementActions
                          movement={movement}
                          incomeCategories={incomeCategories}
                          expenseCategories={expenseCategories}
                          paymentMethods={paymentMethods}
                          {...(onMovementChanged ? { onChanged: onMovementChanged } : {})}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && filteredMovements.length === 0 && <AccountingEmptyState title="Sin movimientos para estos filtros" />}
        {!loading && filteredMovements.length > 0 && (
          <div className="accounting-movements-pagination" aria-live="polite">
            <span>{visibleMovements.length} de {filteredMovements.length} mostradas</span>
            {visibleMovements.length < filteredMovements.length && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setVisibleMovementCount((current) => Math.min(
                  current + MOVEMENTS_PAGE_SIZE,
                  filteredMovements.length,
                ))}
              >
                Cargar más datos
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
