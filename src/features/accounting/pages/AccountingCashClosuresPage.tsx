import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { CashClosureDocument, EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createCashClosuresRepository, createFinancialMovementsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { UiActionButton } from '../../../components/UiActionButton';
import { AccountingBarChart, AccountingLineChart } from '../components/AccountingCharts';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { DangerActionDialog } from '../components/DangerActionDialog';
import type { AccountingNotice } from '../types/accounting';
import { buildArgentinaDateIso, formatCurrency, formatTimestamp, getSignedMovementAmount, normalizeAccountingPeriod, parseAmountInputToMinor, timestampToDate } from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
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

export function AccountingCashClosuresPage() {
  const [closureDate, setClosureDate] = useState(todayInputValue());
  const [openingBalance, setOpeningBalance] = useState('0');
  const [notes, setNotes] = useState('');
  const [closures, setClosures] = useState<Array<EntityWithId<CashClosureDocument>>>([]);
  const [movements, setMovements] = useState<Array<EntityWithId<FinancialMovementDocument>>>([]);
  const [closeAmounts, setCloseAmounts] = useState<Record<string, string>>({});
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const selectedPeriod = useMemo(() => normalizeAccountingPeriod(closureDate.slice(0, 7)), [closureDate]);

  const load = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const cashClosuresRepository = createCashClosuresRepository();
      const movementsRepository = createFinancialMovementsRepository();
      const [nextClosures, nextMovements] = await Promise.all([
        cashClosuresRepository.listByPeriod(selectedPeriod),
        movementsRepository.listByAccountingPeriod(selectedPeriod),
      ]);
      setClosures(nextClosures);
      setMovements(nextMovements);
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar cierres.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [selectedPeriod]);

  const closureDay = useMemo(() => toClubDayKey(new Date(`${closureDate}T00:00:00.000-03:00`)), [closureDate]);
  const openingBalanceMinor = useMemo(() => {
    const parsed = parseAmountInputToMinor(openingBalance);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }, [openingBalance]);
  const movementsForDay = useMemo(
    () => movements.filter((movement) => getMovementDayKey(movement) === closureDay),
    [closureDay, movements],
  );
  const closuresForDay = useMemo(
    () => closures.filter((closure) => {
      const date = timestampToDate(closure.closureDate);
      return date ? toClubDayKey(date) === closureDay : false;
    }),
    [closureDay, closures],
  );
  const paymentBuckets = useMemo(
    () => groupByPaymentMethod(movementsForDay, Number.isFinite(openingBalanceMinor) ? openingBalanceMinor : 0),
    [movementsForDay, openingBalanceMinor],
  );
  const expectedCashMinor = paymentBuckets.find((bucket) => bucket.key === 'cash')?.amountMinor ?? 0;
  const openClosure = closures.find((closure) => closure.status === 'open') ?? null;
  const selectedClosing = closingId ? closures.find((closure) => closure.id === closingId) ?? null : null;
  const selectedCloseAmountMinor = selectedClosing ? parseAmountInputToMinor(closeAmounts[selectedClosing.id] ?? '') : Number.NaN;
  const selectedDifferenceMinor =
    selectedClosing && Number.isFinite(selectedCloseAmountMinor)
      ? selectedCloseAmountMinor - selectedClosing.cashExpectedMinor
      : null;
  const hasDayMovements = movementsForDay.some((movement) => movement.status !== 'voided');
  const hasPendingCashClosure = Boolean(openClosure || hasDayMovements);
  const closedClosures = closuresForDay.filter((closure) => closure.status === 'closed');
  const countedMinor = closedClosures.reduce((total, closure) => total + (closure.cashCountedMinor ?? 0), 0);
  const expectedMinor = closuresForDay.reduce((total, closure) => total + closure.cashExpectedMinor, 0);
  const differenceMinor = closuresForDay.reduce((total, closure) => total + (closure.differenceMinor ?? 0), 0);
  const closureLineData = closuresForDay.slice(0, 6).reverse().map((closure) => ({
    label: formatTimestamp(closure.closureDate),
    valueMinor: closure.cashExpectedMinor,
  }));

  const handleCreateClosure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!Number.isFinite(openingBalanceMinor) || openingBalanceMinor < 0) {
      setNotice({ kind: 'error', message: 'Ingresa un saldo inicial valido.' });
      return;
    }

    setCreating(true);
    try {
      const result = await accountingCallables.createCashClosure({
        period: selectedPeriod,
        closureDate: buildArgentinaDateIso(closureDate),
        openingBalanceMinor,
        notes: notes.trim() || null,
      });
      setNotice({ kind: 'success', message: `Cierre abierto con ${result.movementCount} movimientos. Efectivo esperado ${formatCurrency(result.cashExpectedMinor)}.` });
      setNotes('');
      await load();
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
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cerrar caja.' });
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Cierres de caja</p>
          <h1>Arqueo y conciliacion diaria</h1>
          <p>Resumen previo, movimientos del dia y confirmacion explicita antes de cerrar.</p>
        </div>
        <div className="accounting-hero__controls">
          <label className="form-field accounting-day-picker">
            <span>Fecha de jornada</span>
            <input type="date" value={closureDate} onChange={(event) => setClosureDate(event.target.value)} />
          </label>
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />
      {hasPendingCashClosure && (
        <AccountingInlineNotice
          notice={{
            kind: 'info',
            message: openClosure
              ? `Hay una caja abierta desde ${formatTimestamp(openClosure.closureDate)}. Conviene cerrarla antes de terminar la jornada.`
              : 'Hay movimientos del dia sin cierre abierto. La caja diaria queda pendiente de arqueo y conciliacion.',
          }}
        />
      )}

      <AccountingCollapsibleSections
        initialOpenId="open"
        sections={[
          {
            id: 'open',
            title: 'Abrir caja diaria',
            eyebrow: 'Caja diaria',
            helper: `Jornada ${closureDate}`,
            content: (
              <form className="accounting-entry-form" onSubmit={handleCreateClosure}>
                <label className="form-field"><span>Saldo inicial efectivo</span><input inputMode="decimal" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label>
                <label className="form-field"><span>Efectivo esperado actual</span><input value={formatCurrency(expectedCashMinor)} readOnly /></label>
                <label className="form-field"><span>Notas</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
                <div className="form-actions"><UiActionButton type="submit" disabled={creating}>{creating ? 'Abriendo...' : 'Abrir caja'}</UiActionButton></div>
              </form>
            ),
          },
          {
            id: 'stats',
            title: 'Estadisticas y arqueo esperado',
            eyebrow: 'Arqueo',
            helper: 'Esperado por medio, contado y diferencias',
            content: (
              <>
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
              </>
            ),
          },
          {
            id: 'history',
            title: 'Cierres registrados',
            eyebrow: 'Historial',
            helper: 'Aperturas, cierres y diferencias auditadas',
            content: (
              <div className="accounting-list">
                {closuresForDay.map((closure) => (
                  <article key={closure.id} className="accounting-row accounting-row--actions">
                    <div className="accounting-row__main"><strong>{formatTimestamp(closure.closureDate)}</strong><small>{closure.movementIds.length} movimientos - inicial {formatCurrency(closure.openingBalanceMinor ?? 0)} - efectivo esperado {formatCurrency(closure.cashExpectedMinor)}</small></div>
                    <div className="accounting-row__meta"><span className={`status-chip status-chip--${closure.status}`}>{closure.status}</span><strong>{formatCurrency(closure.differenceMinor ?? 0)}</strong></div>
                    {closure.status === 'open' && (
                      <div className="accounting-inline-actions">
                        <label className="form-field accounting-close-field"><span>Contado</span><input value={closeAmounts[closure.id] ?? ''} onChange={(event) => setCloseAmounts((current) => ({ ...current, [closure.id]: event.target.value }))} /></label>
                        <UiActionButton type="button" onClick={() => setClosingId(closure.id)}>Cerrar caja</UiActionButton>
                      </div>
                    )}
                  </article>
                ))}
                {!loading && closuresForDay.length === 0 && <AccountingEmptyState title="Sin cierres para esta fecha" />}
              </div>
            ),
          },
        ]}
      />

      <DangerActionDialog
        open={Boolean(closingId)}
        title="Cerrar caja"
        description={
          selectedClosing
            ? `Resumen previo: esperado ${formatCurrency(selectedClosing.cashExpectedMinor)}, contado ${Number.isFinite(selectedCloseAmountMinor) ? formatCurrency(selectedCloseAmountMinor) : 'sin cargar'}, diferencia ${selectedDifferenceMinor === null ? 'sin calcular' : formatCurrency(selectedDifferenceMinor)}. El motivo queda asociado al cierre.`
            : 'Confirma el cierre con resumen previo. El monto contado y el motivo quedan asociados al cierre.'
        }
        reason={closeReason}
        confirmLabel="Cerrar caja"
        loading={closing}
        onReasonChange={setCloseReason}
        onCancel={() => setClosingId(null)}
        onConfirm={() => void closeConfirmed()}
      />
    </div>
  );
}
