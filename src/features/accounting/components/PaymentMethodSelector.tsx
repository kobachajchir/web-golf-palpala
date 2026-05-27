import type { PaymentComposerMode, PaymentMethod } from '../types/payment';
import { requiresPaymentReference } from '../utils/accountingValidators';

export function PaymentMethodSelector({
  paymentMethods,
  paymentMethodId,
  mode,
  reference,
  onMethodChange,
  onModeChange,
  onReferenceChange,
}: {
  paymentMethods: PaymentMethod[];
  paymentMethodId: string | null;
  mode: PaymentComposerMode;
  reference: string;
  onMethodChange: (paymentMethodId: string) => void;
  onModeChange: (mode: PaymentComposerMode) => void;
  onReferenceChange: (reference: string) => void;
}) {
  return (
    <>
      <fieldset className="accounting-segmented">
        <legend>Modo de cobro</legend>
        <button
          type="button"
          className={mode === 'manual' ? 'accounting-segmented__item accounting-segmented__item--active' : 'accounting-segmented__item'}
          onClick={() => onModeChange('manual')}
        >
          Manual
        </button>
        <button
          type="button"
          className={mode === 'mercadopago' ? 'accounting-segmented__item accounting-segmented__item--active' : 'accounting-segmented__item'}
          onClick={() => onModeChange('mercadopago')}
        >
          Mercado Pago
        </button>
      </fieldset>
      <label className="form-field">
        <span>Medio de pago</span>
        <select value={paymentMethodId ?? ''} onChange={(event) => onMethodChange(event.target.value)}>
          <option value="">Seleccionar</option>
          {paymentMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}
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
