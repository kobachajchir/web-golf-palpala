import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import type {
  EntityWithId,
  FinancialMovementDocument,
  MemberFeeChargeDocument,
  SalaryPaymentDocument,
} from '../modules/accounting/domain/models';
import {
  createFinancialMovementsRepository,
  createMemberFeeChargesRepository,
  createSalaryPaymentsRepository,
} from '../modules/accounting/infrastructure/firestore/repositories';
import {
  formatCurrency,
  formatPeriod,
  formatTimestamp,
  getCurrentAccountingPeriod,
  getMovementLabel,
  getSignedMovementAmount,
  normalizeAccountingPeriod,
} from './accountingPageUtils';

type NoticeState = {
  kind: 'error' | 'success';
  message: string;
} | null;

type StatsBucket = {
  key: string;
  label: string;
  amountMinor: number;
  count: number;
};

type StatsSnapshot = {
  movements: Array<EntityWithId<FinancialMovementDocument>>;
  feeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
  salaryPayments: Array<EntityWithId<SalaryPaymentDocument>>;
};

const EMPTY_SNAPSHOT: StatsSnapshot = {
  movements: [],
  feeCharges: [],
  salaryPayments: [],
};

function groupMovements(
  movements: Array<EntityWithId<FinancialMovementDocument>>,
  getKey: (movement: EntityWithId<FinancialMovementDocument>) => string,
  getLabel: (movement: EntityWithId<FinancialMovementDocument>) => string,
): StatsBucket[] {
  const grouped = new Map<string, StatsBucket>();

  movements.forEach((movement) => {
    const key = getKey(movement);
    const current = grouped.get(key) ?? { key, label: getLabel(movement), amountMinor: 0, count: 0 };
    current.amountMinor += getSignedMovementAmount(movement);
    current.count += 1;
    grouped.set(key, current);
  });

  return [...grouped.values()].sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor));
}

function totalByType(movements: Array<EntityWithId<FinancialMovementDocument>>, movementType: 'income' | 'expense') {
  return movements
    .filter((movement) => movement.movementType === movementType && movement.status !== 'voided')
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
}

function StatCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function BucketList({
  title,
  buckets,
  emptyLabel,
}: {
  title: string;
  buckets: StatsBucket[];
  emptyLabel: string;
}) {
  const maxAmount = Math.max(...buckets.map((bucket) => Math.abs(bucket.amountMinor)), 1);

  return (
    <section className="floating-card accounting-secondary-panel">
      <div className="accounting-section-header">
        <div>
          <p className="eyebrow">Discriminado</p>
          <h2>{title}</h2>
        </div>
      </div>

      <div className="accounting-bars-grid">
        {buckets.map((bucket) => (
          <article key={bucket.key} className="accounting-stat-bar">
            <div className="accounting-stat-bar__header">
              <strong>{bucket.label}</strong>
              <span>{formatCurrency(bucket.amountMinor)}</span>
            </div>
            <div className="accounting-stat-bar__track" aria-hidden="true">
              <span
                className="accounting-stat-bar__fill"
                style={{ width: `${Math.max((Math.abs(bucket.amountMinor) / maxAmount) * 100, 8)}%` }}
              />
            </div>
            <small>{bucket.count} movimientos</small>
          </article>
        ))}

        {buckets.length === 0 && <div className="empty-state empty-state--inline">{emptyLabel}</div>}
      </div>
    </section>
  );
}

export function AccountingStats() {
  const { interfaceMode } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState(getCurrentAccountingPeriod());
  const [snapshot, setSnapshot] = useState<StatsSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState>(null);

  const isDirectivo = interfaceMode === ROLES.DIRECTIVO;
  const canSeeStats = interfaceMode === ROLES.ADMINISTRATIVO || isDirectivo;

  const loadStats = useCallback(async () => {
    if (!canSeeStats) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      const movementsRepository = createFinancialMovementsRepository();
      const feeChargesRepository = createMemberFeeChargesRepository();
      const salaryPaymentsRepository = createSalaryPaymentsRepository();

      const [movements, feeCharges, salaryPayments] = await Promise.all([
        movementsRepository.listByAccountingPeriod(selectedPeriod),
        feeChargesRepository.listByPeriod(selectedPeriod),
        isDirectivo ? salaryPaymentsRepository.listByPeriod(selectedPeriod) : Promise.resolve([]),
      ]);

      setSnapshot({ movements, feeCharges, salaryPayments });
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No pudimos cargar las estadisticas contables.',
      });
    } finally {
      setLoading(false);
    }
  }, [canSeeStats, isDirectivo, selectedPeriod]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const postedMovements = useMemo(
    () => snapshot.movements.filter((movement) => movement.status !== 'voided'),
    [snapshot.movements],
  );
  const incomeTotalMinor = useMemo(() => totalByType(postedMovements, 'income'), [postedMovements]);
  const expenseTotalMinor = useMemo(() => totalByType(postedMovements, 'expense'), [postedMovements]);
  const bankedTotalMinor = useMemo(
    () =>
      postedMovements
        .filter((movement) => movement.bancarizado)
        .reduce((total, movement) => total + getSignedMovementAmount(movement), 0),
    [postedMovements],
  );
  const cashTotalMinor = useMemo(
    () =>
      postedMovements
        .filter((movement) => !movement.bancarizado)
        .reduce((total, movement) => total + getSignedMovementAmount(movement), 0),
    [postedMovements],
  );
  const creditCommissionTotalMinor = useMemo(
    () => postedMovements.reduce((total, movement) => total + (movement.appliedCommissionAmountMinor ?? 0), 0),
    [postedMovements],
  );
  const pendingFeesMinor = useMemo(
    () =>
      snapshot.feeCharges
        .filter((charge) => charge.status === 'pending' || charge.status === 'overdue')
        .reduce((total, charge) => total + charge.finalAmountMinor, 0),
    [snapshot.feeCharges],
  );
  const salaryTotalMinor = useMemo(
    () => snapshot.salaryPayments.reduce((total, payment) => total + payment.salaryGrossMinor, 0),
    [snapshot.salaryPayments],
  );
  const byCategory = useMemo(
    () =>
      groupMovements(
        postedMovements,
        (movement) => movement.categoryCodeSnapshot,
        (movement) => getMovementLabel(movement),
      ),
    [postedMovements],
  );
  const byPaymentMethod = useMemo(
    () =>
      groupMovements(
        postedMovements,
        (movement) => movement.paymentMethodCodeSnapshot ?? 'sin_medio',
        (movement) => (movement.paymentMethodCodeSnapshot ?? 'sin medio').replaceAll('_', ' '),
      ),
    [postedMovements],
  );

  if (!canSeeStats) {
    return <div className="empty-state">Las estadisticas contables estan disponibles para administracion y Comité Ejecutivo.</div>;
  }

  return (
    <div className="page-container accounting-page">
      <div className="accounting-shell">
        <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <p className="eyebrow">{isDirectivo ? 'Comité Ejecutivo' : 'Administracion'}</p>
            <h1>Estadisticas contables</h1>
            <p>
              Flujo de caja, movimientos por categoria y pagos discriminados por medio para {formatPeriod(selectedPeriod)}.
            </p>
          </div>
          <div className="accounting-hero__controls">
            <label className="form-field accounting-period-field">
              <span>Periodo</span>
              <input
                type="month"
                value={selectedPeriod}
                onChange={(event) => setSelectedPeriod(normalizeAccountingPeriod(event.target.value))}
              />
            </label>
            <div className="accounting-hero__actions">
              <Link className="btn-secondary" to="/accounting">
                Operacion contable
              </Link>
              <Link className="btn-secondary" to="/accounting/cash-closures">
                Cierres de caja
              </Link>
            </div>
          </div>
        </section>

        {notice && <div className={notice.kind === 'error' ? 'error-message' : 'accounting-success'}>{notice.message}</div>}
        {loading && (
          <div className="loading-state loading-state--inline accounting-loading-inline">
            <span className="loading-spinner" />
            <strong>Calculando indicadores</strong>
          </div>
        )}

        <section className="floating-card accounting-primary-panel">
          <div className="summary-grid accounting-summary-grid">
            <StatCard label="Ingresos" value={formatCurrency(incomeTotalMinor)} helper="Entradas netas del periodo" />
            <StatCard label="Egresos" value={formatCurrency(expenseTotalMinor)} helper="Salidas netas del periodo" />
            <StatCard label="Caja neta" value={formatCurrency(incomeTotalMinor - expenseTotalMinor)} helper="Resultado operativo" />
            <StatCard label="Bancarizado" value={formatCurrency(bankedTotalMinor)} helper="Transferencia, credito y bancos" />
            <StatCard label="No bancarizado" value={formatCurrency(cashTotalMinor)} helper="Efectivo y horas extra" />
            <StatCard label="Cuotas pendientes" value={formatCurrency(pendingFeesMinor)} helper="Cargos aun no cobrados" />
            <StatCard label="Comisiones credito" value={formatCurrency(creditCommissionTotalMinor)} helper="Costo financiero snapshot" />
            {isDirectivo && (
              <StatCard label="Sueldos" value={formatCurrency(salaryTotalMinor)} helper="Liquidaciones visibles del periodo" />
            )}
          </div>
        </section>

        <BucketList title="Movimientos por categoria" buckets={byCategory} emptyLabel="Sin movimientos para este periodo." />
        <BucketList title="Pagos por medio" buckets={byPaymentMethod} emptyLabel="Sin medios de pago registrados." />

        <section className="floating-card accounting-secondary-panel">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Ultimos movimientos</p>
              <h2>Trazabilidad del periodo</h2>
            </div>
          </div>

          <div className="accounting-list">
            {postedMovements.slice(0, 12).map((movement) => (
              <article key={movement.id} className="accounting-row">
                <div className="accounting-row__main">
                  <strong>{getMovementLabel(movement)}</strong>
                  <small>
                    {movement.movementType === 'income' ? 'Ingreso' : 'Egreso'}
                    {' - '}
                    {(movement.paymentMethodCodeSnapshot ?? 'sin medio').replaceAll('_', ' ')}
                  </small>
                </div>
                <div className="accounting-row__meta">
                  <strong>{formatCurrency(getSignedMovementAmount(movement))}</strong>
                  <small>{formatTimestamp(movement.operationDate)}</small>
                </div>
              </article>
            ))}

            {!loading && postedMovements.length === 0 && (
              <div className="empty-state empty-state--inline">Todavia no hay movimientos en este periodo.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
