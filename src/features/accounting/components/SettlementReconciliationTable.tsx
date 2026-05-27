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
    <div className="accounting-table-wrap">
      <table className="accounting-data-table">
        <thead>
          <tr>
            <th>Proveedor</th>
            <th>Bruto</th>
            <th>Comision</th>
            <th>Liberado</th>
            <th>Estado</th>
            <th>Accion</th>
          </tr>
        </thead>
        <tbody>
          {settlements.map((settlement) => (
            <tr key={settlement.id}>
              <td>
                <strong>{settlement.bankName}</strong>
                <small>{settlement.externalBatchRef} - {formatTimestamp(settlement.accreditedAt)}</small>
              </td>
              <td>{formatCurrency(settlement.grossAmountMinor)}</td>
              <td>{formatCurrency(settlement.commissionAmountMinor)}</td>
              <td><strong>{formatCurrency(settlement.netAmountMinor)}</strong></td>
              <td><span className={`status-chip status-chip--${settlement.status}`}>{settlement.status}</span></td>
              <td>
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
