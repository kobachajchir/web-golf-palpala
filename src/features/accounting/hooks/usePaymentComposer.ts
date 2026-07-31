import { useMemo, useState } from 'react';
import type { PaymentComposerState, PaymentMethod, OpenItem } from '../types/payment';
import { validatePaymentDraft } from '../utils/accountingValidators';
import { isVisiblePaymentMethod } from '../utils/paymentMethods';

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function usePaymentComposer({
  memberId,
  openItems,
  paymentMethods,
}: {
  memberId: string | null;
  openItems: OpenItem[];
  paymentMethods: PaymentMethod[];
}) {
  const defaultPaymentMethodId = paymentMethods.find(isVisiblePaymentMethod)?.id ?? paymentMethods[0]?.id ?? null;
  const [state, setState] = useState<PaymentComposerState>({
    selectedOpenItemIds: [],
    paymentMethodId: defaultPaymentMethodId,
    paymentDate: todayInputValue(),
    reference: '',
    notes: '',
    isSubmitting: false,
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
  const clearSelection = () =>
    setState((current) => ({
      ...current,
      selectedOpenItemIds: [],
      reference: '',
      notes: '',
    }));

  return {
    state,
    setState,
    selectedOpenItems,
    amountMinor,
    validationError,
    toggleOpenItem,
    setSubmitting,
    clearSelection,
  };
}
