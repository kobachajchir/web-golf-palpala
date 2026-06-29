import type { ChangeEvent, FormEventHandler, ReactNode, Ref } from 'react';

export type SearchFiltersPanelOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SearchFiltersPanelField = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'search' | 'text' | 'date' | 'select';
  options?: SearchFiltersPanelOption[];
  placeholder?: string;
  disabled?: boolean;
  hidden?: boolean;
  className?: string;
  inputMode?: 'text' | 'search' | 'email' | 'tel' | 'url' | 'none' | 'numeric' | 'decimal';
};

type SearchFiltersPanelProps = {
  title: string;
  helper: string;
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  chevron: ReactNode;
  activeCount?: number;
  className?: string;
  bodyClassName?: string;
  toolbarClassName?: string;
  rowClassName?: string;
  panelRef?: Ref<HTMLDivElement>;
  fields?: SearchFiltersPanelField[];
  secondaryFields?: SearchFiltersPanelField[];
  secondaryRowClassName?: string;
  actions?: ReactNode;
  children?: ReactNode;
  as?: 'div' | 'form';
  onSubmit?: FormEventHandler<HTMLFormElement>;
};

function formatCriteriaCount(count: number): string {
  return `${count} criterio${count === 1 ? '' : 's'} activo${count === 1 ? '' : 's'}`;
}

function getFieldClassName(field: SearchFiltersPanelField): string {
  if (field.className) {
    return field.className;
  }

  return field.type === 'search' ? 'member-search member-search--wide' : 'form-field member-filter';
}

function renderField(field: SearchFiltersPanelField) {
  const type = field.type ?? 'text';
  const commonProps = {
    id: field.id,
    value: field.value,
    disabled: field.disabled,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => field.onChange(event.target.value),
  };

  return (
    <label key={field.id ?? field.label} className={getFieldClassName(field)} htmlFor={field.id}>
      <span>{field.label}</span>
      {type === 'select' ? (
        <select {...commonProps}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...commonProps}
          type={type}
          inputMode={field.inputMode}
          placeholder={field.placeholder}
        />
      )}
    </label>
  );
}

export function SearchFiltersPanel({
  title,
  helper,
  open,
  onToggle,
  icon,
  chevron,
  activeCount = 0,
  className,
  bodyClassName,
  toolbarClassName,
  rowClassName,
  panelRef,
  fields = [],
  secondaryFields = [],
  secondaryRowClassName,
  actions,
  children,
  as = 'div',
  onSubmit,
}: SearchFiltersPanelProps) {
  const visibleFields = fields.filter((field) => !field.hidden);
  const visibleSecondaryFields = secondaryFields.filter((field) => !field.hidden);
  const collapseClassName = ['search-collapse', open ? 'search-collapse--open' : '', className].filter(Boolean).join(' ');
  const summary = activeCount > 0 ? formatCriteriaCount(activeCount) : helper;
  const bodyClass = ['search-collapse__body', bodyClassName].filter(Boolean).join(' ');
  const bodyContent = children ?? (
    <div className={['member-toolbar', toolbarClassName].filter(Boolean).join(' ')}>
      <div className={['member-toolbar__row', rowClassName].filter(Boolean).join(' ')}>
        {visibleFields.map(renderField)}
        {actions}
      </div>
      {visibleSecondaryFields.length > 0 && (
        <div className={secondaryRowClassName ?? 'notifications-filter-row'}>
          {visibleSecondaryFields.map(renderField)}
        </div>
      )}
    </div>
  );

  return (
    <div className={collapseClassName} ref={panelRef}>
      <button
        type="button"
        className="search-collapse__trigger"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="search-collapse__title">
          <span className="search-collapse__icon" aria-hidden="true">
            {icon}
          </span>
          <span>
            <strong>{title}</strong>
            <small>{summary}</small>
          </span>
        </span>
        <span className="search-collapse__meta">
          {activeCount > 0 && <span className="status-chip">{activeCount}</span>}
          <span className="search-collapse__chevron" aria-hidden="true">
            {chevron}
          </span>
        </span>
      </button>

      {open && (
        as === 'form' ? (
          <form className={bodyClass} onSubmit={onSubmit}>
            {bodyContent}
          </form>
        ) : (
          <div className={bodyClass}>
            {bodyContent}
          </div>
        )
      )}
    </div>
  );
}
