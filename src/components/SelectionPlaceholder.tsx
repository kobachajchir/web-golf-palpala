export function SelectionPlaceholder({ title, children }: { title: string; children?: import('react').ReactNode }) {
  return <div className="selection-placeholder" role="status">
    <svg aria-hidden="true" viewBox="0 0 48 48" fill="none"><path d="M13 6h15l9 9v25H13zM28 6v10h9M19 24h12M19 30h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="36" r="8" fill="var(--field-bg, white)" stroke="currentColor" strokeWidth="2"/><path d="M9 36h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
    <h3>{title}</h3>{children && <p>{children}</p>}
  </div>;
}
