import type { EntityWithId, MemberDocument } from '../../../modules/users/domain/models';
import type { OpenItem } from '../types/payment';
import { formatCurrency, formatTimestamp, getPersonDisplayName } from '../utils/accountingFormatters';

function formatPendingItemsLabel(openItems: OpenItem[]) {
  const feeCount = openItems.filter((item) => item.kind === 'member_fee_charge').length;
  const otherCount = openItems.length - feeCount;
  const labels: string[] = [];

  if (feeCount > 0) {
    labels.push(`${feeCount} cuota${feeCount === 1 ? '' : 's'} pendiente${feeCount === 1 ? '' : 's'}`);
  }
  if (otherCount > 0) {
    labels.push(`${otherCount} concepto${otherCount === 1 ? '' : 's'}`);
  }

  return labels.length > 0 ? labels.join(' + ') : 'Sin deuda abierta';
}

export function MemberAccountSnapshot({
  member,
  openItems,
}: {
  member: EntityWithId<MemberDocument> | null;
  openItems: OpenItem[];
}) {
  const debtMinor = openItems.reduce((total, item) => total + item.amountMinor, 0);
  const isBlocked = member?.status === 'inactive' || member?.status === 'suspended';

  return (
    <section className="floating-card accounting-panel">
      <div className="accounting-section-header">
        <div>
          <p className="eyebrow">Cuenta del socio</p>
          <h2>{member ? getPersonDisplayName(member) : 'Sin socio seleccionado'}</h2>
        </div>
        {member && <span className={`status-chip status-chip--${member.status}`}>{member.status}</span>}
      </div>
      <div className="summary-grid accounting-summary-grid">
        <article className="summary-card">
          <span>Deuda abierta</span>
          <strong>{formatCurrency(debtMinor)}</strong>
          <small>{formatPendingItemsLabel(openItems)}</small>
        </article>
        <article className="summary-card">
          <span>Ultimo pago</span>
          <strong>{formatTimestamp(member?.lastFeePaymentAt)}</strong>
          <small>Cuota societaria</small>
        </article>
        <article className="summary-card">
          <span>Renovacion</span>
          <strong>{member?.membershipRenewalStatus ?? 'Sin dato'}</strong>
          <small>{formatTimestamp(member?.membershipRenewalDueAt)}</small>
        </article>
      </div>
      {isBlocked && (
        <div className="error-message">
          El socio esta suspendido o dado de baja. La UI bloquea el submit y el backend mantiene la validacion definitiva.
        </div>
      )}
    </section>
  );
}
