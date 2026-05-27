import { useState, type ReactNode } from 'react';
import { UiActionButton } from '../../../components/UiActionButton';

export type AccountingCollapsibleSection = {
  id: string;
  title: string;
  eyebrow?: string;
  helper?: string;
  content: ReactNode;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`accounting-chevron-icon ${open ? 'accounting-chevron-icon--open' : ''}`} viewBox="0 0 24 24" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function AccountingCollapsibleSections({
  sections,
  initialOpenId,
  openId,
  onOpenChange,
}: {
  sections: AccountingCollapsibleSection[];
  initialOpenId?: string;
  openId?: string | null;
  onOpenChange?: (sectionId: string | null) => void;
}) {
  const [internalOpenId, setInternalOpenId] = useState(initialOpenId ?? sections[0]?.id ?? '');
  const activeId = openId === undefined ? internalOpenId : openId;

  const setActive = (sectionId: string) => {
    const nextId = activeId === sectionId ? '' : sectionId;
    if (openId === undefined) {
      setInternalOpenId(nextId);
    }
    onOpenChange?.(nextId || null);
  };

  return (
    <div className="accounting-collapse-stack">
      {sections.map((section) => {
        const isOpen = section.id === activeId;
        return (
          <section key={section.id} className={`accounting-collapsible-section ${isOpen ? 'accounting-collapsible-section--open' : ''}`}>
            <UiActionButton
              type="button"
              variant={isOpen ? 'positive' : 'secondary'}
              className="accounting-collapsible-trigger"
              aria-expanded={isOpen}
              aria-controls={`accounting-section-${section.id}`}
              icon={<ChevronIcon open={isOpen} />}
              iconPosition="right"
              onClick={() => setActive(section.id)}
            >
              <span className="accounting-collapsible-trigger__copy">
                <strong>{section.title}</strong>
                {section.helper && <small>{section.helper}</small>}
              </span>
            </UiActionButton>
            {isOpen && (
              <div id={`accounting-section-${section.id}`} className="floating-card accounting-collapsible-card">
                <div className="accounting-section-header">
                  <div>
                    {section.eyebrow && <p className="eyebrow">{section.eyebrow}</p>}
                    <h2>{section.title}</h2>
                  </div>
                </div>
                {section.content}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
