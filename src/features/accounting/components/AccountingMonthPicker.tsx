import { useMemo, useState } from 'react';
import type { AccountingPeriod } from '../../../modules/accounting/domain/models';
import { formatPeriod, normalizeAccountingPeriod } from '../utils/accountingFormatters';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function splitPeriod(period: string) {
  const normalized = normalizeAccountingPeriod(period);
  const [yearText, monthText] = normalized.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  return { year, month };
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('es-AR', { month: 'short' }).format(new Date(year, month - 1, 1)).replace('.', '');
}

export function AccountingMonthPicker({
  period,
  onChange,
  label = 'Periodo',
}: {
  period: AccountingPeriod;
  onChange: (period: AccountingPeriod) => void;
  label?: string;
}) {
  const { year, month } = splitPeriod(period);
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(year);
  const triggerLabel = useMemo(() => formatPeriod(period), [period]);

  const selectMonth = (nextMonth: number) => {
    onChange(normalizeAccountingPeriod(`${visibleYear}-${String(nextMonth).padStart(2, '0')}`));
    setOpen(false);
  };

  return (
    <div className="accounting-month-picker">
      <span>{label}</span>
      <button
        type="button"
        className="accounting-month-picker__trigger"
        aria-expanded={open}
        onClick={() => {
          setVisibleYear(year);
          setOpen((current) => !current);
        }}
      >
        <strong>{triggerLabel}</strong>
        <svg className={`accounting-chevron-icon ${open ? 'accounting-chevron-icon--open' : ''}`} viewBox="0 0 24 24" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="accounting-month-picker__panel">
          <div className="accounting-month-picker__year">
            <button type="button" aria-label="Anio anterior" onClick={() => setVisibleYear((current) => current - 1)}>-</button>
            <strong>{visibleYear}</strong>
            <button type="button" aria-label="Anio siguiente" onClick={() => setVisibleYear((current) => current + 1)}>+</button>
          </div>
          <div className="accounting-month-picker__grid">
            {MONTHS.map((entry) => {
              const selected = visibleYear === year && entry === month;
              return (
                <button
                  key={entry}
                  type="button"
                  className={selected ? 'accounting-month-picker__month accounting-month-picker__month--selected' : 'accounting-month-picker__month'}
                  onClick={() => selectMonth(entry)}
                >
                  {monthLabel(visibleYear, entry)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
