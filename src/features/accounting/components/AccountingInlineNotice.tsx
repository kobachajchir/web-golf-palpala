import type { AccountingNotice } from '../types/accounting';

export function AccountingInlineNotice({ notice }: { notice: AccountingNotice }) {
  if (!notice) {
    return null;
  }

  const className = notice.kind === 'error' ? 'error-message' : notice.kind === 'success' ? 'accounting-success' : 'profile-note';
  return (
    <div className={className} role={notice.kind === 'error' ? 'alert' : 'status'}>
      {notice.message}
    </div>
  );
}
