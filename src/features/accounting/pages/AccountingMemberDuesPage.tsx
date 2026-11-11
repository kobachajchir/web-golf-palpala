import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { ModalCloseIcon } from '../../../components/ModalCloseIcon';
import { SearchFiltersPanel } from '../../../components/SearchFiltersPanel';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import { ACCOUNTING_INCOME_CATEGORY_IDS, ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import type { AccountingPeriod, EntityWithId, FinancialConfigDocument, FinancialMovementDocument, MemberFeeChargeDocument, ReconcileMemberFeeRenewalsResult, UpsertFinancialConfigPayload } from '../../../modules/accounting/domain/models';
import type { MemberDocument } from '../../../modules/users/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createFinancialMovementsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { createMemberRegistryService } from '../../../modules/users/services/memberRegistry.service';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { AccountingMonthPicker } from '../components/AccountingMonthPicker';
import { AccountingMovementDetailModal } from '../components/AccountingMovementDetailModal';
import { ManualIncomeForm, type ManualIncomeFormSubmitPayload } from '../components/ManualIncomeForm';
import { MEMBER_FEE_RENEWAL_MIN_PERIOD } from '../api/accountingApi';
import { registerManualPayment } from '../api/memberBillingApi';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import type { AccountingNotice } from '../types/accounting';
import {
  buildArgentinaDateIso,
  formatCurrency,
  formatPeriod,
  formatTimestamp,
  getCurrentAccountingPeriod,
  getPersonDisplayName,
  normalizeAccountingPeriod,
  parseAmountInputToMinor,
  timestampToDate,
} from '../utils/accountingFormatters';
import { getFallbackIncomeCategories } from '../utils/accountingCategories';
import { buildChargesByMemberId, estimateMemberFeeDetails, getOpenFeeCharges } from '../utils/memberFeeEstimates';
import { calculateMemberFeeEarlyPaymentPreview } from '../utils/memberFeeDiscounts';

const accountingCallables = createAccountingCallables();
const DEFAULT_SERVER_MONTHLY_USD_MINOR = 6500;
const DEFAULT_SERVER_EXPENSE_DUE_DAY = 20;

function formatHolidayDateForForm(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function parseHolidayDateFromForm(value: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
  ) return null;
  return `${year}-${month}-${day}`;
}

type FeeConfigFormState = {
  fullMemberFee: string;
  familyAssociatePct: string;
  lifetimePct: string;
  minorPct: string;
  licensePct: string;
  earlyPaymentDiscountPct: string;
  memberGreenFeeWeekday: string;
  memberGreenFeeSaturdayHoliday: string;
  guestGreenFeeWeekday: string;
  guestGreenFeeSaturdayHoliday: string;
  minorGreenFeeSaturdayHolidayPct: string;
  nationalHolidayDates: string;
  serverMonthlyExpense: string;
  serverMonthlyExpenseDueDay: string;
  effectiveFrom: string;
  notes: string;
};

type RenewalPaymentFilter = 'all' | 'missing_charge' | 'pending' | 'overdue';

type RenewalPaymentLine = {
  key: string;
  chargeId?: string;
  isGeneratedCurrentPeriod: boolean;
  period: AccountingPeriod;
  typeLabel: string;
  baseAmountMinor: number;
  appliedPctBps: number;
  typeDiscountAmountMinor: number;
  subtotalMinor: number;
  earlyDiscountPctBps: number;
  earlyDiscountAmountMinor: number;
  payableAmountMinor: number;
  statusLabel: string;
};

const RENEWAL_PAYMENT_FILTER_OPTIONS: Array<{ value: RenewalPaymentFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'missing_charge', label: 'Cuota no emitida' },
  { value: 'pending', label: 'Cuota pendiente' },
  { value: 'overdue', label: 'Cuota vencida' },
];

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M10.5 4a6.5 6.5 0 0 1 5.15 10.47l4.44 4.44a1 1 0 0 1-1.42 1.42l-4.44-4.44A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
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

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1l-.7 12.1A3 3 0 0 1 15.3 22H8.7a3 3 0 0 1-3-2.9L5 7H4a1 1 0 1 1 0-2h4V4a1 1 0 0 1 1-1Zm1 2h4V4h-4v1Zm-3 2 .7 12a1 1 0 0 0 1 .97h6.6a1 1 0 0 0 1-.97L17 7H7Zm3 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z" />
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

function isAccountingPeriodValue(value: string | null | undefined): value is AccountingPeriod {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function clampRenewalPeriod(value: string | null | undefined): AccountingPeriod {
  const normalized = isAccountingPeriodValue(value)
    ? normalizeAccountingPeriod(value)
    : getCurrentAccountingPeriod();

  if (normalized < MEMBER_FEE_RENEWAL_MIN_PERIOD) {
    return MEMBER_FEE_RENEWAL_MIN_PERIOD;
  }

  if (normalized > getCurrentAccountingPeriod()) {
    return getCurrentAccountingPeriod();
  }

  return normalized;
}

function getMemberJoinedPeriod(member: EntityWithId<MemberDocument>): AccountingPeriod | null {
  const joinedAt = timestampToDate(member.joinedAt);
  if (!joinedAt) return null;
  return (String(joinedAt.getFullYear()) + '-' + String(joinedAt.getMonth() + 1).padStart(2, '0')) as AccountingPeriod;
}

function hasMemberJoinedByPeriod(member: EntityWithId<MemberDocument>, period: AccountingPeriod) {
  const joinedPeriod = getMemberJoinedPeriod(member);
  return !joinedPeriod || joinedPeriod <= period;
}

function canGenerateSelectedPeriodCharge(member: EntityWithId<MemberDocument>, period: AccountingPeriod) {
  return (member.status === 'active' || member.status === 'license')
    && !member.membershipBillingExempt
    && hasMemberJoinedByPeriod(member, period);
}

function getOutstandingFeeChargeAmountMinor(charge: EntityWithId<MemberFeeChargeDocument>) {
  const paidClubAmountMinor = charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0;
  return charge.remainingAmountMinor
    ?? Math.max((charge.settlementAmountMinor ?? charge.finalAmountMinor) - paidClubAmountMinor, 0);
}

function hasFixedFeeSettlement(charge: EntityWithId<MemberFeeChargeDocument>) {
  if (typeof charge.settlementAmountMinor !== 'number') return false;

  const paidClubAmountMinor = charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0;
  return paidClubAmountMinor > 0
    || charge.settlementAmountMinor !== charge.finalAmountMinor
    || (charge.paymentDiscountAmountMinor ?? 0) > 0;
}

function getMemberStatusLabel(member: EntityWithId<MemberDocument>) {
  switch (member.status) {
    case 'active':
      return 'Activo';
    case 'license':
      return 'Con licencia';
    case 'inactive':
      return 'Inactivo';
    case 'suspended':
      return 'Suspendido';
    default:
      return member.status;
  }
}

function canCollectRenewal(member: EntityWithId<MemberDocument>) {
  return member.status !== 'suspended';
}

function canCancelAutomaticRenewal(member: EntityWithId<MemberDocument>) {
  return member.status === 'active' || member.status === 'license';
}

function toDateInput(config: EntityWithId<FinancialConfigDocument> | null) {
  const date = timestampToDate(config?.effectiveFrom);
  return date ? date.toISOString().slice(0, 10) : todayInputValue();
}

function formatBps(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Sin dato';
  }

  return `${(value / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
}

function parsePercentToBps(value: string) {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
}

function formatUsdMinor(value: number | null | undefined) {
  const normalized = value && value > 0 ? value : DEFAULT_SERVER_MONTHLY_USD_MINOR;
  return `USD ${(normalized / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}


function getPaymentDateDay(paymentDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ? Number(paymentDate.slice(8, 10)) : Number.NaN;
}


function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function buildCurrentPeriodChargeMap(
  members: Array<EntityWithId<MemberDocument>>,
  charges: Array<EntityWithId<MemberFeeChargeDocument>>,
) {
  return buildChargesByMemberId(members, charges);
}

function getRenewalState(charges: Array<EntityWithId<MemberFeeChargeDocument>> | undefined) {
  if (!charges || charges.length === 0) {
    return {
      filter: 'missing_charge' as RenewalPaymentFilter,
      label: 'Pendiente del periodo',
      helper: 'La renovacion sigue pendiente hasta registrar pago o baja',
    };
  }

  if (charges.some((charge) => charge.status === 'overdue')) {
    return {
      filter: 'overdue' as RenewalPaymentFilter,
      label: 'Cuota vencida',
      helper: 'Pendiente de pago del mes seleccionado',
    };
  }

  if (charges.some((charge) => charge.status === 'pending')) {
    return {
      filter: 'pending' as RenewalPaymentFilter,
      label: 'Cuota pendiente',
      helper: 'Pendiente de pago del mes seleccionado',
    };
  }

  return {
    filter: 'pending' as RenewalPaymentFilter,
    label: 'Revisar cuota',
    helper: 'La cuota no figura pagada para este mes',
  };
}

function getRenewalRowStatusLabel(member: EntityWithId<MemberDocument>, state: ReturnType<typeof getRenewalState>) {
  if (member.status === 'suspended') return 'Solo consulta';
  if (member.status === 'inactive') return 'Deuda historica';
  return state.label;
}

function getRenewalRowStatusClass(member: EntityWithId<MemberDocument>, state: ReturnType<typeof getRenewalState>) {
  if (member.status === 'suspended') return 'voided';
  if (member.status === 'inactive') return 'overdue';
  return state.filter.replace('_', '-');
}

function getReconciliationSourceDescription(
  source: ReconcileMemberFeeRenewalsResult['repairs'][number]['source'],
) {
  switch (source) {
    case 'payment_allocation':
      return 'El movimiento ya indicaba expresamente la cuota a la que correspondia.';
    case 'origin_charge':
      return 'El movimiento estaba vinculado a la cuota de origen.';
    case 'period_member':
      return 'La coincidencia se resolvio por socio, periodo e importe.';
    case 'fully_paid_total':
      return 'La suma de los movimientos vinculados cubre completamente la cuota.';
    default:
      return 'Se encontro una coincidencia contable sin ambiguedades.';
  }
}

function configToForm(config: EntityWithId<FinancialConfigDocument> | null): FeeConfigFormState {
  return {
    fullMemberFee: config ? String(config.fullMemberFeeMinor / 100).replace('.', ',') : '',
    familyAssociatePct: config ? String(config.familyAssociatePctBps / 100).replace('.', ',') : '',
    lifetimePct: config ? String(config.lifetimePctBps / 100).replace('.', ',') : '',
    minorPct: config ? String(config.minorPctBps / 100).replace('.', ',') : '',
    licensePct: config ? String(config.licensePctBps / 100).replace('.', ',') : '',
    earlyPaymentDiscountPct: config ? String((config.earlyPaymentDiscountPctBps ?? 0) / 100).replace('.', ',') : '0',
    memberGreenFeeWeekday: String((config?.memberGreenFeeWeekdayMinor ?? 1_000_000) / 100).replace('.', ','),
    memberGreenFeeSaturdayHoliday: String((config?.memberGreenFeeSaturdayHolidayMinor ?? 2_000_000) / 100).replace('.', ','),
    guestGreenFeeWeekday: String((config?.guestGreenFeeWeekdayMinor ?? 1_000_000) / 100).replace('.', ','),
    guestGreenFeeSaturdayHoliday: String((config?.guestGreenFeeSaturdayHolidayMinor ?? 2_000_000) / 100).replace('.', ','),
    minorGreenFeeSaturdayHolidayPct: String((config?.minorGreenFeeSaturdayHolidayPctBps ?? 5_000) / 100).replace('.', ','),
    nationalHolidayDates: (config?.nationalHolidayDates ?? []).map(formatHolidayDateForForm).join('\n'),
    serverMonthlyExpense: config?.serverMonthlyExpenseMinor ? String(config.serverMonthlyExpenseMinor / 100).replace('.', ',') : '65',
    serverMonthlyExpenseDueDay: String(config?.serverMonthlyExpenseDueDay ?? DEFAULT_SERVER_EXPENSE_DUE_DAY),
    effectiveFrom: toDateInput(config),
    notes: '',
  };
}

function buildPayloadFromForm(
  config: EntityWithId<FinancialConfigDocument>,
  form: FeeConfigFormState,
): UpsertFinancialConfigPayload | string {
  const fullMemberFeeMinor = parseAmountInputToMinor(form.fullMemberFee);
  const familyAssociatePctBps = parsePercentToBps(form.familyAssociatePct);
  const lifetimePctBps = parsePercentToBps(form.lifetimePct);
  const minorPctBps = parsePercentToBps(form.minorPct);
  const licensePctBps = parsePercentToBps(form.licensePct);
  const earlyPaymentDiscountPctBps = parsePercentToBps(form.earlyPaymentDiscountPct);
  const memberGreenFeeWeekdayMinor = parseAmountInputToMinor(form.memberGreenFeeWeekday);
  const memberGreenFeeSaturdayHolidayMinor = parseAmountInputToMinor(form.memberGreenFeeSaturdayHoliday);
  const guestGreenFeeWeekdayMinor = parseAmountInputToMinor(form.guestGreenFeeWeekday);
  const guestGreenFeeSaturdayHolidayMinor = parseAmountInputToMinor(form.guestGreenFeeSaturdayHoliday);
  const minorGreenFeeSaturdayHolidayPctBps = parsePercentToBps(form.minorGreenFeeSaturdayHolidayPct);
  const holidayDateEntries = form.nationalHolidayDates.split(/\r?\n|[,;]+/).map((value) => value.trim()).filter(Boolean);
  const parsedHolidayDates = holidayDateEntries.map(parseHolidayDateFromForm);
  const nationalHolidayDates = [...new Set(parsedHolidayDates.filter((date): date is string => Boolean(date)))].sort();
  const serverMonthlyExpenseMinor = parseAmountInputToMinor(form.serverMonthlyExpense);
  const serverMonthlyExpenseDueDay = Number(form.serverMonthlyExpenseDueDay);

  if (!Number.isFinite(fullMemberFeeMinor) || fullMemberFeeMinor <= 0) {
    return 'Ingresa un valor de cuota socio pleno mayor a cero.';
  }

  const percentages = [familyAssociatePctBps, lifetimePctBps, minorPctBps, licensePctBps];
  if (percentages.some((value) => !Number.isFinite(value) || value < 0 || value > 10000)) {
    return 'Los porcentajes de cuota deben estar entre 0 y 100.';
  }

  if (!Number.isFinite(earlyPaymentDiscountPctBps) || earlyPaymentDiscountPctBps < 0 || earlyPaymentDiscountPctBps > 1000) {
    return 'El descuento por pago temprano debe estar entre 0 y 10%.';
  }

  const greenFeeAmounts = [memberGreenFeeWeekdayMinor, memberGreenFeeSaturdayHolidayMinor, guestGreenFeeWeekdayMinor, guestGreenFeeSaturdayHolidayMinor];
  if (greenFeeAmounts.some((value) => !Number.isFinite(value) || value < 0)) {
    return 'Los valores de green fee deben ser importes validos.';
  }
  if (!Number.isFinite(minorGreenFeeSaturdayHolidayPctBps) || minorGreenFeeSaturdayHolidayPctBps < 0 || minorGreenFeeSaturdayHolidayPctBps > 10000) {
    return 'El porcentaje de green fee para menores debe estar entre 0 y 100.';
  }
  if (parsedHolidayDates.some((date) => date === null)) {
    return 'Los feriados deben escribirse como DD-MM-AAAA, uno por linea.';
  }

  if (!form.effectiveFrom) {
    return 'Selecciona la fecha efectiva del cambio.';
  }
  if (!Number.isFinite(serverMonthlyExpenseMinor) || serverMonthlyExpenseMinor < 0) {
    return 'Ingresa un gasto fijo de servidor valido.';
  }
  if (!Number.isInteger(serverMonthlyExpenseDueDay) || serverMonthlyExpenseDueDay < 1 || serverMonthlyExpenseDueDay > 28) {
    return 'El vencimiento del servidor debe ser un dia entre 1 y 28.';
  }

  return {
    effectiveFrom: buildArgentinaDateIso(form.effectiveFrom),
    fullMemberFeeMinor,
    familyAssociatePctBps,
    lifetimePctBps,
    minorPctBps,
    licensePctBps,
    maxLicenseMonths: config.maxLicenseMonths,
    creditCommissionPctBps: config.creditCommissionPctBps,
    earlyPaymentDiscountPctBps,
    earlyPaymentDiscountDayOfMonth: 10,
    familyGroupBillingMode: config.familyGroupBillingMode,
    allowStandaloneMinor: config.allowStandaloneMinor,
    membershipChargePersistenceMode: config.membershipChargePersistenceMode,
    greenFeeAppliesToMembers: config.greenFeeAppliesToMembers,
    memberGreenFeeWeekdayMinor,
    memberGreenFeeSaturdayHolidayMinor,
    guestGreenFeeWeekdayMinor,
    guestGreenFeeSaturdayHolidayMinor,
    minorGreenFeeSaturdayHolidayPctBps,
    nationalHolidayDates,
    cantineroContractMode: config.cantineroContractMode,
    advertisingDefaultPeriodicity: config.advertisingDefaultPeriodicity,
    requireApprovalForExpensePosting: config.requireApprovalForExpensePosting,
    requireApprovalForOvertimePosting: config.requireApprovalForOvertimePosting,
    serverMonthlyExpenseMinor,
    serverMonthlyExpenseDueDay,
    notes: form.notes.trim() || null,
  };
}

export function AccountingMemberDuesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { interfaceMode } = useAuth();
  const rawRenewalPeriodParam = searchParams.get('period');
  const requestedRenewalPeriod = clampRenewalPeriod(rawRenewalPeriodParam);
  const {
    period: selectedPeriod, setPeriod: setSelectedPeriod, summary, loading, error, reload,
  } = useAccountingSummary(requestedRenewalPeriod);
  const activeConfig = summary?.activeConfig ?? null;
  const [form, setForm] = useState<FeeConfigFormState>(() => configToForm(null));
  const [pendingPayload, setPendingPayload] = useState<UpsertFinancialConfigPayload | null>(null);
  const [pendingCancelMember, setPendingCancelMember] = useState<EntityWithId<MemberDocument> | null>(null);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [saving, setSaving] = useState(false);
  const [renewalSearch, setRenewalSearch] = useState('');
  const [renewalPaymentFilter, setRenewalPaymentFilter] = useState<RenewalPaymentFilter>('all');
  const [isRenewalFiltersOpen, setIsRenewalFiltersOpen] = useState(true);
  const [renewalPaymentMember, setRenewalPaymentMember] = useState<EntityWithId<MemberDocument> | null>(null);
  const [selectedRenewalLineKeys, setSelectedRenewalLineKeys] = useState<string[]>([]);
  const [renewalApplyEarlyPaymentDiscount, setRenewalApplyEarlyPaymentDiscount] = useState(false);
  const [renewalSettleAsFinalAmount, setRenewalSettleAsFinalAmount] = useState(false);
  const [reconciliationPeriod, setReconciliationPeriod] = useState(() => todayInputValue().slice(0, 7) as AccountingPeriod);
  const [reconciliationResult, setReconciliationResult] = useState<ReconcileMemberFeeRenewalsResult | null>(null);
  const [reconcilingRenewals, setReconcilingRenewals] = useState(false);
  const [reconciliationApplyPending, setReconciliationApplyPending] = useState(false);
  const [reconciliationMarkPaidPending, setReconciliationMarkPaidPending] = useState(false);
  const [selectedReconciliationMovement, setSelectedReconciliationMovement] = useState<EntityWithId<FinancialMovementDocument> | null>(null);
  const [openingReconciliationMovementId, setOpeningReconciliationMovementId] = useState<string | null>(null);
  const [showRepairsList, setShowRepairsList] = useState(false);
  const [showSkippedList, setShowSkippedList] = useState(false);
  const memberRegistry = useMemo(() => createMemberRegistryService(), []);
  const canConfigure = interfaceMode === ROLES.DIRECTIVO || interfaceMode === ROLES.ADMINISTRATIVO;
  const canConfigureSensitive = interfaceMode === ROLES.DIRECTIVO || interfaceMode === ROLES.ADMINISTRATIVO;
  const canCancelSubscription = interfaceMode === ROLES.DIRECTIVO || interfaceMode === ROLES.ADMINISTRATIVO;
  const tabParam = searchParams.get('tab');
  const initialOpenId = tabParam === 'renewals'
    ? 'renewals'
    : tabParam === 'config' || tabParam === 'membership-fee'
      ? 'config'
      : undefined;

  useEffect(() => {
    if (rawRenewalPeriodParam !== requestedRenewalPeriod) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('period', requestedRenewalPeriod);
      setSearchParams(nextParams, { replace: true });
    }

    if (selectedPeriod !== requestedRenewalPeriod) {
      setSelectedPeriod(requestedRenewalPeriod);
      setReconciliationPeriod(requestedRenewalPeriod);
      setReconciliationResult(null);
    }
  }, [rawRenewalPeriodParam, requestedRenewalPeriod, searchParams, selectedPeriod, setSearchParams, setSelectedPeriod]);

  useEffect(() => {
    if (activeConfig) {
      setForm(configToForm(activeConfig));
    }
  }, [activeConfig]);

  useEffect(() => {
    if (summary?.period) {
      setReconciliationPeriod(summary.period);
      setReconciliationResult(null);
    }
  }, [summary?.period]);

  useEffect(() => {
    if (!renewalPaymentMember) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setRenewalPaymentMember(null);
      setSelectedRenewalLineKeys([]);
      setRenewalApplyEarlyPaymentDiscount(false);
      setRenewalSettleAsFinalAmount(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [renewalPaymentMember]);

  const currentPeriodChargeByMemberId = useMemo(
    () => buildCurrentPeriodChargeMap(summary?.membersPreview ?? [], summary?.periodFeeCharges ?? []),
    [summary?.membersPreview, summary?.periodFeeCharges],
  );
  const pendingChargesByMemberId = useMemo(
    () => buildCurrentPeriodChargeMap(
      summary?.membersPreview ?? [],
      getOpenFeeCharges([...(summary?.periodFeeCharges ?? []), ...(summary?.pendingFeeCharges ?? [])]),
    ),
    [summary?.membersPreview, summary?.pendingFeeCharges, summary?.periodFeeCharges],
  );
  const membersById = useMemo(
    () => new Map((summary?.membersPreview ?? []).map((member) => [member.id, member])),
    [summary?.membersPreview],
  );

  const handleRenewalPeriodChange = (period: AccountingPeriod) => {
    const nextPeriod = clampRenewalPeriod(period);
    setSelectedPeriod(nextPeriod);
    setReconciliationPeriod(nextPeriod);
    setReconciliationResult(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('period', nextPeriod);
    nextParams.set('tab', 'renewals');
    setSearchParams(nextParams, { replace: true });
  };

  const getDiagnosticMemberName = (
    memberId: string | null,
    memberName?: string | null,
    memberNumber?: string | null,
  ) => {
    if (memberName) return `${memberName}${memberNumber ? ` - Socio ${memberNumber}` : ''}`;
    if (!memberId) return 'Socio no identificado';
    const member = membersById.get(memberId);
    return member
      ? `${getPersonDisplayName(member)} - Socio ${member.memberNumber}`
      : 'Socio no encontrado en el padron';
  };

  const buildRenewalPaymentDraft = (
    member: EntityWithId<MemberDocument>,
    paymentDate = todayInputValue(),
    forceEarlyPaymentDiscount?: boolean,
  ) => {
    const selectedSummaryPeriod = summary?.period;
    const openCharges = pendingChargesByMemberId.get(member.id) ?? [];
    const hasSelectedPeriodOpenCharge = selectedSummaryPeriod
      ? openCharges.some((charge) => charge.period === selectedSummaryPeriod)
      : false;
    const canGenerateSelectedCharge = selectedSummaryPeriod
      ? canGenerateSelectedPeriodCharge(member, selectedSummaryPeriod)
      : false;
    const missingChargeDetails = canGenerateSelectedCharge ? estimateMemberFeeDetails(member, activeConfig) : null;
    const existingLines: RenewalPaymentLine[] = openCharges.map((charge) => {
      const paidClubAmountMinor = charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0;
      const outstandingAmountMinor = getOutstandingFeeChargeAmountMinor(charge);
      const settlementLocked = hasFixedFeeSettlement(charge);
      const earlyPayment = settlementLocked
        ? { discountPctBps: 0, discountAmountMinor: 0, payableAmountMinor: outstandingAmountMinor }
        : calculateMemberFeeEarlyPaymentPreview({
            amountMinor: outstandingAmountMinor,
            period: charge.period,
            paymentDate,
            config: activeConfig,
            ...(forceEarlyPaymentDiscount !== undefined ? { forceDiscount: forceEarlyPaymentDiscount } : {}),
          });
      return {
        key: charge.id,
        chargeId: charge.id,
        isGeneratedCurrentPeriod: false,
        period: charge.period,
        typeLabel: charge.memberTypeCodeSnapshot || member.typeCodeSnapshot,
        baseAmountMinor: settlementLocked ? outstandingAmountMinor : charge.baseAmountMinor,
        appliedPctBps: settlementLocked ? 10_000 : charge.appliedPctBps,
        typeDiscountAmountMinor: settlementLocked ? 0 : Math.max(charge.baseAmountMinor - charge.finalAmountMinor, 0),
        subtotalMinor: outstandingAmountMinor,
        earlyDiscountPctBps: earlyPayment.discountPctBps,
        earlyDiscountAmountMinor: earlyPayment.discountAmountMinor,
        payableAmountMinor: earlyPayment.payableAmountMinor,
        statusLabel: settlementLocked
          ? (charge.status === 'overdue' ? 'Vencida con saldo' : 'Pendiente con saldo')
          : charge.status === 'overdue' ? 'Vencida' : 'Pendiente',
      };
    });
    const generatedEarlyPayment = selectedSummaryPeriod && missingChargeDetails
      ? calculateMemberFeeEarlyPaymentPreview({
          amountMinor: missingChargeDetails.finalAmountMinor,
          period: selectedSummaryPeriod,
          paymentDate,
          config: activeConfig,
          ...(forceEarlyPaymentDiscount !== undefined ? { forceDiscount: forceEarlyPaymentDiscount } : {}),
        })
      : null;
    const generatedLine: RenewalPaymentLine[] = !hasSelectedPeriodOpenCharge && selectedSummaryPeriod && missingChargeDetails && generatedEarlyPayment
      ? [
          {
            key: member.id + '-' + selectedSummaryPeriod + '-generated',
            isGeneratedCurrentPeriod: true,
            period: selectedSummaryPeriod,
            typeLabel: member.typeCodeSnapshot,
            baseAmountMinor: missingChargeDetails.baseAmountMinor,
            appliedPctBps: missingChargeDetails.appliedPctBps,
            typeDiscountAmountMinor: missingChargeDetails.typeDiscountAmountMinor,
            subtotalMinor: missingChargeDetails.finalAmountMinor,
            earlyDiscountPctBps: generatedEarlyPayment.discountPctBps,
            earlyDiscountAmountMinor: generatedEarlyPayment.discountAmountMinor,
            payableAmountMinor: generatedEarlyPayment.payableAmountMinor,
            statusLabel: 'A generar',
          },
        ]
      : [];
    const lines = [...existingLines, ...generatedLine];
    return {
      openCharges,
      needsCurrentPeriodCharge: canGenerateSelectedCharge && !hasSelectedPeriodOpenCharge,
      lines,
      conceptCount: lines.length,
      amountMinor: lines.reduce((total, line) => total + line.payableAmountMinor, 0),
      subtotalMinor: lines.reduce((total, line) => total + line.subtotalMinor, 0),
      earlyDiscountTotalMinor: lines.reduce((total, line) => total + line.earlyDiscountAmountMinor, 0),
      typeDiscountTotalMinor: lines.reduce((total, line) => total + line.typeDiscountAmountMinor, 0),
    };
  };

  const filteredRenewalMembers = useMemo(() => {
    const query = normalizeSearchText(renewalSearch);
    return (summary?.renewalMembers ?? []).filter((member) => {
      const charges = currentPeriodChargeByMemberId.get(member.id);
      const state = getRenewalState(charges);
      if (renewalPaymentFilter !== 'all' && state.filter !== renewalPaymentFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = normalizeSearchText(
        [
          getPersonDisplayName(member),
          member.memberNumber,
          member.dni,
          member.typeCodeSnapshot,
          member.status,
          state.label,
        ]
          .filter(Boolean)
          .join(' '),
      );
      return searchable.includes(query);
    });
  }, [currentPeriodChargeByMemberId, renewalPaymentFilter, renewalSearch, summary?.renewalMembers]);

  const renewalFilterCount = Number(renewalSearch.trim().length > 0) + Number(renewalPaymentFilter !== 'all');
  const serverConfigIncomplete =
    !activeConfig
    || !activeConfig.serverMonthlyExpenseMinor
    || activeConfig.serverMonthlyExpenseMinor <= 0
    || !activeConfig.serverMonthlyExpenseDueDay;

  const updateForm = (field: keyof FeeConfigFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmitConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canConfigure) {
      setNotice({ kind: 'error', message: 'No tenes permisos para editar cuota societaria.' });
      return;
    }
    if (!activeConfig) {
      setNotice({ kind: 'error', message: 'No hay una configuracion activa para versionar.' });
      return;
    }

    const payload = buildPayloadFromForm(activeConfig, form);
    if (typeof payload === 'string') {
      setNotice({ kind: 'error', message: payload });
      return;
    }

    setPendingPayload(payload);
  };

  const confirmSaveConfig = async () => {
    if (!pendingPayload) {
      return;
    }

    setSaving(true);
    try {
      const result = await accountingCallables.upsertFinancialConfig(pendingPayload);
      setNotice({ kind: 'success', message: `Cuota societaria version ${result.version} guardada.` });
      setPendingPayload(null);
      await reload();
    } catch (saveError) {
      setNotice({ kind: 'error', message: saveError instanceof Error ? saveError.message : 'No pudimos guardar la cuota societaria.' });
    } finally {
      setSaving(false);
    }
  };

  const runRenewalReconciliation = async (execute: boolean, markFullyPaidOnly = false) => {
    if (!canConfigure) {
      setNotice({ kind: 'error', message: 'No tenes permisos para revisar la sincronizacion de cuotas.' });
      return;
    }
    if (execute && !canConfigureSensitive) {
      setNotice({ kind: 'error', message: 'Solo el Comite Ejecutivo puede aplicar la sincronizacion.' });
      return;
    }

    setReconcilingRenewals(true);
    try {
      const result = await accountingCallables.reconcileMemberFeeRenewals({
        period: reconciliationPeriod,
        execute,
        markFullyPaidOnly,
      });
      setReconciliationResult(result);
      setReconciliationApplyPending(false);
      setReconciliationMarkPaidPending(false);
      setNotice({
        kind: result.ambiguousCount > 0 ? 'info' : 'success',
        message: execute
          ? markFullyPaidOnly
            ? 'Cierre aplicado: ' + result.repairedChargeCount + ' cuota(s) pasaron a pagadas.'
            : 'Sincronizacion aplicada: ' + result.repairedChargeCount + ' cuota(s) actualizada(s).'
          : 'Revision completada: ' + result.repairedChargeCount + ' cuota(s) para sincronizar.',
      });
      if (execute) await reload();
    } catch (reconciliationError) {
      setNotice({
        kind: 'error',
        message: reconciliationError instanceof Error
          ? reconciliationError.message
          : 'No pudimos sincronizar movimientos y renovaciones.',
      });
    } finally {
      setReconcilingRenewals(false);
    }
  };

  const openReconciliationMovement = async (movementId: string) => {
    setOpeningReconciliationMovementId(movementId);
    try {
      const movement = await createFinancialMovementsRepository().getById(movementId);
      if (!movement) {
        setNotice({ kind: 'error', message: 'No se encontro el movimiento contable seleccionado.' });
        return;
      }
      setSelectedReconciliationMovement(movement);
    } catch (movementError) {
      setNotice({
        kind: 'error',
        message: movementError instanceof Error ? movementError.message : 'No pudimos abrir el detalle del movimiento.',
      });
    } finally {
      setOpeningReconciliationMovementId(null);
    }
  };

  const confirmCancelSubscription = async () => {
    if (!pendingCancelMember) {
      return;
    }

    setSaving(true);
    try {
      await memberRegistry.deactivateMember(pendingCancelMember.id);
      setNotice({ kind: 'success', message: `Suscripcion mensual de ${getPersonDisplayName(pendingCancelMember)} cancelada. El socio quedo inactivo para proximas renovaciones.` });
      setPendingCancelMember(null);
      await reload();
    } catch (cancelError) {
      setNotice({ kind: 'error', message: cancelError instanceof Error ? cancelError.message : 'No pudimos cancelar la suscripcion.' });
    } finally {
      setSaving(false);
    }
  };

  const handleOpenRenewalPayment = (member: EntityWithId<MemberDocument>) => {
    if (!canCollectRenewal(member)) {
      setNotice({ kind: 'info', message: 'El socio suspendido queda disponible solo para consulta. No se puede cobrar desde Renovaciones.' });
      return;
    }

    const today = todayInputValue();
    const currentDay = getPaymentDateDay(today);
    const defaultApplyDiscount = summary?.period === today.slice(0, 7)
      && currentDay >= 1
      && currentDay <= (activeConfig?.earlyPaymentDiscountDayOfMonth ?? 10);
    const draft = buildRenewalPaymentDraft(member, today, defaultApplyDiscount ? undefined : false);
    setRenewalApplyEarlyPaymentDiscount(defaultApplyDiscount);
    const initialLineKeys = member.status === 'inactive'
      ? draft.lines.map((line) => line.key)
      : draft.lines
          .filter((line) => line.period === summary?.period)
          .map((line) => line.key);
    setSelectedRenewalLineKeys(initialLineKeys);
    setRenewalSettleAsFinalAmount(false);
    setRenewalPaymentMember(member);
  };

  const closeRenewalPaymentModal = () => {
    setRenewalPaymentMember(null);
    setSelectedRenewalLineKeys([]);
    setRenewalApplyEarlyPaymentDiscount(false);
    setRenewalSettleAsFinalAmount(false);
  };

  const toggleRenewalLine = (lineKey: string) => {
    setSelectedRenewalLineKeys((current) => (
      current.includes(lineKey)
        ? current.filter((key) => key !== lineKey)
        : [...current, lineKey]
    ));
  };

  const handleRenewalPaymentSubmit = async (payload: ManualIncomeFormSubmitPayload) => {
    if (!renewalPaymentMember || !summary?.period) {
      return;
    }
    if (!payload.paymentMethodId) {
      throw new Error('Selecciona un medio de pago.');
    }
    if (payload.paymentMethodId !== ACCOUNTING_PAYMENT_METHOD_IDS.cash && !payload.paymentReference.trim()) {
      throw new Error('Ingresa una referencia para este medio de pago.');
    }

    const draft = buildRenewalPaymentDraft(renewalPaymentMember, payload.operationDate, renewalApplyEarlyPaymentDiscount);
    const selectedLines = draft.lines.filter((line) => selectedRenewalLineKeys.includes(line.key));
    const selectedAmountMinor = selectedLines.reduce((total, line) => total + line.payableAmountMinor, 0);
    if (selectedLines.length === 0 || selectedAmountMinor <= 0) {
      throw new Error('Selecciona al menos una cuota para cobrar.');
    }
    if (payload.amountMinor <= 0 || (!willSettleRenewalAsFinalAmount && payload.amountMinor > selectedAmountMinor)) {
      throw new Error('El pago parcial debe ser mayor a cero y no superar el total seleccionado.');
    }

    try {
      const periodAllocations: Array<{ period: AccountingPeriod; amountMinor: number; settlementAmountMinor?: number }> = [];
      let remainingPaymentMinor = payload.amountMinor;
      const allocationAmountsByChargeId: Record<string, number> = {};
      const settlementAmountsByChargeId: Record<string, number> = {};
      if (willSettleRenewalAsFinalAmount) {
        const line = selectedLines[0];
        const chargeId = line?.chargeId ?? null;
        if (chargeId) {
          allocationAmountsByChargeId[chargeId] = payload.amountMinor;
          settlementAmountsByChargeId[chargeId] = payload.amountMinor;
          remainingPaymentMinor = 0;
        } else if (line?.isGeneratedCurrentPeriod) {
          periodAllocations.push({
            period: line.period,
            amountMinor: payload.amountMinor,
            settlementAmountMinor: payload.amountMinor,
          });
          remainingPaymentMinor = 0;
        }
      } else {
        for (const line of selectedLines) {
          if (remainingPaymentMinor <= 0) break;
          const appliedAmountMinor = Math.min(remainingPaymentMinor, line.payableAmountMinor);
          if (appliedAmountMinor <= 0) continue;
          if (line.chargeId) {
            allocationAmountsByChargeId[line.chargeId] = appliedAmountMinor;
          } else if (line.isGeneratedCurrentPeriod) {
            periodAllocations.push({ period: line.period, amountMinor: appliedAmountMinor });
          }
          remainingPaymentMinor -= appliedAmountMinor;
        }
      }
      const openItemIds = Object.keys(allocationAmountsByChargeId);
      if ((openItemIds.length === 0 && periodAllocations.length === 0) || remainingPaymentMinor > 0) {
        setNotice({ kind: 'error', message: 'No se pudo distribuir el pago entre las cuotas seleccionadas.' });
        return;
      }

      const receipt = await registerManualPayment({
        memberId: renewalPaymentMember.id,
        openItemIds,
        paymentMethodId: payload.paymentMethodId,
        paymentDate: payload.operationDate,
        reference: payload.paymentReference,
        amount: payload.amountMinor,
        allocationAmountsByChargeId,
        settlementAmountsByChargeId,
        periodAllocations,
        applyEarlyPaymentDiscount: renewalApplyEarlyPaymentDiscount,
        notes: payload.notes,
      });
      setNotice({
        kind: 'success',
        message: `Cobro registrado por ${formatCurrency(receipt.totalAmountMinor)}${receipt.receiptNumbers.length ? ` con recibo ${receipt.receiptNumbers.join(', ')}` : ''}.`,
      });
      closeRenewalPaymentModal();
      await reload();
    } catch (paymentError) {
      setNotice({ kind: 'error', message: paymentError instanceof Error ? paymentError.message : 'No pudimos cobrar la renovacion.' });
    }
  };

  const renewalPaymentDraft = renewalPaymentMember
    ? buildRenewalPaymentDraft(renewalPaymentMember, todayInputValue(), renewalApplyEarlyPaymentDiscount)
    : null;
  const selectedRenewalPaymentLines = renewalPaymentDraft
    ? renewalPaymentDraft.lines.filter((line) => selectedRenewalLineKeys.includes(line.key))
    : [];
  const selectedRenewalPaymentAmountMinor = selectedRenewalPaymentLines.reduce((total, line) => total + line.payableAmountMinor, 0);
  const canSettleRenewalAsFinalAmount = selectedRenewalPaymentLines.length === 1;
  const willSettleRenewalAsFinalAmount = renewalSettleAsFinalAmount && canSettleRenewalAsFinalAmount;

  return (
    <div className="accounting-shell accounting-member-dues-page">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <h1>Cuotas societarias</h1>
        </div>
      </section>

      <AccountingInlineNotice notice={notice ?? (error ? { kind: 'error', message: error } : null)} />
      {loading && <div className="loading-state loading-state--inline"><span className="loading-spinner" /><strong>Cargando cuotas</strong></div>}

      <section className="summary-grid accounting-summary-grid accounting-member-dues-summary" aria-label="Resumen de cuotas societarias">
        <article className="summary-card"><span>Periodo</span><strong>{summary?.period ? formatPeriod(summary.period) : 'Actual'}</strong><small>Seleccionado</small></article>
        <article className="summary-card"><span>Renovaciones</span><strong>{summary?.renewalMembers.length ?? 0}</strong><small>Pendientes</small></article>
        <article className="summary-card"><span>Total abierto</span><strong>{formatCurrency(summary?.renewalPendingTotalMinor ?? 0)}</strong><small>{summary?.renewalPendingConceptCount ?? 0} conceptos</small></article>
        <article className="summary-card"><span>Cuota plena</span><strong>{activeConfig ? formatCurrency(activeConfig.fullMemberFeeMinor) : '-'}</strong><small>Valor vigente</small></article>
      </section>

      <div className="accounting-member-dues-sections">
        <AccountingCollapsibleSections
          initialOpenId={initialOpenId}
          sections={[
            {
              id: 'renewals',
              title: 'Renovaciones pendientes',
              eyebrow: 'Renovaciones',
              helper: 'Cuotas societarias pendientes por periodo',
              content: (
                <div className="accounting-full-width-section accounting-member-dues-renewals-section">
                  <div className="accounting-section-header">
                    <div>
                      <h3>Mes de la cuota</h3><UiActionButton to="/accounting/caja?tab=cobros" variant="secondary">Cobrar meses por adelantado</UiActionButton>
                      <p>Se puede revisar desde julio de 2026 hasta el mes actual.</p>
                    </div>
                    <AccountingMonthPicker
                      period={selectedPeriod}
                      minPeriod={MEMBER_FEE_RENEWAL_MIN_PERIOD}
                      maxPeriod={getCurrentAccountingPeriod()}
                      onChange={handleRenewalPeriodChange}
                    />
                  </div>
                  <SearchFiltersPanel
                    open={isRenewalFiltersOpen}
                    onToggle={() => setIsRenewalFiltersOpen((current) => !current)}
                    title="Busqueda y filtros"
                    helper="Socio, numero, DNI o estado"
                    activeCount={renewalFilterCount}
                    icon={<SearchIcon />}
                    chevron={<ChevronIcon />}
                    className="accounting-search-collapse"
                    fields={[
                      {
                        label: 'Buscar socio',
                        value: renewalSearch,
                        onChange: setRenewalSearch,
                        type: 'search',
                        placeholder: 'Nombre, numero, DNI o tipo',
                      },
                      {
                        label: 'Estado de cuota',
                        value: renewalPaymentFilter,
                        onChange: (value) => setRenewalPaymentFilter(value as RenewalPaymentFilter),
                        type: 'select',
                        options: RENEWAL_PAYMENT_FILTER_OPTIONS,
                      },
                    ]}
                  />
                  <div className="directory-results accounting-member-dues-results">
                    <strong>{filteredRenewalMembers.length} renovacion{filteredRenewalMembers.length === 1 ? '' : 'es'} pendiente{filteredRenewalMembers.length === 1 ? '' : 's'}</strong>
                  </div>
                  <div className="accounting-list accounting-renewals-list">
                    {filteredRenewalMembers.map((member) => {
                      const charges = currentPeriodChargeByMemberId.get(member.id);
                      const draft = buildRenewalPaymentDraft(member);
                      const state = getRenewalState(charges);
                      const canCollect = canCollectRenewal(member);
                      const canCancelAutomatic = canCancelAutomaticRenewal(member);
                      const rowStatusClass = getRenewalRowStatusClass(member, state);
                      const rowStatusLabel = getRenewalRowStatusLabel(member, state);

                      return (
                        <article key={member.id} className="accounting-row accounting-row--actions accounting-renewal-row">
                          <div className="accounting-row__main">
                            <strong>{getPersonDisplayName(member)}</strong>
                            <small>Socio {member.memberNumber} - {member.typeCodeSnapshot} - {getMemberStatusLabel(member)}</small>
                            <small>{draft.conceptCount > 0 ? `${draft.conceptCount} cuota${draft.conceptCount === 1 ? '' : 's'} pendiente${draft.conceptCount === 1 ? '' : 's'}` : state.helper}</small>
                          </div>
                          <div className="accounting-row__meta">
                            <span className={'status-chip status-chip--' + rowStatusClass}>{rowStatusLabel}</span>
                            {draft.amountMinor > 0 && <strong>{formatCurrency(draft.amountMinor)}</strong>}
                          </div>
                          <div className="accounting-inline-actions">
                            {canCollect ? (
                              <UiActionButton type="button" onClick={() => handleOpenRenewalPayment(member)}>
                                Cobrar
                              </UiActionButton>
                            ) : (
                              <span className="status-chip status-chip--voided">Sin cobro</span>
                            )}
                            {canCancelAutomatic && (
                              <button
                                type="button"
                                className="icon-button member-icon-button accounting-danger-icon-button"
                                aria-label={'Eliminar renovacion automatica de ' + getPersonDisplayName(member)}
                                disabled={!canCancelSubscription || saving}
                                onClick={() => setPendingCancelMember(member)}
                              >
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {!loading && filteredRenewalMembers.length === 0 && (
                      <AccountingEmptyState title="Sin renovaciones pendientes">No hay cuotas pendientes para este periodo y filtros.</AccountingEmptyState>
                    )}
                  </div>
                </div>
              ),
            },
            {
              id: 'reconciliation',
              title: 'Sincronizacion de cuotas',
              eyebrow: 'Control contable',
              helper: 'Compara movimientos de cuota con renovaciones mes a mes',
              content: (
                <div className="accounting-full-width-section accounting-renewal-reconciliation">
                  <div className="profile-note">
                    La revisión no modifica movimientos contables. Solo propone reparar cuotas con una coincidencia inequívoca por vínculo guardado o por socio y mes.
                  </div>
                  {canConfigure ? (
                    <>
                      <form
                        className="accounting-entry-form accounting-dialog-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void runRenewalReconciliation(false);
                        }}
                      >
                        <AccountingMonthPicker
                          label="Periodo a comparar"
                          period={reconciliationPeriod}
                          onChange={(period) => {
                            setReconciliationPeriod(period);
                            setReconciliationResult(null);
                          }}
                        />
                        <div className="form-actions form-actions--right">
                          <UiActionButton type="submit" variant="secondary" disabled={reconcilingRenewals}>
                            {reconcilingRenewals ? 'Revisando...' : 'Revisar periodo'}
                          </UiActionButton>
                          {canConfigureSensitive && reconciliationResult?.mode === 'dry-run' && reconciliationResult.repairedChargeCount > 0 && (
                            <UiActionButton type="button" disabled={reconcilingRenewals} onClick={() => setReconciliationApplyPending(true)}>
                              Aplicar sincronizacion
                            </UiActionButton>
                          )}
                        </div>
                      </form>
                      {reconciliationResult && (
                        <>
                          <div className="summary-grid accounting-summary-grid">
                            <article className="summary-card"><span>Movimientos de cuota</span><strong>{reconciliationResult.feeMovementCount}</strong><small>Periodo revisado</small></article>
                            <article className="summary-card"><span>Coincidencias</span><strong>{reconciliationResult.matchedAllocationCount}</strong><small>Vinculos encontrados</small></article>
                            <article className="summary-card"><span>Cuotas a reparar</span><strong>{reconciliationResult.repairedChargeCount}</strong><small>{reconciliationResult.mode === 'execute' ? 'Aplicadas' : 'Vista previa'}</small></article>
                            <article className="summary-card"><span>Requieren revision</span><strong>{reconciliationResult.ambiguousCount}</strong><small>No se modifican automaticamente</small></article>
                            <article className="summary-card"><span>Pagadas a cerrar</span><strong>{reconciliationResult.fullyPaidCandidateCount}</strong><small>Movimientos cubren el 100%</small></article>
                          </div>
                          {reconciliationResult.fullyPaidCandidates.length > 0 && (
                            <section className="accounting-full-width-section">
                              <div className="accounting-section-header">
                                <div>
                                  <h4>Cuotas completamente pagadas</h4>
                                  <p>{reconciliationResult.mode === 'execute'
                                    ? 'Estas cuotas fueron marcadas como pagadas sin modificar sus movimientos contables.'
                                    : 'Los movimientos vinculados alcanzan el importe final, pero la cuota todavia figura pendiente.'}</p>
                                </div>
                                {canConfigureSensitive && reconciliationResult.mode === 'dry-run' && (
                                  <UiActionButton type="button" disabled={reconcilingRenewals} onClick={() => setReconciliationMarkPaidPending(true)}>
                                    Pasar a pagado
                                  </UiActionButton>
                                )}
                              </div>
                              <div className="accounting-table-wrap">
                                <table className="accounting-data-table">
                                  <thead>
                                    <tr>
                                      <th>Socio</th>
                                      <th>Nro. Socio</th>
                                      <th>Periodo</th>
                                      <th>Importe cubierto</th>
                                      <th>Movimientos</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {reconciliationResult.fullyPaidCandidates.map((candidate) => (
                                      <tr key={candidate.chargeId}>
                                        <td><strong>{getDiagnosticMemberName(candidate.memberId, candidate.memberName, null)}</strong></td>
                                        <td>{candidate.memberNumber ?? '-'}</td>
                                        <td>{formatPeriod(candidate.chargePeriod)}</td>
                                        <td><strong>{formatCurrency(candidate.paidAmountMinor)}</strong></td>
                                        <td>{candidate.movementCount}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          )}
                          {reconciliationResult.repairs.length > 0 && (
                            <>
                              <div className="form-actions" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                                <UiActionButton type="button" variant="secondary" onClick={() => setShowRepairsList(!showRepairsList)}>
                                  {showRepairsList ? 'Ocultar listado de cuotas reparadas' : 'Ver listado de cuotas reparadas'}
                                </UiActionButton>
                              </div>
                              {showRepairsList && (
                                <div className="accounting-table-wrap">
                                  <table className="accounting-data-table">
                                    <thead>
                                      <tr>
                                        <th>Socio</th>
                                        <th>Nro. Socio</th>
                                        <th>Periodo</th>
                                        <th>Detalle</th>
                                        <th>Monto</th>
                                        <th>Acciones</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {reconciliationResult.repairs.map((repair) => (
                                        <tr key={repair.movementId + '-' + repair.chargeId}>
                                          <td><strong>{getDiagnosticMemberName(repair.memberId, repair.memberName, null)}</strong></td>
                                          <td>{repair.memberNumber ?? '-'}</td>
                                          <td>{formatPeriod(repair.chargePeriod)}</td>
                                          <td>
                                            <small>{getReconciliationSourceDescription(repair.source)}</small><br />
                                            <small className="status-chip status-chip--success">{repair.completed ? 'Queda pagada' : 'Pago parcial'}</small>
                                          </td>
                                          <td><strong>{formatCurrency(repair.appliedAmountMinor)}</strong></td>
                                          <td>
                                            <div className="accounting-inline-actions">
                                              <UiActionButton type="button" variant="secondary" compact disabled={openingReconciliationMovementId === repair.movementId} onClick={() => void openReconciliationMovement(repair.movementId)}>Ver movimiento</UiActionButton>
                                              <UiActionButton type="button" variant="secondary" compact disabled={openingReconciliationMovementId === repair.movementId} onClick={() => void openReconciliationMovement(repair.movementId)}>Ver recibo</UiActionButton>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          )}
                          {reconciliationResult.skipped.length > 0 && (
                            <>
                              <div className="form-actions" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                                <UiActionButton type="button" variant="secondary" onClick={() => setShowSkippedList(!showSkippedList)}>
                                  {showSkippedList ? 'Ocultar listado de revision manual' : 'Ver listado para revision manual'}
                                </UiActionButton>
                              </div>
                              {showSkippedList && (
                                <div className="accounting-table-wrap">
                                  <table className="accounting-data-table">
                                    <thead>
                                      <tr>
                                        <th>Socio</th>
                                        <th>Nro. Socio</th>
                                        <th>Motivo</th>
                                        <th>Movimiento Contable</th>
                                        <th>Acciones</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {reconciliationResult.skipped.map((item) => (
                                        <tr key={item.movementId}>
                                          <td><strong>{getDiagnosticMemberName(item.memberId, item.memberName, null)}</strong></td>
                                          <td>{item.memberNumber ?? '-'}</td>
                                          <td>{item.reason}</td>
                                          <td>{item.movementId}</td>
                                          <td>
                                            <div className="accounting-inline-actions">
                                              <UiActionButton type="button" variant="secondary" compact disabled={openingReconciliationMovementId === item.movementId} onClick={() => void openReconciliationMovement(item.movementId)}>Ver movimiento</UiActionButton>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <AccountingEmptyState title="Sin permisos">Solo Administración y el Comité Ejecutivo pueden revisar esta sincronización.</AccountingEmptyState>
                  )}
                </div>
              ),
            },
            {
              id: 'config',
              title: 'Configuracion de cuota',
              eyebrow: 'Configuracion de cuota',
              helper: 'Valor pleno, porcentajes y descuento hasta el dia 10',
              content: activeConfig ? (
                <div className="accounting-full-width-section accounting-member-dues-config-section">
                  <div className="summary-grid accounting-summary-grid accounting-pricing-summary">
                    <article className="summary-card"><span>Cuota plena</span><strong>{formatCurrency(activeConfig.fullMemberFeeMinor)}</strong><small>Cuota base vigente</small></article>
                    <article className="summary-card"><span>Vigente desde</span><strong>{formatTimestamp(activeConfig.effectiveFrom)}</strong><small>No altera historicos</small></article>
                    <article className="summary-card"><span>Pronto pago</span><strong>{formatBps(activeConfig.earlyPaymentDiscountPctBps ?? 0)}</strong><small>Hasta el dia {activeConfig.earlyPaymentDiscountDayOfMonth ?? 10}</small></article>
                    <article className="summary-card"><span>Green fee socio</span><strong>{formatCurrency(activeConfig.memberGreenFeeWeekdayMinor ?? 1_000_000)}</strong><small>Sabado/feriado {formatCurrency(activeConfig.memberGreenFeeSaturdayHolidayMinor ?? 2_000_000)}</small></article>
                    <article className="summary-card"><span>Green fee invitado</span><strong>{formatCurrency(activeConfig.guestGreenFeeWeekdayMinor ?? 1_000_000)}</strong><small>Sabado/feriado {formatCurrency(activeConfig.guestGreenFeeSaturdayHolidayMinor ?? 2_000_000)}</small></article>
                    <article className={`summary-card ${serverConfigIncomplete ? 'accounting-server-config-card--alert' : ''}`}>
                      <span>Servidor</span>
                      <strong>{formatUsdMinor(activeConfig.serverMonthlyExpenseMinor)}</strong>
                      <small>Vence dia {activeConfig.serverMonthlyExpenseDueDay ?? DEFAULT_SERVER_EXPENSE_DUE_DAY}</small>
                    </article>
                  </div>
                  {canConfigure ? (
                    <form className="accounting-entry-form accounting-pricing-form accounting-member-dues-form" onSubmit={handleSubmitConfig}>
                      <label className="form-field"><span>Valor cuota socio pleno</span><input inputMode="decimal" value={form.fullMemberFee} onChange={(event) => updateForm('fullMemberFee', event.target.value)} /></label>
                      <label className="form-field"><span>Vitalicio (%)</span><input inputMode="decimal" value={form.lifetimePct} onChange={(event) => updateForm('lifetimePct', event.target.value)} /></label>
                      <label className="form-field"><span>Menor (%)</span><input inputMode="decimal" value={form.minorPct} onChange={(event) => updateForm('minorPct', event.target.value)} /></label>
                      <label className="form-field"><span>Grupo familiar asociado (%)</span><input inputMode="decimal" value={form.familyAssociatePct} onChange={(event) => updateForm('familyAssociatePct', event.target.value)} /></label>
                      <label className="form-field"><span>Licencia (%)</span><input inputMode="decimal" value={form.licensePct} onChange={(event) => updateForm('licensePct', event.target.value)} /></label>
                      <label className="form-field">
                        <span>Descuento por pago del 1 al 10 (%)</span>
                        <select value={form.earlyPaymentDiscountPct} onChange={(event) => updateForm('earlyPaymentDiscountPct', event.target.value)}>
                          <option value="0">Sin descuento</option>
                          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                            <option key={value} value={String(value)}>{value}%</option>
                          ))}
                        </select>
                        <small>Pronto pago hasta el dia 10.</small>
                      </label>
                      <label className="form-field"><span>Green fee socio - dias comunes</span><input inputMode="decimal" value={form.memberGreenFeeWeekday} onChange={(event) => updateForm('memberGreenFeeWeekday', event.target.value)} /></label>
                      <label className="form-field"><span>Green fee socio - sabados/feriados</span><input inputMode="decimal" value={form.memberGreenFeeSaturdayHoliday} onChange={(event) => updateForm('memberGreenFeeSaturdayHoliday', event.target.value)} /></label>
                      <label className="form-field"><span>Green fee invitado - dias comunes</span><input inputMode="decimal" value={form.guestGreenFeeWeekday} onChange={(event) => updateForm('guestGreenFeeWeekday', event.target.value)} /></label>
                      <label className="form-field"><span>Green fee invitado - sabados/feriados</span><input inputMode="decimal" value={form.guestGreenFeeSaturdayHoliday} onChange={(event) => updateForm('guestGreenFeeSaturdayHoliday', event.target.value)} /></label>
                      <label className="form-field"><span>Green fee menor sabados/feriados (%)</span><input inputMode="decimal" value={form.minorGreenFeeSaturdayHolidayPct} onChange={(event) => updateForm('minorGreenFeeSaturdayHolidayPct', event.target.value)} /><small>En dias comunes el menor no abona green fee.</small></label>
                      <label className="form-field form-field--wide"><span>Feriados nacionales</span><textarea placeholder="01-01-2026&#10;25-05-2026" value={form.nationalHolidayDates} onChange={(event) => updateForm('nationalHolidayDates', event.target.value)} /><small>Una fecha por linea en formato DD-MM-AAAA.</small></label>
                      <label className="form-field">
                        <span>Gasto fijo mensual servidor (USD)</span>
                        <input inputMode="decimal" disabled={!canConfigureSensitive} value={form.serverMonthlyExpense} onChange={(event) => updateForm('serverMonthlyExpense', event.target.value)} />
                      </label>
                      <label className="form-field">
                        <span>Vencimiento servidor</span>
                        <input type="number" min="1" max="28" inputMode="numeric" disabled={!canConfigureSensitive} value={form.serverMonthlyExpenseDueDay} onChange={(event) => updateForm('serverMonthlyExpenseDueDay', event.target.value)} />
                        <small>Dia del mes para controlar la alerta contable.</small>
                      </label>
                      <label className="form-field">
                        <span>Aplica desde</span>
                        <input type="date" value={form.effectiveFrom} onChange={(event) => updateForm('effectiveFrom', event.target.value)} />
                        <small>Calcula nuevas cuotas futuras.</small>
                      </label>
                      <label className="form-field"><span>Nota de auditoria</span><textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} /></label>
                      <div className="form-actions form-actions--right">
                        <UiActionButton type="submit" disabled={saving}>
                          {saving ? 'Guardando...' : 'Guardar cuota societaria'}
                        </UiActionButton>
                      </div>
                    </form>
                  ) : null}
                </div>
              ) : (
                <AccountingEmptyState title="Sin configuracion activa">No se muestra ABM si no hay soporte de datos activo.</AccountingEmptyState>
              ),
            },
          ]}
        />
      </div>

      <ConfirmDialog
        open={Boolean(pendingPayload)}
        title="Guardar cuota societaria"
        description={
          pendingPayload
            ? `Se creara una nueva version vigente desde ${form.effectiveFrom}. Los historicos no se modifican y el descuento queda hasta el dia 10.`
            : undefined
        }
        confirmLabel="Guardar version"
        loading={saving}
        onCancel={() => setPendingPayload(null)}
        onConfirm={() => void confirmSaveConfig()}
      />
      <ConfirmDialog
        open={reconciliationApplyPending}
        title="Aplicar sincronizacion de cuotas"
        description={
          reconciliationResult
            ? 'Se actualizaran ' + reconciliationResult.repairedChargeCount + ' cuota(s) vinculadas de forma inequivoca. Los movimientos contables no se modifican.'
            : undefined
        }
        confirmLabel="Aplicar sincronizacion"
        loading={reconcilingRenewals}
        onCancel={() => setReconciliationApplyPending(false)}
        onConfirm={() => void runRenewalReconciliation(true)}
      />
      <ConfirmDialog
        open={reconciliationMarkPaidPending}
        title="Pasar cuotas completas a pagadas"
        description={
          reconciliationResult
            ? 'Se marcaran como pagadas ' + reconciliationResult.fullyPaidCandidateCount + ' cuota(s) cuyo importe esta completamente cubierto por movimientos vinculados. Los movimientos contables no se modifican.'
            : undefined
        }
        confirmLabel="Pasar a pagado"
        loading={reconcilingRenewals}
        onCancel={() => setReconciliationMarkPaidPending(false)}
        onConfirm={() => void runRenewalReconciliation(true, true)}
      />
      <ConfirmDialog
        open={Boolean(pendingCancelMember)}
        title="Eliminar renovacion automatica"
        description={
          pendingCancelMember
            ? `Al eliminar esta renovacion, ${getPersonDisplayName(pendingCancelMember)} no volvera a generar cuota societaria automatica desde el mes siguiente. Las cuotas atrasadas, cobros y movimientos ya existentes se conservan para que puedan revisarse o cobrarse aparte.`
            : undefined
        }
        confirmLabel="Eliminar renovacion"
        tone="danger"
        loading={saving}
        onCancel={() => setPendingCancelMember(null)}
        onConfirm={() => void confirmCancelSubscription()}
      />
      {selectedReconciliationMovement && (
        <AccountingMovementDetailModal
          movement={selectedReconciliationMovement}
          members={summary?.membersPreview ?? []}
          employees={summary?.employeesPreview ?? []}
          paymentMethods={summary?.paymentMethods ?? []}
          onSelectMovement={setSelectedReconciliationMovement}
          onChanged={reload}
          onClose={() => setSelectedReconciliationMovement(null)}
        />
      )}
      {renewalPaymentMember && renewalPaymentDraft && (
        <div className="modal-overlay quick-actions-modal-overlay" role="presentation">
          <section
            className="member-modal-card quick-actions-modal accounting-operation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="renewal-payment-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header quick-actions-modal__header">
              <div className="accounting-operation-modal__title-block">
                <h2 id="renewal-payment-modal-title" className="accounting-operation-modal__title">Cuotas societarias</h2>
                <strong className="accounting-operation-modal__meta">Fecha de emision del cobro: {formatTimestamp(new Date())}</strong>
              </div>
              <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={closeRenewalPaymentModal}>
                <ModalCloseIcon />
              </button>
            </div>
            <ManualIncomeForm
              incomeCategories={getFallbackIncomeCategories()}
              paymentMethods={summary?.paymentMethods ?? []}
              members={[renewalPaymentMember]}
              initialMember={renewalPaymentMember}
              payerReadOnly
              fixedAmountMinor={selectedRenewalPaymentAmountMinor}
              fixedAmountEditable
              initialDescription="Cuota societaria"
              initialNotes={`Cobro de cuota societaria ${selectedRenewalPaymentLines.map((line) => formatPeriod(line.period)).join(', ')}`.trim()}
              showHeader={false}
              showMemberDebtAction={false}
              categoryFilterIds={[ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria]}
              submitLabel="Cobrar"
              savingLabel="Cobrando..."
              onNotice={setNotice}
              onSubmitPayment={handleRenewalPaymentSubmit}
              extraDetail={(
                <section className="renewal-payment-breakdown manual-income-fee-detail form-field--wide" aria-label="Detalle del cobro">
                  <div className="renewal-payment-breakdown__header">
                    <div>
                      <strong>Detalle de cuota societaria</strong>
                      <small>Selecciona las cuotas y ajusta el monto para registrar un pago parcial o el importe final del mes</small>
                    </div>
                    <span>{formatCurrency(selectedRenewalPaymentAmountMinor)}</span>
                  </div>
                  <label className="checkbox-row renewal-payment-discount-toggle">
                    <input
                      type="checkbox"
                      checked={renewalApplyEarlyPaymentDiscount}
                      onChange={(event) => setRenewalApplyEarlyPaymentDiscount(event.target.checked)}
                    />
                    <span>
                      Aplicar descuento por pronto pago ({formatBps(activeConfig?.earlyPaymentDiscountPctBps ?? 0)})
                      <small>Solo modifica la renovacion del mes del pago; las cuotas atrasadas conservan su importe.</small>
                    </span>
                  </label>
                  <label className="checkbox-row renewal-payment-discount-toggle">
                    <input
                      type="checkbox"
                      checked={willSettleRenewalAsFinalAmount}
                      disabled={!canSettleRenewalAsFinalAmount}
                      onChange={(event) => setRenewalSettleAsFinalAmount(event.target.checked)}
                    />
                    <span>
                      Tomar este importe como monto final del mes
                      <small>Con una sola cuota seleccionada, el mes queda pagado por el importe que ingreses, aunque sea distinto del valor configurado.</small>
                    </span>
                  </label>
                  <div className="renewal-payment-selection-actions">
                    <button type="button" className="btn-secondary" onClick={() => setSelectedRenewalLineKeys(renewalPaymentDraft.lines.map((line) => line.key))}>
                      Seleccionar todo
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setSelectedRenewalLineKeys([])}>
                      Limpiar
                    </button>
                  </div>
                  {renewalPaymentDraft.lines.map((line) => (
                    <article key={line.key} className={`renewal-payment-line ${selectedRenewalLineKeys.includes(line.key) ? 'renewal-payment-line--selected' : ''}`}>
                      <label className="renewal-payment-line__selector">
                        <input
                          type="checkbox"
                          checked={selectedRenewalLineKeys.includes(line.key)}
                          onChange={() => toggleRenewalLine(line.key)}
                        />
                        <span>Cobrar esta cuota</span>
                      </label>
                      <div className="renewal-payment-line__title">
                        <div>
                          <strong>Cuota societaria {formatPeriod(line.period)}</strong>
                          <small>{line.statusLabel} - tipo {line.typeLabel}</small>
                        </div>
                        <strong>{formatCurrency(line.payableAmountMinor)}</strong>
                      </div>
                      <div className="renewal-payment-line__detail">
                        <span>Cuota base</span>
                        <strong>{formatCurrency(line.baseAmountMinor)}</strong>
                      </div>
                      {line.typeDiscountAmountMinor > 0 && (
                        <div className="renewal-payment-line__detail">
                          <span>Descuento por tipo de socio ({formatBps(10000 - line.appliedPctBps)})</span>
                          <strong>-{formatCurrency(line.typeDiscountAmountMinor)}</strong>
                        </div>
                      )}
                      <div className="renewal-payment-line__detail">
                        <span>Subtotal cuota</span>
                        <strong>{formatCurrency(line.subtotalMinor)}</strong>
                      </div>
                      {line.earlyDiscountAmountMinor > 0 && (
                        <div className="renewal-payment-line__detail renewal-payment-line__detail--early">
                          <span>Descuento por pago pronto ({formatBps(line.earlyDiscountPctBps)})</span>
                          <strong>-{formatCurrency(line.earlyDiscountAmountMinor)}</strong>
                        </div>
                      )}
                      <div className="renewal-payment-line__detail renewal-payment-line__detail--total">
                        <span>Total de esta cuota</span>
                        <strong>{formatCurrency(line.payableAmountMinor)}</strong>
                      </div>
                    </article>
                  ))}
                  <div className="renewal-payment-breakdown__total">
                    <span>Total seleccionado</span>
                    <strong>{formatCurrency(selectedRenewalPaymentAmountMinor)}</strong>
                  </div>
                </section>
              )}
            />
          </section>
        </div>
      )}
    </div>
  );
}
