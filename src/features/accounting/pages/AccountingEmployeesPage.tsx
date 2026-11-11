import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import { createEmployeePayrollCyclesRepository, createEmployeeAccountingLinksRepository, createSalaryConfigurationsRepository, createOvertimeEntriesRepository, createSalaryPaymentsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { EmployeeAccountingLinkDocument, EmployeePayrollCycleDocument, EntityWithId, SalaryConfigurationDocument, SalaryPaymentDocument } from '../../../modules/accounting/domain/models';
import type { EmployeeDocument } from '../../../modules/users/domain/models';
import { createEmployeesRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import { AccountingBarChart } from '../components/AccountingCharts';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import type { AccountingNotice } from '../types/accounting';
import { formatCurrency, formatPeriod, getCurrentAccountingPeriod, normalizeAccountingPeriod } from '../utils/accountingFormatters';
import { summarizeEmployeeOvertime } from '../utils/employeeOvertime';
import { withEmployeeOperationTimeout } from '../utils/employeeOperations';

type EmployeeRow = EntityWithId<EmployeeDocument> & {
  cycle: EntityWithId<EmployeePayrollCycleDocument> | null;
  salaryConfiguration: EntityWithId<SalaryConfigurationDocument> | null;
  links: Array<EntityWithId<EmployeeAccountingLinkDocument>>;
  overtime: ReturnType<typeof summarizeEmployeeOvertime>;
  salaryPayment: EntityWithId<SalaryPaymentDocument> | null;
};

function getEmployeeCycleStatusLabel(row: EmployeeRow) {
  const status = row.cycle?.status ?? row.salaryPayment?.status;
  if (!status) {
    return row.salaryConfiguration ? 'Ciclo abierto' : 'Sueldo pendiente';
  }

  switch (status) {
    case 'draft':
      return 'Ciclo abierto';
    case 'ready':
    case 'ready_to_liquidate':
      return 'Listo para liquidar';
    case 'liquidated':
      return 'Liquidado';
    case 'paid':
    case 'posted':
      return 'Pagado';
    case 'voided':
      return 'Anulado';
    default:
      return status;
  }
}

function MoreActionsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

export function AccountingEmployeesPage() {
  const { interfaceMode } = useAuth();
  const [searchParams] = useSearchParams();
  const [period, setPeriod] = useState(() => normalizeAccountingPeriod(searchParams.get('period') ?? getCurrentAccountingPeriod()));
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [openEmployeeActionsId, setOpenEmployeeActionsId] = useState<string | null>(null);
  const getEmployeeSalaryMinor = (row: EmployeeRow) => row.cycle?.salaryGrossMinor ?? row.salaryPayment?.salaryGrossMinor ?? row.salaryConfiguration?.baseAmountMinor ?? 0;
  const isSalaryPaid = (row: EmployeeRow) => row.cycle?.status === 'paid' || row.cycle?.status === 'posted' || row.salaryPayment?.status === 'paid' || row.salaryPayment?.status === 'posted';
  const canConfigureSalaries = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;
  const grossTotalMinor = rows.reduce((total, row) => total + getEmployeeSalaryMinor(row) + row.overtime.totalMinor, 0);
  const pendingSettlementMinor = rows.reduce((total, row) => total + row.overtime.pendingMinor + (isSalaryPaid(row) ? 0 : getEmployeeSalaryMinor(row)), 0);
  const overtimeTotalMinor = rows.reduce((total, row) => total + row.overtime.totalMinor, 0);
  const overtimePaidMinor = rows.reduce((total, row) => total + row.overtime.paidMinor, 0);
  const linkedDocsCount = rows.reduce((total, row) => total + row.links.length, 0);
  const missingSalaryCount = rows.filter((row) => !row.salaryConfiguration).length;
  const salaryNotice: AccountingNotice = missingSalaryCount > 0
    ? {
        kind: 'info',
        message: `${missingSalaryCount} empleado${missingSalaryCount === 1 ? '' : 's'} sin sueldo activo en Firestore. Administracion o el Comite Ejecutivo pueden completarlo desde Modificar sueldo.`,
      }
    : null;

  const load = async () => {
    setLoading(true);
    setNotice(null);

    try {
      const employeesRepository = createEmployeesRepository();
      const cyclesRepository = createEmployeePayrollCyclesRepository();
      const linksRepository = createEmployeeAccountingLinksRepository();
      const salaryConfigurationsRepository = createSalaryConfigurationsRepository();
      const overtimeRepository = createOvertimeEntriesRepository();
      const salaryPaymentsRepository = createSalaryPaymentsRepository();
      const [employees, cycles, overtimeEntries, salaryPayments] = await withEmployeeOperationTimeout(Promise.all([
        employeesRepository.listAlphabetical(100),
        cyclesRepository.listByPeriod(period),
        overtimeRepository.listByPeriod(period),
        salaryPaymentsRepository.listByPeriod(period),
      ]), 'La carga de personal no respondio a tiempo. Vuelve a intentarlo.');
      const rowsWithLinks = await withEmployeeOperationTimeout(Promise.all(
        employees.map(async (employee) => {
          const cycle = cycles.find((cycle) => cycle.employeeId === employee.id) ?? null;
          const salaryPayment = salaryPayments.find((payment) => payment.employeeId === employee.id && (payment.status === 'posted' || payment.status === 'paid')) ?? null;
          const payrollOvertimeMinor = cycle?.status === 'posted' || cycle?.status === 'paid' ? cycle.overtimeTotalMinor : salaryPayment?.overtimeAmountMinor ?? 0;
          const [salaryConfiguration, links] = await Promise.all([
            salaryConfigurationsRepository.getActiveByEmployeeId(employee.id),
            linksRepository.listByEmployeeAndPeriod(employee.id, period),
          ]);
          return {
            ...employee,
            cycle,
            salaryPayment,
            overtime: summarizeEmployeeOvertime(overtimeEntries.filter((entry) => entry.employeeId === employee.id), payrollOvertimeMinor),
            salaryConfiguration,
            links,
          };
        }),
      ), 'La carga de sueldos y horas extra no respondio a tiempo. Vuelve a intentarlo.');
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
    <div className="accounting-shell accounting-employees-page">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <h1>Empleados y sueldos</h1>
        </div>
        <div className="accounting-hero__controls">
          <AccountingMonthPicker period={normalizeAccountingPeriod(period)} onChange={setPeriod} />
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />
      <AccountingInlineNotice notice={salaryNotice} />
      {loading && <div className="loading-state loading-state--inline"><span className="loading-spinner" /><strong>Cargando empleados</strong></div>}

      <section className="summary-grid accounting-summary-grid accounting-employees-summary" aria-label="Resumen de empleados y sueldos">
        <article className="summary-card"><span>Empleados</span><strong>{rows.length}</strong><small>{formatPeriod(period)}</small></article>
        <article className="summary-card"><span>Docs vinculados</span><strong>{linkedDocsCount}</strong><small>Del periodo</small></article>
        <article className="summary-card"><span>Total bruto</span><strong>{formatCurrency(grossTotalMinor)}</strong><small>Sueldos + horas extra</small></article>
        <article className="summary-card"><span>Horas extra</span><strong>{formatCurrency(overtimeTotalMinor)}</strong><small>Del periodo, sin rechazadas</small></article>
        <article className="summary-card"><span>Horas extra pagadas</span><strong>{formatCurrency(overtimePaidMinor)}</strong><small>Con movimiento registrado</small></article>
        <article className="summary-card"><span>Pendiente</span><strong>{formatCurrency(pendingSettlementMinor)}</strong><small>No pagado</small></article>
        <article className="summary-card"><span>Sin sueldo</span><strong>{missingSalaryCount}</strong><small>Falta configurar</small></article>
      </section>

      <div className="accounting-employees-sections">
        <AccountingCollapsibleSections
          sections={[
            {
              id: 'stats',
              title: 'Estadisticas',
              eyebrow: 'Liquidaciones',
              helper: 'Total bruto y pendiente',
              content: (
                <div className="accounting-full-width-section accounting-employees-stats-section">
                  <div className="accounting-chart-grid accounting-employees-chart-grid">
                    <AccountingBarChart
                      title="Sueldos del periodo"
                      data={[
                        { label: 'Total bruto', valueMinor: grossTotalMinor },
                        { label: 'Pendiente', valueMinor: pendingSettlementMinor },
                      ]}
                    />
                  </div>
                </div>
              ),
            },
            {
              id: 'list',
              title: 'Empleados',
              eyebrow: 'Empleados',
              helper: `Ciclo mensual vigente: ${formatPeriod(period)}`,
              content: (
                <div className="accounting-list accounting-employees-list">
                  {rows.map((employee) => (
                    <article key={employee.id} className="accounting-row accounting-row--actions accounting-employee-row">
                      <div className="accounting-row__main">
                        <strong>{employee.lastName}, {employee.firstName}</strong>
                        <small>{employee.position} - {employee.contractType} - {employee.status}</small>
                      </div>
                      <div className="accounting-row__meta">
                        <small>Estado</small>
                        <span className={`status-chip status-chip--${employee.cycle?.status ?? employee.salaryPayment?.status ?? 'draft'}`}>{getEmployeeCycleStatusLabel(employee)}</span>
                      </div>
                      <div className="accounting-row__meta">
                        <small>Sueldo</small>
                        <strong>{formatCurrency(getEmployeeSalaryMinor(employee))}</strong>
                        <small>{employee.cycle ? 'Ciclo registrado' : employee.salaryPayment ? 'Pago registrado' : employee.salaryConfiguration ? 'Configurado' : 'Sin sueldo'}</small>
                      </div>
                      <div className="accounting-row__meta">
                        <small>Horas extra</small>
                        <strong>{formatCurrency(employee.overtime.totalMinor)}</strong>
                        <small>Pendientes: {formatCurrency(employee.overtime.pendingMinor)}</small>
                      </div>
                      <div className="accounting-row__meta">
                        <small>Documentos</small>
                        <strong>{employee.links.length}</strong>
                        <small>{formatPeriod(period)}</small>
                      </div>
                      <div className="member-actions accounting-row-menu-actions accounting-inline-actions accounting-employee-row__actions">
                        <UiActionButton to={`/accounting/employees/${employee.id}?period=${period}`} compact>
                          Ver ciclo
                        </UiActionButton>
                        <button
                          type="button"
                          className={`icon-button member-icon-button ${openEmployeeActionsId === employee.id ? 'icon-button--active' : ''}`}
                          aria-label={`Mas acciones para ${employee.lastName}, ${employee.firstName}`}
                          aria-expanded={openEmployeeActionsId === employee.id}
                          onClick={() => setOpenEmployeeActionsId((current) => current === employee.id ? null : employee.id)}
                        >
                          <MoreActionsIcon />
                        </button>
                        {openEmployeeActionsId === employee.id && (
                          <div className="member-actions-menu">
                            {canConfigureSalaries ? (
                              <Link className="member-actions-menu__item" to={`/accounting/employees/${employee.id}?period=${period}&section=salary`}>Modificar sueldo</Link>
                            ) : (
                              <span className="member-actions-menu__item member-actions-menu__item--disabled">Solo Administracion o Comite Ejecutivo modifican sueldos</span>
                            )}
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
    </div>
  );
}
