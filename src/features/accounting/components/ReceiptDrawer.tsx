import type { ManualPaymentReceipt } from '../types/payment';
import { formatCurrency } from '../utils/accountingFormatters';

export function ReceiptDrawer({
  receipt,
}: {
  receipt: ManualPaymentReceipt | null;
}) {
  if (!receipt) {
    return null;
  }

  return (
    <aside className="floating-card accounting-receipt-drawer" aria-live="polite">
      <p className="eyebrow">Ultimo movimiento</p>
      {receipt && (
        <>
          <h2>Recibo registrado</h2>
          <p>{receipt.duplicate ? 'El backend detecto un cobro ya registrado.' : 'El cobro manual quedo posteado.'}</p>
          <div className="accounting-inline-summary">
            <span>{receipt.movementIds.length} movimiento(s)</span>
            <strong>{formatCurrency(receipt.totalAmountMinor)}</strong>
          </div>
          {receipt.receiptNumbers.length > 0 && (
            <small>Recibo {receipt.receiptNumbers.join(', ')}</small>
          )}
          <small>{receipt.movementIds.join(', ')}</small>
        </>
      )}
    </aside>
  );
}
