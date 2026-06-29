import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { ROLES, type RoleType } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import { firestore } from '../lib/firebase';
import { subscribeTournamentRegistrations } from '../modules/tournaments/repositories';
import type { EntityWithId, TournamentRegistrationDocument } from '../modules/tournaments/domain/models';
import { getRoleLabel, getUserDisplayName } from '../utils/user';

type ActionIconType =
  | 'calendar'
  | 'wallet'
  | 'people'
  | 'clipboard'
  | 'badge'
  | 'chart'
  | 'shield'
  | 'flag'
  | 'pencil';

type QuickActionCategory = 'Socios' | 'Caja' | 'Empleados' | 'Torneos' | 'Reportes' | 'Perfil' | 'Club';

type RoleAction = {
  id: string;
  category: QuickActionCategory;
  label: string;
  helper: string;
  icon: ActionIconType;
  roles: RoleType[];
  route?: string;
  notice?: string;
};

type TournamentRegistrationRecord = EntityWithId<TournamentRegistrationDocument>;

const MAX_QUICK_ACTIONS = 6;
const MEMBER_ROLES = [ROLES.SOCIO, ROLES.COMISION_DIRECTIVA];
const STAFF_ROLES = [ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO];

const QUICK_ACTION_LIBRARY: RoleAction[] = [
  { id: 'profile', category: 'Perfil', label: 'Mi perfil', helper: 'Datos personales', icon: 'badge', roles: [ROLES.SOCIO, ROLES.COMISION_DIRECTIVA, ROLES.EMPLEADO], route: '/perfil' },
  { id: 'change-password', category: 'Perfil', label: 'Cambiar contrasena', helper: 'Seguridad de acceso', icon: 'shield', roles: [ROLES.SOCIO, ROLES.COMISION_DIRECTIVA, ROLES.EMPLEADO], route: '/perfil?panel=password' },
  { id: 'membership', category: 'Socios', label: 'Mi membresia', helper: 'Estado de socio', icon: 'wallet', roles: MEMBER_ROLES, route: '/mi-membresia' },
  { id: 'member-payments', category: 'Socios', label: 'Mis pagos', helper: 'Cuota y estado de pago', icon: 'wallet', roles: [ROLES.SOCIO], route: '/mi-membresia?focus=payments' },
  { id: 'family-group', category: 'Socios', label: 'Grupo familiar', helper: 'Vinculos y titulares', icon: 'people', roles: MEMBER_ROLES, route: '/mi-membresia?focus=family' },
  { id: 'courts', category: 'Club', label: 'Solicitar cancha', helper: 'Fechas y horarios', icon: 'calendar', roles: MEMBER_ROLES, route: '/canchas' },
  { id: 'club-contact', category: 'Club', label: 'Contacto del club', helper: 'Direccion y consulta', icon: 'people', roles: [ROLES.SOCIO, ROLES.COMISION_DIRECTIVA, ROLES.EMPLEADO, ROLES.ADMINISTRATIVO], route: '/club#contacto' },
  { id: 'club-board', category: 'Club', label: 'Comision Directiva', helper: 'Cargos institucionales', icon: 'people', roles: [ROLES.COMISION_DIRECTIVA, ROLES.DIRECTIVO], route: '/directiva' },
  { id: 'tournaments', category: 'Torneos', label: 'Torneos abiertos', helper: 'Inscripciones disponibles', icon: 'flag', roles: [ROLES.SOCIO, ROLES.COMISION_DIRECTIVA, ROLES.EMPLEADO, ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO], route: '/torneos?status=registration_open&open=search' },
  { id: 'tournament-results', category: 'Torneos', label: 'Resultados', helper: 'Tarjetas y posiciones', icon: 'flag', roles: MEMBER_ROLES, route: '/torneos?tab=leaderboard&open=results' },
  { id: 'report-expense', category: 'Empleados', label: 'Cargar gasto', helper: 'Tickets y rendiciones', icon: 'clipboard', roles: [ROLES.EMPLEADO], notice: 'La carga propia de gastos queda preparada para conectarse al portal del empleado.' },
  { id: 'my-expenses', category: 'Empleados', label: 'Mis rendiciones', helper: 'Estado de cargas', icon: 'wallet', roles: [ROLES.EMPLEADO], notice: 'El seguimiento propio de rendiciones queda preparado para conectarse al portal del empleado.' },
  { id: 'expense-status', category: 'Empleados', label: 'Estado de comprobantes', helper: 'Revision administrativa', icon: 'clipboard', roles: [ROLES.EMPLEADO], notice: 'El estado de comprobantes propios queda preparado para el portal del empleado.' },
  { id: 'employee-certificate', category: 'Empleados', label: 'Comprobante laboral', helper: 'Documentacion propia', icon: 'badge', roles: [ROLES.EMPLEADO], notice: 'La carga de documentacion laboral propia queda preparada para el portal del empleado.' },
  { id: 'register-payment', category: 'Caja', label: 'Registrar cobro', helper: 'Cuotas e ingresos', icon: 'wallet', roles: [ROLES.ADMINISTRATIVO], route: '/accounting/collections' },
  { id: 'generate-fee', category: 'Socios', label: 'Generar cuota', helper: 'Cuota societaria', icon: 'wallet', roles: [ROLES.ADMINISTRATIVO], route: '/accounting/member-dues' },
  { id: 'renewals', category: 'Socios', label: 'Renovaciones', helper: 'Socios por renovar', icon: 'calendar', roles: [ROLES.ADMINISTRATIVO], route: '/accounting/member-dues?tab=renewals' },
  { id: 'cash-closures', category: 'Caja', label: 'Cierre de caja', helper: 'Arqueos diarios', icon: 'chart', roles: [ROLES.ADMINISTRATIVO], route: '/accounting/cash-closures' },
  { id: 'expense-review', category: 'Empleados', label: 'Rendiciones', helper: 'Revision y aprobacion', icon: 'clipboard', roles: [ROLES.ADMINISTRATIVO], route: '/accounting/expenses?tab=queue' },
  { id: 'manage-members', category: 'Socios', label: 'Socios', helper: 'Padron y membresias', icon: 'people', roles: [ROLES.ADMINISTRATIVO], route: '/admin/members' },
  { id: 'manage-employees', category: 'Empleados', label: 'Empleados', helper: 'Legajos y accesos', icon: 'people', roles: STAFF_ROLES, route: '/admin/employees' },
  { id: 'employee-documents', category: 'Empleados', label: 'Comprobantes laborales', helper: 'F931, ART y obra social', icon: 'badge', roles: [ROLES.ADMINISTRATIVO], route: '/accounting/external-docs' },
  { id: 'manual-expense', category: 'Caja', label: 'Registrar egreso', helper: 'Gastos operativos', icon: 'clipboard', roles: [ROLES.ADMINISTRATIVO], route: '/accounting/expenses' },
  { id: 'daily-movements', category: 'Caja', label: 'Movimientos del dia', helper: 'Caja operativa', icon: 'chart', roles: [ROLES.ADMINISTRATIVO], route: '/accounting/expenses?tab=movements' },
  { id: 'cash-flow', category: 'Reportes', label: 'Flujo de caja', helper: 'Entradas y salidas', icon: 'chart', roles: [ROLES.DIRECTIVO], route: '/accounting/reports?tab=stats' },
  { id: 'reports', category: 'Reportes', label: 'Reportes', helper: 'Balances y resumen', icon: 'flag', roles: [ROLES.DIRECTIVO], route: '/accounting/reports' },
  { id: 'payroll', category: 'Empleados', label: 'Liquidaciones', helper: 'Nomina mensual', icon: 'clipboard', roles: [ROLES.DIRECTIVO], route: '/accounting/employees' },
  { id: 'salary-overtime', category: 'Empleados', label: 'Sueldos y horas extra', helper: 'Configuracion y control', icon: 'wallet', roles: [ROLES.DIRECTIVO], route: '/accounting/employees?focus=salary' },
  { id: 'bank-movements', category: 'Caja', label: 'Movimientos bancarios', helper: 'Bancos y saldos', icon: 'chart', roles: [ROLES.DIRECTIVO], route: '/accounting/bank-settlements' },
  { id: 'void-movement', category: 'Caja', label: 'Anular movimiento', helper: 'Reversos controlados', icon: 'shield', roles: [ROLES.DIRECTIVO], route: '/accounting/expenses?tab=movements' },
  { id: 'membership-pricing', category: 'Socios', label: 'Configurar cuota', helper: 'Precio societario', icon: 'wallet', roles: [ROLES.DIRECTIVO], route: '/accounting/member-dues?tab=config' },
  { id: 'macro-settlements', category: 'Caja', label: 'Macro y conciliaciones', helper: 'Debito y liquidaciones', icon: 'chart', roles: [ROLES.DIRECTIVO], route: '/accounting/bank-settlements' },
  { id: 'external-references', category: 'Empleados', label: 'F931 / ART / Obra social', helper: 'Referencias externas', icon: 'badge', roles: [ROLES.DIRECTIVO], route: '/accounting/external-docs' },
  { id: 'stats', category: 'Reportes', label: 'Estadisticas', helper: 'Indicadores completos', icon: 'chart', roles: [ROLES.DIRECTIVO], route: '/accounting/reports?tab=stats' },
];

const DEFAULT_QUICK_ACTION_IDS: Record<RoleType, string[]> = {
  [ROLES.SOCIO]: ['membership', 'tournaments', 'courts', 'member-payments', 'family-group', 'club-contact'],
  [ROLES.COMISION_DIRECTIVA]: ['profile', 'membership', 'tournaments', 'club-board', 'club-contact', 'courts'],
  [ROLES.EMPLEADO]: ['report-expense', 'my-expenses', 'profile', 'change-password', 'club-contact'],
  [ROLES.ADMINISTRATIVO]: ['register-payment', 'generate-fee', 'renewals', 'cash-closures', 'expense-review', 'manage-members'],
  [ROLES.DIRECTIVO]: ['cash-flow', 'reports', 'payroll', 'salary-overtime', 'bank-movements', 'void-movement'],
};

const QUICK_ACTION_CATEGORY_ORDER: QuickActionCategory[] = ['Socios', 'Caja', 'Empleados', 'Torneos', 'Reportes', 'Perfil', 'Club'];

function formatAmountMinor(amountMinor: number) {
  return `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amountMinor / 100)}`;
}

function getRegistrationStatusLabel(registration: TournamentRegistrationRecord) {
  if (registration.paymentStatus === 'paid') {
    return 'Confirmada';
  }

  if (registration.status === 'pending_approval') {
    return 'Pendiente de aprobacion';
  }

  if (registration.status === 'cancelled') {
    return 'Cancelada';
  }

  if (registration.status === 'waitlisted') {
    return 'Lista de espera';
  }

  return 'Pago pendiente';
}

function getRegistrationStatusClass(registration: TournamentRegistrationRecord) {
  if (registration.paymentStatus === 'paid') {
    return 'status-chip--paid';
  }

  if (registration.status === 'cancelled') {
    return 'status-chip--cancelled';
  }

  return 'status-chip--pending';
}

function getValidQuickActionIds(
  actionIds: readonly string[] | null | undefined,
  allowedActionIds: ReadonlySet<string>,
  fallbackIds: readonly string[],
) {
  const validIds = (actionIds ?? [])
    .filter((actionId) => allowedActionIds.has(actionId))
    .slice(0, MAX_QUICK_ACTIONS);

  return validIds.length > 0 ? validIds : fallbackIds.slice(0, MAX_QUICK_ACTIONS);
}

function Icon({ type }: { type: ActionIconType }) {
  const icons: Record<ActionIconType, ReactNode> = {
    calendar: (
      <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 22 6.5v12A2.5 2.5 0 0 1 19.5 21h-15A2.5 2.5 0 0 1 2 18.5v-12A2.5 2.5 0 0 1 4.5 4H6V3a1 1 0 0 1 1-1Zm12.5 8h-15v8.5a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5V10ZM5 6a.5.5 0 0 0-.5.5V8h15V6.5A.5.5 0 0 0 19 6H5Z" />
    ),
    wallet: (
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h10A2.5 2.5 0 0 1 19 6.5V7h1a2 2 0 0 1 2 2v7.5A2.5 2.5 0 0 1 19.5 19h-13A2.5 2.5 0 0 1 4 16.5v-10ZM19.5 9H16a2 2 0 1 0 0 4h3.5a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5ZM6 7h11V6.5a.5.5 0 0 0-.5-.5h-10a.5.5 0 0 0-.5.5V7Zm10 4h1" />
    ),
    people: (
      <path d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7 1a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM2 20a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1H2v-1Zm15 1a4 4 0 0 0-2.15-3.54A4.96 4.96 0 0 1 20 21h-3Z" />
    ),
    clipboard: (
      <path d="M9 2a2 2 0 0 0-2 2H6.5A2.5 2.5 0 0 0 4 6.5v13A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5v-13A2.5 2.5 0 0 0 17.5 4H17a2 2 0 0 0-2-2H9Zm0 2h6v2H9V4Zm-1 6h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Zm0 4h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Z" />
    ),
    badge: (
      <path d="M12 2a5 5 0 0 1 5 5v3.17l1.7 1.7a1 1 0 0 1-.57 1.7l-1.13.18-.5.99a1 1 0 0 1-1.34.44L14 14.65l-.99.53a1 1 0 0 1-.94 0L11 14.65l-1.16.53a1 1 0 0 1-1.34-.44l-.5-.99-1.13-.18a1 1 0 0 1-.57-1.7l1.7-1.7V7a5 5 0 0 1 5-5Zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-6 14 2.2-4.3.45.89a3 3 0 0 0 4.02 1.32L12 17.6l-.67.31a3 3 0 0 1-4.02-1.32l-.45-.89L6 20Zm12 0-1.31-4.3-.45.89a3 3 0 0 1-4.02 1.32L12 17.6l.67.31a3 3 0 0 0 4.02-1.32l.45-.89L18 20Z" />
    ),
    chart: (
      <path d="M4 19h16a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1V4a1 1 0 1 1 2 0v15Zm3-2a1 1 0 0 1-1-1v-4a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1Zm5 0a1 1 0 0 1-1-1V8a1 1 0 1 1 2 0v8a1 1 0 0 1-1 1Zm5 0a1 1 0 0 1-1-1V5a1 1 0 1 1 2 0v11a1 1 0 0 1-1 1Z" />
    ),
    shield: (
      <path d="M12 2 4 5v6c0 5.25 3.44 9.74 8 11 4.56-1.26 8-5.75 8-11V5l-8-3Zm0 4 4 1.5V11a8.76 8.76 0 0 1-4 7.58A8.76 8.76 0 0 1 8 11V7.5L12 6Zm-1 4v5l4-2.5-4-2.5Z" />
    ),
    flag: (
      <path d="M5 3a1 1 0 0 1 2 0v1h8.7a1 1 0 0 1 .86 1.5L15 8l1.56 2.5A1 1 0 0 1 15.7 12H7v8a1 1 0 1 1-2 0V3Z" />
    ),
    pencil: (
      <path d="m4.75 15.9-.7 3.5a.75.75 0 0 0 .88.88l3.5-.7a2.5 2.5 0 0 0 1.24-.67l8.9-8.9a2.12 2.12 0 0 0 0-3l-1.58-1.58a2.12 2.12 0 0 0-3 0l-8.9 8.9a2.5 2.5 0 0 0-.34 1.57Zm10.3-9.4a.62.62 0 0 1 .88 0l1.58 1.58a.62.62 0 0 1 0 .88l-1.1 1.1-2.46-2.46 1.1-1.1ZM12.9 8.65l2.46 2.46-6.75 6.75a1 1 0 0 1-.5.27l-2.34.47.47-2.34a1 1 0 0 1 .27-.5l6.39-6.39Z" />
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      {icons[type]}
    </svg>
  );
}

export function Home() {
  const { user, interfaceMode, updateUser } = useAuth();
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const [isQuickActionsEditorOpen, setIsQuickActionsEditorOpen] = useState(false);
  const [isSavingQuickActions, setIsSavingQuickActions] = useState(false);
  const [selectedQuickActionIds, setSelectedQuickActionIds] = useState<string[]>([]);
  const [tournamentRegistrations, setTournamentRegistrations] = useState<TournamentRegistrationRecord[]>([]);
  const displayName = getUserDisplayName(user);
  const reservationSummary = 'Sin reservas';
  const availableActions = useMemo(
    () => QUICK_ACTION_LIBRARY.filter((action) => action.roles.includes(interfaceMode)),
    [interfaceMode],
  );
  const defaultActionIds = DEFAULT_QUICK_ACTION_IDS[interfaceMode];

  useEffect(() => {
    const roleActionIds = new Set(availableActions.map((action) => action.id));
    const validDefaultIds = defaultActionIds.filter((actionId) => roleActionIds.has(actionId));
    setSelectedQuickActionIds(
      getValidQuickActionIds(user?.quickActionIdsByRole?.[interfaceMode], roleActionIds, validDefaultIds),
    );
  }, [availableActions, defaultActionIds, interfaceMode, user?.quickActionIdsByRole]);

  useEffect(() => {
    if (!user?.id) {
      setTournamentRegistrations([]);
      return undefined;
    }

    return subscribeTournamentRegistrations({
      includeAll: false,
      userId: user.id,
      onNext: setTournamentRegistrations,
      onError: (error) => setNotice(`No pudimos cargar tus inscripciones a torneos: ${error.message}`),
    });
  }, [user?.id]);

  const visibleTournamentRegistrations = useMemo(
    () => tournamentRegistrations.slice(0, 3),
    [tournamentRegistrations],
  );

  const quickActions = useMemo(() => {
    const selectedSet = new Set(selectedQuickActionIds);
    const visibleActions = availableActions.filter((action) => selectedSet.has(action.id));
    return visibleActions.length > 0
      ? visibleActions
      : availableActions.filter((action) => defaultActionIds.includes(action.id)).slice(0, MAX_QUICK_ACTIONS);
  }, [availableActions, defaultActionIds, selectedQuickActionIds]);

  const availableActionsByCategory = useMemo(
    () =>
      QUICK_ACTION_CATEGORY_ORDER.map((category) => ({
        category,
        actions: availableActions.filter((action) => action.category === category),
      })).filter((group) => group.actions.length > 0),
    [availableActions],
  );

  const toggleQuickAction = (actionId: string) => {
    setSelectedQuickActionIds((current) => {
      if (current.includes(actionId)) {
        return current.filter((currentActionId) => currentActionId !== actionId);
      }

      if (current.length >= MAX_QUICK_ACTIONS) {
        setNotice(`Podes elegir hasta ${MAX_QUICK_ACTIONS} acciones rapidas.`);
        return current;
      }

      return [...current, actionId];
    });
  };

  const saveQuickActions = async () => {
    if (!user || !firestore) {
      setNotice('No pudimos guardar las acciones porque falta el usuario o Firestore no esta inicializado.');
      return;
    }

    const roleActionIds = new Set(availableActions.map((action) => action.id));
    const validDefaultIds = defaultActionIds.filter((actionId) => roleActionIds.has(actionId));
    const nextSelectedIds = getValidQuickActionIds(selectedQuickActionIds, roleActionIds, validDefaultIds);
    const nextQuickActionIdsByRole = {
      ...(user.quickActionIdsByRole ?? {}),
      [interfaceMode]: nextSelectedIds,
    };

    setIsSavingQuickActions(true);
    setNotice('');

    try {
      await updateDoc(doc(firestore, 'users', user.id), {
        quickActionIdsByRole: nextQuickActionIdsByRole,
        updatedAt: serverTimestamp(),
      });
      updateUser({
        ...user,
        quickActionIdsByRole: nextQuickActionIdsByRole,
      });
      setSelectedQuickActionIds(nextSelectedIds);
      setIsQuickActionsEditorOpen(false);
      setNotice('Acciones rapidas guardadas en tu usuario.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No pudimos guardar las acciones rapidas.');
    } finally {
      setIsSavingQuickActions(false);
    }
  };

  const handleRoleAction = (action: RoleAction) => {
    if (action.route) {
      navigate(action.route);
      return;
    }

    setNotice(action.notice ?? 'Esta accion queda preparada para conectar cuando exista su pantalla operativa.');
  };

  return (
    <div className="page-container home-page">
      <div className="home-dashboard">
        <section className="floating-card home-card">
          <p className="eyebrow">Bienvenido</p>
          <h1>Hola {displayName}</h1>
          <div className="reservation-status">
            <span>Reservas</span>
            <strong>{reservationSummary}</strong>
          </div>

          {visibleTournamentRegistrations.length > 0 && (
            <div className="home-tournament-summary">
              <div className="home-tournament-summary__header">
                <span>Torneos</span>
                <button
                  type="button"
                  className="ui-action-button ui-action-button--compact ui-action-button--secondary home-tournament-summary__action"
                  onClick={() => navigate('/torneos?open=registrations')}
                >
                  Ver
                </button>
              </div>
              {visibleTournamentRegistrations.map((registration) => (
                <button
                  key={registration.id}
                  type="button"
                  className="home-tournament-summary__item"
                  onClick={() => navigate('/torneos?open=registrations')}
                >
                  <span>
                    <strong>{registration.tournamentNameSnapshot}</strong>
                    <small>{formatAmountMinor(registration.amountMinor)}</small>
                  </span>
                  <span className={`status-chip home-tournament-summary__status ${getRegistrationStatusClass(registration)}`}>
                    {getRegistrationStatusLabel(registration)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {notice && <div className="accounting-success">{notice}</div>}
        </section>

        <section className="floating-card role-card">
          <div className="role-card__header">
            <div>
              <p className="eyebrow">Acciones rapidas - {getRoleLabel(interfaceMode)}</p>
            </div>
            <button
              type="button"
              className="ui-action-button ui-action-button--compact quick-actions-edit-button"
              onClick={() => setIsQuickActionsEditorOpen(true)}
            >
              <Icon type="pencil" />
              <span>Modificar</span>
            </button>
          </div>

          <div className="action-grid">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="action-tile"
                onClick={() => handleRoleAction(action)}
              >
                <span className="action-icon">
                  <Icon type={action.icon} />
                </span>
                <strong>{action.label}</strong>
                <small>{action.helper}</small>
              </button>
            ))}
          </div>
        </section>
      </div>

      {isQuickActionsEditorOpen && (
        <div className="modal-overlay quick-actions-modal-overlay" role="presentation">
          <section className="member-modal-card quick-actions-modal" role="dialog" aria-modal="true" aria-labelledby="quickActionsTitle">
            <div className="member-modal__header quick-actions-modal__header">
              <div>
                <p className="eyebrow-light">Acciones rapidas</p>
                <h2 id="quickActionsTitle">
                  Modificar acciones del rol
                </h2>
                <p className="quick-actions-modal__copy">
                  Elegi hasta {MAX_QUICK_ACTIONS} accesos. Solo se muestran acciones disponibles para tu rol actual.
                </p>
              </div>
              <button
                type="button"
                className="modal-close-button"
                aria-label="Cerrar"
                onClick={() => setIsQuickActionsEditorOpen(false)}
              >
                x
              </button>
            </div>

            <div className="quick-actions-picker">
              <div className="quick-actions-picker__header">
                <p className="eyebrow-light">Disponibles</p>
                <span className="quick-actions-counter">
                  {selectedQuickActionIds.length} / {MAX_QUICK_ACTIONS} seleccionadas
                </span>
              </div>
              {availableActionsByCategory.map((group) => (
                <div key={group.category} className="quick-actions-category">
                  <p className='eyebrow-dark'>{group.category}</p>
                  <div className="quick-actions-category__list">
                    {group.actions.map((action) => {
                      const selected = selectedQuickActionIds.includes(action.id);
                      const canAddAction = selected || selectedQuickActionIds.length < MAX_QUICK_ACTIONS;

                      return (
                        <button
                          key={action.id}
                          type="button"
                          className={`quick-action-option ${selected ? 'quick-action-option--selected' : ''} ${!canAddAction ? 'quick-action-option--disabled' : ''}`}
                          onClick={() => toggleQuickAction(action.id)}
                          disabled={!canAddAction}
                          aria-pressed={selected}
                        >
                          <span className="action-icon">
                            <Icon type={action.icon} />
                          </span>
                          <span>
                            <strong>{action.label}</strong>
                            <small>{action.helper}</small>
                          </span>
                          <span className={`quick-action-option__check ${selected ? 'quick-action-option__check--selected' : ''}`}>
                            {selected ? 'Agregado' : canAddAction ? 'Agregar' : 'Maximo'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="form-actions">
              <button type="button" className="ui-action-button ui-action-button--secondary" onClick={() => setIsQuickActionsEditorOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="ui-action-button ui-action-button--positive" disabled={isSavingQuickActions} onClick={() => void saveQuickActions()}>
                {isSavingQuickActions ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
