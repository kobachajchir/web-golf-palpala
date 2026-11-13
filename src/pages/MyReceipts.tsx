import { useEffect, useMemo, useState } from 'react';
import { SelectionPlaceholder } from '../components/SelectionPlaceholder';
import { accountingErrorMessage } from '../features/accounting/utils/accountingErrors';
import { PaymentCommissionSummary } from '../features/accounting/components/PaymentCommissionSummary';
import { formatCurrency } from '../features/accounting/utils/accountingFormatters';
import { getCategoryLabel } from '../features/accounting/utils/accountingCategories';
import { getMovementStatusLabel, getPaymentMethodDisplayName } from '../features/accounting/utils/paymentMethods';
import type { MyReceiptRecord } from '../modules/accounting/domain/models';
import { createAccountingCallables } from '../modules/accounting/functions/accounting.callables';

const accountingCallables = createAccountingCallables();

function formatReceiptDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Sin fecha';
  }
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function MyReceipts() {
  const [receipts, setReceipts] = useState<MyReceiptRecord[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<MyReceiptRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    accountingCallables.listMyReceipts()
      .then((result) => {
        if (active) {
          setReceipts(result.receipts);
          setError('');
        }
      })
      .catch((reason) => {
        if (active) {
          setError(accountingErrorMessage(reason));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const totalReceivedMinor = useMemo(
    () => receipts.filter((receipt) => receipt.status === 'posted').reduce((total, receipt) => total + receipt.grossAmountMinor, 0),
    [receipts],
  );

  return (
    <div className="accounting-shell my-receipts-page">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Comprobantes personales</p>
          <h1>Mis recibos</h1>
          <p>Consulta el comprobante de cada pago recibido por el club.</p>
        </div>
        <div className="accounting-hero__actions">
          <div className="accounting-hero__summary">
            <span>{receipts.length} comprobantes</span><small>Total de pagos vigentes</small>
            <strong>{formatCurrency(totalReceivedMinor)}</strong>
          </div>
        </div>
      </section>

      <div className="master-detail-layout">
      <section className="floating-card accounting-panel master-detail-list">
        <h2>Historial de recibos</h2>
        {loading && <p role="status">Cargando comprobantes…</p>}
        {error && <div className="error-message" role="alert">{error}</div>}
        {!loading && !error && receipts.length === 0 && <p>Todavía no hay recibos emitidos a tu nombre.</p>}
        {receipts.map((receipt) => <button type="button" key={receipt.id} className={`master-detail-item ${selectedReceipt?.id === receipt.id ? 'master-detail-item--selected' : ''}`} aria-pressed={selectedReceipt?.id === receipt.id} onClick={() => setSelectedReceipt(receipt)}>
          <strong>{receipt.receiptNumber}</strong><span>{receipt.concept || getCategoryLabel(receipt.categoryId)}</span><small>{formatReceiptDate(receipt.operationDate)}</small><strong>{formatCurrency(receipt.grossAmountMinor)}</strong>
        </button>)}
      </section>
      <aside className="floating-card accounting-panel master-detail-preview" aria-label="Detalle del recibo">
      {selectedReceipt ? (
        <>
          <section className="accounting-movement-detail my-receipt-detail">
            <div className="accounting-movement-detail__hero accounting-movement-detail__hero--income">
              <span>Recibo {selectedReceipt.receiptNumber}</span>
              <div><strong>Pago recibido</strong><strong>{formatCurrency(selectedReceipt.grossAmountMinor)}</strong></div>
            </div>
            <dl className="description-list">
              <div><dt>Concepto</dt><dd>{selectedReceipt.concept || getCategoryLabel(selectedReceipt.categoryId)}</dd></div>
              <div><dt>Fecha y hora</dt><dd>{formatReceiptDate(selectedReceipt.operationDate)}</dd></div>
              <div><dt>Periodo contable</dt><dd>{selectedReceipt.accountingPeriod}</dd></div>
              <div><dt>Medio de pago</dt><dd>{getPaymentMethodDisplayName(selectedReceipt.paymentMethodId)}</dd></div>
              <div><dt>Referencia</dt><dd>{selectedReceipt.paymentReference || 'Sin referencia'}</dd></div>
              <div><dt>Estado</dt><dd>{getMovementStatusLabel(selectedReceipt.status)}</dd></div>
              <div><dt>Notas</dt><dd>{selectedReceipt.notes || 'Sin notas'}</dd></div>
              <div><dt>Movimiento asociado</dt><dd>{selectedReceipt.movementId}</dd></div>
            </dl>
            {selectedReceipt.appliedCommissionPctBps !== null && (
              <PaymentCommissionSummary
                direction="income"
                baseAmountMinor={selectedReceipt.netAmountMinor}
                commissionAmountMinor={selectedReceipt.appliedCommissionAmountMinor ?? 0}
                commissionPctBps={selectedReceipt.appliedCommissionPctBps}
                totalAmountMinor={selectedReceipt.grossAmountMinor}
              />
            )}
          </section>
        </>
      ) : <SelectionPlaceholder title="Todavía no seleccionaste un recibo">Elegí un comprobante de la lista para ver su detalle acá.</SelectionPlaceholder>}
      </aside></div>
    </div>
  );
}
