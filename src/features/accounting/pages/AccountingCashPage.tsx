import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { limit as firestoreLimit, query, where } from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import { SearchFiltersPanel } from '../../../components/SearchFiltersPanel';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import { ACCOUNTING_EXPENSE_CATEGORY_IDS, ACCOUNTING_INCOME_CATEGORY_IDS, ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import {
  createCashClosuresRepository,
  createFinancialConfigsRepository,
  createFinancialExpenseCategoriesRepository,
  createFinancialIncomeCategoriesRepository,
  createFinancialMovementsRepository,
  createHandicapChargesRepository,
  createPaymentMethodsRepository,
} from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { CashClosureDocument, EntityWithId, FinancialConfigDocument, FinancialMovementDocument, HandicapChargeDocument, UpsertFinancialConfigPayload } from '../../../modules/accounting/domain/models';
import type { EmployeeDocument, MemberDocument } from '../../../modules/users/domain/models';
import { createEmployeesRepository, createMembersRepository } from '../../../modules/users/infrastructure/firestore/repositories';
import { AccountingPieChart, AccountingVerticalTrendChart, type ChartDatum, type VerticalTrendDatum } from '../components/AccountingCharts';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingInternalTransfersPanel } from '../components/AccountingInternalTransfersPanel';
import { AccountingMovementDetailModal } from '../components/AccountingMovementDetailModal';
import { AccountingMovementActions } from '../components/AccountingMovementActions';
import { AccountingMovementsPanel } from '../components/AccountingMovementsPanel';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { AccountingOperationModal } from '../components/AccountingOperationModal';
import { ManualIncomeForm } from '../components/ManualIncomeForm';
import { InstallmentPlanFields, normalizePercentageInput, parsePercentageToBps } from '../components/InstallmentPlanFields';
import { PaymentCommissionSummary } from '../components/PaymentCommissionSummary';
import { InstallmentProgress } from '../components/InstallmentProgress';
import type { AccountingNotice } from '../types/accounting';
import type { PaymentMethod } from '../types/payment';
import type { ExpenseCategoryOption, IncomeCategoryOption } from '../utils/accountingCategories';
import {
  formatExpenseCategoryName,
  getCategoryLabel,
  getFallbackExpenseCategories,
  getFallbackIncomeCategories,
  includeRequiredExpenseCategories,
} from '../utils/accountingCategories';
import { getMovementBalanceRowClassName, isMovementExcludedFromBalance } from '../utils/balanceInclusion';
import {
  buildArgentinaDateIso,
  formatCurrency,
  formatPeriod,
  formatTimestamp,
  getCurrentAccountingPeriod,
  getSignedMovementAmount,
  normalizeAccountingPeriod,
  parseAmountInputToMinor,
  timestampToDate,
} from '../utils/accountingFormatters';
import {
  PAYMENT_ACCOUNT_OPTIONS,
  calculatePaymentCommission,
  getMovementStatusLabel,
  getPaymentMethodAccount,
  getPaymentMethodDisplayName,
  getPaymentMethodsForAccount,
  isVisiblePaymentMethod,
  type PaymentAccountId,
} from '../utils/paymentMethods';
import { DEFAULT_SERVER_EXPENSE_DUE_DAY, getServerExpenseAlertMessage } from '../utils/serverExpenseAlert';
import { AccountingCashClosuresPage } from './AccountingCashClosuresPage';

const accountingCallables = createAccountingCallables();
const DEFAULT_SERVER_MONTHLY_USD_MINOR = 6500;
const CASH_OPERATION_TIMEOUT_MS = 25000;

type CashTab = 'movimientos' | 'balances' | 'cobros' | 'egresos' | 'caja';
type CashOperationModal = 'income-priority' | 'income-other' | 'expense' | 'transfer' | null;
type BalanceTrendMode = 'day' | 'week' | 'month';

const CASH_TABS: Array<{ id: CashTab; label: string }> = [
  { id: 'movimientos', label: 'Movimientos' },
  { id: 'balances', label: 'Balances' },
  { id: 'cobros', label: 'Cobros' },
  { id: 'egresos', label: 'Egresos' },
  { id: 'caja', label: 'Caja' },
];

function FiltersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5c0 .37-.14.72-.39.99L14 12.48V18a1 1 0 0 1-.55.89l-3 1.5A1 1 0 0 1 9 19.5v-7.02L4.39 6.49A1.5 1.5 0 0 1 4 5.5Zm2.02.5 4.77 5.36c.14.16.21.36.21.57v5.95l1-.5v-5.45c0-.21.08-.41.22-.57L17 6H6.02Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.17l3.9-3.88a1 1 0 1 1 1.4 1.42l-4.6 4.58a1 1 0 0 1-1.4 0L6.7 10.7a1 1 0 0 1 0-1.42Z" />
    </svg>
  );
}

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getOperationModalFromParam(value: string | null): CashOperationModal {
  return value === 'income-priority' || value === 'income-other' || value === 'expense' || value === 'transfer' ? value : null;
}

function getCashTabFromParam(value: string | null): CashTab {
  if (value === 'cierre') {
    return 'caja';
  }

  return CASH_TABS.some((tab) => tab.id === value) ? value as CashTab : 'movimientos';
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

function formatDayKeyDisplay(dayKey: string) {
  const [year, month, day] = dayKey.split('-');
  return day && month && year ? `${day}/${month}/${year}` : dayKey;
}

const MOVEMENT_ORIGIN_LABELS: Record<string, string> = {
  admin_expense: 'Egreso administrativo',
  advertising_contract: 'Publicidad',
  concession_contract: 'Concesion',
  expense_submission: 'Rendicion',
  green_fee: 'Green fee',
  handicap: 'Handicap',
  handicap_transfer: 'Pago AAG',
  internal_transfer: 'Transferencia interna',
  manual_income: 'Cobro manual',
  member_fee_charge: 'Cuota societaria',
  member_fee_payment: 'Cuota societaria',
  rental_green_space: 'Alquiler espacio verde',
  rental_gym: 'Alquiler gimnasio',
  rental_hall: 'Alquiler salon',
  rental_padel: 'Alquiler padel',
  rental_tennis: 'Alquiler tenis',
  salary_payment: 'Sueldo',
  salary_payment_overtime: 'Horas extra',
  tournament_registration: 'Inscripcion torneo',
};

function getMovementReferenceLabel(movement: EntityWithId<FinancialMovementDocument>) {
  const paymentReference = typeof movement.metadata?.paymentReference === 'string'
    ? movement.metadata.paymentReference.trim()
    : '';

  if (paymentReference) {
    return paymentReference;
  }

  return MOVEMENT_ORIGIN_LABELS[movement.originType] ?? 'Sin referencia';
}

function getMovementListAmountMinor(movement: EntityWithId<FinancialMovementDocument>) {
  return movement.originType === 'member_fee_payment'
    ? movement.grossAmountMinor
    : movement.netAmountMinor;
}

function normalizeAssociationName(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

async function listCollectedPendingHandicapCharges() {
  const repository = createHandicapChargesRepository();
  const items = await repository.listByQuery(
    query(
      repository.collectionRef,
      where('status', '==', 'collected'),
      firestoreLimit(100),
    ),
  );
  return items
    .filter((item) => !item.expenseMovementId)
    .sort((left, right) => right.period.localeCompare(left.period));
}

function getOpenClosureBefore(closures: Array<EntityWithId<CashClosureDocument>>, dayKey: string) {
  return closures
    .filter((closure) => closure.status === 'open' && getClosureDayKey(closure) < dayKey)
    .sort((left, right) => getClosureDayKey(left).localeCompare(getClosureDayKey(right)))[0] ?? null;
}

function buildFinancialConfigPayload(
  config: EntityWithId<FinancialConfigDocument>,
  serverMonthlyExpenseMinor: number,
  serverMonthlyExpenseDueDay: number,
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
    serverMonthlyExpenseDueDay,
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

const HIDDEN_EXPENSE_CATEGORY_IDS = new Set<string>([
  ACCOUNTING_EXPENSE_CATEGORY_IDS.f931,
  ACCOUNTING_EXPENSE_CATEGORY_IDS.obraSocial,
  ACCOUNTING_EXPENSE_CATEGORY_IDS.art,
  ACCOUNTING_EXPENSE_CATEGORY_IDS.internalTransfer,
]);

const EMPLOYEE_EXPENSE_CATEGORY_IDS = new Set<string>([
  ACCOUNTING_EXPENSE_CATEGORY_IDS.sueldo,
  ACCOUNTING_EXPENSE_CATEGORY_IDS.horasExtra,
]);

const VENDOR_EXPENSE_CATEGORY_IDS = new Set<string>([
  ACCOUNTING_EXPENSE_CATEGORY_IDS.proveedores,
]);

function isEmployeeExpenseCategory(categoryId: string) {
  return EMPLOYEE_EXPENSE_CATEGORY_IDS.has(categoryId);
}

function isVendorExpenseCategory(categoryId: string) {
  return VENDOR_EXPENSE_CATEGORY_IDS.has(categoryId);
}

function formatTodayDisplay() {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
}

function ExpenseQuickForm({
  employees,
  expenseCategories,
  paymentMethods,
  onNotice,
  onSaved,
}: {
  employees: Array<EntityWithId<EmployeeDocument>>;
  expenseCategories: ExpenseCategoryOption[];
  paymentMethods: PaymentMethod[];
  onNotice: (notice: AccountingNotice) => void;
  onSaved: () => void | Promise<void>;
}) {
  const selectableExpenseCategories = useMemo(
    () => expenseCategories.filter((category) => !HIDDEN_EXPENSE_CATEGORY_IDS.has(category.id)),
    [expenseCategories],
  );
  const [form, setForm] = useState({
    employeeSearch: '',
    categoryId: selectableExpenseCategories[0]?.id ?? '',
    description: '',
    vendorName: '',
    amount: '',
    overtimeHours: '',
    overtimeRate: '',
    paymentMethodId: paymentMethods.find((method) => method.id === ACCOUNTING_PAYMENT_METHOD_IDS.cash)?.id
      ?? paymentMethods[0]?.id
      ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [installmentPlanEnabled, setInstallmentPlanEnabled] = useState(false);
  const [installmentCount, setInstallmentCount] = useState('2');
  const [interestEnabled, setInterestEnabled] = useState(false);
  const [interestPercentage, setInterestPercentage] = useState('0.00');
  const selectedCategory = selectableExpenseCategories.find((category) => category.id === form.categoryId) ?? null;
  const selectedCategoryName = selectedCategory ? formatExpenseCategoryName(selectedCategory.name) : '';
  const needsEmployee = isEmployeeExpenseCategory(form.categoryId);
  const needsVendor = isVendorExpenseCategory(form.categoryId) && !needsEmployee;
  const isOvertime = form.categoryId === ACCOUNTING_EXPENSE_CATEGORY_IDS.horasExtra;
  const overtimeHours = Number(form.overtimeHours.replace(',', '.'));
  const overtimeRateMinor = parseAmountInputToMinor(form.overtimeRate);
  const overtimeAmountMinor = Number.isFinite(overtimeHours) && Number.isFinite(overtimeRateMinor)
    ? Math.round(overtimeHours * overtimeRateMinor)
    : Number.NaN;
  const amountMinorPreview = isOvertime ? overtimeAmountMinor : parseAmountInputToMinor(form.amount);
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === form.paymentMethodId) ?? null;
  const paymentCommission = calculatePaymentCommission(
    Number.isFinite(amountMinorPreview) ? amountMinorPreview : 0,
    selectedPaymentMethod,
  );

  useEffect(() => {
    setForm((current) => ({
      ...current,
      categoryId: selectableExpenseCategories.some((category) => category.id === current.categoryId)
        ? current.categoryId
        : selectableExpenseCategories[0]?.id || '',
    }));
  }, [selectableExpenseCategories]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      paymentMethodId: paymentMethods.some((method) => method.id === current.paymentMethodId)
        ? current.paymentMethodId
        : paymentMethods.find((method) => method.id === ACCOUNTING_PAYMENT_METHOD_IDS.cash)?.id ?? paymentMethods[0]?.id ?? '',
    }));
  }, [paymentMethods]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = isOvertime ? overtimeAmountMinor : parseAmountInputToMinor(form.amount);
    const employeeId = needsEmployee ? resolveEmployeeId(employees, form.employeeSearch) : '';
    if (needsEmployee && !employeeId) {
      onNotice({ kind: 'error', message: 'Selecciona el empleado asociado.' });
      return;
    }
    if (
      !form.categoryId
      || (!installmentPlanEnabled && !form.paymentMethodId)
      || !Number.isFinite(amountMinor)
      || amountMinor <= 0
    ) {
      onNotice({ kind: 'error', message: 'Completa categoria, cuenta de origen y monto valido.' });
      return;
    }
    const parsedInstallmentCount = Number(installmentCount);
    const interestPctBps = interestEnabled ? parsePercentageToBps(interestPercentage) : 0;
    if (
      installmentPlanEnabled
      && (!Number.isInteger(parsedInstallmentCount) || parsedInstallmentCount < 2 || parsedInstallmentCount > 120)
    ) {
      onNotice({ kind: 'error', message: 'La cantidad de cuotas debe estar entre 2 y 120.' });
      return;
    }
    if (installmentPlanEnabled && (!Number.isFinite(interestPctBps) || interestPctBps < 0 || interestPctBps > 10000)) {
      onNotice({ kind: 'error', message: 'El interes debe estar entre 0 y 100%.' });
      return;
    }
    if (isOvertime && (!Number.isFinite(overtimeHours) || overtimeHours <= 0 || !Number.isFinite(overtimeRateMinor) || overtimeRateMinor <= 0)) {
      onNotice({ kind: 'error', message: 'Completa cantidad de horas y monto por hora.' });
      return;
    }

    const selectedEmployee = employees.find((employee) => employee.id === employeeId) ?? null;
    const employeeName = selectedEmployee ? getEmployeeDisplayName(selectedEmployee) : '';
    const generatedDescription = isOvertime
      ? `Horas extra ${employeeName}: ${form.overtimeHours} h x ${form.overtimeRate}`
      : needsEmployee
        ? `Pago de ${selectedCategoryName.toLowerCase()} ${employeeName}`
        : form.description.trim();

    setSaving(true);
    try {
      if (installmentPlanEnabled) {
        const result = await withTimeout(
          accountingCallables.createInstallmentPlan({
            movementType: 'expense',
            categoryId: form.categoryId,
            baseAmountMinor: amountMinor,
            installmentCount: parsedInstallmentCount,
            interestPctBps,
            operationDate: buildArgentinaDateIso(todayInputValue()),
            thirdPartyType: selectedEmployee ? 'employee' : form.vendorName.trim() ? 'vendor' : null,
            thirdPartyId: selectedEmployee?.id ?? null,
            notes: generatedDescription || form.description.trim() || null,
            metadata: {
              description: generatedDescription || selectedCategoryName,
              vendorName: form.vendorName.trim() || null,
              employeeName,
              overtimeHours: isOvertime ? overtimeHours : null,
              overtimeRateMinor: isOvertime ? overtimeRateMinor : null,
            },
          }),
          CASH_OPERATION_TIMEOUT_MS,
          'La carga en cuotas no respondio a tiempo. Revisala en movimientos antes de volver a generarla.',
        );
        onNotice({ kind: 'success', message: `Egreso cargado en ${result.installmentCount} cuotas por ${formatCurrency(result.totalAmountMinor)}.` });
        setInstallmentPlanEnabled(false);
        setInterestEnabled(false);
        setInterestPercentage('0.00');
        setForm((current) => ({ ...current, description: '', vendorName: '', amount: '', overtimeHours: '', overtimeRate: '' }));
        await onSaved();
        return;
      }

      const result = await withTimeout(
        accountingCallables.registerExpenseMovement({
          categoryId: form.categoryId,
          employeeId: employeeId || null,
          description: generatedDescription || selectedCategoryName,
          amountMinor,
          vendorName: form.vendorName.trim() || null,
          paymentMethodId: form.paymentMethodId,
          metadata: {
            overtimeHours: isOvertime ? overtimeHours : null,
            overtimeRateMinor: isOvertime ? overtimeRateMinor : null,
          },
          notes: generatedDescription || form.description.trim() || null,
        }),
        CASH_OPERATION_TIMEOUT_MS,
        'El egreso no respondio a tiempo. Revisalo en movimientos antes de volver a cargarlo.',
      );
      onNotice({ kind: 'success', message: `Egreso registrado como movimiento ${result.movementId}.` });
      setForm((current) => ({ ...current, description: '', vendorName: '', amount: '', overtimeHours: '', overtimeRate: '' }));
      await onSaved();
    } catch (error) {
      onNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos registrar el egreso.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="floating-card accounting-panel">
      <form className="accounting-entry-form accounting-dialog-form accounting-dialog-form--expense" onSubmit={handleSubmit}>
        <label className="form-field form-field--wide">
          <span>Categoria</span>
          <select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value, description: '', vendorName: '', amount: '', overtimeHours: '', overtimeRate: '' }))}>
            {selectableExpenseCategories.map((category) => <option key={category.id} value={category.id}>{formatExpenseCategoryName(category.name)}</option>)}
          </select>
        </label>
        {!installmentPlanEnabled && <label className="form-field form-field--wide">
          <span>Cuenta de origen / medio de pago</span>
          <select value={form.paymentMethodId} onChange={(event) => setForm((current) => ({ ...current, paymentMethodId: event.target.value }))}>
            {paymentMethods.length === 0 && <option value="">Sin medios de pago activos</option>}
            {paymentMethods.map((method) => <option key={method.id} value={method.id}>{getPaymentMethodDisplayName(method)}</option>)}
          </select>
        </label>}
        {needsEmployee && (
          <label className="form-field form-field--wide">
            <span>Empleado asociado</span>
            <input list="cash-expense-employees" value={form.employeeSearch} onChange={(event) => setForm((current) => ({ ...current, employeeSearch: event.target.value }))} placeholder="Buscar empleado" />
            <datalist id="cash-expense-employees">
              {employees.map((employee) => <option key={employee.id} value={getEmployeeDisplayName(employee)} />)}
            </datalist>
          </label>
        )}
        {needsVendor && (
          <label className="form-field"><span>Proveedor</span><input value={form.vendorName} onChange={(event) => setForm((current) => ({ ...current, vendorName: event.target.value }))} /></label>
        )}
        {isOvertime ? (
          <>
            <label className="form-field"><span>Cantidad de horas extra</span><input type="number" min="0" step="0.5" inputMode="decimal" value={form.overtimeHours} onChange={(event) => setForm((current) => ({ ...current, overtimeHours: event.target.value }))} /></label>
            <label className="form-field accounting-money-field"><span>Monto por hora ARS</span><input type="number" min="0" step="0.01" inputMode="decimal" value={form.overtimeRate} onChange={(event) => setForm((current) => ({ ...current, overtimeRate: event.target.value }))} /></label>
            <div className="accounting-inline-summary form-field--wide">
              <span>Total a pagar</span>
              <strong>{Number.isFinite(overtimeAmountMinor) ? formatCurrency(overtimeAmountMinor) : formatCurrency(0)}</strong>
            </div>
          </>
        ) : (
          <label className="form-field accounting-money-field"><span>Monto ARS</span><input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></label>
        )}
        <InstallmentPlanFields
          enabled={installmentPlanEnabled}
          label="Pago en cuotas"
          installmentCount={installmentCount}
          interestEnabled={interestEnabled}
          interestPercentage={interestPercentage}
          baseAmountMinor={Number.isFinite(amountMinorPreview) ? amountMinorPreview : 0}
          onEnabledChange={setInstallmentPlanEnabled}
          onInstallmentCountChange={setInstallmentCount}
          onInterestEnabledChange={setInterestEnabled}
          onInterestPercentageChange={setInterestPercentage}
          onInterestPercentageBlur={() => setInterestPercentage((current) => normalizePercentageInput(current))}
        />
        {!installmentPlanEnabled && selectedPaymentMethod && (
          <PaymentCommissionSummary
            direction="expense"
            baseAmountMinor={Number.isFinite(amountMinorPreview) ? amountMinorPreview : 0}
            commissionAmountMinor={paymentCommission.commissionAmountMinor}
            commissionPctBps={paymentCommission.percentageBps}
            totalAmountMinor={paymentCommission.totalAmountMinor}
            breakdown={selectedPaymentMethod.activeCommissionBreakdown ?? []}
          />
        )}
        {!needsEmployee && <label className="form-field form-field--wide"><span>Descripcion</span><input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>}
        <div className="form-actions form-actions--right">
          <UiActionButton type="submit" disabled={saving || (!installmentPlanEnabled && !form.paymentMethodId)}>
            {saving ? 'Guardando...' : installmentPlanEnabled ? 'Crear carga en cuotas' : 'Guardar egreso'}
          </UiActionButton>
        </div>
      </form>
    </section>
  );
}

function getPrimaryAccountMethod(paymentMethods: PaymentMethod[], accountId: PaymentAccountId) {
  const methods = getPaymentMethodsForAccount(paymentMethods, accountId);
  const preferredId = accountId === 'cash'
    ? ACCOUNTING_PAYMENT_METHOD_IDS.cash
    : accountId === 'macro'
      ? ACCOUNTING_PAYMENT_METHOD_IDS.transferMacro
      : accountId === 'debitMacro'
        ? ACCOUNTING_PAYMENT_METHOD_IDS.debitMacro
        : ACCOUNTING_PAYMENT_METHOD_IDS.transferGalicia;
  return methods.find((method) => method.id === preferredId) ?? methods[0] ?? null;
}

function getTransferAccountLabel(accountId: PaymentAccountId) {
  return PAYMENT_ACCOUNT_OPTIONS.find((option) => option.id === accountId)?.label ?? accountId;
}

function getAlternateTransferAccount(accountId: PaymentAccountId): PaymentAccountId {
  return PAYMENT_ACCOUNT_OPTIONS.find((option) => option.id !== accountId)?.id ?? 'cash';
}

function getTransferDirectionSummary(sourceAccountId: PaymentAccountId, destinationAccountId: PaymentAccountId) {
  if (sourceAccountId === 'cash') {
    return `Deposito de efectivo en ${getTransferAccountLabel(destinationAccountId)}`;
  }
  if (destinationAccountId === 'cash') {
    return `Retiro desde ${getTransferAccountLabel(sourceAccountId)} hacia efectivo`;
  }
  return `Egreso en ${getTransferAccountLabel(sourceAccountId)} e ingreso en ${getTransferAccountLabel(destinationAccountId)}`;
}

function TransferFundsForm({
  paymentMethods,
  onNotice,
  onSaved,
}: {
  paymentMethods: PaymentMethod[];
  onNotice: (notice: AccountingNotice) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    sourceAccountId: 'macro' as PaymentAccountId,
    destinationAccountId: 'galicia' as PaymentAccountId,
    amount: '',
    reference: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const sourceMethod = getPrimaryAccountMethod(paymentMethods, form.sourceAccountId);
  const destinationMethod = getPrimaryAccountMethod(paymentMethods, form.destinationAccountId);
  const amountMinor = parseAmountInputToMinor(form.amount);
  const directionSummary = getTransferDirectionSummary(form.sourceAccountId, form.destinationAccountId);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.sourceAccountId === form.destinationAccountId) {
      onNotice({ kind: 'error', message: 'Selecciona cuentas distintas para origen y destino.' });
      return;
    }
    if (!sourceMethod || !destinationMethod) {
      onNotice({ kind: 'error', message: 'No hay medios de pago activos para la cuenta seleccionada.' });
      return;
    }
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      onNotice({ kind: 'error', message: 'Ingresa un monto valido para mover.' });
      return;
    }

    setSaving(true);
    try {
      const result = await withTimeout(
        accountingCallables.transferFunds({
          sourcePaymentMethodId: sourceMethod.id,
          destinationPaymentMethodId: destinationMethod.id,
          amountMinor,
          operationDate: buildArgentinaDateIso(todayInputValue()),
          reference: form.reference.trim() || null,
          notes: form.notes.trim() || null,
        }),
        CASH_OPERATION_TIMEOUT_MS,
        'La transferencia no respondio a tiempo. Revisala en movimientos antes de volver a cargarla.',
      );
      onNotice({ kind: 'success', message: `Transferencia interna registrada con referencia ${result.reference}.` });
      setForm((current) => ({ ...current, amount: '', reference: '', notes: '' }));
      await onSaved();
    } catch (error) {
      onNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos registrar la transferencia.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="floating-card accounting-panel">
      <form className="accounting-entry-form accounting-dialog-form" onSubmit={handleSubmit}>
        <label className="form-field">
          <span>Desde</span>
          <select
            value={form.sourceAccountId}
            onChange={(event) => setForm((current) => ({
              ...current,
              sourceAccountId: event.target.value as PaymentAccountId,
              destinationAccountId: current.destinationAccountId === event.target.value ? getAlternateTransferAccount(event.target.value as PaymentAccountId) : current.destinationAccountId,
            }))}
          >
            {PAYMENT_ACCOUNT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <small>{sourceMethod ? getPaymentMethodDisplayName(sourceMethod) : 'Sin medio activo'}</small>
        </label>
        <label className="form-field">
          <span>Hacia</span>
          <select
            value={form.destinationAccountId}
            onChange={(event) => setForm((current) => ({
              ...current,
              destinationAccountId: event.target.value as PaymentAccountId,
              sourceAccountId: current.sourceAccountId === event.target.value ? getAlternateTransferAccount(event.target.value as PaymentAccountId) : current.sourceAccountId,
            }))}
          >
            {PAYMENT_ACCOUNT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <small>{destinationMethod ? getPaymentMethodDisplayName(destinationMethod) : 'Sin medio activo'}</small>
        </label>
        <label className="form-field accounting-money-field">
          <span>Monto ARS</span>
          <input inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} />
        </label>
        <label className="form-field"><span>Referencia</span><input value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} /></label>
        <label className="form-field form-field--wide"><span>Notas</span><input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
        <div className="accounting-inline-summary form-field--wide">
          <span>Movimiento generado</span>
          <strong>{directionSummary}</strong>
          <small>{sourceMethod ? getPaymentMethodDisplayName(sourceMethod) : 'Sin medio origen'}{' -> '}{destinationMethod ? getPaymentMethodDisplayName(destinationMethod) : 'Sin medio destino'}</small>
        </div>
        <div className="form-actions form-actions--right">
          <UiActionButton type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Mover plata'}</UiActionButton>
        </div>
      </form>
    </section>
  );
}

function CashActionButton({
  label,
  helper,
  icon,
  tone = 'default',
  disabled = false,
  onClick,
}: {
  label: string;
  helper: string;
  icon: ReactNode;
  tone?: 'default' | 'expense' | 'transfer';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`action-tile accounting-action-tile accounting-action-tile--${tone}`} disabled={disabled} onClick={onClick}>
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

function isPostedMovement(movement: EntityWithId<FinancialMovementDocument>) {
  return movement.status === 'posted' && !isMovementExcludedFromBalance(movement);
}

function getMovementDateKeyFromTimestamp(movement: EntityWithId<FinancialMovementDocument>) {
  const date = timestampToDate(movement.operationDate);
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

function groupMovementsByCategory(
  movements: Array<EntityWithId<FinancialMovementDocument>>,
  movementType: 'income' | 'expense',
  mode: BalanceTrendMode,
): ChartDatum[] {
  const grouped = new Map<string, number>();
  movements
    .filter((movement) => movement.movementType === movementType)
    .forEach((movement) => {
      const categoryLabel = getCategoryLabel(movement.categoryId);
      const dateKey = getMovementDateKeyFromTimestamp(movement);
      const bucket = dateKey ? getTrendBucketKey(dateKey, mode) : '';
      const bucketLabel = bucket ? formatTrendBucketLabel(bucket, mode) : '';
      const label = mode === 'month' || !bucketLabel ? categoryLabel : `${categoryLabel} (${bucketLabel})`;
      grouped.set(label, (grouped.get(label) ?? 0) + movement.netAmountMinor);
    });

  return Array.from(grouped.entries()).map(([label, valueMinor]) => ({ label, valueMinor }));
}

function getTrendBucketKey(dateKey: string, mode: BalanceTrendMode) {
  if (mode === 'day') {
    return dateKey;
  }
  if (mode === 'month') {
    return dateKey.slice(0, 7);
  }
  const day = Number(dateKey.slice(8, 10));
  return `${dateKey.slice(0, 7)}-S${Math.max(1, Math.ceil(day / 7))}`;
}

function formatTrendBucketLabel(bucket: string, mode: BalanceTrendMode) {
  if (mode === 'day') {
    const [, month, day] = bucket.split('-');
    return `${day}/${month}`;
  }
  if (mode === 'month') {
    return formatPeriod(bucket);
  }
  const [period, week] = bucket.split('-S');
  return `${formatPeriod(period ?? '')} - sem. ${week ?? '1'}`;
}

function buildBalanceTrendData(
  movements: Array<EntityWithId<FinancialMovementDocument>>,
  mode: BalanceTrendMode,
): VerticalTrendDatum[] {
  const grouped = new Map<string, { incomeMinor: number; expenseMinor: number }>();
  movements.forEach((movement) => {
    const dateKey = getMovementDateKeyFromTimestamp(movement);
    if (!dateKey) {
      return;
    }
    const bucket = getTrendBucketKey(dateKey, mode);
    const current = grouped.get(bucket) ?? { incomeMinor: 0, expenseMinor: 0 };
    if (movement.movementType === 'income') {
      current.incomeMinor += movement.netAmountMinor;
    } else {
      current.expenseMinor += movement.netAmountMinor;
    }
    grouped.set(bucket, current);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, value]) => ({
      label: formatTrendBucketLabel(bucket, mode),
      incomeMinor: value.incomeMinor,
      expenseMinor: value.expenseMinor,
    }));
}

function getBalancePeriodRange(period: string) {
  const normalized = normalizeAccountingPeriod(period);
  const [yearText, monthText] = normalized.split('-');
  const lastDay = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
  return {
    dateFrom: `${normalized}-01`,
    dateTo: `${normalized}-${String(lastDay).padStart(2, '0')}`,
  };
}

function getBalanceTrendTitle(showIncome: boolean, showExpense: boolean) {
  if (showIncome && showExpense) {
    return 'Tendencia neta';
  }
  if (showIncome) {
    return 'Tendencia de ingresos';
  }
  return 'Tendencia de egresos';
}

function getPaymentAccountIdForMethod(
  paymentMethodId: string | null | undefined,
  paymentMethods: PaymentMethod[],
): PaymentAccountId | null {
  if (!paymentMethodId) {
    return null;
  }

  const paymentMethod = paymentMethods.find((method) => method.id === paymentMethodId);
  return getPaymentMethodAccount(paymentMethod ?? {
    id: paymentMethodId,
    name: getPaymentMethodDisplayName(paymentMethodId),
  });
}

function getMovementPaymentAccountId(
  movement: EntityWithId<FinancialMovementDocument>,
  paymentMethods: PaymentMethod[],
) {
  return getPaymentAccountIdForMethod(
    movement.paymentMethodId ?? movement.paymentMethodCodeSnapshot,
    paymentMethods,
  );
}

function AccountingCashBalancesPanel({
  movements,
  balanceMovements,
  paymentMethods,
  incomeCategories,
  expenseCategories,
  period,
  loading,
  onPeriodChange,
  onOpenTransfer,
  onSelectMovement,
  onMovementChanged,
  canCreateTransfer,
}: {
  movements: Array<EntityWithId<FinancialMovementDocument>>;
  balanceMovements: Array<EntityWithId<FinancialMovementDocument>>;
  paymentMethods: PaymentMethod[];
  incomeCategories: IncomeCategoryOption[];
  expenseCategories: ExpenseCategoryOption[];
  period: string;
  loading: boolean;
  onPeriodChange: (period: string) => void;
  onOpenTransfer: () => void;
  onSelectMovement: (movement: EntityWithId<FinancialMovementDocument>) => void;
  onMovementChanged: () => void | Promise<void>;
  canCreateTransfer: boolean;
}) {
  const [trendMode, setTrendMode] = useState<BalanceTrendMode>('day');
  const [isStatisticsFiltersOpen, setIsStatisticsFiltersOpen] = useState(false);
  const [showIncomeTrend, setShowIncomeTrend] = useState(true);
  const [showExpenseTrend, setShowExpenseTrend] = useState(true);
  const [dateRange, setDateRange] = useState(() => getBalancePeriodRange(period));
  useEffect(() => {
    setDateRange(getBalancePeriodRange(period));
  }, [period, trendMode]);
  const postedMovements = useMemo(() => movements.filter((movement) => {
    if (!isPostedMovement(movement) || movement.originType === 'internal_transfer') {
      return false;
    }
    if (trendMode === 'month') {
      return true;
    }
    const dateKey = getMovementDateKeyFromTimestamp(movement);
    if (dateRange.dateFrom && (!dateKey || dateKey < dateRange.dateFrom)) {
      return false;
    }
    if (dateRange.dateTo && (!dateKey || dateKey > dateRange.dateTo)) {
      return false;
    }
    return true;
  }), [dateRange.dateFrom, dateRange.dateTo, movements, trendMode]);
  const incomeTotalMinor = postedMovements
    .filter((movement) => movement.movementType === 'income')
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
  const expenseTotalMinor = postedMovements
    .filter((movement) => movement.movementType === 'expense')
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
  const incomeCategoryData = useMemo(() => groupMovementsByCategory(postedMovements, 'income', trendMode), [postedMovements, trendMode]);
  const expenseCategoryData = useMemo(() => groupMovementsByCategory(postedMovements, 'expense', trendMode), [postedMovements, trendMode]);
  const trendData = useMemo(() => buildBalanceTrendData(postedMovements, trendMode), [postedMovements, trendMode]);
  const postedBalanceMovements = useMemo(
    () => balanceMovements.filter(isPostedMovement),
    [balanceMovements],
  );
  const accountBalances = useMemo(
    () => PAYMENT_ACCOUNT_OPTIONS.map((account) => {
      const accountMovements = postedBalanceMovements.filter(
        (movement) => getMovementPaymentAccountId(movement, paymentMethods) === account.id,
      );
      return {
        ...account,
        balanceMinor: accountMovements.reduce((total, movement) => total + getSignedMovementAmount(movement), 0),
        movementCount: accountMovements.length,
      };
    }),
    [paymentMethods, postedBalanceMovements],
  );
  const handleIncomeToggle = (checked: boolean) => {
    if (!checked && !showExpenseTrend) {
      return;
    }
    setShowIncomeTrend(checked);
  };
  const handleExpenseToggle = (checked: boolean) => {
    if (!checked && !showIncomeTrend) {
      return;
    }
    setShowExpenseTrend(checked);
  };

  return (
    <section className="floating-card accounting-panel accounting-centered-panel accounting-balances-panel">
      <div className="accounting-section-header accounting-section-header--plain">
        <div>
          <p className="eyebrow">Disponibilidad</p>
          <h2>Saldos por cuenta</h2>
          <p>Saldo acumulado hasta el cierre de {formatPeriod(period)}.</p>
        </div>
      </div>
      <div className="summary-grid accounting-account-balances-grid">
        {accountBalances.map((account) => (
          <article key={account.id} className="summary-card accounting-account-balance-card">
            <span>{account.label}</span>
            <strong className={account.balanceMinor < 0 ? 'accounting-negative-amount' : ''}>{formatCurrency(account.balanceMinor)}</strong>
            <small>{account.helper ?? `${account.movementCount} movimientos acumulados`}</small>
          </article>
        ))}
      </div>
      <AccountingInternalTransfersPanel
        movements={balanceMovements}
        paymentMethods={paymentMethods}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        period={period}
        loading={loading}
        canCreateTransfer={canCreateTransfer}
        onOpenTransfer={onOpenTransfer}
        onSelectMovement={onSelectMovement}
        onMovementChanged={onMovementChanged}
      />

      <div className="accounting-balance-analytics">
        <section className="accounting-balance-distribution-section" aria-labelledby="balance-distribution-title">
          <div className="accounting-section-header accounting-section-header--plain">
            <div>
              <p className="eyebrow">Distribucion</p>
              <h2 id="balance-distribution-title">Distribucion del balance</h2>
              <p>Ingresos, egresos y categorias del periodo seleccionado.</p>
            </div>
          </div>
          <div className="accounting-chart-grid accounting-balance-distribution-grid">
            <AccountingPieChart
              title="Ingresos y egresos"
              colors={['#0f7a5a', '#b42318']}
              data={[
                { label: 'Ingresos', valueMinor: incomeTotalMinor, color: '#0f7a5a' },
                { label: 'Egresos', valueMinor: expenseTotalMinor, color: '#b42318' },
              ]}
            />
            <AccountingPieChart title="Ingresos por categoria" data={incomeCategoryData} />
            <AccountingPieChart
              title="Egresos por categoria"
              colors={['#b42318', '#d9480f', '#9f1239', '#7f1d1d', '#64748b', '#92400e']}
              data={expenseCategoryData}
            />
          </div>
        </section>

        <section className="accounting-balance-statistics-section" aria-label="Estadisticas del balance">
          <AccountingVerticalTrendChart
            title={getBalanceTrendTitle(showIncomeTrend, showExpenseTrend)}
            data={trendData.length ? trendData : [{ label: 'Sin datos', incomeMinor: 0, expenseMinor: 0 }]}
            showIncome={showIncomeTrend}
            showExpense={showExpenseTrend}
            toolbar={(
              <SearchFiltersPanel
                open={isStatisticsFiltersOpen}
                onToggle={() => setIsStatisticsFiltersOpen((current) => !current)}
                title="Filtros"
                helper=""
                icon={<FiltersIcon />}
                chevron={<ChevronIcon />}
                className="accounting-search-collapse accounting-balance-filters-collapse"
                rowClassName="accounting-balance-filter-row"
                fields={[
                  {
                    id: 'balanceTrendMode',
                    label: 'Agrupar estadisticas',
                    value: trendMode,
                    onChange: (value) => setTrendMode(value as BalanceTrendMode),
                    type: 'select',
                    className: 'form-field member-filter accounting-balance-trend-mode',
                    options: [
                      { value: 'day', label: 'Por dia' },
                      { value: 'week', label: 'Por semana' },
                      { value: 'month', label: 'Por mes' },
                    ],
                  },
                  {
                    id: 'balancePeriod',
                    label: 'Periodo',
                    value: period,
                    onChange: (value) => onPeriodChange(normalizeAccountingPeriod(value)),
                    type: 'month',
                    max: getCurrentAccountingPeriod(),
                    hidden: trendMode !== 'month',
                    className: 'form-field member-filter accounting-balance-trend-mode',
                  },
                  {
                    id: 'balanceDateFrom',
                    label: 'Desde',
                    value: dateRange.dateFrom,
                    onChange: (value) => setDateRange((current) => ({ ...current, dateFrom: value })),
                    type: 'date',
                    hidden: trendMode === 'month',
                    className: 'form-field member-filter accounting-balance-trend-mode',
                  },
                  {
                    id: 'balanceDateTo',
                    label: 'Hasta',
                    value: dateRange.dateTo,
                    onChange: (value) => setDateRange((current) => ({ ...current, dateTo: value })),
                    type: 'date',
                    hidden: trendMode === 'month',
                    className: 'form-field member-filter accounting-balance-trend-mode',
                  },
                ]}
                actions={(
                  <div className="accounting-balance-series-controls" aria-label="Series de tendencia">
                    <label className="check-field">
                      <input type="checkbox" checked={showIncomeTrend} onChange={(event) => handleIncomeToggle(event.target.checked)} />
                      <span>Ingresos</span>
                    </label>
                    <label className="check-field">
                      <input type="checkbox" checked={showExpenseTrend} onChange={(event) => handleExpenseToggle(event.target.checked)} />
                      <span>Egresos</span>
                    </label>
                  </div>
                )}
              />
            )}
          />
        </section>
      </div>
    </section>
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
  const [dueDay, setDueDay] = useState(String(DEFAULT_SERVER_EXPENSE_DUE_DAY));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAmount(activeConfig?.serverMonthlyExpenseMinor ? String(activeConfig.serverMonthlyExpenseMinor / 100).replace('.', ',') : '65');
    setDueDay(String(activeConfig?.serverMonthlyExpenseDueDay ?? DEFAULT_SERVER_EXPENSE_DUE_DAY));
  }, [activeConfig?.id, activeConfig?.serverMonthlyExpenseDueDay, activeConfig?.serverMonthlyExpenseMinor]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeConfig || !canConfigure) {
      return;
    }
    const amountMinor = parseAmountInputToMinor(amount);
    const parsedDueDay = Number(dueDay);
    if (!Number.isFinite(amountMinor) || amountMinor < 0) {
      onNotice({ kind: 'error', message: 'Ingresa un monto valido para el servidor.' });
      return;
    }
    if (!Number.isInteger(parsedDueDay) || parsedDueDay < 1 || parsedDueDay > 28) {
      onNotice({ kind: 'error', message: 'El vencimiento del servidor debe ser un dia entre 1 y 28.' });
      return;
    }

    setSaving(true);
    try {
      const result = await accountingCallables.upsertFinancialConfig(buildFinancialConfigPayload(activeConfig, amountMinor, parsedDueDay));
      onNotice({ kind: 'success', message: `Gasto fijo servidor actualizado en configuracion version ${result.version}.` });
      await onSaved();
    } catch (error) {
      onNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos actualizar el gasto fijo servidor.' });
    } finally {
      setSaving(false);
    }
  };
  const effectiveDueDay = activeConfig?.serverMonthlyExpenseDueDay ?? DEFAULT_SERVER_EXPENSE_DUE_DAY;
  const isServerConfigIncomplete =
    !activeConfig
    || !activeConfig.serverMonthlyExpenseMinor
    || activeConfig.serverMonthlyExpenseMinor <= 0
    || !activeConfig.serverMonthlyExpenseDueDay;

  return (
    <section className={`floating-card accounting-panel accounting-server-expense-card ${isServerConfigIncomplete ? 'accounting-server-expense-card--alert' : ''}`}>
      <div className="accounting-section-header">
        <div>
          <p className="eyebrow">Gasto fijo</p>
          <h2>Servidor</h2>
        </div>
        <div className="accounting-server-expense-card__meta">
          <span>Vencimiento configurado</span>
          <strong>Dia {effectiveDueDay}</strong>
          <small>{formatUsdMinor(activeConfig?.serverMonthlyExpenseMinor)}</small>
        </div>
      </div>
      {isServerConfigIncomplete && (
        <AccountingInlineNotice notice={{ kind: 'error', message: 'Configura monto y vencimiento del servidor para activar la alerta contable mensual.' }} />
      )}
      {canConfigure ? (
        <form className="accounting-entry-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Monto mensual servidor (USD)</span>
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Vencimiento servidor</span>
            <input type="number" min="1" max="28" inputMode="numeric" value={dueDay} onChange={(event) => setDueDay(event.target.value)} />
          </label>
          <div className="form-actions">
            <UiActionButton type="submit" disabled={saving || !activeConfig}>{saving ? 'Guardando...' : 'Guardar configuracion'}</UiActionButton>
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
  const currentAccountingPeriod = getCurrentAccountingPeriod();
  const activeTab = getCashTabFromParam(searchParams.get('tab'));
  const requestedPeriod = normalizeAccountingPeriod(searchParams.get('period') ?? currentAccountingPeriod);
  const [period, setPeriod] = useState(requestedPeriod > currentAccountingPeriod ? currentAccountingPeriod : requestedPeriod);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [movements, setMovements] = useState<Array<EntityWithId<FinancialMovementDocument>>>([]);
  const [balanceMovements, setBalanceMovements] = useState<Array<EntityWithId<FinancialMovementDocument>>>([]);
  const [closures, setClosures] = useState<Array<EntityWithId<CashClosureDocument>>>([]);
  const [openClosures, setOpenClosures] = useState<Array<EntityWithId<CashClosureDocument>>>([]);
  const [pendingHandicapCharges, setPendingHandicapCharges] = useState<Array<EntityWithId<HandicapChargeDocument>>>([]);
  const [employees, setEmployees] = useState<Array<EntityWithId<EmployeeDocument>>>([]);
  const [members, setMembers] = useState<Array<EntityWithId<MemberDocument>>>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [activeConfig, setActiveConfig] = useState<EntityWithId<FinancialConfigDocument> | null>(null);
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategoryOption[]>(() => getFallbackIncomeCategories());
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryOption[]>(() => getFallbackExpenseCategories());
  const [selectedMovement, setSelectedMovement] = useState<EntityWithId<FinancialMovementDocument> | null>(null);
  const [movementDetailAction, setMovementDetailAction] = useState<'details' | 'register-partial-payment'>('details');
  const [operationModal, setOperationModal] = useState<CashOperationModal>(() => getOperationModalFromParam(searchParams.get('modal')));
  const [aagPaymentMethodId, setAagPaymentMethodId] = useState('');
  const [transferringAag, setTransferringAag] = useState(false);
  const [loading, setLoading] = useState(true);
  const isCurrentPeriod = period === currentAccountingPeriod;
  const isHistoricalPeriod = period < currentAccountingPeriod;

  const load = async () => {
    setLoading(true);
    try {
      const operatingPeriod = normalizeAccountingPeriod(todayInputValue().slice(0, 7));
      const [
        nextMovements,
        nextBalanceMovements,
        nextClosures,
        nextOpenClosures,
        nextPendingHandicapCharges,
        nextEmployees,
        nextMembers,
        nextPaymentMethods,
        nextActiveConfig,
        nextIncomeCategories,
        nextExpenseCategories,
      ] = await Promise.all([
        createFinancialMovementsRepository().listByAccountingPeriod(period),
        createFinancialMovementsRepository().listThroughAccountingPeriod(period),
        createCashClosuresRepository().listByPeriod(operatingPeriod),
        createCashClosuresRepository().listOpen(),
        listCollectedPendingHandicapCharges(),
        createEmployeesRepository().listAlphabetical(100),
        createMembersRepository().listDirectory(),
        createPaymentMethodsRepository().listActiveWithCommissions(),
        createFinancialConfigsRepository().getActive(),
        createFinancialIncomeCategoriesRepository().listActiveSorted().catch(() => getFallbackIncomeCategories()),
        createFinancialExpenseCategoriesRepository().listActiveSorted().catch(() => getFallbackExpenseCategories()),
      ]);
      setMovements(nextMovements);
      setBalanceMovements(nextBalanceMovements);
      setClosures(nextClosures);
      setOpenClosures(nextOpenClosures);
      setPendingHandicapCharges(nextPendingHandicapCharges);
      setEmployees(nextEmployees);
      setMembers(nextMembers);
      setPaymentMethods(nextPaymentMethods.filter(isVisiblePaymentMethod));
      setActiveConfig(nextActiveConfig);
      setIncomeCategories(nextIncomeCategories.length ? nextIncomeCategories : getFallbackIncomeCategories());
      setExpenseCategories(includeRequiredExpenseCategories(
        nextExpenseCategories.length ? nextExpenseCategories : getFallbackExpenseCategories(),
      ));
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar la caja.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [period]);

  useEffect(() => {
    if (paymentMethods.some((method) => method.id === aagPaymentMethodId)) {
      return;
    }
    setAagPaymentMethodId(
      getPrimaryAccountMethod(paymentMethods, 'macro')?.id
      ?? paymentMethods.find((method) => method.id === ACCOUNTING_PAYMENT_METHOD_IDS.cash)?.id
      ?? paymentMethods[0]?.id
      ?? '',
    );
  }, [aagPaymentMethodId, paymentMethods]);

  useEffect(() => {
    const periodFromUrl = searchParams.get('period');
    if (!periodFromUrl) {
      return;
    }
    const normalizedPeriodFromUrl = normalizeAccountingPeriod(periodFromUrl);
    if (normalizedPeriodFromUrl > currentAccountingPeriod) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('period', currentAccountingPeriod);
      nextParams.delete('modal');
      setPeriod(currentAccountingPeriod);
      setOperationModal(null);
      setSearchParams(nextParams);
    }
  }, [currentAccountingPeriod, searchParams, setSearchParams]);

  useEffect(() => {
    const modalFromParam = getOperationModalFromParam(searchParams.get('modal'));
    if (modalFromParam) {
      setOperationModal(modalFromParam);
    }
  }, [searchParams]);

  const setTab = (tab: CashTab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    nextParams.set('period', period);
    nextParams.delete('modal');
    setSearchParams(nextParams);
  };

  const changePeriod = (nextPeriod: string) => {
    const clampedPeriod = normalizeAccountingPeriod(nextPeriod) > currentAccountingPeriod
      ? currentAccountingPeriod
      : normalizeAccountingPeriod(nextPeriod);
    setPeriod(clampedPeriod);
    setOperationModal(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('period', clampedPeriod);
    nextParams.delete('modal');
    setSearchParams(nextParams);
  };

  const openOperationModal = (modal: Exclude<CashOperationModal, null>) => {
    setOperationModal(modal);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('modal', modal);
    nextParams.set('period', period);
    setSearchParams(nextParams);
  };

  const closeOperationModal = () => {
    setOperationModal(null);
    if (searchParams.has('modal')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('modal');
      setSearchParams(nextParams);
    }
  };

  const openMovementDetails = (movement: EntityWithId<FinancialMovementDocument>) => {
    setMovementDetailAction('details');
    setSelectedMovement(movement);
  };

  const openPartialPaymentForm = (movement: EntityWithId<FinancialMovementDocument>) => {
    setMovementDetailAction('register-partial-payment');
    setSelectedMovement(movement);
  };
  const goToOpenCash = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', 'caja');
    nextParams.set('period', currentAccountingPeriod);
    nextParams.delete('modal');
    setPeriod(currentAccountingPeriod);
    setOperationModal(null);
    setSearchParams(nextParams);
  };

  const todayKey = todayInputValue();
  const todayOpenClosure = closures.find((closure) => getClosureDayKey(closure) === todayKey && closure.status === 'open') ?? null;
  const todayClosedClosure = closures.find((closure) => getClosureDayKey(closure) === todayKey && closure.status === 'closed') ?? null;
  const previousOpenClosure = getOpenClosureBefore(openClosures, todayKey);
  const todayIncomeMovements = movements.filter(
    (movement) => movement.movementType === 'income'
      && movement.originType !== 'internal_transfer'
      && movement.status !== 'voided'
      && getMovementDayKey(movement) === todayKey,
  );
  const todayIncomeTotalMinor = todayIncomeMovements
    .filter((movement) => !isMovementExcludedFromBalance(movement))
    .reduce((total, movement) => total + getMovementListAmountMinor(movement), 0);
  const todayExpenseMovements = movements.filter(
    (movement) => movement.movementType === 'expense'
      && movement.originType !== 'internal_transfer'
      && movement.status !== 'voided'
      && getMovementDayKey(movement) === todayKey,
  );
  const todayExpenseTotalMinor = todayExpenseMovements
    .filter((movement) => !isMovementExcludedFromBalance(movement))
    .reduce((total, movement) => total + movement.netAmountMinor, 0);
  const pendingAagCharges = pendingHandicapCharges.filter((charge) =>
    normalizeAssociationName(charge.associationName) === 'aag' && !charge.expenseMovementId,
  );
  const pendingAagTotalMinor = pendingAagCharges.reduce((total, charge) => total + charge.transferAmountMinor, 0);
  const canOperateCash = isCurrentPeriod && Boolean(todayOpenClosure) && !previousOpenClosure;
  const cashClosedToday = Boolean(todayClosedClosure);
  const cashGateTitle = previousOpenClosure ? 'Cerrar caja anterior' : 'Abrir caja diaria';
  const cashGateMessage = previousOpenClosure
    ? `Hay una caja anterior abierta (${formatDayKeyDisplay(getClosureDayKey(previousOpenClosure))}). Cerrala antes de abrir la jornada de hoy o cargar movimientos nuevos.`
    : cashClosedToday
      ? 'La caja de hoy ya fue cerrada. Para generar movimientos nuevos hace falta una jornada abierta.'
      : 'Abrir la caja diaria habilita cobros, egresos y aprobaciones que generan movimientos.';
  const serverExpenseAlertMessage = getServerExpenseAlertMessage(
    period,
    movements,
    activeConfig?.serverMonthlyExpenseMinor,
    activeConfig?.serverMonthlyExpenseDueDay,
  );

  const transferPendingAag = async () => {
    if (!canOperateCash) {
      openOperationModal('expense');
      return;
    }
    if (pendingAagCharges.length === 0) {
      setNotice({ kind: 'info', message: 'No hay cobros AAG pendientes de transferir.' });
      return;
    }
    const paymentMethod = paymentMethods.find((method) => method.id === aagPaymentMethodId) ?? null;
    if (!paymentMethod) {
      setNotice({ kind: 'error', message: 'Selecciona una cuenta de origen activa para registrar el egreso a AAG.' });
      return;
    }

    setTransferringAag(true);
    try {
      const result = await withTimeout(
        accountingCallables.transferPendingHandicapToAssociation({
          associationName: 'AAG',
          paymentMethodId: paymentMethod.id,
          operationDate: buildArgentinaDateIso(todayInputValue()),
          notes: `Pago acumulado AAG por ${pendingAagCharges.length} cobros de handicap.`,
        }),
        CASH_OPERATION_TIMEOUT_MS,
        'El pago AAG no respondio a tiempo. Revisalo en movimientos antes de volver a generarlo.',
      );
      setNotice({ kind: 'success', message: `Egreso AAG registrado por ${formatCurrency(result.amountMinor)}.` });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos registrar el egreso AAG.' });
    } finally {
      setTransferringAag(false);
    }
  };

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <h1>Datos de caja</h1>
        </div>
        <div className="accounting-hero__controls">
          <AccountingMonthPicker period={period} onChange={changePeriod} />
        </div>
      </section>

      <AccountingInlineNotice notice={notice} />
      <AccountingInlineNotice notice={serverExpenseAlertMessage ? { kind: 'error', message: serverExpenseAlertMessage } : null} />
      {isHistoricalPeriod && (
        <AccountingInlineNotice notice={{ kind: 'info', message: `Periodo historico ${formatPeriod(period)}: solo disponible para revision. Los cobros, egresos, apertura y cierre se registran unicamente en el mes actual.` }} />
      )}

      {!isHistoricalPeriod && !canOperateCash && activeTab !== 'caja' && (
        <section className="floating-card accounting-panel accounting-cash-gate">
          <div className="accounting-section-header accounting-section-header--plain">
            <div>
              <p className="eyebrow">Jornada</p>
              <h2>{cashGateTitle}</h2>
            </div>
            <UiActionButton type="button" onClick={goToOpenCash}>{previousOpenClosure ? 'Cerrar caja anterior' : 'Abrir caja'}</UiActionButton>
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
        <AccountingMovementsPanel
          movements={movements}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          paymentMethods={paymentMethods}
          period={period}
          loading={loading}
          onSelectMovement={openMovementDetails}
          onRegisterPartialPayment={openPartialPaymentForm}
          onMovementChanged={load}
        />
      )}

      {activeTab === 'balances' && (
        <AccountingCashBalancesPanel
          movements={movements}
          balanceMovements={balanceMovements}
          paymentMethods={paymentMethods}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          period={period}
          loading={loading}
          onPeriodChange={changePeriod}
          onOpenTransfer={() => openOperationModal('transfer')}
          onSelectMovement={openMovementDetails}
          onMovementChanged={load}
          canCreateTransfer={isCurrentPeriod}
        />
      )}

      {activeTab === 'cobros' && (
        <section className="floating-card accounting-panel accounting-centered-panel">
          <div className="accounting-section-header accounting-section-header--plain">
            <div>
              <h2>Cobros</h2>
              <p>{todayIncomeMovements.length} cobros registrados - total {formatCurrency(todayIncomeTotalMinor)}</p>
            </div>
            <div className="accounting-header-actions">
              <UiActionButton type="button" onClick={() => openOperationModal('income-priority')}>
                Green Fee y cuotas societarias
              </UiActionButton>
              <UiActionButton type="button" variant="secondary" onClick={() => openOperationModal('income-other')}>
                Otros cobros
              </UiActionButton>
            </div>
          </div>
          <div className="accounting-table-wrap">
            <table className="accounting-data-table">
              <thead><tr><th>Hora</th><th>Categoria</th><th>Medio</th><th>Referencia</th><th>Estado</th><th>Monto</th><th>Acciones</th></tr></thead>
              <tbody>
                {todayIncomeMovements.map((movement) => (
                  <tr key={movement.id} className={getMovementBalanceRowClassName(movement)}>
                    <td>{formatTimestamp(movement.operationDate)}</td>
                    <td>{getCategoryLabel(movement.categoryId)}</td>
                    <td>{getPaymentMethodDisplayName(movement.paymentMethodCodeSnapshot)}</td>
                    <td>{getMovementReferenceLabel(movement)}</td>
                    <td><span className={`status-chip status-chip--${movement.status}`}>{getMovementStatusLabel(movement.status)}</span></td>
                    <td><strong>{formatCurrency(getMovementListAmountMinor(movement))}</strong><InstallmentProgress movement={movement} compact /></td>
                    <td>
                      <div className="accounting-movement-row-actions">
                        <button type="button" className="btn-secondary" onClick={() => setSelectedMovement(movement)}>Ver detalles</button>
                        <AccountingMovementActions
                          movement={movement}
                          incomeCategories={incomeCategories}
                          expenseCategories={expenseCategories}
                          paymentMethods={paymentMethods}
                          onChanged={load}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && todayIncomeMovements.length === 0 && (
                  <tr><td colSpan={7}>Sin cobros registrados hoy.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'egresos' && (
        <section className="floating-card accounting-panel accounting-centered-panel">
          <div className="accounting-section-header accounting-section-header--plain">
            <div>
              <p className="eyebrow">Pagos</p>
              <h2>Egresos</h2>
              <p>{todayExpenseMovements.length} egresos registrados - total {formatCurrency(todayExpenseTotalMinor)}</p>
            </div>
            <div className="accounting-header-actions">
              <UiActionButton type="button" variant="danger" onClick={() => openOperationModal('expense')}>
                Registrar egreso
              </UiActionButton>
            </div>
          </div>
          <section className="accounting-aag-pending-card">
            <div>
              <span className="eyebrow">AAG</span>
              <h3>Pago pendiente a AAG</h3>
              <p>{pendingAagCharges.length} cobros de handicap acumulados para transferir.</p>
            </div>
            <div className="accounting-aag-pending-card__amount">
              <small>Total pendiente</small>
              <strong>{formatCurrency(pendingAagTotalMinor)}</strong>
              <label className="form-field accounting-aag-payment-method">
                <span>Cuenta de origen</span>
                <select value={aagPaymentMethodId} onChange={(event) => setAagPaymentMethodId(event.target.value)}>
                  {paymentMethods.length === 0 && <option value="">Sin medios activos</option>}
                  {paymentMethods.map((method) => <option key={method.id} value={method.id}>{getPaymentMethodDisplayName(method)}</option>)}
                </select>
              </label>
              <UiActionButton
                type="button"
                variant="secondary"
                disabled={transferringAag || pendingAagCharges.length === 0 || !aagPaymentMethodId}
                onClick={transferPendingAag}
              >
                {transferringAag ? 'Generando...' : 'Generar egreso AAG'}
              </UiActionButton>
            </div>
          </section>
          <div className="accounting-table-wrap">
            <table className="accounting-data-table">
              <thead><tr><th>Hora</th><th>Categoria</th><th>Medio</th><th>Referencia</th><th>Estado</th><th>Monto</th><th>Acciones</th></tr></thead>
              <tbody>
                {todayExpenseMovements.map((movement) => (
                  <tr key={movement.id} className={getMovementBalanceRowClassName(movement)}>
                    <td>{formatTimestamp(movement.operationDate)}</td>
                    <td>{getCategoryLabel(movement.categoryId)}</td>
                    <td>{getPaymentMethodDisplayName(movement.paymentMethodCodeSnapshot)}</td>
                    <td>{getMovementReferenceLabel(movement)}</td>
                    <td><span className={`status-chip status-chip--${movement.status}`}>{getMovementStatusLabel(movement.status)}</span></td>
                    <td><strong>{formatCurrency(getMovementListAmountMinor(movement))}</strong><InstallmentProgress movement={movement} compact /></td>
                    <td>
                      <div className="accounting-movement-row-actions">
                        <button type="button" className="btn-secondary" onClick={() => setSelectedMovement(movement)}>Ver detalles</button>
                        <AccountingMovementActions
                          movement={movement}
                          incomeCategories={incomeCategories}
                          expenseCategories={expenseCategories}
                          paymentMethods={paymentMethods}
                          onChanged={load}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && todayExpenseMovements.length === 0 && (
                  <tr><td colSpan={7}>Sin egresos registrados hoy.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'caja' && (
        isHistoricalPeriod ? (
          <section className="floating-card accounting-panel accounting-centered-panel">
            <div className="accounting-section-header accounting-section-header--plain">
              <div>
                <p className="eyebrow">Jornada</p>
                <h2>Caja historica</h2>
              </div>
            </div>
            <p>Este periodo esta cerrado para operaciones. Usa Movimientos o Balances para revisarlo.</p>
          </section>
        ) : (
          <AccountingCashClosuresPage onChanged={load} />
        )
      )}

      {operationModal && !canOperateCash && (
        <AccountingOperationModal title={previousOpenClosure ? 'Cerrar caja anterior' : 'Abrir caja'} meta={`Jornada: ${formatTodayDisplay()}`} onClose={closeOperationModal}>
          <section className="floating-card accounting-panel accounting-cash-required-modal">
            <p>
              {previousOpenClosure
                ? `Hay una caja anterior abierta (${formatDayKeyDisplay(getClosureDayKey(previousOpenClosure))}). Cerrala antes de registrar movimientos con fecha nueva.`
                : 'Para registrar cobros o egresos primero es necesario abrir la caja de hoy.'}
            </p>
            <div className="form-actions form-actions--right">
              <UiActionButton type="button" variant="secondary" onClick={closeOperationModal}>
                Cancelar
              </UiActionButton>
              <UiActionButton type="button" onClick={goToOpenCash}>
                {previousOpenClosure ? 'Cerrar caja anterior' : 'Abrir caja'}
              </UiActionButton>
            </div>
          </section>
        </AccountingOperationModal>
      )}

      {canOperateCash && operationModal === 'income-priority' && (
        <AccountingOperationModal title="Green Fee y cuotas societarias" meta={`Fecha de emision del cobro: ${formatTodayDisplay()}`} onClose={closeOperationModal}>
          <ManualIncomeForm
            incomeCategories={incomeCategories}
            paymentMethods={paymentMethods.filter(isVisiblePaymentMethod)}
            members={members}
            activeConfig={activeConfig}
            showHeader={false}
            categoryFilterIds={[ACCOUNTING_INCOME_CATEGORY_IDS.greenFee, ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria]}
            onNotice={setNotice}
            onRegistered={async () => {
              closeOperationModal();
              await load();
            }}
            showMemberDebtAction={false}
          />
        </AccountingOperationModal>
      )}

      {canOperateCash && operationModal === 'income-other' && (
        <AccountingOperationModal title="Otros cobros" meta={`Fecha de emision del cobro: ${formatTodayDisplay()}`} onClose={closeOperationModal}>
          <ManualIncomeForm
            incomeCategories={incomeCategories}
            paymentMethods={paymentMethods.filter(isVisiblePaymentMethod)}
            members={members}
            activeConfig={activeConfig}
            showHeader={false}
            excludeCategoryIds={[ACCOUNTING_INCOME_CATEGORY_IDS.greenFee, ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria]}
            showPeriodControls
            onNotice={setNotice}
            onRegistered={async () => {
              closeOperationModal();
              await load();
            }}
            showMemberDebtAction={false}
          />
        </AccountingOperationModal>
      )}

      {canOperateCash && operationModal === 'expense' && (
        <AccountingOperationModal title="Registrar egreso" meta={`Fecha del comprobante: ${formatTodayDisplay()}`} onClose={closeOperationModal}>
          <ExpenseQuickForm
            employees={employees}
            expenseCategories={expenseCategories}
            paymentMethods={paymentMethods}
            onNotice={setNotice}
            onSaved={async () => {
              closeOperationModal();
              await load();
            }}
          />
        </AccountingOperationModal>
      )}

      {canOperateCash && operationModal === 'transfer' && (
        <AccountingOperationModal title="Mover plata entre cuentas" meta={`Fecha del movimiento: ${formatTodayDisplay()}`} onClose={closeOperationModal}>
          <TransferFundsForm
            paymentMethods={paymentMethods}
            onNotice={setNotice}
            onSaved={async () => {
              closeOperationModal();
              await load();
            }}
          />
        </AccountingOperationModal>
      )}

      {selectedMovement && (
        <AccountingMovementDetailModal
          movement={selectedMovement}
          members={members}
          employees={employees}
          paymentMethods={paymentMethods}
          initialAction={movementDetailAction}
          onSelectMovement={openMovementDetails}
          onChanged={load}
          onClose={() => {
            setSelectedMovement(null);
            setMovementDetailAction('details');
          }}
        />
      )}
    </div>
  );
}
