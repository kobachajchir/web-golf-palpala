import { ConfirmDialog } from '../../../components/ConfirmDialog';
import type { OpenItem } from '../types/payment';
import { formatCurrency } from '../utils/accountingFormatters';

export function PaymentConfirmationDialog({
  open,
  items,
  amountMinor,
  mode,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  items: OpenItem[];
  amountMinor: number;
  mode: 'manual' | 'mercadopago';
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={mode === 'mercadopago' ? 'Crear checkout Mercado Pago' : 'Confirmar cobro manual'}
      description={
        <div className="accounting-confirmation-summary">
          <p>Se cancelaran estos conceptos:</p>
          <ul>
            {items.map((item) => (
              <li key={item.id}>{item.description} - {formatCurrency(item.amountMinor)}</li>
            ))}
          </ul>
          <strong>Total: {formatCurrency(amountMinor)}</strong>
          {mode === 'mercadopago' && (
            <p>El retorno es informativo: el recibo se muestra solo cuando la DB confirme el pago.</p>
          )}
        </div>
      }
      confirmLabel={mode === 'mercadopago' ? 'Crear checkout' : 'Registrar cobro'}
      loading={loading ?? false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
