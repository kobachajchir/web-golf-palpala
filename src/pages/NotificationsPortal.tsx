import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TemporaryCredentialsDialog } from '../components/TemporaryCredentialsDialog';
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
const STAFF_ROLES = [ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO] as const;
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

type TimestampLike = {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
};

type PortalView = 'mine' | 'admin';

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
): boolean {
  const normalizedType = filters.type?.trim().toLowerCase();
  const normalizedUserQuery = filters.userQuery?.trim().toLowerCase();
  const normalizedActionKey = filters.actionKey?.trim().toLowerCase();

  if (filters.status && filters.status !== 'all' && delivery.status !== filters.status) {
    return false;
  }

  if (filters.roleId && filters.roleId !== 'all' && !delivery.recipientRoleIds.includes(filters.roleId)) {
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
  const { user, hasAnyRole } = useAuth();
  const canManageNotifications = hasAnyRole(STAFF_ROLES);
  const notificationsCallables = useMemo(() => createNotificationsCallables(), []);
  const [view, setView] = useState<PortalView>('mine');
  const [ownItems, setOwnItems] = useState<NotificationDelivery[]>([]);
  const [adminItems, setAdminItems] = useState<NotificationDelivery[]>([]);
  const [loadingOwnItems, setLoadingOwnItems] = useState(true);
  const [loadingAdminItems, setLoadingAdminItems] = useState(false);
  const [error, setError] = useState('');
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

  useEffect(() => {
    if (!canManageNotifications && view === 'admin') {
      setView('mine');
    }
  }, [canManageNotifications, view]);

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

  const activeItems = view === 'admin' ? adminItems : ownItems;
  const filteredItems = useMemo(
    () => (view === 'admin' ? adminItems : ownItems.filter((item) => matchesLocalFilters(item, filters))),
    [adminItems, filters, ownItems, view],
  );
  const pendingCount = activeItems.filter((item) => item.status === 'unread').length;
  const actionCount = activeItems.filter((item) => item.action && item.status !== 'actioned' && item.status !== 'dismissed').length;
  const isLoading = view === 'admin' ? loadingAdminItems : loadingOwnItems;

  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (view === 'admin') {
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
    <div className="page-container profile-page notifications-page">
      <section className="floating-card notifications-card">
        <div className="public-profile-card__header membership-profile-card__header">
          <div className="public-profile-avatar">N</div>
          <div className="public-profile-card__copy">
            <p className="eyebrow">Centro de notificaciones</p>
            <h1>Notificaciones</h1>
            <p className="profile-note">
              Avisos internos, acciones pendientes e historial de lecturas sin correo ni push.
            </p>
          </div>
        </div>

        <div className="notification-summary-grid">
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
        </div>

        <div className="notification-tabs" role="tablist" aria-label="Vista de notificaciones">
          <button
            type="button"
            className={`notification-tab ${view === 'mine' ? 'notification-tab--active' : ''}`}
            onClick={() => setView('mine')}
          >
            Mis notificaciones
          </button>
          {canManageNotifications && (
            <button
              type="button"
              className={`notification-tab ${view === 'admin' ? 'notification-tab--active' : ''}`}
              onClick={() => setView('admin')}
            >
              Administracion
            </button>
          )}
        </div>

        <form className="member-toolbar notifications-toolbar" onSubmit={handleFilterSubmit}>
          <div className="member-toolbar__row notifications-toolbar__row">
            <label className="member-search member-search--wide" htmlFor="notificationUserSearch">
              <span>{view === 'admin' ? 'Buscar usuario o socio' : 'Buscar en mis avisos'}</span>
              <input
                id="notificationUserSearch"
                type="search"
                value={filters.userQuery ?? ''}
                onChange={(event) => setFilters((current) => ({ ...current, userQuery: event.target.value }))}
                placeholder="Nombre, socio, UID o texto"
              />
            </label>

            <label className="form-field member-filter" htmlFor="notificationStatus">
              <span>Estado</span>
              <select
                id="notificationStatus"
                value={filters.status ?? 'all'}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value as NotificationDeliveryStatus | 'all',
                  }))
                }
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="member-toolbar__actions notifications-toolbar__actions">
              <button type="submit" className="btn-secondary" disabled={isLoading}>
                {isLoading ? 'Cargando...' : 'Aplicar'}
              </button>
            </div>
          </div>

          <div className="notifications-filter-row">
            <label className="form-field" htmlFor="notificationType">
              <span>Tipo</span>
              <input
                id="notificationType"
                type="search"
                value={filters.type ?? ''}
                onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}
                placeholder="Ej. contacto, licencia"
              />
            </label>

            <label className="form-field" htmlFor="notificationRole">
              <span>Destinatario por rol</span>
              <select
                id="notificationRole"
                value={filters.roleId ?? 'all'}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    roleId: event.target.value as RoleType | 'all',
                  }))
                }
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="notificationActionKey">
              <span>Accion</span>
              <input
                id="notificationActionKey"
                type="search"
                value={filters.actionKey ?? ''}
                onChange={(event) => setFilters((current) => ({ ...current, actionKey: event.target.value }))}
                placeholder="Clave de accion"
              />
            </label>
          </div>
        </form>

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
                  className={`notification-row ${selectedDelivery?.id === delivery.id ? 'notification-row--active' : ''}`}
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

          <aside className="notification-detail">
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

                <article className="membership-panel notification-history-panel">
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

                <article className="membership-panel notification-attachments-panel">
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

                <div className="form-actions notification-detail__actions">
                  {selectedDelivery.route && (
                    <button type="button" className="btn-secondary" onClick={() => navigate(selectedDelivery.route ?? '/notificaciones')}>
                      Abrir destino
                    </button>
                  )}
                  {selectedDelivery.status === 'unread' && (
                    <button type="button" className="btn-secondary" disabled={actionLoading} onClick={() => void markRead(selectedDelivery)}>
                      Marcar leida
                    </button>
                  )}
                  {selectedDelivery.action && selectedDelivery.status !== 'actioned' && selectedDelivery.status !== 'dismissed' && (
                    <button type="button" className="btn-primary" disabled={actionLoading} onClick={() => handleExecuteAction(selectedDelivery)}>
                      {selectedDelivery.action.label}
                    </button>
                  )}
                  {selectedDelivery.status !== 'dismissed' && selectedDelivery.status !== 'actioned' && (
                    <button type="button" className="btn-secondary" disabled={actionLoading} onClick={() => void handleDismiss(selectedDelivery)}>
                      Descartar
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state empty-state--inline">Selecciona una notificacion para ver el detalle.</div>
            )}
          </aside>
        </div>
      </section>

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
