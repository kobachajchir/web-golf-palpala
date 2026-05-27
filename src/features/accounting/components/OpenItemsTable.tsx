import type { OpenItem } from '../types/payment';
import { formatCurrency } from '../utils/accountingFormatters';

export function OpenItemsTable({
  openItems,
  selectedOpenItemIds,
  onToggle,
}: {
  openItems: OpenItem[];
  selectedOpenItemIds: string[];
  onToggle: (openItemId: string) => void;
}) {
  if (openItems.length === 0) {
    return <div className="empty-state empty-state--inline">No hay conceptos abiertos para este socio.</div>;
  }

  return (
    <div className="accounting-table-wrap">
      <table className="accounting-data-table">
        <thead>
          <tr>
            <th>Seleccion</th>
            <th>Concepto</th>
            <th>Estado</th>
            <th>Monto</th>
          </tr>
        </thead>
        <tbody>
          {openItems.map((item) => (
            <tr key={item.id}>
              <td>
                <input
                  aria-label={`Seleccionar ${item.description}`}
                  type="checkbox"
                  checked={selectedOpenItemIds.includes(item.id)}
                  onChange={() => onToggle(item.id)}
                />
              </td>
              <td>
                <strong>{item.description}</strong>
                {item.dueLabel && <small>{item.dueLabel}</small>}
              </td>
              <td><span className={`status-chip status-chip--${item.status}`}>{item.status}</span></td>
              <td><strong>{formatCurrency(item.amountMinor)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
