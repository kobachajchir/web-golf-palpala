import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { UiActionButton } from '../../../components/UiActionButton';
import { ACCOUNTING_INCOME_CATEGORY_IDS } from '../../../modules/accounting/domain/constants';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import type { EntityWithId, MemberDocument } from '../../../modules/users/domain/models';
import type { AccountingNotice } from '../types/accounting';
import type { PaymentMethod } from '../types/payment';
import type { IncomeCategoryOption } from '../utils/accountingCategories';
import { buildArgentinaDateIso, getPersonDisplayName, parseAmountInputToMinor } from '../utils/accountingFormatters';

const accountingCallables = createAccountingCallables();
const REGISTER_PAYMENT_TIMEOUT_MS = 25000;

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

export function ManualIncomeForm({
  incomeCategories,
  paymentMethods,
  members = [],
  onNotice,
  onRegistered,
  showMemberDebtAction = true,
}: {
  incomeCategories: IncomeCategoryOption[];
  paymentMethods: PaymentMethod[];
  members?: Array<EntityWithId<MemberDocument>>;
  onNotice: (notice: AccountingNotice) => void;
  onRegistered?: () => void | Promise<void>;
  showMemberDebtAction?: boolean;
}) {
  const selectableIncomeCategories = useMemo(
    () => incomeCategories.filter((category) => category.id !== ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria),
    [incomeCategories],
  );
  const defaultCategoryId = useMemo(
    () => selectableIncomeCategories.find((category) => category.id === ACCOUNTING_INCOME_CATEGORY_IDS.greenFee)?.id
      ?? selectableIncomeCategories[0]?.id
      ?? '',
    [selectableIncomeCategories],
  );
  const defaultPaymentMethodId = paymentMethods[0]?.id ?? '';
  const [form, setForm] = useState({
    categoryId: defaultCategoryId,
    paymentMethodId: defaultPaymentMethodId,
    description: '',
    payerSearch: '',
    amount: '',
    operationDate: todayInputValue(),
    paymentReference: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const selectedCategoryIsMembershipFee = form.categoryId === ACCOUNTING_INCOME_CATEGORY_IDS.cuotaSocietaria;

  useEffect(() => {
    setForm((current) => ({
      ...current,
      categoryId: selectableIncomeCategories.some((category) => category.id === current.categoryId)
        ? current.categoryId
        : defaultCategoryId,
      paymentMethodId: current.paymentMethodId || defaultPaymentMethodId,
    }));
  }, [defaultCategoryId, defaultPaymentMethodId, selectableIncomeCategories]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountMinor = parseAmountInputToMinor(form.amount);
    if (selectedCategoryIsMembershipFee) {
      onNotice({ kind: 'error', message: 'La cuota societaria se cobra desde Renovaciones para generar o reutilizar la cuota pendiente.' });
      return;
    }
    if (!form.categoryId || !form.paymentMethodId || !Number.isFinite(amountMinor) || amountMinor <= 0) {
      onNotice({ kind: 'error', message: 'Completa categoria, medio de pago y monto valido.' });
      return;
    }
    const selectedMember = members.find((member) => {
      const displayName = `${getPersonDisplayName(member)} - socio ${member.memberNumber}`.toLowerCase();
      return displayName === form.payerSearch.trim().toLowerCase();
    }) ?? null;

    let registered = false;
    setSaving(true);
    try {
      const result = await withTimeout(
        accountingCallables.registerPayment({
          sourceType: 'manual_income',
          memberId: selectedMember?.id ?? null,
          thirdPartyType: selectedMember ? 'member' : form.payerSearch.trim() ? 'external' : null,
          thirdPartyId: selectedMember?.id ?? null,
          categoryId: form.categoryId,
          paymentMethodId: form.paymentMethodId,
          paymentReference: form.paymentReference.trim() || null,
          grossAmountMinor: amountMinor,
          operationDate: buildArgentinaDateIso(form.operationDate),
          notes: form.notes.trim() || form.description.trim() || null,
          metadata: {
            description: form.description.trim() || null,
            categoryId: form.categoryId,
            payerName: form.payerSearch.trim() || null,
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
      <div className="accounting-section-header">
        <div>
          <p className="eyebrow">Generar nuevo cobro</p>
          <h2>Cobro por categoria de ingreso</h2>
          <p>Usa las categorias contables existentes; las cuotas societarias pendientes se cobran desde Renovaciones.</p>
        </div>
        {showMemberDebtAction && <UiActionButton to="/accounting/member-dues?tab=renewals" variant="secondary">Ver renovaciones</UiActionButton>}
      </div>

      <form className="accounting-entry-form accounting-dialog-form accounting-dialog-form--income" onSubmit={handleSubmit}>
        <label className="form-field form-field--wide">
          <span>Categoria de ingreso</span>
          <select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}>
            {selectableIncomeCategories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label className="form-field form-field--wide">
          <span>Persona o pagador</span>
          <input
            list="manual-income-payers"
            value={form.payerSearch}
            onChange={(event) => setForm((current) => ({ ...current, payerSearch: event.target.value }))}
            placeholder="Buscar socio o cargar pagador externo"
          />
          <datalist id="manual-income-payers">
            {members.map((member) => (
              <option key={member.id} value={`${getPersonDisplayName(member)} - socio ${member.memberNumber}`} />
            ))}
          </datalist>
        </label>
        <label className="form-field">
          <span>Medio de pago</span>
          <select value={form.paymentMethodId} onChange={(event) => setForm((current) => ({ ...current, paymentMethodId: event.target.value }))}>
            {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
          </select>
        </label>
        <label className="form-field"><span>Fecha</span><input type="date" value={form.operationDate} onChange={(event) => setForm((current) => ({ ...current, operationDate: event.target.value }))} /></label>
        <label className="form-field form-field--wide"><span>Descripcion</span><input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
        <label className="form-field"><span>Referencia</span><input value={form.paymentReference} onChange={(event) => setForm((current) => ({ ...current, paymentReference: event.target.value }))} /></label>
        <label className="form-field accounting-money-field"><span>Monto ARS</span><input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></label>
        <label className="form-field form-field--wide"><span>Notas</span><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
        <div className="form-actions">
          <UiActionButton type="submit" disabled={saving || selectedCategoryIsMembershipFee}>{saving ? 'Registrando...' : 'Registrar cobro'}</UiActionButton>
        </div>
      </form>
    </section>
  );
}
