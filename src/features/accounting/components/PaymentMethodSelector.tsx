import type { PaymentMethod } from '../types/payment';
import { requiresPaymentReference } from '../utils/accountingValidators';
import { getPaymentMethodDisplayName, isVisiblePaymentMethod } from '../utils/paymentMethods';

export function PaymentMethodSelector({
  paymentMethods,
  paymentMethodId,
  reference,
  onMethodChange,
  onReferenceChange,
}: {
  paymentMethods: PaymentMethod[];
  paymentMethodId: string | null;
  reference: string;
  onMethodChange: (paymentMethodId: string) => void;
  onReferenceChange: (reference: string) => void;
}) {
  const visiblePaymentMethods = paymentMethods.filter(isVisiblePaymentMethod);

  return (
    <>
      <label className="form-field">
        <span>Medio de pago</span>
        <select value={paymentMethodId ?? ''} onChange={(event) => onMethodChange(event.target.value)}>
          <option value="">Seleccionar</option>
          {visiblePaymentMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {getPaymentMethodDisplayName(method)}
            </option>
          ))}
        </select>
      </label>
      {requiresPaymentReference(paymentMethodId) && (
        <label className="form-field">
          <span>Referencia</span>
          <input value={reference} onChange={(event) => onReferenceChange(event.target.value)} />
        </label>
      )}
    </>
  );
}
