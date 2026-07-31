import type { EntityWithId, MacroDebitSettlementDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { formatCurrency, formatTimestamp } from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();

export function SettlementReconciliationTable({
  settlements,
  onUpdated,
}: {
  settlements: Array<EntityWithId<MacroDebitSettlementDocument>>;
  onUpdated: () => void;
}) {
  const handleReconcile = async (settlementId: string, close = false) => {
    await accountingCallables.reconcileMacroSettlement({ settlementId, close });
    onUpdated();
  };

  if (settlements.length === 0) {
    return <div className="empty-state empty-state--inline">No hay liquidaciones para este periodo.</div>;
  }

  return (
    <div className="accounting-list accounting-bank-settlements-history-list">
      {settlements.map((settlement) => (
        <article key={settlement.id} className="accounting-row accounting-bank-settlement-row">
          <span className="accounting-row__main">
            <strong>{settlement.bankName}</strong>
            <small>{settlement.externalBatchRef} - {formatTimestamp(settlement.accreditedAt)}</small>
          </span>
          <span className="accounting-row__meta">
            <small>Bruto</small>
            <strong>{formatCurrency(settlement.grossAmountMinor)}</strong>
          </span>
          <span className="accounting-row__meta">
            <small>Comision</small>
            <strong>{formatCurrency(settlement.commissionAmountMinor)}</strong>
          </span>
          <span className="accounting-row__meta">
            <small>Liberado</small>
            <strong>{formatCurrency(settlement.netAmountMinor)}</strong>
          </span>
          <span className="accounting-row__meta">
            <small>Estado</small>
            <span className={`status-chip status-chip--${settlement.status}`}>{settlement.status}</span>
          </span>
          <span className="accounting-inline-actions accounting-bank-settlement-row__actions">
            {settlement.status === 'imported' && (
              <button type="button" className="btn-secondary" onClick={() => void handleReconcile(settlement.id)}>
                Conciliar
              </button>
            )}
            {settlement.status === 'reconciled' && (
              <button type="button" className="btn-primary" onClick={() => void handleReconcile(settlement.id, true)}>
                Cerrar
              </button>
            )}
          </span>
        </article>
      ))}
    </div>
  );
}
