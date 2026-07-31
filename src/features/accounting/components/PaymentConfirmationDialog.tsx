import { ConfirmDialog } from '../../../components/ConfirmDialog';
import type { OpenItem } from '../types/payment';
import { formatCurrency } from '../utils/accountingFormatters';

export function PaymentConfirmationDialog({
  open,
  items,
  amountMinor,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  items: OpenItem[];
  amountMinor: number;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Confirmar cobro manual"
      description={
        <div className="accounting-confirmation-summary">
          <p>Se cancelaran estos conceptos:</p>
          <ul>
            {items.map((item) => (
              <li key={item.id}>{item.description} - {formatCurrency(item.amountMinor)}</li>
          ))}
          </ul>
          <strong>Total: {formatCurrency(amountMinor)}</strong>
        </div>
      }
      confirmLabel="Registrar cobro"
      loading={loading ?? false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
