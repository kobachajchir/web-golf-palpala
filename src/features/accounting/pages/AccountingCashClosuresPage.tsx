import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { CashClosureDocument, EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createCashClosuresRepository, createFinancialMovementsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { UiActionButton } from '../../../components/UiActionButton';
import { AccountingBarChart, AccountingLineChart } from '../components/AccountingCharts';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { DangerActionDialog } from '../components/DangerActionDialog';
import type { AccountingNotice } from '../types/accounting';
import { buildArgentinaDateIso, formatCurrency, formatTimestamp, getSignedMovementAmount, normalizeAccountingPeriod, parseAmountInputToMinor, timestampToDate } from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();
type ClosureStatsScope = 'day' | 'month' | 'range';

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function toClubDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getMovementDayKey(movement: EntityWithId<FinancialMovementDocument>) {
  const date = timestampToDate(movement.operationDate);
  return date ? toClubDayKey(date) : '';
}

function getClosureDayKey(closure: EntityWithId<CashClosureDocument>) {
  const date = timestampToDate(closure.closureDate);
  return date ? toClubDayKey(date) : '';
}

function formatDayKeyDisplay(dayKey: string) {
  const [year, month, day] = dayKey.split('-');
  return day && month && year ? `${day}/${month}/${year}` : dayKey;
}

function formatDateInputDisplay(dateValue: string) {
  const [year, month, day] = dateValue.split('-');
  return day && month && year ? `${day}/${month}/${year}` : dateValue || 'Sin fecha';
}

function getPeriodDateRange(period: string) {
  const normalizedPeriod = normalizeAccountingPeriod(period);
  const [yearText, monthText] = normalizedPeriod.split('-');
  const lastDay = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
  return {
    dateFrom: `${normalizedPeriod}-01`,
    dateTo: `${normalizedPeriod}-${String(lastDay).padStart(2, '0')}`,
  };
}

function enumeratePeriodsBetweenDates(dateFrom: string, dateTo: string) {
  if (!dateFrom || !dateTo || dateFrom > dateTo) {
    return [];
  }

  const periods: string[] = [];
  const startPeriod = normalizeAccountingPeriod(dateFrom.slice(0, 7));
  const endPeriod = normalizeAccountingPeriod(dateTo.slice(0, 7));
  const [startYearText = '0', startMonthText = '1'] = startPeriod.split('-');
  const [endYearText = '0', endMonthText = '1'] = endPeriod.split('-');
  const startYear = Number(startYearText);
  const startMonth = Number(startMonthText);
  const endYear = Number(endYearText);
  const endMonth = Number(endMonthText);
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(endYear, endMonth - 1, 1));

  while (cursor <= end) {
    periods.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return periods;
}

function uniqueMovements(movements: Array<EntityWithId<FinancialMovementDocument>>) {
  return Array.from(new Map(movements.map((movement) => [movement.id, movement])).values());
}

function isDateKeyInsideRange(dateKey: string, dateFrom: string, dateTo: string) {
  return Boolean(dateKey && dateFrom && dateTo && dateFrom <= dateTo && dateKey >= dateFrom && dateKey <= dateTo);
}

function getOpenClosureBefore(closures: Array<EntityWithId<CashClosureDocument>>, dayKey: string) {
  return closures
    .filter((closure) => closure.status === 'open' && getClosureDayKey(closure) < dayKey)
    .sort((left, right) => getClosureDayKey(left).localeCompare(getClosureDayKey(right)))[0] ?? null;
}

function uniqueClosures(closures: Array<EntityWithId<CashClosureDocument>>) {
  return Array.from(new Map(closures.map((closure) => [closure.id, closure])).values());
}

function groupByPaymentMethod(movements: Array<EntityWithId<FinancialMovementDocument>>, openingBalanceMinor: number) {
  const grouped = new Map<string, { label: string; amountMinor: number; count: number }>();
  if (openingBalanceMinor > 0) {
    grouped.set('cash', { label: 'cash', amountMinor: openingBalanceMinor, count: 0 });
  }

  movements.forEach((movement) => {
    if (movement.status === 'voided') {
      return;
    }

    const key = movement.paymentMethodCodeSnapshot ?? 'sin_medio';
    const current = grouped.get(key) ?? { label: key.replaceAll('_', ' '), amountMinor: 0, count: 0 };
    current.amountMinor += getSignedMovementAmount(movement);
    current.count += 1;
    grouped.set(key, current);
  });
  return [...grouped.entries()].map(([key, value]) => ({ key, ...value }));
}

export function AccountingCashClosuresPage({ onChanged }: { onChanged?: () => void | Promise<void> } = {}) {
  const operatingDate = todayInputValue();
  const [statsScope, setStatsScope] = useState<ClosureStatsScope>('day');
  const [statsDay, setStatsDay] = useState(operatingDate);
  const [statsMonth, setStatsMonth] = useState(() => normalizeAccountingPeriod(operatingDate.slice(0, 7)));
  const [statsRange, setStatsRange] = useState(() => ({
    dateFrom: getPeriodDateRange(operatingDate.slice(0, 7)).dateFrom,
    dateTo: operatingDate,
  }));
  const [openingBalance, setOpeningBalance] = useState('0');
  const [notes, setNotes] = useState('');
  const [closures, setClosures] = useState<Array<EntityWithId<CashClosureDocument>>>([]);
  const [operatingClosures, setOperatingClosures] = useState<Array<EntityWithId<CashClosureDocument>>>([]);
  const [openClosures, setOpenClosures] = useState<Array<EntityWithId<CashClosureDocument>>>([]);
  const [movements, setMovements] = useState<Array<EntityWithId<FinancialMovementDocument>>>([]);
  const [operatingMovements, setOperatingMovements] = useState<Array<EntityWithId<FinancialMovementDocument>>>([]);
  const [closeAmounts, setCloseAmounts] = useState<Record<string, string>>({});
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const operatingPeriod = useMemo(() => normalizeAccountingPeriod(operatingDate.slice(0, 7)), [operatingDate]);
  const statsDateRange = useMemo(() => {
    if (statsScope === 'day') {
      return { dateFrom: statsDay, dateTo: statsDay };
    }

    if (statsScope === 'month') {
      return getPeriodDateRange(statsMonth);
    }

    return statsRange;
  }, [statsDay, statsMonth, statsRange, statsScope]);
  const selectedStatsPeriods = useMemo(
    () => enumeratePeriodsBetweenDates(statsDateRange.dateFrom, statsDateRange.dateTo),
    [statsDateRange.dateFrom, statsDateRange.dateTo],
  );
  const selectedStatsPeriodsKey = selectedStatsPeriods.join('|');

  const load = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const cashClosuresRepository = createCashClosuresRepository();
      const movementsRepository = createFinancialMovementsRepository();
      const periodsToLoad = selectedStatsPeriods.length ? selectedStatsPeriods : [operatingPeriod];
      const [nextClosuresByPeriod, nextMovementsByPeriod, nextOperatingClosures, nextOperatingMovements, nextOpenClosures] = await Promise.all([
        Promise.all(periodsToLoad.map((period) => cashClosuresRepository.listByPeriod(period))),
        Promise.all(periodsToLoad.map((period) => movementsRepository.listByAccountingPeriod(period))),
        cashClosuresRepository.listByPeriod(operatingPeriod),
        movementsRepository.listByAccountingPeriod(operatingPeriod),
        cashClosuresRepository.listOpen(),
      ]);
      setClosures(uniqueClosures(nextClosuresByPeriod.flat()));
      setMovements(uniqueMovements(nextMovementsByPeriod.flat()));
      setOperatingClosures(nextOperatingClosures);
      setOperatingMovements(nextOperatingMovements);
      setOpenClosures(nextOpenClosures);
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar cierres.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [operatingPeriod, selectedStatsPeriodsKey]);

  const operatingDay = useMemo(() => toClubDayKey(new Date(`${operatingDate}T00:00:00.000-03:00`)), [operatingDate]);
  const openingBalanceMinor = useMemo(() => {
    const parsed = parseAmountInputToMinor(openingBalance);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }, [openingBalance]);
  const movementsForDay = useMemo(
    () => movements.filter((movement) => isDateKeyInsideRange(getMovementDayKey(movement), statsDateRange.dateFrom, statsDateRange.dateTo)),
    [movements, statsDateRange.dateFrom, statsDateRange.dateTo],
  );
  const movementsForOperatingDay = useMemo(
    () => operatingMovements.filter((movement) => getMovementDayKey(movement) === operatingDay),
    [operatingDay, operatingMovements],
  );
  const closuresForDay = useMemo(
    () => closures.filter((closure) => {
      const dateKey = getClosureDayKey(closure);
      return isDateKeyInsideRange(dateKey, statsDateRange.dateFrom, statsDateRange.dateTo);
    }),
    [closures, statsDateRange.dateFrom, statsDateRange.dateTo],
  );
  const statsOpeningBalanceMinor = closuresForDay.reduce((total, closure) => total + (closure.openingBalanceMinor ?? 0), 0);
  const paymentBuckets = useMemo(
    () => groupByPaymentMethod(movementsForDay, statsOpeningBalanceMinor),
    [movementsForDay, statsOpeningBalanceMinor],
  );
  const operatingPaymentBuckets = useMemo(
    () => groupByPaymentMethod(movementsForOperatingDay, Number.isFinite(openingBalanceMinor) ? openingBalanceMinor : 0),
    [movementsForOperatingDay, openingBalanceMinor],
  );
  const expectedCashMinor = operatingPaymentBuckets.find((bucket) => bucket.key === 'cash')?.amountMinor ?? 0;
  const openClosure = operatingClosures.find((closure) => closure.status === 'open' && getClosureDayKey(closure) === operatingDay) ?? null;
  const operatingClosedClosure = operatingClosures.find((closure) => closure.status === 'closed' && getClosureDayKey(closure) === operatingDay) ?? null;
  const previousOpenClosure = getOpenClosureBefore(openClosures, operatingDay);
  const allVisibleClosures = uniqueClosures([...closures, ...operatingClosures, ...openClosures]);
  const selectedClosing = closingId ? allVisibleClosures.find((closure) => closure.id === closingId) ?? null : null;
  const selectedCloseAmountMinor = selectedClosing ? parseAmountInputToMinor(closeAmounts[selectedClosing.id] ?? '') : Number.NaN;
  const selectedDifferenceMinor =
    selectedClosing && Number.isFinite(selectedCloseAmountMinor)
      ? selectedCloseAmountMinor - selectedClosing.cashExpectedMinor
      : null;
  const hasOperatingDayMovements = movementsForOperatingDay.some((movement) => movement.status !== 'voided');
  const hasPendingCashClosure = Boolean(openClosure || previousOpenClosure || hasOperatingDayMovements);
  const closedClosures = closuresForDay.filter((closure) => closure.status === 'closed');
  const countedMinor = closedClosures.reduce((total, closure) => total + (closure.cashCountedMinor ?? 0), 0);
  const expectedMinor = closuresForDay.reduce((total, closure) => total + closure.cashExpectedMinor, 0);
  const differenceMinor = closuresForDay.reduce((total, closure) => total + (closure.differenceMinor ?? 0), 0);
  const closureLineData = closuresForDay.slice().sort((left, right) => getClosureDayKey(left).localeCompare(getClosureDayKey(right))).map((closure) => ({
    label: formatTimestamp(closure.closureDate),
    valueMinor: closure.cashExpectedMinor,
  }));
  const statsRangeLabel = statsDateRange.dateFrom === statsDateRange.dateTo
    ? formatDateInputDisplay(statsDateRange.dateFrom)
    : `${formatDateInputDisplay(statsDateRange.dateFrom)} - ${formatDateInputDisplay(statsDateRange.dateTo)}`;

  const handleCreateClosure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previousOpenClosure) {
      setNotice({ kind: 'error', message: `Hay una caja anterior abierta (${formatDayKeyDisplay(getClosureDayKey(previousOpenClosure))}). Cerrala antes de abrir la jornada de hoy.` });
      return;
    }
    if (operatingClosedClosure) {
      setNotice({ kind: 'error', message: 'La caja de hoy ya fue cerrada. No se puede abrir otra caja para la misma jornada.' });
      return;
    }
    if (!Number.isFinite(openingBalanceMinor) || openingBalanceMinor < 0) {
      setNotice({ kind: 'error', message: 'Ingresa un saldo inicial valido.' });
      return;
    }

    setCreating(true);
    try {
      const result = await accountingCallables.createCashClosure({
        period: operatingPeriod,
        closureDate: buildArgentinaDateIso(operatingDate),
        openingBalanceMinor,
        notes: notes.trim() || null,
      });
      setNotice({ kind: 'success', message: `Cierre abierto con ${result.movementCount} movimientos. Efectivo esperado ${formatCurrency(result.cashExpectedMinor)}.` });
      setNotes('');
      await load();
      await onChanged?.();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos abrir cierre.' });
    } finally {
      setCreating(false);
    }
  };

  const closeConfirmed = async () => {
    if (!closingId) {
      return;
    }

    const amountMinor = parseAmountInputToMinor(closeAmounts[closingId] ?? '');
    if (!Number.isFinite(amountMinor)) {
      setNotice({ kind: 'error', message: 'Ingresa efectivo contado valido.' });
      return;
    }

    setClosing(true);
    try {
      const result = await accountingCallables.closeCashClosure({
        cashClosureId: closingId,
        cashCountedMinor: amountMinor,
        notes: closeReason.trim(),
      });
      setNotice({ kind: 'success', message: `Caja cerrada con diferencia ${formatCurrency(result.differenceMinor)}.` });
      setClosingId(null);
      setCloseReason('');
      await load();
      await onChanged?.();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cerrar caja.' });
    } finally {
      setClosing(false);
    }
  };

  const startClosing = (closure: EntityWithId<CashClosureDocument>) => {
    setCloseAmounts((current) => ({
      ...current,
      [closure.id]: current[closure.id] ?? String((closure.cashExpectedMinor ?? 0) / 100).replace('.', ','),
    }));
    setClosingId(closure.id);
  };

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <h1>Caja diaria</h1>
        </div>
        <div className="accounting-hero__controls">
          <label className="form-field accounting-day-picker">
            <span>Fecha de jornada</span>
            <input type="date" value={operatingDate} readOnly />
          </label>
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />
      {hasPendingCashClosure && (
        <AccountingInlineNotice
          notice={{
            kind: 'info',
            message: previousOpenClosure
              ? `Hay una caja anterior abierta (${formatDayKeyDisplay(getClosureDayKey(previousOpenClosure))}). Cerrala antes de abrir la jornada de hoy o cargar movimientos nuevos.`
              : openClosure
              ? `Hay una caja abierta desde ${formatTimestamp(openClosure.closureDate)}. Conviene cerrarla antes de terminar la jornada.`
              : 'Hay movimientos del dia sin cierre abierto. La caja diaria queda pendiente de arqueo y conciliacion.',
          }}
        />
      )}

      <section className="floating-card accounting-panel accounting-centered-panel">
        <div className="accounting-section-header accounting-section-header--plain">
          <h2>Abrir caja diaria</h2>
        </div>
        {previousOpenClosure ? (
          <div className="accounting-open-cash-close accounting-open-cash-close--blocked">
            <div className="accounting-blocked-cash-header">
              <div>
                <p className="eyebrow">Caja anterior abierta</p>
                <h3>{formatDayKeyDisplay(getClosureDayKey(previousOpenClosure))}</h3>
                <p>Debe cerrarse antes de abrir la jornada de hoy o registrar movimientos nuevos.</p>
              </div>
              <UiActionButton type="button" onClick={() => startClosing(previousOpenClosure)}>
                Cerrar caja anterior
              </UiActionButton>
            </div>
            <div className="accounting-inline-summary accounting-inline-summary--blocked">
              <span>Caja pendiente</span>
              <strong>{formatTimestamp(previousOpenClosure.closureDate)}</strong>
              <small>El efectivo contado se precarga con el esperado, pero podés ajustarlo antes de confirmar.</small>
            </div>
            <div className="accounting-entry-form">
              <label className="form-field"><span>Efectivo esperado</span><input value={formatCurrency(previousOpenClosure.cashExpectedMinor)} readOnly /></label>
              <label className="form-field">
                <span>Efectivo contado al cierre</span>
                <input
                  inputMode="decimal"
                  value={closeAmounts[previousOpenClosure.id] ?? ''}
                  onChange={(event) => setCloseAmounts((current) => ({ ...current, [previousOpenClosure.id]: event.target.value }))}
                />
              </label>
              <div className="form-actions">
                <UiActionButton type="button" onClick={() => startClosing(previousOpenClosure)}>Cerrar caja anterior</UiActionButton>
              </div>
            </div>
          </div>
        ) : openClosure ? (
          <div className="accounting-open-cash-close">
            <div className="accounting-inline-summary">
              <span>Caja abierta</span>
              <strong>{formatTimestamp(openClosure.closureDate)}</strong>
            </div>
            <div className="accounting-entry-form">
              <label className="form-field"><span>Efectivo esperado</span><input value={formatCurrency(openClosure.cashExpectedMinor)} readOnly /></label>
              <label className="form-field">
                <span>Efectivo contado al cierre</span>
                <input
                  inputMode="decimal"
                  value={closeAmounts[openClosure.id] ?? ''}
                  onChange={(event) => setCloseAmounts((current) => ({ ...current, [openClosure.id]: event.target.value }))}
                />
              </label>
              <div className="form-actions">
                <UiActionButton type="button" onClick={() => startClosing(openClosure)}>Cerrar caja</UiActionButton>
              </div>
            </div>
          </div>
        ) : operatingClosedClosure ? (
          <div className="accounting-inline-summary">
            <span>Caja cerrada</span>
            <strong>{formatTimestamp(operatingClosedClosure.closureDate)}</strong>
            <small>No se puede abrir otra caja para la misma jornada.</small>
          </div>
        ) : (
          <form className="accounting-entry-form" onSubmit={handleCreateClosure}>
            <label className="form-field"><span>Saldo inicial efectivo</span><input inputMode="decimal" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label>
            <label className="form-field"><span>Efectivo esperado actual</span><input value={formatCurrency(expectedCashMinor)} readOnly /></label>
            <label className="form-field"><span>Notas</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            <div className="form-actions"><UiActionButton type="submit" disabled={creating}>{creating ? 'Abriendo...' : 'Abrir caja'}</UiActionButton></div>
          </form>
        )}
      </section>

      <section className="floating-card accounting-panel accounting-centered-panel">
        <div className="accounting-section-header accounting-section-header--plain">
          <div>
            <p className="eyebrow">Cierres</p>
            <h2>Estadisticas</h2>
          </div>
        </div>
        <div className="accounting-closure-stats-controls">
          <label className="form-field accounting-closure-stats-control">
            <span>Buscar por fecha</span>
            <select value={statsScope} onChange={(event) => setStatsScope(event.target.value as ClosureStatsScope)}>
              <option value="day">Por dia</option>
              <option value="month">Por mes</option>
              <option value="range">Rango de fechas</option>
            </select>
          </label>
          {statsScope === 'day' && (
            <label className="form-field accounting-closure-stats-control">
              <span>Dia</span>
              <input type="date" value={statsDay} max={operatingDate} onChange={(event) => setStatsDay(event.target.value)} />
              <small>{formatDateInputDisplay(statsDay)}</small>
            </label>
          )}
          {statsScope === 'month' && (
            <label className="form-field accounting-closure-stats-control">
              <span>Mes</span>
              <input type="month" value={statsMonth} max={operatingPeriod} onChange={(event) => setStatsMonth(normalizeAccountingPeriod(event.target.value))} />
              <small>{statsRangeLabel}</small>
            </label>
          )}
          {statsScope === 'range' && (
            <div className="accounting-balance-range-controls accounting-closure-stats-range">
              <label className="form-field accounting-closure-stats-control">
                <span>Fecha de inicio</span>
                <input
                  type="date"
                  value={statsRange.dateFrom}
                  max={statsRange.dateTo || operatingDate}
                  onChange={(event) => setStatsRange((current) => ({ ...current, dateFrom: event.target.value }))}
                />
                <small>{formatDateInputDisplay(statsRange.dateFrom)}</small>
              </label>
              <label className="form-field accounting-closure-stats-control">
                <span>Fecha de fin</span>
                <input
                  type="date"
                  value={statsRange.dateTo}
                  min={statsRange.dateFrom}
                  max={operatingDate}
                  onChange={(event) => setStatsRange((current) => ({ ...current, dateTo: event.target.value }))}
                />
                <small>{formatDateInputDisplay(statsRange.dateTo)}</small>
              </label>
            </div>
          )}
          <div className="accounting-inline-summary accounting-closure-stats-summary">
            <span>Filtro aplicado</span>
            <strong>{statsRangeLabel}</strong>
            <small>{closuresForDay.length} cierres encontrados</small>
          </div>
        </div>
        <div className="accounting-chart-grid">
          <AccountingBarChart
            title="Caja esperada, contada y diferencia"
            data={[
              { label: 'Esperada', valueMinor: expectedMinor },
              { label: 'Contada', valueMinor: countedMinor },
              { label: 'Diferencia', valueMinor: differenceMinor },
            ]}
          />
          <AccountingLineChart title="Efectivo esperado por cierre" data={closureLineData.length ? closureLineData : [{ label: 'Sin datos', valueMinor: 0 }]} />
        </div>
        <div className="accounting-list">
          {paymentBuckets.map((bucket) => (
            <article key={bucket.key} className="accounting-row">
              <div className="accounting-row__main"><strong>{bucket.label}</strong><small>{bucket.count === 0 ? 'saldo inicial' : `${bucket.count} movimientos`}</small></div>
              <div className="accounting-row__meta"><strong>{formatCurrency(bucket.amountMinor)}</strong></div>
            </article>
          ))}
          {paymentBuckets.length === 0 && <AccountingEmptyState title="Sin movimientos en la fecha" />}
        </div>
      </section>

      <section className="floating-card accounting-panel accounting-centered-panel">
        <div className="accounting-section-header accounting-section-header--plain">
          <h2>Cierres registrados</h2>
        </div>
        <div className="accounting-list">
          {closuresForDay.map((closure) => (
            <article key={closure.id} className="accounting-row accounting-row--actions">
              <div className="accounting-row__main"><strong>{formatTimestamp(closure.closureDate)}</strong><small>{closure.movementIds.length} movimientos - inicial {formatCurrency(closure.openingBalanceMinor ?? 0)} - efectivo esperado {formatCurrency(closure.cashExpectedMinor)}</small></div>
              <div className="accounting-row__meta"><span className={`status-chip status-chip--${closure.status}`}>{closure.status}</span><strong>{formatCurrency(closure.differenceMinor ?? 0)}</strong></div>
              {closure.status === 'open' && (
                <div className="accounting-inline-actions">
                  <label className="form-field accounting-close-field"><span>Contado</span><input value={closeAmounts[closure.id] ?? ''} onChange={(event) => setCloseAmounts((current) => ({ ...current, [closure.id]: event.target.value }))} /></label>
                  <UiActionButton type="button" onClick={() => startClosing(closure)}>Cerrar caja</UiActionButton>
                </div>
              )}
            </article>
          ))}
          {!loading && closuresForDay.length === 0 && <AccountingEmptyState title="Sin cierres para esta fecha" />}
        </div>
      </section>

      <DangerActionDialog
        open={Boolean(closingId)}
        title="Cerrar caja"
        description={
          selectedClosing ? (
            <div className="cash-close-summary">
              <div>
                <span>Esperado por sistema</span>
                <strong>{formatCurrency(selectedClosing.cashExpectedMinor)}</strong>
              </div>
              <div>
                <span>Dinero contado</span>
                <strong>{Number.isFinite(selectedCloseAmountMinor) ? formatCurrency(selectedCloseAmountMinor) : 'Sin cargar'}</strong>
              </div>
              <div>
                <span>Diferencia</span>
                <strong>{selectedDifferenceMinor === null ? 'Sin calcular' : formatCurrency(selectedDifferenceMinor)}</strong>
              </div>
              <p>Abajo se carga el motivo obligatorio. Ese motivo queda asentado y asociado al cierre de caja.</p>
            </div>
          ) : (
            <p>Confirma el cierre con el monto contado. El motivo queda asentado y asociado al cierre de caja.</p>
          )
        }
        reason={closeReason}
        confirmLabel="Cerrar caja"
        confirmVariant="secondary"
        loading={closing}
        onReasonChange={setCloseReason}
        onCancel={() => setClosingId(null)}
        onConfirm={() => void closeConfirmed()}
      />
    </div>
  );
}
