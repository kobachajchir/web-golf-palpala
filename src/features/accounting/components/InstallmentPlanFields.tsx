import { formatCurrency } from '../utils/accountingFormatters';

export function normalizePercentageInput(value: string) {
  const sanitized = value.trim().replace(',', '.');
  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed)) {
    return '0.00';
  }
  return Math.max(0, Math.min(100, parsed)).toFixed(2);
}

export function parsePercentageToBps(value: string) {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(Math.max(0, Math.min(100, parsed)) * 100) : Number.NaN;
}

export function InstallmentPlanFields({
  enabled,
  label,
  installmentCount,
  interestEnabled,
  interestPercentage,
  baseAmountMinor,
  onEnabledChange,
  onInstallmentCountChange,
  onInterestEnabledChange,
  onInterestPercentageChange,
  onInterestPercentageBlur,
}: {
  enabled: boolean;
  label: string;
  installmentCount: string;
  interestEnabled: boolean;
  interestPercentage: string;
  baseAmountMinor: number;
  onEnabledChange: (enabled: boolean) => void;
  onInstallmentCountChange: (value: string) => void;
  onInterestEnabledChange: (enabled: boolean) => void;
  onInterestPercentageChange: (value: string) => void;
  onInterestPercentageBlur: () => void;
}) {
  void installmentCount;
  void onInstallmentCountChange;
  const interestPct = Number(interestPercentage.replace(',', '.'));
  const interestAmountMinor = interestEnabled && Number.isFinite(baseAmountMinor) && Number.isFinite(interestPct)
    ? Math.round((baseAmountMinor * interestPct) / 100)
    : 0;
  const totalAmountMinor = Number.isFinite(baseAmountMinor) ? baseAmountMinor + interestAmountMinor : 0;

  return (
    <section className="accounting-installment-fields form-field--wide">
      <label className="check-field accounting-installment-toggle">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} />
        <span>{label}</span>
      </label>
      {enabled && (
        <div className="accounting-installment-fields__body">
          <label className="check-field accounting-installment-interest-toggle">
            <input type="checkbox" checked={interestEnabled} onChange={(event) => onInterestEnabledChange(event.target.checked)} />
            <span>Agregar interes porcentual</span>
          </label>
          {interestEnabled && (
            <label className="form-field">
              <span>Interes porcentual</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputMode="decimal"
                value={interestPercentage}
                onChange={(event) => onInterestPercentageChange(event.target.value)}
                onBlur={onInterestPercentageBlur}
              />
              <small>Se normaliza con dos decimales al salir del campo.</small>
            </label>
          )}
          <div className="accounting-installment-preview">
            <span>Interes total <strong>{formatCurrency(interestAmountMinor)}</strong></span>
            <span>Los pagos pueden registrarse en cualquier fecha y con distintos medios.</span>
            <span>Saldo total del plan <strong>{formatCurrency(totalAmountMinor)}</strong></span>
          </div>
        </div>
      )}
    </section>
  );
}
