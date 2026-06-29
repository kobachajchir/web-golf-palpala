import type { OpenItem } from '../types/payment';
import { formatCurrency } from '../utils/accountingFormatters';

type OpenItemRow = {
  id: string;
  items: OpenItem[];
  title: string;
  detail: string;
  status: OpenItem['status'];
  amountMinor: number;
};

function formatFeeCount(count: number) {
  if (count <= 0) {
    return 'Sin cuotas pendientes';
  }
  return `${count} cuota${count === 1 ? '' : 's'} pendiente${count === 1 ? '' : 's'}`;
}

function buildRows(openItems: OpenItem[]): OpenItemRow[] {
  const feeItems = openItems.filter((item) => item.kind === 'member_fee_charge');
  const otherItems = openItems.filter((item) => item.kind !== 'member_fee_charge');
  const rows: OpenItemRow[] = [];

  if (feeItems.length > 0) {
    const sortedPeriods = feeItems
      .flatMap((item) => (item.period ? [item.period] : []))
      .sort();
    rows.push({
      id: 'member-fee-charges',
      items: feeItems,
      title: 'Cuotas societarias',
      detail: `${formatFeeCount(feeItems.length)}${sortedPeriods.length ? ` - ${sortedPeriods[0]} a ${sortedPeriods.at(-1)}` : ''}`,
      status: feeItems.some((item) => item.status === 'overdue') ? 'overdue' : 'pending',
      amountMinor: feeItems.reduce((total, item) => total + item.amountMinor, 0),
    });
  }

  return [
    ...rows,
    ...otherItems.map((item) => ({
      id: item.id,
      items: [item],
      title: item.description,
      detail: item.dueLabel ?? '',
      status: item.status,
      amountMinor: item.amountMinor,
    })),
  ];
}

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

  const rows = buildRows(openItems);

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
          {rows.map((row) => {
            const rowItemIds = row.items.map((item) => item.id);
            const allSelected = rowItemIds.every((id) => selectedOpenItemIds.includes(id));
            return (
            <tr key={row.id}>
              <td>
                <input
                  aria-label={`Seleccionar ${row.title}`}
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => {
                    if (allSelected) {
                      rowItemIds.forEach(onToggle);
                      return;
                    }
                    rowItemIds.filter((id) => !selectedOpenItemIds.includes(id)).forEach(onToggle);
                  }}
                />
              </td>
              <td>
                <strong>{row.title}</strong>
                {row.detail && <small>{row.detail}</small>}
              </td>
              <td><span className={`status-chip status-chip--${row.status}`}>{row.status}</span></td>
              <td><strong>{formatCurrency(row.amountMinor)}</strong></td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
