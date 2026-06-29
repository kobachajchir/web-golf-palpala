import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { SearchFiltersPanel } from '../../../components/SearchFiltersPanel';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import type { EntityWithId, FinancialConfigDocument, MemberFeeChargeDocument, UpsertFinancialConfigPayload } from '../../../modules/accounting/domain/models';
import type { MemberDocument } from '../../../modules/users/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
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

const accountingCallables = createAccountingCallables();

type FeeConfigFormState = {
  fullMemberFee: string;
  familyAssociatePct: string;
  lifetimePct: string;
  minorPct: string;
  licensePct: string;
  earlyPaymentDiscountPct: string;
  effectiveFrom: string;
  notes: string;
};

type RenewalPaymentFilter = 'all' | 'missing_charge' | 'pending' | 'overdue';

const RENEWAL_PAYMENT_FILTER_OPTIONS: Array<{ value: RenewalPaymentFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'missing_charge', label: 'Sin cuota emitida' },
  { value: 'pending', label: 'Cuota pendiente' },
  { value: 'overdue', label: 'Cuota vencida' },
];

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
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

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function getChargeTargetMemberIds(
  charge: EntityWithId<MemberFeeChargeDocument>,
  members: Array<EntityWithId<MemberDocument>>,
) {
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

function buildCurrentPeriodChargeMap(
  members: Array<EntityWithId<MemberDocument>>,
  charges: Array<EntityWithId<MemberFeeChargeDocument>>,
) {
  const map = new Map<string, Array<EntityWithId<MemberFeeChargeDocument>>>();

  charges.forEach((charge) => {
    getChargeTargetMemberIds(charge, members).forEach((memberId) => {
      map.set(memberId, [...(map.get(memberId) ?? []), charge]);
    });
  });

  return map;
}

function getRenewalState(charges: Array<EntityWithId<MemberFeeChargeDocument>> | undefined) {
  if (!charges || charges.length === 0) {
    return {
      filter: 'missing_charge' as RenewalPaymentFilter,
      label: 'Sin cuota emitida',
      helper: 'Generar cuota y continuar al cobro',
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
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [saving, setSaving] = useState(false);
  const [renewalSearch, setRenewalSearch] = useState('');
  const [renewalPaymentFilter, setRenewalPaymentFilter] = useState<RenewalPaymentFilter>('all');
  const [isRenewalFiltersOpen, setIsRenewalFiltersOpen] = useState(true);
  const canConfigure = interfaceMode === ROLES.DIRECTIVO;
  const tabParam = searchParams.get('tab');
  const initialOpenId = tabParam === 'renewals'
    ? 'renewals'
    : tabParam === 'config' || tabParam === 'membership-fee'
      ? 'config'
      : 'issued';

  useEffect(() => {
    if (activeConfig) {
      setForm(configToForm(activeConfig));
    }
  }, [activeConfig]);

  const currentPeriodChargeByMemberId = useMemo(
    () => buildCurrentPeriodChargeMap(summary?.membersPreview ?? [], summary?.periodFeeCharges ?? []),
    [summary?.membersPreview, summary?.periodFeeCharges],
  );

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

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Cuotas</p>
          <h1>Renovaciones y cuota societaria</h1>
          <p>El dia 1 de cada mes el sistema emite la cuota de los socios activos y la deja pendiente de pago. La configuracion de valores vive aca y las comisiones en Medios de pago.</p>
        </div>
      </section>

      <AccountingInlineNotice notice={notice ?? (error ? { kind: 'error', message: error } : null)} />
      {loading && <div className="loading-state loading-state--inline"><span className="loading-spinner" /><strong>Cargando cuotas</strong></div>}

      <AccountingCollapsibleSections
        initialOpenId={initialOpenId}
        sections={[
          {
            id: 'renewals',
            title: 'Renovaciones pendientes',
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
                <div className="accounting-list">
                  {filteredRenewalMembers.map((member) => {
                    const charges = currentPeriodChargeByMemberId.get(member.id);
                    const state = getRenewalState(charges);
                    const amountMinor = (charges ?? [])
                      .filter((charge) => charge.status === 'pending' || charge.status === 'overdue')
                      .reduce((total, charge) => total + charge.finalAmountMinor, 0);
                    const linkPeriod = summary?.period ? `&period=${encodeURIComponent(summary.period)}` : '';

                    return (
                      <article key={member.id} className="accounting-row accounting-row--actions">
                        <div className="accounting-row__main">
                          <strong>{getPersonDisplayName(member)}</strong>
                          <small>Socio {member.memberNumber} - {member.typeCodeSnapshot} - {member.status}</small>
                          <small>{state.helper}</small>
                        </div>
                        <div className="accounting-row__meta">
                          <span className={`status-chip status-chip--${state.filter.replace('_', '-')}`}>{state.label}</span>
                          {amountMinor > 0 && <strong>{formatCurrency(amountMinor)}</strong>}
                        </div>
                        <div className="accounting-inline-actions">
                          <UiActionButton to={`/accounting/collections?memberId=${member.id}${linkPeriod}`}>
                            {state.filter === 'missing_charge' ? 'Generar y cobrar' : 'Cobrar / renovar'}
                          </UiActionButton>
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
            id: 'issued',
            title: 'Cuotas emitidas',
            eyebrow: 'Cuotas emitidas',
            helper: summary ? formatPeriod(summary.period) : 'Periodo actual',
            content: (
              <div className="accounting-list">
                {summary?.periodFeeCharges.slice(0, 12).map((charge) => (
                  <article key={charge.id} className="accounting-row accounting-row--actions">
                    <div className="accounting-row__main">
                      <strong>{charge.memberTypeCodeSnapshot}</strong>
                      <small>{charge.memberId ?? charge.holderMemberId ?? 'Sin socio'} - {charge.status}</small>
                    </div>
                    <div className="accounting-row__meta">
                      <strong>{formatCurrency(charge.finalAmountMinor)}</strong>
                      <UiActionButton variant="secondary" to={`/accounting/collections?memberId=${charge.memberId ?? charge.holderMemberId ?? ''}`}>
                        Cobrar
                      </UiActionButton>
                    </div>
                  </article>
                ))}
              </div>
            ),
          },
          {
            id: 'config',
            title: 'Cuota societaria y pronto pago',
            eyebrow: 'Configuracion de cuota',
            helper: 'Valor pleno, porcentajes y descuento hasta el dia 10',
            content: activeConfig ? (
              <>
                <div className="summary-grid accounting-summary-grid">
                  <article className="summary-card"><span>Cuota plena</span><strong>{formatCurrency(activeConfig.fullMemberFeeMinor)}</strong><small>Version {activeConfig.version}</small></article>
                  <article className="summary-card"><span>Vigente desde</span><strong>{formatTimestamp(activeConfig.effectiveFrom)}</strong><small>No altera historicos</small></article>
                  <article className="summary-card"><span>Pronto pago</span><strong>{formatBps(activeConfig.earlyPaymentDiscountPctBps ?? 0)}</strong><small>Hasta el dia {activeConfig.earlyPaymentDiscountDayOfMonth ?? 10}</small></article>
                  <article className="summary-card"><span>Porcentajes</span><strong>{formatBps(activeConfig.minorPctBps)} / {formatBps(activeConfig.licensePctBps)}</strong><small>Menor / licencia</small></article>
                </div>
                {canConfigure ? (
                  <form className="accounting-entry-form" onSubmit={handleSubmitConfig}>
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
                ) : (
                  <AccountingInlineNotice notice={{ kind: 'info', message: 'Tu rol puede consultar la cuota, pero solo Directivo puede versionarla.' }} />
                )}
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
    </div>
  );
}
