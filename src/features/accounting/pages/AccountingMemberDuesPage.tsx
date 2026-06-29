import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { SearchFiltersPanel } from '../../../components/SearchFiltersPanel';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import { ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import type { AccountingPeriod, EntityWithId, FinancialConfigDocument, MemberFeeChargeDocument, UpsertFinancialConfigPayload } from '../../../modules/accounting/domain/models';
import type { MemberDocument } from '../../../modules/users/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createMemberRegistryService } from '../../../modules/users/services/memberRegistry.service';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { generateMembershipFee, registerManualPayment } from '../api/memberBillingApi';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import type { AccountingNotice } from '../types/accounting';
import {
  buildArgentinaDateIso,
  formatCurrency,
  formatPeriod,
  formatTimestamp,
  getPersonDisplayName,
  normalizeAccountingPeriod,
  parseAmountInputToMinor,
  timestampToDate,
} from '../utils/accountingFormatters';
import { buildChargesByMemberId, estimateMemberFeeAmountMinor, estimateMemberFeeDetails, getOpenFeeCharges } from '../utils/memberFeeEstimates';

const accountingCallables = createAccountingCallables();
const DEFAULT_SERVER_MONTHLY_USD_MINOR = 6500;

type FeeConfigFormState = {
  fullMemberFee: string;
  familyAssociatePct: string;
  lifetimePct: string;
  minorPct: string;
  licensePct: string;
  earlyPaymentDiscountPct: string;
  serverMonthlyExpense: string;
  effectiveFrom: string;
  notes: string;
};

type RenewalPaymentFilter = 'all' | 'missing_charge' | 'pending' | 'overdue';
type RenewalPaymentFormState = {
  paymentMethodId: string;
  paymentDate: string;
  reference: string;
  notes: string;
};

type RenewalPaymentLine = {
  key: string;
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
  { value: 'pending', label: 'Cuota pendiente' },
  { value: 'overdue', label: 'Cuota vencida' },
];

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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

function getPaymentDatePeriod(paymentDate: string): AccountingPeriod | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ? (paymentDate.slice(0, 7) as AccountingPeriod) : null;
}

function getPaymentDateDay(paymentDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ? Number(paymentDate.slice(8, 10)) : Number.NaN;
}

function calculateEarlyPaymentPreview({
  amountMinor,
  period,
  paymentDate,
  config,
}: {
  amountMinor: number;
  period: AccountingPeriod;
  paymentDate: string;
  config: EntityWithId<FinancialConfigDocument> | null | undefined;
}) {
  const discountPctBps = config?.earlyPaymentDiscountPctBps ?? 0;
  const discountDayOfMonth = config?.earlyPaymentDiscountDayOfMonth ?? 10;
  const paymentPeriod = getPaymentDatePeriod(paymentDate);
  const paymentDay = getPaymentDateDay(paymentDate);
  const qualifies = discountPctBps > 0 && paymentPeriod === period && paymentDay >= 1 && paymentDay <= discountDayOfMonth;
  const discountAmountMinor = qualifies ? Math.round((amountMinor * discountPctBps) / 10000) : 0;

  return {
    discountPctBps: qualifies ? discountPctBps : 0,
    discountAmountMinor,
    payableAmountMinor: Math.max(amountMinor - discountAmountMinor, 0),
  };
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
      helper: 'Pendiente de pago del mes actual',
    };
  }

  if (charges.some((charge) => charge.status === 'pending')) {
    return {
      filter: 'pending' as RenewalPaymentFilter,
      label: 'Cuota pendiente',
      helper: 'Pendiente de pago del mes actual',
    };
  }

  return {
    filter: 'pending' as RenewalPaymentFilter,
    label: 'Revisar cuota',
    helper: 'La cuota no figura pagada para este mes',
  };
}

function configToForm(config: EntityWithId<FinancialConfigDocument> | null): FeeConfigFormState {
  return {
    fullMemberFee: config ? String(config.fullMemberFeeMinor / 100).replace('.', ',') : '',
    familyAssociatePct: config ? String(config.familyAssociatePctBps / 100).replace('.', ',') : '',
    lifetimePct: config ? String(config.lifetimePctBps / 100).replace('.', ',') : '',
    minorPct: config ? String(config.minorPctBps / 100).replace('.', ',') : '',
    licensePct: config ? String(config.licensePctBps / 100).replace('.', ',') : '',
    earlyPaymentDiscountPct: config ? String((config.earlyPaymentDiscountPctBps ?? 0) / 100).replace('.', ',') : '0',
    serverMonthlyExpense: config?.serverMonthlyExpenseMinor ? String(config.serverMonthlyExpenseMinor / 100).replace('.', ',') : '65',
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
  const serverMonthlyExpenseMinor = parseAmountInputToMinor(form.serverMonthlyExpense);

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

  if (!form.effectiveFrom) {
    return 'Selecciona la fecha efectiva del cambio.';
  }
  if (!Number.isFinite(serverMonthlyExpenseMinor) || serverMonthlyExpenseMinor < 0) {
    return 'Ingresa un gasto fijo de servidor valido.';
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
    cantineroContractMode: config.cantineroContractMode,
    advertisingDefaultPeriodicity: config.advertisingDefaultPeriodicity,
    requireApprovalForExpensePosting: config.requireApprovalForExpensePosting,
    requireApprovalForOvertimePosting: config.requireApprovalForOvertimePosting,
    serverMonthlyExpenseMinor,
    notes: form.notes.trim() || null,
  };
}

export function AccountingMemberDuesPage() {
  const [searchParams] = useSearchParams();
  const { interfaceMode } = useAuth();
  const { summary, loading, error, reload } = useAccountingSummary(
    searchParams.get('period') ? normalizeAccountingPeriod(searchParams.get('period')) : undefined,
  );
  const activeConfig = summary?.activeConfig ?? null;
  const [form, setForm] = useState<FeeConfigFormState>(() => configToForm(null));
  const [pendingPayload, setPendingPayload] = useState<UpsertFinancialConfigPayload | null>(null);
  const [pendingCancelMember, setPendingCancelMember] = useState<EntityWithId<MemberDocument> | null>(null);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [saving, setSaving] = useState(false);
  const [renewalSearch, setRenewalSearch] = useState('');
  const [renewalPaymentFilter, setRenewalPaymentFilter] = useState<RenewalPaymentFilter>('all');
  const [isRenewalFiltersOpen, setIsRenewalFiltersOpen] = useState(true);
  const [openRenewalActionsId, setOpenRenewalActionsId] = useState<string | null>(null);
  const [renewalPaymentMember, setRenewalPaymentMember] = useState<EntityWithId<MemberDocument> | null>(null);
  const [renewalPaymentForm, setRenewalPaymentForm] = useState<RenewalPaymentFormState>({
    paymentMethodId: '',
    paymentDate: todayInputValue(),
    reference: '',
    notes: '',
  });
  const [paymentSaving, setPaymentSaving] = useState(false);
  const memberRegistry = useMemo(() => createMemberRegistryService(), []);
  const canConfigure = interfaceMode === ROLES.DIRECTIVO;
  const canCancelSubscription = interfaceMode === ROLES.DIRECTIVO || interfaceMode === ROLES.ADMINISTRATIVO;
  const tabParam = searchParams.get('tab');
  const initialOpenId = tabParam === 'renewals'
    ? 'renewals'
    : tabParam === 'config' || tabParam === 'membership-fee'
      ? 'config'
      : 'renewals';

  useEffect(() => {
    if (activeConfig) {
      setForm(configToForm(activeConfig));
    }
  }, [activeConfig]);

  useEffect(() => {
    setRenewalPaymentForm((current) => ({
      ...current,
      paymentMethodId: current.paymentMethodId || summary?.paymentMethods[0]?.id || '',
    }));
  }, [summary?.paymentMethods]);

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

  const buildRenewalPaymentDraft = (member: EntityWithId<MemberDocument>, paymentDate = todayInputValue()) => {
    const openCharges = pendingChargesByMemberId.get(member.id) ?? [];
    const hasCurrentPeriodOpenCharge = openCharges.some((charge) => charge.period === summary?.period);
    const missingChargeDetails = estimateMemberFeeDetails(member, activeConfig);
    const estimatedCurrentAmountMinor = hasCurrentPeriodOpenCharge ? 0 : missingChargeDetails.finalAmountMinor;
    const existingLines: RenewalPaymentLine[] = openCharges.map((charge) => {
      const earlyPayment = calculateEarlyPaymentPreview({
        amountMinor: charge.finalAmountMinor,
        period: charge.period,
        paymentDate,
        config: activeConfig,
      });
      return {
        key: charge.id,
        period: charge.period,
        typeLabel: charge.memberTypeCodeSnapshot || member.typeCodeSnapshot,
        baseAmountMinor: charge.baseAmountMinor,
        appliedPctBps: charge.appliedPctBps,
        typeDiscountAmountMinor: Math.max(charge.baseAmountMinor - charge.finalAmountMinor, 0),
        subtotalMinor: charge.finalAmountMinor,
        earlyDiscountPctBps: earlyPayment.discountPctBps,
        earlyDiscountAmountMinor: earlyPayment.discountAmountMinor,
        payableAmountMinor: earlyPayment.payableAmountMinor,
        statusLabel: charge.status === 'overdue' ? 'Vencida' : 'Pendiente',
      };
    });
    const generatedEarlyPayment = summary?.period
      ? calculateEarlyPaymentPreview({
          amountMinor: missingChargeDetails.finalAmountMinor,
          period: summary.period,
          paymentDate,
          config: activeConfig,
        })
      : null;
    const generatedLine: RenewalPaymentLine[] = !hasCurrentPeriodOpenCharge && summary?.period && generatedEarlyPayment
      ? [
          {
            key: `${member.id}-${summary.period}-generated`,
            period: summary.period,
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
      needsCurrentPeriodCharge: !hasCurrentPeriodOpenCharge,
      lines,
      conceptCount: lines.length,
      amountMinor: lines.reduce((total, line) => total + line.payableAmountMinor, 0),
      subtotalMinor: openCharges.reduce((total, charge) => total + charge.finalAmountMinor, 0) + estimatedCurrentAmountMinor,
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
    setRenewalPaymentMember(member);
    setRenewalPaymentForm({
      paymentMethodId: summary?.paymentMethods[0]?.id ?? '',
      paymentDate: todayInputValue(),
      reference: '',
      notes: `Cobro de cuota societaria ${summary?.period ?? ''}`.trim(),
    });
  };

  const handleRenewalPaymentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renewalPaymentMember || !summary?.period) {
      return;
    }
    if (!renewalPaymentForm.paymentMethodId) {
      setNotice({ kind: 'error', message: 'Selecciona un medio de pago.' });
      return;
    }

    const draft = buildRenewalPaymentDraft(renewalPaymentMember, renewalPaymentForm.paymentDate);
    setPaymentSaving(true);
    try {
      const generatedChargeId = draft.needsCurrentPeriodCharge
        ? (await generateMembershipFee({
            memberId: renewalPaymentMember.id,
            period: summary.period,
            reason: 'Generada desde renovaciones pendientes antes del cobro.',
          })).memberFeeChargeId
        : null;
      const openItemIds = [...new Set([
        ...draft.openCharges.map((charge) => charge.id),
        ...(generatedChargeId ? [generatedChargeId] : []),
      ])];
      if (openItemIds.length === 0) {
        setNotice({ kind: 'error', message: 'No hay conceptos abiertos para cobrar.' });
        return;
      }

      const receipt = await registerManualPayment({
        memberId: renewalPaymentMember.id,
        openItemIds,
        paymentMethodId: renewalPaymentForm.paymentMethodId,
        paymentDate: renewalPaymentForm.paymentDate,
        reference: renewalPaymentForm.reference,
        amount: draft.amountMinor,
        notes: renewalPaymentForm.notes,
      });
      setNotice({
        kind: 'success',
        message: `Cobro registrado por ${formatCurrency(receipt.totalAmountMinor)}${receipt.receiptNumbers.length ? ` con recibo ${receipt.receiptNumbers.join(', ')}` : ''}.`,
      });
      setRenewalPaymentMember(null);
      await reload();
    } catch (paymentError) {
      setNotice({ kind: 'error', message: paymentError instanceof Error ? paymentError.message : 'No pudimos cobrar la renovacion.' });
    } finally {
      setPaymentSaving(false);
    }
  };

  const renewalPaymentDraft = renewalPaymentMember ? buildRenewalPaymentDraft(renewalPaymentMember, renewalPaymentForm.paymentDate) : null;
  const selectedRenewalPaymentMethod = summary?.paymentMethods.find((method) => method.id === renewalPaymentForm.paymentMethodId) ?? null;
  const renewalPaymentNeedsReference = Boolean(selectedRenewalPaymentMethod && selectedRenewalPaymentMethod.id !== ACCOUNTING_PAYMENT_METHOD_IDS.cash);
  const renewalPaymentDisabledReason = !renewalPaymentMember
    ? 'Selecciona un socio.'
    : !renewalPaymentDraft || renewalPaymentDraft.conceptCount === 0
      ? 'No hay conceptos abiertos para cobrar.'
      : renewalPaymentDraft.amountMinor <= 0
        ? 'El total a cobrar debe ser mayor a cero.'
      : !renewalPaymentForm.paymentMethodId
        ? 'Selecciona un medio de pago.'
        : !renewalPaymentForm.paymentDate
          ? 'Selecciona la fecha de cobro.'
          : renewalPaymentNeedsReference && !renewalPaymentForm.reference.trim()
            ? 'Ingresa una referencia para este medio de pago.'
            : '';
  const canSubmitRenewalPayment = !paymentSaving && !renewalPaymentDisabledReason;

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Cuotas</p>
          <h1>Renovaciones y cuota societaria</h1>
          <p>Las renovaciones se sostienen automaticamente mes a mes hasta que el socio pague o avise la baja. La pantalla muestra deuda consolidada, no cuotas duplicadas.</p>
        </div>
      </section>

      <AccountingInlineNotice notice={notice ?? (error ? { kind: 'error', message: error } : null)} />
      {loading && <div className="loading-state loading-state--inline"><span className="loading-spinner" /><strong>Cargando cuotas</strong></div>}

      <AccountingCollapsibleSections
        initialOpenId={initialOpenId}
        sections={[
          {
            id: 'renewals',
            title: 'Renovaciones emitidas, pendientes de pago',
            eyebrow: 'Renovaciones',
            helper: 'Socios activos pendientes de pago mensual',
            content: (
              <>
                <SearchFiltersPanel
                  open={isRenewalFiltersOpen}
                  onToggle={() => setIsRenewalFiltersOpen((current) => !current)}
                  title="Busqueda y filtros"
                  helper="Buscar socio y acotar por estado de cuota del mes"
                  activeCount={renewalFilterCount}
                  icon="B"
                  chevron="v"
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
                <div className="directory-results">
                  <strong>{filteredRenewalMembers.length} renovacion{filteredRenewalMembers.length === 1 ? '' : 'es'} pendiente{filteredRenewalMembers.length === 1 ? '' : 's'}</strong>
                  <small>{summary ? `Periodo ${formatPeriod(summary.period)} - socios activos sin pago confirmado` : 'Periodo actual'}</small>
                </div>
                <div className="accounting-list accounting-renewals-list">
                  {filteredRenewalMembers.map((member) => {
                    const charges = currentPeriodChargeByMemberId.get(member.id);
                    const draft = buildRenewalPaymentDraft(member);
                    const state = getRenewalState(charges);

                    return (
                      <article key={member.id} className="accounting-row accounting-row--actions accounting-renewal-row">
                        <div className="accounting-row__main">
                          <strong>{getPersonDisplayName(member)}</strong>
                          <small>Socio {member.memberNumber} - {member.typeCodeSnapshot} - {member.status}</small>
                          <small>{draft.conceptCount > 0 ? `${draft.conceptCount} cuota${draft.conceptCount === 1 ? '' : 's'} pendiente${draft.conceptCount === 1 ? '' : 's'}` : state.helper}</small>
                        </div>
                        <div className="accounting-row__meta">
                          <span className={`status-chip status-chip--${state.filter.replace('_', '-')}`}>Pendiente de pago</span>
                          {draft.amountMinor > 0 && <strong>{formatCurrency(draft.amountMinor)}</strong>}
                        </div>
                        <div className="accounting-inline-actions">
                          <UiActionButton type="button" onClick={() => handleOpenRenewalPayment(member)}>
                            Cobrar
                          </UiActionButton>
                          <div className="member-actions accounting-row-menu-actions">
                            <button
                              type="button"
                              className={`icon-button member-icon-button ${openRenewalActionsId === member.id ? 'icon-button--active' : ''}`}
                              aria-label={`Mas acciones para ${getPersonDisplayName(member)}`}
                              aria-expanded={openRenewalActionsId === member.id}
                              onClick={() => setOpenRenewalActionsId((current) => current === member.id ? null : member.id)}
                            >
                              ...
                            </button>
                            {openRenewalActionsId === member.id && (
                              <div className="member-actions-menu">
                                <button
                                  type="button"
                                  className="member-actions-menu__item member-actions-menu__item--danger"
                                  disabled={!canCancelSubscription || saving}
                                  onClick={() => {
                                    setPendingCancelMember(member);
                                    setOpenRenewalActionsId(null);
                                  }}
                                >
                                  Eliminar suscripcion
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  {!loading && filteredRenewalMembers.length === 0 && (
                    <AccountingEmptyState title="Sin renovaciones pendientes">No hay socios activos sin pago confirmado para este periodo y filtros.</AccountingEmptyState>
                  )}
                </div>
              </>
            ),
          },
          {
            id: 'config',
            title: 'Configuracion de cuota',
            eyebrow: 'Configuracion de cuota',
            helper: 'Valor pleno, porcentajes y descuento hasta el dia 10',
            content: activeConfig ? (
              <>
                <div className="summary-grid accounting-summary-grid accounting-pricing-summary">
                  <article className="summary-card"><span>Cuota plena</span><strong>{formatCurrency(activeConfig.fullMemberFeeMinor)}</strong><small>Cuota base vigente</small></article>
                  <article className="summary-card"><span>Vigente desde</span><strong>{formatTimestamp(activeConfig.effectiveFrom)}</strong><small>No altera historicos</small></article>
                  <article className="summary-card"><span>Pronto pago</span><strong>{formatBps(activeConfig.earlyPaymentDiscountPctBps ?? 0)}</strong><small>Hasta el dia {activeConfig.earlyPaymentDiscountDayOfMonth ?? 10}</small></article>
                  <article className="summary-card"><span>Servidor</span><strong>{formatUsdMinor(activeConfig.serverMonthlyExpenseMinor)}</strong><small>Gasto fijo mensual</small></article>
                </div>
                {canConfigure ? (
                  <form className="accounting-entry-form accounting-pricing-form" onSubmit={handleSubmitConfig}>
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
                      <small>Se aplica como pronto pago hasta el dia 10 del mes.</small>
                    </label>
                    <label className="form-field">
                      <span>Gasto fijo mensual servidor (USD)</span>
                      <input inputMode="decimal" value={form.serverMonthlyExpense} onChange={(event) => updateForm('serverMonthlyExpense', event.target.value)} />
                      <small>Monto mensual sugerido: USD 65. Queda disponible para registrar el egreso SERVIDOR desde Caja.</small>
                    </label>
                    <label className="form-field">
                      <span>Aplica desde</span>
                      <input type="date" value={form.effectiveFrom} onChange={(event) => updateForm('effectiveFrom', event.target.value)} />
                      <small>Desde esta fecha se calculan nuevas cuotas futuras.</small>
                    </label>
                    <label className="form-field"><span>Nota de auditoria</span><textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} /></label>
                    <div className="form-actions">
                      <UiActionButton type="submit" disabled={saving}>
                        {saving ? 'Guardando...' : 'Guardar cuota societaria'}
                      </UiActionButton>
                    </div>
                  </form>
                ) : null}
              </>
            ) : (
              <AccountingEmptyState title="Sin configuracion activa">No se muestra ABM si no hay soporte de datos activo.</AccountingEmptyState>
            ),
          },
        ]}
      />

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
        open={Boolean(pendingCancelMember)}
        title="Eliminar suscripcion mensual"
        description={
          pendingCancelMember
            ? `Se dara de baja a ${getPersonDisplayName(pendingCancelMember)} para evitar renovaciones automaticas futuras. Los cargos y movimientos existentes se conservan.`
            : undefined
        }
        confirmLabel="Eliminar suscripcion"
        tone="danger"
        loading={saving}
        onCancel={() => setPendingCancelMember(null)}
        onConfirm={() => void confirmCancelSubscription()}
      />
      {renewalPaymentMember && renewalPaymentDraft && (
        <div className="modal-overlay quick-actions-modal-overlay" role="presentation" onClick={() => setRenewalPaymentMember(null)}>
          <section
            className="member-modal-card quick-actions-modal accounting-operation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="renewal-payment-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header quick-actions-modal__header">
              <div>
                <h2 id="renewal-payment-modal-title">Cobrar renovacion</h2>
                <p>{getPersonDisplayName(renewalPaymentMember)} - socio {renewalPaymentMember.memberNumber}</p>
              </div>
              <button type="button" className="modal-close-button" aria-label="Cerrar" onClick={() => setRenewalPaymentMember(null)}>
                x
              </button>
            </div>
            <form className="accounting-entry-form accounting-dialog-form accounting-renewal-payment-form" onSubmit={handleRenewalPaymentSubmit}>
              <div className="renewal-payment-summary form-field--wide">
                <div>
                  <span>Socio</span>
                  <strong>{getPersonDisplayName(renewalPaymentMember)}</strong>
                  <small>Socio {renewalPaymentMember.memberNumber} - {renewalPaymentMember.typeCodeSnapshot}</small>
                </div>
                <div>
                  <span>Conceptos</span>
                  <strong>{renewalPaymentDraft.conceptCount}</strong>
                  <small>{summary?.period ? formatPeriod(summary.period) : 'Periodo actual'}</small>
                </div>
                <div>
                  <span>Total a cobrar</span>
                  <strong>{formatCurrency(renewalPaymentDraft.amountMinor)}</strong>
                  <small>{renewalPaymentDraft.earlyDiscountTotalMinor > 0 ? `Incluye ${formatCurrency(renewalPaymentDraft.earlyDiscountTotalMinor)} de pronto pago` : 'Sin descuento de pronto pago'}</small>
                </div>
              </div>
              <label className="form-field form-field--wide">
                <span>Medio de pago</span>
                <select value={renewalPaymentForm.paymentMethodId} onChange={(event) => setRenewalPaymentForm((current) => ({ ...current, paymentMethodId: event.target.value }))}>
                  {summary?.paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                </select>
              </label>
              <label className="form-field"><span>Fecha</span><input type="date" value={renewalPaymentForm.paymentDate} onChange={(event) => setRenewalPaymentForm((current) => ({ ...current, paymentDate: event.target.value }))} /></label>
              <label className="form-field">
                <span>{renewalPaymentNeedsReference ? 'Referencia obligatoria' : 'Referencia'}</span>
                <input value={renewalPaymentForm.reference} onChange={(event) => setRenewalPaymentForm((current) => ({ ...current, reference: event.target.value }))} />
              </label>
              <label className="form-field form-field--wide"><span>Notas</span><textarea value={renewalPaymentForm.notes} onChange={(event) => setRenewalPaymentForm((current) => ({ ...current, notes: event.target.value }))} /></label>
              <section className="renewal-payment-breakdown form-field--wide" aria-label="Detalle del cobro">
                <div className="renewal-payment-breakdown__header">
                  <strong>Detalle del cobro</strong>
                  <span>{formatCurrency(renewalPaymentDraft.amountMinor)}</span>
                </div>
                {renewalPaymentDraft.lines.map((line) => (
                  <article key={line.key} className="renewal-payment-line">
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
                  <span>Total final</span>
                  <strong>{formatCurrency(renewalPaymentDraft.amountMinor)}</strong>
                </div>
              </section>
              <div className="form-actions">
                {renewalPaymentDisabledReason && <small className="form-actions__hint">{renewalPaymentDisabledReason}</small>}
                <UiActionButton type="button" variant="secondary" onClick={() => setRenewalPaymentMember(null)}>Cancelar</UiActionButton>
                <UiActionButton type="submit" disabled={!canSubmitRenewalPayment}>
                  {paymentSaving ? 'Cobrando...' : 'Cobrar'}
                </UiActionButton>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
