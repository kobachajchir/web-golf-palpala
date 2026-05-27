import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import type { CashClosureDocument, EntityWithId, FinancialMovementDocument } from '../modules/accounting/domain/models';
import { createAccountingCallables } from '../modules/accounting/functions/accounting.callables';
import {
  createCashClosuresRepository,
  createFinancialMovementsRepository,
} from '../modules/accounting/infrastructure/firestore/repositories';
import {
  buildArgentinaDateIso,
  formatCurrency,
  formatPeriod,
  formatTimestamp,
  getCurrentAccountingPeriod,
  getSignedMovementAmount,
  normalizeAccountingPeriod,
  parseAmountInputToMinor,
} from './accountingPageUtils';

type NoticeState = {
  kind: 'success' | 'error';
  message: string;
} | null;

type ClosureFormState = {
  period: string;
  closureDate: string;
  notes: string;
};

type CashClosureSnapshot = {
  closures: Array<EntityWithId<CashClosureDocument>>;
  movements: Array<EntityWithId<FinancialMovementDocument>>;
};

const accountingCallables = createAccountingCallables();

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function groupByPaymentMethod(movements: Array<EntityWithId<FinancialMovementDocument>>) {
  const grouped = new Map<string, { label: string; amountMinor: number; count: number }>();

  movements.forEach((movement) => {
    if (movement.status === 'voided') {
      return;
    }

    const key = movement.paymentMethodCodeSnapshot ?? 'sin_medio';
    const current = grouped.get(key) ?? {
      label: key.replaceAll('_', ' '),
      amountMinor: 0,
      count: 0,
    };
    current.amountMinor += getSignedMovementAmount(movement);
    current.count += 1;
    grouped.set(key, current);
  });

  return [...grouped.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor));
}

export function AccountingCashClosures() {
  const { interfaceMode } = useAuth();
  const canManageCash = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;
  const [form, setForm] = useState<ClosureFormState>({
    period: getCurrentAccountingPeriod(),
    closureDate: todayInputValue(),
    notes: '',
  });
  const [snapshot, setSnapshot] = useState<CashClosureSnapshot>({ closures: [], movements: [] });
  const [closeAmounts, setCloseAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);

  const loadClosures = useCallback(async () => {
    if (!canManageCash) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      const cashClosuresRepository = createCashClosuresRepository();
      const movementsRepository = createFinancialMovementsRepository();
      const [closures, movements] = await Promise.all([
        cashClosuresRepository.listByPeriod(form.period),
        movementsRepository.listByAccountingPeriod(form.period),
      ]);
      setSnapshot({ closures, movements });
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos cargar los cierres de caja.',
      });
    } finally {
      setLoading(false);
    }
  }, [canManageCash, form.period]);

  useEffect(() => {
    void loadClosures();
  }, [loadClosures]);

  const paymentBuckets = useMemo(() => groupByPaymentMethod(snapshot.movements), [snapshot.movements]);
  const expectedCashMinor = useMemo(
    () =>
      snapshot.movements
        .filter((movement) => movement.status !== 'voided' && movement.paymentMethodCodeSnapshot === 'cash')
        .reduce((total, movement) => total + getSignedMovementAmount(movement), 0),
    [snapshot.movements],
  );

  const handleCreateClosure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittingAction('create');
    setNotice(null);

    try {
      const result = await accountingCallables.createCashClosure({
        period: normalizeAccountingPeriod(form.period),
        closureDate: buildArgentinaDateIso(form.closureDate),
        notes: form.notes.trim() || null,
      });
      setNotice({
        kind: 'success',
        message: `Cierre abierto. Efectivo esperado: ${formatCurrency(result.cashExpectedMinor)} (${result.movementCount} movimientos).`,
      });
      await loadClosures();
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos abrir el cierre de caja.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleCloseClosure = async (cashClosureId: string) => {
    const amountMinor = parseAmountInputToMinor(closeAmounts[cashClosureId] ?? '');
    if (!Number.isFinite(amountMinor)) {
      setNotice({ kind: 'error', message: 'Ingresa el efectivo contado para cerrar la caja.' });
      return;
    }

    setSubmittingAction(`close-${cashClosureId}`);
    setNotice(null);

    try {
      const result = await accountingCallables.closeCashClosure({
        cashClosureId,
        cashCountedMinor: amountMinor,
      });
      setNotice({
        kind: 'success',
        message: `Caja cerrada con diferencia ${formatCurrency(result.differenceMinor)}.`,
      });
      await loadClosures();
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos cerrar la caja.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  if (!canManageCash) {
    return <div className="empty-state">El cierre de caja esta disponible para administracion y Comité Ejecutivo.</div>;
  }

  return (
    <div className="page-container accounting-page">
      <div className="accounting-shell">
        <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <p className="eyebrow">Administracion</p>
            <h1>Cierres de caja</h1>
            <p>Cada cierre agrupa movimientos reales, compara efectivo esperado contra contado y deja trazabilidad diaria.</p>
          </div>
          <div className="accounting-hero__controls">
            <label className="form-field accounting-period-field">
              <span>Periodo</span>
              <input
                type="month"
                value={form.period}
                onChange={(event) => setForm((current) => ({ ...current, period: event.target.value }))}
              />
            </label>
            <div className="accounting-hero__actions">
              <Link className="btn-secondary" to="/accounting">
                Operacion contable
              </Link>
              <Link className="btn-secondary" to="/accounting/stats">
                Estadisticas
              </Link>
            </div>
          </div>
        </section>

        {notice && <div className={notice.kind === 'error' ? 'error-message' : 'accounting-success'}>{notice.message}</div>}
        {loading && (
          <div className="loading-state loading-state--inline accounting-loading-inline">
            <span className="loading-spinner" />
            <strong>Obteniendo cierres</strong>
          </div>
        )}

        <div className="accounting-layout">
          <section className="floating-card accounting-primary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Abrir arqueo</p>
                <h2>Cierre de {formatPeriod(form.period)}</h2>
              </div>
            </div>

            <form className="accounting-entry-form" onSubmit={handleCreateClosure}>
              <label className="form-field">
                <span>Fecha de cierre</span>
                <input
                  type="date"
                  value={form.closureDate}
                  onChange={(event) => setForm((current) => ({ ...current, closureDate: event.target.value }))}
                />
              </label>

              <label className="form-field">
                <span>Efectivo esperado estimado</span>
                <input value={formatCurrency(expectedCashMinor)} readOnly />
              </label>

              <label className="form-field">
                <span>Notas</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </label>

              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={submittingAction === 'create'}>
                  {submittingAction === 'create' ? 'Abriendo...' : 'Abrir cierre'}
                </button>
              </div>
            </form>
          </section>

          <section className="floating-card accounting-secondary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Medios de pago</p>
                <h2>Caja discriminada</h2>
              </div>
            </div>

            <div className="accounting-list">
              {paymentBuckets.map((bucket) => (
                <article key={bucket.key} className="accounting-row">
                  <div className="accounting-row__main">
                    <strong>{bucket.label}</strong>
                    <small>{bucket.count} movimientos del periodo</small>
                  </div>
                  <div className="accounting-row__meta">
                    <strong>{formatCurrency(bucket.amountMinor)}</strong>
                  </div>
                </article>
              ))}
              {!loading && paymentBuckets.length === 0 && (
                <div className="empty-state empty-state--inline">No hay movimientos para discriminar.</div>
              )}
            </div>
          </section>
        </div>

        <section className="floating-card accounting-primary-panel">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Historial</p>
              <h2>Cierres registrados</h2>
            </div>
          </div>

          <div className="accounting-list">
            {snapshot.closures.map((closure) => (
              <article key={closure.id} className="accounting-row accounting-row--actions">
                <div className="accounting-row__main">
                  <strong>{formatTimestamp(closure.closureDate)}</strong>
                  <small>
                    {closure.movementIds.length} movimientos - esperado {formatCurrency(closure.cashExpectedMinor)}
                  </small>
                </div>
                <div className="accounting-row__meta">
                  <span className={`status-chip status-chip--${closure.status}`}>{closure.status}</span>
                  <strong>{formatCurrency(closure.differenceMinor ?? 0)}</strong>
                  <small>Diferencia</small>
                </div>
                {closure.status === 'open' && (
                  <div className="accounting-inline-actions">
                    <label className="form-field accounting-close-field">
                      <span>Contado</span>
                      <input
                        value={closeAmounts[closure.id] ?? ''}
                        onChange={(event) =>
                          setCloseAmounts((current) => ({ ...current, [closure.id]: event.target.value }))
                        }
                        placeholder="0"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={submittingAction === `close-${closure.id}`}
                      onClick={() => void handleCloseClosure(closure.id)}
                    >
                      {submittingAction === `close-${closure.id}` ? 'Cerrando...' : 'Cerrar caja'}
                    </button>
                  </div>
                )}
              </article>
            ))}

            {!loading && snapshot.closures.length === 0 && (
              <div className="empty-state empty-state--inline">Todavia no hay cierres para este periodo.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
