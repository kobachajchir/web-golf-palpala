import type { CheckoutSession, ManualPaymentReceipt } from '../types/payment';
import { formatCurrency } from '../utils/accountingFormatters';

export function ReceiptDrawer({
  receipt,
  checkout,
}: {
  receipt: ManualPaymentReceipt | null;
  checkout: CheckoutSession | null;
}) {
  if (!receipt && !checkout) {
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
          <small>{receipt.movementIds.join(', ')}</small>
        </>
      )}
      {checkout && (
        <>
          <h2>Checkout listo</h2>
          <p>Sesion {checkout.sessionId}. El movimiento contable se registra cuando Mercado Pago confirme via webhook.</p>
          <div className="accounting-inline-summary">
            <span>{checkout.itemCount} concepto(s)</span>
            <strong>{formatCurrency(checkout.totalAmountMinor)}</strong>
          </div>
          {checkout.checkoutUrl && (
            <a className="btn-primary" href={checkout.checkoutUrl} target="_blank" rel="noreferrer">
              Abrir checkout
            </a>
          )}
        </>
      )}
    </aside>
  );
}
