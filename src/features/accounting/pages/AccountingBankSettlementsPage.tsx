import { useState } from 'react';
import { AccountingBarChart, AccountingLineChart } from '../components/AccountingCharts';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingHeaderSummary } from '../components/AccountingHeaderSummary';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { SettlementReconciliationTable } from '../components/SettlementReconciliationTable';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import { useSettlements } from '../hooks/useSettlements';
import { formatCurrency, getCurrentAccountingPeriod, normalizeAccountingPeriod } from '../utils/accountingFormatters';

function groupSettlementsByBank(settlements: ReturnType<typeof useSettlements>['settlements']) {
  const grouped = new Map<string, { bankName: string; grossMinor: number; commissionMinor: number; netMinor: number; count: number }>();
  settlements.forEach((settlement) => {
    const current = grouped.get(settlement.bankName) ?? {
      bankName: settlement.bankName,
      grossMinor: 0,
      commissionMinor: 0,
      netMinor: 0,
      count: 0,
    };
    current.grossMinor += settlement.grossAmountMinor;
    current.commissionMinor += settlement.commissionAmountMinor;
    current.netMinor += settlement.netAmountMinor;
    current.count += 1;
    grouped.set(settlement.bankName, current);
  });
  return [...grouped.values()].sort((left, right) => right.netMinor - left.netMinor);
}

export function AccountingBankSettlementsPage() {
  const [period, setPeriod] = useState(getCurrentAccountingPeriod());
  const summaryState = useAccountingSummary(period);
  const settlementsState = useSettlements(period);

  const grossMinor = settlementsState.settlements.reduce((total, settlement) => total + settlement.grossAmountMinor, 0);
  const netMinor = settlementsState.settlements.reduce((total, settlement) => total + settlement.netAmountMinor, 0);
  const commissionMinor = settlementsState.settlements.reduce((total, settlement) => total + settlement.commissionAmountMinor, 0);
  const settlementsByBank = groupSettlementsByBank(settlementsState.settlements);
  const lineData = settlementsState.settlements.slice(0, 6).reverse().map((settlement) => ({
    label: settlement.externalBatchRef,
    valueMinor: settlement.netAmountMinor,
  }));
  const statusData = Object.entries(
    settlementsState.settlements.reduce<Record<string, number>>((grouped, settlement) => {
      grouped[settlement.status] = (grouped[settlement.status] ?? 0) + settlement.netAmountMinor;
      return grouped;
    }, {}),
  ).map(([label, valueMinor]) => ({ label, valueMinor }));

  return (
    <div className="accounting-shell accounting-bank-settlements-page">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <h1>Liquidaciones bancarias</h1>
        </div>
        <div className="accounting-hero__controls">
          <AccountingMonthPicker period={normalizeAccountingPeriod(period)} onChange={setPeriod} />
        </div>
      </section>

      <AccountingInlineNotice notice={summaryState.error ? { kind: 'error', message: summaryState.error } : settlementsState.error ? { kind: 'error', message: settlementsState.error } : null} />
      <AccountingHeaderSummary summary={summaryState.summary} />

      <section className="summary-grid accounting-summary-grid accounting-bank-settlements-summary" aria-label="Resumen de liquidaciones bancarias">
        <article className="summary-card"><span>Facturado/cobrado</span><strong>{formatCurrency(grossMinor)}</strong><small>Bruto proveedor</small></article>
        <article className="summary-card"><span>Comisiones</span><strong>{formatCurrency(commissionMinor)}</strong><small>Descuento proveedor</small></article>
        <article className="summary-card"><span>Liberado</span><strong>{formatCurrency(netMinor)}</strong><small>Disponible en cuenta</small></article>
        <article className="summary-card"><span>Liquidaciones</span><strong>{settlementsState.settlements.length}</strong><small>Del periodo</small></article>
      </section>

      <div className="accounting-bank-settlements-sections">
        <AccountingCollapsibleSections
          sections={[
            {
              id: 'stats',
              title: 'Estadisticas',
              eyebrow: 'Liquidaciones',
              helper: 'Bruto, comisiones, liberado y tendencia',
              content: (
                <div className="accounting-full-width-section accounting-bank-settlements-stats-section">
                  <div className="accounting-chart-grid accounting-bank-settlements-chart-grid">
                    <AccountingBarChart
                      title="Bruto, comisiones y liberado"
                      data={[
                        { label: 'Bruto', valueMinor: grossMinor },
                        { label: 'Comisiones', valueMinor: commissionMinor },
                        { label: 'Liberado', valueMinor: netMinor },
                      ]}
                    />
                    <AccountingLineChart title="Liberado por liquidacion" data={lineData.length ? lineData : [{ label: 'Sin datos', valueMinor: 0 }]} />
                    <AccountingBarChart title="Liberado por estado" data={statusData.length ? statusData : [{ label: 'Sin datos', valueMinor: 0 }]} />
                  </div>
                  <section className="accounting-settlement-breakdown accounting-bank-settlements-breakdown">
                    <div className="accounting-section-header accounting-section-header--plain">
                      <h3>Liquidaciones por medio de pago</h3>
                    </div>
                    <div className="accounting-list accounting-bank-settlements-bank-list">
                      {settlementsByBank.map((row) => (
                        <article key={row.bankName} className="accounting-row accounting-bank-settlement-bank-row">
                          <span className="accounting-row__main">
                            <strong>{row.bankName}</strong>
                            <small>{row.count} liquidacion{row.count === 1 ? '' : 'es'}</small>
                          </span>
                          <span className="accounting-row__meta">
                            <small>Bruto</small>
                            <strong>{formatCurrency(row.grossMinor)}</strong>
                          </span>
                          <span className="accounting-row__meta">
                            <small>Comision</small>
                            <strong>{formatCurrency(row.commissionMinor)}</strong>
                          </span>
                          <span className="accounting-row__meta">
                            <small>Liberado</small>
                            <strong>{formatCurrency(row.netMinor)}</strong>
                          </span>
                        </article>
                      ))}
                      {settlementsByBank.length === 0 && <div className="empty-state empty-state--inline">Sin liquidaciones para el periodo.</div>}
                    </div>
                  </section>
                </div>
              ),
            },
            {
              id: 'reconciliation',
              title: 'Historial',
              eyebrow: 'Liquidaciones',
              helper: 'Macro, Galicia, diferencias y estados',
              content: (
                <div className="accounting-full-width-section accounting-bank-settlements-history-section">
                  <SettlementReconciliationTable settlements={settlementsState.settlements} onUpdated={() => void settlementsState.reload()} />
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
