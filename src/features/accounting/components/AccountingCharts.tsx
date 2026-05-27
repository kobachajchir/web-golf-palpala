import { formatCurrency } from '../utils/accountingFormatters';

export type ChartDatum = {
  label: string;
  valueMinor: number;
};

const PIE_COLORS = ['#0f7a5a', '#2a6cb0', '#d39b0f', '#8f4aa8', '#64748b', '#b45309'];

function normalizeData(data: ChartDatum[]) {
  return data
    .filter((item) => Number.isFinite(item.valueMinor) && item.valueMinor > 0)
    .sort((left, right) => right.valueMinor - left.valueMinor)
    .slice(0, 6);
}

export function AccountingPieChart({ title, data }: { title: string; data: ChartDatum[] }) {
  const normalized = normalizeData(data);
  const total = normalized.reduce((sum, item) => sum + item.valueMinor, 0);
  let cursor = 0;
  const gradient = total > 0
    ? normalized
        .map((item, index) => {
          const start = cursor;
          cursor += (item.valueMinor / total) * 100;
          return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${cursor}%`;
        })
        .join(', ')
    : '#e2e8f0 0 100%';

  return (
    <article className="accounting-chart-card">
      <div>
        <p className="eyebrow">Distribucion</p>
        <h3>{title}</h3>
      </div>
      <div className="accounting-pie-chart" style={{ background: `conic-gradient(${gradient})` }}>
        <span>{total > 0 ? formatCurrency(total) : 'Sin datos'}</span>
      </div>
      <div className="accounting-chart-legend">
        {normalized.map((item, index) => (
          <span key={item.label}>
            <i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
            {item.label}
            <strong>{formatCurrency(item.valueMinor)}</strong>
          </span>
        ))}
        {normalized.length === 0 && <small>No hay movimientos para este periodo.</small>}
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
              <i style={{ width: `${Math.max((Math.abs(item.valueMinor) / maxValue) * 100, item.valueMinor === 0 ? 0 : 4)}%` }} />
            </div>
            <strong>{formatCurrency(item.valueMinor)}</strong>
          </div>
        ))}
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
