import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import { ACCOUNTING_EXPENSE_CATEGORY_IDS } from '../../../modules/accounting/domain/constants';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import {
  createCashClosuresRepository,
  createExpenseSubmissionsRepository,
  createFinancialConfigsRepository,
  createFinancialExpenseCategoriesRepository,
  createFinancialIncomeCategoriesRepository,
  createFinancialMovementsRepository,
  createPaymentMethodsRepository,
} from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { CashClosureDocument, EntityWithId, ExpenseSubmissionDocument, FinancialConfigDocument, FinancialMovementDocument, UpsertFinancialConfigPayload } from '../../../modules/accounting/domain/models';
import type { EmployeeDocument, MemberDocument } from '../../../modules/users/domain/models';
import { createEmployeesRepository, createMembersRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { DangerActionDialog } from '../components/DangerActionDialog';
import { ManualIncomeForm } from '../components/ManualIncomeForm';
import type { AccountingNotice } from '../types/accounting';
import type { PaymentMethod } from '../types/payment';
import type { ExpenseCategoryOption, IncomeCategoryOption } from '../utils/accountingCategories';
import {
  formatExpenseCategoryName,
  getCategoryLabel,
  getFallbackExpenseCategories,
  getFallbackIncomeCategories,
} from '../utils/accountingCategories';
import {
  buildArgentinaDateIso,
  formatCurrency,
  formatTimestamp,
  getCurrentAccountingPeriod,
  getSignedMovementAmount,
  normalizeAccountingPeriod,
  parseAmountInputToMinor,
} from '../utils/accountingFormatters';
import { AccountingCashClosuresPage } from './AccountingCashClosuresPage';

const accountingCallables = createAccountingCallables();
const DEFAULT_SERVER_MONTHLY_USD_MINOR = 6500;
const CASH_OPERATION_TIMEOUT_MS = 25000;

type CashTab = 'movimientos' | 'cobros' | 'egresos' | 'rendiciones' | 'cierre';
type CashOperationModal = 'income' | 'expense' | 'server-expense' | 'server-config' | null;

const CASH_TABS: Array<{ id: CashTab; label: string }> = [
  { id: 'movimientos', label: 'Movimientos' },
  { id: 'cobros', label: 'Cobros' },
  { id: 'egresos', label: 'Egresos' },
  { id: 'rendiciones', label: 'Rendiciones' },
  { id: 'cierre', label: 'Cierre' },
];

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

function getEmployeeDisplayName(employee: EntityWithId<EmployeeDocument>) {
  return `${employee.lastName}, ${employee.firstName}`;
}

function resolveEmployeeId(employees: Array<EntityWithId<EmployeeDocument>>, search: string) {
  const normalized = search.trim().toLowerCase();
  return employees.find((employee) => getEmployeeDisplayName(employee).toLowerCase() === normalized)?.id ?? '';
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function formatUsdMinor(value: number | null | undefined) {
  const normalized = value && value > 0 ? value : DEFAULT_SERVER_MONTHLY_USD_MINOR;
  return `USD ${(normalized / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

function getMovementDayKey(movement: EntityWithId<FinancialMovementDocument>) {
  const date = movement.operationDate?.toDate();
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getClosureDayKey(closure: EntityWithId<CashClosureDocument>) {
  const date = closure.closureDate?.toDate();
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function buildFinancialConfigPayload(
  config: EntityWithId<FinancialConfigDocument>,
  serverMonthlyExpenseMinor: number,
): UpsertFinancialConfigPayload {
  const payload: UpsertFinancialConfigPayload = {
    effectiveFrom: buildArgentinaDateIso(new Date().toISOString().slice(0, 10)),
    fullMemberFeeMinor: config.fullMemberFeeMinor,
    familyAssociatePctBps: config.familyAssociatePctBps,
    lifetimePctBps: config.lifetimePctBps,
    minorPctBps: config.minorPctBps,
    licensePctBps: config.licensePctBps,
    maxLicenseMonths: config.maxLicenseMonths,
    creditCommissionPctBps: config.creditCommissionPctBps,
    familyGroupBillingMode: config.familyGroupBillingMode,
    allowStandaloneMinor: config.allowStandaloneMinor,
    membershipChargePersistenceMode: config.membershipChargePersistenceMode,
    greenFeeAppliesToMembers: config.greenFeeAppliesToMembers,
    cantineroContractMode: config.cantineroContractMode,
    advertisingDefaultPeriodicity: config.advertisingDefaultPeriodicity,
    requireApprovalForExpensePosting: config.requireApprovalForExpensePosting,
    requireApprovalForOvertimePosting: config.requireApprovalForOvertimePosting,
    serverMonthlyExpenseMinor,
    notes: 'Actualizacion de gasto fijo servidor desde Caja.',
  };

  if (config.earlyPaymentDiscountPctBps !== undefined && config.earlyPaymentDiscountPctBps !== null) {
    payload.earlyPaymentDiscountPctBps = config.earlyPaymentDiscountPctBps;
  }
  if (config.earlyPaymentDiscountDayOfMonth !== undefined && config.earlyPaymentDiscountDayOfMonth !== null) {
    payload.earlyPaymentDiscountDayOfMonth = config.earlyPaymentDiscountDayOfMonth;
  }

  return payload;
}

function MovementSummary({ movements }: { movements: Array<EntityWithId<FinancialMovementDocument>> }) {
  const posted = movements.filter((movement) => movement.status !== 'voided');
  const incomeMinor = posted
    .filter((movement) => movement.movementType === 'income')
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
  const expenseMinor = posted
    .filter((movement) => movement.movementType === 'expense')
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
  const netMinor = posted.reduce((total, movement) => total + getSignedMovementAmount(movement), 0);

  return (
    <section className="summary-grid accounting-summary-grid">
      <article className="summary-card"><span>Ingresos</span><strong>{formatCurrency(incomeMinor)}</strong><small>Posteados</small></article>
      <article className="summary-card"><span>Egresos</span><strong>{formatCurrency(expenseMinor)}</strong><small>Posteados</small></article>
      <article className="summary-card"><span>Neto</span><strong>{formatCurrency(netMinor)}</strong><small>Resultado</small></article>
      <article className="summary-card"><span>Movimientos</span><strong>{posted.length}</strong><small>Del periodo</small></article>
    </section>
  );
}

function ExpenseQuickForm({
  employees,
  expenseCategories,
  serverMonthlyExpenseMinor,
  initialCategoryId,
  lockCategory = false,
  onNotice,
  onSaved,
}: {
  employees: Array<EntityWithId<EmployeeDocument>>;
  expenseCategories: ExpenseCategoryOption[];
  serverMonthlyExpenseMinor?: number | null | undefined;
  initialCategoryId?: string;
  lockCategory?: boolean;
  onNotice: (notice: AccountingNotice) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    employeeSearch: employees[0] ? getEmployeeDisplayName(employees[0]) : '',
    categoryId: expenseCategories[0]?.id ?? '',
    expenseDate: todayInputValue(),
    description: '',
    vendorName: '',
    amount: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      employeeSearch: current.employeeSearch || (employees[0] ? getEmployeeDisplayName(employees[0]) : ''),
      categoryId: initialCategoryId || current.categoryId || expenseCategories[0]?.id || '',
    }));
  }, [employees, expenseCategories, initialCategoryId]);

  useEffect(() => {
    if (form.categoryId !== ACCOUNTING_EXPENSE_CATEGORY_IDS.servidor || form.amount) {
      return;
    }
    const serverMinor = serverMonthlyExpenseMinor && serverMonthlyExpenseMinor > 0 ? serverMonthlyExpenseMinor : DEFAULT_SERVER_MONTHLY_USD_MINOR;
    setForm((current) => ({ ...current, amount: String(serverMinor / 100).replace('.', ',') }));
  }, [form.amount, form.categoryId, serverMonthlyExpenseMinor]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(form.amount);
    const employeeId = resolveEmployeeId(employees, form.employeeSearch);
    if (!employeeId || !form.categoryId || !form.description.trim() || !Number.isFinite(amountMinor) || amountMinor <= 0) {
      onNotice({ kind: 'error', message: 'Completa responsable, categoria, descripcion y monto valido.' });
      return;
    }

    setSaving(true);
    try {
      const result = await withTimeout(
        accountingCallables.submitExpense({
          employeeId,
          categoryId: form.categoryId,
          description: form.description.trim(),
          expenseDate: buildArgentinaDateIso(form.expenseDate),
          amountMinor,
          vendorName: form.vendorName.trim() || null,
        }),
        CASH_OPERATION_TIMEOUT_MS,
        'El egreso no respondio a tiempo. Revisalo en movimientos antes de volver a cargarlo.',
      );
      await withTimeout(
        accountingCallables.reviewExpense({
          expenseSubmissionId: result.expenseSubmissionId,
          decision: 'approved',
          rejectionReason: null,
        }),
        CASH_OPERATION_TIMEOUT_MS,
        'El egreso se creo, pero la aprobacion no respondio a tiempo.',
      );
      await withTimeout(
        accountingCallables.postExpenseMovement({
          expenseSubmissionId: result.expenseSubmissionId,
          notes: 'Posteado automaticamente desde Caja.',
        }),
        CASH_OPERATION_TIMEOUT_MS,
        'El egreso se aprobo, pero el movimiento no respondio a tiempo.',
      );
      onNotice({ kind: 'success', message: 'Egreso registrado y posteado como movimiento de caja.' });
      setForm((current) => ({ ...current, description: '', vendorName: '', amount: '' }));
      await onSaved();
    } catch (error) {
      onNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos registrar el egreso.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="floating-card accounting-panel">
      <div className="accounting-section-header">
        <div>
          <p className="eyebrow">Registrar egreso</p>
          <h2>Salida por categoria de egreso</h2>
          <p>Al cargarlo desde administracion se aprueba y postea automaticamente.</p>
        </div>
      </div>
      <form className="accounting-entry-form accounting-dialog-form accounting-dialog-form--expense" onSubmit={handleSubmit}>
        <label className="form-field form-field--wide">
          <span>Responsable</span>
          <input list="cash-expense-employees" value={form.employeeSearch} onChange={(event) => setForm((current) => ({ ...current, employeeSearch: event.target.value }))} />
          <datalist id="cash-expense-employees">
            {employees.map((employee) => <option key={employee.id} value={getEmployeeDisplayName(employee)} />)}
          </datalist>
        </label>
        <label className="form-field form-field--wide">
          <span>Categoria</span>
          <select
            value={form.categoryId}
            disabled={lockCategory}
            onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
          >
            {expenseCategories.map((category) => <option key={category.id} value={category.id}>{formatExpenseCategoryName(category.name)}</option>)}
          </select>
        </label>
        <label className="form-field"><span>Fecha</span><input type="date" value={form.expenseDate} onChange={(event) => setForm((current) => ({ ...current, expenseDate: event.target.value }))} /></label>
        <label className="form-field"><span>Proveedor</span><input value={form.vendorName} onChange={(event) => setForm((current) => ({ ...current, vendorName: event.target.value }))} /></label>
        <label className="form-field form-field--wide"><span>Descripcion</span><input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
        <label className="form-field accounting-money-field"><span>Monto ARS</span><input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></label>
        <div className="form-actions"><UiActionButton type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Guardar egreso'}</UiActionButton></div>
      </form>
    </section>
  );
}

function OperationModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-overlay quick-actions-modal-overlay" role="presentation" onClick={onClose}>
      <section
        className="member-modal-card quick-actions-modal accounting-operation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounting-operation-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="member-modal__header quick-actions-modal__header">
          <div>
            <h2 id="accounting-operation-modal-title">{title}</h2>
          </div>
          <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={onClose}>
            x
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function CashActionButton({
  label,
  helper,
  icon,
  disabled = false,
  onClick,
}: {
  label: string;
  helper: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="action-tile accounting-action-tile" disabled={disabled} onClick={onClick}>
      <span className="action-icon">{icon}</span>
      <strong>{label}</strong>
      <small>{helper}</small>
    </button>
  );
}

function TileIcon({ type }: { type: 'wallet' | 'clipboard' | 'chart' }) {
  const path = type === 'wallet'
    ? <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h10A2.5 2.5 0 0 1 19 6.5V7h1a2 2 0 0 1 2 2v7.5A2.5 2.5 0 0 1 19.5 19h-13A2.5 2.5 0 0 1 4 16.5v-10ZM19.5 9H16a2 2 0 1 0 0 4h3.5a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5ZM6 7h11V6.5a.5.5 0 0 0-.5-.5h-10a.5.5 0 0 0-.5.5V7Zm10 4h1" />
    : type === 'clipboard'
      ? <path d="M9 2a2 2 0 0 0-2 2H6.5A2.5 2.5 0 0 0 4 6.5v13A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5v-13A2.5 2.5 0 0 0 17.5 4H17a2 2 0 0 0-2-2H9Zm0 2h6v2H9V4Zm-1 6h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Zm0 4h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Z" />
      : <path d="M4 19h16a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1V4a1 1 0 1 1 2 0v15Zm3-2a1 1 0 0 1-1-1v-4a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1Zm5 0a1 1 0 0 1-1-1V8a1 1 0 1 1 2 0v8a1 1 0 0 1-1 1Zm5 0a1 1 0 0 1-1-1V5a1 1 0 1 1 2 0v11a1 1 0 0 1-1 1Z" />;

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      {path}
    </svg>
  );
}

function ServerExpenseConfigCard({
  activeConfig,
  canConfigure,
  onNotice,
  onSaved,
}: {
  activeConfig: EntityWithId<FinancialConfigDocument> | null;
  canConfigure: boolean;
  onNotice: (notice: AccountingNotice) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAmount(activeConfig?.serverMonthlyExpenseMinor ? String(activeConfig.serverMonthlyExpenseMinor / 100).replace('.', ',') : '65');
  }, [activeConfig?.id, activeConfig?.serverMonthlyExpenseMinor]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeConfig || !canConfigure) {
      return;
    }
    const amountMinor = parseAmountInputToMinor(amount);
    if (!Number.isFinite(amountMinor) || amountMinor < 0) {
      onNotice({ kind: 'error', message: 'Ingresa un monto valido para el servidor.' });
      return;
    }

    setSaving(true);
    try {
      const result = await accountingCallables.upsertFinancialConfig(buildFinancialConfigPayload(activeConfig, amountMinor));
      onNotice({ kind: 'success', message: `Gasto fijo servidor actualizado en configuracion version ${result.version}.` });
      await onSaved();
    } catch (error) {
      onNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos actualizar el gasto fijo servidor.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="floating-card accounting-panel accounting-server-expense-card">
      <div className="accounting-section-header">
        <div>
          <p className="eyebrow">Gasto fijo</p>
          <h2>Servidor</h2>
          <p>Se guarda como configuracion contable y se registra como egreso con categoria SERVIDOR.</p>
        </div>
        <strong>{formatUsdMinor(activeConfig?.serverMonthlyExpenseMinor)}</strong>
      </div>
      {canConfigure ? (
        <form className="accounting-entry-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Monto mensual servidor (USD)</span>
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <div className="form-actions">
            <UiActionButton type="submit" disabled={saving || !activeConfig}>{saving ? 'Guardando...' : 'Guardar monto'}</UiActionButton>
          </div>
        </form>
      ) : (
        <AccountingInlineNotice notice={{ kind: 'info', message: 'Solo Directivo puede modificar el monto fijo del servidor.' }} />
      )}
    </section>
  );
}

export function AccountingCashPage() {
  const { interfaceMode } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (CASH_TABS.some((tab) => tab.id === searchParams.get('tab')) ? searchParams.get('tab') : 'movimientos') as CashTab;
  const [period, setPeriod] = useState(normalizeAccountingPeriod(searchParams.get('period') ?? getCurrentAccountingPeriod()));
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [movements, setMovements] = useState<Array<EntityWithId<FinancialMovementDocument>>>([]);
  const [closures, setClosures] = useState<Array<EntityWithId<CashClosureDocument>>>([]);
  const [expenses, setExpenses] = useState<Array<EntityWithId<ExpenseSubmissionDocument>>>([]);
  const [employees, setEmployees] = useState<Array<EntityWithId<EmployeeDocument>>>([]);
  const [members, setMembers] = useState<Array<EntityWithId<MemberDocument>>>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [activeConfig, setActiveConfig] = useState<EntityWithId<FinancialConfigDocument> | null>(null);
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategoryOption[]>(() => getFallbackIncomeCategories());
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryOption[]>(() => getFallbackExpenseCategories());
  const [movementFilters, setMovementFilters] = useState({ categoryId: 'all', status: 'all', paymentMethodId: 'all', search: '', day: '' });
  const [expenseFilters, setExpenseFilters] = useState({ categoryId: 'all', search: '' });
  const [review, setReview] = useState<{ expense: EntityWithId<ExpenseSubmissionDocument>; decision: 'approved' | 'rejected' } | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [operationModal, setOperationModal] = useState<CashOperationModal>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const operatingPeriod = normalizeAccountingPeriod(todayInputValue().slice(0, 7));
      const [
        nextMovements,
        nextClosures,
        nextExpenses,
        nextEmployees,
        nextMembers,
        nextPaymentMethods,
        nextActiveConfig,
        nextIncomeCategories,
        nextExpenseCategories,
      ] = await Promise.all([
        createFinancialMovementsRepository().listByAccountingPeriod(period),
        createCashClosuresRepository().listByPeriod(operatingPeriod),
        createExpenseSubmissionsRepository().listRecent(50),
        createEmployeesRepository().listAlphabetical(100),
        createMembersRepository().listDirectory(),
        createPaymentMethodsRepository().listActiveSorted(),
        createFinancialConfigsRepository().getActive(),
        createFinancialIncomeCategoriesRepository().listActiveSorted().catch(() => getFallbackIncomeCategories()),
        createFinancialExpenseCategoriesRepository().listActiveSorted().catch(() => getFallbackExpenseCategories()),
      ]);
      setMovements(nextMovements);
      setClosures(nextClosures);
      setExpenses(nextExpenses);
      setEmployees(nextEmployees);
      setMembers(nextMembers);
      setPaymentMethods(nextPaymentMethods);
      setActiveConfig(nextActiveConfig);
      setIncomeCategories(nextIncomeCategories.length ? nextIncomeCategories : getFallbackIncomeCategories());
      setExpenseCategories(nextExpenseCategories.length ? nextExpenseCategories : getFallbackExpenseCategories());
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar la caja.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [period]);

  const filteredMovements = useMemo(
    () => movements.filter((movement) => {
      if (movementFilters.categoryId !== 'all' && movement.categoryId !== movementFilters.categoryId) {
        return false;
      }
      if (movementFilters.status !== 'all' && movement.status !== movementFilters.status) {
        return false;
      }
      if (movementFilters.paymentMethodId !== 'all' && movement.paymentMethodId !== movementFilters.paymentMethodId) {
        return false;
      }
      if (movementFilters.day && getMovementDayKey(movement) !== movementFilters.day) {
        return false;
      }
      if (movementFilters.search.trim()) {
        const query = normalizeSearchText(movementFilters.search);
        const searchable = normalizeSearchText([
          getCategoryLabel(movement.categoryId),
          movement.paymentMethodCodeSnapshot,
          movement.originType,
          movement.thirdPartyId,
          movement.notes,
        ].filter(Boolean).join(' '));
        if (!searchable.includes(query)) {
          return false;
        }
      }
      return true;
    }),
    [movementFilters, movements],
  );
  const submittedExpenses = expenses.filter((expense) => expense.status === 'submitted');
  const filteredSubmittedExpenses = submittedExpenses.filter((expense) => {
    if (expenseFilters.categoryId !== 'all' && expense.categoryId !== expenseFilters.categoryId) {
      return false;
    }
    if (expenseFilters.search.trim()) {
      const query = normalizeSearchText(expenseFilters.search);
      const searchable = normalizeSearchText([
        expense.description,
        expense.vendorName,
        expense.employeeId,
        getCategoryLabel(expense.categoryId),
      ].filter(Boolean).join(' '));
      return searchable.includes(query);
    }
    return true;
  });

  const setTab = (tab: CashTab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    nextParams.set('period', period);
    setSearchParams(nextParams);
  };

  const todayKey = todayInputValue();
  const todayOpenClosure = closures.find((closure) => getClosureDayKey(closure) === todayKey && closure.status === 'open') ?? null;
  const todayClosedClosure = closures.find((closure) => getClosureDayKey(closure) === todayKey && closure.status === 'closed') ?? null;
  const todayIncomeMovements = movements.filter(
    (movement) => movement.movementType === 'income' && movement.status !== 'voided' && getMovementDayKey(movement) === todayKey,
  );
  const todayIncomeTotalMinor = todayIncomeMovements.reduce((total, movement) => total + movement.netAmountMinor, 0);
  const canOperateCash = Boolean(todayOpenClosure);
  const cashClosedToday = Boolean(todayClosedClosure);
  const cashGateMessage = cashClosedToday
    ? 'La caja de hoy ya fue cerrada. Para generar movimientos nuevos hace falta una jornada abierta.'
    : 'Abrir la caja diaria habilita cobros, egresos y aprobaciones que generan movimientos.';

  const confirmReview = async () => {
    if (!review) {
      return;
    }
    try {
      await accountingCallables.reviewExpense({
        expenseSubmissionId: review.expense.id,
        decision: review.decision,
        rejectionReason: review.decision === 'rejected' ? reviewReason.trim() : null,
      });
      if (review.decision === 'approved') {
        await accountingCallables.postExpenseMovement({ expenseSubmissionId: review.expense.id, notes: 'Posteado desde caja.' });
      }
      setNotice({ kind: 'success', message: review.decision === 'approved' ? 'Rendicion aprobada y posteada.' : 'Rendicion rechazada.' });
      setReview(null);
      setReviewReason('');
      await load();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos revisar la rendicion.' });
    }
  };

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Caja</p>
          <h1>Hub operativo de caja</h1>
          <p>Cobros, egresos, rendiciones, movimientos y cierre en una sola consola.</p>
        </div>
        <div className="accounting-hero__controls">
          <AccountingMonthPicker period={period} onChange={(nextPeriod) => {
            setPeriod(nextPeriod);
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('period', nextPeriod);
            setSearchParams(nextParams);
          }} />
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />

      {!canOperateCash && activeTab !== 'cierre' && (
        <section className="floating-card accounting-panel accounting-cash-gate">
          <div className="accounting-section-header accounting-section-header--plain">
            <h2>Abrir caja diaria</h2>
            <UiActionButton type="button" onClick={() => setTab('cierre')}>Abrir caja</UiActionButton>
          </div>
          <p>{cashGateMessage}</p>
        </section>
      )}

      <div className="accounting-page-tabs accounting-segmented" role="tablist" aria-label="Caja">
        {CASH_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={`accounting-segmented__item ${activeTab === tab.id ? 'accounting-segmented__item--active' : ''}`}
            aria-selected={activeTab === tab.id}
            onClick={() => setTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'movimientos' && (
        <>
          <MovementSummary movements={filteredMovements} />
          <section className="floating-card accounting-panel accounting-centered-panel">
            <div className="accounting-section-header">
              <div>
                <h2>Ingresos y egresos del periodo</h2>
              </div>
            </div>
            <div className="accounting-entry-form">
              <label className="form-field">
                <span>Categoria</span>
                <select value={movementFilters.categoryId} onChange={(event) => setMovementFilters((current) => ({ ...current, categoryId: event.target.value }))}>
                  <option value="all">Todas</option>
                  {[...incomeCategories, ...expenseCategories].map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>Estado</span>
                <select value={movementFilters.status} onChange={(event) => setMovementFilters((current) => ({ ...current, status: event.target.value }))}>
                  <option value="all">Todos</option>
                  <option value="posted">Posteado</option>
                  <option value="pending">Pendiente</option>
                  <option value="voided">Anulado</option>
                </select>
              </label>
              <label className="form-field">
                <span>Medio de pago</span>
                <select value={movementFilters.paymentMethodId} onChange={(event) => setMovementFilters((current) => ({ ...current, paymentMethodId: event.target.value }))}>
                  <option value="all">Todos</option>
                  {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                </select>
              </label>
              <label className="form-field"><span>Dia</span><input type="date" value={movementFilters.day} onChange={(event) => setMovementFilters((current) => ({ ...current, day: event.target.value }))} /></label>
              <label className="form-field"><span>Buscar persona/proveedor</span><input value={movementFilters.search} onChange={(event) => setMovementFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Nombre, proveedor, categoria o referencia" /></label>
            </div>
            <div className="accounting-table-wrap">
              <table className="accounting-data-table">
                <thead><tr><th>Fecha</th><th>Categoria</th><th>Tipo</th><th>Medio</th><th>Estado</th><th>Monto</th></tr></thead>
                <tbody>
                  {filteredMovements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{formatTimestamp(movement.operationDate)}</td>
                      <td>{getCategoryLabel(movement.categoryId)}</td>
                      <td>{movement.movementType === 'income' ? 'Ingreso' : 'Egreso'}</td>
                      <td>{movement.paymentMethodCodeSnapshot ?? 'Sin medio'}</td>
                      <td><span className={`status-chip status-chip--${movement.status}`}>{movement.status}</span></td>
                      <td><strong>{formatCurrency(getSignedMovementAmount(movement))}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && filteredMovements.length === 0 && <AccountingEmptyState title="Sin movimientos para estos filtros" />}
          </section>
        </>
      )}

      {activeTab === 'cobros' && (
        <section className="floating-card accounting-panel accounting-centered-panel">
          <div className="accounting-section-header accounting-section-header--plain">
            <div>
              <h2>Cobros del dia</h2>
              <p>{todayIncomeMovements.length} cobros registrados - total {formatCurrency(todayIncomeTotalMinor)}</p>
            </div>
            <UiActionButton type="button" disabled={!canOperateCash} onClick={() => setOperationModal('income')}>
              Generar nuevo cobro
            </UiActionButton>
          </div>
          <div className="accounting-table-wrap">
            <table className="accounting-data-table">
              <thead><tr><th>Hora</th><th>Categoria</th><th>Medio</th><th>Referencia</th><th>Estado</th><th>Monto</th></tr></thead>
              <tbody>
                {todayIncomeMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatTimestamp(movement.operationDate)}</td>
                    <td>{getCategoryLabel(movement.categoryId)}</td>
                    <td>{movement.paymentMethodCodeSnapshot ?? 'Sin medio'}</td>
                    <td>{typeof movement.metadata?.paymentReference === 'string' ? movement.metadata.paymentReference : movement.originType}</td>
                    <td><span className={`status-chip status-chip--${movement.status}`}>{movement.status}</span></td>
                    <td><strong>{formatCurrency(movement.netAmountMinor)}</strong></td>
                  </tr>
                ))}
                {!loading && todayIncomeMovements.length === 0 && (
                  <tr><td colSpan={6}>Sin cobros registrados hoy.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'egresos' && (
        <section className="floating-card accounting-panel accounting-centered-panel">
          <div className="accounting-section-header accounting-section-header--plain">
            <h2>Egresos</h2>
          </div>
          <div className="action-grid accounting-action-grid">
            <CashActionButton
              label="Registrar egreso"
              helper="Salida por categoria"
              icon={<TileIcon type="clipboard" />}
              disabled={!canOperateCash}
              onClick={() => setOperationModal('expense')}
            />
            <CashActionButton
              label="Registrar servidor"
              helper="Gasto fijo mensual"
              icon={<TileIcon type="chart" />}
              disabled={!canOperateCash}
              onClick={() => setOperationModal('server-expense')}
            />
            <CashActionButton
              label="Configurar servidor"
              helper={formatUsdMinor(activeConfig?.serverMonthlyExpenseMinor)}
              icon={<TileIcon type="chart" />}
              disabled={interfaceMode !== ROLES.DIRECTIVO}
              onClick={() => setOperationModal('server-config')}
            />
          </div>
        </section>
      )}

      {activeTab === 'rendiciones' && (
        <section className="floating-card accounting-panel accounting-centered-panel">
          <div className="accounting-section-header">
            <h2>Rendiciones</h2>
          </div>
          <div className="accounting-entry-form">
            <label className="form-field">
              <span>Salida por categoria</span>
              <select value={expenseFilters.categoryId} onChange={(event) => setExpenseFilters((current) => ({ ...current, categoryId: event.target.value }))}>
                <option value="all">Todas</option>
                {expenseCategories.map((category) => <option key={category.id} value={category.id}>{formatExpenseCategoryName(category.name)}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Buscar responsable/proveedor</span>
              <input value={expenseFilters.search} onChange={(event) => setExpenseFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Descripcion, proveedor o empleado" />
            </label>
          </div>
          <div className="accounting-list">
            {filteredSubmittedExpenses.map((expense) => (
              <article key={expense.id} className="accounting-row accounting-row--actions">
                <div className="accounting-row__main">
                  <strong>{expense.description}</strong>
                  <small>{getCategoryLabel(expense.categoryId)} - {formatTimestamp(expense.expenseDate)} - {expense.vendorName ?? 'Sin proveedor'}</small>
                </div>
                <div className="accounting-row__meta">
                  <strong>{formatCurrency(expense.amountMinor)}</strong>
                  <div className="accounting-inline-actions">
                    <UiActionButton type="button" disabled={!canOperateCash} onClick={() => setReview({ expense, decision: 'approved' })}>Aprobar</UiActionButton>
                    <UiActionButton type="button" variant="secondary" onClick={() => setReview({ expense, decision: 'rejected' })}>Rechazar</UiActionButton>
                  </div>
                </div>
              </article>
            ))}
            {!loading && filteredSubmittedExpenses.length === 0 && <AccountingEmptyState title="Sin rendiciones pendientes" />}
          </div>
        </section>
      )}

      {activeTab === 'cierre' && <AccountingCashClosuresPage onChanged={load} />}

      {operationModal === 'income' && (
        <OperationModal title="Generar nuevo cobro" onClose={() => setOperationModal(null)}>
          <ManualIncomeForm
            incomeCategories={incomeCategories}
            paymentMethods={paymentMethods}
            members={members}
            onNotice={setNotice}
            onRegistered={async () => {
              setOperationModal(null);
              await load();
            }}
            showMemberDebtAction={false}
          />
        </OperationModal>
      )}

      {operationModal === 'expense' && (
        <OperationModal title="Registrar egreso" onClose={() => setOperationModal(null)}>
          <ExpenseQuickForm
            employees={employees}
            expenseCategories={expenseCategories}
            serverMonthlyExpenseMinor={activeConfig?.serverMonthlyExpenseMinor}
            onNotice={setNotice}
            onSaved={async () => {
              setOperationModal(null);
              await load();
            }}
          />
        </OperationModal>
      )}

      {operationModal === 'server-expense' && (
        <OperationModal title="Registrar servidor" onClose={() => setOperationModal(null)}>
          <ExpenseQuickForm
            employees={employees}
            expenseCategories={expenseCategories}
            serverMonthlyExpenseMinor={activeConfig?.serverMonthlyExpenseMinor}
            initialCategoryId={ACCOUNTING_EXPENSE_CATEGORY_IDS.servidor}
            lockCategory
            onNotice={setNotice}
            onSaved={async () => {
              setOperationModal(null);
              await load();
            }}
          />
        </OperationModal>
      )}

      {operationModal === 'server-config' && (
        <OperationModal title="Configurar servidor" onClose={() => setOperationModal(null)}>
          <ServerExpenseConfigCard
            activeConfig={activeConfig}
            canConfigure={interfaceMode === ROLES.DIRECTIVO}
            onNotice={setNotice}
            onSaved={async () => {
              setOperationModal(null);
              await load();
            }}
          />
        </OperationModal>
      )}

      <ConfirmDialog
        open={review?.decision === 'approved'}
        title="Aprobar y postear rendicion"
        description={review ? `Se creara un egreso por ${formatCurrency(review.expense.amountMinor)} vinculado a la rendicion.` : null}
        confirmLabel="Aprobar y postear"
        onCancel={() => setReview(null)}
        onConfirm={() => void confirmReview()}
      />
      <DangerActionDialog
        open={review?.decision === 'rejected'}
        title="Rechazar rendicion"
        description="El motivo queda asociado a la rendicion."
        reason={reviewReason}
        confirmLabel="Rechazar"
        onReasonChange={setReviewReason}
        onCancel={() => {
          setReview(null);
          setReviewReason('');
        }}
        onConfirm={() => void confirmReview()}
      />
    </div>
  );
}
