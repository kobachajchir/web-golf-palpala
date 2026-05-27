import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import type { EntityWithId, FinancialConfigDocument, UpsertFinancialConfigPayload } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import type { AccountingNotice } from '../types/accounting';
import { buildArgentinaDateIso, formatCurrency, formatTimestamp, parseAmountInputToMinor, timestampToDate } from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();

type FinancialConfigFormState = {
  fullMemberFee: string;
  familyAssociatePct: string;
  lifetimePct: string;
  minorPct: string;
  licensePct: string;
  creditCommissionPct: string;
  effectiveFrom: string;
  notes: string;
};

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

function configToForm(config: EntityWithId<FinancialConfigDocument> | null): FinancialConfigFormState {
  return {
    fullMemberFee: config ? String(config.fullMemberFeeMinor / 100).replace('.', ',') : '',
    familyAssociatePct: config ? String(config.familyAssociatePctBps / 100).replace('.', ',') : '',
    lifetimePct: config ? String(config.lifetimePctBps / 100).replace('.', ',') : '',
    minorPct: config ? String(config.minorPctBps / 100).replace('.', ',') : '',
    licensePct: config ? String(config.licensePctBps / 100).replace('.', ',') : '',
    creditCommissionPct: config ? String((config.creditCommissionPctBps ?? 0) / 100).replace('.', ',') : '',
    effectiveFrom: toDateInput(config),
    notes: '',
  };
}

function buildPayloadFromForm(
  config: EntityWithId<FinancialConfigDocument>,
  form: FinancialConfigFormState,
): UpsertFinancialConfigPayload | string {
  const fullMemberFeeMinor = parseAmountInputToMinor(form.fullMemberFee);
  const familyAssociatePctBps = parsePercentToBps(form.familyAssociatePct);
  const lifetimePctBps = parsePercentToBps(form.lifetimePct);
  const minorPctBps = parsePercentToBps(form.minorPct);
  const licensePctBps = parsePercentToBps(form.licensePct);
  const creditCommissionPctBps = parsePercentToBps(form.creditCommissionPct);

  if (!Number.isFinite(fullMemberFeeMinor) || fullMemberFeeMinor <= 0) {
    return 'Ingresa un valor de cuota socio pleno mayor a cero.';
  }

  const percentages = [familyAssociatePctBps, lifetimePctBps, minorPctBps, licensePctBps, creditCommissionPctBps];
  if (percentages.some((value) => !Number.isFinite(value) || value < 0 || value > 10000)) {
    return 'Los porcentajes deben estar entre 0 y 100.';
  }

  if (!form.effectiveFrom) {
    return 'Selecciona la fecha efectiva del cambio.';
  }

  const payload: UpsertFinancialConfigPayload = {
    effectiveFrom: buildArgentinaDateIso(form.effectiveFrom),
    fullMemberFeeMinor,
    familyAssociatePctBps,
    lifetimePctBps,
    minorPctBps,
    licensePctBps,
    maxLicenseMonths: config.maxLicenseMonths,
    creditCommissionPctBps,
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

  if (config.earlyPaymentDiscountPctBps !== undefined && config.earlyPaymentDiscountPctBps !== null) {
    payload.earlyPaymentDiscountPctBps = config.earlyPaymentDiscountPctBps;
  }
  if (config.earlyPaymentDiscountDayOfMonth !== undefined && config.earlyPaymentDiscountDayOfMonth !== null) {
    payload.earlyPaymentDiscountDayOfMonth = config.earlyPaymentDiscountDayOfMonth;
  }

  return payload;
}

export function AccountingSettingsPage() {
  const { interfaceMode } = useAuth();
  const { summary, error, reload } = useAccountingSummary();
  const activeConfig = summary?.activeConfig ?? null;
  const [form, setForm] = useState<FinancialConfigFormState>(() => configToForm(null));
  const [pendingPayload, setPendingPayload] = useState<UpsertFinancialConfigPayload | null>(null);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [saving, setSaving] = useState(false);
  const canConfigure = interfaceMode === ROLES.DIRECTIVO;
  const commissionWillChange = useMemo(
    () => Boolean(activeConfig && pendingPayload && pendingPayload.creditCommissionPctBps !== activeConfig.creditCommissionPctBps),
    [activeConfig, pendingPayload],
  );

  useEffect(() => {
    if (activeConfig) {
      setForm(configToForm(activeConfig));
    }
  }, [activeConfig]);

  const updateForm = (field: keyof FinancialConfigFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  const confirmSave = async () => {
    if (!pendingPayload) {
      return;
    }

    setSaving(true);
    try {
      const result = await accountingCallables.upsertFinancialConfig(pendingPayload);
      if (commissionWillChange && pendingPayload.creditCommissionPctBps !== undefined) {
        const commissionPayload = {
          percentageBps: pendingPayload.creditCommissionPctBps,
          notes: 'Actualizacion desde Accounting / Configuracion',
        };
        await accountingCallables.setCreditCommissionRule(
          pendingPayload.effectiveFrom
            ? { ...commissionPayload, validFrom: pendingPayload.effectiveFrom }
            : commissionPayload,
        );
      }
      setNotice({ kind: 'success', message: `Configuracion financiera version ${result.version} guardada.` });
      setPendingPayload(null);
      await reload();
    } catch (saveError) {
      setNotice({ kind: 'error', message: saveError instanceof Error ? saveError.message : 'No pudimos guardar configuracion financiera.' });
    } finally {
      setSaving(false);
    }
  };

  if (!canConfigure) {
    return <AccountingEmptyState title="Configuracion restringida">Solo roles autorizados pueden editar configuracion contable.</AccountingEmptyState>;
  }

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Configuracion</p>
          <h1>Valores y reglas financieras</h1>
          <p>Los cambios se versionan desde la fecha efectiva y no recalculan movimientos historicos posteados.</p>
        </div>
        <div className="accounting-hero__actions">
          <UiActionButton to="/accounting/payment-methods" variant="secondary">
            Medios de pago
          </UiActionButton>
        </div>
      </section>

      <AccountingInlineNotice notice={notice ?? (error ? { kind: 'error', message: error } : null)} />

      {activeConfig ? (
        <AccountingCollapsibleSections
          initialOpenId="active"
          sections={[
            {
              id: 'active',
              title: `Configuracion activa version ${activeConfig.version}`,
              eyebrow: 'Configuracion activa',
              helper: 'Valores vigentes y regla de credito',
              content: (
                <div className="summary-grid accounting-summary-grid">
                  <article className="summary-card"><span>Cuota socio pleno</span><strong>{formatCurrency(activeConfig.fullMemberFeeMinor)}</strong><small>Base actual</small></article>
                  <article className="summary-card"><span>Vigente desde</span><strong>{formatTimestamp(activeConfig.effectiveFrom)}</strong><small>Historial preservado</small></article>
                  <article className="summary-card"><span>Comision credito</span><strong>{formatBps(activeConfig.creditCommissionPctBps)}</strong><small>Regla activa</small></article>
                </div>
              ),
            },
            {
              id: 'edit',
              title: 'Nueva version de cuota y porcentajes',
              eyebrow: 'Nueva version',
              helper: 'Fecha efectiva, comisiones y auditoria',
              content: (
                <form className="accounting-entry-form" onSubmit={handleSubmit}>
                  <label className="form-field"><span>Valor cuota socio pleno</span><input inputMode="decimal" value={form.fullMemberFee} onChange={(event) => updateForm('fullMemberFee', event.target.value)} /></label>
                  <label className="form-field"><span>Vitalicio (%)</span><input inputMode="decimal" value={form.lifetimePct} onChange={(event) => updateForm('lifetimePct', event.target.value)} /></label>
                  <label className="form-field"><span>Menor (%)</span><input inputMode="decimal" value={form.minorPct} onChange={(event) => updateForm('minorPct', event.target.value)} /></label>
                  <label className="form-field"><span>Grupo familiar asociado (%)</span><input inputMode="decimal" value={form.familyAssociatePct} onChange={(event) => updateForm('familyAssociatePct', event.target.value)} /></label>
                  <label className="form-field"><span>Licencia (%)</span><input inputMode="decimal" value={form.licensePct} onChange={(event) => updateForm('licensePct', event.target.value)} /></label>
                  <label className="form-field"><span>Comision credito (%)</span><input inputMode="decimal" value={form.creditCommissionPct} onChange={(event) => updateForm('creditCommissionPct', event.target.value)} /></label>
                  <label className="form-field">
                    <span>Aplica desde</span>
                    <input type="date" value={form.effectiveFrom} onChange={(event) => updateForm('effectiveFrom', event.target.value)} />
                    <small>Desde esta fecha se calculan nuevas cuotas y operaciones futuras.</small>
                  </label>
                  <label className="form-field"><span>Nota de auditoria</span><textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} /></label>
                  <div className="form-actions">
                    <UiActionButton type="submit" disabled={saving}>
                      {saving ? 'Guardando...' : 'Guardar nueva version'}
                    </UiActionButton>
                  </div>
                </form>
              ),
            },
          ]}
        />
      ) : (
        <AccountingEmptyState title="Sin configuracion activa">No se crea una configuracion nueva sin base existente del modulo contable.</AccountingEmptyState>
      )}

      <ConfirmDialog
        open={Boolean(pendingPayload)}
        title="Guardar configuracion financiera"
        description={
          pendingPayload
            ? `Se creara una nueva version vigente desde ${form.effectiveFrom}. Los historicos no se modifican${commissionWillChange ? ' y tambien se actualizara la regla de comision de credito' : ''}.`
            : undefined
        }
        confirmLabel="Guardar version"
        loading={saving}
        onCancel={() => setPendingPayload(null)}
        onConfirm={() => void confirmSave()}
      />
    </div>
  );
}
