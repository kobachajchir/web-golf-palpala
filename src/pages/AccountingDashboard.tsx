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
import { Link, useSearchParams } from 'react-router-dom';
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
  CreateMercadoPagoCheckoutResult,
  MercadoPagoCheckoutSessionDocument,
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
  createMercadoPagoCheckoutSessionsRepository,
  createPaymentMethodsRepository,
  createSalaryPaymentsRepository,
} from '../modules/accounting/infrastructure/firestore/repositories';
import type { EmployeeDocument, MemberDocument } from '../modules/users/domain/models';
import {
  createEmployeesRepository,
  createMembersRepository,
} from '../modules/users/infrastructure/firestore/repositories';
import { SearchFiltersPanel } from '../components/SearchFiltersPanel';

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
  pendingFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
  recentMercadoPagoSessions: Array<EntityWithId<MercadoPagoCheckoutSessionDocument>>;
  periodReferences: Array<EntityWithId<ExternalAccountingReferenceDocument>>;
  recentSalaryPayments: Array<EntityWithId<SalaryPaymentDocument>>;
  membersPreview: Array<EntityWithId<MemberDocument>>;
  renewalMembers: Array<EntityWithId<MemberDocument>>;
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
  operationDate: string;
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

type AdminMercadoPagoCheckoutState = Pick<
  CreateMercadoPagoCheckoutResult,
  'sessionId' | 'preferenceId' | 'checkoutUrl' | 'status' | 'reused'
> & {
  title: string;
  totalAmountMinor: number;
  itemCount: number;
};

type AccountingSection = 'inicio' | 'cargar' | 'movimientos' | 'tesoreria' | 'cuotas' | 'sensibles' | 'empleados' | 'reportes';
type EntryModalType = 'income' | 'expense' | null;
type AccountingSubsection =
  | 'load-entries'
  | 'membership-pricing'
  | 'renewals'
  | 'movement-list'
  | 'payment-methods'
  | 'expense-form'
  | 'generate-fee'
  | 'register-payment'
  | 'mercado-pago'
  | 'expense-queue'
  | 'employee-list'
  | 'employee-expenses'
  | 'treasury-summary'
  | 'treasury-settlements'
  | 'reference'
  | 'salary'
  | 'void'
  | 'sensitive-settlements'
  | 'sensitive-summary';

const ACCOUNTING_SECTIONS: readonly AccountingSection[] = [
  'inicio',
  'cargar',
  'movimientos',
  'tesoreria',
  'cuotas',
  'sensibles',
  'empleados',
  'reportes',
];

const ACCOUNTING_SECTION_TITLES: Record<AccountingSection, string> = {
  inicio: 'Contabilidad',
  cargar: 'Ingresos y egresos',
  movimientos: 'Movimientos financieros',
  tesoreria: 'Tesoreria',
  cuotas: 'Cuota societaria',
  sensibles: 'Liquidaciones y controles',
  empleados: 'Empleados y rendiciones',
  reportes: 'Reportes',
};

const ACCOUNTING_SUBSECTIONS: readonly AccountingSubsection[] = [
  'load-entries',
  'membership-pricing',
  'renewals',
  'movement-list',
  'payment-methods',
  'expense-form',
  'generate-fee',
  'register-payment',
  'mercado-pago',
  'expense-queue',
  'employee-list',
  'employee-expenses',
  'treasury-summary',
  'treasury-settlements',
  'reference',
  'salary',
  'void',
  'sensitive-settlements',
  'sensitive-summary',
];

const ACCOUNTING_SUBSECTION_SECTION: Record<AccountingSubsection, AccountingSection> = {
  'load-entries': 'cargar',
  'membership-pricing': 'cuotas',
  renewals: 'cuotas',
  'movement-list': 'movimientos',
  'payment-methods': 'movimientos',
  'expense-form': 'cuotas',
  'generate-fee': 'cuotas',
  'register-payment': 'cuotas',
  'mercado-pago': 'cuotas',
  'expense-queue': 'empleados',
  'employee-list': 'empleados',
  'employee-expenses': 'empleados',
  'treasury-summary': 'tesoreria',
  'treasury-settlements': 'tesoreria',
  reference: 'sensibles',
  salary: 'sensibles',
  void: 'sensibles',
  'sensitive-settlements': 'sensibles',
  'sensitive-summary': 'sensibles',
};

function isAccountingSection(value: string | null): value is AccountingSection {
  return Boolean(value && ACCOUNTING_SECTIONS.includes(value as AccountingSection));
}

function isAccountingSubsection(value: string | null): value is AccountingSubsection {
  return Boolean(value && ACCOUNTING_SUBSECTIONS.includes(value as AccountingSubsection));
}

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
  [ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago]: 'Mercado Pago',
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
  { id: ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago, name: 'Mercado Pago', bancarizado: true, active: true, sortOrder: 60 },
] as Array<EntityWithId<PaymentMethodDocument>>;

function getDefaultExternalReferenceProvider(referenceType: ExternalReferenceFormState['referenceType']) {
  return referenceType === 'F931' ? 'ARCA' : '';
}

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
  return paymentMethodId !== ACCOUNTING_PAYMENT_METHOD_IDS.cash
    && paymentMethodId !== ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago;
}

function getMovementPaymentReference(movement: EntityWithId<FinancialMovementDocument>): string | null {
  const value = movement.metadata?.paymentReference;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getDateInputAccountingPeriod(value: string): AccountingPeriod {
  return value.slice(0, 7) as AccountingPeriod;
}

function getDateInputDay(value: string): number {
  return Number(value.slice(8, 10));
}

function createMercadoPagoQrImageUrl(checkoutUrl: string): string {
  const params = new URLSearchParams({
    size: '260x260',
    margin: '14',
    data: checkoutUrl,
  });
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
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
      <button type="button" className="accounting-collapsible-card__header" aria-expanded={open} onClick={onToggle}>
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

function AccountingSectionToggle({
  eyebrow,
  title,
  open,
  onClick,
}: {
  eyebrow: string;
  title: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`accounting-section-toggle ${open ? 'accounting-section-toggle--open' : ''}`}
      aria-expanded={open}
      onClick={onClick}
    >
      <span>
        <small className="eyebrow">{eyebrow}</small>
        <strong>{title}</strong>
      </span>
      <span className="accounting-chevron" aria-hidden="true">
        <ChevronIcon />
      </span>
    </button>
  );
}

function MercadoPagoAdminCheckoutPanel({
  checkout,
  onClose,
}: {
  checkout: AdminMercadoPagoCheckoutState;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const qrImageUrl = checkout.checkoutUrl ? createMercadoPagoQrImageUrl(checkout.checkoutUrl) : '';

  const handleCopyCheckoutUrl = async () => {
    if (!checkout.checkoutUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(checkout.checkoutUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="floating-card mercado-pago-admin-checkout" aria-live="polite">
      <div className="mercado-pago-admin-checkout__copy">
        <p className="eyebrow">Caja online</p>
        <h2>{checkout.title}</h2>
        <p>
          El checkout queda listo para que el socio pague en el mostrador. Escanea el QR o abrí/copiale el link de
          Mercado Pago; el movimiento contable se registra cuando el webhook confirme la acreditación.
        </p>
        <div className="accounting-inline-summary">
          <span>
            {checkout.itemCount} concepto{checkout.itemCount === 1 ? '' : 's'} · Sesión {checkout.sessionId}
          </span>
          <strong>{formatCurrency(checkout.totalAmountMinor)}</strong>
        </div>
      </div>

      <div className="mercado-pago-admin-checkout__payment">
        {qrImageUrl ? (
          <img src={qrImageUrl} alt="QR para abrir el checkout de Mercado Pago" />
        ) : (
          <div className="empty-state empty-state--inline">Mercado Pago no devolvió un link para generar el QR.</div>
        )}
        <div className="accounting-inline-actions">
          {checkout.checkoutUrl && (
            <a className="btn-primary" href={checkout.checkoutUrl} target="_blank" rel="noreferrer">
              Abrir checkout
            </a>
          )}
          {checkout.checkoutUrl && (
            <button type="button" className="btn-secondary" onClick={handleCopyCheckoutUrl}>
              {copied ? 'Link copiado' : 'Copiar link'}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </section>
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

function isMemberPaymentBlocked(member: EntityWithId<MemberDocument> | null | undefined): boolean {
  return member?.status === 'inactive' || member?.status === 'suspended';
}

function timestampToDate(value: { toDate: () => Date } | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : value.toDate();
}

function getChargeTargetMemberIds(
  charge: EntityWithId<MemberFeeChargeDocument>,
  members: Array<EntityWithId<MemberDocument>>,
): Set<string> {
  const memberIds = new Set<string>();
  if (charge.memberId) {
    memberIds.add(charge.memberId);
  }
  if (charge.holderMemberId) {
    memberIds.add(charge.holderMemberId);
  }
  if (charge.familyGroupId) {
    members
      .filter((member) => member.familyGroupId === charge.familyGroupId)
      .forEach((member) => memberIds.add(member.id));
  }
  return memberIds;
}

function getMembersWithoutCurrentPeriodPayment(
  members: Array<EntityWithId<MemberDocument>>,
  periodFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>,
): Array<EntityWithId<MemberDocument>> {
  const settledMemberIds = new Set<string>();
  periodFeeCharges
    .filter((charge) => charge.status === 'paid' || charge.status === 'exempt')
    .forEach((charge) => {
      getChargeTargetMemberIds(charge, members).forEach((memberId) => settledMemberIds.add(memberId));
    });

  return members.filter((member) => member.status === 'active' && !settledMemberIds.has(member.id));
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
  pendingFeeCharges: Array<EntityWithId<MemberFeeChargeDocument>>;
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

  [...params.periodFeeCharges, ...params.pendingFeeCharges].forEach((charge) => {
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
  const [searchParams] = useSearchParams();
  const dashboardRole = getDashboardRole(user?.roleIds, interfaceMode);
  const periodNow = getCurrentAccountingPeriod();
  const requestedSection = searchParams.get('section');
  const requestedSubsection = searchParams.get('subsection');
  const requestedEntry = searchParams.get('entry');
  const [selectedPeriod, setSelectedPeriod] = useState(periodNow);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<NoticeState>(null);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<AccountingSection>('inicio');
  const [entryModal, setEntryModal] = useState<EntryModalType>(null);
  const [openAccountingSubsection, setOpenAccountingSubsection] = useState<AccountingSubsection | null>(null);
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
    pendingFeeCharges: [],
    recentMercadoPagoSessions: [],
    periodReferences: [],
    recentSalaryPayments: [],
    membersPreview: [],
    renewalMembers: [],
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
    operationDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [externalReferenceForm, setExternalReferenceForm] = useState<ExternalReferenceFormState>({
    referenceType: 'F931',
    period: periodNow,
    amountMinor: '',
    providerName: getDefaultExternalReferenceProvider('F931'),
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
  const [memberSearch, setMemberSearch] = useState('');
  const [renewalSearch, setRenewalSearch] = useState('');
  const [expenseQueueSearch, setExpenseQueueSearch] = useState('');
  const [expenseQueueStatus, setExpenseQueueStatus] = useState<'all' | 'submitted' | 'approved'>('all');
  const [selectedMercadoPagoChargeIds, setSelectedMercadoPagoChargeIds] = useState<string[]>([]);
  const [adminMercadoPagoCheckout, setAdminMercadoPagoCheckout] = useState<AdminMercadoPagoCheckoutState | null>(null);
  const [isRenewalSearchOpen, setIsRenewalSearchOpen] = useState(false);
  const [isExpenseQueueSearchOpen, setIsExpenseQueueSearchOpen] = useState(false);

  useEffect(() => {
    const querySubsection = isAccountingSubsection(requestedSubsection) ? requestedSubsection : null;
    const querySection = isAccountingSection(requestedSection)
      ? requestedSection
      : querySubsection
        ? ACCOUNTING_SUBSECTION_SECTION[querySubsection]
        : null;
    const isRestrictedSection = querySection === 'sensibles' || querySection === 'tesoreria';

    if (!querySection || (isRestrictedSection && dashboardRole !== 'directivo')) {
      return;
    }

    startTransition(() => {
      setActiveSection(querySection);

      if (querySubsection) {
        setOpenAccountingSubsection(querySubsection);
      }

      if (querySubsection === 'renewals') {
        setIsRenewalSearchOpen(true);
      }

      if (querySubsection === 'expense-queue' || querySubsection === 'employee-expenses') {
        setIsExpenseQueueSearchOpen(true);
      }

      if (requestedEntry === 'income' || requestedEntry === 'expense') {
        setEntryModal(requestedEntry);
      }
    });
  }, [dashboardRole, requestedEntry, requestedSection, requestedSubsection]);

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
      const mercadoPagoCheckoutSessionsRepository = createMercadoPagoCheckoutSessionsRepository();
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
        pendingFeeCharges,
        recentMercadoPagoSessions,
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
        memberFeeChargesRepository.listPending(250),
        mercadoPagoCheckoutSessionsRepository.listRecent(8),
        membersRepository.listDirectory(),
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
        pendingFeeCharges,
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
        pendingFeeCharges,
        recentMercadoPagoSessions,
        membersPreview,
        renewalMembers: getMembersWithoutCurrentPeriodPayment(membersPreview, periodFeeCharges),
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

    const pendingCharge = [...snapshot.pendingFeeCharges, ...snapshot.periodFeeCharges].find((charge) => {
      if (charge.status !== 'pending' && charge.status !== 'overdue') {
        return false;
      }
      const member = snapshot.memberMap[charge.memberId ?? ''] ?? snapshot.memberMap[charge.holderMemberId ?? ''];
      return !isMemberPaymentBlocked(member);
    });
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
    snapshot.memberMap,
    snapshot.pendingFeeCharges,
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
    () => {
      const configuredMethods = snapshot.paymentMethods.length > 0 ? snapshot.paymentMethods : FALLBACK_PAYMENT_METHODS;
      const configuredIds = new Set(configuredMethods.map((paymentMethod) => paymentMethod.id));
      return [
        ...configuredMethods,
        ...FALLBACK_PAYMENT_METHODS.filter((paymentMethod) => !configuredIds.has(paymentMethod.id)),
      ].sort((left, right) => left.sortOrder - right.sortOrder);
    },
    [snapshot.paymentMethods],
  );
  const manualPaymentMethodOptions = useMemo(
    () => paymentMethodOptions.filter((paymentMethod) => paymentMethod.id !== ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago),
    [paymentMethodOptions],
  );
  const payableFeeCharges = useMemo(() => {
    const chargesById = new Map<string, EntityWithId<MemberFeeChargeDocument>>();
    [...snapshot.pendingFeeCharges, ...snapshot.periodFeeCharges].forEach((charge) => {
      if (charge.status === 'pending' || charge.status === 'overdue') {
        chargesById.set(charge.id, charge);
      }
    });
    return [...chargesById.values()].sort((left, right) => left.period.localeCompare(right.period));
  }, [snapshot.pendingFeeCharges, snapshot.periodFeeCharges]);
  const pendingChargesByMemberId = useMemo(() => {
    const grouped = new Map<string, Array<EntityWithId<MemberFeeChargeDocument>>>();
    payableFeeCharges.forEach((charge) => {
      const memberId = charge.memberId ?? charge.holderMemberId ?? null;
      if (!memberId) {
        return;
      }
      grouped.set(memberId, [...(grouped.get(memberId) ?? []), charge]);
    });
    return grouped;
  }, [payableFeeCharges]);
  const filteredMembers = useMemo(() => {
    const queryText = memberSearch.trim().toLocaleLowerCase('es-AR');

    if (!queryText) {
      return snapshot.membersPreview.slice(0, 60);
    }

    return snapshot.membersPreview
      .filter((member) => {
        const haystack = `${member.lastName} ${member.firstName} ${member.memberNumber}`.toLocaleLowerCase('es-AR');
        return haystack.includes(queryText);
      })
      .slice(0, 60);
  }, [memberSearch, snapshot.membersPreview]);

  const filteredRenewalMembers = useMemo(() => {
    const queryText = renewalSearch.trim().toLocaleLowerCase('es-AR');

    if (!queryText) {
      return snapshot.renewalMembers;
    }

    return snapshot.renewalMembers.filter((member) => {
      const haystack = `${getMemberDisplayName(member)} ${member.memberNumber ?? ''}`.toLocaleLowerCase('es-AR');
      return haystack.includes(queryText);
    });
  }, [renewalSearch, snapshot.renewalMembers]);

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
    () => payableFeeCharges.find((charge) => charge.id === feePaymentForm.memberFeeChargeId) ?? null,
    [feePaymentForm.memberFeeChargeId, payableFeeCharges],
  );
  const selectedGenerateFeeMember = useMemo(
    () =>
      snapshot.membersPreview.find((member) => member.id === generateFeeForm.memberId)
      ?? snapshot.memberMap[generateFeeForm.memberId]
      ?? null,
    [generateFeeForm.memberId, snapshot.memberMap, snapshot.membersPreview],
  );
  const selectedFeeChargeMember = useMemo(() => {
    if (!selectedFeeCharge) {
      return null;
    }

    return snapshot.memberMap[selectedFeeCharge.memberId ?? ''] ?? snapshot.memberMap[selectedFeeCharge.holderMemberId ?? ''] ?? null;
  }, [selectedFeeCharge, snapshot.memberMap]);
  const selectedGenerateFeeMemberBlocked = isMemberPaymentBlocked(selectedGenerateFeeMember);
  const selectedFeeChargeMemberBlocked = isMemberPaymentBlocked(selectedFeeChargeMember);
  const feePaymentAccountingPeriod = getDateInputAccountingPeriod(feePaymentForm.operationDate);
  const feePaymentIsOutsideChargePeriod = Boolean(
    selectedFeeCharge && feePaymentAccountingPeriod !== selectedFeeCharge.period,
  );
  const feePaymentWouldApplyEarlyDiscount = Boolean(
    selectedFeeCharge &&
      !feePaymentIsOutsideChargePeriod &&
      getDateInputDay(feePaymentForm.operationDate) >= 1 &&
      getDateInputDay(feePaymentForm.operationDate) <= (snapshot.activeConfig?.earlyPaymentDiscountDayOfMonth ?? 10),
  );
  const isFeePaymentFormReady = Boolean(
    selectedFeeCharge &&
      feePaymentForm.operationDate &&
      feePaymentForm.paymentMethodId &&
      !selectedFeeChargeMemberBlocked &&
      (!requiresPaymentReference(feePaymentForm.paymentMethodId) || feePaymentForm.paymentReference.trim()),
  );
  const mercadoPagoEligibleFeeCharges = useMemo(
    () =>
      payableFeeCharges.filter((charge) => {
        const member = snapshot.memberMap[charge.memberId ?? ''] ?? snapshot.memberMap[charge.holderMemberId ?? ''];
        return !isMemberPaymentBlocked(member);
      }),
    [payableFeeCharges, snapshot.memberMap],
  );
  const selectedMercadoPagoCharges = useMemo(
    () => mercadoPagoEligibleFeeCharges.filter((charge) => selectedMercadoPagoChargeIds.includes(charge.id)),
    [mercadoPagoEligibleFeeCharges, selectedMercadoPagoChargeIds],
  );
  const selectedMercadoPagoTotalMinor = useMemo(
    () => selectedMercadoPagoCharges.reduce((total, charge) => total + charge.finalAmountMinor, 0),
    [selectedMercadoPagoCharges],
  );
  const manualIncomeAmountMinor = useMemo(
    () => parseAmountInputToMinor(manualIncomeForm.amount),
    [manualIncomeForm.amount],
  );
  const isManualIncomeFormReady = Boolean(
    manualIncomeForm.operationDate &&
      manualIncomeForm.categoryId &&
      manualIncomeForm.concept.trim() &&
      Number.isFinite(manualIncomeAmountMinor) &&
      manualIncomeAmountMinor > 0 &&
      manualIncomeForm.paymentMethodId &&
      (!requiresPaymentReference(manualIncomeForm.paymentMethodId) || manualIncomeForm.paymentReference.trim()),
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
  const filteredRecentExpenseQueue = useMemo(() => {
    const queryText = expenseQueueSearch.trim().toLocaleLowerCase('es-AR');

    return recentExpenseQueue.filter((expense) => {
      if (expenseQueueStatus !== 'all' && expense.status !== expenseQueueStatus) {
        return false;
      }

      if (!queryText) {
        return true;
      }

      const employee = snapshot.employeeMap[expense.employeeId];
      const haystack = [
        getEmployeeDisplayName(employee),
        expense.categoryCodeSnapshot,
        expense.description,
        expense.vendorName ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase('es-AR');

      return haystack.includes(queryText);
    });
  }, [expenseQueueSearch, expenseQueueStatus, recentExpenseQueue, snapshot.employeeMap]);

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
      const nextSection = activeSection === section ? 'inicio' : section;

      if (section === 'inicio') {
        setSelectedPeriod(periodNow);
        setGenerateFeeForm((current) => ({ ...current, period: periodNow }));
        setExternalReferenceForm((current) => ({ ...current, period: periodNow }));
      }

      setActiveSection(nextSection);
      setOpenAccountingSubsection(null);
    });
  };

  const toggleAccountingSubsection = (subsection: AccountingSubsection) => {
    setOpenAccountingSubsection((current) => (current === subsection ? null : subsection));
  };

  const refreshAfterAction = async (message: string) => {
    setNotice({ kind: 'success', message });
    await loadDashboard();
  };

  const showAdminMercadoPagoCheckout = async (
    checkout: CreateMercadoPagoCheckoutResult,
    details: Pick<AdminMercadoPagoCheckoutState, 'title' | 'totalAmountMinor' | 'itemCount'>,
  ) => {
    setAdminMercadoPagoCheckout({
      sessionId: checkout.sessionId,
      preferenceId: checkout.preferenceId,
      checkoutUrl: checkout.checkoutUrl,
      status: checkout.status,
      reused: checkout.reused,
      ...details,
    });
    await refreshAfterAction(
      checkout.checkoutUrl
        ? `Checkout Mercado Pago listo para cobrar en administración (${checkout.sessionId}).`
        : `Se creó la sesión Mercado Pago ${checkout.sessionId}, pero no devolvió link de pago.`,
    );
  };

  const handleGenerateCuota = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!generateFeeForm.memberId) {
      setNotice({ kind: 'error', message: 'Seleccioná un socio para generar la cuota.' });
      return;
    }

    if (selectedGenerateFeeMemberBlocked) {
      setNotice({ kind: 'error', message: 'No se pueden crear pagos nuevos para socios dados de baja o suspendidos.' });
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

    if (selectedFeeChargeMemberBlocked) {
      setNotice({ kind: 'error', message: 'No se pueden cobrar cuotas de socios dados de baja o suspendidos.' });
      return;
    }

    if (requiresPaymentReference(feePaymentForm.paymentMethodId) && !feePaymentForm.paymentReference.trim()) {
      setNotice({ kind: 'error', message: 'Ingresá una referencia para este medio de pago.' });
      return;
    }

    setSubmittingAction('register-payment');
    setNotice(null);

    try {
      if (feePaymentForm.paymentMethodId === ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago) {
        const checkout = await accountingCallables.createMercadoPagoCheckout({
          items: [
            {
              sourceType: 'member_fee_charge',
              sourceId: selectedFeeCharge.id,
            },
          ],
          notes: feePaymentForm.notes || `Checkout Mercado Pago para cuota ${selectedFeeCharge.period}.`,
        });

        await showAdminMercadoPagoCheckout(checkout, {
          title: `Cobro de cuota ${selectedFeeCharge.period}`,
          totalAmountMinor: selectedFeeCharge.finalAmountMinor,
          itemCount: 1,
        });
        return;
      }

      const result = await accountingCallables.registerPayment({
        sourceType: 'member_fee_charge',
        sourceId: selectedFeeCharge.id,
        memberId: selectedFeeCharge.memberId ?? selectedFeeCharge.holderMemberId ?? null,
        categoryId: ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria,
        paymentMethodId: feePaymentForm.paymentMethodId,
        paymentReference: feePaymentForm.paymentReference.trim() || null,
        grossAmountMinor: selectedFeeCharge.finalAmountMinor,
        operationDate: new Date(`${feePaymentForm.operationDate}T00:00:00.000-03:00`).toISOString(),
        notes: feePaymentForm.notes || null,
        metadata: {
          paymentReference: feePaymentForm.paymentReference.trim() || null,
        },
      });
      const periodHint = feePaymentIsOutsideChargePeriod
        ? ' La fecha de pago queda fuera del periodo de la cuota: se registra el cobro, pero sin pronto pago.'
        : feePaymentWouldApplyEarlyDiscount
          ? ' Se aplico pronto pago por estar dentro del periodo y antes del dia limite.'
          : '';
      await refreshAfterAction(
        result.duplicate
          ? `El pago ya estaba registrado en el movimiento ${result.movementId}.`
          : `Se registró el cobro en el movimiento ${result.movementId}.${periodHint}`,
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

  const toggleMercadoPagoCharge = (chargeId: string) => {
    setSelectedMercadoPagoChargeIds((current) =>
      current.includes(chargeId)
        ? current.filter((selectedId) => selectedId !== chargeId)
        : [...current, chargeId],
    );
  };

  const handleCreateMercadoPagoCheckout = async () => {
    if (selectedMercadoPagoCharges.length === 0) {
      setNotice({ kind: 'error', message: 'Seleccioná al menos una cuota pendiente para pagar online.' });
      return;
    }

    setSubmittingAction('mercado-pago-checkout');
    setNotice(null);

    try {
      const result = await accountingCallables.createMercadoPagoCheckout({
        items: selectedMercadoPagoCharges.map((charge) => ({
          sourceType: 'member_fee_charge',
          sourceId: charge.id,
        })),
        notes: `Checkout Mercado Pago generado desde contabilidad para ${selectedPeriod}.`,
      });

      await showAdminMercadoPagoCheckout(result, {
        title: 'Cobro agrupado de cuotas',
        totalAmountMinor: selectedMercadoPagoTotalMinor,
        itemCount: selectedMercadoPagoCharges.length,
      });
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos crear el checkout de Mercado Pago.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const openFeePaymentFormForCharge = (chargeId: string) => {
    setActiveSection('cuotas');
    setOpenAccountingSubsection('register-payment');
    setFeePaymentForm((current) => ({
      ...current,
      memberFeeChargeId: chargeId,
    }));
  };

  const handleStartRenewalPayment = async (member: EntityWithId<MemberDocument>) => {
    if (isMemberPaymentBlocked(member)) {
      setNotice({ kind: 'error', message: 'No se pueden crear ni cobrar cuotas de socios dados de baja o suspendidos.' });
      return;
    }

    const existingCharge = pendingChargesByMemberId.get(member.id)?.[0] ?? null;
    if (existingCharge) {
      openFeePaymentFormForCharge(existingCharge.id);
      setNotice({ kind: 'success', message: `Se abrio el formulario de pago para ${getMemberDisplayName(member)}.` });
      return;
    }

    setSubmittingAction(`renewal-payment-${member.id}`);
    setNotice(null);

    try {
      const result = await accountingCallables.generateCuota({
        memberId: member.id,
        period: selectedPeriod as AccountingPeriod,
        notes: `Generada desde renovaciones pendientes para ${getMemberDisplayName(member)}.`,
      });
      await refreshAfterAction(
        result.duplicate
          ? `La cuota ya existia y se reutilizo el cargo ${result.memberFeeChargeId}.`
          : `Se genero la cuota ${result.memberFeeChargeId}. Elegi el medio de pago para continuar.`,
      );
      openFeePaymentFormForCharge(result.memberFeeChargeId);
    } catch (actionError) {
      setNotice({
        kind: 'error',
        message: actionError instanceof Error ? actionError.message : 'No pudimos preparar el pago de la membresia.',
      });
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleSubmitIncome = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(manualIncomeForm.amount);

    if (!manualIncomeForm.operationDate) {
      setNotice({ kind: 'error', message: 'Elegi una fecha para el ingreso.' });
      return;
    }

    if (!manualIncomeForm.categoryId) {
      setNotice({ kind: 'error', message: 'Elegi una categoria para el ingreso.' });
      return;
    }

    if (!manualIncomeForm.concept.trim()) {
      setNotice({ kind: 'error', message: 'Agrega un concepto para el ingreso.' });
      return;
    }

    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setNotice({ kind: 'error', message: 'Ingresa un monto valido en ARS.' });
      return;
    }

    if (!manualIncomeForm.paymentMethodId) {
      setNotice({ kind: 'error', message: 'Elegi un medio de pago.' });
      return;
    }

    if (requiresPaymentReference(manualIncomeForm.paymentMethodId) && !manualIncomeForm.paymentReference.trim()) {
      setNotice({ kind: 'error', message: 'Ingresa una referencia para este medio de pago.' });
      return;
    }

    setSubmittingAction('submit-income');
    setNotice(null);

    try {
      if (manualIncomeForm.paymentMethodId === ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago) {
        const checkout = await accountingCallables.createMercadoPagoCheckout({
          items: [
            {
              sourceType: 'manual_income',
              categoryId: manualIncomeForm.categoryId,
              description: manualIncomeForm.concept.trim(),
              amountMinor,
              metadata: {
                concept: manualIncomeForm.concept.trim(),
                entryMode: 'manual',
                operationDate: manualIncomeForm.operationDate,
              },
            },
          ],
          notes: manualIncomeForm.notes || `Ingreso manual Mercado Pago: ${manualIncomeForm.concept.trim()}.`,
        });

        setEntryModal(null);
        await showAdminMercadoPagoCheckout(checkout, {
          title: manualIncomeForm.concept.trim(),
          totalAmountMinor: amountMinor,
          itemCount: 1,
        });
        return;
      }

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
      setNotice({ kind: 'error', message: 'Solo Comité Ejecutivo puede modificar sueldos.' });
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
      setNotice({ kind: 'error', message: 'Solo administración o Comité Ejecutivo puede modificar los precios de membresía.' });
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
        providerName: getDefaultExternalReferenceProvider(current.referenceType),
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
        <strong>Modificar precio de cuota societaria</strong>
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
    return <div className="empty-state">Esta sección contable solo está disponible para administración y Comité Ejecutivo.</div>;
  }

  return (
    <div className="page-container accounting-page">
      <div className="accounting-shell">
        {false && <section className="floating-card accounting-hero">
          <div className="accounting-hero__copy">
            <p className="eyebrow">{dashboardRole === 'directivo' ? 'Comité Ejecutivo' : 'Administración'}</p>
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
        {adminMercadoPagoCheckout && (
          <MercadoPagoAdminCheckoutPanel
            checkout={adminMercadoPagoCheckout}
            onClose={() => setAdminMercadoPagoCheckout(null)}
          />
        )}
        {loading && !hasDashboardData && (
          <div className="loading-state loading-state--inline accounting-loading-inline">
            <span className="loading-spinner" />
            <strong>Obteniendo datos</strong>
          </div>
        )}

        <div className={`accounting-sections-shell ${activeSection !== 'inicio' ? 'accounting-sections-shell--mobile-focused' : ''}`}>
        <section className="floating-card accounting-workbench accounting-workbench--centered accounting-sections-nav">
          <div className="accounting-section-header">
            <div>
              <p className="eyebrow">Contabilidad</p>
              <h2>Carga diaria y accesos contables</h2>
            </div>
          </div>

          <div className="accounting-section-list">
            <AccountingSectionToggle
              eyebrow="Cargar datos"
              title="Ingresos y egresos"
              open={activeSection === 'cargar'}
              onClick={() => handleSectionChange('cargar')}
            />
            <AccountingSectionToggle
              eyebrow="Movimientos financieros"
              title="Ingresos, egresos y medios de pago"
              open={activeSection === 'movimientos'}
              onClick={() => handleSectionChange('movimientos')}
            />
            <AccountingSectionToggle
              eyebrow="Cuota societaria"
              title="Precio y renovaciones"
              open={activeSection === 'cuotas'}
              onClick={() => handleSectionChange('cuotas')}
            />
            {dashboardRole === 'directivo' && (
              <AccountingSectionToggle
                eyebrow="Tesorería"
                title="Caja, bancos y conciliaciones"
                open={activeSection === 'tesoreria'}
                onClick={() => handleSectionChange('tesoreria')}
              />
            )}
            {dashboardRole === 'directivo' && (
              <AccountingSectionToggle
                eyebrow="Liquidaciones y controles sensibles"
                title="Sueldos, referencias y obligaciones"
                open={activeSection === 'sensibles'}
                onClick={() => handleSectionChange('sensibles')}
              />
            )}
            <AccountingSectionToggle
              eyebrow="Empleados y rendiciones"
              title="Recibos, gastos y horas extra"
              open={activeSection === 'empleados'}
              onClick={() => handleSectionChange('empleados')}
            />
            <Link className="accounting-section-toggle accounting-section-toggle--link" to="/accounting/reports">
              <span>
                <small className="eyebrow">Reportes</small>
                <strong>Análisis y trazabilidad</strong>
              </span>
              <span className="accounting-chevron" aria-hidden="true">
                <ChevronIcon />
              </span>
            </Link>
          </div>
        </section>

        <div className="accounting-section-content-slot">
        {activeSection !== 'inicio' && (
          <button
            type="button"
            className="ui-action-button ui-action-button--compact accounting-mobile-back"
            onClick={() => handleSectionChange('inicio')}
          >
            <span className="accounting-chevron" aria-hidden="true">
              <ChevronIcon />
            </span>
            <span>
              <small>Volver</small>
              <strong>{ACCOUNTING_SECTION_TITLES[activeSection]}</strong>
            </span>
          </button>
        )}
        {activeSection === 'inicio' && (
          <section className="accounting-section-placeholder">
            <strong>Seleccioná una sección</strong>
          </section>
        )}

        {activeSection === 'cargar' && (
          <section className="floating-card accounting-primary-panel accounting-dropdown-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Cargar datos</p>
                <h2>Ingresos y egresos</h2>
              </div>
            </div>

            <div className="accounting-subsection-stack">
              <AccountingCollapsibleCard
                title="Acciones de carga"
                description="Ingresos, egresos y cierre de caja desde un único bloque operativo."
                open={openAccountingSubsection === 'load-entries'}
                onToggle={() => toggleAccountingSubsection('load-entries')}
              >
                <div className="accounting-inline-actions accounting-inline-actions--centered">
                  <button type="button" className="ui-action-button ui-action-button--positive" onClick={() => setEntryModal('income')}>
                    Cargar ingreso
                  </button>
                  <button type="button" className="ui-action-button ui-action-button--danger" onClick={() => setEntryModal('expense')}>
                    Cargar egreso
                  </button>
                  {dashboardRole === 'administrativo' && (
                    <Link className="ui-action-button ui-action-button--secondary" to="/accounting/cash-closures">
                      Cerrar caja
                    </Link>
                  )}
                </div>
              </AccountingCollapsibleCard>
            </div>
          </section>
        )}

        {activeSection === 'cuotas' && (
          <section className="floating-card accounting-primary-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Cuota societaria</p>
                <h2>Precio base y renovaciones pendientes</h2>
              </div>
            </div>

            <div className="accounting-subsection-stack">
              <AccountingCollapsibleCard
                title="Modificar precio de cuota societaria"
                description="Precio base, descuentos por tipo de socio y nueva versión de configuración."
                open={openAccountingSubsection === 'membership-pricing'}
                onToggle={() => toggleAccountingSubsection('membership-pricing')}
              >
                {membershipPricingFormCard}
              </AccountingCollapsibleCard>

              <AccountingCollapsibleCard
                title="Renovaciones pendientes"
                description="Socios marcados por la revisión diaria porque pasaron 30 días desde el último pago."
                open={openAccountingSubsection === 'renewals'}
                onToggle={() => toggleAccountingSubsection('renewals')}
              >
                <SearchFiltersPanel
                  open={isRenewalSearchOpen}
                  onToggle={() => setIsRenewalSearchOpen((current) => !current)}
                  className="accounting-search-collapse"
                  title="Buscar renovaciones"
                  helper="Socio, numero o apellido"
                  activeCount={renewalSearch.trim() ? 1 : 0}
                  icon="B"
                  chevron="v"
                  fields={[
                    {
                      label: 'Buscar socio',
                      value: renewalSearch,
                      onChange: setRenewalSearch,
                      type: 'search',
                      placeholder: 'Nombre, apellido o numero',
                      className: 'form-field',
                    },
                  ]}
                />

                <div className="accounting-list">
                  {filteredRenewalMembers.map((member) => {
                    const pendingCharges = pendingChargesByMemberId.get(member.id) ?? [];
                    const pendingAmountMinor = pendingCharges.reduce((total, charge) => total + charge.finalAmountMinor, 0);

                    return (
                      <article key={member.id} className="accounting-row">
                        <div className="accounting-row__main">
                          <strong>{getMemberDisplayName(member)}</strong>
                          <small>
                            Vence {formatTimestamp(member.membershipRenewalDueAt)}
                            {member.lastFeePaymentAt ? ` - ultimo pago ${formatTimestamp(member.lastFeePaymentAt)}` : ' - sin pagos registrados'}
                          </small>
                          <small>
                            {pendingCharges.length > 0
                              ? `${pendingCharges.length} cuota${pendingCharges.length === 1 ? '' : 's'} pendiente${pendingCharges.length === 1 ? '' : 's'} - ${formatCurrency(pendingAmountMinor)}`
                              : `Renovacion pendiente para ${formatPeriod(selectedPeriod)}`}
                          </small>
                        </div>
                        <div className="accounting-row__meta">
                          <span className="status-chip status-chip--pending">
                            {member.membershipRenewalStatus === 'needs_renewal' ? 'Pendiente' : 'No al dia'}
                          </span>
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={submittingAction === `renewal-payment-${member.id}`}
                            onClick={() => void handleStartRenewalPayment(member)}
                          >
                            {submittingAction === `renewal-payment-${member.id}` ? 'Preparando...' : 'Pagar'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {!loading && filteredRenewalMembers.length === 0 && (
                    <div className="empty-state empty-state--inline">No hay renovaciones vencidas.</div>
                  )}
                </div>
              </AccountingCollapsibleCard>
            </div>
          </section>
        )}

        {activeSection === 'movimientos' && (
          <div className="accounting-subsection-stack">
            <section className="floating-card accounting-primary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Movimientos financieros</p>
                  <h2>Entradas y salidas del período</h2>
                </div>
              </div>

              <AccountingCollapsibleCard
                title="Movimientos financieros"
                description="Listado del período con estado, medio de pago y referencia del comprobante."
                open={openAccountingSubsection === 'movement-list'}
                onToggle={() => toggleAccountingSubsection('movement-list')}
              >
                <div className="accounting-inline-actions accounting-inline-actions--centered">
                  <button type="button" className="btn-primary" onClick={() => setEntryModal('income')}>
                    Cargar ingreso
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setEntryModal('expense')}>
                    Cargar egreso
                  </button>
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
              </AccountingCollapsibleCard>
            </section>

            <section className="floating-card accounting-secondary-panel">
              <AccountingCollapsibleCard
                title="Medios de pago operativos"
                description="Circuitos de cobro, caja chica, transferencias, crédito y débito automático."
                open={openAccountingSubsection === 'payment-methods'}
                onToggle={() => toggleAccountingSubsection('payment-methods')}
              >
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
              </AccountingCollapsibleCard>
            </section>
          </div>
        )}

        {activeSection === 'empleados' && (
          <div className="accounting-subsection-stack">
            <section className="floating-card accounting-primary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Empleados</p>
                  <h2>Legajos, recibos y horas extra</h2>
                </div>
              </div>

              <AccountingCollapsibleCard
                title="Legajos y ciclos mensuales"
                description="Acceso a la contabilidad mensual, recibos, horas extra y estado laboral."
                open={openAccountingSubsection === 'employee-list'}
                onToggle={() => toggleAccountingSubsection('employee-list')}
              >
                <div className="accounting-inline-actions accounting-inline-actions--centered">
                  <Link className="btn-secondary" to="/admin/employees">
                    Administrar empleados
                  </Link>
                </div>

                <div className="accounting-list">
                  {snapshot.employeesPreview.map((employee) => {
                    const salaryPayments = snapshot.recentSalaryPayments.filter((payment) => payment.employeeId === employee.id);
                    const overtimeMinor = salaryPayments.reduce((total, payment) => total + (payment.overtimeAmountMinor ?? 0), 0);

                    return (
                      <article key={employee.id} className="accounting-row accounting-row--actions">
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
                        <div className="accounting-inline-actions">
                          <Link className="btn-secondary" to={`/accounting/employees/${employee.id}`}>
                            Ver ciclo mensual
                          </Link>
                        </div>
                      </article>
                    );
                  })}

                  {!loading && snapshot.employeesPreview.length === 0 && (
                    <div className="empty-state empty-state--inline">No hay empleados cargados.</div>
                  )}
                </div>
              </AccountingCollapsibleCard>
            </section>

            <section className="floating-card accounting-secondary-panel">
              <AccountingCollapsibleCard
                title="Rendiciones de empleados"
                description="Recibos, gastos presentados y estado administrativo de cada comprobante."
                open={openAccountingSubsection === 'employee-expenses'}
                onToggle={() => toggleAccountingSubsection('employee-expenses')}
              >
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
              </AccountingCollapsibleCard>
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
          <div className="accounting-subsection-stack">
            <section className="floating-card accounting-primary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Acciones</p>
                  <h2>Cuotas, cobranzas y rendiciones</h2>
                </div>
              </div>

              <div className="accounting-subsection-stack">
                <AccountingCollapsibleCard
                  title="Cargar factura o compra"
                  description="Registra el gasto con responsable, rubro, proveedor y medio de pago."
                  open={openAccountingSubsection === 'expense-form'}
                  onToggle={() => toggleAccountingSubsection('expense-form')}
                >
                <form className="accounting-action-card accounting-action-card--embedded" onSubmit={handleSubmitExpense}>
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
                      {manualPaymentMethodOptions.map((paymentMethod) => (
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
                </AccountingCollapsibleCard>

                <AccountingCollapsibleCard
                  title="Generar cuota"
                  description="Emite el devengado del período sin tocar caja hasta el cobro."
                  open={openAccountingSubsection === 'generate-fee'}
                  onToggle={() => toggleAccountingSubsection('generate-fee')}
                >
                <form className="accounting-action-card accounting-action-card--embedded" onSubmit={handleGenerateCuota}>
                  <div>
                    <strong>Generar cuota</strong>
                    <p>Emití el devengado del período sin tocar caja hasta el cobro.</p>
                  </div>

                  <label className="form-field">
                    <span>Buscar socio</span>
                    <input
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      placeholder="Apellido, nombre o numero"
                    />
                  </label>

                  <label className="form-field">
                    <span>Socio</span>
                    <select
                      value={generateFeeForm.memberId}
                      onChange={(event) =>
                        setGenerateFeeForm((current) => ({ ...current, memberId: event.target.value }))
                      }
                    >
                      <option value="">Seleccionar socio</option>
                      {filteredMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {getMemberDisplayName(member)} - Socio {member.memberNumber}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedGenerateFeeMemberBlocked && (
                    <div className="error-message">
                      Este socio esta dado de baja o suspendido. Los pagos anteriores quedan registrados, pero no se
                      pueden crear cuotas nuevas.
                    </div>
                  )}

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

                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={submittingAction === 'generate-cuota' || selectedGenerateFeeMemberBlocked}
                  >
                    {submittingAction === 'generate-cuota' ? 'Generando...' : 'Generar cuota'}
                  </button>
                </form>
                </AccountingCollapsibleCard>

                <AccountingCollapsibleCard
                  title="Registrar cobro"
                  description="Toma una cuota pendiente y convierte el pago en movimiento contable."
                  open={openAccountingSubsection === 'register-payment'}
                  onToggle={() => toggleAccountingSubsection('register-payment')}
                >
                <form className="accounting-action-card accounting-action-card--embedded" onSubmit={handleRegisterPayment}>
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
                      {payableFeeCharges
                        .map((charge) => {
                          const member =
                            snapshot.memberMap[charge.memberId ?? ''] ?? snapshot.memberMap[charge.holderMemberId ?? ''];

                          if (isMemberPaymentBlocked(member)) {
                            return null;
                          }

                          return (
                            <option key={charge.id} value={charge.id}>
                              {`${getMemberDisplayName(member)} · ${formatCurrency(charge.finalAmountMinor)}`}
                            </option>
                          );
                        })}
                    </select>
                  </label>

                  {selectedFeeChargeMemberBlocked && (
                    <div className="error-message">
                      Este cargo pertenece a un socio dado de baja o suspendido. No se puede registrar un cobro nuevo.
                    </div>
                  )}

                  <label className="form-field">
                    <span>Fecha de pago</span>
                    <input
                      type="date"
                      value={feePaymentForm.operationDate}
                      onChange={(event) =>
                        setFeePaymentForm((current) => ({ ...current, operationDate: event.target.value }))
                      }
                    />
                  </label>

                  {selectedFeeCharge && (
                    <div className={feePaymentIsOutsideChargePeriod ? 'error-message' : 'accounting-success'}>
                      {feePaymentIsOutsideChargePeriod
                        ? `La fecha pertenece a ${feePaymentAccountingPeriod}, pero la cuota es de ${selectedFeeCharge.period}. Se puede cobrar igual, sin descuento por pronto pago.`
                        : feePaymentWouldApplyEarlyDiscount
                          ? 'Dentro del periodo y antes del dia limite: corresponde descuento por pronto pago.'
                          : 'Dentro del periodo, pero fuera del rango de pronto pago.'}
                    </div>
                  )}

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

                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={submittingAction === 'register-payment' || !isFeePaymentFormReady}
                  >
                    {submittingAction === 'register-payment'
                      ? feePaymentForm.paymentMethodId === ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago
                        ? 'Creando checkout...'
                        : 'Registrando...'
                      : feePaymentForm.paymentMethodId === ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago
                        ? 'Pagar con Mercado Pago'
                        : 'Registrar pago'}
                  </button>
                  {!isFeePaymentFormReady && (
                    <small className="profile-note">
                      Completa cuota, fecha, medio de pago y referencia si corresponde para habilitar el cobro.
                    </small>
                  )}
                </form>
                </AccountingCollapsibleCard>

                <AccountingCollapsibleCard
                  title="Mercado Pago online"
                  description="Permite seleccionar varias cuotas y generar un checkout agrupado."
                  open={openAccountingSubsection === 'mercado-pago'}
                  onToggle={() => toggleAccountingSubsection('mercado-pago')}
                >
                  <div className="accounting-action-card accounting-action-card--embedded">
                    <div>
                      <strong>Carrito Mercado Pago</strong>
                      <p>
                        Seleccioná uno o más cargos cobrables. La acreditación definitiva la hace el webhook y crea los
                        movimientos contables por ítem.
                      </p>
                    </div>

                    <div className="accounting-list">
                      {mercadoPagoEligibleFeeCharges.map((charge) => {
                        const member =
                          snapshot.memberMap[charge.memberId ?? ''] ?? snapshot.memberMap[charge.holderMemberId ?? ''];
                        const checked = selectedMercadoPagoChargeIds.includes(charge.id);

                        return (
                          <label key={charge.id} className="accounting-row accounting-row--selectable">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMercadoPagoCharge(charge.id)}
                            />
                            <span className="accounting-row__main">
                              <strong>{getMemberDisplayName(member)}</strong>
                              <small>
                                Cuota {formatPeriod(charge.period)}
                                {' · '}
                                {charge.status}
                              </small>
                            </span>
                            <span className="accounting-row__meta">
                              <strong>{formatCurrency(charge.finalAmountMinor)}</strong>
                            </span>
                          </label>
                        );
                      })}

                      {!loading && mercadoPagoEligibleFeeCharges.length === 0 && (
                        <div className="empty-state empty-state--inline">No hay cuotas cobrables para este período.</div>
                      )}
                    </div>

                    <div className="accounting-inline-summary">
                      <span>{selectedMercadoPagoCharges.length} ítems seleccionados</span>
                      <strong>{formatCurrency(selectedMercadoPagoTotalMinor)}</strong>
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      disabled={submittingAction === 'mercado-pago-checkout' || selectedMercadoPagoCharges.length === 0}
                      onClick={handleCreateMercadoPagoCheckout}
                    >
                      {submittingAction === 'mercado-pago-checkout' ? 'Creando checkout...' : 'Pagar con Mercado Pago'}
                    </button>
                  </div>
                </AccountingCollapsibleCard>
              </div>
            </section>

            <section className="floating-card accounting-secondary-panel">
              <AccountingCollapsibleCard
                title="Rendiciones pendientes"
                description="Cola administrativa para aprobar o postear gastos operativos."
                open={openAccountingSubsection === 'expense-queue'}
                onToggle={() => toggleAccountingSubsection('expense-queue')}
              >
                <SearchFiltersPanel
                  open={isExpenseQueueSearchOpen}
                  onToggle={() => setIsExpenseQueueSearchOpen((current) => !current)}
                  className="accounting-search-collapse"
                  rowClassName="accounting-filter-row"
                  title="Buscar rendiciones"
                  helper="Empleado, categoria, proveedor o estado"
                  activeCount={(expenseQueueSearch.trim() ? 1 : 0) + (expenseQueueStatus !== 'all' ? 1 : 0)}
                  icon="B"
                  chevron="v"
                  fields={[
                    {
                      label: 'Buscar',
                      value: expenseQueueSearch,
                      onChange: setExpenseQueueSearch,
                      type: 'search',
                      placeholder: 'Empleado, proveedor o categoria',
                      className: 'form-field',
                    },
                    {
                      label: 'Estado',
                      value: expenseQueueStatus,
                      onChange: (value) => setExpenseQueueStatus(value as 'all' | 'submitted' | 'approved'),
                      type: 'select',
                      options: [
                        { value: 'all', label: 'Todos' },
                        { value: 'submitted', label: 'Presentadas' },
                        { value: 'approved', label: 'Aprobadas' },
                      ],
                      className: 'form-field',
                    },
                  ]}
                />

                <div className="accounting-list">
                  {filteredRecentExpenseQueue.map((expense) => {
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

                  {!loading && filteredRecentExpenseQueue.length === 0 && (
                    <div className="empty-state empty-state--inline">No hay rendiciones pendientes en este momento.</div>
                  )}
                </div>
              </AccountingCollapsibleCard>
            </section>
          </div>
        )}

        {activeSection === 'tesoreria' && dashboardRole === 'directivo' && (
          <div className="accounting-subsection-stack">
            <section className="floating-card accounting-primary-panel">
              <div className="accounting-section-header">
                <div>
                  <p className="eyebrow">Tesorería</p>
                  <h2>Caja, bancos y saldos del período</h2>
                </div>
              </div>

              <AccountingCollapsibleCard
                title="Caja, bancos y saldos"
                description="Resumen del período y últimos movimientos bancarizados registrados."
                open={openAccountingSubsection === 'treasury-summary'}
                onToggle={() => toggleAccountingSubsection('treasury-summary')}
              >
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
              </AccountingCollapsibleCard>
            </section>

            <section className="floating-card accounting-secondary-panel">
              <AccountingCollapsibleCard
                title="Conciliaciones"
                description="Medios de pago, bancos, saldos, comisiones y liquidaciones del mes."
                open={openAccountingSubsection === 'treasury-settlements'}
                onToggle={() => toggleAccountingSubsection('treasury-settlements')}
              >
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

                <div className="accounting-action-card accounting-action-card--embedded">
                  <div>
                    <strong>Sesiones Mercado Pago</strong>
                    <p>Estado operativo de los checkouts online y movimientos generados por webhook.</p>
                  </div>
                  <div className="accounting-list">
                    {snapshot.recentMercadoPagoSessions.map((session) => (
                      <article key={session.id} className="accounting-row">
                        <div className="accounting-row__main">
                          <strong>{session.items.map((item) => item.description).join(' + ')}</strong>
                          <small>
                            {session.id}
                            {' · '}
                            {formatTimestamp(session.updatedAt)}
                          </small>
                        </div>
                        <div className="accounting-row__meta">
                          <span className={`status-chip status-chip--${session.status.replaceAll('_', '-')}`}>
                            {session.status}
                          </span>
                          <strong>{formatCurrency(session.grossAmountMinor)}</strong>
                          <small>{session.financialMovementIds.length} movimientos</small>
                        </div>
                      </article>
                    ))}

                    {!loading && snapshot.recentMercadoPagoSessions.length === 0 && (
                      <div className="empty-state empty-state--inline">No hay sesiones Mercado Pago recientes.</div>
                    )}
                  </div>
                </div>
              </AccountingCollapsibleCard>
            </section>
          </div>
        )}

        {activeSection === 'sensibles' && dashboardRole === 'directivo' && (
          <div className="accounting-subsection-stack">
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
                  description="Carga F931, obra social, ART u otros compromisos globales del periodo con respaldo documental."
                  open={openAccountingSubsection === 'reference'}
                  onToggle={() => toggleAccountingSubsection('reference')}
                >
                <form className="accounting-action-card accounting-action-card--embedded" onSubmit={handleRecordExternalReference}>
                  <div>
                    <strong>Registrar referencia externa</strong>
                    <p>Carga F931, obra social, ART u otros compromisos globales del periodo con respaldo documental.</p>
                  </div>

                  <label className="form-field">
                    <span>Tipo</span>
                    <select
                      value={externalReferenceForm.referenceType}
                      onChange={(event) =>
                        setExternalReferenceForm((current) => ({
                          ...current,
                          referenceType: event.target.value as ExternalReferenceFormState['referenceType'],
                          providerName: getDefaultExternalReferenceProvider(
                            event.target.value as ExternalReferenceFormState['referenceType'],
                          ),
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
                  description="Abrí la contabilidad mensual del empleado para ajustar sueldo, horas extra y liquidación."
                  open={openAccountingSubsection === 'salary'}
                  onToggle={() => toggleAccountingSubsection('salary')}
                >
                <form className="accounting-action-card accounting-action-card--embedded" onSubmit={handleUpsertSalaryConfiguration}>
                  <div>
                    <strong>Modificar sueldo desde el detalle del empleado</strong>
                    <p>Elegí un empleado y abrí su ciclo mensual para ajustar sueldo, horas extra y liquidación desde una sola pantalla.</p>
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

                  <div className="accounting-inline-actions accounting-inline-actions--centered">
                    <Link
                      className={`btn-primary ${!salaryConfigForm.employeeId ? 'btn-disabled' : ''}`}
                      to={salaryConfigForm.employeeId ? `/accounting/employees/${salaryConfigForm.employeeId}?period=${selectedPeriod}` : '#'}
                      aria-disabled={!salaryConfigForm.employeeId}
                    >
                      Ver contabilidad del empleado
                    </Link>
                  </div>

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
                  open={openAccountingSubsection === 'void'}
                  onToggle={() => toggleAccountingSubsection('void')}
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
              <AccountingCollapsibleCard
                title="Débito Macro y compromisos externos"
                description="Liquidaciones, conciliaciones y referencias externas cargadas para el período."
                open={openAccountingSubsection === 'sensitive-settlements'}
                onToggle={() => toggleAccountingSubsection('sensitive-settlements')}
              >
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
              </AccountingCollapsibleCard>
            </section>
          </div>
        )}

        {activeSection === 'sensibles' && dashboardRole === 'directivo' && (
          <section className="floating-card accounting-owner-footer">
            <AccountingCollapsibleCard
              title="Controles internos sensibles"
              description="Resumen de sueldos, referencias, movimientos bancarios y caja no bancarizada."
              open={openAccountingSubsection === 'sensitive-summary'}
              onToggle={() => toggleAccountingSubsection('sensitive-summary')}
            >
              <div className="summary-grid accounting-summary-grid">
                <SummaryCard label="Sueldos visibles" value={formatCurrency(salaryTotalMinor)} helper="Total de salary_payments del período" />
                <SummaryCard label="Referencias externas" value={`${snapshot.periodReferences.length}`} helper="F931, ART y compromisos cargados" />
                <SummaryCard label="Movimientos bancarios" value={formatCurrency(bankedTotalMinor)} helper="Base para lectura de cuenta corriente" />
                <SummaryCard label="Caja no bancarizada" value={formatCurrency(cashTotalMinor)} helper="Incluye efectivo y horas extra" />
              </div>
            </AccountingCollapsibleCard>
          </section>
        )}
        </div>
        </div>

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
                  <button type="submit" className="btn-primary" disabled={submittingAction === 'submit-income' || !isManualIncomeFormReady}>
                    {submittingAction === 'submit-income'
                      ? manualIncomeForm.paymentMethodId === ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago
                        ? 'Creando checkout...'
                        : 'Cargando...'
                      : manualIncomeForm.paymentMethodId === ACCOUNTING_PAYMENT_METHOD_IDS.mercadoPago
                        ? 'Pagar con Mercado Pago'
                        : 'Guardar ingreso'}
                  </button>
                </div>
                {!isManualIncomeFormReady && (
                  <small className="profile-note">
                    Completa fecha, categoria, concepto, monto, medio de pago y referencia si corresponde para continuar.
                  </small>
                )}
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
                    {manualPaymentMethodOptions.length === 0 && (
                      <option value={submitExpenseForm.paymentMethodId}>Sin medios configurados</option>
                    )}
                    {manualPaymentMethodOptions.map((paymentMethod) => (
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
