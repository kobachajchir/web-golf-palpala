import { useState } from 'react';
import { AccountingBarChart, AccountingLineChart } from '../components/AccountingCharts';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingHeaderSummary } from '../components/AccountingHeaderSummary';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { AccountingPeriodTabs } from '../components/AccountingPeriodTabs';
import { SettlementReconciliationTable } from '../components/SettlementReconciliationTable';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import { useSettlements } from '../hooks/useSettlements';
import { formatCurrency, getCurrentAccountingPeriod, normalizeAccountingPeriod, shiftAccountingPeriod } from '../utils/accountingFormatters';

function buildPeriodOptions(period: string) {
  const normalized = normalizeAccountingPeriod(period);
  return [0, -1, -2, -3, -4, -5].map((offset) => shiftAccountingPeriod(normalized, offset));
}

export function AccountingBankSettlementsPage() {
  const [period, setPeriod] = useState(getCurrentAccountingPeriod());
  const summaryState = useAccountingSummary(period);
  const settlementsState = useSettlements(period);

  const grossMinor = settlementsState.settlements.reduce((total, settlement) => total + settlement.grossAmountMinor, 0);
  const netMinor = settlementsState.settlements.reduce((total, settlement) => total + settlement.netAmountMinor, 0);
  const commissionMinor = settlementsState.settlements.reduce((total, settlement) => total + settlement.commissionAmountMinor, 0);
  const periodOptions = buildPeriodOptions(period);
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
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Conciliacion</p>
          <h1>Liquidaciones Mercado Pago, Macro y bancos</h1>
          <p>Diferencia facturacion/cobro contra dinero efectivamente liberado.</p>
        </div>
        <div className="accounting-hero__controls">
          <AccountingMonthPicker period={normalizeAccountingPeriod(period)} onChange={setPeriod} />
          <AccountingPeriodTabs periods={periodOptions} activePeriod={normalizeAccountingPeriod(period)} onChange={setPeriod} />
        </div>
      </section>

      <AccountingInlineNotice notice={summaryState.error ? { kind: 'error', message: summaryState.error } : settlementsState.error ? { kind: 'error', message: settlementsState.error } : null} />
      <AccountingHeaderSummary summary={summaryState.summary} />

      <AccountingCollapsibleSections
        initialOpenId="stats"
        sections={[
          {
            id: 'stats',
            title: 'Estadisticas de liquidaciones',
            eyebrow: 'Liquidaciones',
            helper: 'Bruto, comisiones, liberado y tendencia',
            content: (
              <>
                <section className="summary-grid accounting-summary-grid">
                  <article className="summary-card"><span>Facturado/cobrado</span><strong>{formatCurrency(grossMinor)}</strong><small>Bruto proveedor</small></article>
                  <article className="summary-card"><span>Comisiones</span><strong>{formatCurrency(commissionMinor)}</strong><small>Descuento proveedor</small></article>
                  <article className="summary-card"><span>Liberado</span><strong>{formatCurrency(netMinor)}</strong><small>Disponible en cuenta</small></article>
                </section>
                <div className="accounting-chart-grid">
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
              </>
            ),
          },
          {
            id: 'reconciliation',
            title: 'Conciliacion de liquidaciones',
            eyebrow: 'Estados',
            helper: 'Mercado Pago, Macro, diferencias y estados',
            content: <SettlementReconciliationTable settlements={settlementsState.settlements} onUpdated={() => void settlementsState.reload()} />,
          },
        ]}
      />
    </div>
  );
}
