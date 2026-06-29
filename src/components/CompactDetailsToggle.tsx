import { useState, type ReactNode } from 'react';

function SmallChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`button-icon compact-details-toggle__icon ${open ? 'compact-details-toggle__icon--open' : ''}`} viewBox="0 0 24 24" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function CompactDetailsToggle({
  label = 'Mas detalles',
  children,
  defaultOpen = false,
}: {
  label?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="compact-details-toggle">
      <button
        type="button"
        className="compact-details-toggle__button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <SmallChevronIcon open={open} />
      </button>
      {open && <div className="compact-details-toggle__content">{children}</div>}
    </div>
  );
}
