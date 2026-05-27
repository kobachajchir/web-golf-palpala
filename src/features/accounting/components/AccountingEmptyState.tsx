import type { ReactNode } from 'react';

export function AccountingEmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state empty-state--inline accounting-empty-state">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
