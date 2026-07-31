import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { UiActionButton } from '../../../components/UiActionButton';
import { AccountingMonthPicker } from './AccountingMonthPicker';
import { ACCOUNTING_INCOME_CATEGORY_IDS, ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import type { AccountingPeriod, EntityWithId as AccountingEntityWithId, FinancialConfigDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import type { EntityWithId as TournamentEntityWithId, TournamentDocument } from '../../../modules/tournaments/domain/models';
import { listOpenTournaments } from '../../../modules/tournaments/repositories';
import type { EntityWithId as UserEntityWithId, MemberDocument } from '../../../modules/users/domain/models';
import { getMemberOpenItems, registerManualPayment } from '../api/memberBillingApi';
import type { AccountingNotice } from '../types/accounting';
import type { OpenItem, PaymentMethod } from '../types/payment';
import type { IncomeCategoryOption } from '../utils/accountingCategories';
import { buildArgentinaDateIso, formatCurrency, getPersonDisplayName, parseAmountInputToMinor, shiftAccountingPeriod } from '../utils/accountingFormatters';
import { estimateMemberFeeDetails } from '../utils/memberFeeEstimates';
import { InstallmentPlanFields, normalizePercentageInput, parsePercentageToBps } from './InstallmentPlanFields';
import { PaymentCommissionSummary } from './PaymentCommissionSummary';
import {
  PAYMENT_ACCOUNT_OPTIONS,
  calculatePaymentCommission,
  getPaymentMethodDisplayName,
  getPaymentMethodsForAccount,
  isVisiblePaymentMethod,
  type PaymentAccountId,
} from '../utils/paymentMethods';
import { calculateMemberFeeEarlyPaymentPreview } from '../utils/memberFeeDiscounts';

const accountingCallables = createAccountingCallables();
const REGISTER_PAYMENT_TIMEOUT_MS = 25000;
const MAX_FUTURE_MEMBER_FEE_PERIOD = shiftAccountingPeriod(todayInputValue().slice(0, 7) as AccountingPeriod, 24);

type IncomePeriodMode = 'month' | 'range';

export type ManualIncomeFormSubmitPayload = {
  categoryId: string;
  paymentMethodId: string;
  paymentReference: string;
  amountMinor: number;
  operationDate: string;
  notes: string;
  description: string;
  payerSearch: string;
  selectedMember: UserEntityWithId<MemberDocument> | null;
  paymentAccountId: PaymentAccountId;
  applyEarlyPaymentDiscount: boolean;
  isGuest: boolean;
  guestFirstName: string;
  guestLastName: string;
};

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function todayDisplayValue() {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
}

function formatMonthPeriodLabel(value: string) {
  const [year, month] = value.split('-');
  if (!year || !month) {
    return '';
  }

  const date = new Date(`${year}-${month}-01T00:00:00`);
  const monthLabel = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(date);
  return `Periodo mes ${monthLabel} de ${year}`;
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function getInclusiveDayCount(startDate: string, endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return 0;
  }

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end.getTime() < start.getTime()) {
    return 0;
  }

  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function buildPeriodDescription(mode: IncomePeriodMode, month: string, startDate: string, endDate: string) {
  if (mode === 'month') {
    return formatMonthPeriodLabel(month);
  }

  if (!startDate || !endDate) {
    return '';
  }

  return `Periodo del ${formatDateLabel(startDate)} al ${formatDateLabel(endDate)}`;
}

function formatBps(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '0%';
  }

  return `${(value / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
}

function amountMinorToInputValue(amountMinor: number) {
  const amount = amountMinor / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function getPaymentDateDay(paymentDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ? Number(paymentDate.slice(8, 10)) : Number.NaN;
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

export function ManualIncomeForm({
  incomeCategories,
  paymentMethods,
  members = [],
  activeConfig,
  initialMember = null,
  payerReadOnly = false,
  fixedAmountMinor,
  amountReadOnly = false,
  fixedAmountEditable = false,
  initialDescription = '',
  initialPaymentReference = '',
  initialNotes = '',
  submitLabel = 'Registrar cobro',
  savingLabel = 'Registrando...',
  extraDetail = null,
  onSubmitPayment,
  onNotice,
  onRegistered,
  showMemberDebtAction = true,
  showHeader = true,
  title = 'Cobro por categoria de ingreso',
  helperText = 'Usa las categorias contables existentes para registrar el ingreso.',
  categoryFilterIds,
  excludeCategoryIds,
  showPeriodControls = false,
}: {
  incomeCategories: IncomeCategoryOption[];
  paymentMethods: PaymentMethod[];
  members?: Array<UserEntityWithId<MemberDocument>>;
  activeConfig?: AccountingEntityWithId<FinancialConfigDocument> | null;
  initialMember?: UserEntityWithId<MemberDocument> | null;
  payerReadOnly?: boolean;
  fixedAmountMinor?: number;
  amountReadOnly?: boolean;
  fixedAmountEditable?: boolean;
  initialDescription?: string;
  initialPaymentReference?: string;
  initialNotes?: string;
  submitLabel?: string;
  savingLabel?: string;
  extraDetail?: ReactNode;
  onSubmitPayment?: (payload: ManualIncomeFormSubmitPayload) => Promise<void>;
  onNotice: (notice: AccountingNotice) => void;
  onRegistered?: () => void | Promise<void>;
  showMemberDebtAction?: boolean;
  showHeader?: boolean;
  title?: string;
  helperText?: string;
  categoryFilterIds?: string[];
  excludeCategoryIds?: string[];
  showPeriodControls?: boolean;
}) {
  const selectableIncomeCategories = useMemo(
    () => incomeCategories
      .filter((category) => !categoryFilterIds || categoryFilterIds.includes(category.id))
      .filter((category) => !excludeCategoryIds?.includes(category.id)),
    [categoryFilterIds, excludeCategoryIds, incomeCategories],
  );
  const defaultCategoryId = useMemo(
    () => selectableIncomeCategories.find((category) => category.id === ACCOUNTING_INCOME_CATEGORY_IDS.greenFee)?.id
      ?? selectableIncomeCategories[0]?.id
      ?? '',
    [selectableIncomeCategories],
  );
  const [paymentAccountId, setPaymentAccountId] = useState<PaymentAccountId>('cash');
  const baseVisiblePaymentMethods = useMemo(() => paymentMethods.filter(isVisiblePaymentMethod), [paymentMethods]);
  const initialVisiblePaymentMethods = useMemo(
    () => baseVisiblePaymentMethods.filter((method) =>
      defaultCategoryId === ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria
        || method.id !== ACCOUNTING_PAYMENT_METHOD_IDS.debitMacro,
    ),
    [baseVisiblePaymentMethods, defaultCategoryId],
  );
  const initialPaymentMethodId = getPaymentMethodsForAccount(initialVisiblePaymentMethods, 'cash')[0]?.id ?? initialVisiblePaymentMethods[0]?.id ?? '';
  const initialPayerSearch = initialMember ? `${getPersonDisplayName(initialMember)} - socio ${initialMember.memberNumber}` : '';
  const [form, setForm] = useState({
    categoryId: defaultCategoryId,
    paymentMethodId: initialPaymentMethodId,
    description: initialDescription,
    payerSearch: initialPayerSearch,
    amount: fixedAmountMinor !== undefined ? amountMinorToInputValue(fixedAmountMinor) : '',
    paymentReference: initialPaymentReference,
    notes: initialNotes,
  });
  const [saving, setSaving] = useState(false);
  const [installmentPlanEnabled, setInstallmentPlanEnabled] = useState(false);
  const [installmentCount, setInstallmentCount] = useState('2');
  const [interestEnabled, setInterestEnabled] = useState(false);
  const [interestPercentage, setInterestPercentage] = useState('0.00');
  const [applyTypeDiscount, setApplyTypeDiscount] = useState(true);
  const [applyEarlyPaymentDiscount, setApplyEarlyPaymentDiscount] = useState(false);
  const [operationDate, setOperationDate] = useState(todayInputValue);
  const [memberFeePeriod, setMemberFeePeriod] = useState(() => todayInputValue().slice(0, 7) as AccountingPeriod);
  const [settleSelectedRenewalAsFinalAmount, setSettleSelectedRenewalAsFinalAmount] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [manualGreenFeeAmount, setManualGreenFeeAmount] = useState(false);
  const [periodMode, setPeriodMode] = useState<IncomePeriodMode>('month');
  const [periodMonth, setPeriodMonth] = useState(() => todayInputValue().slice(0, 7));
  const [periodStartDate, setPeriodStartDate] = useState(todayInputValue);
  const [periodEndDate, setPeriodEndDate] = useState(todayInputValue);
  const [periodPriceByDay, setPeriodPriceByDay] = useState(false);
  const [periodDailyPrice, setPeriodDailyPrice] = useState('');
  const [lastAutoDescription, setLastAutoDescription] = useState('');
  const [openTournaments, setOpenTournaments] = useState<Array<TournamentEntityWithId<TournamentDocument>>>([]);
  const [pendingRenewals, setPendingRenewals] = useState<OpenItem[]>([]);
  const [selectedRenewalIds, setSelectedRenewalIds] = useState<string[]>([]);
  const [renewalsLoading, setRenewalsLoading] = useState(false);
  const [renewalsError, setRenewalsError] = useState('');
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [tournamentsLoading, setTournamentsLoading] = useState(false);
  const operationDateDisplay = formatDateLabel(operationDate);
  const isMemberFeeCategory = form.categoryId === ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria;
  const isGreenFeeCategory = form.categoryId === ACCOUNTING_INCOME_CATEGORY_IDS.greenFee;
  const isHandicapCategory = form.categoryId === ACCOUNTING_INCOME_CATEGORY_IDS.handicap;
  const isTournamentRegistrationCategory = form.categoryId === ACCOUNTING_INCOME_CATEGORY_IDS.tournamentRegistration;
  const selectedTournament = useMemo(
    () => openTournaments.find((tournament) => tournament.id === selectedTournamentId) ?? null,
    [openTournaments, selectedTournamentId],
  );
  const shouldShowPeriodControls = showPeriodControls && !isMemberFeeCategory && !isTournamentRegistrationCategory;
  const rangeDayCount = getInclusiveDayCount(periodStartDate, periodEndDate);
  const periodDailyPriceMinor = parseAmountInputToMinor(periodDailyPrice);
  const isPeriodPriceByDayActive = shouldShowPeriodControls && periodMode === 'range' && periodPriceByDay;
  const periodDailyTotalMinor = isPeriodPriceByDayActive && rangeDayCount > 0 && Number.isFinite(periodDailyPriceMinor)
    ? rangeDayCount * periodDailyPriceMinor
    : Number.NaN;
  const visiblePaymentMethods = useMemo(
    () => baseVisiblePaymentMethods.filter((method) => isMemberFeeCategory || method.id !== ACCOUNTING_PAYMENT_METHOD_IDS.debitMacro),
    [baseVisiblePaymentMethods, isMemberFeeCategory],
  );
  const paymentAccountOptions = useMemo(
    () => PAYMENT_ACCOUNT_OPTIONS
      .filter((option) => option.id !== 'debitMacro' || isMemberFeeCategory)
      .filter((option) => getPaymentMethodsForAccount(visiblePaymentMethods, option.id).length > 0),
    [isMemberFeeCategory, visiblePaymentMethods],
  );
  const selectablePaymentMethods = useMemo(
    () => paymentAccountOptions.some((option) => option.id === paymentAccountId)
      ? getPaymentMethodsForAccount(visiblePaymentMethods, paymentAccountId)
      : [],
    [paymentAccountId, paymentAccountOptions, visiblePaymentMethods],
  );
  const defaultPaymentMethodId = selectablePaymentMethods[0]?.id ?? visiblePaymentMethods[0]?.id ?? '';
  const selectedPaymentMethod = visiblePaymentMethods.find((method) => method.id === form.paymentMethodId) ?? null;
  const amountMinorPreview = parseAmountInputToMinor(form.amount);
  const paymentCommission = calculatePaymentCommission(
    Number.isFinite(amountMinorPreview) ? amountMinorPreview : 0,
    selectedPaymentMethod,
  );
  const selectedMember = useMemo(
    () => members.find((member) => {
      const displayName = `${getPersonDisplayName(member)} - socio ${member.memberNumber}`.toLowerCase();
      return displayName === form.payerSearch.trim().toLowerCase();
    }) ?? null,
    [form.payerSearch, members],
  );
  const shouldManageMemberFeeRenewals = isMemberFeeCategory && !onSubmitPayment;
  const billableRenewals = useMemo(() => {
    if (!shouldManageMemberFeeRenewals || !selectedMember || !activeConfig) {
      return pendingRenewals;
    }
    if (pendingRenewals.some((renewal) => renewal.period === memberFeePeriod)) {
      return pendingRenewals;
    }
    const details = estimateMemberFeeDetails(selectedMember, activeConfig);
    const amountMinor = applyTypeDiscount ? details.finalAmountMinor : details.baseAmountMinor;
    if (amountMinor <= 0) return pendingRenewals;
    return [...pendingRenewals, {
      id: `generated:${selectedMember.id}:${memberFeePeriod}`,
      kind: 'member_fee_charge' as const,
      memberId: selectedMember.id,
      period: memberFeePeriod,
      description: `Cuota societaria - ${formatMonthPeriodLabel(memberFeePeriod)}`,
      amountMinor,
      settlementLocked: false,
      isGenerated: true,
      status: 'ready' as const,
      dueLabel: 'Se crea y se paga al confirmar el cobro',
    }];
  }, [activeConfig, applyTypeDiscount, memberFeePeriod, pendingRenewals, selectedMember, shouldManageMemberFeeRenewals]);
  const pendingRenewalLines = useMemo(
    () => billableRenewals.map((renewal) => {
      const preview = renewal.settlementLocked || !renewal.period
        ? {
            discountPctBps: 0,
            discountAmountMinor: 0,
            payableAmountMinor: renewal.amountMinor,
          }
        : calculateMemberFeeEarlyPaymentPreview({
            amountMinor: renewal.amountMinor,
            period: renewal.period,
            paymentDate: operationDate,
            config: activeConfig,
          });
      const appliesManualDiscount = applyEarlyPaymentDiscount
        && renewal.period === operationDate.slice(0, 7)
        && preview.discountPctBps === 0
        && !renewal.settlementLocked;
      const manualDiscountPctBps = appliesManualDiscount ? activeConfig?.earlyPaymentDiscountPctBps ?? 0 : 0;
      const manualDiscountAmountMinor = appliesManualDiscount
        ? Math.round((renewal.amountMinor * manualDiscountPctBps) / 10000)
        : 0;
      return {
        ...renewal,
        discountPctBps: applyEarlyPaymentDiscount
          ? preview.discountPctBps || manualDiscountPctBps
          : 0,
        discountAmountMinor: applyEarlyPaymentDiscount
          ? preview.discountAmountMinor || manualDiscountAmountMinor
          : 0,
        payableAmountMinor: applyEarlyPaymentDiscount
          ? Math.max(renewal.amountMinor - (preview.discountAmountMinor || manualDiscountAmountMinor), 0)
          : renewal.amountMinor,
      };
    }),
    [activeConfig, applyEarlyPaymentDiscount, billableRenewals, operationDate],
  );
  const selectedPendingRenewalLines = useMemo(
    () => pendingRenewalLines.filter((renewal) => selectedRenewalIds.includes(renewal.id)),
    [pendingRenewalLines, selectedRenewalIds],
  );
  const selectedPendingRenewalAmountMinor = useMemo(
    () => selectedPendingRenewalLines.reduce((total, renewal) => total + renewal.payableAmountMinor, 0),
    [selectedPendingRenewalLines],
  );
  const greenFeePreview = useMemo(() => {
    if (!isGreenFeeCategory || !activeConfig) return null;
    const isSaturday = new Date(`${operationDate}T12:00:00-03:00`).getDay() === 6;
    const isHoliday = (activeConfig.nationalHolidayDates ?? []).includes(operationDate);
    const usesSaturdayHolidayPrice = isSaturday || isHoliday;
    const memberWeekdayMinor = activeConfig.memberGreenFeeWeekdayMinor ?? 1_000_000;
    const memberSaturdayHolidayMinor = activeConfig.memberGreenFeeSaturdayHolidayMinor ?? 2_000_000;
    const guestWeekdayMinor = activeConfig.guestGreenFeeWeekdayMinor ?? 1_000_000;
    const guestSaturdayHolidayMinor = activeConfig.guestGreenFeeSaturdayHolidayMinor ?? 2_000_000;
    let amountMinor: number | null = null;
    let ruleLabel = usesSaturdayHolidayPrice ? 'Sabado o feriado nacional' : 'Dia comun';
    if (isGuest) {
      amountMinor = usesSaturdayHolidayPrice ? guestSaturdayHolidayMinor : guestWeekdayMinor;
    } else if (selectedMember) {
      if (selectedMember.membershipBillingExempt) {
        amountMinor = 0;
        ruleLabel = 'Socio exento de green fee';
      } else if (selectedMember.typeId === 'menor' || selectedMember.typeCodeSnapshot === 'menor') {
        amountMinor = usesSaturdayHolidayPrice
          ? Math.round(memberSaturdayHolidayMinor * (activeConfig.minorGreenFeeSaturdayHolidayPctBps ?? 5_000) / 10_000)
          : 0;
        ruleLabel = usesSaturdayHolidayPrice ? 'Menor: 50% de sabado/feriado' : 'Menor sin cargo en dia comun';
      } else {
        amountMinor = usesSaturdayHolidayPrice ? memberSaturdayHolidayMinor : memberWeekdayMinor;
      }
    }
    return { amountMinor, isSaturday, isHoliday, usesSaturdayHolidayPrice, ruleLabel };
  }, [activeConfig, isGreenFeeCategory, isGuest, operationDate, selectedMember]);

  const memberFeePreview = useMemo(() => {
    if (!isMemberFeeCategory || !selectedMember || !activeConfig) {
      return null;
    }

    const details = estimateMemberFeeDetails(selectedMember, activeConfig);
    const typeDiscountAmountMinor = applyTypeDiscount ? details.typeDiscountAmountMinor : 0;
    const subtotalMinor = Math.max(details.baseAmountMinor - typeDiscountAmountMinor, 0);
    const earlyPayment = calculateMemberFeeEarlyPaymentPreview({
      amountMinor: subtotalMinor,
      period: memberFeePeriod,
      paymentDate: operationDate,
      config: activeConfig,
    });
    const configuredEarlyDiscountPctBps = activeConfig.earlyPaymentDiscountPctBps ?? 0;
    const canApplyEarlyPaymentDiscount = memberFeePeriod === operationDate.slice(0, 7);
    const earlyDiscountPctBps = applyEarlyPaymentDiscount && canApplyEarlyPaymentDiscount ? configuredEarlyDiscountPctBps : 0;
    const earlyDiscountAmountMinor = applyEarlyPaymentDiscount && canApplyEarlyPaymentDiscount
      ? Math.round((subtotalMinor * earlyDiscountPctBps) / 10000)
      : 0;

    return {
      ...details,
      typeDiscountAmountMinor,
      finalAmountMinor: subtotalMinor,
      earlyDiscountPctBps,
      earlyDiscountMode: earlyDiscountPctBps > 0 ? (earlyPayment.discountPctBps > 0 ? 'automatic' : 'manual') : 'none',
      earlyDiscountAmountMinor,
      payableAmountMinor: Math.max(subtotalMinor - earlyDiscountAmountMinor, 0),
      originalAppliedPctBps: details.appliedPctBps,
      typeDiscountDisabled: !applyTypeDiscount,
      earlyPaymentDiscountDisabled: !applyEarlyPaymentDiscount,
    };
  }, [activeConfig, applyEarlyPaymentDiscount, applyTypeDiscount, isMemberFeeCategory, memberFeePeriod, operationDate, selectedMember]);

  useEffect(() => {
    if (selectablePaymentMethods.length > 0) {
      return;
    }
    const nextAccount = paymentAccountOptions.find((option) => getPaymentMethodsForAccount(visiblePaymentMethods, option.id).length > 0);
    if (nextAccount && nextAccount.id !== paymentAccountId) {
      setPaymentAccountId(nextAccount.id);
    }
  }, [paymentAccountId, paymentAccountOptions, selectablePaymentMethods.length, visiblePaymentMethods]);

  useEffect(() => {
    if (paymentAccountOptions.some((option) => option.id === paymentAccountId)) {
      return;
    }
    setPaymentAccountId(paymentAccountOptions[0]?.id ?? 'cash');
  }, [paymentAccountId, paymentAccountOptions]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      categoryId: selectableIncomeCategories.some((category) => category.id === current.categoryId)
        ? current.categoryId
        : defaultCategoryId,
      paymentMethodId: selectablePaymentMethods.some((method) => method.id === current.paymentMethodId)
        ? current.paymentMethodId
        : defaultPaymentMethodId,
    }));
  }, [defaultCategoryId, defaultPaymentMethodId, selectableIncomeCategories, selectablePaymentMethods]);

  useEffect(() => {
    if (!isGreenFeeCategory || !greenFeePreview || manualGreenFeeAmount || greenFeePreview.amountMinor === null) return;
    const nextAmount = amountMinorToInputValue(greenFeePreview.amountMinor);
    setForm((current) => current.amount === nextAmount ? current : { ...current, amount: nextAmount });
  }, [greenFeePreview, isGreenFeeCategory, manualGreenFeeAmount]);

  useEffect(() => {
    if (!shouldManageMemberFeeRenewals || !selectedMember) {
      setPendingRenewals([]);
      setSelectedRenewalIds([]);
      setRenewalsError('');
      setRenewalsLoading(false);
      return undefined;
    }

    let ignore = false;
    setRenewalsLoading(true);
    setRenewalsError('');
    getMemberOpenItems(selectedMember.id)
      .then((items) => {
        if (ignore) return;
        const sorted = [...items].sort((left, right) => (left.period ?? '').localeCompare(right.period ?? ''));
        setPendingRenewals(sorted);
        setSelectedRenewalIds([]);
      })
      .catch((loadError) => {
        if (ignore) return;
        setPendingRenewals([]);
        setSelectedRenewalIds([]);
        setRenewalsError(loadError instanceof Error ? loadError.message : 'No pudimos consultar las renovaciones pendientes.');
      })
      .finally(() => {
        if (!ignore) setRenewalsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedMember, shouldManageMemberFeeRenewals]);

  useEffect(() => {
    if (!shouldManageMemberFeeRenewals || !selectedMember) return;
    const validIds = new Set(pendingRenewalLines.map((renewal) => renewal.id));
    const selectedPeriodIds = pendingRenewalLines
      .filter((renewal) => renewal.period === memberFeePeriod)
      .map((renewal) => renewal.id);
    setSelectedRenewalIds((current) => {
      const stillValid = current.filter((id) => validIds.has(id));
      if (stillValid.length > 0) return stillValid;
      return selectedPeriodIds;
    });
  }, [memberFeePeriod, pendingRenewalLines, selectedMember, shouldManageMemberFeeRenewals]);
  useEffect(() => {
    setSettleSelectedRenewalAsFinalAmount(true);
  }, [memberFeePeriod, selectedMember?.id]);


  useEffect(() => {
    const amountMinor = shouldManageMemberFeeRenewals && pendingRenewalLines.length > 0
      ? selectedPendingRenewalAmountMinor
      : memberFeePreview?.payableAmountMinor;
    if (amountMinor === undefined) {
      return;
    }

    const nextAmount = amountMinorToInputValue(amountMinor);
    setForm((current) => (current.amount === nextAmount ? current : { ...current, amount: nextAmount }));
  }, [memberFeePreview, pendingRenewalLines.length, selectedPendingRenewalAmountMinor, shouldManageMemberFeeRenewals]);

  useEffect(() => {
    if (!isMemberFeeCategory) {
      setApplyTypeDiscount(true);
      setApplyEarlyPaymentDiscount(false);
      return;
    }
    const paymentDay = getPaymentDateDay(operationDate);
    const discountDay = activeConfig?.earlyPaymentDiscountDayOfMonth ?? 10;
    setApplyEarlyPaymentDiscount(
      memberFeePeriod === operationDate.slice(0, 7) && paymentDay >= 1 && paymentDay <= discountDay,
    );
  }, [activeConfig?.earlyPaymentDiscountDayOfMonth, isMemberFeeCategory, memberFeePeriod, operationDate, selectedMember?.id]);

  useEffect(() => {
    if (!isGreenFeeCategory) {
      setIsGuest(false);
      setGuestFirstName('');
      setGuestLastName('');
      setManualGreenFeeAmount(false);
    }
  }, [isGreenFeeCategory]);

  useEffect(() => {
    if (!showPeriodControls || !isTournamentRegistrationCategory) {
      return;
    }

    let ignore = false;
    setTournamentsLoading(true);
    listOpenTournaments()
      .then((items) => {
        if (ignore) {
          return;
        }
        const availableTournaments = items.filter((tournament) => !tournament.isDeleted);
        setOpenTournaments(availableTournaments);
        setSelectedTournamentId((current) => (
          current && availableTournaments.some((tournament) => tournament.id === current)
            ? current
            : availableTournaments[0]?.id ?? ''
        ));
      })
      .catch((error) => {
        if (!ignore) {
          onNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos cargar torneos abiertos.' });
        }
      })
      .finally(() => {
        if (!ignore) {
          setTournamentsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [isTournamentRegistrationCategory, onNotice, showPeriodControls]);

  useEffect(() => {
    if (!showPeriodControls || !isHandicapCategory) {
      return;
    }
    setPeriodMode('month');
    setPeriodPriceByDay(false);
  }, [isHandicapCategory, showPeriodControls]);

  useEffect(() => {
    if (periodMode !== 'range' && periodPriceByDay) {
      setPeriodPriceByDay(false);
    }
  }, [periodMode, periodPriceByDay]);

  useEffect(() => {
    if (!showPeriodControls || !isTournamentRegistrationCategory || !selectedTournament) {
      return;
    }

    const nextAmount = amountMinorToInputValue(selectedTournament.registrationFeeMinor);
    setForm((current) => (current.amount === nextAmount ? current : { ...current, amount: nextAmount }));
  }, [isTournamentRegistrationCategory, selectedTournament, showPeriodControls]);

  useEffect(() => {
    if (!isPeriodPriceByDayActive || !Number.isFinite(periodDailyTotalMinor)) {
      return;
    }

    const nextAmount = amountMinorToInputValue(periodDailyTotalMinor);
    setForm((current) => (current.amount === nextAmount ? current : { ...current, amount: nextAmount }));
  }, [isPeriodPriceByDayActive, periodDailyTotalMinor]);

  useEffect(() => {
    if (!showPeriodControls) {
      return;
    }

    const categoryPrefix = isTournamentRegistrationCategory
      ? selectedTournament ? `Inscripcion torneo ${selectedTournament.name}` : ''
      : shouldShowPeriodControls
        ? buildPeriodDescription(periodMode, periodMonth, periodStartDate, periodEndDate)
        : '';
    const nextDescription = isHandicapCategory && categoryPrefix
      ? `Handicap - ${categoryPrefix}`
      : categoryPrefix;
    if (!nextDescription) {
      return;
    }

    setForm((current) => {
      if (current.description && current.description !== lastAutoDescription) {
        return current;
      }
      return current.description === nextDescription ? current : { ...current, description: nextDescription };
    });
    setLastAutoDescription(nextDescription);
  }, [
    isHandicapCategory,
    isTournamentRegistrationCategory,
    lastAutoDescription,
    periodEndDate,
    periodMode,
    periodMonth,
    periodStartDate,
    selectedTournament,
    shouldShowPeriodControls,
    showPeriodControls,
  ]);

  useEffect(() => {
    setForm((current) => {
      const next = {
        ...current,
        payerSearch: initialPayerSearch || current.payerSearch,
        description: initialDescription,
        paymentReference: initialPaymentReference,
        notes: initialNotes,
        amount: fixedAmountMinor !== undefined ? amountMinorToInputValue(fixedAmountMinor) : current.amount,
      };

      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [fixedAmountMinor, initialDescription, initialNotes, initialPaymentReference, initialPayerSearch]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(form.amount);
    if (shouldManageMemberFeeRenewals && !selectedMember) {
      onNotice({ kind: 'error', message: 'Selecciona el socio cuya renovacion queres cobrar.' });
      return;
    }
    if (shouldManageMemberFeeRenewals && renewalsLoading) {
      onNotice({ kind: 'error', message: 'Espera a que termine la consulta de renovaciones pendientes.' });
      return;
    }
    if (shouldManageMemberFeeRenewals && renewalsError) {
      onNotice({ kind: 'error', message: renewalsError });
      return;
    }
    if (shouldManageMemberFeeRenewals && selectedRenewalIds.length === 0) {
      onNotice({ kind: 'error', message: 'Selecciona al menos una renovacion pendiente para cobrar.' });
      return;
    }
    if (
      !form.categoryId
      || (!installmentPlanEnabled && !form.paymentMethodId)
      || !Number.isFinite(amountMinor)
      || amountMinor <= 0
    ) {
      onNotice({ kind: 'error', message: 'Completa categoria, medio de pago y monto valido.' });
      return;
    }
    const interestPctBps = interestEnabled ? parsePercentageToBps(interestPercentage) : 0;
    if (installmentPlanEnabled && (!Number.isFinite(interestPctBps) || interestPctBps < 0 || interestPctBps > 10000)) {
      onNotice({ kind: 'error', message: 'El interes debe estar entre 0 y 100%.' });
      return;
    }
    if (isGreenFeeCategory && isGuest && (!guestFirstName.trim() || !guestLastName.trim())) {
      onNotice({ kind: 'error', message: 'Ingresa nombre y apellido del invitado.' });
      return;
    }
    if (isGreenFeeCategory && !isGuest && !selectedMember) {
      onNotice({ kind: 'error', message: 'Selecciona el socio que utiliza el green fee.' });
      return;
    }
    if (isGreenFeeCategory && greenFeePreview?.amountMinor === 0 && !manualGreenFeeAmount) {
      onNotice({ kind: 'error', message: 'La regla vigente indica que este socio no debe abonar green fee en la fecha elegida.' });
      return;
    }
    if (isHandicapCategory && !selectedMember) {
      onNotice({ kind: 'error', message: 'Selecciona el socio asociado al pago AAG.' });
      return;
    }
    if (isTournamentRegistrationCategory && !selectedTournament) {
      onNotice({ kind: 'error', message: 'Selecciona un torneo con inscripcion abierta.' });
      return;
    }
    if (shouldShowPeriodControls && periodMode === 'range' && rangeDayCount <= 0) {
      onNotice({ kind: 'error', message: 'La fecha hasta no puede ser anterior a la fecha desde.' });
      return;
    }
    if (isPeriodPriceByDayActive && (!Number.isFinite(periodDailyPriceMinor) || periodDailyPriceMinor <= 0)) {
      onNotice({ kind: 'error', message: 'Ingresa un precio por dia valido.' });
      return;
    }
    let registered = false;
    setSaving(true);
    try {
      if (installmentPlanEnabled) {
        const result = await withTimeout(
          accountingCallables.createInstallmentPlan({
            movementType: 'income',
            categoryId: form.categoryId,
            baseAmountMinor: amountMinor,
            interestPctBps,
            operationDate: buildArgentinaDateIso(operationDate),
            thirdPartyType: isGuest ? 'external' : selectedMember ? 'member' : form.payerSearch.trim() ? 'external' : null,
            thirdPartyId: isGuest ? null : selectedMember?.id ?? null,
            paymentReference: form.paymentReference.trim() || null,
            notes: form.notes.trim() || form.description.trim() || null,
            metadata: {
              description: form.description.trim() || null,
              payerName: isGuest ? `${guestFirstName.trim()} ${guestLastName.trim()}` : form.payerSearch.trim() || null,
              isGuest,
              guestFirstName: isGuest ? guestFirstName.trim() : null,
              guestLastName: isGuest ? guestLastName.trim() : null,
              categoryId: form.categoryId,
              periodMonth: showPeriodControls && periodMode === 'month' ? periodMonth : null,
              periodStartDate: showPeriodControls && periodMode === 'range' ? periodStartDate : null,
              periodEndDate: showPeriodControls && periodMode === 'range' ? periodEndDate : null,
              tournamentId: selectedTournament?.id ?? null,
              tournamentName: selectedTournament?.name ?? null,
            },
          }),
          REGISTER_PAYMENT_TIMEOUT_MS,
          'La carga en cuotas no respondio a tiempo. Revisala en movimientos antes de volver a generarla.',
        );
        registered = true;
        onNotice({
          kind: 'success',
          message: `Plan de pagos parciales creado por ${formatCurrency(result.totalAmountMinor)}.`,
        });
        setForm((current) => ({ ...current, description: '', payerSearch: '', amount: '', paymentReference: '', notes: '' }));
        setInstallmentPlanEnabled(false);
        setInterestEnabled(false);
        setInterestPercentage('0.00');
        setSaving(false);
        void Promise.resolve(onRegistered?.());
        return;
      }

      const payload: ManualIncomeFormSubmitPayload = {
        categoryId: form.categoryId,
        paymentMethodId: form.paymentMethodId,
        paymentReference: form.paymentReference.trim(),
        amountMinor,
        operationDate,
        notes: form.notes.trim() || form.description.trim(),
        description: form.description.trim(),
        payerSearch: form.payerSearch.trim(),
        selectedMember,
        paymentAccountId,
        applyEarlyPaymentDiscount,
        isGuest,
        guestFirstName: guestFirstName.trim(),
        guestLastName: guestLastName.trim(),
      };

      if (shouldManageMemberFeeRenewals && selectedMember) {
        if (selectedPendingRenewalLines.length === 0) {
          throw new Error('Selecciona la cuota o el mes que queres cobrar.');
        }
        const settlesAsFinalAmount = selectedPendingRenewalLines.length === 1 && settleSelectedRenewalAsFinalAmount;
        if (!settlesAsFinalAmount && amountMinor > selectedPendingRenewalAmountMinor) {
          throw new Error('El pago parcial no puede superar el total de las renovaciones seleccionadas.');
        }
        let remainingPaymentMinor = amountMinor;
        const allocationAmountsByChargeId: Record<string, number> = {};
        const settlementAmountsByChargeId: Record<string, number> = {};
        const periodAllocations: Array<{ period: AccountingPeriod; amountMinor: number; settlementAmountMinor?: number }> = [];
        if (settlesAsFinalAmount) {
          const renewal = selectedPendingRenewalLines[0]!;
          if (renewal.isGenerated && renewal.period) {
            periodAllocations.push({
              period: renewal.period,
              amountMinor,
              settlementAmountMinor: amountMinor,
            });
          } else {
            allocationAmountsByChargeId[renewal.id] = amountMinor;
            settlementAmountsByChargeId[renewal.id] = amountMinor;
          }
          remainingPaymentMinor = 0;
        } else {
          for (const renewal of selectedPendingRenewalLines) {
            if (remainingPaymentMinor <= 0) break;
            const allocatedAmountMinor = Math.min(remainingPaymentMinor, renewal.payableAmountMinor);
            if (allocatedAmountMinor <= 0) continue;
            if (renewal.isGenerated && renewal.period) {
              periodAllocations.push({ period: renewal.period, amountMinor: allocatedAmountMinor });
            } else {
              allocationAmountsByChargeId[renewal.id] = allocatedAmountMinor;
            }
            remainingPaymentMinor -= allocatedAmountMinor;
          }
        }
        if (remainingPaymentMinor > 0) {
          throw new Error('No se pudo distribuir el pago entre las renovaciones seleccionadas.');
        }
        const receipt = await withTimeout(
          registerManualPayment({
            memberId: selectedMember.id,
            openItemIds: Object.keys(allocationAmountsByChargeId),
            paymentMethodId: payload.paymentMethodId,
            paymentDate: payload.operationDate,
            reference: payload.paymentReference,
            amount: payload.amountMinor,
            allocationAmountsByChargeId,
            settlementAmountsByChargeId,
            periodAllocations,
            applyEarlyPaymentDiscount,
            notes: payload.notes,
          }),
          REGISTER_PAYMENT_TIMEOUT_MS,
          'El cobro no respondio a tiempo. Revisalo en movimientos antes de volver a cargarlo.',
        );
        registered = true;
        onNotice({
          kind: 'success',
          message: 'Cobro de cuota societaria registrado por ' + formatCurrency(receipt.totalAmountMinor)
            + (receipt.receiptNumbers.length ? ' con recibo ' + receipt.receiptNumbers.join(', ') : '') + '.',
        });
        setForm((current) => ({ ...current, description: '', payerSearch: '', amount: '', paymentReference: '', notes: '' }));
        setPendingRenewals([]);
        setSelectedRenewalIds([]);
        setSettleSelectedRenewalAsFinalAmount(true);
        setSaving(false);
        void Promise.resolve(onRegistered?.());
        return;
      }

      if (onSubmitPayment) {
        await onSubmitPayment(payload);
        registered = true;
        setSaving(false);
        return;
      }

      const result = await withTimeout(
        accountingCallables.registerPayment({
          sourceType: isHandicapCategory ? 'handicap' : isGreenFeeCategory ? 'green_fee' : 'manual_income',
          memberId: isGuest ? null : selectedMember?.id ?? null,
          thirdPartyType: isGuest ? 'external' : selectedMember ? 'member' : form.payerSearch.trim() ? 'external' : null,
          thirdPartyId: isGuest ? null : selectedMember?.id ?? null,
          categoryId: form.categoryId,
          paymentMethodId: form.paymentMethodId,
          paymentReference: form.paymentReference.trim() || null,
          grossAmountMinor: amountMinor,
          operationDate: buildArgentinaDateIso(operationDate),
          notes: form.notes.trim() || form.description.trim() || null,
          metadata: {
            description: form.description.trim() || null,
            categoryId: form.categoryId,
            paymentAccountId,
            payerName: isGuest ? `${guestFirstName.trim()} ${guestLastName.trim()}` : form.payerSearch.trim() || null,
            ...(isGreenFeeCategory
              ? {
                  isGuest,
                  guestFirstName: isGuest ? guestFirstName.trim() : null,
                  guestLastName: isGuest ? guestLastName.trim() : null,
                  greenFeeDate: operationDate,
                  greenFeeRule: greenFeePreview?.ruleLabel ?? null,
                  greenFeeConfiguredAmountMinor: greenFeePreview?.amountMinor ?? null,
                  greenFeeManualOverride: isGuest && manualGreenFeeAmount,
                }
              : {}),
            ...(memberFeePreview
              ? {
                  memberFeeBaseAmountMinor: memberFeePreview.baseAmountMinor,
                  memberFeeTypeDiscountApplied: applyTypeDiscount,
                  memberFeeTypeDiscountAmountMinor: memberFeePreview.typeDiscountAmountMinor,
                  memberFeeEarlyPaymentDiscountApplied: applyEarlyPaymentDiscount,
                  memberFeeEarlyPaymentDiscountAmountMinor: memberFeePreview.earlyDiscountAmountMinor,
                }
              : {}),
            ...(showPeriodControls
              ? {
                  periodMode: isTournamentRegistrationCategory ? 'tournament' : periodMode,
                  periodMonth: shouldShowPeriodControls && periodMode === 'month' ? periodMonth : null,
                  periodStartDate: shouldShowPeriodControls && periodMode === 'range' ? periodStartDate : null,
                  periodEndDate: shouldShowPeriodControls && periodMode === 'range' ? periodEndDate : null,
                  periodPriceByDay: isPeriodPriceByDayActive,
                  periodDayCount: shouldShowPeriodControls && periodMode === 'range' ? rangeDayCount : null,
                  periodDailyPriceMinor: isPeriodPriceByDayActive ? periodDailyPriceMinor : null,
                  tournamentId: selectedTournament?.id ?? null,
                  tournamentName: selectedTournament?.name ?? null,
                  tournamentDate: selectedTournament?.date ?? null,
                }
              : {}),
            ...(isHandicapCategory
              ? {
                  period: showPeriodControls ? periodMonth : operationDate.slice(0, 7),
                  associationName: 'AAG',
                  transferAmountMinor: amountMinor,
                }
              : {}),
          },
        }),
        REGISTER_PAYMENT_TIMEOUT_MS,
        'El cobro no respondio a tiempo. Revisalo en movimientos antes de volver a cargarlo.',
      );
      registered = true;
      onNotice({
        kind: 'success',
        message: `Cobro registrado${result.receiptNumber ? ` con recibo ${result.receiptNumber}` : ''}.`,
      });
      setForm((current) => ({ ...current, description: '', payerSearch: '', amount: '', paymentReference: '', notes: '' }));
      setGuestFirstName('');
      setGuestLastName('');
      setIsGuest(false);
      setManualGreenFeeAmount(false);
      setSaving(false);
      void Promise.resolve(onRegistered?.()).catch((reloadError) => {
        onNotice({
          kind: 'error',
          message: reloadError instanceof Error ? reloadError.message : 'El cobro se registro, pero no pudimos refrescar la lista.',
        });
      });
    } catch (error) {
      onNotice({ kind: 'error', message: error instanceof Error ? error.message : 'No pudimos registrar el cobro.' });
    } finally {
      if (!registered) {
        setSaving(false);
      }
    }
  };

  return (
    <section className="floating-card accounting-panel">
      {showHeader && (
        <div className="accounting-section-header">
          <div>
            <p className="eyebrow">Generar nuevo cobro</p>
            <h2>{title}</h2>
            {helperText && <p>{helperText}</p>}
          </div>
          {showMemberDebtAction && <UiActionButton to="/accounting/member-dues?tab=renewals" variant="secondary">Ver renovaciones</UiActionButton>}
        </div>
      )}

      <form className="accounting-entry-form accounting-dialog-form accounting-dialog-form--income" onSubmit={handleSubmit}>
        <label className="form-field form-field--wide">
          <span>Categoria de ingreso</span>
          <select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}>
            {selectableIncomeCategories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        {!installmentPlanEnabled && <fieldset className="accounting-segmented accounting-payment-account-selector form-field--wide">
          <legend>Cuenta / caja</legend>
          {paymentAccountOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={[
                'accounting-segmented__item',
                'accounting-payment-account-selector__item',
                `accounting-payment-account-selector__item--${option.id}`,
                paymentAccountId === option.id ? 'accounting-segmented__item--active' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setPaymentAccountId(option.id)}
            >
              <strong>{option.label}</strong>
              {option.helper && <small>{option.helper}</small>}
            </button>
          ))}
        </fieldset>}
        {isGreenFeeCategory && (
          <label className="check-field form-field--wide">
            <input
              type="checkbox"
              checked={isGuest}
              onChange={(event) => {
                setIsGuest(event.target.checked);
                setForm((current) => ({ ...current, payerSearch: '' }));
                setManualGreenFeeAmount(false);
              }}
            />
            <span>Es invitado</span>
          </label>
        )}
        {isGreenFeeCategory && isGuest && (
          <div className="manual-income-period-range form-field--wide">
            <label className="form-field"><span>Nombre del invitado</span><input value={guestFirstName} onChange={(event) => setGuestFirstName(event.target.value)} /></label>
            <label className="form-field"><span>Apellido del invitado</span><input value={guestLastName} onChange={(event) => setGuestLastName(event.target.value)} /></label>
          </div>
        )}
        {!(isGreenFeeCategory && isGuest) && <label className="form-field form-field--wide">
          <span>Pagador</span>
          <input
            list="manual-income-payers"
            value={form.payerSearch}
            readOnly={payerReadOnly}
            disabled={isGreenFeeCategory && isGuest}
            onChange={(event) => setForm((current) => ({ ...current, payerSearch: event.target.value }))}
            placeholder="Buscar socio o cargar pagador externo"
          />
          <datalist id="manual-income-payers">
            {members.map((member) => (
              <option key={member.id} value={`${getPersonDisplayName(member)} - socio ${member.memberNumber}`} />
            ))}
          </datalist>
        </label>}
        {!installmentPlanEnabled && <label className="form-field">
          <span>Canal de pago</span>
          <select value={form.paymentMethodId} onChange={(event) => setForm((current) => ({ ...current, paymentMethodId: event.target.value }))}>
            {selectablePaymentMethods.length === 0 && <option value="">Sin canales activos</option>}
            {selectablePaymentMethods.map((method) => <option key={method.id} value={method.id}>{getPaymentMethodDisplayName(method)}</option>)}
          </select>
        </label>}
        {showPeriodControls && isTournamentRegistrationCategory && (
          <label className="form-field form-field--wide">
            <span>Torneo</span>
            <select value={selectedTournamentId} onChange={(event) => setSelectedTournamentId(event.target.value)}>
              {tournamentsLoading && <option value="">Cargando torneos abiertos...</option>}
              {!tournamentsLoading && openTournaments.length === 0 && <option value="">Sin torneos con inscripcion abierta</option>}
              {openTournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name} - {formatDateLabel(tournament.date)}
                </option>
              ))}
            </select>
            <small>
              {selectedTournament
                ? `Se cobra una vez por el torneo: ${formatCurrency(selectedTournament.registrationFeeMinor)}.`
                : 'Solo se listan torneos con inscripcion abierta.'}
            </small>
          </label>
        )}
        {shouldShowPeriodControls && (
          <section className="manual-income-period-detail form-field--wide" aria-label="Periodo del cobro">
            <div className="manual-income-period-detail__header">
              <strong>Periodo</strong>
              {periodMode === 'range' && <small>{rangeDayCount > 0 ? `${rangeDayCount} dia${rangeDayCount === 1 ? '' : 's'}` : 'Rango pendiente'}</small>}
            </div>
            <fieldset className="accounting-segmented manual-income-period-mode">
              <legend>Tipo de periodo</legend>
              <button
                type="button"
                className={`accounting-segmented__item ${periodMode === 'month' ? 'accounting-segmented__item--active' : ''}`}
                onClick={() => setPeriodMode('month')}
              >
                <strong>Mes</strong>
              </button>
              <button
                type="button"
                className={`accounting-segmented__item ${periodMode === 'range' ? 'accounting-segmented__item--active' : ''}`}
                disabled={isHandicapCategory}
                onClick={() => setPeriodMode('range')}
              >
                <strong>Entre fechas</strong>
              </button>
            </fieldset>
            {periodMode === 'month' ? (
              <label className="form-field">
                <span>Mes</span>
                <input type="month" value={periodMonth} onChange={(event) => setPeriodMonth(event.target.value)} />
                {isHandicapCategory && <small>El handicap se cobra por el mes completo.</small>}
              </label>
            ) : (
              <div className="manual-income-period-range">
                <label className="form-field">
                  <span>Desde</span>
                  <input type="date" value={periodStartDate} onChange={(event) => setPeriodStartDate(event.target.value)} />
                </label>
                <label className="form-field">
                  <span>Hasta</span>
                  <input type="date" min={periodStartDate} value={periodEndDate} onChange={(event) => setPeriodEndDate(event.target.value)} />
                </label>
              </div>
            )}
            {periodMode === 'range' && (
              <label className="check-field manual-income-period-price-toggle">
                <input type="checkbox" checked={periodPriceByDay} onChange={(event) => setPeriodPriceByDay(event.target.checked)} />
                <span>Aplicar precio por dia</span>
              </label>
            )}
            {periodMode === 'range' && periodPriceByDay && (
              <label className="form-field accounting-money-field">
                <span>Precio por dia ARS</span>
                <input type="number" min="0" step="0.01" inputMode="decimal" value={periodDailyPrice} onChange={(event) => setPeriodDailyPrice(event.target.value)} />
              </label>
            )}
          </section>
        )}
        {isGreenFeeCategory && (
          <label className="form-field">
            <span>Fecha del green fee</span>
            <input type="date" value={operationDate} onChange={(event) => setOperationDate(event.target.value)} />
          </label>
        )}
        <label className="form-field form-field--wide"><span>Descripcion</span><input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
        <label className="form-field"><span>Referencia</span><input value={form.paymentReference} onChange={(event) => setForm((current) => ({ ...current, paymentReference: event.target.value }))} /></label>
        <label className="form-field accounting-money-field">
          <span>{isPeriodPriceByDayActive ? 'Total ARS' : 'Monto ARS'}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            readOnly={amountReadOnly || (fixedAmountMinor !== undefined && !fixedAmountEditable) || isPeriodPriceByDayActive || (showPeriodControls && isTournamentRegistrationCategory && Boolean(selectedTournament)) || (isGreenFeeCategory && (!isGuest || !manualGreenFeeAmount))}
            value={form.amount}
            onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
          />
        </label>
        {isGreenFeeCategory && isGuest && (
          <label className="check-field form-field--wide">
            <input type="checkbox" checked={manualGreenFeeAmount} onChange={(event) => setManualGreenFeeAmount(event.target.checked)} />
            <span>Modificar monto configurado</span>
          </label>
        )}
        <InstallmentPlanFields
          enabled={installmentPlanEnabled}
          label="Pagos parciales"
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
        {!installmentPlanEnabled && selectedPaymentMethod && (!isMemberFeeCategory || !memberFeePreview) && !isGreenFeeCategory && (
          <PaymentCommissionSummary
            direction="income"
            baseAmountMinor={Number.isFinite(amountMinorPreview) ? amountMinorPreview : 0}
            commissionAmountMinor={paymentCommission.commissionAmountMinor}
            commissionPctBps={paymentCommission.percentageBps}
            totalAmountMinor={paymentCommission.totalAmountMinor}
            breakdown={selectedPaymentMethod.activeCommissionBreakdown ?? []}
          />
        )}
        <label className="form-field form-field--wide"><span>Notas</span><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
        {shouldManageMemberFeeRenewals && selectedMember && (
          <section className="manual-income-fee-detail manual-income-renewals form-field--wide" aria-label="Cuotas societarias del socio">
            <div className="manual-income-fee-detail__header">
              <div>
                <strong>Cuota y renovacion</strong>
                <small>Elegí una o más cuotas; se registran juntas en un solo movimiento.</small>
              </div>
              <strong>{formatCurrency(selectedPendingRenewalAmountMinor)}</strong>
            </div>
            <div className="accounting-inline-actions">
              <AccountingMonthPicker
                label="Mes de la cuota"
                period={memberFeePeriod}
                maxPeriod={MAX_FUTURE_MEMBER_FEE_PERIOD}
                onChange={(period) => {
                  setSelectedRenewalIds([]);
                  setMemberFeePeriod(period);
                }}
              />
              <small>La fecha del cobro puede ser hoy aunque el mes de la cuota todavia no haya comenzado.</small>
            </div>
            {renewalsLoading && <div className="loading-state loading-state--inline"><span className="loading-spinner" /><strong>Consultando renovaciones</strong></div>}
            {renewalsError && <div className="profile-note profile-note--danger">{renewalsError}</div>}
            {!renewalsLoading && !renewalsError && pendingRenewalLines.length === 0 && (
              <div className="profile-note">Este socio no tiene renovaciones pendientes para cobrar.</div>
            )}
            {pendingRenewalLines.length > 0 && (
              <>
                <div className="renewal-payment-selection-actions">
                  <button type="button" className="btn-secondary" onClick={() => setSelectedRenewalIds(pendingRenewalLines.map((renewal) => renewal.id))}>
                    Seleccionar todas
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setSelectedRenewalIds([])}>
                    Limpiar
                  </button>
                </div>
                <div className="manual-income-renewals__list">
                  {pendingRenewalLines.map((renewal) => (
                    <label
                      key={renewal.id}
                      className={selectedRenewalIds.includes(renewal.id)
                        ? 'renewal-payment-line renewal-payment-line--selected'
                        : 'renewal-payment-line'}
                    >
                      <span className="renewal-payment-line__selector">
                        <input
                          type="checkbox"
                          checked={selectedRenewalIds.includes(renewal.id)}
                          onChange={() => setSelectedRenewalIds((current) => (
                            current.includes(renewal.id)
                              ? current.filter((id) => id !== renewal.id)
                              : [...current, renewal.id]
                          ))}
                        />
                        <span>Cobrar esta cuota</span>
                      </span>
                      <span className="renewal-payment-line__title">
                        <span>
                          <strong>{renewal.description}</strong>
                          <small>{renewal.isGenerated ? 'A preparar' : renewal.status === 'overdue' ? 'Vencida' : 'Pendiente'}{renewal.dueLabel ? ' - ' + renewal.dueLabel : ''}</small>
                        </span>
                        <strong>{formatCurrency(renewal.payableAmountMinor)}</strong>
                      </span>
                      {renewal.discountAmountMinor > 0 && (
                        <span className="renewal-payment-line__detail renewal-payment-line__detail--early">
                          <span>Descuento por pago pronto ({formatBps(renewal.discountPctBps)})</span>
                          <strong>-{formatCurrency(renewal.discountAmountMinor)}</strong>
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                <label className="checkbox-row renewal-payment-discount-toggle">
                  <input
                    type="checkbox"
                    checked={applyEarlyPaymentDiscount}
                    disabled={memberFeePeriod !== operationDate.slice(0, 7)}
                    onChange={(event) => setApplyEarlyPaymentDiscount(event.target.checked)}
                  />
                  <span>
                    Aplicar descuento por pronto pago ({formatBps(activeConfig?.earlyPaymentDiscountPctBps ?? 0)})
                    <small>Solo modifica la renovación del mes del pago; las cuotas atrasadas conservan su importe.</small>
                  </span>
                </label>
                {selectedPendingRenewalLines.length === 1 && (
                  <label className="checkbox-row renewal-payment-discount-toggle">
                    <input
                      type="checkbox"
                      checked={settleSelectedRenewalAsFinalAmount}
                      onChange={(event) => setSettleSelectedRenewalAsFinalAmount(event.target.checked)}
                    />
                    <span>Tomar el monto ingresado como total definitivo de esta cuota<small>Permite cobrar el importe administrativo que decidas, incluso si difiere del valor configurado.</small></span>
                  </label>
                )}

                <div className="manual-income-fee-detail__line">
                  <span>Monto para el club</span>
                  <strong>{formatCurrency(Number.isFinite(amountMinorPreview) ? amountMinorPreview : 0)}</strong>
                </div>
                <div className="manual-income-fee-detail__line">
                  <span>Comisión del medio de pago ({formatBps(paymentCommission.percentageBps)})</span>
                  <strong>{formatCurrency(paymentCommission.commissionAmountMinor)}</strong>
                </div>
                <div className="manual-income-fee-detail__line manual-income-fee-detail__line--total">
                  <span>Total a cobrar</span>
                  <strong>{formatCurrency(paymentCommission.totalAmountMinor)}</strong>
                </div>
                <small>Podés reducir el monto para registrar un pago parcial; se aplica primero a la cuota más antigua seleccionada.</small>
                <small>{settleSelectedRenewalAsFinalAmount && selectedPendingRenewalLines.length === 1 ? 'Con monto definitivo, la cuota queda pagada por el importe ingresado.' : 'Sin monto definitivo, el importe se registra como pago parcial.'}</small>
              </>
            )}
          </section>
        )}
        {memberFeePreview && selectedMember && !shouldManageMemberFeeRenewals && (
          <section className="manual-income-fee-detail form-field--wide" aria-label="Detalle de cuota societaria">
            <div className="manual-income-fee-detail__header">
              <div>
                <strong>Detalle de cuota societaria</strong>
                <small>{getPersonDisplayName(selectedMember)} - socio {selectedMember.memberNumber} - {operationDateDisplay}</small>
              </div>
              <strong>{formatCurrency(memberFeePreview.payableAmountMinor)}</strong>
            </div>
            <div className="manual-income-fee-detail__line">
              <span>Cuota base</span>
              <strong>{formatCurrency(memberFeePreview.baseAmountMinor)}</strong>
            </div>
            <div className="manual-income-fee-detail__line">
              <span>
                <label className="manual-income-discount-toggle">
                  <input type="checkbox" checked={applyTypeDiscount} onChange={(event) => setApplyTypeDiscount(event.target.checked)} />
                  <span>Descuento por tipo de socio ({formatBps(10000 - memberFeePreview.originalAppliedPctBps)})</span>
                </label>
              </span>
              <strong>-{formatCurrency(memberFeePreview.typeDiscountAmountMinor)}</strong>
            </div>
            <div className="manual-income-fee-detail__line">
              <span>Subtotal cuota</span>
              <strong>{formatCurrency(memberFeePreview.finalAmountMinor)}</strong>
            </div>
            <div className="manual-income-fee-detail__line">
              <span>
                <label className="manual-income-discount-toggle">
                  <input type="checkbox" checked={applyEarlyPaymentDiscount} onChange={(event) => setApplyEarlyPaymentDiscount(event.target.checked)} />
                  <span>Descuento por pago pronto ({formatBps(memberFeePreview.earlyDiscountPctBps)})</span>
                </label>
              </span>
              <strong>-{formatCurrency(memberFeePreview.earlyDiscountAmountMinor)}</strong>
            </div>
            <div className="manual-income-fee-detail__line">
              <span>Monto para el club</span>
              <strong>{formatCurrency(memberFeePreview.payableAmountMinor)}</strong>
            </div>
            <div className="manual-income-fee-detail__line">
              <span>Comision del medio de pago ({formatBps(paymentCommission.percentageBps)})</span>
              <strong>{formatCurrency(paymentCommission.commissionAmountMinor)}</strong>
            </div>
            <div className="manual-income-fee-detail__line manual-income-fee-detail__line--total">
              <span>Total a cobrar</span>
              <strong>{formatCurrency(paymentCommission.totalAmountMinor)}</strong>
            </div>
          </section>
        )}
        {isGreenFeeCategory && greenFeePreview && (
          <section className="manual-income-fee-detail form-field--wide" aria-label="Detalle de green fee">
            <div className="manual-income-fee-detail__header">
              <div><strong>Detalle de green fee</strong><small>{greenFeePreview.ruleLabel} - {operationDateDisplay}</small></div>
              <strong>{formatCurrency(paymentCommission.totalAmountMinor)}</strong>
            </div>
            <div className="manual-income-fee-detail__line"><span>Tarifa configurada</span><strong>{formatCurrency(greenFeePreview.amountMinor ?? 0)}</strong></div>
            {isGuest && manualGreenFeeAmount && <div className="manual-income-fee-detail__line"><span>Importe modificado</span><strong>{formatCurrency(Number.isFinite(amountMinorPreview) ? amountMinorPreview : 0)}</strong></div>}
            <div className="manual-income-fee-detail__line"><span>Monto para el club</span><strong>{formatCurrency(Number.isFinite(amountMinorPreview) ? amountMinorPreview : 0)}</strong></div>
            <div className="manual-income-fee-detail__line"><span>Comision ({formatBps(paymentCommission.percentageBps)})</span><strong>{formatCurrency(paymentCommission.commissionAmountMinor)}</strong></div>
            <div className="manual-income-fee-detail__line manual-income-fee-detail__line--total"><span>Total a cobrar</span><strong>{formatCurrency(paymentCommission.totalAmountMinor)}</strong></div>
          </section>
        )}
        {extraDetail}
        <div className="form-actions form-actions--right">
          <UiActionButton type="submit" disabled={saving || !form.categoryId || (!installmentPlanEnabled && !form.paymentMethodId)}>
            {saving ? savingLabel : installmentPlanEnabled ? 'Crear plan de pagos parciales' : submitLabel}
          </UiActionButton>
        </div>
      </form>
    </section>
  );
}
