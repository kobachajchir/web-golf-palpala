import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import {
  ACCOUNTING_EXPENSE_CATEGORY_IDS,
  ACCOUNTING_INCOME_CATEGORY_IDS,
  ACCOUNTING_PAYMENT_METHOD_IDS,
  ACCOUNTING_REFERENCE_TYPES,
} from '../modules/accounting/domain/constants';
import type {
  AccountingPeriod,
  EntityWithId,
  ExpenseSubmissionDocument,
  ExternalAccountingReferenceDocument,
  FinancialConfigDocument,
  FinancialMovementDocument,
  MacroDebitSettlementDocument,
  MemberFeeChargeDocument,
  PaymentMethodDocument,
  SalaryPeriodicity,
  SalaryPaymentDocument,
} from '../modules/accounting/domain/models';
import { createAccountingCallables } from '../modules/accounting/functions/accounting.callables';
import {
  createExpenseSubmissionsRepository,
  createExternalAccountingReferencesRepository,
  createFinancialConfigsRepository,
  createFinancialMovementsRepository,
  createMacroDebitSettlementsRepository,
  createMemberFeeChargesRepository,
  createPaymentMethodsRepository,
  createSalaryPaymentsRepository,
} from '../modules/accounting/infrastructure/firestore/repositories';
import type { EmployeeDocument, MemberDocument } from '../modules/users/domain/models';
import {
  createEmployeesRepository,
  createMembersRepository,
} from '../modules/users/infrastructure/firestore/repositories';

type NoticeState =
  | {
      kind: 'success' | 'error';
      message: string;
    }
  | null;

type DashboardSnapshot = {
  activeConfig: EntityWithId<FinancialConfigDocument> | null;
  paymentMethods: Array<EntityWithId<PaymentMethodDocument>>;
  recentMovements: Array<EntityWithId<FinancialMovementDocument>>;
  periodMovements: Array<EntityWithId<FinancialMovementDocument>>;
  recentBankedMovements: Array<EntityWithId<FinancialMovementDocument>>;
  recentDebitMacroMovements: Array<EntityWithId<FinancialMovementDocument>>;
  recentSettlements: Array<EntityWithId<MacroDebitSettlementDocument>>;
  monthSettlements: Array<EntityWithId<MacroDebitSettlementDocument>>;
  recentExpenses: Array<EntityWithId<ExpenseSubmissionDocument>>;
  periodFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
  periodReferences: Array<EntityWithId<ExternalAccountingReferenceDocument>>;
  recentSalaryPayments: Array<EntityWithId<SalaryPaymentDocument>>;
  membersPreview: Array<EntityWithId<MemberDocument>>;
  employeesPreview: Array<EntityWithId<EmployeeDocument>>;
  memberMap: Record<string, EntityWithId<MemberDocument>>;
  employeeMap: Record<string, EntityWithId<EmployeeDocument>>;
  activeMembersCount: number;
  activeEmployeesCount: number;
  pendingExpenseCount: number;
  pendingFeeCount: number;
};

type GenerateFeeFormState = {
  memberId: string;
  period: string;
  notes: string;
};

type FeePaymentFormState = {
  memberFeeChargeId: string;
  paymentMethodId: string;
  paymentReference: string;
  notes: string;
};

type ExternalReferenceFormState = {
  referenceType: (typeof ACCOUNTING_REFERENCE_TYPES)[number];
  period: string;
  amountMinor: string;
  providerName: string;
  referenceNumber: string;
  notes: string;
};

type VoidMovementFormState = {
  movementId: string;
  reason: string;
};

type SubmitExpenseFormState = {
  employeeId: string;
  categoryId: string;
  description: string;
  expenseDate: string;
  amountMinor: string;
  vendorName: string;
  paymentMethodId: string;
  notes: string;
};

type ManualIncomeFormState = {
  operationDate: string;
  categoryId: string;
  concept: string;
  amount: string;
  paymentMethodId: string;
  paymentReference: string;
  notes: string;
};

type MembershipPricingFormState = {
  fullMemberFee: string;
  familyAssociateDiscountPct: string;
  lifetimeDiscountPct: string;
  minorDiscountPct: string;
  licenseDiscountPct: string;
  notes: string;
};

type SalaryConfigFormState = {
  employeeId: string;
  contractType: string;
  baseAmount: string;
  periodicity: SalaryPeriodicity;
  effectiveFrom: string;
  allowOvertime: boolean;
  notes: string;
};

type AccountingSection = 'inicio' | 'movimientos' | 'tesoreria' | 'cuotas' | 'sensibles' | 'empleados' | 'reportes';
type EntryModalType = 'income' | 'expense' | null;
type SensitivePanel = 'reference' | 'salary' | 'void';

type SensitivePanelState = Record<SensitivePanel, boolean>;

const INITIAL_SENSITIVE_PANELS: SensitivePanelState = {
  reference: false,
  salary: false,
  void: false,
};

const accountingCallables = createAccountingCallables();
const INCOME_CATEGORY_OPTIONS = [
  { value: ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria, label: 'Cuota societaria' },
  { value: ACCOUNTING_INCOME_CATEGORY_IDS.greenFee, label: 'Green fee' },
  { value: ACCOUNTING_INCOME_CATEGORY_IDS.tournamentRegistration, label: 'Inscripcion torneo' },
  { value: ACCOUNTING_INCOME_CATEGORY_IDS.rentalHall, label: 'Alquiler salon' },
  { value: ACCOUNTING_INCOME_CATEGORY_IDS.rentalGreenSpace, label: 'Alquiler espacio verde' },
  { value: ACCOUNTING_INCOME_CATEGORY_IDS.concessionMonthly, label: 'Concesion mensual' },
  { value: ACCOUNTING_INCOME_CATEGORY_IDS.advertisingBoard, label: 'Publicidad carteleria' },
] as const;
const EXPENSE_CATEGORY_OPTIONS = [
  { value: ACCOUNTING_EXPENSE_CATEGORY_IDS.proveedores, label: 'Factura proveedor' },
  { value: ACCOUNTING_EXPENSE_CATEGORY_IDS.insumos, label: 'Compra de insumos' },
  { value: ACCOUNTING_EXPENSE_CATEGORY_IDS.insumosAgropecuarios, label: 'Insumos agropecuarios' },
  { value: ACCOUNTING_EXPENSE_CATEGORY_IDS.combustible, label: 'Combustible' },
  { value: ACCOUNTING_EXPENSE_CATEGORY_IDS.mantenimiento, label: 'Mantenimiento' },
  { value: ACCOUNTING_EXPENSE_CATEGORY_IDS.limpieza, label: 'Limpieza' },
  { value: ACCOUNTING_EXPENSE_CATEGORY_IDS.luz, label: 'Luz' },
  { value: ACCOUNTING_EXPENSE_CATEGORY_IDS.agua, label: 'Agua' },
  { value: ACCOUNTING_EXPENSE_CATEGORY_IDS.bancarios, label: 'Gastos bancarios' },
] as const;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  [ACCOUNTING_PAYMENT_METHOD_IDS.cash]: 'Efectivo',
  [ACCOUNTING_PAYMENT_METHOD_IDS.credit]: 'Crédito',
  [ACCOUNTING_PAYMENT_METHOD_IDS.transfer]: 'Transferencia',
  [ACCOUNTING_PAYMENT_METHOD_IDS.debit]: 'Débito',
  [ACCOUNTING_PAYMENT_METHOD_IDS.debitMacro]: 'Débito Macro',
};

const FALLBACK_PAYMENT_METHODS = [
  { id: ACCOUNTING_PAYMENT_METHOD_IDS.cash, name: 'Efectivo', bancarizado: false, active: true, sortOrder: 10 },
  { id: ACCOUNTING_PAYMENT_METHOD_IDS.transfer, name: 'Transferencia', bancarizado: true, active: true, sortOrder: 20 },
  { id: ACCOUNTING_PAYMENT_METHOD_IDS.debit, name: 'Debito', bancarizado: true, active: true, sortOrder: 30 },
  {
    id: ACCOUNTING_PAYMENT_METHOD_IDS.debitMacro,
    name: 'Debito Macro',
    bancarizado: true,
    active: true,
    sortOrder: 40,
    specialReportingType: 'macro_debit',
  },
  { id: ACCOUNTING_PAYMENT_METHOD_IDS.credit, name: 'Credito', bancarizado: true, active: true, sortOrder: 50 },
] as Array<EntityWithId<PaymentMethodDocument>>;

function getCurrentAccountingPeriod(date = new Date()): AccountingPeriod {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}` as AccountingPeriod;
}

function normalizeAccountingPeriod(value: string): AccountingPeriod {
  return value ? (value as AccountingPeriod) : getCurrentAccountingPeriod();
}

function formatCurrency(amountMinor: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function parseAmountInputToMinor(value: string): number {
  const normalizedValue = value.trim().replace(/\./g, '').replace(',', '.');
  const amount = Number(normalizedValue);
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

function formatAmountInputFromMinor(amountMinor: number | null | undefined): string {
  if (typeof amountMinor !== 'number') {
    return '';
  }

  const amount = amountMinor / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',');
}

function parsePercentInputToBps(value: string): number {
  const normalizedValue = value.trim().replace(',', '.');
  const percent = Number(normalizedValue);
  return Number.isFinite(percent) ? Math.round(percent * 100) : Number.NaN;
}

function formatPercentInputFromBps(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace('.', ',');
}

function appliedBpsToDiscountInput(appliedBps: number | null | undefined): string {
  return formatPercentInputFromBps(10000 - (appliedBps ?? 10000));
}

function discountInputToAppliedBps(value: string): number {
  const discountBps = parsePercentInputToBps(value);
  return Number.isFinite(discountBps) ? 10000 - discountBps : Number.NaN;
}

function createMembershipPricingFormFromConfig(config: EntityWithId<FinancialConfigDocument>): MembershipPricingFormState {
  return {
    fullMemberFee: formatAmountInputFromMinor(config.fullMemberFeeMinor),
    familyAssociateDiscountPct: appliedBpsToDiscountInput(config.familyAssociatePctBps),
    lifetimeDiscountPct: appliedBpsToDiscountInput(config.lifetimePctBps),
    minorDiscountPct: appliedBpsToDiscountInput(config.minorPctBps),
    licenseDiscountPct: appliedBpsToDiscountInput(config.licensePctBps),
    notes: config.notes ?? '',
  };
}

function formatTimestamp(
  value: { toDate: () => Date } | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  },
): string {
  if (!value) {
    return 'Sin fecha';
  }

  const date = value instanceof Date ? value : value.toDate();
  return new Intl.DateTimeFormat('es-AR', options).format(date);
}

function formatPeriod(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) {
    return period;
  }

  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(Number(year), Number(month) - 1, 1));
}

function getMovementLabel(movement: EntityWithId<FinancialMovementDocument>): string {
  return movement.categoryCodeSnapshot
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getPaymentMethodLabel(
  methodId: string | null | undefined,
  paymentMethods: Array<EntityWithId<PaymentMethodDocument>>,
): string {
  const paymentMethod = paymentMethods.find((entry) => entry.id === methodId);
  return PAYMENT_METHOD_LABELS[methodId ?? ''] ?? paymentMethod?.name ?? methodId ?? 'Sin medio';
}

function getPaymentMethodOptionLabel(paymentMethod: EntityWithId<PaymentMethodDocument>): string {
  return PAYMENT_METHOD_LABELS[paymentMethod.id] ?? paymentMethod.name;
}

function requiresPaymentReference(paymentMethodId: string): boolean {
  return paymentMethodId !== ACCOUNTING_PAYMENT_METHOD_IDS.cash;
}

function getMovementPaymentReference(movement: EntityWithId<FinancialMovementDocument>): string | null {
  const value = movement.metadata?.paymentReference;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="accounting-chevron__icon">
      <path d="M7.3 8.7a1 1 0 0 1 1.4 0l3.3 3.29 3.3-3.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.42Z" />
    </svg>
  );
}

function AccountingCollapsibleCard({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <article className={`accounting-collapsible-card ${open ? 'accounting-collapsible-card--open' : ''}`}>
      <button type="button" className="accounting-collapsible-card__header" onClick={onToggle}>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <span className="accounting-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {open && <div className="accounting-collapsible-card__body">{children}</div>}
    </article>
  );
}

function getMemberDisplayName(member: EntityWithId<MemberDocument> | null | undefined): string {
  if (!member) {
    return 'Socio no disponible';
  }

  return `${member.lastName}, ${member.firstName}`;
}

function getEmployeeDisplayName(employee: EntityWithId<EmployeeDocument> | null | undefined): string {
  if (!employee) {
    return 'Empleado no disponible';
  }

  return `${employee.lastName}, ${employee.firstName}`;
}

function SummaryCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function StatBar({
  label,
  amountMinor,
  percentage,
  helper,
}: {
  label: string;
  amountMinor: number;
  percentage: number;
  helper: string;
}) {
  return (
    <article className="accounting-stat-bar">
      <div className="accounting-stat-bar__header">
        <strong>{label}</strong>
        <span>{formatCurrency(amountMinor)}</span>
      </div>
      <div className="accounting-stat-bar__track" aria-hidden="true">
        <span className="accounting-stat-bar__fill" style={{ width: `${Math.max(percentage, 8)}%` }} />
      </div>
      <small>{helper}</small>
    </article>
  );
}

type DashboardRole = 'administrativo' | 'directivo';

function getDashboardRole(roleIds: readonly string[] | undefined, interfaceMode: string): DashboardRole | null {
  const roles = new Set(roleIds ?? []);

  if (interfaceMode === ROLES.DIRECTIVO && roles.has(ROLES.DIRECTIVO)) {
    return 'directivo';
  }

  if (interfaceMode === ROLES.ADMINISTRATIVO && roles.has(ROLES.ADMINISTRATIVO)) {
    return 'administrativo';
  }

  if (roles.has(ROLES.DIRECTIVO)) {
    return 'directivo';
  }

  if (roles.has(ROLES.ADMINISTRATIVO)) {
    return 'administrativo';
  }

  return null;
}

async function loadRelatedProfiles(params: {
  membersPreview: Array<EntityWithId<MemberDocument>>;
  employeesPreview: Array<EntityWithId<EmployeeDocument>>;
  periodFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
  recentMovements: Array<EntityWithId<FinancialMovementDocument>>;
  periodMovements: Array<EntityWithId<FinancialMovementDocument>>;
  recentExpenses: Array<EntityWithId<ExpenseSubmissionDocument>>;
  recentSalaryPayments: Array<EntityWithId<SalaryPaymentDocument>>;
}) {
  const membersRepository = createMembersRepository();
  const employeesRepository = createEmployeesRepository();
  const memberMap: Record<string, EntityWithId<MemberDocument>> = {};
  const employeeMap: Record<string, EntityWithId<EmployeeDocument>> = {};

  for (const member of params.membersPreview) {
    memberMap[member.id] = member;
  }

  for (const employee of params.employeesPreview) {
    employeeMap[employee.id] = employee;
  }

  const memberIds = new Set<string>();
  const employeeIds = new Set<string>();

  params.periodFeeCharges.forEach((charge) => {
    if (charge.memberId) {
      memberIds.add(charge.memberId);
    }
    if (charge.holderMemberId) {
      memberIds.add(charge.holderMemberId);
    }
  });

  [...params.recentMovements, ...params.periodMovements].forEach((movement) => {
    if (movement.thirdPartyType === 'member' && movement.thirdPartyId) {
      memberIds.add(movement.thirdPartyId);
    }
    if (movement.thirdPartyType === 'employee' && movement.thirdPartyId) {
      employeeIds.add(movement.thirdPartyId);
    }
  });

  params.recentExpenses.forEach((expense) => {
    employeeIds.add(expense.employeeId);
  });

  params.recentSalaryPayments.forEach((payment) => {
    employeeIds.add(payment.employeeId);
  });

  const missingMemberIds = [...memberIds].filter((memberId) => !memberMap[memberId]);
  const missingEmployeeIds = [...employeeIds].filter((employeeId) => !employeeMap[employeeId]);

  const [loadedMembers, loadedEmployees] = await Promise.all([
    Promise.all(missingMemberIds.map((memberId) => membersRepository.getById(memberId))),
    Promise.all(missingEmployeeIds.map((employeeId) => employeesRepository.getById(employeeId))),
  ]);

  loadedMembers.forEach((member) => {
    if (member) {
      memberMap[member.id] = member;
    }
  });

  loadedEmployees.forEach((employee) => {
    if (employee) {
      employeeMap[employee.id] = employee;
    }
  });

  return { memberMap, employeeMap };
}

export function AccountingDashboard() {
  const { user, interfaceMode } = useAuth();
  const dashboardRole = getDashboardRole(user?.roleIds, interfaceMode);
  const periodNow = getCurrentAccountingPeriod();
  const [selectedPeriod, setSelectedPeriod] = useState(periodNow);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<NoticeState>(null);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<AccountingSection>('inicio');
  const [entryModal, setEntryModal] = useState<EntryModalType>(null);
  const [openSensitivePanels, setOpenSensitivePanels] = useState<SensitivePanelState>(INITIAL_SENSITIVE_PANELS);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>({
    activeConfig: null,
    paymentMethods: [],
    recentMovements: [],
    periodMovements: [],
    recentBankedMovements: [],
    recentDebitMacroMovements: [],
    recentSettlements: [],
    monthSettlements: [],
    recentExpenses: [],
    periodFeeCharges: [],
    periodReferences: [],
    recentSalaryPayments: [],
    membersPreview: [],
    employeesPreview: [],
    memberMap: {},
    employeeMap: {},
    activeMembersCount: 0,
    activeEmployeesCount: 0,
    pendingExpenseCount: 0,
    pendingFeeCount: 0,
  });
  const [generateFeeForm, setGenerateFeeForm] = useState<GenerateFeeFormState>({
    memberId: '',
    period: periodNow,
    notes: '',
  });
  const [feePaymentForm, setFeePaymentForm] = useState<FeePaymentFormState>({
    memberFeeChargeId: '',
    paymentMethodId: ACCOUNTING_PAYMENT_METHOD_IDS.transfer,
    paymentReference: '',
    notes: '',
  });
  const [externalReferenceForm, setExternalReferenceForm] = useState<ExternalReferenceFormState>({
    referenceType: 'F931',
    period: periodNow,
    amountMinor: '',
    providerName: '',
    referenceNumber: '',
    notes: '',
  });
  const [voidMovementForm, setVoidMovementForm] = useState<VoidMovementFormState>({
    movementId: '',
    reason: '',
  });
  const [submitExpenseForm, setSubmitExpenseForm] = useState<SubmitExpenseFormState>({
    employeeId: '',
    categoryId: ACCOUNTING_EXPENSE_CATEGORY_IDS.proveedores,
    description: '',
    expenseDate: new Date().toISOString().slice(0, 10),
    amountMinor: '',
    vendorName: '',
    paymentMethodId: ACCOUNTING_PAYMENT_METHOD_IDS.transfer,
    notes: '',
  });
  const [manualIncomeForm, setManualIncomeForm] = useState<ManualIncomeFormState>({
    operationDate: new Date().toISOString().slice(0, 10),
    categoryId: ACCOUNTING_INCOME_CATEGORY_IDS.greenFee,
    concept: '',
    amount: '',
    paymentMethodId: ACCOUNTING_PAYMENT_METHOD_IDS.transfer,
    paymentReference: '',
    notes: '',
  });
  const [membershipPricingForm, setMembershipPricingForm] = useState<MembershipPricingFormState>({
    fullMemberFee: '',
    familyAssociateDiscountPct: '',
    lifetimeDiscountPct: '',
    minorDiscountPct: '',
    licenseDiscountPct: '',
    notes: '',
  });
  const [salaryConfigForm, setSalaryConfigForm] = useState<SalaryConfigFormState>({
    employeeId: '',
    contractType: 'monthly',
    baseAmount: '',
    periodicity: 'monthly',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    allowOvertime: false,
    notes: '',
  });

  const loadDashboard = useCallback(async () => {
    if (!dashboardRole) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const financialConfigsRepository = createFinancialConfigsRepository();
      const paymentMethodsRepository = createPaymentMethodsRepository();
      const financialMovementsRepository = createFinancialMovementsRepository();
      const macroDebitSettlementsRepository = createMacroDebitSettlementsRepository();
      const expenseSubmissionsRepository = createExpenseSubmissionsRepository();
      const salaryPaymentsRepository = createSalaryPaymentsRepository();
      const externalAccountingReferencesRepository = createExternalAccountingReferencesRepository();
      const memberFeeChargesRepository = createMemberFeeChargesRepository();
      const membersRepository = createMembersRepository();
      const employeesRepository = createEmployeesRepository();

      const [
        activeConfig,
        paymentMethods,
        recentMovements,
        periodMovements,
        recentBankedMovements,
        recentDebitMacroMovements,
        recentSettlements,
        monthSettlements,
        recentExpenses,
        recentSalaryPayments,
        periodReferences,
        periodFeeCharges,
        membersPreview,
        employeesPreview,
        activeMembersCount,
        activeEmployeesCount,
        pendingExpenseCount,
        pendingFeeCount,
      ] = await Promise.all([
        financialConfigsRepository.getActive(),
        paymentMethodsRepository.listActiveSorted(),
        financialMovementsRepository.listRecent(14),
        financialMovementsRepository.listByAccountingPeriod(selectedPeriod),
        financialMovementsRepository.listRecentBanked(10),
        financialMovementsRepository.listRecentDebitMacro(8),
        macroDebitSettlementsRepository.listRecent(6),
        macroDebitSettlementsRepository.listByMonth(selectedPeriod),
        expenseSubmissionsRepository.listRecent(12),
        dashboardRole === 'directivo' ? salaryPaymentsRepository.listByPeriod(selectedPeriod) : Promise.resolve([]),
        externalAccountingReferencesRepository.listByPeriod(selectedPeriod),
        memberFeeChargesRepository.listByPeriod(selectedPeriod),
        membersRepository.listAlphabetical(10),
        employeesRepository.listAlphabetical(10),
        membersRepository.countActive(),
        employeesRepository.countActive(),
        expenseSubmissionsRepository.countByStatus('submitted'),
        memberFeeChargesRepository.countPendingByPeriod(selectedPeriod),
      ]);

      const { memberMap, employeeMap } = await loadRelatedProfiles({
        membersPreview,
        employeesPreview,
        periodFeeCharges,
        recentMovements,
        periodMovements,
        recentExpenses,
        recentSalaryPayments,
      });

      setSnapshot({
        activeConfig,
        paymentMethods,
        recentMovements,
        periodMovements,
        recentBankedMovements,
        recentDebitMacroMovements,
        recentSettlements,
        monthSettlements,
        recentExpenses,
        recentSalaryPayments,
        periodReferences,
        periodFeeCharges,
        membersPreview,
        employeesPreview,
        memberMap,
        employeeMap,
        activeMembersCount,
        activeEmployeesCount,
        pendingExpenseCount,
        pendingFeeCount,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar el tablero contable.');
    } finally {
      setLoading(false);
    }
  }, [dashboardRole, selectedPeriod]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!generateFeeForm.memberId && snapshot.membersPreview[0]) {
      setGenerateFeeForm((current) => ({
        ...current,
        memberId: snapshot.membersPreview[0]?.id ?? '',
      }));
    }

    const pendingCharge = snapshot.periodFeeCharges.find(
      (charge) => charge.status === 'pending' || charge.status === 'overdue',
    );
    if (!feePaymentForm.memberFeeChargeId && pendingCharge) {
      setFeePaymentForm((current) => ({
        ...current,
        memberFeeChargeId: pendingCharge.id,
      }));
    }

    if (!voidMovementForm.movementId && snapshot.recentMovements[0]) {
      setVoidMovementForm((current) => ({
        ...current,
        movementId: snapshot.recentMovements[0]?.id ?? '',
      }));
    }

    if (!submitExpenseForm.employeeId && snapshot.employeesPreview[0]) {
      setSubmitExpenseForm((current) => ({
        ...current,
        employeeId: snapshot.employeesPreview[0]?.id ?? '',
      }));
    }

    if (!salaryConfigForm.employeeId && snapshot.employeesPreview[0]) {
      setSalaryConfigForm((current) => ({
        ...current,
        employeeId: snapshot.employeesPreview[0]?.id ?? '',
      }));
    }
  }, [
    feePaymentForm.memberFeeChargeId,
    generateFeeForm.memberId,
    salaryConfigForm.employeeId,
    submitExpenseForm.employeeId,
    snapshot.employeesPreview,
    snapshot.membersPreview,
    snapshot.periodFeeCharges,
    snapshot.recentMovements,
    voidMovementForm.movementId,
  ]);

  useEffect(() => {
    if (snapshot.activeConfig) {
      setMembershipPricingForm(createMembershipPricingFormFromConfig(snapshot.activeConfig));
    }
  }, [snapshot.activeConfig]);

  const visibleMovements = useMemo(
    () => snapshot.periodMovements.filter((movement) => movement.status !== 'voided'),
    [snapshot.periodMovements],
  );
  const hasDashboardData = Boolean(
    snapshot.activeConfig ||
      snapshot.paymentMethods.length > 0 ||
      snapshot.recentMovements.length > 0 ||
      snapshot.periodMovements.length > 0 ||
      snapshot.membersPreview.length > 0 ||
      snapshot.employeesPreview.length > 0 ||
      snapshot.periodFeeCharges.length > 0,
  );
  const paymentMethodOptions = useMemo(
    () => (snapshot.paymentMethods.length > 0 ? snapshot.paymentMethods : FALLBACK_PAYMENT_METHODS),
    [snapshot.paymentMethods],
  );

  const incomeTotalMinor = useMemo(
    () =>
      visibleMovements
        .filter((movement) => movement.movementType === 'income')
        .reduce((total, movement) => total + movement.netAmountMinor, 0),
    [visibleMovements],
  );

  const expenseTotalMinor = useMemo(
    () =>
      visibleMovements
        .filter((movement) => movement.movementType === 'expense')
        .reduce((total, movement) => total + movement.netAmountMinor, 0),
    [visibleMovements],
  );

  const bankedTotalMinor = useMemo(
    () =>
      visibleMovements
        .filter((movement) => movement.bancarizado)
        .reduce((total, movement) => total + movement.netAmountMinor, 0),
    [visibleMovements],
  );

  const cashTotalMinor = useMemo(
    () =>
      visibleMovements
        .filter((movement) => !movement.bancarizado)
        .reduce((total, movement) => total + movement.netAmountMinor, 0),
    [visibleMovements],
  );

  const creditCommissionTotalMinor = useMemo(
    () =>
      visibleMovements.reduce((total, movement) => total + (movement.appliedCommissionAmountMinor ?? 0), 0),
    [visibleMovements],
  );

  const feePendingAmountMinor = useMemo(
    () =>
      snapshot.periodFeeCharges
        .filter((charge) => charge.status === 'pending' || charge.status === 'overdue')
        .reduce((total, charge) => total + charge.finalAmountMinor, 0),
    [snapshot.periodFeeCharges],
  );

  const salaryTotalMinor = useMemo(
    () =>
      snapshot.recentSalaryPayments.reduce(
        (total, payment) => total + payment.salaryGrossMinor + (payment.overtimeAmountMinor ?? 0),
        0,
      ),
    [snapshot.recentSalaryPayments],
  );

  const macroNetTotalMinor = useMemo(
    () => snapshot.monthSettlements.reduce((total, settlement) => total + settlement.netAmountMinor, 0),
    [snapshot.monthSettlements],
  );

  const selectedFeeCharge = useMemo(
    () => snapshot.periodFeeCharges.find((charge) => charge.id === feePaymentForm.memberFeeChargeId) ?? null,
    [feePaymentForm.memberFeeChargeId, snapshot.periodFeeCharges],
  );

  const paymentMix = useMemo(() => {
    const incomeMovements = visibleMovements.filter((movement) => movement.movementType === 'income');
    const total = incomeMovements.reduce((sum, movement) => sum + movement.netAmountMinor, 0);

    return paymentMethodOptions.map((paymentMethod) => {
      const amountMinor = incomeMovements
        .filter((movement) => movement.paymentMethodCodeSnapshot === paymentMethod.id)
        .reduce((sum, movement) => sum + movement.netAmountMinor, 0);

      return {
        id: paymentMethod.id,
        name: getPaymentMethodOptionLabel(paymentMethod),
        amountMinor,
        percentage: total > 0 ? Math.round((amountMinor / total) * 100) : 0,
      };
    });
  }, [paymentMethodOptions, visibleMovements]);

  const recentExpenseQueue = useMemo(
    () =>
      snapshot.recentExpenses.filter(
        (expense) => expense.status === 'submitted' || expense.status === 'approved',
      ),
    [snapshot.recentExpenses],
  );

  const handlePeriodChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextPeriod = normalizeAccountingPeriod(event.target.value);
    startTransition(() => {
      setSelectedPeriod(nextPeriod);
      setGenerateFeeForm((current) => ({ ...current, period: nextPeriod }));
      setExternalReferenceForm((current) => ({ ...current, period: nextPeriod }));
    });
  };

  const handleSectionChange = (section: AccountingSection) => {
    startTransition(() => {
      if (section === 'inicio') {
        setSelectedPeriod(periodNow);
        setGenerateFeeForm((current) => ({ ...current, period: periodNow }));
        setExternalReferenceForm((current) => ({ ...current, period: periodNow }));
      }

      setActiveSection(section);
    });
  };

  const toggleSensitivePanel = (panel: SensitivePanel) => {
    setOpenSensitivePanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  };

  const refreshAfterAction = async (message: string) => {
    setNotice({ kind: 'success', message });
    await loadDashboard();
  };

  const handleGenerateCuota = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!generateFeeForm.memberId) {
      setNotice({ kind: 'error', message: 'Seleccioná un socio para generar la cuota.' });
      return;
    }

    setSubmittingAction('generate-cuota');
    setNotice(null);

    try {
      const result = await accountingCallables.generateCuota({
        memberId: generateFeeForm.memberId,
        period: generateFeeForm.period as AccountingPeriod,
        notes: generateFeeForm.notes || null,
      });
      await refreshAfterAction(
        result.duplicate
          ? `La cuota ya existía y se reutilizó el cargo ${result.memberFeeChargeId}.`
          : `Se generó la cuota ${result.memberFeeChargeId}.`,
      );
      setGenerateFeeForm((current) => ({ ...current, notes: '' }));
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos generar la cuota.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleRegisterPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFeeCharge) {
      setNotice({ kind: 'error', message: 'Elegí una cuota pendiente para registrar el cobro.' });
      return;
    }

    if (requiresPaymentReference(feePaymentForm.paymentMethodId) && !feePaymentForm.paymentReference.trim()) {
      setNotice({ kind: 'error', message: 'Ingresá una referencia para este medio de pago.' });
      return;
    }

    setSubmittingAction('register-payment');
    setNotice(null);

    try {
      const result = await accountingCallables.registerPayment({
        sourceType: 'member_fee_charge',
        sourceId: selectedFeeCharge.id,
        memberId: selectedFeeCharge.memberId ?? selectedFeeCharge.holderMemberId ?? null,
        categoryId: ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria,
        paymentMethodId: feePaymentForm.paymentMethodId,
        paymentReference: feePaymentForm.paymentReference.trim() || null,
        grossAmountMinor: selectedFeeCharge.finalAmountMinor,
        operationDate: new Date().toISOString(),
        notes: feePaymentForm.notes || null,
        metadata: {
          paymentReference: feePaymentForm.paymentReference.trim() || null,
        },
      });
      await refreshAfterAction(
        result.duplicate
          ? `El pago ya estaba registrado en el movimiento ${result.movementId}.`
          : `Se registró el cobro en el movimiento ${result.movementId}.`,
      );
      setFeePaymentForm((current) => ({ ...current, paymentReference: '', notes: '' }));
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos registrar el pago.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleSubmitIncome = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(manualIncomeForm.amount);

    if (!manualIncomeForm.concept.trim()) {
      setNotice({ kind: 'error', message: 'Agrega un concepto para el ingreso.' });
      return;
    }

    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresa un monto valido en ARS.' });
      return;
    }

    setSubmittingAction('submit-income');
    setNotice(null);

    try {
      await accountingCallables.registerPayment({
        sourceType: 'manual_income',
        sourceId: null,
        categoryId: manualIncomeForm.categoryId,
        paymentMethodId: manualIncomeForm.paymentMethodId,
        paymentReference: manualIncomeForm.paymentReference.trim() || null,
        grossAmountMinor: amountMinor,
        operationDate: new Date(`${manualIncomeForm.operationDate}T00:00:00.000-03:00`).toISOString(),
        notes: manualIncomeForm.notes || null,
        metadata: {
          concept: manualIncomeForm.concept.trim(),
          entryMode: 'manual',
          paymentReference: manualIncomeForm.paymentReference.trim() || null,
        },
      });
      setEntryModal(null);
      await refreshAfterAction('El ingreso quedo cargado como movimiento financiero.');
      setManualIncomeForm((current) => ({
        ...current,
        concept: '',
        amount: '',
        paymentReference: '',
        notes: '',
      }));
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos cargar el ingreso.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleSubmitExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(submitExpenseForm.amountMinor);

    if (!submitExpenseForm.employeeId) {
      setNotice({ kind: 'error', message: 'Selecciona un responsable para cargar el gasto.' });
      return;
    }

    if (!submitExpenseForm.description.trim()) {
      setNotice({ kind: 'error', message: 'Agrega una descripcion clara del gasto.' });
      return;
    }

    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresa un monto valido en ARS.' });
      return;
    }

    setSubmittingAction('submit-expense');
    setNotice(null);

    try {
      await accountingCallables.submitExpense({
        employeeId: submitExpenseForm.employeeId,
        categoryId: submitExpenseForm.categoryId,
        description: submitExpenseForm.notes
          ? `${submitExpenseForm.description.trim()} - ${submitExpenseForm.notes.trim()}`
          : submitExpenseForm.description.trim(),
        expenseDate: new Date(`${submitExpenseForm.expenseDate}T00:00:00.000-03:00`).toISOString(),
        amountMinor,
        vendorName: submitExpenseForm.vendorName || null,
        paymentMethodId: submitExpenseForm.paymentMethodId || null,
      });
      setEntryModal(null);
      await refreshAfterAction('El gasto quedo cargado para revision y posterior impacto contable.');
      setSubmitExpenseForm((current) => ({
        ...current,
        description: '',
        amountMinor: '',
        vendorName: '',
        notes: '',
      }));
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos cargar el gasto.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleUpsertSalaryConfiguration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (dashboardRole !== 'directivo') {
      setNotice({ kind: 'error', message: 'Solo Junta Directiva puede modificar sueldos.' });
      return;
    }

    const baseAmountMinor = parseAmountInputToMinor(salaryConfigForm.baseAmount);

    if (!salaryConfigForm.employeeId) {
      setNotice({ kind: 'error', message: 'Elegí un empleado para modificar el sueldo.' });
      return;
    }

    if (!Number.isFinite(baseAmountMinor) || baseAmountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresá un sueldo base válido en ARS.' });
      return;
    }

    setSubmittingAction('upsert-salary-configuration');
    setNotice(null);

    try {
      const result = await accountingCallables.upsertSalaryConfiguration({
        employeeId: salaryConfigForm.employeeId,
        contractType: salaryConfigForm.periodicity,
        baseAmountMinor,
        periodicity: salaryConfigForm.periodicity,
        effectiveFrom: new Date(`${salaryConfigForm.effectiveFrom}T00:00:00.000-03:00`).toISOString(),
        allowOvertime: salaryConfigForm.allowOvertime,
        notes: salaryConfigForm.notes.trim() || null,
      });
      await refreshAfterAction(`La configuración salarial quedó guardada (${result.salaryConfigurationId}).`);
      setSalaryConfigForm((current) => ({
        ...current,
        baseAmount: '',
        notes: '',
      }));
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos modificar el sueldo.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleUpsertMembershipPricing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!dashboardRole) {
      setNotice({ kind: 'error', message: 'Solo administración o Junta Directiva puede modificar los precios de membresía.' });
      return;
    }

    if (!snapshot.activeConfig) {
      setNotice({ kind: 'error', message: 'No hay una configuración contable activa para actualizar.' });
      return;
    }

    const fullMemberFeeMinor = parseAmountInputToMinor(membershipPricingForm.fullMemberFee);
    const familyAssociatePctBps = discountInputToAppliedBps(membershipPricingForm.familyAssociateDiscountPct);
    const lifetimePctBps = discountInputToAppliedBps(membershipPricingForm.lifetimeDiscountPct);
    const minorPctBps = discountInputToAppliedBps(membershipPricingForm.minorDiscountPct);
    const licensePctBps = discountInputToAppliedBps(membershipPricingForm.licenseDiscountPct);
    const parsedValues = [
      familyAssociatePctBps,
      lifetimePctBps,
      minorPctBps,
      licensePctBps,
    ];

    if (!Number.isFinite(fullMemberFeeMinor) || fullMemberFeeMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresá un precio base válido para el socio pleno.' });
      return;
    }

    if (parsedValues.some((value) => !Number.isFinite(value) || value < 0 || value > 10000)) {
      setNotice({ kind: 'error', message: 'Los descuentos deben estar entre 0% y 100%.' });
      return;
    }

    setSubmittingAction('upsert-membership-pricing');
    setNotice(null);

    try {
      const config = snapshot.activeConfig;
      const result = await accountingCallables.upsertFinancialConfig({
        effectiveFrom: new Date().toISOString(),
        fullMemberFeeMinor,
        familyAssociatePctBps,
        lifetimePctBps,
        minorPctBps,
        licensePctBps,
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
        notes: membershipPricingForm.notes.trim() || 'Actualización de precio base y descuentos por tipo de socio.',
        ...(config.earlyPaymentDiscountPctBps != null
          ? { earlyPaymentDiscountPctBps: config.earlyPaymentDiscountPctBps }
          : {}),
        ...(config.earlyPaymentDiscountDayOfMonth != null
          ? { earlyPaymentDiscountDayOfMonth: config.earlyPaymentDiscountDayOfMonth }
          : {}),
      });
      await refreshAfterAction(`La configuración de cuotas quedó guardada como versión ${result.version}.`);
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos guardar la configuración de cuotas.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleApproveExpense = async (expenseSubmissionId: string) => {
    setSubmittingAction(`approve-${expenseSubmissionId}`);
    setNotice(null);

    try {
      await accountingCallables.reviewExpense({
        expenseSubmissionId,
        decision: 'approved',
      });
      await refreshAfterAction('La rendición quedó aprobada y lista para postear.');
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos aprobar la rendición.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handlePostExpense = async (expenseSubmissionId: string) => {
    setSubmittingAction(`post-${expenseSubmissionId}`);
    setNotice(null);

    try {
      await accountingCallables.postExpenseMovement({
        expenseSubmissionId,
      });
      await refreshAfterAction('El gasto ya impacta en movimientos contables.');
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos postear el gasto.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleRecordExternalReference = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(externalReferenceForm.amountMinor);

    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresá un monto válido en ARS.' });
      return;
    }

    setSubmittingAction('record-reference');
    setNotice(null);

    try {
      await accountingCallables.recordExternalReference({
        referenceType: externalReferenceForm.referenceType,
        period: externalReferenceForm.period as AccountingPeriod,
        amountMinor,
        providerName: externalReferenceForm.providerName || null,
        referenceNumber: externalReferenceForm.referenceNumber || null,
        notes: externalReferenceForm.notes || null,
      });
      await refreshAfterAction('La referencia externa quedó registrada.');
      setExternalReferenceForm((current) => ({
        ...current,
        amountMinor: '',
        providerName: '',
        referenceNumber: '',
        notes: '',
      }));
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos registrar la referencia.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleReconcileSettlement = async (settlementId: string, close = false) => {
    setSubmittingAction(`${close ? 'close' : 'reconcile'}-${settlementId}`);
    setNotice(null);

    try {
      await accountingCallables.reconcileMacroSettlement({
        settlementId,
        close,
      });
      await refreshAfterAction(
        close ? 'La liquidación quedó cerrada.' : 'La liquidación quedó conciliada.',
      );
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos actualizar la liquidación.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleVoidMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!voidMovementForm.movementId || !voidMovementForm.reason.trim()) {
      setNotice({ kind: 'error', message: 'Elegí un movimiento e indicá el motivo de anulación.' });
      return;
    }

    setSubmittingAction('void-movement');
    setNotice(null);

    try {
      await accountingCallables.voidFinancialMovement({
        movementId: voidMovementForm.movementId,
        reason: voidMovementForm.reason.trim(),
      });
      await refreshAfterAction('El movimiento quedó anulado y, si correspondía, se generó el reverso.');
      setVoidMovementForm((current) => ({ ...current, reason: '' }));
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos anular el movimiento.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const membershipPricingFormCard = (
    <form className="accounting-action-card" onSubmit={handleUpsertMembershipPricing}>
      <div>
        <strong>Configurar cuotas de socios</strong>
        <p>
          Editá el precio base del socio pleno y los descuentos por tipo. Se guarda como una nueva versión activa en
          Firebase.
        </p>
        {snapshot.activeConfig && (
          <small className="accounting-helper-copy">
            Versión actual {snapshot.activeConfig.version} · Base {formatCurrency(snapshot.activeConfig.fullMemberFeeMinor)}
          </small>
        )}
      </div>

      <label className="form-field">
        <span>Cuota socio pleno (ARS)</span>
        <input
          inputMode="decimal"
          value={membershipPricingForm.fullMemberFee}
          onChange={(event) =>
            setMembershipPricingForm((current) => ({ ...current, fullMemberFee: event.target.value }))
          }
          placeholder="0,00"
        />
      </label>

      <label className="form-field">
        <span>Descuento grupo familiar asociado (%)</span>
        <input
          inputMode="decimal"
          value={membershipPricingForm.familyAssociateDiscountPct}
          onChange={(event) =>
            setMembershipPricingForm((current) => ({
              ...current,
              familyAssociateDiscountPct: event.target.value,
            }))
          }
          placeholder="0"
        />
      </label>

      <label className="form-field">
        <span>Descuento vitalicio (%)</span>
        <input
          inputMode="decimal"
          value={membershipPricingForm.lifetimeDiscountPct}
          onChange={(event) =>
            setMembershipPricingForm((current) => ({ ...current, lifetimeDiscountPct: event.target.value }))
          }
          placeholder="0"
        />
      </label>

      <label className="form-field">
        <span>Descuento menor (%)</span>
        <input
          inputMode="decimal"
          value={membershipPricingForm.minorDiscountPct}
          onChange={(event) =>
            setMembershipPricingForm((current) => ({ ...current, minorDiscountPct: event.target.value }))
          }
          placeholder="0"
        />
      </label>

      <label className="form-field">
        <span>Descuento licencia (%)</span>
        <input
          inputMode="decimal"
          value={membershipPricingForm.licenseDiscountPct}
          onChange={(event) =>
            setMembershipPricingForm((current) => ({ ...current, licenseDiscountPct: event.target.value }))
          }
          placeholder="0"
        />
      </label>

      <label className="form-field">
        <span>Notas</span>
        <textarea
          value={membershipPricingForm.notes}
          onChange={(event) =>
            setMembershipPricingForm((current) => ({ ...current, notes: event.target.value }))
          }
        />
      </label>

      <button
        type="submit"
        className="btn-primary"
        disabled={!snapshot.activeConfig || submittingAction === 'upsert-membership-pricing'}
      >
        {submittingAction === 'upsert-membership-pricing' ? 'Guardando...' : 'Guardar configuración'}
      </button>
    </form>
  );

  if (!dashboardRole) {
    return <div className="empty-state">Esta sección contable solo está disponible para administración y Junta Directiva.</div>;
  }

  return (
    <div className="page-container accounting-page">
      <div className="accounting-shell">
        {false && <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <p className="eyebrow">{dashboardRole === 'directivo' ? 'Junta Directiva' : 'Administración'}</p>
            <h1>Contabilidad</h1>
            <p>
              {dashboardRole === 'directivo'
                ? `Trabajo operativo del mes actual: ${formatPeriod(periodNow)}.`
                : `Cargá cobros, facturas, cuotas y rendiciones del mes actual: ${formatPeriod(periodNow)}.`}
            </p>
          </div>

          <div className="accounting-hero__controls">
            <div className="accounting-hero__actions">
              <span className="mode-badge">Mes actual {formatPeriod(periodNow)}</span>
              {dashboardRole === 'administrativo' ? (
                <Link className="btn-secondary" to="/admin/members">
                  Ver socios
                </Link>
              ) : (
                <Link className="btn-secondary" to="/home">
                  Volver al inicio
                </Link>
              )}
            </div>
          </div>
        </section>}

        {error && <div className="error-message">{error}</div>}
        {notice && (
          <div className={notice.kind === 'error' ? 'error-message' : 'accounting-success'}>
            {notice.message}
          </div>
        )}
        {loading && !hasDashboardData && (
          <div className="loading-state loading-state--inline accounting-loading-inline">
            <span className="loading-spinner" />
            <strong>Obteniendo datos</strong>
          </div>
        )}

        <section className="floating-card accounting-workbench accounting-workbench--centered">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Contabilidad</p>
              <h2>Carga diaria y accesos contables</h2>
            </div>
            {activeSection !== 'inicio' && (
              <button type="button" className="btn-secondary" onClick={() => handleSectionChange('inicio')}>
                Volver
              </button>
            )}
          </div>

          {true ? (
            <div className="accounting-hub-grid">
              <article className="accounting-hub-card accounting-hub-card--primary">
                <span className="eyebrow">Cargar datos</span>
                <h3>Ingresos y egresos</h3>
                <p>Accesos rápidos para registrar dinero que entra o sale del club.</p>
                <div className="accounting-hub-card__actions">
                  <button type="button" className="btn-primary" onClick={() => setEntryModal('income')}>
                    Cargar ingreso
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setEntryModal('expense')}>
                    Cargar egreso
                  </button>
                </div>
              </article>

              <button type="button" className="accounting-hub-card" onClick={() => handleSectionChange('movimientos')}>
                <span className="eyebrow">Movimientos financieros</span>
                <h3>Ingresos, egresos y medios de pago</h3>
                <p>Caja chica, transferencias, débito automático, crédito y otros movimientos diarios.</p>
              </button>

              <button type="button" className="accounting-hub-card" onClick={() => handleSectionChange('cuotas')}>
                <span className="eyebrow">Cuotas y descuentos</span>
                <h3>Precio base de membresía</h3>
                <p>Actualizá el valor del socio pleno y los descuentos por tipo de socio.</p>
              </button>

              {dashboardRole === 'directivo' && (
                <button type="button" className="accounting-hub-card" onClick={() => handleSectionChange('tesoreria')}>
                  <span className="eyebrow">Tesorería</span>
                  <h3>Caja, bancos y conciliaciones</h3>
                  <p>Control del dinero disponible, saldos del período y medios de pago.</p>
                </button>
              )}

              {dashboardRole === 'directivo' && (
                <button type="button" className="accounting-hub-card" onClick={() => handleSectionChange('sensibles')}>
                  <span className="eyebrow">Liquidaciones y controles sensibles</span>
                  <h3>Sueldos, referencias y obligaciones</h3>
                  <p>Información delicada de control interno para Junta Directiva.</p>
                </button>
              )}

              <button type="button" className="accounting-hub-card" onClick={() => handleSectionChange('empleados')}>
                <span className="eyebrow">Empleados y rendiciones</span>
                <h3>Recibos, gastos y horas extra</h3>
                <p>Listado de empleados, rendiciones cargadas y detalle operativo de cada legajo.</p>
              </button>

              <button type="button" className="accounting-hub-card" onClick={() => handleSectionChange('reportes')}>
                <span className="eyebrow">Reportes</span>
                <h3>Análisis y trazabilidad</h3>
                <p>Tablero ejecutivo, resumen financiero, gráficas, historial y auditoría.</p>
              </button>
            </div>
          ) : (
            <div className="accounting-link-groups">
              <div className="accounting-link-group">
                <strong>Movimientos financieros</strong>
                <button
                  type="button"
                  className={activeSection === 'movimientos' ? 'accounting-link-button accounting-link-button--active' : 'accounting-link-button'}
                  onClick={() => handleSectionChange('movimientos')}
                >
                  Consultar ingresos, egresos y cobros
                </button>
              </div>
              <div className="accounting-link-group">
                <strong>Cuotas y descuentos</strong>
                <button
                  type="button"
                  className={activeSection === 'cuotas' ? 'accounting-link-button accounting-link-button--active' : 'accounting-link-button'}
                  onClick={() => handleSectionChange('cuotas')}
                >
                  Precio base y descuentos por tipo
                </button>
              </div>
              {dashboardRole === 'directivo' && (
                <div className="accounting-link-group">
                  <strong>Tesorería</strong>
                  <button
                    type="button"
                    className={activeSection === 'tesoreria' ? 'accounting-link-button accounting-link-button--active' : 'accounting-link-button'}
                    onClick={() => handleSectionChange('tesoreria')}
                  >
                    Caja, bancos y conciliaciones
                  </button>
                </div>
              )}
              {dashboardRole === 'directivo' && (
                <div className="accounting-link-group">
                  <strong>Liquidaciones y controles sensibles</strong>
                  <button
                    type="button"
                    className={activeSection === 'sensibles' ? 'accounting-link-button accounting-link-button--active' : 'accounting-link-button'}
                    onClick={() => handleSectionChange('sensibles')}
                  >
                    Sueldos, referencias y obligaciones
                  </button>
                </div>
              )}
              <div className="accounting-link-group">
                <strong>Reportes</strong>
                <button
                  type="button"
                  className={activeSection === 'reportes' ? 'accounting-link-button accounting-link-button--active' : 'accounting-link-button'}
                  onClick={() => handleSectionChange('reportes')}
                >
                  Analizar movimientos contables
                </button>
              </div>
            </div>
          )}
        </section>

        {activeSection === 'cuotas' && (
          <section className="floating-card accounting-primary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Cuotas y descuentos</p>
                <h2>Precio base y descuentos de membresía</h2>
              </div>
            </div>

            <div className="accounting-actions-grid">
              {membershipPricingFormCard}
            </div>
          </section>
        )}

        {activeSection === 'movimientos' && (
          <div className="accounting-layout">
            <section className="floating-card accounting-primary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Movimientos financieros</p>
                  <h2>Entradas y salidas del período</h2>
                </div>
                <div className="accounting-inline-actions">
                  <button type="button" className="btn-primary" onClick={() => setEntryModal('income')}>
                    Cargar ingreso
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setEntryModal('expense')}>
                    Cargar egreso
                  </button>
                </div>
              </div>

              <div className="accounting-list">
                {snapshot.recentMovements.slice(0, 12).map((movement) => (
                  <article key={movement.id} className="accounting-row">
                    <div className="accounting-row__main">
                      <strong>{getMovementLabel(movement)}</strong>
                      <small>
                        {movement.movementType === 'income' ? 'Ingreso' : 'Egreso'}
                        {' · '}
                        {getPaymentMethodLabel(movement.paymentMethodCodeSnapshot, paymentMethodOptions)}
                        {getMovementPaymentReference(movement) ? ` · Ref. ${getMovementPaymentReference(movement)}` : ''}
                      </small>
                    </div>
                    <div className="accounting-row__meta">
                      <span className={`status-chip status-chip--${movement.status.replaceAll('_', '-')}`}>
                        {movement.status}
                      </span>
                      <strong>{formatCurrency(movement.netAmountMinor)}</strong>
                      <small>{formatTimestamp(movement.operationDate)}</small>
                    </div>
                  </article>
                ))}

                {!loading && snapshot.recentMovements.length === 0 && (
                  <div className="empty-state empty-state--inline">Todavía no hay movimientos cargados.</div>
                )}
              </div>
            </section>

            <section className="floating-card accounting-secondary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Circuitos de cobro</p>
                  <h2>Medios de pago operativos</h2>
                </div>
              </div>

              <div className="accounting-topic-list">
                <span>Ingresos</span>
                <span>Egresos</span>
                <span>Caja chica</span>
                <span>Transferencias</span>
                <span>Débito automático</span>
                <span>Pagos con crédito</span>
                <span>Otros medios de pago</span>
              </div>

              {!loading && paymentMethodOptions.length === 0 && (
                <div className="empty-state empty-state--inline">No hay medios de pago configurados.</div>
              )}
            </section>
          </div>
        )}

        {activeSection === 'empleados' && (
          <div className="accounting-layout">
            <section className="floating-card accounting-primary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Empleados</p>
                  <h2>Legajos, recibos y horas extra</h2>
                </div>
              </div>

              <div className="accounting-list">
                {snapshot.employeesPreview.map((employee) => {
                  const salaryPayments = snapshot.recentSalaryPayments.filter((payment) => payment.employeeId === employee.id);
                  const overtimeMinor = salaryPayments.reduce((total, payment) => total + (payment.overtimeAmountMinor ?? 0), 0);

                  return (
                    <article key={employee.id} className="accounting-row">
                      <div className="accounting-row__main">
                        <strong>{getEmployeeDisplayName(employee)}</strong>
                        <small>
                          {employee.position} · {employee.status === 'active' ? 'Activo' : 'Inactivo'}
                        </small>
                      </div>
                      <div className="accounting-row__meta">
                        <strong>{formatCurrency(overtimeMinor)}</strong>
                        <small>Horas extra liquidadas</small>
                      </div>
                    </article>
                  );
                })}

                {!loading && snapshot.employeesPreview.length === 0 && (
                  <div className="empty-state empty-state--inline">No hay empleados cargados.</div>
                )}
              </div>
            </section>

            <section className="floating-card accounting-secondary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Rendiciones</p>
                  <h2>Recibos y gastos presentados</h2>
                </div>
              </div>

              <div className="accounting-list">
                {snapshot.recentExpenses.map((expense) => (
                  <article key={expense.id} className="accounting-row">
                    <div className="accounting-row__main">
                      <strong>{expense.description}</strong>
                      <small>{expense.vendorName ?? 'Sin proveedor'} · {expense.status}</small>
                    </div>
                    <div className="accounting-row__meta">
                      <strong>{formatCurrency(expense.amountMinor)}</strong>
                      <small>{formatTimestamp(expense.expenseDate)}</small>
                    </div>
                  </article>
                ))}

                {!loading && snapshot.recentExpenses.length === 0 && (
                  <div className="empty-state empty-state--inline">No hay rendiciones cargadas.</div>
                )}
              </div>
            </section>
          </div>
        )}

        {activeSection === 'reportes' && (
          <>
        <section className="floating-card">
          <div className="directory-hero accounting-section-header">
            <div>
              <p className="eyebrow">Reportes</p>
              <h2>{dashboardRole === 'directivo' ? 'Tablero contable ejecutivo' : 'Resumen financiero del período'}</h2>
              <p className="accounting-helper-copy">
                Análisis por período, trazabilidad, liquidaciones y lectura histórica de los circuitos contables.
              </p>
            </div>
            <label className="form-field accounting-period-field">
              <span>Período de análisis</span>
              <input type="month" value={selectedPeriod} onChange={handlePeriodChange} />
            </label>
          </div>

          <div className="summary-grid accounting-summary-grid">
            <SummaryCard label="Ingresos netos" value={formatCurrency(incomeTotalMinor)} helper="Entradas visibles del período" />
            <SummaryCard label="Egresos netos" value={formatCurrency(expenseTotalMinor)} helper="Salidas visibles del período" />
            <SummaryCard label="Caja neta" value={formatCurrency(incomeTotalMinor - expenseTotalMinor)} helper="Resultado operativo del período" />
            <SummaryCard
              label={dashboardRole === 'directivo' ? 'Bancarizado' : 'Cuotas pendientes'}
              value={formatCurrency(dashboardRole === 'directivo' ? bankedTotalMinor : feePendingAmountMinor)}
              helper={dashboardRole === 'directivo' ? 'Movimientos bancarios del período' : `${snapshot.pendingFeeCount} cargos por cobrar`}
            />
            <SummaryCard
              label={dashboardRole === 'directivo' ? 'Comisión crédito' : 'Rendiciones por revisar'}
              value={dashboardRole === 'directivo' ? formatCurrency(creditCommissionTotalMinor) : `${snapshot.pendingExpenseCount}`}
              helper={dashboardRole === 'directivo' ? 'Costo acumulado por tarjeta' : 'Pendientes de aprobación'}
            />
            <SummaryCard
              label={dashboardRole === 'directivo' ? 'Débito Macro neto' : 'Dotación activa'}
              value={dashboardRole === 'directivo' ? formatCurrency(macroNetTotalMinor) : `${snapshot.activeEmployeesCount}`}
              helper={dashboardRole === 'directivo' ? 'Liquidaciones del período' : `${snapshot.activeMembersCount} socios activos vinculados`}
            />
          </div>
        </section>

        <div className="accounting-layout">
          <section className="floating-card accounting-primary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Medios y trazabilidad</p>
                <h2>Pagos discriminados por medio</h2>
              </div>
            </div>

            <div className="accounting-bars-grid">
              {paymentMix.map((entry) => (
                <StatBar
                  key={entry.id}
                  label={entry.name}
                  amountMinor={entry.amountMinor}
                  percentage={entry.percentage}
                  helper={entry.percentage > 0 ? `${entry.percentage}% del ingreso neto` : 'Sin impacto en el período'}
                />
              ))}
            </div>

            <div className="accounting-list">
              {snapshot.recentMovements.slice(0, 8).map((movement) => (
                <article key={movement.id} className="accounting-row">
                  <div className="accounting-row__main">
                    <strong>{getMovementLabel(movement)}</strong>
                    <small>
                      {movement.movementType === 'income' ? 'Ingreso' : 'Egreso'}
                      {' · '}
                      {getPaymentMethodLabel(movement.paymentMethodCodeSnapshot, paymentMethodOptions)}
                    </small>
                  </div>
                  <div className="accounting-row__meta">
                    <span className={`status-chip status-chip--${movement.status.replaceAll('_', '-')}`}>
                      {movement.status}
                    </span>
                    <strong>{formatCurrency(movement.netAmountMinor)}</strong>
                    <small>{formatTimestamp(movement.operationDate)}</small>
                  </div>
                </article>
              ))}

              {!loading && snapshot.recentMovements.length === 0 && (
                <div className="empty-state empty-state--inline">Todavía no hay movimientos cargados.</div>
              )}
            </div>
          </section>

          <section className="floating-card accounting-secondary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">{dashboardRole === 'directivo' ? 'Tesorería' : 'Base operativa'}</p>
                <h2>{dashboardRole === 'directivo' ? 'Movimientos bancarios y liquidaciones' : 'Socios y empleados visibles'}</h2>
              </div>
            </div>

            {dashboardRole === 'directivo' ? (
              <div className="accounting-stack">
                <div className="accounting-list">
                  {snapshot.recentBankedMovements.map((movement) => (
                    <article key={movement.id} className="accounting-row">
                      <div className="accounting-row__main">
                        <strong>{getMovementLabel(movement)}</strong>
                        <small>
                          {getPaymentMethodLabel(movement.paymentMethodCodeSnapshot, paymentMethodOptions)}
                          {' · '}
                          {formatTimestamp(movement.operationDate)}
                        </small>
                      </div>
                      <div className="accounting-row__meta">
                        <strong>{formatCurrency(movement.netAmountMinor)}</strong>
                        <small>{movement.originType}</small>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="accounting-list">
                  {snapshot.recentSettlements.map((settlement) => (
                    <article key={settlement.id} className="accounting-row">
                      <div className="accounting-row__main">
                        <strong>{settlement.externalBatchRef}</strong>
                        <small>
                          {settlement.bankName}
                          {' · '}
                          {formatPeriod(settlement.month)}
                        </small>
                      </div>
                      <div className="accounting-row__meta">
                        <span className={`status-chip status-chip--${settlement.status.replaceAll('_', '-')}`}>
                          {settlement.status}
                        </span>
                        <strong>{formatCurrency(settlement.netAmountMinor)}</strong>
                        <small>{settlement.movementCount} operaciones</small>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className="accounting-two-column">
                <div className="accounting-list">
                  {snapshot.membersPreview.map((member) => (
                    <article key={member.id} className="accounting-row">
                      <div className="accounting-row__main">
                        <strong>{getMemberDisplayName(member)}</strong>
                        <small>
                          {member.typeCodeSnapshot}
                          {' · '}
                          {member.status}
                        </small>
                      </div>
                      <div className="accounting-row__meta">
                        <small>{member.memberNumber}</small>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="accounting-list">
                  {snapshot.employeesPreview.map((employee) => (
                    <article key={employee.id} className="accounting-row">
                      <div className="accounting-row__main">
                        <strong>{getEmployeeDisplayName(employee)}</strong>
                        <small>
                          {employee.position}
                          {' · '}
                          {employee.status}
                        </small>
                      </div>
                      <div className="accounting-row__meta">
                        <small>{employee.contractType}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
          </>
        )}

        {activeSection === 'movimientos' && dashboardRole === 'administrativo' && (
          <div className="accounting-layout">
            <section className="floating-card accounting-primary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Acciones</p>
                  <h2>Cuotas, cobranzas y rendiciones</h2>
                </div>
              </div>

              <div className="accounting-actions-grid">
                <form className="accounting-action-card" onSubmit={handleSubmitExpense}>
                  <div>
                    <strong>Cargar factura o compra</strong>
                    <p>Registra el gasto con responsable, rubro, proveedor y medio de pago.</p>
                  </div>

                  <label className="form-field">
                    <span>Responsable de carga</span>
                    <select
                      required
                      value={submitExpenseForm.employeeId}
                      onChange={(event) =>
                        setSubmitExpenseForm((current) => ({ ...current, employeeId: event.target.value }))
                      }
                    >
                      <option value="">Seleccionar responsable</option>
                      {snapshot.employeesPreview.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {getEmployeeDisplayName(employee)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Rubro</span>
                    <select
                      value={submitExpenseForm.categoryId}
                      onChange={(event) =>
                        setSubmitExpenseForm((current) => ({ ...current, categoryId: event.target.value }))
                      }
                    >
                      {EXPENSE_CATEGORY_OPTIONS.map((category) => (
                        <option key={category.value} value={category.value}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Fecha</span>
                    <input
                      type="date"
                      value={submitExpenseForm.expenseDate}
                      onChange={(event) =>
                        setSubmitExpenseForm((current) => ({ ...current, expenseDate: event.target.value }))
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Monto (ARS)</span>
                    <input
                      type="number"
                      min="0"
                      value={submitExpenseForm.amountMinor}
                      onChange={(event) =>
                        setSubmitExpenseForm((current) => ({ ...current, amountMinor: event.target.value }))
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Nombre del proveedor</span>
                    <input
                      value={submitExpenseForm.vendorName}
                      onChange={(event) =>
                        setSubmitExpenseForm((current) => ({ ...current, vendorName: event.target.value }))
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Medio de pago</span>
                    <select
                      value={submitExpenseForm.paymentMethodId}
                      onChange={(event) =>
                        setSubmitExpenseForm((current) => ({ ...current, paymentMethodId: event.target.value }))
                      }
                    >
                      {paymentMethodOptions.map((paymentMethod) => (
                        <option key={paymentMethod.id} value={paymentMethod.id}>
                          {getPaymentMethodOptionLabel(paymentMethod)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Detalle</span>
                    <textarea
                      value={submitExpenseForm.description}
                      onChange={(event) =>
                        setSubmitExpenseForm((current) => ({ ...current, description: event.target.value }))
                      }
                    />
                  </label>

                  <button type="submit" className="btn-primary" disabled={submittingAction === 'submit-expense'}>
                    {submittingAction === 'submit-expense' ? 'Cargando...' : 'Cargar gasto'}
                  </button>
                </form>

                <form className="accounting-action-card" onSubmit={handleGenerateCuota}>
                  <div>
                    <strong>Generar cuota</strong>
                    <p>Emití el devengado del período sin tocar caja hasta el cobro.</p>
                  </div>

                  <label className="form-field">
                    <span>Socio</span>
                    <select
                      value={generateFeeForm.memberId}
                      onChange={(event) =>
                        setGenerateFeeForm((current) => ({ ...current, memberId: event.target.value }))
                      }
                    >
                      <option value="">Seleccionar socio</option>
                      {snapshot.membersPreview.map((member) => (
                        <option key={member.id} value={member.id}>
                          {getMemberDisplayName(member)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Período</span>
                    <input
                      type="month"
                      value={generateFeeForm.period}
                      onChange={(event) =>
                        setGenerateFeeForm((current) => ({
                          ...current,
                          period: normalizeAccountingPeriod(event.target.value),
                        }))
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Notas</span>
                    <textarea
                      value={generateFeeForm.notes}
                      onChange={(event) =>
                        setGenerateFeeForm((current) => ({ ...current, notes: event.target.value }))
                      }
                    />
                  </label>

                  <button type="submit" className="btn-primary" disabled={submittingAction === 'generate-cuota'}>
                    {submittingAction === 'generate-cuota' ? 'Generando...' : 'Generar cuota'}
                  </button>
                </form>

                <form className="accounting-action-card" onSubmit={handleRegisterPayment}>
                  <div>
                    <strong>Registrar cobro</strong>
                    <p>Tomá una cuota pendiente y convertí el cobro en movimiento contable.</p>
                  </div>

                  <label className="form-field">
                    <span>Cuota pendiente</span>
                    <select
                      value={feePaymentForm.memberFeeChargeId}
                      onChange={(event) =>
                        setFeePaymentForm((current) => ({ ...current, memberFeeChargeId: event.target.value }))
                      }
                    >
                      <option value="">Seleccionar cargo</option>
                      {snapshot.periodFeeCharges
                        .filter((charge) => charge.status === 'pending' || charge.status === 'overdue')
                        .map((charge) => {
                          const member =
                            snapshot.memberMap[charge.memberId ?? ''] ?? snapshot.memberMap[charge.holderMemberId ?? ''];

                          return (
                            <option key={charge.id} value={charge.id}>
                              {`${getMemberDisplayName(member)} · ${formatCurrency(charge.finalAmountMinor)}`}
                            </option>
                          );
                        })}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Medio de pago</span>
                    <select
                      value={feePaymentForm.paymentMethodId}
                      onChange={(event) =>
                        setFeePaymentForm((current) => ({
                          ...current,
                          paymentMethodId: event.target.value,
                          paymentReference: requiresPaymentReference(event.target.value) ? current.paymentReference : '',
                        }))
                      }
                    >
                      {paymentMethodOptions.map((paymentMethod) => (
                        <option key={paymentMethod.id} value={paymentMethod.id}>
                          {getPaymentMethodOptionLabel(paymentMethod)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {requiresPaymentReference(feePaymentForm.paymentMethodId) && (
                    <label className="form-field">
                      <span>Referencia</span>
                      <input
                        required
                        value={feePaymentForm.paymentReference}
                        onChange={(event) =>
                          setFeePaymentForm((current) => ({ ...current, paymentReference: event.target.value }))
                        }
                        placeholder="Comprobante, transferencia o referencia"
                      />
                    </label>
                  )}

                  <label className="form-field">
                    <span>Monto</span>
                    <input value={selectedFeeCharge ? formatCurrency(selectedFeeCharge.finalAmountMinor) : 'Sin monto'} readOnly />
                  </label>

                  <label className="form-field">
                    <span>Notas</span>
                    <textarea
                      value={feePaymentForm.notes}
                      onChange={(event) =>
                        setFeePaymentForm((current) => ({ ...current, notes: event.target.value }))
                      }
                    />
                  </label>

                  <button type="submit" className="btn-primary" disabled={submittingAction === 'register-payment'}>
                    {submittingAction === 'register-payment' ? 'Registrando...' : 'Registrar pago'}
                  </button>
                </form>
              </div>
            </section>

            <section className="floating-card accounting-secondary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Rendiciones</p>
                  <h2>Cola administrativa</h2>
                </div>
              </div>

              <div className="accounting-list">
                {recentExpenseQueue.map((expense) => {
                  const employee = snapshot.employeeMap[expense.employeeId];
                  const canApprove = expense.status === 'submitted';
                  const canPost = expense.status === 'approved';

                  return (
                    <article key={expense.id} className="accounting-row accounting-row--actions">
                      <div className="accounting-row__main">
                        <strong>{expense.categoryCodeSnapshot.replaceAll('_', ' ')}</strong>
                        <small>
                          {getEmployeeDisplayName(employee)}
                          {' · '}
                          {formatTimestamp(expense.expenseDate)}
                        </small>
                      </div>
                      <div className="accounting-row__meta">
                        <span className={`status-chip status-chip--${expense.status.replaceAll('_', '-')}`}>
                          {expense.status}
                        </span>
                        <strong>{formatCurrency(expense.amountMinor)}</strong>
                      </div>
                      <div className="accounting-inline-actions">
                        {canApprove && (
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={submittingAction === `approve-${expense.id}`}
                            onClick={() => void handleApproveExpense(expense.id)}
                          >
                            {submittingAction === `approve-${expense.id}` ? 'Aprobando...' : 'Aprobar'}
                          </button>
                        )}
                        {canPost && (
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={submittingAction === `post-${expense.id}`}
                            onClick={() => void handlePostExpense(expense.id)}
                          >
                            {submittingAction === `post-${expense.id}` ? 'Posteando...' : 'Postear'}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}

                {!loading && recentExpenseQueue.length === 0 && (
                  <div className="empty-state empty-state--inline">No hay rendiciones pendientes en este momento.</div>
                )}
              </div>
            </section>
          </div>
        )}

        {activeSection === 'tesoreria' && dashboardRole === 'directivo' && (
          <div className="accounting-layout">
            <section className="floating-card accounting-primary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Tesorería</p>
                  <h2>Caja, bancos y saldos del período</h2>
                </div>
              </div>

              <div className="summary-grid accounting-summary-grid">
                <SummaryCard label="Movimientos bancarios" value={formatCurrency(bankedTotalMinor)} helper="Base real de movimientos bancarizados" />
                <SummaryCard label="Caja no bancarizada" value={formatCurrency(cashTotalMinor)} helper="Efectivo y medios no bancarios del período" />
                <SummaryCard label="Débito Macro neto" value={formatCurrency(macroNetTotalMinor)} helper="Liquidaciones registradas en el período" />
              </div>

              <div className="accounting-list">
                {snapshot.recentBankedMovements.slice(0, 8).map((movement) => (
                  <article key={movement.id} className="accounting-row">
                    <div className="accounting-row__main">
                      <strong>{getMovementLabel(movement)}</strong>
                      <small>
                        {getPaymentMethodLabel(movement.paymentMethodCodeSnapshot, paymentMethodOptions)}
                        {' · '}
                        {formatTimestamp(movement.operationDate)}
                      </small>
                    </div>
                    <div className="accounting-row__meta">
                      <strong>{formatCurrency(movement.netAmountMinor)}</strong>
                      <small>{movement.originType}</small>
                    </div>
                  </article>
                ))}

                {!loading && snapshot.recentBankedMovements.length === 0 && (
                  <div className="empty-state empty-state--inline">No hay movimientos bancarios registrados.</div>
                )}
              </div>
            </section>

            <section className="floating-card accounting-secondary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Conciliaciones</p>
                  <h2>Medios de pago y bancos</h2>
                </div>
              </div>

              <div className="accounting-topic-list">
                <span>Caja actual</span>
                <span>Bancos</span>
                <span>Saldos</span>
                <span>Conciliaciones</span>
                <span>Control de medios de pago</span>
                <span>Comisiones bancarias</span>
              </div>

              <div className="accounting-list">
                {snapshot.monthSettlements.slice(0, 6).map((settlement) => (
                  <article key={settlement.id} className="accounting-row">
                    <div className="accounting-row__main">
                      <strong>{settlement.externalBatchRef}</strong>
                      <small>
                        {settlement.bankName}
                        {' · '}
                        {formatPeriod(settlement.month)}
                      </small>
                    </div>
                    <div className="accounting-row__meta">
                      <span className={`status-chip status-chip--${settlement.status.replaceAll('_', '-')}`}>
                        {settlement.status}
                      </span>
                      <strong>{formatCurrency(settlement.netAmountMinor)}</strong>
                    </div>
                  </article>
                ))}

                {!loading && snapshot.monthSettlements.length === 0 && (
                  <div className="empty-state empty-state--inline">No hay conciliaciones cargadas para este período.</div>
                )}
              </div>
            </section>
          </div>
        )}

        {activeSection === 'sensibles' && dashboardRole === 'directivo' && (
          <div className="accounting-sensitive-layout">
            <section className="floating-card accounting-primary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Liquidaciones y controles sensibles</p>
                  <h2>Referencias, obligaciones y control interno</h2>
                </div>
              </div>

              <div className="accounting-sensitive-stack">

                <AccountingCollapsibleCard
                  title="Registrar referencia externa"
                  description="Carga F931, obra social, ART u otros compromisos con respaldo documental."
                  open={openSensitivePanels.reference}
                  onToggle={() => toggleSensitivePanel('reference')}
                >
                <form className="accounting-action-card accounting-action-card--embedded" onSubmit={handleRecordExternalReference}>
                  <div>
                    <strong>Registrar referencia externa</strong>
                    <p>Cargá F931, obra social, ART u otros compromisos con respaldo documental.</p>
                  </div>

                  <label className="form-field">
                    <span>Tipo</span>
                    <select
                      value={externalReferenceForm.referenceType}
                      onChange={(event) =>
                        setExternalReferenceForm((current) => ({
                          ...current,
                          referenceType: event.target.value as ExternalReferenceFormState['referenceType'],
                        }))
                      }
                    >
                      {ACCOUNTING_REFERENCE_TYPES.map((referenceType) => (
                        <option key={referenceType} value={referenceType}>
                          {referenceType}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Período</span>
                    <input
                      type="month"
                      value={externalReferenceForm.period}
                      onChange={(event) =>
                        setExternalReferenceForm((current) => ({
                          ...current,
                          period: normalizeAccountingPeriod(event.target.value),
                        }))
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Monto (ARS)</span>
                    <input
                      type="number"
                      min="0"
                      value={externalReferenceForm.amountMinor}
                      onChange={(event) =>
                        setExternalReferenceForm((current) => ({ ...current, amountMinor: event.target.value }))
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Nombre del proveedor</span>
                    <input
                      value={externalReferenceForm.providerName}
                      onChange={(event) =>
                        setExternalReferenceForm((current) => ({ ...current, providerName: event.target.value }))
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Número de referencia</span>
                    <input
                      value={externalReferenceForm.referenceNumber}
                      onChange={(event) =>
                        setExternalReferenceForm((current) => ({ ...current, referenceNumber: event.target.value }))
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Notas</span>
                    <textarea
                      value={externalReferenceForm.notes}
                      onChange={(event) =>
                        setExternalReferenceForm((current) => ({ ...current, notes: event.target.value }))
                      }
                    />
                  </label>

                  <button type="submit" className="btn-primary" disabled={submittingAction === 'record-reference'}>
                    {submittingAction === 'record-reference' ? 'Registrando...' : 'Guardar referencia'}
                  </button>
                </form>
                </AccountingCollapsibleCard>
                <AccountingCollapsibleCard
                  title="Modificar sueldo"
                  description="Actualiza la configuracion salarial activa de un empleado. Solo Junta Directiva puede hacerlo."
                  open={openSensitivePanels.salary}
                  onToggle={() => toggleSensitivePanel('salary')}
                >
                <form className="accounting-action-card accounting-action-card--embedded" onSubmit={handleUpsertSalaryConfiguration}>
                  <div>
                    <strong>Modificar sueldo</strong>
                    <p>Actualizá la configuración salarial activa de un empleado. Solo Junta Directiva puede hacerlo.</p>
                  </div>

                  <label className="form-field">
                    <span>Empleado</span>
                    <select
                      value={salaryConfigForm.employeeId}
                      onChange={(event) =>
                        setSalaryConfigForm((current) => ({ ...current, employeeId: event.target.value }))
                      }
                    >
                      <option value="">Seleccionar empleado</option>
                      {snapshot.employeesPreview.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {getEmployeeDisplayName(employee)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Tipo de contrato</span>
                    <input
                      value={salaryConfigForm.periodicity}
                      readOnly
                    />
                  </label>

                  <label className="form-field">
                    <span>Sueldo base (ARS)</span>
                    <input
                      inputMode="decimal"
                      value={salaryConfigForm.baseAmount}
                      onChange={(event) =>
                        setSalaryConfigForm((current) => ({ ...current, baseAmount: event.target.value }))
                      }
                      placeholder="0,00"
                    />
                  </label>

                  <label className="form-field">
                    <span>Periodicidad</span>
                    <select
                      value={salaryConfigForm.periodicity}
                      onChange={(event) =>
                        setSalaryConfigForm((current) => ({
                          ...current,
                          periodicity: event.target.value as SalaryPeriodicity,
                          contractType: event.target.value,
                        }))
                      }
                    >
                      <option value="monthly">Mensual</option>
                      <option value="daily">Diaria</option>
                      <option value="hourly">Por hora</option>
                      <option value="seasonal">Temporada</option>
                      <option value="honorarios">Honorarios</option>
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Vigente desde</span>
                    <input
                      type="date"
                      value={salaryConfigForm.effectiveFrom}
                      onChange={(event) =>
                        setSalaryConfigForm((current) => ({ ...current, effectiveFrom: event.target.value }))
                      }
                    />
                  </label>

                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={salaryConfigForm.allowOvertime}
                      onChange={(event) =>
                        setSalaryConfigForm((current) => ({ ...current, allowOvertime: event.target.checked }))
                      }
                    />
                    <span>Permite horas extra</span>
                  </label>

                  <label className="form-field">
                    <span>Notas</span>
                    <textarea
                      value={salaryConfigForm.notes}
                      onChange={(event) =>
                        setSalaryConfigForm((current) => ({ ...current, notes: event.target.value }))
                      }
                    />
                  </label>

                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={submittingAction === 'upsert-salary-configuration'}
                  >
                    {submittingAction === 'upsert-salary-configuration' ? 'Guardando...' : 'Guardar sueldo'}
                  </button>
                </form>

                </AccountingCollapsibleCard>

                <AccountingCollapsibleCard
                  title="Anular movimiento"
                  description="Control directo sobre movimientos ya emitidos, con reverso automatico cuando aplica."
                  open={openSensitivePanels.void}
                  onToggle={() => toggleSensitivePanel('void')}
                >
                <form className="accounting-action-card accounting-action-card--embedded" onSubmit={handleVoidMovement}>
                  <div>
                    <strong>Anular movimiento</strong>
                    <p>Control directo sobre movimientos ya emitidos, con reverso automático cuando aplica.</p>
                  </div>

                  <label className="form-field">
                    <span>Movimiento</span>
                    <select
                      value={voidMovementForm.movementId}
                      onChange={(event) =>
                        setVoidMovementForm((current) => ({ ...current, movementId: event.target.value }))
                      }
                    >
                      <option value="">Seleccionar movimiento</option>
                      {snapshot.recentMovements.map((movement) => (
                        <option key={movement.id} value={movement.id}>
                          {`${getMovementLabel(movement)} · ${formatCurrency(movement.netAmountMinor)}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field">
                    <span>Motivo</span>
                    <textarea
                      value={voidMovementForm.reason}
                      onChange={(event) =>
                        setVoidMovementForm((current) => ({ ...current, reason: event.target.value }))
                      }
                    />
                  </label>

                  <button type="submit" className="btn-secondary" disabled={submittingAction === 'void-movement'}>
                    {submittingAction === 'void-movement' ? 'Anulando...' : 'Anular movimiento'}
                  </button>
                </form>
                </AccountingCollapsibleCard>
              </div>
            </section>

            <section className="floating-card accounting-secondary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Liquidaciones</p>
                  <h2>Débito Macro y compromisos externos</h2>
                </div>
              </div>

              <div className="accounting-list">
                {snapshot.monthSettlements.map((settlement) => (
                  <article key={settlement.id} className="accounting-row accounting-row--actions">
                    <div className="accounting-row__main">
                      <strong>{settlement.externalBatchRef}</strong>
                      <small>
                        {settlement.bankName}
                        {' · '}
                        {formatTimestamp(settlement.accreditedAt)}
                      </small>
                    </div>
                    <div className="accounting-row__meta">
                      <span className={`status-chip status-chip--${settlement.status.replaceAll('_', '-')}`}>
                        {settlement.status}
                      </span>
                      <strong>{formatCurrency(settlement.netAmountMinor)}</strong>
                      <small>{settlement.movementCount} movimientos</small>
                    </div>
                    <div className="accounting-inline-actions">
                      {settlement.status === 'imported' && (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={submittingAction === `reconcile-${settlement.id}`}
                          onClick={() => void handleReconcileSettlement(settlement.id)}
                        >
                          {submittingAction === `reconcile-${settlement.id}` ? 'Conciliando...' : 'Conciliar'}
                        </button>
                      )}
                      {settlement.status === 'reconciled' && (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={submittingAction === `close-${settlement.id}`}
                          onClick={() => void handleReconcileSettlement(settlement.id, true)}
                        >
                          {submittingAction === `close-${settlement.id}` ? 'Cerrando...' : 'Cerrar'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}

                {snapshot.periodReferences.map((reference) => (
                  <article key={reference.id} className="accounting-row">
                    <div className="accounting-row__main">
                      <strong>{reference.referenceType}</strong>
                      <small>
                        {reference.providerName ?? 'Sin proveedor'}
                        {' · '}
                        {reference.referenceNumber ?? 'Sin número'}
                      </small>
                    </div>
                    <div className="accounting-row__meta">
                      <span className={`status-chip status-chip--${reference.status.replaceAll('_', '-')}`}>
                        {reference.status}
                      </span>
                      <strong>{formatCurrency(reference.amountMinor)}</strong>
                      <small>{formatPeriod(reference.period)}</small>
                    </div>
                  </article>
                ))}

                {!loading && snapshot.monthSettlements.length === 0 && snapshot.periodReferences.length === 0 && (
                  <div className="empty-state empty-state--inline">No hay liquidaciones ni referencias cargadas para este período.</div>
                )}
              </div>
            </section>
          </div>
        )}

        {activeSection === 'sensibles' && dashboardRole === 'directivo' && (
          <section className="floating-card accounting-owner-footer">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Controles internos sensibles</p>
                <h2>Sueldos, referencias y presión financiera</h2>
              </div>
            </div>

            <div className="summary-grid accounting-summary-grid">
              <SummaryCard label="Sueldos visibles" value={formatCurrency(salaryTotalMinor)} helper="Total de salary_payments del período" />
              <SummaryCard label="Referencias externas" value={`${snapshot.periodReferences.length}`} helper="F931, ART y compromisos cargados" />
              <SummaryCard label="Movimientos bancarios" value={formatCurrency(bankedTotalMinor)} helper="Base para lectura de cuenta corriente" />
              <SummaryCard label="Caja no bancarizada" value={formatCurrency(cashTotalMinor)} helper="Incluye efectivo y horas extra" />
            </div>
          </section>
        )}

        {entryModal === 'income' && (
          <div className="modal-overlay" role="presentation" onClick={() => setEntryModal(null)}>
            <section className="floating-card accounting-entry-modal" role="dialog" aria-modal="true" aria-label="Cargar ingreso" onClick={(event) => event.stopPropagation()}>
              <div className="info-dialog-card__header">
                <div>
                  <p className="eyebrow">Cargar datos</p>
                  <h2>Cargar ingreso</h2>
                </div>
                <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={() => setEntryModal(null)}>
                  ×
                </button>
              </div>

              <form className="accounting-entry-form" onSubmit={handleSubmitIncome}>
                <label className="form-field">
                  <span>Fecha</span>
                  <input
                    type="date"
                    value={manualIncomeForm.operationDate}
                    onChange={(event) =>
                      setManualIncomeForm((current) => ({ ...current, operationDate: event.target.value }))
                    }
                  />
                </label>

                <label className="form-field">
                  <span>Categoría</span>
                  <select
                    value={manualIncomeForm.categoryId}
                    onChange={(event) =>
                      setManualIncomeForm((current) => ({ ...current, categoryId: event.target.value }))
                    }
                  >
                    {INCOME_CATEGORY_OPTIONS.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Concepto</span>
                  <input
                    value={manualIncomeForm.concept}
                    onChange={(event) =>
                      setManualIncomeForm((current) => ({ ...current, concept: event.target.value }))
                    }
                  />
                </label>

                <label className="form-field">
                  <span>Monto</span>
                  <input
                    inputMode="decimal"
                    value={manualIncomeForm.amount}
                    onChange={(event) =>
                      setManualIncomeForm((current) => ({ ...current, amount: event.target.value }))
                    }
                    placeholder="0,00"
                  />
                </label>

                <label className="form-field">
                  <span>Medio de pago</span>
                  <select
                    value={manualIncomeForm.paymentMethodId}
                    onChange={(event) =>
                      setManualIncomeForm((current) => ({
                        ...current,
                        paymentMethodId: event.target.value,
                        paymentReference: requiresPaymentReference(event.target.value) ? current.paymentReference : '',
                      }))
                    }
                  >
                    {paymentMethodOptions.length === 0 && (
                      <option value={manualIncomeForm.paymentMethodId}>Sin medios configurados</option>
                    )}
                    {paymentMethodOptions.map((paymentMethod) => (
                      <option key={paymentMethod.id} value={paymentMethod.id}>
                        {getPaymentMethodOptionLabel(paymentMethod)}
                      </option>
                    ))}
                  </select>
                </label>

                {requiresPaymentReference(manualIncomeForm.paymentMethodId) && (
                  <label className="form-field">
                    <span>Referencia</span>
                    <input
                      value={manualIncomeForm.paymentReference}
                      onChange={(event) =>
                        setManualIncomeForm((current) => ({ ...current, paymentReference: event.target.value }))
                      }
                      placeholder="Comprobante, transferencia o referencia"
                    />
                  </label>
                )}

                <label className="form-field">
                  <span>Observaciones</span>
                  <textarea
                    value={manualIncomeForm.notes}
                    onChange={(event) =>
                      setManualIncomeForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>

                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={() => setEntryModal(null)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={submittingAction === 'submit-income'}>
                    {submittingAction === 'submit-income' ? 'Cargando...' : 'Guardar ingreso'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {entryModal === 'expense' && (
          <div className="modal-overlay" role="presentation" onClick={() => setEntryModal(null)}>
            <section className="floating-card accounting-entry-modal" role="dialog" aria-modal="true" aria-label="Cargar egreso" onClick={(event) => event.stopPropagation()}>
              <div className="info-dialog-card__header">
                <div>
                  <p className="eyebrow">Cargar datos</p>
                  <h2>Cargar egreso</h2>
                </div>
                <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={() => setEntryModal(null)}>
                  ×
                </button>
              </div>

              <form className="accounting-entry-form" onSubmit={handleSubmitExpense}>
                <label className="form-field">
                  <span>Fecha</span>
                  <input
                    type="date"
                    value={submitExpenseForm.expenseDate}
                    onChange={(event) =>
                      setSubmitExpenseForm((current) => ({ ...current, expenseDate: event.target.value }))
                    }
                  />
                </label>

                <label className="form-field">
                  <span>Categoría</span>
                  <select
                    value={submitExpenseForm.categoryId}
                    onChange={(event) =>
                      setSubmitExpenseForm((current) => ({ ...current, categoryId: event.target.value }))
                    }
                  >
                    {EXPENSE_CATEGORY_OPTIONS.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Concepto</span>
                  <input
                    value={submitExpenseForm.description}
                    onChange={(event) =>
                      setSubmitExpenseForm((current) => ({ ...current, description: event.target.value }))
                    }
                  />
                </label>

                <label className="form-field">
                  <span>Monto</span>
                  <input
                    inputMode="decimal"
                    value={submitExpenseForm.amountMinor}
                    onChange={(event) =>
                      setSubmitExpenseForm((current) => ({ ...current, amountMinor: event.target.value }))
                    }
                    placeholder="0,00"
                  />
                </label>

                <label className="form-field">
                  <span>Medio de pago</span>
                  <select
                    value={submitExpenseForm.paymentMethodId}
                    onChange={(event) =>
                      setSubmitExpenseForm((current) => ({ ...current, paymentMethodId: event.target.value }))
                    }
                  >
                    {paymentMethodOptions.length === 0 && (
                      <option value={submitExpenseForm.paymentMethodId}>Sin medios configurados</option>
                    )}
                    {paymentMethodOptions.map((paymentMethod) => (
                      <option key={paymentMethod.id} value={paymentMethod.id}>
                        {getPaymentMethodOptionLabel(paymentMethod)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Responsable de carga</span>
                  <select
                    required
                    value={submitExpenseForm.employeeId}
                    onChange={(event) =>
                      setSubmitExpenseForm((current) => ({ ...current, employeeId: event.target.value }))
                    }
                  >
                    <option value="">Seleccionar responsable</option>
                    {snapshot.employeesPreview.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {getEmployeeDisplayName(employee)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Nombre del proveedor</span>
                  <input
                    value={submitExpenseForm.vendorName}
                    onChange={(event) =>
                      setSubmitExpenseForm((current) => ({ ...current, vendorName: event.target.value }))
                    }
                  />
                </label>

                <label className="form-field">
                  <span>Observaciones</span>
                  <textarea
                    value={submitExpenseForm.notes}
                    onChange={(event) =>
                      setSubmitExpenseForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>

                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={() => setEntryModal(null)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={submittingAction === 'submit-expense'}>
                    {submittingAction === 'submit-expense' ? 'Cargando...' : 'Guardar egreso'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
