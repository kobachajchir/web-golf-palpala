import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchFiltersPanel } from '../../../components/SearchFiltersPanel';
import { UiActionButton } from '../../../components/UiActionButton';
import type { EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import type { PaymentMethod } from '../types/payment';
import type { ExpenseCategoryOption, IncomeCategoryOption } from '../utils/accountingCategories';
import { getCategoryLabel } from '../utils/accountingCategories';
import { getMovementBalanceRowClassName, isMovementExcludedFromBalance } from '../utils/balanceInclusion';
import { formatCurrency, formatPeriod, formatTimestamp, timestampToDate } from '../utils/accountingFormatters';
import {
  PAYMENT_ACCOUNT_OPTIONS,
  getMovementStatusLabel,
  getPaymentMethodAccount,
  getPaymentMethodDisplayName,
  type PaymentAccountId,
} from '../utils/paymentMethods';
import { AccountingMovementActions } from './AccountingMovementActions';

type TransferListItem = {
  movement: EntityWithId<FinancialMovementDocument>;
  counterpart: EntityWithId<FinancialMovementDocument> | null;
};

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

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function getMetadataString(movement: EntityWithId<FinancialMovementDocument>, key: string) {
  const value = movement.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getCounterpartMovementId(movement: EntityWithId<FinancialMovementDocument>) {
  return getMetadataString(movement, 'counterpartMovementId') || movement.originId || '';
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

function getMovementMethodId(movement: EntityWithId<FinancialMovementDocument> | null | undefined) {
  return movement?.paymentMethodId ?? movement?.paymentMethodCodeSnapshot ?? '';
}

function getPaymentAccountId(methodId: string, paymentMethods: PaymentMethod[]): PaymentAccountId | null {
  if (!methodId) {
    return null;
  }
  const method = paymentMethods.find((item) => item.id === methodId);
  return getPaymentMethodAccount(method ?? { id: methodId, name: getPaymentMethodDisplayName(methodId) });
}

function getTransferMethodId(item: TransferListItem, direction: 'source' | 'destination') {
  const metadataKey = direction === 'source' ? 'sourcePaymentMethodId' : 'destinationPaymentMethodId';
  const metadataMethodId = getMetadataString(item.movement, metadataKey)
    || (item.counterpart ? getMetadataString(item.counterpart, metadataKey) : '');
  if (metadataMethodId) {
    return metadataMethodId;
  }
  const outgoing = item.movement.movementType === 'expense'
    ? item.movement
    : item.counterpart?.movementType === 'expense'
      ? item.counterpart
      : null;
  const incoming = item.movement.movementType === 'income'
    ? item.movement
    : item.counterpart?.movementType === 'income'
      ? item.counterpart
      : null;
  return direction === 'source' ? getMovementMethodId(outgoing) : getMovementMethodId(incoming);
}

function getAccountLabel(methodId: string, paymentMethods: PaymentMethod[]) {
  const accountId = getPaymentAccountId(methodId, paymentMethods);
  if (accountId) {
    return PAYMENT_ACCOUNT_OPTIONS.find((account) => account.id === accountId)?.label ?? accountId;
  }
  return methodId ? getPaymentMethodDisplayName(methodId) : 'Cuenta no identificada';
}

function buildTransferItems(movements: Array<EntityWithId<FinancialMovementDocument>>): TransferListItem[] {
  const internalMovements = movements.filter((movement) => movement.originType === 'internal_transfer');
  const byId = new Map(internalMovements.map((movement) => [movement.id, movement]));
  const usedIds = new Set<string>();
  const items: TransferListItem[] = [];

  internalMovements.forEach((movement) => {
    if (usedIds.has(movement.id)) {
      return;
    }
    const counterpart = byId.get(getCounterpartMovementId(movement)) ?? null;
    const representative = movement.movementType === 'expense'
      ? movement
      : counterpart?.movementType === 'expense'
        ? counterpart
        : movement;
    const representativeCounterpart = representative.id === movement.id ? counterpart : movement;
    usedIds.add(movement.id);
    if (counterpart) {
      usedIds.add(counterpart.id);
    }
    items.push({ movement: representative, counterpart: representativeCounterpart });
  });

  return items;
}

function getHistoricalMovementReference(movement: EntityWithId<FinancialMovementDocument>) {
  return getMetadataString(movement, 'paymentReference')
    || getMetadataString(movement, 'transferReference')
    || movement.notes
    || 'Sin referencia';
}

export function AccountingInternalTransfersPanel({
  movements,
  paymentMethods,
  incomeCategories,
  expenseCategories,
  period,
  loading,
  canCreateTransfer,
  onOpenTransfer,
  onSelectMovement,
  onMovementChanged,
}: {
  movements: Array<EntityWithId<FinancialMovementDocument>>;
  paymentMethods: PaymentMethod[];
  incomeCategories: IncomeCategoryOption[];
  expenseCategories: ExpenseCategoryOption[];
  period: string;
  loading: boolean;
  canCreateTransfer: boolean;
  onOpenTransfer: () => void;
  onSelectMovement: (movement: EntityWithId<FinancialMovementDocument>) => void;
  onMovementChanged: () => void | Promise<void>;
}) {
  const filtersPanelRef = useRef<HTMLDivElement | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    search: '',
    sourceAccountId: 'all',
    destinationAccountId: 'all',
    status: 'all',
    dateFrom: '',
    dateTo: '',
  });
  const transferItems = useMemo(() => buildTransferItems(movements), [movements]);
  const unassignedMovements = useMemo(
    () => movements.filter((movement) => (
      movement.status === 'posted'
      && !isMovementExcludedFromBalance(movement)
      && !getPaymentAccountId(getMovementMethodId(movement), paymentMethods)
    )),
    [movements, paymentMethods],
  );
  const unassignedRegularMovements = useMemo(
    () => unassignedMovements.filter((movement) => movement.originType !== 'internal_transfer'),
    [unassignedMovements],
  );

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

  const filteredTransfers = useMemo(
    () => transferItems.filter((item) => {
      const movementDateKey = getMovementDateKey(item.movement);
      const sourceMethodId = getTransferMethodId(item, 'source');
      const destinationMethodId = getTransferMethodId(item, 'destination');
      const sourceAccountId = getPaymentAccountId(sourceMethodId, paymentMethods) ?? 'unassigned';
      const destinationAccountId = getPaymentAccountId(destinationMethodId, paymentMethods) ?? 'unassigned';
      if (filters.sourceAccountId !== 'all' && filters.sourceAccountId !== sourceAccountId) {
        return false;
      }
      if (filters.destinationAccountId !== 'all' && filters.destinationAccountId !== destinationAccountId) {
        return false;
      }
      if (filters.status !== 'all' && item.movement.status !== filters.status) {
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
          item.movement.id,
          getMetadataString(item.movement, 'transferReference'),
          getAccountLabel(sourceMethodId, paymentMethods),
          getAccountLabel(destinationMethodId, paymentMethods),
          getPaymentMethodDisplayName(sourceMethodId),
          getPaymentMethodDisplayName(destinationMethodId),
          item.movement.notes,
          item.counterpart?.notes,
        ].filter(Boolean).join(' '));
        if (!searchable.includes(query)) {
          return false;
        }
      }
      return true;
    }),
    [filters, paymentMethods, transferItems],
  );
  const activeFilterCount = [
    filters.search.trim().length > 0,
    filters.sourceAccountId !== 'all',
    filters.destinationAccountId !== 'all',
    filters.status !== 'all',
    Boolean(filters.dateFrom),
    Boolean(filters.dateTo),
  ].filter(Boolean).length;
  const accountFilterOptions = [
    { value: 'all', label: 'Todas' },
    ...PAYMENT_ACCOUNT_OPTIONS.map((account) => ({ value: account.id, label: account.label })),
    { value: 'unassigned', label: 'Cuenta no identificada' },
  ];

  return (
    <section className="accounting-internal-transfers-section" aria-labelledby="accounting-internal-transfers-title">
      {unassignedMovements.length > 0 && (
        <div className="accounting-balance-warning" role="status">
          <strong>{unassignedMovements.length} movimiento{unassignedMovements.length === 1 ? '' : 's'} histórico{unassignedMovements.length === 1 ? '' : 's'} sin cuenta identificada.</strong>{' '}
          Corregilos desde el menú de más acciones para incorporarlos a los saldos por cuenta.
        </div>
      )}

      {unassignedRegularMovements.length > 0 && (
        <section className="accounting-unassigned-movements" aria-labelledby="accounting-unassigned-movements-title">
          <div className="accounting-section-header accounting-section-header--plain">
            <div>
              <p className="eyebrow">Revisión pendiente</p>
              <h3 id="accounting-unassigned-movements-title">Movimientos sin cuenta</h3>
              <p>Estos movimientos históricos impactan el saldo general, pero todavía necesitan una cuenta o medio de pago.</p>
            </div>
          </div>
          <div className="accounting-table-wrap">
            <table className="accounting-data-table">
              <thead>
                <tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Referencia</th><th>Monto</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {unassignedRegularMovements.map((movement) => (
                  <tr key={movement.id} className="accounting-row--warning">
                    <td>{formatTimestamp(movement.operationDate)}</td>
                    <td>{movement.movementType === 'income' ? 'Ingreso' : 'Egreso'}</td>
                    <td>{getCategoryLabel(movement.categoryId)}</td>
                    <td>{getHistoricalMovementReference(movement)}</td>
                    <td><strong>{formatCurrency(movement.netAmountMinor)}</strong></td>
                    <td>
                      <div className="accounting-movement-row-actions">
                        <button type="button" className="btn-secondary" onClick={() => onSelectMovement(movement)}>Ver detalles</button>
                        <AccountingMovementActions
                          movement={movement}
                          incomeCategories={incomeCategories}
                          expenseCategories={expenseCategories}
                          paymentMethods={paymentMethods}
                          onChanged={onMovementChanged}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="accounting-section-header accounting-section-header--plain">
        <div>
          <p className="eyebrow">Transferencias internas</p>
          <h2 id="accounting-internal-transfers-title">Movimientos entre cuentas</h2>
          <p>{transferItems.length} movimientos cargados en el historial hasta {formatPeriod(period)}. No modifican el resultado del club.</p>
        </div>
        <UiActionButton type="button" variant="secondary" disabled={!canCreateTransfer} onClick={onOpenTransfer}>
          Nuevo movimiento
        </UiActionButton>
      </div>

      <SearchFiltersPanel
        open={isFiltersOpen}
        onToggle={() => setIsFiltersOpen((current) => !current)}
        title="Búsqueda y filtros"
        helper="Buscar por referencia, cuenta, medio de pago o notas"
        activeCount={activeFilterCount}
        icon={<SearchIcon />}
        chevron={<ChevronIcon />}
        panelRef={filtersPanelRef}
        className="accounting-search-collapse accounting-transfer-search-collapse"
        fields={[
          {
            id: 'transferSearch',
            label: 'Buscar movimiento',
            value: filters.search,
            onChange: (value) => setFilters((current) => ({ ...current, search: value })),
            type: 'search',
            placeholder: 'Referencia, cuenta, medio o notas',
          },
          {
            id: 'transferSourceAccount',
            label: 'Cuenta de origen',
            value: filters.sourceAccountId,
            onChange: (value) => setFilters((current) => ({ ...current, sourceAccountId: value })),
            type: 'select',
            options: accountFilterOptions,
          },
          {
            id: 'transferDestinationAccount',
            label: 'Cuenta de destino',
            value: filters.destinationAccountId,
            onChange: (value) => setFilters((current) => ({ ...current, destinationAccountId: value })),
            type: 'select',
            options: accountFilterOptions,
          },
          {
            id: 'transferStatus',
            label: 'Estado',
            value: filters.status,
            onChange: (value) => setFilters((current) => ({ ...current, status: value })),
            type: 'select',
            options: [
              { value: 'all', label: 'Todos' },
              { value: 'posted', label: 'Pagado' },
              { value: 'pending', label: 'Pendiente' },
              { value: 'voided', label: 'Anulado' },
              { value: 'reversed', label: 'Revertido' },
            ],
          },
          {
            id: 'transferDateFrom',
            label: 'Desde',
            value: filters.dateFrom,
            onChange: (value) => setFilters((current) => ({ ...current, dateFrom: value })),
            type: 'date',
          },
          {
            id: 'transferDateTo',
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
            <tr><th>Fecha</th><th>Origen</th><th>Destino</th><th>Referencia</th><th>Estado</th><th>Monto</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {filteredTransfers.map((item) => {
              const sourceMethodId = getTransferMethodId(item, 'source');
              const destinationMethodId = getTransferMethodId(item, 'destination');
              const hasUnassignedAccount = !getPaymentAccountId(sourceMethodId, paymentMethods)
                || !getPaymentAccountId(destinationMethodId, paymentMethods);
              return (
                <tr
                  key={item.movement.id}
                  className={[
                    hasUnassignedAccount ? 'accounting-row--warning' : '',
                    getMovementBalanceRowClassName(item.movement),
                  ].filter(Boolean).join(' ')}
                >
                  <td>{formatTimestamp(item.movement.operationDate)}</td>
                  <td>{getAccountLabel(sourceMethodId, paymentMethods)}</td>
                  <td>{getAccountLabel(destinationMethodId, paymentMethods)}</td>
                  <td>{getMetadataString(item.movement, 'transferReference') || 'Sin referencia'}</td>
                  <td><span className={`status-chip status-chip--${item.movement.status}`}>{getMovementStatusLabel(item.movement.status)}</span></td>
                  <td><strong>{formatCurrency(item.movement.netAmountMinor)}</strong></td>
                  <td>
                    <div className="accounting-movement-row-actions">
                      <button type="button" className="btn-secondary" onClick={() => onSelectMovement(item.movement)}>Ver detalles</button>
                      <AccountingMovementActions
                        movement={item.movement}
                        counterpartMovement={item.counterpart}
                        incomeCategories={incomeCategories}
                        expenseCategories={expenseCategories}
                        paymentMethods={paymentMethods}
                        onChanged={onMovementChanged}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && filteredTransfers.length === 0 && (
              <tr><td colSpan={7}>Sin movimientos entre cuentas para estos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
