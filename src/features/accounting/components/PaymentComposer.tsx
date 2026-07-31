import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { registerManualPayment } from '../api/memberBillingApi';
import type { ManualPaymentReceipt, OpenItem, PaymentMethod } from '../types/payment';
import { formatCurrency, parseAmountInputToMinor } from '../utils/accountingFormatters';
import { usePaymentComposer } from '../hooks/usePaymentComposer';
import { isMacroDebitPaymentMethod, isVisiblePaymentMethod } from '../utils/paymentMethods';
import { calculatePaymentCommission } from '../utils/paymentMethods';
import { OpenItemsTable } from './OpenItemsTable';
import { PaymentConfirmationDialog } from './PaymentConfirmationDialog';
import { PaymentMethodSelector } from './PaymentMethodSelector';
import { PaymentCommissionSummary } from './PaymentCommissionSummary';

export function PaymentComposer({
  memberId,
  openItems,
  paymentMethods,
  onSubmitManual,
  autoSelectOpenItems = false,
}: {
  memberId: string;
  openItems: OpenItem[];
  paymentMethods: PaymentMethod[];
  onSubmitManual: (receipt: ManualPaymentReceipt) => void;
  autoSelectOpenItems?: boolean;
}) {
  const allowsMacroDebit = openItems.length > 0 && openItems.every((item) => item.kind === 'member_fee_charge');
  const allowedPaymentMethods = useMemo(
    () => paymentMethods.filter((method) => allowsMacroDebit || !isMacroDebitPaymentMethod(method)),
    [allowsMacroDebit, paymentMethods],
  );
  const composer = usePaymentComposer({ memberId, openItems, paymentMethods: allowedPaymentMethods });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [settleAsFinalAmount, setSettleAsFinalAmount] = useState(true);
  const selectedPaymentMethod = allowedPaymentMethods.find((method) => method.id === composer.state.paymentMethodId) ?? null;
  const selectedBalanceMinor = composer.amountMinor;
  const canSettleAsFinalAmount = composer.selectedOpenItems.length === 1;
  const willSettleAsFinalAmount = settleAsFinalAmount && canSettleAsFinalAmount;
  const paymentAmountMinor = parseAmountInputToMinor(paymentAmount);
  const paymentAmountError = selectedBalanceMinor > 0 && (
    !Number.isFinite(paymentAmountMinor)
    || paymentAmountMinor <= 0
    || (!willSettleAsFinalAmount && paymentAmountMinor > selectedBalanceMinor)
  )
    ? willSettleAsFinalAmount
      ? 'Ingresa un monto final mayor a cero.'
      : `Ingresa un monto mayor a cero y de hasta ${formatCurrency(selectedBalanceMinor)}.`
    : '';
  const validationError = composer.validationError || paymentAmountError;
  const paymentCommission = calculatePaymentCommission(
    Number.isFinite(paymentAmountMinor) && paymentAmountMinor > 0 ? paymentAmountMinor : 0,
    selectedPaymentMethod,
  );

  useEffect(() => {
    setPaymentAmount(selectedBalanceMinor > 0 ? String(selectedBalanceMinor / 100).replace('.', ',') : '');
  }, [selectedBalanceMinor]);

  useEffect(() => {
    setSettleAsFinalAmount(composer.selectedOpenItems.length === 1);
  }, [composer.state.selectedOpenItemIds]);

  useEffect(() => {
    composer.setState((current) => {
      const selectedMethodStillVisible = allowedPaymentMethods.some((method) => method.id === current.paymentMethodId && isVisiblePaymentMethod(method));
      return {
        ...current,
        paymentMethodId: selectedMethodStillVisible
          ? current.paymentMethodId
          : allowedPaymentMethods.find(isVisiblePaymentMethod)?.id ?? null,
      };
    });
  }, [allowedPaymentMethods, composer]);

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
    if (!validationError) {
      setConfirmOpen(true);
    }
  };

  const submitConfirmed = async () => {
    if (validationError) {
      return;
    }

    composer.setSubmitting(true);

    try {
      let remainingPaymentMinor = paymentAmountMinor;
      const allocationAmountsByChargeId: Record<string, number> = {};
      const settlementAmountsByChargeId: Record<string, number> = {};
      if (willSettleAsFinalAmount) {
        const item = composer.selectedOpenItems[0]!;
        allocationAmountsByChargeId[item.id] = paymentAmountMinor;
        settlementAmountsByChargeId[item.id] = paymentAmountMinor;
        remainingPaymentMinor = 0;
      } else {
        for (const item of composer.selectedOpenItems) {
          if (remainingPaymentMinor <= 0) break;
          const appliedAmountMinor = Math.min(item.amountMinor, remainingPaymentMinor);
          if (appliedAmountMinor > 0) {
            allocationAmountsByChargeId[item.id] = appliedAmountMinor;
            remainingPaymentMinor -= appliedAmountMinor;
          }
        }
      }
      if (remainingPaymentMinor > 0) {
        throw new Error('No se pudo distribuir el monto entre las cuotas seleccionadas.');
      }
      const receipt = await registerManualPayment({
        memberId,
        openItemIds: composer.state.selectedOpenItemIds,
        paymentMethodId: composer.state.paymentMethodId ?? '',
        paymentDate: composer.state.paymentDate,
        reference: composer.state.reference,
        amount: paymentAmountMinor,
        allocationAmountsByChargeId,
        settlementAmountsByChargeId,
        notes: composer.state.notes,
      });
      composer.clearSelection();
      onSubmitManual(receipt);
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
        <strong>{formatCurrency(Number.isFinite(paymentAmountMinor) ? paymentAmountMinor : 0)}</strong>
      </div>

      <form className="accounting-entry-form" onSubmit={handleSubmit}>
        <OpenItemsTable
          openItems={openItems}
          selectedOpenItemIds={composer.state.selectedOpenItemIds}
          onToggle={composer.toggleOpenItem}
        />

        <label className="form-field">
          <span>Monto a cobrar</span>
          <input inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
          <small>{willSettleAsFinalAmount ? 'Este importe cierra la cuota seleccionada.' : `Puede ser un pago parcial de hasta ${formatCurrency(selectedBalanceMinor)}.`}</small>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={willSettleAsFinalAmount}
            disabled={!canSettleAsFinalAmount}
            onChange={(event) => setSettleAsFinalAmount(event.target.checked)}
          />
          <span>
            Tomar este importe como monto final del mes
            <small>Con una sola cuota seleccionada, el mes queda pagado por el importe que indiques.</small>
          </span>
        </label>

        <PaymentMethodSelector
          paymentMethods={allowedPaymentMethods}
          paymentMethodId={composer.state.paymentMethodId}
          reference={composer.state.reference}
          onMethodChange={(paymentMethodId) => composer.setState((current) => ({ ...current, paymentMethodId }))}
          onReferenceChange={(reference) => composer.setState((current) => ({ ...current, reference }))}
        />

        {selectedPaymentMethod && (
          <PaymentCommissionSummary
            direction="income"
            baseAmountMinor={Number.isFinite(paymentAmountMinor) ? paymentAmountMinor : 0}
            commissionAmountMinor={paymentCommission.commissionAmountMinor}
            commissionPctBps={paymentCommission.percentageBps}
            totalAmountMinor={paymentCommission.totalAmountMinor}
            breakdown={selectedPaymentMethod.activeCommissionBreakdown ?? []}
          />
        )}

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

        {validationError && <div className="profile-note">{validationError}</div>}

        <div className="form-actions accounting-sticky-actions">
          <button type="submit" className="btn-primary" disabled={Boolean(validationError) || composer.state.isSubmitting}>
            Revisar y cobrar
          </button>
        </div>
      </form>

      <PaymentConfirmationDialog
        open={confirmOpen}
        items={composer.selectedOpenItems}
        amountMinor={paymentCommission.totalAmountMinor}
        loading={composer.state.isSubmitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submitConfirmed()}
      />
    </section>
  );
}
