import { accountingErrorMessage } from '../utils/accountingErrors';
import type { AccountingNotice } from '../types/accounting';

export function AccountingInlineNotice({ notice }: { notice: AccountingNotice }) {
  if (!notice) {
    return null;
  }

  const className = notice.kind === 'error' ? 'error-message' : notice.kind === 'success' ? 'accounting-success' : 'profile-note';
  return (
    <div className={className} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}>
      {notice.kind === 'error' ? accountingErrorMessage({ message: notice.message }) : notice.message}
    </div>
  );
}
