import type { ReactNode } from 'react';

export type DescriptionListItem = {
  label: string;
  value: ReactNode;
  hidden?: boolean;
};

export function DescriptionList({
  items,
  className,
}: {
  items: DescriptionListItem[];
  className?: string;
}) {
  const visibleItems = items.filter((item) => !item.hidden);

  return (
    <dl className={['description-list', className].filter(Boolean).join(' ')}>
      {visibleItems.map((item) => (
        <div key={item.label} className="description-list__item">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
