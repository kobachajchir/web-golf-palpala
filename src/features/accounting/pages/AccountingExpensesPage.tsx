import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UiActionButton } from '../../../components/UiActionButton';
import { ACCOUNTING_EXPENSE_CATEGORY_IDS } from '../../../modules/accounting/domain/constants';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createExpenseSubmissionsRepository, createFinancialMovementsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { createEmployeesRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import type { EntityWithId, ExpenseSubmissionDocument, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import type { EmployeeDocument } from '../../../modules/users/domain/models';
import { AccountingPieChart } from '../components/AccountingCharts';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { AccountingPeriodTabs } from '../components/AccountingPeriodTabs';
import { DangerActionDialog } from '../components/DangerActionDialog';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import type { AccountingNotice } from '../types/accounting';
import { buildArgentinaDateIso, formatCurrency, formatTimestamp, getCurrentAccountingPeriod, getMovementLabel, normalizeAccountingPeriod, parseAmountInputToMinor, shiftAccountingPeriod } from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();

type ExpensesTab = 'register' | 'queue' | 'movements' | 'insights';

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function buildPeriodOptions(period: string) {
  const normalized = normalizeAccountingPeriod(period);
  return [0, -1, -2, -3, -4, -5].map((offset) => shiftAccountingPeriod(normalized, offset));
}

function groupMovementsByCategory(movements: Array<EntityWithId<FinancialMovementDocument>>, movementType: 'income' | 'expense') {
  const grouped = new Map<string, number>();
  movements
    .filter((movement) => movement.status !== 'voided' && movement.movementType === movementType)
    .forEach((movement) => {
      const label = movement.categoryCodeSnapshot?.replaceAll('_', ' ') || movement.originType || 'Sin categoria';
      grouped.set(label, (grouped.get(label) ?? 0) + movement.netAmountMinor);
    });

  return [...grouped.entries()].map(([label, valueMinor]) => ({ label, valueMinor }));
}

export function AccountingExpensesPage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<ExpensesTab | null>(searchParams.get('tab') === 'queue' ? 'queue' : 'register');
  const [period, setPeriod] = useState(getCurrentAccountingPeriod());
  const summaryState = useAccountingSummary(period);
  const [employees, setEmployees] = useState<Array<EntityWithId<EmployeeDocument>>>([]);
  const [expenses, setExpenses] = useState<Array<EntityWithId<ExpenseSubmissionDocument>>>([]);
  const [movements, setMovements] = useState<Array<EntityWithId<FinancialMovementDocument>>>([]);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [loading, setLoading] = useState(true);
  const [movementToReverse, setMovementToReverse] = useState<EntityWithId<FinancialMovementDocument> | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [form, setForm] = useState<{
    employeeId: string;
    categoryId: string;
    description: string;
    expenseDate: string;
    amount: string;
    vendorName: string;
  }>({
    employeeId: '',
    categoryId: ACCOUNTING_EXPENSE_CATEGORY_IDS.proveedores,
    description: '',
    expenseDate: todayInputValue(),
    amount: '',
    vendorName: '',
  });

  const pendingExpenses = useMemo(() => expenses.filter((expense) => expense.status === 'submitted'), [expenses]);
  const periodOptions = buildPeriodOptions(period);
  const incomeChartData = useMemo(
    () => groupMovementsByCategory(summaryState.summary?.periodMovements ?? [], 'income'),
    [summaryState.summary?.periodMovements],
  );
  const expenseChartData = useMemo(
    () => groupMovementsByCategory(summaryState.summary?.periodMovements ?? [], 'expense'),
    [summaryState.summary?.periodMovements],
  );

  const load = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const employeesRepository = createEmployeesRepository();
      const expensesRepository = createExpenseSubmissionsRepository();
      const movementsRepository = createFinancialMovementsRepository();
      const [nextEmployees, nextExpenses, nextMovements] = await Promise.all([
        employeesRepository.listAlphabetical(100),
        expensesRepository.listRecent(30),
        movementsRepository.listRecent(20),
      ]);
      setEmployees(nextEmployees);
      setExpenses(nextExpenses);
      setMovements(nextMovements.filter((movement) => movement.movementType === 'expense'));
      const firstEmployee = nextEmployees[0];
      if (!form.employeeId && firstEmployee) {
        setForm((current) => ({ ...current, employeeId: firstEmployee.id }));
      }
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar egresos.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSubmitExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(form.amount);
    if (!form.employeeId || !form.description.trim() || !Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Completa responsable, descripcion y monto valido.' });
      return;
    }

    try {
      await accountingCallables.submitExpense({
        employeeId: form.employeeId,
        categoryId: form.categoryId,
        description: form.description.trim(),
        expenseDate: buildArgentinaDateIso(form.expenseDate),
        amountMinor,
        vendorName: form.vendorName.trim() || null,
      });
      setNotice({ kind: 'success', message: 'Egreso cargado como rendicion para revision.' });
      setForm((current) => ({ ...current, description: '', amount: '', vendorName: '' }));
      await load();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar el egreso.' });
    }
  };

  const handleReviewExpense = async (expenseId: string, decision: 'approved' | 'rejected') => {
    try {
      await accountingCallables.reviewExpense({ expenseSubmissionId: expenseId, decision, rejectionReason: decision === 'rejected' ? 'Rechazo administrativo desde UI contable.' : null });
      if (decision === 'approved') {
        await accountingCallables.postExpenseMovement({ expenseSubmissionId: expenseId, notes: 'Posteado desde egresos.' });
      }
      setNotice({ kind: 'success', message: decision === 'approved' ? 'Rendicion aprobada y posteada.' : 'Rendicion rechazada.' });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos revisar la rendicion.' });
    }
  };

  const handleReverseMovement = async () => {
    if (!movementToReverse) {
      return;
    }

    try {
      await accountingCallables.voidFinancialMovement({
        movementId: movementToReverse.id,
        reason: reversalReason.trim(),
      });
      setNotice({ kind: 'success', message: 'Movimiento anulado. El backend genera el reverso cuando corresponde.' });
      setMovementToReverse(null);
      setReversalReason('');
      await load();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos anular el movimiento.' });
    }
  };

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Egresos</p>
          <h1>Gastos, rendiciones y movimientos</h1>
          <p>La cola de rendiciones vive en esta pantalla, separada de cobros y cuotas.</p>
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />
      <AccountingCollapsibleSections
        openId={tab}
        onOpenChange={(sectionId) => setTab(sectionId as ExpensesTab | null)}
        sections={[
          {
            id: 'register',
            title: 'Registrar egreso',
            eyebrow: 'Operacion',
            helper: 'Carga un gasto o rendicion para revision',
            content: (
              <form className="accounting-entry-form" onSubmit={handleSubmitExpense}>
                <label className="form-field">
                  <span>Responsable</span>
                  <select value={form.employeeId} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))}>
                    <option value="">Seleccionar</option>
                    {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.lastName}, {employee.firstName}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Categoria</span>
                  <select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}>
                    {Object.entries(ACCOUNTING_EXPENSE_CATEGORY_IDS).map(([label, value]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="form-field"><span>Fecha</span><input type="date" value={form.expenseDate} onChange={(event) => setForm((current) => ({ ...current, expenseDate: event.target.value }))} /></label>
                <label className="form-field"><span>Descripcion</span><input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
                <label className="form-field"><span>Monto</span><input inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></label>
                <label className="form-field"><span>Proveedor</span><input value={form.vendorName} onChange={(event) => setForm((current) => ({ ...current, vendorName: event.target.value }))} /></label>
                <div className="form-actions">
                  <UiActionButton type="submit">Guardar egreso</UiActionButton>
                </div>
              </form>
            ),
          },
          {
            id: 'queue',
            title: 'Rendiciones',
            eyebrow: 'Revision',
            helper: `${pendingExpenses.length} pendientes`,
            content: (
              <div className="accounting-list">
                {pendingExpenses.map((expense) => (
                  <article key={expense.id} className="accounting-row accounting-row--actions">
                    <div className="accounting-row__main">
                      <strong>{expense.description}</strong>
                      <small>{formatTimestamp(expense.expenseDate)} - {expense.vendorName ?? 'Sin proveedor'}</small>
                    </div>
                    <div className="accounting-row__meta">
                      <strong>{formatCurrency(expense.amountMinor)}</strong>
                      <div className="accounting-inline-actions">
                        <UiActionButton type="button" onClick={() => void handleReviewExpense(expense.id, 'approved')}>Aprobar y postear</UiActionButton>
                        <UiActionButton type="button" variant="secondary" onClick={() => void handleReviewExpense(expense.id, 'rejected')}>Rechazar</UiActionButton>
                      </div>
                    </div>
                  </article>
                ))}
                {!loading && pendingExpenses.length === 0 && <AccountingEmptyState title="Sin rendiciones pendientes" />}
              </div>
            ),
          },
          {
            id: 'movements',
            title: 'Movimientos',
            eyebrow: 'Egresos',
            helper: 'Posteados y anulacion auditada',
            content: (
              <div className="accounting-list">
                {movements.map((movement) => (
                  <article key={movement.id} className="accounting-row accounting-row--actions">
                    <div className="accounting-row__main">
                      <strong>{getMovementLabel(movement)}</strong>
                      <small>{formatTimestamp(movement.operationDate)}</small>
                    </div>
                    <div className="accounting-row__meta">
                      <span className={`status-chip status-chip--${movement.status}`}>{movement.status}</span>
                      <strong>{formatCurrency(movement.netAmountMinor)}</strong>
                      {movement.status !== 'voided' && (
                        <UiActionButton type="button" variant="secondary" onClick={() => setMovementToReverse(movement)}>
                          Anular
                        </UiActionButton>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ),
          },
          {
            id: 'insights',
            title: 'Ingresos y egresos por categoria',
            eyebrow: 'Diagramas',
            helper: 'Tortas por periodo configurable',
            content: (
              <>
                <div className="accounting-period-controls">
                  <AccountingMonthPicker period={normalizeAccountingPeriod(period)} onChange={setPeriod} />
                </div>
                <AccountingPeriodTabs periods={periodOptions} activePeriod={normalizeAccountingPeriod(period)} onChange={setPeriod} />
                <div className="accounting-chart-grid">
                  <AccountingPieChart title="Ingresos por categoria" data={incomeChartData} />
                  <AccountingPieChart title="Egresos por categoria" data={expenseChartData} />
                </div>
              </>
            ),
          },
        ]}
      />

      <DangerActionDialog
        open={Boolean(movementToReverse)}
        title="Anular movimiento"
        description="La anulacion requiere motivo y queda auditada. Si aplica, el backend genera el movimiento reverso."
        reason={reversalReason}
        confirmLabel="Anular movimiento"
        onReasonChange={setReversalReason}
        onCancel={() => setMovementToReverse(null)}
        onConfirm={() => void handleReverseMovement()}
      />
    </div>
  );
}
