import { useEffect, useState, type FormEvent } from 'react';
import { ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import { createMercadoPagoCheckout, registerManualPayment } from '../api/memberBillingApi';
import type { CheckoutSession, ManualPaymentReceipt, OpenItem, PaymentComposerMode, PaymentMethod } from '../types/payment';
import { formatCurrency } from '../utils/accountingFormatters';
import { usePaymentComposer } from '../hooks/usePaymentComposer';
import { OpenItemsTable } from './OpenItemsTable';
import { PaymentConfirmationDialog } from './PaymentConfirmationDialog';
import { PaymentMethodSelector } from './PaymentMethodSelector';

export function PaymentComposer({
  memberId,
  openItems,
  paymentMethods,
  mode,
  onSubmitManual,
  onCreateCheckout,
  autoSelectOpenItems = false,
}: {
  memberId: string;
  openItems: OpenItem[];
  paymentMethods: PaymentMethod[];
  mode: PaymentComposerMode;
  onSubmitManual: (receipt: ManualPaymentReceipt) => void;
  onCreateCheckout: (checkout: CheckoutSession) => void;
  autoSelectOpenItems?: boolean;
}) {
  const composer = usePaymentComposer({ memberId, openItems, paymentMethods, initialMode: mode });
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    composer.setState((current) => {
      if (current.mode === mode) {
        return current;
      }

      const mercadoPagoMethod = paymentMethods.find((method) => method.id === ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago);
      const manualMethod = paymentMethods.find((method) => method.id !== ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago);
      return {
        ...current,
        mode,
        paymentMethodId: mode === 'mercadopago'
          ? mercadoPagoMethod?.id ?? current.paymentMethodId
          : manualMethod?.id ?? current.paymentMethodId,
      };
    });
  }, [composer, mode, paymentMethods]);

  useEffect(() => {
    if (!autoSelectOpenItems || openItems.length === 0) {
      return;
    }

    const openItemIds = openItems.map((item) => item.id);
    composer.setState((current) => {
      const alreadySelected = openItemIds.length === current.selectedOpenItemIds.length
        && openItemIds.every((itemId) => current.selectedOpenItemIds.includes(itemId));

      return alreadySelected ? current : { ...current, selectedOpenItemIds: openItemIds };
    });
  }, [autoSelectOpenItems, composer, openItems]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!composer.validationError) {
      setConfirmOpen(true);
    }
  };

  const submitConfirmed = async () => {
    if (composer.validationError) {
      return;
    }

    composer.setSubmitting(true);

    try {
      if (composer.state.mode === 'mercadopago') {
        const checkout = await createMercadoPagoCheckout({
          memberId,
          openItemIds: composer.state.selectedOpenItemIds,
        });
        composer.setCheckoutSession(checkout);
        onCreateCheckout(checkout);
      } else {
        const receipt = await registerManualPayment({
          memberId,
          openItemIds: composer.state.selectedOpenItemIds,
          paymentMethodId: composer.state.paymentMethodId ?? '',
          paymentDate: composer.state.paymentDate,
          reference: composer.state.reference,
          amount: composer.amountMinor,
          notes: composer.state.notes,
        });
        composer.clearSelection();
        onSubmitManual(receipt);
      }
      setConfirmOpen(false);
    } finally {
      composer.setSubmitting(false);
    }
  };

  return (
    <section className="floating-card accounting-panel accounting-payment-composer">
      <div className="accounting-section-header">
        <div>
          <p className="eyebrow">Cobro</p>
          <h2>Composer de pago</h2>
        </div>
        <strong>{formatCurrency(composer.amountMinor)}</strong>
      </div>

      <form className="accounting-entry-form" onSubmit={handleSubmit}>
        <OpenItemsTable
          openItems={openItems}
          selectedOpenItemIds={composer.state.selectedOpenItemIds}
          onToggle={composer.toggleOpenItem}
        />

        <PaymentMethodSelector
          paymentMethods={paymentMethods}
          paymentMethodId={composer.state.paymentMethodId}
          mode={composer.state.mode}
          reference={composer.state.reference}
          onMethodChange={(paymentMethodId) => composer.setState((current) => ({ ...current, paymentMethodId }))}
          onModeChange={(nextMode) => composer.setState((current) => ({ ...current, mode: nextMode }))}
          onReferenceChange={(reference) => composer.setState((current) => ({ ...current, reference }))}
        />

        <label className="form-field">
          <span>Fecha de pago</span>
          <input
            type="date"
            value={composer.state.paymentDate}
            onChange={(event) => composer.setState((current) => ({ ...current, paymentDate: event.target.value }))}
          />
        </label>

        <label className="form-field">
          <span>Notas</span>
          <textarea
            value={composer.state.notes}
            onChange={(event) => composer.setState((current) => ({ ...current, notes: event.target.value }))}
          />
        </label>

        {composer.validationError && <div className="profile-note">{composer.validationError}</div>}

        <div className="form-actions accounting-sticky-actions">
          <button type="submit" className="btn-primary" disabled={Boolean(composer.validationError) || composer.state.isSubmitting}>
            {composer.state.mode === 'mercadopago' ? 'Crear checkout' : 'Revisar y cobrar'}
          </button>
        </div>
      </form>

      <PaymentConfirmationDialog
        open={confirmOpen}
        items={composer.selectedOpenItems}
        amountMinor={composer.amountMinor}
        mode={composer.state.mode}
        loading={composer.state.isSubmitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submitConfirmed()}
      />
    </section>
  );
}
