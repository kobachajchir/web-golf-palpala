import type { ReactNode } from 'react';
import { formatCurrency } from '../utils/accountingFormatters';

export type ChartDatum = {
  label: string;
  valueMinor: number;
  color?: string;
};

export type VerticalTrendDatum = {
  label: string;
  incomeMinor: number;
  expenseMinor: number;
};

const PIE_COLORS = ['#0f7a5a', '#2a6cb0', '#d39b0f', '#8f4aa8', '#64748b', '#b45309'];

function normalizeData(data: ChartDatum[]) {
  return data
    .filter((item) => Number.isFinite(item.valueMinor) && item.valueMinor > 0)
    .sort((left, right) => right.valueMinor - left.valueMinor)
    .slice(0, 6);
}

export function AccountingPieChart({ title, data, colors = PIE_COLORS }: { title: string; data: ChartDatum[]; colors?: string[] }) {
  const normalized = normalizeData(data);
  const total = normalized.reduce((sum, item) => sum + item.valueMinor, 0);
  let cursor = 0;
  const gradient = total > 0
    ? normalized
        .map((item, index) => {
          const start = cursor;
          cursor += (item.valueMinor / total) * 100;
          return `${item.color ?? colors[index % colors.length]} ${start}% ${cursor}%`;
        })
        .join(', ')
    : '#e2e8f0 0 100%';

  return (
    <article className="accounting-chart-card">
      <div className="accounting-chart-card__heading">
        <p className="eyebrow">Distribucion</p>
        <h3>{title}</h3>
      </div>
      <div className="accounting-pie-chart" style={{ background: `conic-gradient(${gradient})` }}>
        <span>{total > 0 ? formatCurrency(total) : 'Sin datos'}</span>
      </div>
      <div className="accounting-chart-legend">
        {normalized.map((item, index) => (
          <span key={item.label}>
            <i style={{ background: item.color ?? colors[index % colors.length] }} />
            {item.label}
            <strong>{formatCurrency(item.valueMinor)}</strong>
          </span>
        ))}
        {normalized.length === 0 && <small>No hay movimientos para este periodo.</small>}
      </div>
      <div className="accounting-chart-summary">
        <table className="accounting-chart-summary__table">
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Monto</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {normalized.map((item) => (
              <tr key={item.label}>
                <td>{item.label}</td>
                <td>{formatCurrency(item.valueMinor)}</td>
                <td>{total > 0 ? `${Math.round((item.valueMinor / total) * 100)}%` : '0%'}</td>
              </tr>
            ))}
            {normalized.length === 0 && (
              <tr>
                <td colSpan={3}>Sin movimientos para este periodo.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function AccountingBarChart({ title, data }: { title: string; data: ChartDatum[] }) {
  const values = data.map((item) => Math.abs(item.valueMinor));
  const maxValue = Math.max(...values, 1);

  return (
    <article className="accounting-chart-card accounting-chart-card--wide">
      <div>
        <p className="eyebrow">Estadisticas</p>
        <h3>{title}</h3>
      </div>
      <div className="accounting-bar-chart" role="img" aria-label={title}>
        {data.map((item) => (
          <div key={item.label} className="accounting-bar-chart__row">
            <span>{item.label}</span>
            <div className="accounting-bar-chart__track">
              <i
                style={{
                  width: `${Math.max((Math.abs(item.valueMinor) / maxValue) * 100, item.valueMinor === 0 ? 0 : 4)}%`,
                  background: item.color ?? (item.valueMinor < 0 ? '#b42318' : '#0f7a5a'),
                }}
              />
            </div>
            <strong>{formatCurrency(item.valueMinor)}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

export function AccountingVerticalTrendChart({
  title,
  data,
  showIncome,
  showExpense,
  toolbar,
}: {
  title: string;
  data: VerticalTrendDatum[];
  showIncome: boolean;
  showExpense: boolean;
  toolbar?: ReactNode;
}) {
  const visibleValues = data.flatMap((item) => [
    showIncome ? item.incomeMinor : 0,
    showExpense ? item.expenseMinor : 0,
  ]);
  const maxValue = Math.max(...visibleValues, 1);
  const hasData = data.some((item) => (showIncome && item.incomeMinor > 0) || (showExpense && item.expenseMinor > 0));

  return (
    <article className="accounting-chart-card accounting-chart-card--wide accounting-vertical-trend-card">
      {toolbar}
      <div className="accounting-chart-card__heading">
        <p className="eyebrow">Estadisticas</p>
        <h3>{title}</h3>
      </div>
      <div className="accounting-vertical-trend-chart" role="img" aria-label={title}>
        {data.map((item) => {
          const netMinor = item.incomeMinor - item.expenseMinor;
          return (
            <div key={item.label} className="accounting-vertical-trend-chart__bucket">
              <div className="accounting-vertical-trend-chart__bars">
                {showIncome && (
                  <i
                    className="accounting-vertical-trend-chart__bar accounting-vertical-trend-chart__bar--income"
                    style={{ height: `${Math.max((item.incomeMinor / maxValue) * 100, item.incomeMinor === 0 ? 0 : 5)}%` }}
                    title={`Ingresos ${item.label}: ${formatCurrency(item.incomeMinor)}`}
                  />
                )}
                {showExpense && (
                  <i
                    className="accounting-vertical-trend-chart__bar accounting-vertical-trend-chart__bar--expense"
                    style={{ height: `${Math.max((item.expenseMinor / maxValue) * 100, item.expenseMinor === 0 ? 0 : 5)}%` }}
                    title={`Egresos ${item.label}: ${formatCurrency(item.expenseMinor)}`}
                  />
                )}
              </div>
              <strong>{item.label}</strong>
              <small>{formatCurrency(netMinor)}</small>
            </div>
          );
        })}
        {!hasData && <span className="accounting-vertical-trend-chart__empty">Sin datos para las series seleccionadas.</span>}
      </div>
      <div className="accounting-chart-legend accounting-chart-legend--inline">
        {showIncome && <span><i style={{ background: '#0f7a5a' }} />Ingresos</span>}
        {showExpense && <span><i style={{ background: '#b42318' }} />Egresos</span>}
      </div>
    </article>
  );
}

export function AccountingLineChart({ title, data }: { title: string; data: ChartDatum[] }) {
  const maxValue = Math.max(...data.map((item) => Math.abs(item.valueMinor)), 1);
  const points = data.map((item, index) => {
    const x = data.length <= 1 ? 50 : (index / (data.length - 1)) * 100;
    const y = 92 - (Math.abs(item.valueMinor) / maxValue) * 78;
    return `${x},${y}`;
  }).join(' ');

  return (
    <article className="accounting-chart-card accounting-chart-card--wide">
      <div>
        <p className="eyebrow">Tendencia</p>
        <h3>{title}</h3>
      </div>
      <svg className="accounting-line-chart" viewBox="0 0 100 100" role="img" aria-label={title}>
        <polyline points={points} />
        {data.map((item, index) => {
          const [x, y] = (points.split(' ')[index] ?? '0,0').split(',').map(Number);
          return <circle key={item.label} cx={x} cy={y} r="2.4" />;
        })}
      </svg>
      <div className="accounting-chart-legend accounting-chart-legend--inline">
        {data.map((item) => <span key={item.label}>{item.label}<strong>{formatCurrency(item.valueMinor)}</strong></span>)}
      </div>
    </article>
  );
}
