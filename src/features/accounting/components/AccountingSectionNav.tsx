import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import type { AccountingSectionId } from '../types/accounting';

export const ACCOUNTING_NAV_ITEMS: Array<{
  id: AccountingSectionId;
  label: string;
  helper: string;
  to: string;
  icon: string;
}> = [
  { id: 'overview', label: 'Inicio', helper: 'KPIs, alertas y pendientes', to: '/accounting/overview', icon: 'home' },
  { id: 'member-dues', label: 'Cuotas societarias', helper: 'Generacion, renovaciones y valores', to: '/accounting/member-dues', icon: 'dues' },
  { id: 'collections', label: 'Cobros', helper: 'Socios, deuda, pagos y recibos', to: '/accounting/collections', icon: 'collections' },
  { id: 'expenses', label: 'Egresos / Pagos', helper: 'Gastos, rendiciones y movimientos', to: '/accounting/expenses', icon: 'expenses' },
  { id: 'employees', label: 'Empleados y sueldos', helper: 'Ciclos mensuales y liquidacion', to: '/accounting/employees', icon: 'employees' },
  { id: 'external-docs', label: 'Comprobantes externos', helper: 'F931, ART, obra social y asignaciones', to: '/accounting/external-docs', icon: 'docs' },
  { id: 'payment-methods', label: 'Medios de pago', helper: 'Activos, bancarizados y comisiones', to: '/accounting/payment-methods', icon: 'cards' },
  { id: 'bank-settlements', label: 'Liquidaciones bancarias', helper: 'Mercado Pago, Macro y diferencias', to: '/accounting/bank-settlements', icon: 'bank' },
  { id: 'cash-closures', label: 'Cierre de caja', helper: 'Apertura, arqueo y conciliacion diaria', to: '/accounting/cash-closures', icon: 'cash' },
  { id: 'reports', label: 'Reportes', helper: 'Filtros, historial y auditoria', to: '/accounting/reports', icon: 'reports' },
];

function AccountingSectionIcon({ icon }: { icon: string }) {
  const commonProps = {
    className: 'accounting-section-icon',
    viewBox: '0 0 24 24',
    'aria-hidden': true,
  } as const;

  switch (icon) {
    case 'home':
      return <svg {...commonProps}><path d="M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z" /></svg>;
    case 'dues':
      return <svg {...commonProps}><path d="M6 4h12v16H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
    case 'collections':
      return <svg {...commonProps}><path d="M4 7h16v10H4z" /><path d="M7 10h5M15 14h2" /></svg>;
    case 'expenses':
      return <svg {...commonProps}><path d="M6 5h12v14H6z" /><path d="M9 9h6M9 13h5M12 17v-4" /></svg>;
    case 'employees':
      return <svg {...commonProps}><path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 19a5 5 0 0 1 10 0" /><path d="M17 9v8M13 13h8" /></svg>;
    case 'docs':
      return <svg {...commonProps}><path d="M7 4h7l3 3v13H7z" /><path d="M14 4v4h4M9 12h6M9 16h5" /></svg>;
    case 'cards':
      return <svg {...commonProps}><path d="M4 7h16v10H4z" /><path d="M4 10h16M7 14h4" /></svg>;
    case 'bank':
      return <svg {...commonProps}><path d="M4 9h16L12 4zM6 10v7M10 10v7M14 10v7M18 10v7M4 19h16" /></svg>;
    case 'cash':
      return <svg {...commonProps}><path d="M5 7h14v10H5z" /><path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" /></svg>;
    case 'reports':
      return <svg {...commonProps}><path d="M6 4h12v16H6z" /><path d="M9 16V9M12 16v-4M15 16V7" /></svg>;
    default:
      return <svg {...commonProps}><path d="M5 5h14v14H5z" /><path d="M9 9h6M9 13h6" /></svg>;
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`accounting-chevron-icon ${open ? 'accounting-chevron-icon--open' : ''}`}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function AccountingSectionNav() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const activeItem = useMemo(
    () => ACCOUNTING_NAV_ITEMS.find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)) ?? ACCOUNTING_NAV_ITEMS[0]!,
    [location.pathname],
  );

  return (
    <nav className="accounting-module-nav" aria-label="Navegacion contable" style={{display: "flex", flexDirection: "column", gap: "1rem"}}>
      <div className="accounting-operations-bar">
        <div className="accounting-module-nav__title">
          <span className="eyebrow">ACCOUNTING</span>
          <strong>{activeItem.label}</strong>
          <small>{activeItem.helper}</small>
        </div>
        <UiActionButton
          type="button"
          aria-expanded={open}
          aria-controls="accounting-operations-panel"
          onClick={() => setOpen((current) => !current)}
          icon={<ChevronIcon open={open} />}
          iconPosition="right"
        >
          Secciones
        </UiActionButton>
      </div>
      {open && (
        <section id="accounting-operations-panel" className="floating-card accounting-operations-panel">
          <div className="accounting-section-header accounting-operations-panel__header">
            <div>
              <p className="eyebrow">Operaciones</p>
              <h2>Elegir seccion</h2>
            </div>
            <UiActionButton
              type="button"
              variant="secondary"
              compact
              className="accounting-chevron-button"
              aria-label="Cerrar secciones"
              onClick={() => setOpen(false)}
              icon={<ChevronIcon open />}
            >
              Cerrar secciones
            </UiActionButton>
          </div>
          <div className="accounting-operations-grid">
            {ACCOUNTING_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.id}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `accounting-module-nav__item ${isActive || location.pathname === item.to ? 'accounting-module-nav__item--active' : ''}`
                }
              >
                <AccountingSectionIcon icon={item.icon} />
                <span>{item.label}</span>
                <small>{item.helper}</small>
              </NavLink>
            ))}
          </div>
        </section>
      )}
    </nav>
  );
}
