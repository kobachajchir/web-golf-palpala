import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { ROLE_LABELS, ROLES, type RoleType } from '../constants/roles';
import type { ThemeMode } from '../context/AuthContext';
import { useAuth } from '../hooks/useAuth';
import { firestore } from '../lib/firebase';
import type { PasswordResetRequestDocument } from '../modules/users/domain/models';
import { getUserDisplayName, getUserInitial } from '../utils/user';

const DEFAULT_MODE_OPTIONS: RoleType[] = [ROLES.SOCIO, ROLES.EMPLEADO, ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO];
const STAFF_MODE_OPTIONS: readonly RoleType[] = [ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO];

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
};

function BellIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M12 3a6 6 0 0 1 6 6v2.55c0 .72.2 1.43.58 2.05l1.1 1.84A1.5 1.5 0 0 1 18.39 18H5.61a1.5 1.5 0 0 1-1.29-2.56l1.1-1.84A3.98 3.98 0 0 0 6 11.55V9a6 6 0 0 1 6-6Zm0 19a3 3 0 0 1-2.82-2h5.64A3 3 0 0 1 12 22Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon button-icon--chevron">
      <path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.17l3.9-3.88a1 1 0 1 1 1.4 1.42l-4.6 4.58a1 1 0 0 1-1.4 0L6.7 10.7a1 1 0 0 1 0-1.42Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5Zm0-5a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 16a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0v-2a1 1 0 0 1 1-1Zm10-7a1 1 0 1 1 0 2h-2a1 1 0 1 1 0-2h2ZM5 12a1 1 0 0 1-1 1H2a1 1 0 1 1 0-2h2a1 1 0 0 1 1 1Zm12.95-6.54a1 1 0 0 1 1.41 1.41l-1.42 1.42a1 1 0 1 1-1.41-1.41l1.42-1.42ZM7.47 16.95a1 1 0 0 1 0 1.41l-1.42 1.42a1 1 0 0 1-1.41-1.41l1.42-1.42a1 1 0 0 1 1.41 0Zm11.89 2.83a1 1 0 0 1-1.41 0l-1.42-1.42a1 1 0 1 1 1.41-1.41l1.42 1.42a1 1 0 0 1 0 1.41ZM7.47 7.05a1 1 0 0 1-1.41 1.41L4.64 7.05a1 1 0 0 1 1.41-1.41l1.42 1.41Z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M14.53 3.12a1 1 0 0 1 .8 1.6A7.5 7.5 0 1 0 19.28 16a1 1 0 0 1 1.53 1.1A9.5 9.5 0 1 1 13 2.18a1 1 0 0 1 1.53.94Z" />
    </svg>
  );
}

function ModeIcon({ mode }: { mode: RoleType }) {
  const icons: Record<RoleType, ReactNode> = {
    [ROLES.SOCIO]: (
      <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2c-4.14 0-7.5 2.46-7.5 5.5a1 1 0 0 0 2 0c0-1.69 2.42-3.5 5.5-3.5s5.5 1.81 5.5 3.5a1 1 0 0 0 2 0c0-3.04-3.36-5.5-7.5-5.5Z" />
    ),
    [ROLES.EMPLEADO]: (
      <path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-9A2.5 2.5 0 0 1 5.5 6H7V4Zm2 2h6V4H9v2Zm2 4v2H9a1 1 0 0 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2v-2a1 1 0 1 0-2 0Z" />
    ),
    [ROLES.ADMINISTRATIVO]: (
      <path d="M12 2 4 5v6c0 5.25 3.44 9.74 8 11 4.56-1.26 8-5.75 8-11V5l-8-3Zm0 4 4 1.5V11a8.76 8.76 0 0 1-4 7.58A8.76 8.76 0 0 1 8 11V7.5L12 6Z" />
    ),
    [ROLES.DIRECTIVO]: (
      <path d="M5 18h14a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2Zm.83-3.45 1.57-8.62a1 1 0 0 1 1.53-.64L12 7.2l3.07-1.91a1 1 0 0 1 1.53.64l1.57 8.62a1 1 0 0 1-1.64.92L12 11.94l-4.53 3.53a1 1 0 0 1-1.64-.92Z" />
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon button-icon--mode">
      {icons[mode]}
    </svg>
  );
}

export function Navbar() {
  const {
    user,
    logout,
    interfaceMode,
    setInterfaceMode,
    themeMode,
    setThemeMode,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [passwordResetNotifications, setPasswordResetNotifications] = useState<NotificationItem[]>([]);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const notificationsByMode: Record<RoleType, NotificationItem[]> = useMemo(
    () => ({
      [ROLES.SOCIO]: [
        { id: 'n1', title: 'Comprobante disponible', detail: 'Ya podes revisar el ultimo recibo emitido.' },
        { id: 'n2', title: 'Cuota proxima a vencer', detail: 'Tu cuota vence en 3 dias.' },
      ],
      [ROLES.EMPLEADO]: [
        { id: 'n1', title: 'Ingreso por registrar', detail: 'Hay 2 cobros pendientes de carga.' },
        { id: 'n2', title: 'Caja pendiente', detail: 'Se registro un movimiento sin medio de pago.' },
        { id: 'n3', title: 'Egreso en espera', detail: 'Hay un pago manual pendiente de confirmacion.' },
        { id: 'n4', title: 'Gasto cargado', detail: 'Hay un ticket pendiente de revision.' },
      ],
      [ROLES.ADMINISTRATIVO]: [
        { id: 'n1', title: 'Gastos por aprobar', detail: 'Hay 4 gastos pendientes de validacion.' },
        { id: 'n2', title: 'Cobros conciliados', detail: 'Se acreditaron 3 pagos durante la manana.' },
        { id: 'n3', title: 'Auditoria disponible', detail: 'Se registraron cambios en caja y movimientos.' },
      ],
      [ROLES.DIRECTIVO]: [
        { id: 'n1', title: 'Cierre financiero listo', detail: 'La Junta Directiva ya puede revisar el resumen del dia.' },
      ],
    }),
    [],
  );

  useEffect(() => {
    if (!STAFF_MODE_OPTIONS.includes(interfaceMode) || !firestore) {
      setPasswordResetNotifications([]);
      return;
    }

    let mounted = true;

    void getDocs(
      query(
        collection(firestore, 'password_reset_requests'),
        where('status', '==', 'pending'),
        limit(5),
      ),
    )
      .then((snapshot) => {
        if (!mounted) {
          return;
        }

        setPasswordResetNotifications(
          snapshot.docs.map((entry) => {
            const request = entry.data() as PasswordResetRequestDocument;
            return {
              id: `password-reset-${entry.id}`,
              title: 'Solicitud de contraseña',
              detail: `${request.displayName ?? `Socio ${request.memberNumber}`} pidió restablecer su contraseña.`,
            };
          }),
        );
      })
      .catch(() => {
        if (mounted) {
          setPasswordResetNotifications([]);
        }
      });

    return () => {
      mounted = false;
    };
  }, [interfaceMode]);

  const notifications = [...passwordResetNotifications, ...notificationsByMode[interfaceMode]];
  const pendingNotifications = notifications.length;
  const displayName = getUserDisplayName(user);
  const modeOptions = user?.roleIds.length ? user.roleIds : DEFAULT_MODE_OPTIONS;
  const hasRoleSelector = Boolean(user && user.roleIds.length > 1);
  const canManageMembers = STAFF_MODE_OPTIONS.includes(interfaceMode);
  const canViewMembers = canManageMembers || interfaceMode === ROLES.EMPLEADO;
  const canAccessAccounting = STAFF_MODE_OPTIONS.includes(interfaceMode);
  const canAccessEmployees = STAFF_MODE_OPTIONS.includes(interfaceMode);

  useEffect(() => {
    setIsOpen(false);
    setIsNotificationsOpen(false);
    setIsUserMenuOpen(false);
    setIsModeMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isUserMenuOpen) {
      setIsModeMenuOpen(false);
    }
  }, [isUserMenuOpen]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (notificationsRef.current && !notificationsRef.current.contains(target)) {
        setIsNotificationsOpen(false);
      }

      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setIsUserMenuOpen(false);
        setIsModeMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  const handleProfileClick = () => {
    setIsUserMenuOpen(false);
    navigate('/perfil');
  };

  const handleLogout = () => {
    setIsUserMenuOpen(false);
    setIsNotificationsOpen(false);
    void logout().then(() => navigate('/login', { replace: true }));
  };

  const handleModeChange = (mode: RoleType) => {
    setInterfaceMode(mode);
    setIsModeMenuOpen(false);
    setIsUserMenuOpen(false);
    navigate('/home', { replace: true });
  };

  const handleThemeToggle = () => {
    const nextThemeMode: ThemeMode = themeMode === 'light' ? 'dark' : 'light';
    setThemeMode(nextThemeMode);
  };

  const handleNotificationsToggle = () => {
    setIsUserMenuOpen(false);
    setIsNotificationsOpen((current) => !current);
  };

  const handleUserMenuToggle = () => {
    setIsNotificationsOpen(false);
    setIsUserMenuOpen((current) => !current);
  };

  const handleModeMenuToggle = () => {
    setIsModeMenuOpen((current) => !current);
  };

  const handleViewAllNotifications = () => {
    setIsNotificationsOpen(false);
    if (passwordResetNotifications.length > 0) {
      navigate('/admin/members');
    }
  };

  return (
    <header className="app-navbar">
      <NavLink className="navbar-brand" to="/home">
        Golf Palpala
      </NavLink>

      <div className="navbar-center">
        <nav className={`navbar-links ${isOpen ? 'navbar-links--open' : ''}`}>
          <NavLink to="/home">Inicio</NavLink>
          <NavLink to="/club">El Club</NavLink>
          <NavLink to="/torneos">Torneos</NavLink>
          {canViewMembers && <NavLink to="/admin/members">Socios</NavLink>}
          {canAccessEmployees && <NavLink to="/admin/employees">Empleados</NavLink>}
          {canAccessAccounting && (
            <NavLink to="/accounting">Contabilidad</NavLink>
          )}
        </nav>
      </div>

      <button
        className="navbar-toggle"
        type="button"
        aria-label="Abrir navegacion"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span />
        <span />
        <span />
      </button>

      <div className="navbar-user-tools">
        <div className="navbar-dropdown" ref={notificationsRef}>
          <button
            className="navbar-notification"
            type="button"
            aria-label={`Abrir notificaciones${pendingNotifications > 0 ? `, ${pendingNotifications} pendientes` : ''}`}
            aria-expanded={isNotificationsOpen}
            onClick={handleNotificationsToggle}
          >
            <BellIcon />
            {pendingNotifications > 0 && <span className="notification-badge">{pendingNotifications}</span>}
          </button>

          {isNotificationsOpen && (
            <div className="nav-popover nav-popover--notifications">
              <div className="nav-popover__header">
                <strong>Notificaciones</strong>
                <small>{pendingNotifications} pendientes</small>
              </div>

              <div className="notification-list">
                {notifications.map((notification) => (
                  <div key={notification.id} className="notification-item">
                    <strong>{notification.title}</strong>
                    <p>{notification.detail}</p>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="btn-secondary nav-popover__button"
                onClick={handleViewAllNotifications}
              >
                Ver todas
              </button>
            </div>
          )}
        </div>

        <div className="navbar-dropdown navbar-dropdown--user" ref={userMenuRef}>
          <button
            className="navbar-profile"
            type="button"
            aria-label={`Abrir menu de ${displayName}`}
            aria-expanded={isUserMenuOpen}
            onClick={handleUserMenuToggle}
          >
            <span className="navbar-avatar">{getUserInitial(user)}</span>
            <span className="navbar-user">
              <strong>{displayName}</strong>
              <small>{ROLE_LABELS[interfaceMode]}</small>
            </span>
            <ChevronIcon />
          </button>

          {isUserMenuOpen && (
            <div className="nav-popover nav-popover--user">
              <div className="nav-user-summary">
                <strong>{displayName}</strong>
                <small>{user ? `Socio ${user.memberNumber ?? user.id}` : 'Sin usuario'}</small>
              </div>

              {hasRoleSelector && (
                <div className="nav-settings-row">
                  <div className="nav-settings-copy">
                    <strong>Modo de vista</strong>
                    <small>{ROLE_LABELS[interfaceMode]}</small>
                  </div>

                  <div className="nav-inline-picker">
                    <button
                      type="button"
                      className={`nav-inline-picker__trigger ${isModeMenuOpen ? 'nav-inline-picker__trigger--open' : ''}`}
                      aria-label="Cambiar modo de vista"
                      aria-expanded={isModeMenuOpen}
                      onClick={handleModeMenuToggle}
                    >
                      <span className="nav-inline-picker__value">
                        <ModeIcon mode={interfaceMode} />
                        <span>{ROLE_LABELS[interfaceMode]}</span>
                      </span>
                      <ChevronIcon />
                    </button>

                    {isModeMenuOpen && (
                      <div className="nav-inline-picker__menu" role="menu" aria-label="Opciones de modo de vista">
                        {modeOptions.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            role="menuitemradio"
                            aria-checked={interfaceMode === mode}
                            className={`nav-inline-picker__item ${interfaceMode === mode ? 'nav-inline-picker__item--active' : ''}`}
                            onClick={() => handleModeChange(mode)}
                          >
                            <span className="nav-inline-picker__value">
                              <ModeIcon mode={mode} />
                              <span>{ROLE_LABELS[mode]}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="nav-settings-row">
                <div className="nav-settings-copy">
                  <strong>Tema global</strong>
                  <small>{themeMode === 'dark' ? 'Oscuro' : 'Claro'}</small>
                </div>

                <button
                  type="button"
                  className={`theme-toggle ${themeMode === 'dark' ? 'theme-toggle--dark' : ''}`}
                  aria-label="Cambiar tema"
                  onClick={handleThemeToggle}
                >
                  <span className="theme-toggle__thumb">
                    {themeMode === 'dark' ? <MoonIcon /> : <SunIcon />}
                  </span>
                </button>
              </div>

              <div className="nav-divider" />

              <button type="button" className="nav-menu-item" onClick={handleProfileClick}>
                Ver perfil
              </button>
              <button type="button" className="nav-menu-item nav-menu-item--danger" onClick={handleLogout}>
                Cerrar sesion
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
