import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import clubLogo from '../assets/ClubLogo.png';
import { ROLE_LABELS, ROLES, type RoleType } from '../constants/roles';
import type { ThemeMode } from '../context/AuthContext';
import { useAuth } from '../hooks/useAuth';
import { createNotificationsCallables } from '../modules/notifications/functions/notifications.callables';
import { useNotifications } from '../modules/notifications/hooks/useNotifications';
import { getUserDisplayName, getUserInitial } from '../utils/user';

const DEFAULT_MODE_OPTIONS: RoleType[] = [
  ROLES.SOCIO,
  ROLES.COMISION_DIRECTIVA,
  ROLES.EMPLEADO,
  ROLES.ADMINISTRATIVO,
  ROLES.DIRECTIVO,
];
const STAFF_MODE_OPTIONS: readonly RoleType[] = [ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO];

type NavIconType = 'home' | 'club' | 'tournaments' | 'members' | 'employees' | 'accounting';

function NavIcon({ type }: { type: NavIconType }) {
  const icons: Record<NavIconType, ReactNode> = {
    home: (
      <path d="M4 11.3 12 4l8 7.3V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8.7Z" />
    ),
    club: (
      <path d="M12 2a5 5 0 0 1 3 9l3.5 9h-13L9 11a5 5 0 0 1 3-9Zm0 2a3 3 0 0 0-1.58 5.55l.72.44L9 18h6l-2.14-8.01.72-.44A3 3 0 0 0 12 4Z" />
    ),
    tournaments: (
      <path d="M7 3h10v2h3a1 1 0 0 1 1 1v2a5 5 0 0 1-5 5h-.28A5 5 0 0 1 13 15.9V19h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.1A5 5 0 0 1 8.28 13H8a5 5 0 0 1-5-5V6a1 1 0 0 1 1-1h3V3Z" />
    ),
    members: (
      <path d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7 1a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM2 20a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1H2v-1Zm15 1a4 4 0 0 0-2.15-3.54A4.96 4.96 0 0 1 20 21h-3Z" />
    ),
    employees: (
      <path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-9A2.5 2.5 0 0 1 5.5 6H7V4Zm2 2h6V4H9v2Z" />
    ),
    accounting: (
      <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4h8V5H8v2Zm0 4h2V9H8v2Zm4 0h4V9h-4v2Zm-4 4h2v-2H8v2Zm4 0h4v-2h-4v2Zm-4 4h2v-2H8v2Zm4 0h4v-2h-4v2Z" />
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon button-icon--nav">
      {icons[type]}
    </svg>
  );
}

function BellIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon margin-left-10px">
      <path d="M12 3a6 6 0 0 1 6 6v2.55c0 .72.2 1.43.58 2.05l1.1 1.84A1.5 1.5 0 0 1 18.39 18H5.61a1.5 1.5 0 0 1-1.29-2.56l1.1-1.84A3.98 3.98 0 0 0 6 11.55V9a6 6 0 0 1 6-6Zm0 19a3 3 0 0 1-2.82-2h5.64A3 3 0 0 1 12 22Z" />
    </svg>
  );
}

function MenuActionIcon({ type }: { type: 'profile' | 'logout' }) {
  const icons: Record<'profile' | 'logout', ReactNode> = {
    profile: (
      <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2c-4.14 0-7.5 2.46-7.5 5.5a1 1 0 0 0 2 0c0-1.69 2.42-3.5 5.5-3.5s5.5 1.81 5.5 3.5a1 1 0 0 0 2 0c0-3.04-3.36-5.5-7.5-5.5Z" />
    ),
    logout: (
      <path d="M5 4a2 2 0 0 1 2-2h5a1 1 0 1 1 0 2H7v16h5a1 1 0 1 1 0 2H7a2 2 0 0 1-2-2V4Zm10.3 4.3a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4l-3 3a1 1 0 1 1-1.4-1.4l1.29-1.3H11a1 1 0 1 1 0-2h5.59L15.3 9.7a1 1 0 0 1 0-1.4Z" />
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon button-icon--menu">
      {icons[type]}
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
    [ROLES.COMISION_DIRECTIVA]: (
      <path d="M12 3 4 7v6c0 4.35 3.33 7.18 8 8 4.67-.82 8-3.65 8-8V7l-8-4Zm0 2.24 6 3V13c0 3.1-2.23 5.1-6 5.97C8.23 18.1 6 16.1 6 13V8.24l6-3ZM9 11a3 3 0 1 1 6 0 3 3 0 0 1-6 0Zm-1.5 6c.68-1.77 2.36-3 4.5-3s3.82 1.23 4.5 3H7.5Z" />
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
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationsCallables = createNotificationsCallables();
  const { items: notifications, unreadCount: pendingNotifications } = useNotifications(user?.id ?? null);
  const displayName = getUserDisplayName(user);
  const normalizedMemberNumber = user?.memberNumber?.replace(/^0+/, '') || user?.memberNumber;
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

  const handleNotificationsPortalClick = () => {
    setIsUserMenuOpen(false);
    setIsNotificationsOpen(false);
    navigate('/notificaciones');
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
    navigate('/notificaciones');
  };

  const handleOpenNotification = async (deliveryId: string, route?: string | null) => {
    setIsNotificationsOpen(false);
    try {
      await notificationsCallables.markRead(deliveryId);
    } catch {
      // The portal lets the user retry if the read marker fails.
    }
    navigate(route || '/notificaciones');
  };

  return (
    <header className="app-navbar">
      <NavLink className="navbar-brand" to="/home">
        <img src={clubLogo} alt="" className="navbar-brand__logo" />
        <span>Palpala Golf Tenis Club</span>
      </NavLink>

      <div className="navbar-center">
        <nav className={`navbar-links ${isOpen ? 'navbar-links--open' : ''}`}>
          <NavLink to="/home">
            <NavIcon type="home" />
            <span>Inicio</span>
          </NavLink>
          <NavLink to="/club">
            <NavIcon type="club" />
            <span>El Club</span>
          </NavLink>
          <NavLink to="/torneos">
            <NavIcon type="tournaments" />
            <span>Torneos</span>
          </NavLink>
          {canViewMembers && (
            <NavLink to="/admin/members">
              <NavIcon type="members" />
              <span>Socios</span>
            </NavLink>
          )}
          {canAccessEmployees && (
            <NavLink to="/admin/employees">
              <NavIcon type="employees" />
              <span>Empleados</span>
            </NavLink>
          )}
          {canAccessAccounting && (
            <NavLink to="/accounting">
              <NavIcon type="accounting" />
              <span>Contabilidad</span>
            </NavLink>
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
            <span className="navbar-notification__label">Notificaciones</span>
            {pendingNotifications > 0 && <span className="notification-badge margin-right-10px">{pendingNotifications}</span>}
          </button>

          {isNotificationsOpen && (
            <div className="nav-popover nav-popover--notifications">
              <div className="nav-popover__header">
                <strong>Notificaciones</strong>
                <small>{pendingNotifications} pendientes</small>
              </div>

              <div className="notification-list">
                {notifications.length === 0 && (
                  <div className="notification-item">
                    <strong>Sin novedades</strong>
                    <p>No hay notificaciones recientes.</p>
                  </div>
                )}
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    className="notification-item notification-item--button"
                    onClick={() => void handleOpenNotification(notification.id, notification.route)}
                  >
                    <strong>{notification.titleSnapshot}</strong>
                    <p>{notification.bodySnapshot}</p>
                  </button>
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
                <small>{normalizedMemberNumber ? `Socio #${normalizedMemberNumber}` : 'Sin numero de socio'}</small>
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

              <button type="button" className="nav-menu-item" onClick={handleNotificationsPortalClick}>
                Administrar notificaciones
              </button>

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
                <MenuActionIcon type="profile" />
                <span>Mi perfil</span>
              </button>
              <button type="button" className="nav-menu-item nav-menu-item--danger" onClick={handleLogout}>
                <MenuActionIcon type="logout" />
                <span>Cerrar sesion</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
