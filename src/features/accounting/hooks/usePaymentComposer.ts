import { useMemo, useState } from 'react';
import { ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import type { CheckoutSession, PaymentComposerMode, PaymentComposerState, PaymentMethod, OpenItem } from '../types/payment';
import { validatePaymentDraft } from '../utils/accountingValidators';

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function usePaymentComposer({
  memberId,
  openItems,
  paymentMethods,
  initialMode = 'manual',
}: {
  memberId: string | null;
  openItems: OpenItem[];
  paymentMethods: PaymentMethod[];
  initialMode?: PaymentComposerMode;
}) {
  const defaultPaymentMethodId = paymentMethods.find((method) =>
    initialMode === 'mercadopago'
      ? method.id === ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago
      : method.id !== ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago,
  )?.id ?? paymentMethods[0]?.id ?? null;
  const [state, setState] = useState<PaymentComposerState>({
    selectedOpenItemIds: [],
    paymentMethodId: defaultPaymentMethodId,
    paymentDate: todayInputValue(),
    reference: '',
    notes: '',
    mode: initialMode,
    isSubmitting: false,
    checkoutSession: null,
  });

  const selectedOpenItems = useMemo(
    () => openItems.filter((item) => state.selectedOpenItemIds.includes(item.id)),
    [openItems, state.selectedOpenItemIds],
  );
  const amountMinor = useMemo(
    () => selectedOpenItems.reduce((total, item) => total + item.amountMinor, 0),
    [selectedOpenItems],
  );
  const validationError = useMemo(
    () =>
      validatePaymentDraft({
        memberId,
        openItems,
        selectedOpenItemIds: state.selectedOpenItemIds,
        paymentMethodId: state.paymentMethodId,
        paymentDate: state.paymentDate,
        reference: state.reference,
        paymentMethods,
      }),
    [memberId, openItems, paymentMethods, state.paymentDate, state.paymentMethodId, state.reference, state.selectedOpenItemIds],
  );

  const toggleOpenItem = (openItemId: string) => {
    setState((current) => ({
      ...current,
      selectedOpenItemIds: current.selectedOpenItemIds.includes(openItemId)
        ? current.selectedOpenItemIds.filter((id) => id !== openItemId)
        : [...current.selectedOpenItemIds, openItemId],
    }));
  };

  const setSubmitting = (isSubmitting: boolean) => setState((current) => ({ ...current, isSubmitting }));
  const setCheckoutSession = (checkoutSession: CheckoutSession | null) =>
    setState((current) => ({ ...current, checkoutSession }));
  const clearSelection = () =>
    setState((current) => ({
      ...current,
      selectedOpenItemIds: [],
      reference: '',
      notes: '',
      checkoutSession: null,
    }));

  return {
    state,
    setState,
    selectedOpenItems,
    amountMinor,
    validationError,
    toggleOpenItem,
    setSubmitting,
    setCheckoutSession,
    clearSelection,
  };
}
