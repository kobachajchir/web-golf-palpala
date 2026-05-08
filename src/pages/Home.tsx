import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLES, type RoleType } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import { getUserDisplayName } from '../utils/user';

type ActionIconType =
  | 'calendar'
  | 'wallet'
  | 'people'
  | 'clipboard'
  | 'badge'
  | 'chart'
  | 'shield'
  | 'flag';

type RoleAction = {
  id: string;
  label: string;
  helper: string;
  icon: ActionIconType;
};

type RoleView = {
  eyebrow: string;
  actions: RoleAction[];
};

const ROLE_VIEWS: Record<RoleType, RoleView> = {
  [ROLES.SOCIO]: {
    eyebrow: 'Tu cuenta',
    actions: [
      { id: 'profile', label: 'Mi perfil', helper: 'Datos personales', icon: 'badge' },
      { id: 'membership', label: 'Mi membresia', helper: 'Estado de socio', icon: 'wallet' },
      { id: 'courts', label: 'Solicitar cancha', helper: 'Fechas y horarios', icon: 'calendar' },
      { id: 'tournaments', label: 'Inscribirme', helper: 'Torneos del club', icon: 'flag' },
    ],
  },
  [ROLES.EMPLEADO]: {
    eyebrow: 'Acciones rapidas',
    actions: [
      { id: 'cash-income', label: 'Registrar ingresos', helper: 'Cobros y entradas', icon: 'wallet' },
      { id: 'cash-expense', label: 'Registrar egresos', helper: 'Pagos y salidas', icon: 'clipboard' },
      { id: 'report-expense', label: 'Cargar gasto', helper: 'Tickets y rendiciones', icon: 'clipboard' },
      { id: 'view-users', label: 'Ver socios', helper: 'Busqueda y consulta', icon: 'people' },
    ],
  },
  [ROLES.ADMINISTRATIVO]: {
    eyebrow: 'Gestion interna',
    actions: [
      { id: 'manage-users', label: 'Gestionar usuarios', helper: 'Altas, bajas y perfiles', icon: 'people' },
      { id: 'expense-review', label: 'Validar gastos', helper: 'Revision y aprobacion', icon: 'clipboard' },
      { id: 'cash-movements', label: 'Caja y movimientos', helper: 'Ingresos y egresos', icon: 'chart' },
      { id: 'fees-admin', label: 'Cobros y cuotas', helper: 'Generacion y seguimiento', icon: 'wallet' },
    ],
  },
  [ROLES.DIRECTIVO]: {
    eyebrow: 'Acciones rápidas',
    actions: [
      { id: 'cash-flow', label: 'Flujo de caja', helper: 'Entradas y salidas', icon: 'chart' },
      { id: 'approvals', label: 'Aprobar gastos', helper: 'Control de egresos', icon: 'clipboard' },
      { id: 'monthly-reports', label: 'Reportes mensuales', helper: 'Balance y resumen', icon: 'flag' },
      { id: 'budget-followup', label: 'Seguimiento presupuestario', helper: 'Desvios y decisiones', icon: 'shield' },
    ],
  },
};

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
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      {icons[type]}
    </svg>
  );
}

export function Home() {
  const { user, interfaceMode } = useAuth();
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const displayName = getUserDisplayName(user);
  const roleView = ROLE_VIEWS[interfaceMode];
  const reservationSummary = 'Sin reservas';

  const handleRoleAction = (action: RoleAction) => {
    if (
      action.id === 'manage-users' &&
      (user?.roleIds.includes(ROLES.ADMINISTRATIVO) || user?.roleIds.includes(ROLES.DIRECTIVO))
    ) {
      navigate('/admin/members');
      return;
    }

    if (
      [
        'expense-review',
        'cash-movements',
        'fees-admin',
        'cash-flow',
        'approvals',
        'monthly-reports',
        'budget-followup',
      ].includes(action.id)
    ) {
      navigate('/accounting');
      return;
    }

    if (action.id === 'profile') {
      navigate('/perfil');
      return;
    }

    if (action.id === 'membership') {
      navigate('/mi-membresia');
      return;
    }

    if (action.id === 'view-users') {
      navigate('/admin/members');
      return;
    }

    if (action.id === 'cash-income' || action.id === 'cash-expense' || action.id === 'report-expense') {
      setNotice('Esta accion operativa queda preparada para conectar desde el modulo contable.');
      return;
    }

    if (action.id === 'courts') {
      navigate('/canchas');
      return;
    }

    if (action.id === 'tournaments') {
      setNotice('No hay torneos abiertos.');
      return;
    }

    console.log('Accion por rol pendiente de conectar', {
      role: interfaceMode,
      action_id: action.id,
      user_id: user?.id,
    });
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

          {notice && <div className="accounting-success">{notice}</div>}
        </section>

        <section className="floating-card role-card">
          <div className="role-card__header">
            <div>
              <p className="eyebrow">{roleView.eyebrow}</p>
            </div>
          </div>

          <div className="action-grid">
            {roleView.actions.map((action) => (
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
    </div>
  );
}
