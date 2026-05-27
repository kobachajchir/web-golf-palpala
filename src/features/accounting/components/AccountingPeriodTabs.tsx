import type { AccountingPeriod } from '../../../modules/accounting/domain/models';
import { UiActionButton } from '../../../components/UiActionButton';
import { formatPeriod } from '../utils/accountingFormatters';

export function AccountingPeriodTabs({
  periods,
  activePeriod,
  onChange,
}: {
  periods: AccountingPeriod[];
  activePeriod: AccountingPeriod;
  onChange: (period: AccountingPeriod) => void;
}) {
  return (
    <div className="accounting-period-tabs" role="tablist" aria-label="Periodos">
      {periods.map((period) => (
        <UiActionButton
          key={period}
          type="button"
          role="tab"
          aria-selected={period === activePeriod}
          compact
          variant={period === activePeriod ? 'positive' : 'secondary'}
          className={period === activePeriod ? 'accounting-period-tabs__item accounting-period-tabs__item--active' : 'accounting-period-tabs__item'}
          onClick={() => onChange(period)}
        >
          {formatPeriod(period)}
        </UiActionButton>
      ))}
    </div>
  );
}
