import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createEmployeePayrollCyclesRepository, createEmployeeAccountingLinksRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { EmployeeAccountingLinkDocument, EmployeePayrollCycleDocument, EntityWithId } from '../../../modules/accounting/domain/models';
import type { EmployeeDocument } from '../../../modules/users/domain/models';
import { createEmployeesRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import { AccountingBarChart } from '../components/AccountingCharts';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import type { AccountingNotice } from '../types/accounting';
import { formatCurrency, formatPeriod, getCurrentAccountingPeriod, normalizeAccountingPeriod } from '../utils/accountingFormatters';

type EmployeeRow = EntityWithId<EmployeeDocument> & {
  cycle: EntityWithId<EmployeePayrollCycleDocument> | null;
  links: Array<EntityWithId<EmployeeAccountingLinkDocument>>;
};

export function AccountingEmployeesPage() {
  const [searchParams] = useSearchParams();
  const [period, setPeriod] = useState(() => normalizeAccountingPeriod(searchParams.get('period') ?? getCurrentAccountingPeriod()));
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [openEmployeeActionsId, setOpenEmployeeActionsId] = useState<string | null>(null);
  const grossTotalMinor = rows.reduce((total, row) => total + (row.cycle?.salaryGrossMinor ?? 0), 0);
  const pendingSettlementMinor = rows
    .filter((row) => row.cycle?.status !== 'paid')
    .reduce((total, row) => total + (row.cycle?.salaryGrossMinor ?? 0), 0);
  const linkedDocsCount = rows.reduce((total, row) => total + row.links.length, 0);

  const load = async () => {
    setLoading(true);
    setNotice(null);

    try {
      const employeesRepository = createEmployeesRepository();
      const cyclesRepository = createEmployeePayrollCyclesRepository();
      const linksRepository = createEmployeeAccountingLinksRepository();
      const [employees, cycles] = await Promise.all([
        employeesRepository.listAlphabetical(100),
        cyclesRepository.listByPeriod(period),
      ]);
      const rowsWithLinks = await Promise.all(
        employees.map(async (employee) => ({
          ...employee,
          cycle: cycles.find((cycle) => cycle.employeeId === employee.id) ?? null,
          links: await linksRepository.listByEmployeeAndPeriod(employee.id, period),
        })),
      );
      setRows(rowsWithLinks);
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar empleados.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [period]);

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Empleados</p>
          <h1>Ciclos mensuales</h1>
          <p>Acceso claro a ciclo mensual, docs pendientes, liquidacion y pago.</p>
        </div>
        <div className="accounting-hero__controls">
          <AccountingMonthPicker period={normalizeAccountingPeriod(period)} onChange={setPeriod} />
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />
      {loading && <div className="loading-state loading-state--inline"><span className="loading-spinner" /><strong>Cargando empleados</strong></div>}

      <AccountingCollapsibleSections
        initialOpenId="list"
        sections={[
          {
            id: 'stats',
            title: 'Estadisticas de sueldos',
            eyebrow: 'Liquidaciones',
            helper: 'Total, pendientes y comprobantes vinculados',
            content: (
              <>
                <section className="summary-grid accounting-summary-grid">
                  <article className="summary-card"><span>Empleados</span><strong>{rows.length}</strong><small>En vista del periodo</small></article>
                  <article className="summary-card"><span>Docs vinculados</span><strong>{linkedDocsCount}</strong><small>{formatPeriod(period)}</small></article>
                </section>
                <div className="accounting-chart-grid">
                  <AccountingBarChart
                    title="Sueldos del periodo"
                    data={[
                      { label: 'Total bruto', valueMinor: grossTotalMinor },
                      { label: 'Pendiente', valueMinor: pendingSettlementMinor },
                    ]}
                  />
                </div>
              </>
            ),
          },
          {
            id: 'list',
            title: 'Empleados y ciclos mensuales',
            eyebrow: 'Ciclos',
            helper: formatPeriod(period),
            content: (
              <div className="accounting-list">
                {rows.map((employee) => (
                  <article key={employee.id} className="accounting-row accounting-row--actions accounting-employee-row">
                    <div className="accounting-row__main">
                      <strong>{employee.lastName}, {employee.firstName}</strong>
                      <small>{employee.position} - {employee.contractType} - {employee.status}</small>
                    </div>
                    <div className="accounting-row__meta">
                      <span className={`status-chip status-chip--${employee.cycle?.status ?? 'draft'}`}>{employee.cycle?.status ?? 'draft'}</span>
                      <strong>{formatCurrency(employee.cycle?.salaryGrossMinor ?? 0)}</strong>
                      <small>{employee.links.length} docs vinculados en {formatPeriod(period)}</small>
                    </div>
                    <div className="member-actions accounting-row-menu-actions">
                      <button
                        type="button"
                        className={`icon-button member-icon-button ${openEmployeeActionsId === employee.id ? 'icon-button--active' : ''}`}
                        aria-label={`Mas acciones para ${employee.lastName}, ${employee.firstName}`}
                        aria-expanded={openEmployeeActionsId === employee.id}
                        onClick={() => setOpenEmployeeActionsId((current) => current === employee.id ? null : employee.id)}
                      >
                        ...
                      </button>
                      {openEmployeeActionsId === employee.id && (
                        <div className="member-actions-menu">
                          <Link className="member-actions-menu__item" to={`/accounting/employees/${employee.id}?period=${period}`}>Abrir ciclo mensual</Link>
                          <Link className="member-actions-menu__item" to={`/accounting/employees/${employee.id}?period=${period}&section=external-docs`}>Docs pendientes</Link>
                          <Link className="member-actions-menu__item" to={`/accounting/employees/${employee.id}?period=${period}&section=settlement`}>Liquidacion</Link>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
                {!loading && rows.length === 0 && <AccountingEmptyState title="Sin empleados para mostrar" />}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
