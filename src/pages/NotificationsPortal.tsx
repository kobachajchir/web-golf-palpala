import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SearchFiltersPanel } from '../components/SearchFiltersPanel';
import { TemporaryCredentialsDialog } from '../components/TemporaryCredentialsDialog';
import { UiActionButton } from '../components/UiActionButton';
import { ROLE_LABELS, ROLES, type RoleType } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import { firestore } from '../lib/firebase';
import type {
  NotificationActorSnapshot,
  NotificationDelivery,
  NotificationDeliveryDocument,
  NotificationDeliveryStatus,
  NotificationsAdminFilters,
} from '../modules/notifications/domain/models';
import { createNotificationsCallables } from '../modules/notifications/functions/notifications.callables';
import type { TemporaryMemberCredentials } from '../modules/users/types/user.types';

const DELIVERY_COLLECTION = 'notification_deliveries';
const STAFF_ROLES: readonly RoleType[] = [ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO];
const STATUS_OPTIONS: Array<{ value: NotificationDeliveryStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'unread', label: 'Pendientes' },
  { value: 'read', label: 'Leidas' },
  { value: 'actioned', label: 'Accionadas' },
  { value: 'dismissed', label: 'Descartadas' },
];
const ROLE_OPTIONS: Array<{ value: RoleType | 'all'; label: string }> = [
  { value: 'all', label: 'Todos los roles' },
  { value: ROLES.ADMINISTRATIVO, label: ROLE_LABELS[ROLES.ADMINISTRATIVO] },
  { value: ROLES.DIRECTIVO, label: ROLE_LABELS[ROLES.DIRECTIVO] },
  { value: ROLES.EMPLEADO, label: ROLE_LABELS[ROLES.EMPLEADO] },
  { value: ROLES.SOCIO, label: ROLE_LABELS[ROLES.SOCIO] },
];

type NotificationIconType = 'bell' | 'chevron' | 'search';
type TimestampLike = {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
};

type PortalView = 'mine' | 'admin';

type ReceiptSnapshot = {
  receiptNumber: string | null;
  conceptLabel: string;
  movementId: string | null;
  memberId: string | null;
  memberNumber: string | null;
  memberName: string | null;
  amountMinor: number;
  grossAmountMinor: number;
  netAmountMinor: number;
  categoryId: string | null;
  paymentMethodId: string | null;
  operationDate: TimestampLike | string | Date | number | null;
  accountingPeriod: string | null;
  status: string | null;
  reference: string | null;
  notes: string | null;
};

function NotificationIcon({ type }: { type: NotificationIconType }) {
  const icons: Record<NotificationIconType, ReactNode> = {
    bell: (
      <path d="M12 3a6 6 0 0 1 6 6v2.55c0 .72.2 1.43.58 2.05l1.1 1.84A1.5 1.5 0 0 1 18.39 18H5.61a1.5 1.5 0 0 1-1.29-2.56l1.1-1.84A3.98 3.98 0 0 0 6 11.55V9a6 6 0 0 1 6-6Zm0 19a3 3 0 0 1-2.82-2h5.64A3 3 0 0 1 12 22Z" />
    ),
    chevron: (
      <path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.17l3.9-3.88a1 1 0 1 1 1.4 1.42l-4.6 4.58a1 1 0 0 1-1.4 0L6.7 10.7a1 1 0 0 1 0-1.42Z" />
    ),
    search: (
      <path d="M10.5 4a6.5 6.5 0 0 1 5.15 10.47l4.44 4.44a1 1 0 0 1-1.42 1.42l-4.44-4.44A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      {icons[type]}
    </svg>
  );
}

function normalizeDelivery(id: string, data: NotificationDeliveryDocument): NotificationDelivery {
  return {
    ...data,
    id,
    action: data.action ?? null,
    attachments: data.attachments ?? [],
    recipientRoleIds: data.recipientRoleIds ?? [],
  };
}

function timestampToDate(value: TimestampLike | string | Date | number | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  const seconds = typeof value.seconds === 'number' ? value.seconds : value._seconds;
  if (typeof seconds === 'number') {
    const nanoseconds = typeof value.nanoseconds === 'number' ? value.nanoseconds : value._nanoseconds ?? 0;
    return new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
  }

  return null;
}

function formatDateTime(value: TimestampLike | string | Date | number | null | undefined): string {
  const date = timestampToDate(value);
  return date
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Sin fecha';
}

function formatStatus(status: NotificationDeliveryStatus): string {
  if (status === 'unread') {
    return 'Pendiente';
  }

  if (status === 'read') {
    return 'Leida';
  }

  if (status === 'actioned') {
    return 'Accion tomada';
  }

  return 'Descartada';
}

function formatRoles(roleIds: RoleType[]): string {
  if (roleIds.length === 0) {
    return 'Usuario especifico';
  }

  return roleIds.map((roleId) => ROLE_LABELS[roleId] ?? roleId).join(', ');
}

function formatActor(actor: NotificationActorSnapshot | null | undefined, fallbackUid?: string | null): string {
  if (actor?.displayName) {
    const roleLabel = actor.primaryRoleId ? ROLE_LABELS[actor.primaryRoleId as RoleType] ?? actor.primaryRoleId : null;
    return roleLabel ? `${actor.displayName} (${roleLabel})` : actor.displayName;
  }

  return fallbackUid ?? 'Sin registrar';
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readDateLike(value: unknown): TimestampLike | string | Date | number | null {
  if (
    value instanceof Date ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    (value && typeof value === 'object')
  ) {
    return value as TimestampLike | string | Date | number;
  }

  return null;
}

function formatCurrencyMinor(amountMinor: number | null | undefined): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format((amountMinor ?? 0) / 100);
}

function getReceiptSnapshot(delivery: NotificationDelivery): ReceiptSnapshot | null {
  const metadata = readRecord(delivery.metadata) ?? {};
  const receipt = readRecord(metadata.receipt) ?? {};
  const movementId = readString(receipt.movementId) ?? readString(metadata.movementId) ?? delivery.sourceId ?? null;
  const amountMinor = readNumber(receipt.amountMinor) ?? readNumber(metadata.amountMinor);

  if (delivery.type !== 'member_payment_receipt' && !movementId && amountMinor === null) {
    return null;
  }

  return {
    receiptNumber: readString(receipt.receiptNumber) ?? readString(metadata.receiptNumber),
    conceptLabel: readString(receipt.conceptLabel) ?? 'Cuota societaria',
    movementId,
    memberId: readString(receipt.memberId) ?? readString(metadata.memberId),
    memberNumber: readString(receipt.memberNumber) ?? delivery.recipientMemberNumber ?? null,
    memberName: readString(receipt.memberName) ?? delivery.recipientDisplayName ?? null,
    amountMinor: amountMinor ?? 0,
    grossAmountMinor: readNumber(receipt.grossAmountMinor) ?? amountMinor ?? 0,
    netAmountMinor: readNumber(receipt.netAmountMinor) ?? amountMinor ?? 0,
    categoryId: readString(receipt.categoryId),
    paymentMethodId: readString(receipt.paymentMethodId),
    operationDate: readDateLike(receipt.operationDate) ?? readDateLike(delivery.createdAt),
    accountingPeriod: readString(receipt.accountingPeriod),
    status: readString(receipt.status),
    reference: readString(receipt.reference),
    notes: readString(receipt.notes),
  };
}

function updateDeliveryStatus(
  items: NotificationDelivery[],
  deliveryId: string,
  status: NotificationDeliveryStatus,
): NotificationDelivery[] {
  return items.map((item) => (item.id === deliveryId ? { ...item, status } : item));
}

function matchesLocalFilters(
  delivery: NotificationDelivery,
  filters: NotificationsAdminFilters,
  options?: { includeRecipientFilters?: boolean },
): boolean {
  const normalizedType = filters.type?.trim().toLowerCase();
  const normalizedUserQuery = options?.includeRecipientFilters ? filters.userQuery?.trim().toLowerCase() : '';
  const normalizedActionKey = filters.actionKey?.trim().toLowerCase();

  if (filters.status && filters.status !== 'all' && delivery.status !== filters.status) {
    return false;
  }

  if (options?.includeRecipientFilters && filters.roleId && filters.roleId !== 'all' && !delivery.recipientRoleIds.includes(filters.roleId)) {
    return false;
  }

  if (normalizedType && !delivery.type.toLowerCase().includes(normalizedType)) {
    return false;
  }

  if (normalizedActionKey) {
    const actionKey = delivery.action?.key?.toLowerCase() ?? '';
    if (!actionKey.includes(normalizedActionKey)) {
      return false;
    }
  }

  if (normalizedUserQuery) {
    const searchable = [
      delivery.recipientDisplayName,
      delivery.recipientMemberNumber,
      delivery.recipientUserId,
      delivery.titleSnapshot,
      delivery.bodySnapshot,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!searchable.includes(normalizedUserQuery)) {
      return false;
    }
  }

  return true;
}

export function NotificationsPortal() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, interfaceMode } = useAuth();
  const canManageNotifications = STAFF_ROLES.includes(interfaceMode);
  const notificationsCallables = useMemo(() => createNotificationsCallables(), []);
  const [view, setView] = useState<PortalView>('mine');
  const [ownItems, setOwnItems] = useState<NotificationDelivery[]>([]);
  const [adminItems, setAdminItems] = useState<NotificationDelivery[]>([]);
  const [loadingOwnItems, setLoadingOwnItems] = useState(true);
  const [loadingAdminItems, setLoadingAdminItems] = useState(false);
  const [error, setError] = useState('');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<NotificationsAdminFilters>({
    status: 'all',
    roleId: 'all',
    type: '',
    userQuery: '',
    actionKey: '',
    limit: 120,
  });
  const [selectedDelivery, setSelectedDelivery] = useState<NotificationDelivery | null>(null);
  const [pendingActionDelivery, setPendingActionDelivery] = useState<NotificationDelivery | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [credentialsDialog, setCredentialsDialog] = useState<TemporaryMemberCredentials | null>(null);
  const [visibleReceiptDeliveryId, setVisibleReceiptDeliveryId] = useState<string | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const receiptMovementParam = searchParams.get('receiptMovement');

  useEffect(() => {
    if (!canManageNotifications && view === 'admin') {
      setView('mine');
    }
  }, [canManageNotifications, view]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (filtersRef.current && !filtersRef.current.contains(target)) {
        setIsFiltersOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (!firestore || !user?.id) {
      setOwnItems([]);
      setLoadingOwnItems(false);
      return undefined;
    }

    setLoadingOwnItems(true);
    const deliveriesRef = collection(firestore, DELIVERY_COLLECTION);
    const deliveriesQuery = query(
      deliveriesRef,
      where('recipientUserId', '==', user.id),
      orderBy('createdAt', 'desc'),
      limit(80),
    );

    return onSnapshot(
      deliveriesQuery,
      (snapshot) => {
        const items = snapshot.docs.map((entry) => normalizeDelivery(entry.id, entry.data() as NotificationDeliveryDocument));
        setOwnItems(items);
        setLoadingOwnItems(false);
        setSelectedDelivery((current) => {
          if (!current) {
            return items[0] ?? null;
          }

          return items.find((item) => item.id === current.id) ?? current;
        });
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoadingOwnItems(false);
      },
    );
  }, [user?.id]);

  const loadAdminItems = useCallback(async () => {
    if (!canManageNotifications) {
      return;
    }

    setLoadingAdminItems(true);
    setError('');

    try {
      const result = await notificationsCallables.listAdmin(filters);
      setAdminItems(result.items);
      setSelectedDelivery((current) => {
        if (!current || view !== 'admin') {
          return result.items[0] ?? current;
        }

        return result.items.find((item) => item.id === current.id) ?? current;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar notificaciones.');
    } finally {
      setLoadingAdminItems(false);
    }
  }, [canManageNotifications, filters, notificationsCallables, view]);

  useEffect(() => {
    if (view === 'admin') {
      void loadAdminItems();
    }
  }, [loadAdminItems, view]);

  const isAdminView = canManageNotifications && view === 'admin';
  const activeItems = isAdminView ? adminItems : ownItems;
  const filteredItems = useMemo(
    () => (isAdminView ? adminItems : ownItems.filter((item) => matchesLocalFilters(item, filters))),
    [adminItems, filters, isAdminView, ownItems],
  );
  const pendingCount = activeItems.filter((item) => item.status === 'unread').length;
  const actionCount = activeItems.filter((item) => item.action && item.status !== 'actioned' && item.status !== 'dismissed').length;
  const isLoading = isAdminView ? loadingAdminItems : loadingOwnItems;
  const selectedReceipt = useMemo(
    () => (selectedDelivery ? getReceiptSnapshot(selectedDelivery) : null),
    [selectedDelivery],
  );
  const isReceiptVisible = Boolean(selectedReceipt && selectedDelivery && visibleReceiptDeliveryId === selectedDelivery.id);
  const activeFilterCount = useMemo(
    () =>
      Number(filters.status !== 'all') +
      Number(Boolean(filters.type?.trim())) +
      Number(Boolean(filters.actionKey?.trim())) +
      (isAdminView
        ? Number(Boolean(filters.userQuery?.trim())) + Number(filters.roleId !== 'all')
        : 0),
    [filters, isAdminView],
  );

  useEffect(() => {
    if (!receiptMovementParam) {
      return;
    }

    const allItems = [...ownItems, ...adminItems];
    const target = allItems.find((item) => {
      const receipt = getReceiptSnapshot(item);
      return item.sourceId === receiptMovementParam || receipt?.movementId === receiptMovementParam;
    });

    if (!target) {
      return;
    }

    setSelectedDelivery(target);
    setVisibleReceiptDeliveryId(target.id);
    if (canManageNotifications && adminItems.some((item) => item.id === target.id)) {
      setView('admin');
    } else {
      setView('mine');
    }
  }, [adminItems, canManageNotifications, ownItems, receiptMovementParam]);

  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isAdminView) {
      void loadAdminItems();
    }
  };

  const patchDeliveryStatus = (deliveryId: string, status: NotificationDeliveryStatus) => {
    setOwnItems((current) => updateDeliveryStatus(current, deliveryId, status));
    setAdminItems((current) => updateDeliveryStatus(current, deliveryId, status));
    setSelectedDelivery((current) => (current?.id === deliveryId ? { ...current, status } : current));
  };

  const markRead = async (delivery: NotificationDelivery) => {
    if (delivery.status !== 'unread') {
      return;
    }

    await notificationsCallables.markRead(delivery.id);
    patchDeliveryStatus(delivery.id, 'read');
  };

  const handleSelectDelivery = async (delivery: NotificationDelivery) => {
    setSelectedDelivery(delivery);
    setVisibleReceiptDeliveryId(null);

    try {
      await markRead(delivery);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'No pudimos marcar la notificacion como leida.');
    }
  };

  const handleDismiss = async (delivery: NotificationDelivery) => {
    setActionLoading(true);
    setError('');

    try {
      await notificationsCallables.dismiss(delivery.id);
      patchDeliveryStatus(delivery.id, 'dismissed');
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : 'No pudimos descartar la notificacion.');
    } finally {
      setActionLoading(false);
    }
  };

  const executeAction = async (delivery: NotificationDelivery) => {
    setActionLoading(true);
    setError('');

    try {
      const result = await notificationsCallables.executeAction(delivery.id);
      patchDeliveryStatus(delivery.id, 'actioned');

      const actionResult = result.result ?? {};
      if (
        typeof actionResult.temporaryPassword === 'string' &&
        typeof actionResult.memberNumber === 'string'
      ) {
        setCredentialsDialog({
          memberNumber: actionResult.memberNumber,
          temporaryPassword: actionResult.temporaryPassword,
          passwordGeneratedAt:
            typeof actionResult.passwordGeneratedAt === 'string' ? actionResult.passwordGeneratedAt : new Date().toISOString(),
        });
      }

      if (view === 'admin') {
        void loadAdminItems();
      }
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : 'No pudimos ejecutar la accion.');
    } finally {
      setActionLoading(false);
      setPendingActionDelivery(null);
    }
  };

  const handleExecuteAction = (delivery: NotificationDelivery) => {
    if (delivery.action?.requiresConfirmation) {
      setPendingActionDelivery(delivery);
      return;
    }

    void executeAction(delivery);
  };

  return (
    <div className="page-container accounting-page notifications-page accounting-notifications-page">
      <div className="accounting-shell notifications-shell accounting-notifications-shell">
        <section className="floating-card accounting-hero notifications-hero">
          <div className="accounting-hero__copy">
            <h1>Notificaciones</h1>
          </div>

          {canManageNotifications && (
            <div className="accounting-hero__actions notifications-hero__actions">
              <span className="action-icon notifications-hero__icon">
                <NotificationIcon type="bell" />
              </span>
              <div className="notifications-hero__status">
                <strong>{pendingCount} pendientes</strong>
                <small>{isAdminView ? 'Vista administrativa' : 'Vista personal'}</small>
              </div>
            </div>
          )}
        </section>

        {canManageNotifications && (
          <section className="accounting-summary-grid notification-summary-grid" aria-label="Resumen de notificaciones">
            <article className="summary-card">
              <span>Pendientes</span>
              <strong>{pendingCount}</strong>
              <small>Del panel actual</small>
            </article>
            <article className="summary-card">
              <span>Con accion</span>
              <strong>{actionCount}</strong>
              <small>Sin tomar o cerrar</small>
            </article>
            <article className="summary-card">
              <span>Mostradas</span>
              <strong>{filteredItems.length}</strong>
              <small>Segun filtros aplicados</small>
            </article>
          </section>
        )}

        <section className="floating-card accounting-primary-panel notifications-card">
          <div className="accounting-section-header accounting-section-header--plain notifications-section-header">
            <h2>{canManageNotifications ? 'Bandeja e historial' : 'Mis notificaciones'}</h2>
          </div>

          {canManageNotifications && (
            <div className="notification-tabs" role="tablist" aria-label="Vista de notificaciones">
              <button
                type="button"
                className={`notification-tab ${view === 'mine' ? 'notification-tab--active' : ''}`}
                onClick={() => setView('mine')}
              >
                Mis notificaciones
              </button>
              <button
                type="button"
                className={`notification-tab ${view === 'admin' ? 'notification-tab--active' : ''}`}
                onClick={() => setView('admin')}
              >
                Administracion
              </button>
            </div>
          )}

          <SearchFiltersPanel
            open={isFiltersOpen}
            onToggle={() => setIsFiltersOpen((current) => !current)}
            panelRef={filtersRef}
            title="Busqueda y filtros"
            helper={isAdminView ? 'Buscar por usuario, tipo, rol, estado o accion' : 'Filtrar por tipo, estado o accion'}
            activeCount={activeFilterCount}
            icon={<NotificationIcon type="search" />}
            chevron={<NotificationIcon type="chevron" />}
            className="notifications-search-collapse"
            bodyClassName="notifications-search-collapse__body"
            toolbarClassName="notifications-toolbar"
            rowClassName="notifications-toolbar__row"
            as="form"
            onSubmit={handleFilterSubmit}
            actions={(
              <div className="member-toolbar__actions notifications-toolbar__actions">
                <UiActionButton type="submit" variant="secondary" disabled={isLoading}>
                  {isLoading ? 'Cargando...' : 'Aplicar'}
                </UiActionButton>
              </div>
            )}
            fields={[
              {
                id: 'notificationUserSearch',
                label: 'Buscar usuario o socio',
                value: filters.userQuery ?? '',
                onChange: (value) => setFilters((current) => ({ ...current, userQuery: value })),
                type: 'search',
                placeholder: 'Nombre, socio, UID o texto',
                hidden: !isAdminView,
              },
              {
                id: 'notificationStatus',
                label: 'Estado',
                value: filters.status ?? 'all',
                onChange: (value) =>
                  setFilters((current) => ({
                    ...current,
                    status: value as NotificationDeliveryStatus | 'all',
                  })),
                type: 'select',
                options: STATUS_OPTIONS,
              },
            ]}
            secondaryFields={[
              {
                id: 'notificationType',
                label: 'Tipo',
                value: filters.type ?? '',
                onChange: (value) => setFilters((current) => ({ ...current, type: value })),
                type: 'search',
                placeholder: 'Ej. contacto, licencia',
                className: 'form-field',
              },
              {
                id: 'notificationRole',
                label: 'Destinatario por rol',
                value: filters.roleId ?? 'all',
                onChange: (value) =>
                  setFilters((current) => ({
                    ...current,
                    roleId: value as RoleType | 'all',
                  })),
                type: 'select',
                options: ROLE_OPTIONS,
                hidden: !isAdminView,
                className: 'form-field',
              },
              {
                id: 'notificationActionKey',
                label: 'Accion',
                value: filters.actionKey ?? '',
                onChange: (value) => setFilters((current) => ({ ...current, actionKey: value })),
                type: 'search',
                placeholder: 'Clave de accion',
                className: 'form-field',
              },
            ]}
          />

        {error && <div className="error-message">{error}</div>}

        <div className="notifications-layout">
          <div className="notifications-list" aria-label="Listado de notificaciones">
            {isLoading ? (
              <div className="loading-state loading-state--inline">
                <span className="loading-spinner" />
                <strong>Obteniendo notificaciones</strong>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="empty-state empty-state--inline">
                No encontramos notificaciones con esos filtros.
              </div>
            ) : (
              filteredItems.map((delivery) => (
                <button
                  key={delivery.id}
                  type="button"
                  className={`accounting-row accounting-row--actions notification-row ${selectedDelivery?.id === delivery.id ? 'notification-row--active' : ''}`}
                  onClick={() => void handleSelectDelivery(delivery)}
                >
                  <span className={`notification-status-dot notification-status-dot--${delivery.status}`} />
                  <span className="notification-row__main">
                    <strong>{delivery.titleSnapshot}</strong>
                    <small>{delivery.bodySnapshot}</small>
                    <span>{formatDateTime(delivery.createdAt as unknown as TimestampLike)}</span>
                  </span>
                  <span className="notification-row__meta">
                    <span className={`status-pill notification-status-pill notification-status-pill--${delivery.status}`}>
                      {formatStatus(delivery.status)}
                    </span>
                    {delivery.action && <small>{delivery.action.label}</small>}
                  </span>
                </button>
              ))
            )}
          </div>

          <aside className="floating-card accounting-panel notification-detail">
            {selectedDelivery ? (
              <>
                <div className="notification-detail__header">
                  <div>
                    <p className="eyebrow">{selectedDelivery.type}</p>
                    <h2>{selectedDelivery.titleSnapshot}</h2>
                  </div>
                  <span className={`status-pill notification-status-pill notification-status-pill--${selectedDelivery.status}`}>
                    {formatStatus(selectedDelivery.status)}
                  </span>
                </div>

                <p className="profile-note">{selectedDelivery.bodySnapshot}</p>

                <div className="notification-detail-grid">
                  <div>
                    <span>Destinatario</span>
                    <strong>{selectedDelivery.recipientDisplayName ?? selectedDelivery.recipientUserId}</strong>
                    <small>{selectedDelivery.recipientMemberNumber ? `Socio #${selectedDelivery.recipientMemberNumber}` : selectedDelivery.recipientUserId}</small>
                  </div>
                  <div>
                    <span>Roles destino</span>
                    <strong>{formatRoles(selectedDelivery.recipientRoleIds)}</strong>
                    <small>{selectedDelivery.deliveryScope}</small>
                  </div>
                  <div>
                    <span>Creada</span>
                    <strong>{formatDateTime(selectedDelivery.createdAt as unknown as TimestampLike)}</strong>
                    <small>{selectedDelivery.sourceModule}</small>
                  </div>
                  <div>
                    <span>Adjuntos</span>
                    <strong>{selectedDelivery.attachments.length}</strong>
                    <small>{selectedDelivery.attachments.length > 0 ? 'Disponibles' : 'Sin adjuntos'}</small>
                  </div>
                </div>

                <article className="accounting-panel notification-history-panel">
                  <p className="eyebrow">Historial</p>
                  <div className="membership-panel__list">
                    <div>
                      <span>Lectura</span>
                      <strong>{formatActor(selectedDelivery.readBySnapshot, selectedDelivery.readByUid)}</strong>
                      <small>{selectedDelivery.readAt ? formatDateTime(selectedDelivery.readAt as unknown as TimestampLike) : 'Sin leer'}</small>
                    </div>
                    <div>
                      <span>Accion</span>
                      <strong>{formatActor(selectedDelivery.actionedBySnapshot, selectedDelivery.actionedByUid)}</strong>
                      <small>{selectedDelivery.actionedAt ? formatDateTime(selectedDelivery.actionedAt as unknown as TimestampLike) : 'Sin accion registrada'}</small>
                    </div>
                  </div>
                </article>

                <article className="accounting-panel notification-attachments-panel">
                  <p className="eyebrow">Adjuntos</p>
                  {selectedDelivery.attachments.length === 0 ? (
                    <div className="empty-state empty-state--inline notification-attachments-empty">Sin adjuntos.</div>
                  ) : (
                    <div className="accounting-list">
                      {selectedDelivery.attachments.map((attachment) => (
                        <div key={attachment.id} className="accounting-row">
                          <div className="accounting-row__main">
                            <strong>{attachment.label}</strong>
                            <small>{attachment.contentType ?? 'Archivo'}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>

                {selectedReceipt && isReceiptVisible && (
                  <article className="notification-receipt-card" aria-label="Recibo de pago">
                    <div className="notification-receipt-card__header">
                      <div>
                        <p className="eyebrow">Comprobante interno</p>
                        <h3>RECIBO DE PAGO</h3>
                        <small>{selectedReceipt.receiptNumber ?? 'Recibo sin numeracion'}</small>
                      </div>
                      <div className="notification-receipt-card__stamp">
                        <span>Total</span>
                        <strong>{formatCurrencyMinor(selectedReceipt.netAmountMinor)}</strong>
                      </div>
                    </div>

                    <dl className="notification-receipt-list">
                      <div>
                        <dt>Fecha y hora</dt>
                        <dd>{formatDateTime(selectedReceipt.operationDate)}</dd>
                      </div>
                      <div>
                        <dt>Socio</dt>
                        <dd>{selectedReceipt.memberName ?? 'Sin socio informado'}</dd>
                      </div>
                      <div>
                        <dt>Numero de socio</dt>
                        <dd>{selectedReceipt.memberNumber ?? 'Sin numero'}</dd>
                      </div>
                      <div>
                        <dt>Concepto</dt>
                        <dd>{selectedReceipt.conceptLabel}</dd>
                      </div>
                      <div>
                        <dt>Medio de pago</dt>
                        <dd>{selectedReceipt.paymentMethodId ?? 'Sin medio informado'}</dd>
                      </div>
                      <div>
                        <dt>Categoria</dt>
                        <dd>{selectedReceipt.categoryId ?? 'cuota_societaria'}</dd>
                      </div>
                      <div>
                        <dt>Periodo</dt>
                        <dd>{selectedReceipt.accountingPeriod ?? 'Sin periodo'}</dd>
                      </div>
                      <div>
                        <dt>Referencia</dt>
                        <dd>{selectedReceipt.reference ?? selectedReceipt.movementId ?? 'Sin referencia'}</dd>
                      </div>
                      <div>
                        <dt>Estado</dt>
                        <dd>{selectedReceipt.status ?? 'posted'}</dd>
                      </div>
                      <div>
                        <dt>Importe bruto</dt>
                        <dd>{formatCurrencyMinor(selectedReceipt.grossAmountMinor)}</dd>
                      </div>
                      <div>
                        <dt>Importe neto</dt>
                        <dd>{formatCurrencyMinor(selectedReceipt.netAmountMinor)}</dd>
                      </div>
                      {selectedReceipt.notes && (
                        <div>
                          <dt>Notas</dt>
                          <dd>{selectedReceipt.notes}</dd>
                        </div>
                      )}
                    </dl>
                  </article>
                )}

                <div className="form-actions notification-detail__actions">
                  {selectedReceipt && (
                    <UiActionButton
                      type="button"
                      variant="positive"
                      onClick={() => setVisibleReceiptDeliveryId(isReceiptVisible ? null : selectedDelivery.id)}
                    >
                      {isReceiptVisible ? 'Ocultar recibo' : 'Ver recibo'}
                    </UiActionButton>
                  )}
                  {selectedDelivery.route && (
                    <UiActionButton type="button" variant="secondary" onClick={() => navigate(selectedDelivery.route ?? '/notificaciones')}>
                      Abrir destino
                    </UiActionButton>
                  )}
                  {selectedDelivery.status === 'unread' && (
                    <UiActionButton type="button" variant="secondary" disabled={actionLoading} onClick={() => void markRead(selectedDelivery)}>
                      Marcar leida
                    </UiActionButton>
                  )}
                  {selectedDelivery.action && selectedDelivery.status !== 'actioned' && selectedDelivery.status !== 'dismissed' && (
                    <UiActionButton type="button" variant="positive" disabled={actionLoading} onClick={() => handleExecuteAction(selectedDelivery)}>
                      {selectedDelivery.action.label}
                    </UiActionButton>
                  )}
                  {selectedDelivery.status !== 'dismissed' && selectedDelivery.status !== 'actioned' && (
                    <UiActionButton type="button" variant="secondary" disabled={actionLoading} onClick={() => void handleDismiss(selectedDelivery)}>
                      Descartar
                    </UiActionButton>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state empty-state--inline">Selecciona una notificacion para ver el detalle.</div>
            )}
          </aside>
        </div>
      </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingActionDelivery)}
        title={pendingActionDelivery?.action?.label ?? 'Ejecutar accion'}
        description={
          pendingActionDelivery ? (
            <>
              Esta accion quedara registrada con tu usuario, rol activo y fecha. Si es compartida por rol, tambien
              cerrara la misma notificacion para los demas destinatarios de ese rol.
            </>
          ) : null
        }
        confirmLabel="Ejecutar"
        loading={actionLoading}
        onCancel={() => setPendingActionDelivery(null)}
        onConfirm={() => {
          if (pendingActionDelivery) {
            void executeAction(pendingActionDelivery);
          }
        }}
      />

      <TemporaryCredentialsDialog
        open={Boolean(credentialsDialog)}
        title="Clave temporal generada"
        memberNumber={credentialsDialog?.memberNumber ?? ''}
        temporaryPassword={credentialsDialog?.temporaryPassword ?? ''}
        onClose={() => setCredentialsDialog(null)}
      />
    </div>
  );
}
