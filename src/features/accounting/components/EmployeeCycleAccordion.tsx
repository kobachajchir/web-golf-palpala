import type { ReactNode } from 'react';
import { UiActionButton } from '../../../components/UiActionButton';
import type { EmployeeCycleSection } from '../types/employeeAccounting';

const SECTION_LABELS: Record<EmployeeCycleSection, string> = {
  summary: 'Resumen',
  overtime: 'Horas extra',
  certificates: 'Certificados',
  'external-docs': 'Comprobantes externos',
  expenses: 'Gastos',
  settlement: 'Liquidacion',
  payment: 'Pago',
};

export function EmployeeCycleAccordion({
  section,
  expandedSection,
  onExpand,
  children,
  helper,
}: {
  section: EmployeeCycleSection;
  expandedSection: EmployeeCycleSection;
  onExpand: (section: EmployeeCycleSection) => void;
  helper: string;
  children: ReactNode;
}) {
  const open = section === expandedSection;

  return (
    <article className={`accounting-collapsible-section ${open ? 'accounting-collapsible-section--open' : ''}`}>
      <UiActionButton
        type="button"
        variant={open ? 'positive' : 'secondary'}
        className="accounting-collapsible-trigger"
        aria-expanded={open}
        icon={
          <svg className={`accounting-chevron-icon ${open ? 'accounting-chevron-icon--open' : ''}`} viewBox="0 0 24 24" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        }
        iconPosition="right"
        onClick={() => onExpand(section)}
      >
        <span className="accounting-collapsible-trigger__copy">
          <strong>{SECTION_LABELS[section]}</strong>
          <small>{helper}</small>
        </span>
      </UiActionButton>
      {open && (
        <div className="floating-card accounting-collapsible-card">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Ciclo mensual</p>
              <h2>{SECTION_LABELS[section]}</h2>
            </div>
          </div>
          {children}
        </div>
      )}
    </article>
  );
}
