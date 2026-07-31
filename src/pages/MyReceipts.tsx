import { useEffect, useMemo, useState } from 'react';
import { AccountingOperationModal } from '../features/accounting/components/AccountingOperationModal';
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
          setError(reason instanceof Error ? reason.message : 'No pudimos cargar tus recibos.');
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
    () => receipts.reduce((total, receipt) => total + receipt.grossAmountMinor, 0),
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
            <span>{receipts.length} comprobantes</span>
            <strong>{formatCurrency(totalReceivedMinor)}</strong>
          </div>
        </div>
      </section>

      <section className="floating-card accounting-full-width-section">
        <div className="accounting-section-header accounting-section-header--plain">
          <div>
            <p className="eyebrow">Historial</p>
            <h2>Recibos emitidos a tu nombre</h2>
          </div>
        </div>

        {loading && <div className="accounting-empty-state">Cargando comprobantes...</div>}
        {error && <div className="error-message">{error}</div>}
        {!loading && !error && receipts.length === 0 && (
          <div className="accounting-empty-state">Todavia no hay recibos emitidos a tu nombre.</div>
        )}
        {!loading && receipts.length > 0 && (
          <div className="accounting-table-wrap">
            <table className="accounting-data-table my-receipts-table">
              <thead>
                <tr><th>Recibo</th><th>Fecha</th><th>Concepto</th><th>Medio</th><th>Estado</th><th>Total pagado</th><th>Accion</th></tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td data-label="Recibo"><strong>{receipt.receiptNumber}</strong></td>
                    <td data-label="Fecha">{formatReceiptDate(receipt.operationDate)}</td>
                    <td data-label="Concepto">{receipt.concept || getCategoryLabel(receipt.categoryId)}</td>
                    <td data-label="Medio">{getPaymentMethodDisplayName(receipt.paymentMethodId)}</td>
                    <td data-label="Estado"><span className="status-chip status-chip--paid">{getMovementStatusLabel(receipt.status)}</span></td>
                    <td data-label="Total pagado"><strong>{formatCurrency(receipt.grossAmountMinor)}</strong></td>
                    <td data-label="Accion"><button type="button" className="btn-secondary" onClick={() => setSelectedReceipt(receipt)}>Ver detalle</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedReceipt && (
        <AccountingOperationModal title="Detalle del recibo" onClose={() => setSelectedReceipt(null)}>
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
        </AccountingOperationModal>
      )}
    </div>
  );
}
