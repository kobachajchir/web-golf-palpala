import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import { firestore } from '../../../lib/firebase';
import { ACCOUNTING_COLLECTIONS, ACCOUNTING_PAYMENT_METHOD_IDS } from '../../../modules/accounting/domain/constants';
import type {
  EntityWithId,
  FinancialConfigDocument,
  PaymentCommissionBreakdownItem,
  PaymentCommissionRuleDocument,
  PaymentMethodDocument,
  UpsertFinancialConfigPayload,
} from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createPaymentMethodsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import { AccountingCollapsibleSections } from '../components/AccountingCollapsibleSections';
import { AccountingEmptyState } from '../components/AccountingEmptyState';
import { AccountingInlineNotice } from '../components/AccountingInlineNotice';
import { useAccountingSummary } from '../hooks/useAccountingSummary';
import type { AccountingNotice } from '../types/accounting';
import { buildArgentinaDateIso, formatTimestamp } from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();

type CommissionLineDraft = {
  id: string;
  label: string;
  percentage: string;
  active: boolean;
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatBps(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Sin comision';
  }

  return `${(value / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
}

function parsePercentToBps(value: string) {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
}

function bpsToInput(value: number | null | undefined) {
  return String((value ?? 0) / 100).replace('.', ',');
}

function getTimestampMillis(value: Timestamp | null | undefined) {
  return value?.toDate().getTime() ?? 0;
}

function createDraftId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildFinancialConfigPayload(
  config: EntityWithId<FinancialConfigDocument>,
  overrides: { effectiveFrom: string; creditCommissionPctBps: number; notes?: string | null },
): UpsertFinancialConfigPayload {
  const payload: UpsertFinancialConfigPayload = {
    effectiveFrom: overrides.effectiveFrom,
    fullMemberFeeMinor: config.fullMemberFeeMinor,
    familyAssociatePctBps: config.familyAssociatePctBps,
    lifetimePctBps: config.lifetimePctBps,
    minorPctBps: config.minorPctBps,
    licensePctBps: config.licensePctBps,
    maxLicenseMonths: config.maxLicenseMonths,
    creditCommissionPctBps: overrides.creditCommissionPctBps,
    familyGroupBillingMode: config.familyGroupBillingMode,
    allowStandaloneMinor: config.allowStandaloneMinor,
    membershipChargePersistenceMode: config.membershipChargePersistenceMode,
    greenFeeAppliesToMembers: config.greenFeeAppliesToMembers,
    cantineroContractMode: config.cantineroContractMode,
    advertisingDefaultPeriodicity: config.advertisingDefaultPeriodicity,
    requireApprovalForExpensePosting: config.requireApprovalForExpensePosting,
    requireApprovalForOvertimePosting: config.requireApprovalForOvertimePosting,
    serverMonthlyExpenseMinor: config.serverMonthlyExpenseMinor ?? 0,
    notes: overrides.notes ?? null,
  };

  if (config.earlyPaymentDiscountPctBps !== undefined && config.earlyPaymentDiscountPctBps !== null) {
    payload.earlyPaymentDiscountPctBps = config.earlyPaymentDiscountPctBps;
  }
  if (config.earlyPaymentDiscountDayOfMonth !== undefined && config.earlyPaymentDiscountDayOfMonth !== null) {
    payload.earlyPaymentDiscountDayOfMonth = config.earlyPaymentDiscountDayOfMonth;
  }

  return payload;
}

function ruleToDraftLines(rule: EntityWithId<PaymentCommissionRuleDocument> | null): CommissionLineDraft[] {
  if (!rule) {
    return [{ id: createDraftId(), label: 'Comision base', percentage: '0', active: true }];
  }

  if (rule.breakdown?.length) {
    return rule.breakdown.map((item) => ({
      id: item.id,
      label: item.label,
      percentage: bpsToInput(item.percentageBps),
      active: item.isActive,
    }));
  }

  return [{
    id: createDraftId(),
    label: 'Comision base',
    percentage: bpsToInput(rule.percentageBps),
    active: true,
  }];
}

function buildBreakdown(lines: CommissionLineDraft[]): PaymentCommissionBreakdownItem[] | string {
  const breakdown: PaymentCommissionBreakdownItem[] = [];

  for (const line of lines) {
    const percentageBps = parsePercentToBps(line.percentage);
    if (!line.label.trim()) {
      return 'Cada item del desglose necesita un nombre.';
    }
    if (!Number.isFinite(percentageBps) || percentageBps < 0 || percentageBps > 10000) {
      return 'Cada porcentaje del desglose debe estar entre 0 y 100.';
    }

    breakdown.push({
      id: line.id,
      label: line.label.trim(),
      percentageBps,
      isActive: line.active,
    });
  }

  return breakdown;
}

function getTotalBpsFromBreakdown(breakdown: PaymentCommissionBreakdownItem[]) {
  return breakdown
    .filter((item) => item.isActive)
    .reduce((total, item) => total + item.percentageBps, 0);
}

export function AccountingPaymentMethodsPage() {
  const { interfaceMode, user, firebaseUser } = useAuth();
  const { summary, reload: reloadSummary, error } = useAccountingSummary();
  const [paymentMethods, setPaymentMethods] = useState<Array<EntityWithId<PaymentMethodDocument>>>([]);
  const [commissionRules, setCommissionRules] = useState<Array<EntityWithId<PaymentCommissionRuleDocument>>>([]);
  const [selectedCommissionMethodId, setSelectedCommissionMethodId] = useState('');
  const [commissionEnabled, setCommissionEnabled] = useState(false);
  const [commissionLines, setCommissionLines] = useState<CommissionLineDraft[]>(() => ruleToDraftLines(null));
  const [validFrom, setValidFrom] = useState(todayInputValue());
  const [commissionNotes, setCommissionNotes] = useState('');
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<{ method: EntityWithId<PaymentMethodDocument>; active: boolean } | null>(null);
  const [pendingCommissionSave, setPendingCommissionSave] = useState<{
    method: EntityWithId<PaymentMethodDocument>;
    breakdown: PaymentCommissionBreakdownItem[];
    totalBps: number;
    enabled: boolean;
    effectiveFrom: string;
  } | null>(null);
  const [openSectionId, setOpenSectionId] = useState<string | null>('list');
  const [openMethodActionsId, setOpenMethodActionsId] = useState<string | null>(null);
  const [openLineActionsId, setOpenLineActionsId] = useState<string | null>(null);
  const canConfigure = interfaceMode === ROLES.DIRECTIVO;
  const selectedMethod = useMemo(
    () => paymentMethods.find((method) => method.id === selectedCommissionMethodId) ?? null,
    [paymentMethods, selectedCommissionMethodId],
  );
  const activeRuleByMethodId = useMemo(() => {
    const map = new Map<string, EntityWithId<PaymentCommissionRuleDocument>>();
    [...commissionRules]
      .filter((rule) => rule.isActive)
      .sort((left, right) => getTimestampMillis(right.validFrom) - getTimestampMillis(left.validFrom))
      .forEach((rule) => {
        if (!map.has(rule.paymentMethodId)) {
          map.set(rule.paymentMethodId, rule);
        }
      });
    return map;
  }, [commissionRules]);
  const selectedActiveRule = selectedCommissionMethodId ? activeRuleByMethodId.get(selectedCommissionMethodId) ?? null : null;
  const draftBreakdown = useMemo(() => {
    const breakdown = buildBreakdown(commissionLines);
    return typeof breakdown === 'string' ? null : breakdown;
  }, [commissionLines]);
  const commissionTotalBps = commissionEnabled && draftBreakdown ? getTotalBpsFromBreakdown(draftBreakdown) : 0;
  const activeCommissionLineCount = draftBreakdown?.filter((item) => item.isActive).length ?? 0;

  const loadPaymentMethods = async () => {
    setLoading(true);
    setNotice(null);
    try {
      setPaymentMethods(await createPaymentMethodsRepository().listAllSorted());
    } catch (loadError) {
      setNotice({ kind: 'error', message: loadError instanceof Error ? loadError.message : 'No pudimos cargar medios de pago.' });
    } finally {
      setLoading(false);
    }
  };

  const loadCommissionRules = async () => {
    if (!firestore) {
      return;
    }

    const snapshot = await getDocs(query(collection(firestore, ACCOUNTING_COLLECTIONS.paymentCommissionRules), orderBy('validFrom', 'desc')));
    setCommissionRules(snapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data(),
    } as EntityWithId<PaymentCommissionRuleDocument>)));
  };

  const reloadAll = async () => {
    await Promise.all([loadPaymentMethods(), loadCommissionRules(), reloadSummary()]);
  };

  useEffect(() => {
    void reloadAll();
  }, []);

  useEffect(() => {
    if (!selectedCommissionMethodId && paymentMethods[0]) {
      setSelectedCommissionMethodId(paymentMethods[0].id);
    }
  }, [paymentMethods, selectedCommissionMethodId]);

  useEffect(() => {
    setCommissionEnabled(Boolean(selectedActiveRule));
    setCommissionLines(ruleToDraftLines(selectedActiveRule));
    setCommissionNotes(selectedActiveRule?.notes ?? '');
    setValidFrom(todayInputValue());
  }, [selectedActiveRule?.id, selectedCommissionMethodId]);

  const confirmToggle = async () => {
    if (!pendingToggle || !firestore) {
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(firestore, ACCOUNTING_COLLECTIONS.paymentMethods, pendingToggle.method.id), {
        active: pendingToggle.active,
        updatedAt: serverTimestamp(),
        updatedBy: user?.id ?? firebaseUser?.uid ?? null,
      });
      setNotice({
        kind: 'success',
        message: `${pendingToggle.method.name} quedo ${pendingToggle.active ? 'activo' : 'inactivo'}.`,
      });
      setPendingToggle(null);
      await reloadAll();
    } catch (toggleError) {
      setNotice({ kind: 'error', message: toggleError instanceof Error ? toggleError.message : 'No pudimos actualizar el medio de pago.' });
    } finally {
      setSaving(false);
    }
  };

  const updateCommissionLine = (lineId: string, patch: Partial<CommissionLineDraft>) => {
    setCommissionLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  };

  const addCommissionLine = () => {
    setCommissionLines((current) => [
      ...current,
      { id: createDraftId(), label: 'Nuevo item', percentage: '0', active: true },
    ]);
  };

  const removeCommissionLine = (lineId: string) => {
    setCommissionLines((current) => current.length <= 1 ? current : current.filter((line) => line.id !== lineId));
    setOpenLineActionsId(null);
  };

  const handleCommissionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canConfigure) {
      setNotice({ kind: 'error', message: 'No tenes permisos para editar comisiones.' });
      return;
    }
    if (!selectedMethod) {
      setNotice({ kind: 'error', message: 'Selecciona un medio de pago.' });
      return;
    }
    if (!validFrom) {
      setNotice({ kind: 'error', message: 'Selecciona la fecha efectiva de la regla.' });
      return;
    }

    const breakdown = buildBreakdown(commissionLines);
    if (typeof breakdown === 'string') {
      setNotice({ kind: 'error', message: breakdown });
      return;
    }

    const totalBps = commissionEnabled ? getTotalBpsFromBreakdown(breakdown) : 0;
    if (commissionEnabled && totalBps <= 0) {
      setNotice({ kind: 'error', message: 'Activa al menos un item con porcentaje mayor a cero.' });
      return;
    }
    if (totalBps > 10000) {
      setNotice({ kind: 'error', message: 'La comision total no puede superar 100%.' });
      return;
    }

    setPendingCommissionSave({
      method: selectedMethod,
      breakdown,
      totalBps,
      enabled: commissionEnabled,
      effectiveFrom: buildArgentinaDateIso(validFrom),
    });
  };

  const confirmCommissionSave = async () => {
    if (!pendingCommissionSave || !firestore) {
      return;
    }

    const actorUid = user?.id ?? firebaseUser?.uid;
    if (!actorUid) {
      setNotice({ kind: 'error', message: 'No pudimos identificar el usuario para auditar la regla.' });
      setPendingCommissionSave(null);
      return;
    }

    setSaving(true);
    try {
      const validFromTimestamp = Timestamp.fromDate(new Date(pendingCommissionSave.effectiveFrom));
      if (selectedActiveRule) {
        await updateDoc(doc(firestore, ACCOUNTING_COLLECTIONS.paymentCommissionRules, selectedActiveRule.id), {
          isActive: false,
          validTo: validFromTimestamp,
          updatedAt: serverTimestamp(),
          updatedBy: actorUid,
        });
      }

      if (pendingCommissionSave.enabled) {
        await addDoc(collection(firestore, ACCOUNTING_COLLECTIONS.paymentCommissionRules), {
          paymentMethodId: pendingCommissionSave.method.id,
          percentageBps: pendingCommissionSave.totalBps,
          isActive: true,
          validFrom: validFromTimestamp,
          validTo: null,
          setByUid: actorUid,
          breakdown: pendingCommissionSave.breakdown,
          notes: commissionNotes.trim() || null,
          createdAt: serverTimestamp(),
          createdBy: actorUid,
          updatedAt: serverTimestamp(),
          updatedBy: actorUid,
        });
      }

      if (pendingCommissionSave.method.id === ACCOUNTING_PAYMENT_METHOD_IDS.credit && summary?.activeConfig) {
        await accountingCallables.upsertFinancialConfig(buildFinancialConfigPayload(summary.activeConfig, {
          effectiveFrom: pendingCommissionSave.effectiveFrom,
          creditCommissionPctBps: pendingCommissionSave.totalBps,
          notes: 'Sincronizacion de comision desde Accounting / Medios de pago',
        }));
      }

      setNotice({
        kind: 'success',
        message: pendingCommissionSave.enabled
          ? `Comision de ${pendingCommissionSave.method.name} actualizada a ${formatBps(pendingCommissionSave.totalBps)}.`
          : `Comision de ${pendingCommissionSave.method.name} desactivada.`,
      });
      setPendingCommissionSave(null);
      await reloadAll();
    } catch (saveError) {
      setNotice({ kind: 'error', message: saveError instanceof Error ? saveError.message : 'No pudimos guardar la comision.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="accounting-shell">
      <section className="floating-card accounting-hero">
        <div className="accounting-hero__copy">
          <p className="eyebrow">Medios de pago</p>
          <h1>Canales activos, bancarizacion y comisiones</h1>
          <p>Activar o desactivar un medio queda como operacion controlada. Las comisiones se versionan por medio y fecha efectiva.</p>
        </div>
      </section>

      <AccountingInlineNotice notice={notice ?? (error ? { kind: 'error', message: error } : null)} />

      <AccountingCollapsibleSections
        openId={openSectionId}
        onOpenChange={setOpenSectionId}
        sections={[
          {
            id: 'list',
            title: 'Canales activos de pago',
            eyebrow: 'Listado',
            helper: 'Activacion, bancarizacion, estado y comision vigente',
            content: (
              <div className="accounting-full-width-section accounting-payment-methods-section">
                <div className="accounting-section-header accounting-section-header--plain">
                  <h3>Canales activos de pago</h3>
                  <UiActionButton
                    type="button"
                    variant="secondary"
                    disabled={!paymentMethods.length}
                    onClick={() => setOpenSectionId('commissions')}
                  >
                    Agregar o modificar comision
                  </UiActionButton>
                </div>
                <div className="accounting-table-wrap">
                  <table className="accounting-data-table accounting-payment-methods-table">
                    <thead>
                      <tr>
                        <th>Medio</th>
                        <th>Bancarizacion</th>
                        <th>Estado</th>
                        <th>Comision vigente</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentMethods.map((method) => {
                        const activeRule = activeRuleByMethodId.get(method.id) ?? null;
                        return (
                          <tr key={method.id}>
                            <td>
                              <strong>{method.name}</strong>
                              <small>{method.specialReportingType ?? 'Operacion general'}</small>
                            </td>
                            <td>{method.bancarizado ? 'Bancarizado' : 'No bancarizado'}</td>
                            <td><span className={`status-chip status-chip--${method.active ? 'paid' : 'voided'}`}>{method.active ? 'activo' : 'inactivo'}</span></td>
                            <td>
                              <strong>{activeRule ? formatBps(activeRule.percentageBps) : 'Sin comision'}</strong>
                              <small>{activeRule ? `Desde ${formatTimestamp(activeRule.validFrom)}` : 'Sin regla activa'}</small>
                            </td>
                            <td>
                              <div className="member-actions accounting-row-menu-actions">
                                <button
                                  type="button"
                                  className={`icon-button member-icon-button ${openMethodActionsId === method.id ? 'icon-button--active' : ''}`}
                                  aria-label={`Mas acciones para ${method.name}`}
                                  aria-expanded={openMethodActionsId === method.id}
                                  onClick={() => setOpenMethodActionsId((current) => current === method.id ? null : method.id)}
                                >
                                  ...
                                </button>
                                {openMethodActionsId === method.id && (
                                  <div className="member-actions-menu">
                                    <button
                                      type="button"
                                      className="member-actions-menu__item"
                                      onClick={() => {
                                        setSelectedCommissionMethodId(method.id);
                                        setOpenSectionId('commissions');
                                        setOpenMethodActionsId(null);
                                      }}
                                    >
                                      Configurar comision
                                    </button>
                                    <button
                                      type="button"
                                      className={method.active ? 'member-actions-menu__item member-actions-menu__item--danger' : 'member-actions-menu__item'}
                                      disabled={!canConfigure || saving}
                                      onClick={() => {
                                        setPendingToggle({ method, active: !method.active });
                                        setOpenMethodActionsId(null);
                                      }}
                                    >
                                      {method.active ? 'Desactivar medio' : 'Activar medio'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!loading && paymentMethods.length === 0 && (
                        <tr>
                          <td colSpan={5}><AccountingEmptyState title="Sin medios configurados" /></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          },
          {
            id: 'commissions',
            title: 'Comisiones por medio de pago',
            eyebrow: 'Comisiones',
            helper: 'Seleccion, desglose, total y fecha efectiva',
            content: paymentMethods.length > 0 ? (
              <form className="accounting-commission-workbench" onSubmit={handleCommissionSubmit}>
                <div className="accounting-entry-form">
                  <label className="form-field">
                    <span>Medio de pago</span>
                    <select
                      value={selectedCommissionMethodId}
                      disabled={!canConfigure || saving}
                      onChange={(event) => setSelectedCommissionMethodId(event.target.value)}
                    >
                      {paymentMethods.map((method) => (
                        <option key={method.id} value={method.id}>{method.name}</option>
                      ))}
                    </select>
                    <small>El selector cambia el panel de comision renderizado abajo.</small>
                  </label>
                  <label className="form-field">
                    <span>Vigente desde</span>
                    <input type="date" value={validFrom} disabled={!canConfigure || saving} onChange={(event) => setValidFrom(event.target.value)} />
                    <small>No altera movimientos historicos ya posteados.</small>
                  </label>
                </div>

                {selectedMethod && (
                  <section className="accounting-commission-card">
                    <div className="accounting-commission-card__header">
                      <div>
                        <p className="eyebrow">Medio seleccionado</p>
                        <h3>{selectedMethod.name}</h3>
                        <small>{selectedMethod.bancarizado ? 'Bancarizado' : 'No bancarizado'} - {selectedMethod.active ? 'activo' : 'inactivo'}</small>
                      </div>
                      <div className="accounting-commission-card__total">
                        <span>Total</span>
                        <strong>{formatBps(commissionTotalBps)}</strong>
                        <small>{activeCommissionLineCount} items activos</small>
                      </div>
                    </div>

                    <label className="check-field accounting-commission-toggle">
                      <input
                        type="checkbox"
                        checked={commissionEnabled}
                        disabled={!canConfigure || saving}
                        onChange={(event) => setCommissionEnabled(event.target.checked)}
                      />
                      <span>Activar comision para este medio de pago</span>
                    </label>

                    {selectedActiveRule && (
                      <div className="accounting-inline-summary">
                        <span>Regla activa actual</span>
                        <strong>{formatBps(selectedActiveRule.percentageBps)}</strong>
                        <small>Desde {formatTimestamp(selectedActiveRule.validFrom)}</small>
                      </div>
                    )}

                    {commissionEnabled ? (
                      <div className="accounting-commission-lines">
                        <div className="accounting-commission-lines__header">
                          <div>
                            <p className="eyebrow">Desglose</p>
                            <h4>Componentes de comision</h4>
                          </div>
                          <UiActionButton type="button" variant="secondary" disabled={!canConfigure || saving} onClick={addCommissionLine}>
                            Agregar item
                          </UiActionButton>
                        </div>
                        {commissionLines.map((line) => (
                          <article key={line.id} className={`accounting-commission-line ${line.active ? '' : 'accounting-commission-line--inactive'}`}>
                            <label className="form-field">
                              <span>Detalle</span>
                              <input value={line.label} disabled={!canConfigure || saving} onChange={(event) => updateCommissionLine(line.id, { label: event.target.value })} />
                            </label>
                            <label className="form-field">
                              <span>Porcentaje</span>
                              <input inputMode="decimal" value={line.percentage} disabled={!canConfigure || saving || !line.active} onChange={(event) => updateCommissionLine(line.id, { percentage: event.target.value })} />
                            </label>
                            <div className="accounting-row__meta">
                              <span className={`status-chip status-chip--${line.active ? 'paid' : 'voided'}`}>{line.active ? 'activo' : 'inactivo'}</span>
                              <strong>{formatBps(line.active ? parsePercentToBps(line.percentage) : 0)}</strong>
                            </div>
                            <div className="member-actions accounting-row-menu-actions">
                              <button
                                type="button"
                                className={`icon-button member-icon-button ${openLineActionsId === line.id ? 'icon-button--active' : ''}`}
                                aria-label={`Mas acciones para ${line.label}`}
                                aria-expanded={openLineActionsId === line.id}
                                onClick={() => setOpenLineActionsId((current) => current === line.id ? null : line.id)}
                              >
                                ...
                              </button>
                              {openLineActionsId === line.id && (
                                <div className="member-actions-menu">
                                  <button
                                    type="button"
                                    className="member-actions-menu__item"
                                    disabled={!canConfigure || saving}
                                    onClick={() => {
                                      updateCommissionLine(line.id, { active: !line.active });
                                      setOpenLineActionsId(null);
                                    }}
                                  >
                                    {line.active ? 'Desactivar item' : 'Activar item'}
                                  </button>
                                  <button
                                    type="button"
                                    className="member-actions-menu__item member-actions-menu__item--danger"
                                    disabled={!canConfigure || saving || commissionLines.length <= 1}
                                    onClick={() => removeCommissionLine(line.id)}
                                  >
                                    Eliminar item
                                  </button>
                                </div>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <AccountingInlineNotice notice={{ kind: 'info', message: 'La comision quedara desactivada para este medio desde la fecha indicada.' }} />
                    )}

                    <label className="form-field accounting-commission-notes">
                      <span>Nota de auditoria</span>
                      <textarea value={commissionNotes} disabled={!canConfigure || saving} onChange={(event) => setCommissionNotes(event.target.value)} />
                    </label>
                    <div className="form-actions">
                      <UiActionButton type="submit" disabled={!canConfigure || saving}>
                        {saving ? 'Guardando...' : 'Guardar comision'}
                      </UiActionButton>
                    </div>
                  </section>
                )}
              </form>
            ) : (
              <AccountingEmptyState title="Sin medios configurados" />
            ),
          },
        ]}
      />

      {!canConfigure && (
        <AccountingInlineNotice notice={{ kind: 'info', message: 'Tu rol puede consultar medios de pago, pero solo Directivo puede activarlos o cambiar comisiones.' }} />
      )}

      <ConfirmDialog
        open={Boolean(pendingToggle)}
        title={pendingToggle?.active ? 'Activar medio de pago' : 'Desactivar medio de pago'}
        description={
          pendingToggle
            ? `${pendingToggle.method.name} quedara ${pendingToggle.active ? 'disponible' : 'bloqueado'} para nuevas operaciones desde ahora.`
            : undefined
        }
        confirmLabel={pendingToggle?.active ? 'Activar' : 'Desactivar'}
        tone={pendingToggle?.active ? 'default' : 'danger'}
        loading={saving}
        onCancel={() => setPendingToggle(null)}
        onConfirm={() => void confirmToggle()}
      />

      <ConfirmDialog
        open={Boolean(pendingCommissionSave)}
        title={pendingCommissionSave?.enabled ? 'Guardar comision' : 'Desactivar comision'}
        description={
          pendingCommissionSave
            ? `${pendingCommissionSave.method.name}: quedara ${pendingCommissionSave.enabled ? `con comision total ${formatBps(pendingCommissionSave.totalBps)}` : 'sin comision activa'} desde ${validFrom}.`
            : undefined
        }
        confirmLabel={pendingCommissionSave?.enabled ? 'Guardar regla' : 'Desactivar comision'}
        tone={pendingCommissionSave?.enabled ? 'default' : 'danger'}
        loading={saving}
        onCancel={() => setPendingCommissionSave(null)}
        onConfirm={() => void confirmCommissionSave()}
      />
    </div>
  );
}
