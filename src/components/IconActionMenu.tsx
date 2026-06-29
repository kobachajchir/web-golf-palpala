import type { ReactNode } from 'react';

export type IconActionMenuItem = {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function IconActionMenu({
  label,
  icon,
  open,
  active,
  items,
  onToggle,
}: {
  label: string;
  icon: ReactNode;
  open: boolean;
  active?: boolean;
  items: IconActionMenuItem[];
  onToggle: () => void;
}) {
  return (
    <div className="member-actions">
      <button
        type="button"
        className={`icon-button member-icon-button ${active || open ? 'icon-button--active' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        {icon}
      </button>
      {open && (
        <div className="member-actions-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.danger ? 'member-actions-menu__item member-actions-menu__item--danger' : 'member-actions-menu__item'}
              role="menuitem"
              disabled={item.disabled}
              onClick={item.onSelect}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
