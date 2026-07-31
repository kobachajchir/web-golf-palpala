import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { IconActionMenu } from '../../../components/IconActionMenu';
import { UiActionButton } from '../../../components/UiActionButton';
import { ROLES } from '../../../constants/roles';
import { useAuth } from '../../../hooks/useAuth';
import type { EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import type { PaymentMethod } from '../types/payment';
import type { ExpenseCategoryOption, IncomeCategoryOption } from '../utils/accountingCategories';
import { getCategoryLabel } from '../utils/accountingCategories';
import {
  buildArgentinaDateIso,
  formatCurrency,
  parseAmountInputToMinor,
  timestampToDate,
} from '../utils/accountingFormatters';
import { calculatePaymentCommission, getPaymentMethodDisplayName } from '../utils/paymentMethods';
import { AccountingOperationModal } from './AccountingOperationModal';
import { DangerActionDialog } from './DangerActionDialog';
import { PaymentCommissionSummary } from './PaymentCommissionSummary';

const accountingCallables = createAccountingCallables();

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
    </svg>
  );
}

function toDateInputValue(movement: EntityWithId<FinancialMovementDocument>) {
  const date = timestampToDate(movement.operationDate);
  return date
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date)
    : '';
}

function amountMinorToInputValue(amountMinor: number) {
  const amount = amountMinor / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function getMetadataString(movement: EntityWithId<FinancialMovementDocument>, key: string) {
  const value = movement.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function getThirdPartyLabel(movement: EntityWithId<FinancialMovementDocument>) {
  return getMetadataString(movement, 'payerName')
    || getMetadataString(movement, 'vendorName')
    || getMetadataString(movement, 'employeeName')
    || movement.thirdPartyId
    || '';
}

function formatMovementDate(movement: EntityWithId<FinancialMovementDocument>) {
  const date = timestampToDate(movement.operationDate);
  return date
    ? new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date)
    : 'sin fecha';
}

function MovementEditModal({
  movement,
  incomeCategories,
  expenseCategories,
  paymentMethods,
  saving,
  error,
  onClose,
  onSave,
}: {
  movement: EntityWithId<FinancialMovementDocument>;
  incomeCategories: IncomeCategoryOption[];
  expenseCategories: ExpenseCategoryOption[];
  paymentMethods: PaymentMethod[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (payload: {
    categoryId: string;
    paymentMethodId: string | null;
    grossAmountMinor: number;
    operationDate: string;
    description: string | null;
    paymentReference: string | null;
    thirdPartyLabel: string | null;
    notes: string | null;
    reason: string;
  }) => Promise<void>;
}) {
  const categories = movement.movementType === 'income' ? incomeCategories : expenseCategories;
  const initialPaymentMethodId = movement.paymentMethodId ?? movement.paymentMethodCodeSnapshot ?? '';
  const [form, setForm] = useState(() => ({
    categoryId: movement.categoryId,
    paymentMethodId: initialPaymentMethodId,
    amount: amountMinorToInputValue(movement.movementType === 'income' ? movement.netAmountMinor : movement.grossAmountMinor),
    operationDate: toDateInputValue(movement),
    description: getMetadataString(movement, 'description'),
    paymentReference: getMetadataString(movement, 'paymentReference'),
    thirdPartyLabel: getThirdPartyLabel(movement),
    notes: movement.notes ?? '',
    reason: '',
  }));
  const parsedAmountMinor = parseAmountInputToMinor(form.amount);
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === form.paymentMethodId) ?? null;
  const paymentCommission = calculatePaymentCommission(parsedAmountMinor, selectedPaymentMethod);
  const canSubmit =
    form.categoryId.length > 0
    && form.operationDate.length > 0
    && Number.isFinite(parsedAmountMinor)
    && parsedAmountMinor > 0
    && form.reason.trim().length >= 5
    && form.paymentMethodId.length > 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    await onSave({
      categoryId: form.categoryId,
      paymentMethodId: form.paymentMethodId || null,
      grossAmountMinor: parsedAmountMinor,
      operationDate: buildArgentinaDateIso(form.operationDate),
      description: form.description.trim() || null,
      paymentReference: form.paymentReference.trim() || null,
      thirdPartyLabel: form.thirdPartyLabel.trim() || null,
      notes: form.notes.trim() || null,
      reason: form.reason.trim(),
    });
  };

  return (
    <AccountingOperationModal
      title="Editar movimiento"
      meta={`${movement.movementType === 'income' ? 'Ingreso' : 'Egreso'} del ${formatMovementDate(movement)}`}
      onClose={saving ? () => undefined : onClose}
    >
      <section className="floating-card accounting-panel">
        <form className="accounting-entry-form accounting-dialog-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="profile-note form-field--wide">
            La modificación conserva el movimiento y registra los valores anteriores, el responsable y el motivo en su auditoría.
          </div>
          <label className="form-field">
            <span>Tipo</span>
            <input value={movement.movementType === 'income' ? 'Ingreso' : 'Egreso'} readOnly />
          </label>
          <label className="form-field">
            <span>Fecha</span>
            <input
              type="date"
              value={form.operationDate}
              onChange={(event) => setForm((current) => ({ ...current, operationDate: event.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Categoría</span>
            <select
              value={form.categoryId}
              onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
            >
              {!categories.some((category) => category.id === form.categoryId) && (
                <option value={form.categoryId}>{getCategoryLabel(form.categoryId)}</option>
              )}
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>Medio de pago</span>
            <select
              value={form.paymentMethodId}
              onChange={(event) => setForm((current) => ({ ...current, paymentMethodId: event.target.value }))}
            >
              <option value="">Seleccionar cuenta...</option>
              {!paymentMethods.some((method) => method.id === form.paymentMethodId) && form.paymentMethodId && (
                <option value={form.paymentMethodId}>{getPaymentMethodDisplayName(form.paymentMethodId)}</option>
              )}
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>{getPaymentMethodDisplayName(method)}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{movement.movementType === 'income' ? 'Importe para el club ARS' : 'Importe del pago ARS'}</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={form.amount}
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
            />
          </label>
          {selectedPaymentMethod && Number.isFinite(parsedAmountMinor) && parsedAmountMinor > 0 && (
            <PaymentCommissionSummary
              direction={movement.movementType}
              baseAmountMinor={parsedAmountMinor}
              commissionAmountMinor={paymentCommission.commissionAmountMinor}
              commissionPctBps={paymentCommission.percentageBps}
              totalAmountMinor={paymentCommission.totalAmountMinor}
              breakdown={selectedPaymentMethod.activeCommissionBreakdown ?? []}
            />
          )}
          <label className="form-field">
            <span>Persona o tercero</span>
            <input
              value={form.thirdPartyLabel}
              onChange={(event) => setForm((current) => ({ ...current, thirdPartyLabel: event.target.value }))}
            />
          </label>
          <label className="form-field form-field--wide">
            <span>Descripción</span>
            <input
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label className="form-field">
            <span>Referencia</span>
            <input
              value={form.paymentReference}
              onChange={(event) => setForm((current) => ({ ...current, paymentReference: event.target.value }))}
            />
          </label>
          <label className="form-field form-field--wide">
            <span>Notas</span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
          <label className="form-field form-field--wide">
            <span>Motivo de la modificación</span>
            <textarea
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
            />
            <small>{form.reason.trim().length < 5 ? 'Ingresá un motivo de al menos 5 caracteres.' : 'El motivo quedará registrado en auditoría.'}</small>
          </label>
          {error && <div className="profile-note profile-note--danger form-field--wide">{error}</div>}
          <div className="form-actions form-field--wide">
            <UiActionButton type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</UiActionButton>
            <UiActionButton type="submit" disabled={saving || !canSubmit}>{saving ? 'Guardando...' : 'Guardar cambios'}</UiActionButton>
          </div>
        </form>
      </section>
    </AccountingOperationModal>
  );
}

function InternalTransferEditModal({
  movement,
  counterpartMovement,
  paymentMethods,
  saving,
  error,
  onClose,
  onSave,
}: {
  movement: EntityWithId<FinancialMovementDocument>;
  counterpartMovement?: EntityWithId<FinancialMovementDocument> | null | undefined;
  paymentMethods: PaymentMethod[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (payload: {
    sourcePaymentMethodId: string;
    destinationPaymentMethodId: string;
    reference: string | null;
    notes: string | null;
    reason: string;
  }) => Promise<void>;
}) {
  const outgoing = movement.movementType === 'expense'
    ? movement
    : counterpartMovement?.movementType === 'expense'
      ? counterpartMovement
      : null;
  const incoming = movement.movementType === 'income'
    ? movement
    : counterpartMovement?.movementType === 'income'
      ? counterpartMovement
      : null;
  const [form, setForm] = useState(() => ({
    sourcePaymentMethodId: getMetadataString(movement, 'sourcePaymentMethodId')
      || (outgoing?.paymentMethodId ?? outgoing?.paymentMethodCodeSnapshot ?? ''),
    destinationPaymentMethodId: getMetadataString(movement, 'destinationPaymentMethodId')
      || (incoming?.paymentMethodId ?? incoming?.paymentMethodCodeSnapshot ?? ''),
    reference: getMetadataString(movement, 'transferReference'),
    notes: movement.notes ?? counterpartMovement?.notes ?? '',
    reason: '',
  }));
  const canSubmit = form.sourcePaymentMethodId.length > 0
    && form.destinationPaymentMethodId.length > 0
    && form.sourcePaymentMethodId !== form.destinationPaymentMethodId
    && form.reason.trim().length >= 5;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    await onSave({
      sourcePaymentMethodId: form.sourcePaymentMethodId,
      destinationPaymentMethodId: form.destinationPaymentMethodId,
      reference: form.reference.trim() || null,
      notes: form.notes.trim() || null,
      reason: form.reason.trim(),
    });
  };

  return (
    <AccountingOperationModal
      title="Editar movimiento entre cuentas"
      meta={`${formatCurrency(movement.netAmountMinor)} del ${formatMovementDate(movement)}`}
      onClose={saving ? () => undefined : onClose}
    >
      <section className="floating-card accounting-panel">
        <form className="accounting-entry-form accounting-dialog-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="profile-note form-field--wide">
            Se actualizarán juntas las dos partes de la transferencia: el egreso de la cuenta origen y el ingreso en la cuenta destino. El cambio quedará registrado en auditoría.
          </div>
          <label className="form-field">
            <span>Cuenta de origen</span>
            <select
              value={form.sourcePaymentMethodId}
              onChange={(event) => setForm((current) => ({ ...current, sourcePaymentMethodId: event.target.value }))}
            >
              <option value="">Seleccionar cuenta...</option>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>{getPaymentMethodDisplayName(method)}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Cuenta de destino</span>
            <select
              value={form.destinationPaymentMethodId}
              onChange={(event) => setForm((current) => ({ ...current, destinationPaymentMethodId: event.target.value }))}
            >
              <option value="">Seleccionar cuenta...</option>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>{getPaymentMethodDisplayName(method)}</option>
              ))}
            </select>
          </label>
          {form.sourcePaymentMethodId && form.sourcePaymentMethodId === form.destinationPaymentMethodId && (
            <div className="profile-note profile-note--danger form-field--wide">La cuenta de origen y la de destino deben ser distintas.</div>
          )}
          <label className="form-field form-field--wide">
            <span>Referencia</span>
            <input
              value={form.reference}
              onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))}
            />
          </label>
          <label className="form-field form-field--wide">
            <span>Notas</span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
          <label className="form-field form-field--wide">
            <span>Motivo de la modificación</span>
            <textarea
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
            />
            <small>{form.reason.trim().length < 5 ? 'Ingresá un motivo de al menos 5 caracteres.' : 'El motivo quedará registrado en auditoría.'}</small>
          </label>
          {error && <div className="profile-note profile-note--danger form-field--wide">{error}</div>}
          <div className="form-actions form-field--wide">
            <UiActionButton type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</UiActionButton>
            <UiActionButton type="submit" disabled={saving || !canSubmit}>{saving ? 'Guardando...' : 'Guardar cambios'}</UiActionButton>
          </div>
        </form>
      </section>
    </AccountingOperationModal>
  );
}

function BalanceInclusionModal({
  movement,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  movement: EntityWithId<FinancialMovementDocument>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const isExcluded = movement.excludeFromBalance === true;
  const affectsLinkedMovement = Boolean(movement.reversalOfMovementId)
    || movement.originType === 'movement_reversal'
    || movement.originType === 'internal_transfer';
  const canSubmit = reason.trim().length >= 5;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    await onConfirm(reason.trim());
  };

  return (
    <AccountingOperationModal
      title={isExcluded ? 'Volver a contar en balance' : 'No contar en balance'}
      meta={`${movement.movementType === 'income' ? 'Ingreso' : 'Egreso'} de ${formatCurrency(movement.netAmountMinor)}`}
      onClose={saving ? () => undefined : onClose}
    >
      <section className="floating-card accounting-panel">
        <form className="accounting-entry-form accounting-dialog-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="profile-note accounting-balance-exclusion-note form-field--wide">
            {isExcluded
              ? 'El movimiento volverá a participar en los saldos, totales y gráficos contables.'
              : 'El movimiento seguirá visible y auditable, pero no sumará ni restará en los saldos, totales o gráficos.'}
            {affectsLinkedMovement && (
              <> El cambio también se aplicará a su movimiento vinculado para mantener la operación completa fuera del balance.</>
            )}
          </div>
          <label className="form-field form-field--wide">
            <span>Motivo</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            <small>{canSubmit ? 'El motivo quedará registrado en auditoría.' : 'Ingresá un motivo de al menos 5 caracteres.'}</small>
          </label>
          {error && <div className="profile-note profile-note--danger form-field--wide">{error}</div>}
          <div className="form-actions form-field--wide">
            <UiActionButton type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</UiActionButton>
            <UiActionButton
              type="submit"
              className="accounting-balance-exclusion-button"
              disabled={saving || !canSubmit}
            >
              {saving ? 'Guardando...' : isExcluded ? 'Volver a contar' : 'No contar en balance'}
            </UiActionButton>
          </div>
        </form>
      </section>
    </AccountingOperationModal>
  );
}

export function AccountingMovementActions({
  movement,
  counterpartMovement,
  incomeCategories,
  expenseCategories,
  paymentMethods,
  onChanged,
}: {
  movement: EntityWithId<FinancialMovementDocument>;
  counterpartMovement?: EntityWithId<FinancialMovementDocument> | null;
  incomeCategories: IncomeCategoryOption[];
  expenseCategories: ExpenseCategoryOption[];
  paymentMethods: PaymentMethod[];
  onChanged?: () => void | Promise<void>;
}) {
  const { interfaceMode } = useAuth();
  const canManage = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.COMITE_EJECUTIVO;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [balanceInclusionOpen, setBalanceInclusionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isInternalTransfer = movement.originType === 'internal_transfer';
  const movementDescription = useMemo<ReactNode>(() => (
    <>
      Estás por eliminar contablemente el {movement.movementType === 'income' ? 'ingreso' : 'egreso'} de{' '}
      <strong>{formatCurrency(movement.netAmountMinor)}</strong>, categoría <strong>{getCategoryLabel(movement.categoryId)}</strong>, del{' '}
      <strong>{formatMovementDate(movement)}</strong>. El registro no se borra físicamente: quedará revertido y se generará el contramovimiento correspondiente.
    </>
  ), [movement]);

  if (!canManage || movement.installmentPlanId) {
    return null;
  }

  const saveEdit = async (payload: {
    categoryId: string;
    paymentMethodId: string | null;
    grossAmountMinor: number;
    operationDate: string;
    description: string | null;
    paymentReference: string | null;
    thirdPartyLabel: string | null;
    notes: string | null;
    reason: string;
  }) => {
    setSaving(true);
    setError('');
    try {
      await accountingCallables.editFinancialMovement({ movementId: movement.id, ...payload });
      setEditOpen(false);
      await onChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No pudimos modificar el movimiento.');
    } finally {
      setSaving(false);
    }
  };

  const deleteMovement = async () => {
    setSaving(true);
    setError('');
    try {
      await accountingCallables.voidFinancialMovement({
        movementId: movement.id,
        reason: deleteReason.trim(),
      });
      setDeleteOpen(false);
      setDeleteReason('');
      await onChanged?.();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No pudimos eliminar el movimiento.');
    } finally {
      setSaving(false);
    }
  };

  const saveInternalTransfer = async (payload: {
    sourcePaymentMethodId: string;
    destinationPaymentMethodId: string;
    reference: string | null;
    notes: string | null;
    reason: string;
  }) => {
    setSaving(true);
    setError('');
    try {
      await accountingCallables.editInternalTransfer({ movementId: movement.id, ...payload });
      setEditOpen(false);
      await onChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No pudimos modificar la transferencia.');
    } finally {
      setSaving(false);
    }
  };

  const changeBalanceInclusion = async (reason: string) => {
    setSaving(true);
    setError('');
    try {
      await accountingCallables.setFinancialMovementBalanceInclusion({
        movementId: movement.id,
        excluded: movement.excludeFromBalance !== true,
        reason,
      });
      setBalanceInclusionOpen(false);
      await onChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No pudimos actualizar la inclusión en balance.');
    } finally {
      setSaving(false);
    }
  };

  const balanceInclusionMenuItem = {
    id: 'balance-inclusion',
    label: movement.excludeFromBalance === true ? 'Volver a contar en balance' : 'No contar en balance',
    warning: true,
    disabled: movement.status === 'voided',
    onSelect: () => {
      setMenuOpen(false);
      setError('');
      setBalanceInclusionOpen(true);
    },
  };

  return (
    <>
      <IconActionMenu
        label={`Más opciones para movimiento ${movement.id}`}
        icon={<MoreIcon />}
        open={menuOpen}
        onToggle={() => setMenuOpen((current) => !current)}
        items={isInternalTransfer
          ? [
              {
                id: 'edit-transfer',
                label: 'Editar cuentas',
                accent: true,
                disabled: movement.status !== 'posted',
                onSelect: () => {
                  setMenuOpen(false);
                  setError('');
                  setEditOpen(true);
                },
              },
              balanceInclusionMenuItem,
            ]
          : [
              {
                id: 'edit',
                label: 'Editar movimiento',
                accent: true,
                disabled: movement.status !== 'posted',
                onSelect: () => {
                  setMenuOpen(false);
                  setError('');
                  setEditOpen(true);
                },
              },
              balanceInclusionMenuItem,
              {
                id: 'delete',
                label: 'Eliminar movimiento',
                danger: true,
                disabled: movement.status === 'voided' || movement.status === 'reversed',
                onSelect: () => {
                  setMenuOpen(false);
                  setError('');
                  setDeleteOpen(true);
                },
              },
            ]}
      />
      {editOpen && isInternalTransfer && (
        <InternalTransferEditModal
          movement={movement}
          counterpartMovement={counterpartMovement}
          paymentMethods={paymentMethods}
          saving={saving}
          error={error}
          onClose={() => setEditOpen(false)}
          onSave={saveInternalTransfer}
        />
      )}
      {editOpen && !isInternalTransfer && (
        <MovementEditModal
          movement={movement}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          paymentMethods={paymentMethods}
          saving={saving}
          error={error}
          onClose={() => setEditOpen(false)}
          onSave={saveEdit}
        />
      )}
      {balanceInclusionOpen && (
        <BalanceInclusionModal
          movement={movement}
          saving={saving}
          error={error}
          onClose={() => setBalanceInclusionOpen(false)}
          onConfirm={changeBalanceInclusion}
        />
      )}
      {!isInternalTransfer && <DangerActionDialog
        open={deleteOpen}
        title="Eliminar movimiento"
        description={(
          <>
            {movementDescription}
            {error && <p className="form-error">{error}</p>}
          </>
        )}
        reason={deleteReason}
        confirmLabel="Eliminar movimiento"
        loading={saving}
        onReasonChange={setDeleteReason}
        onCancel={() => {
          setDeleteOpen(false);
          setDeleteReason('');
          setError('');
        }}
        onConfirm={() => void deleteMovement()}
      />}
    </>
  );
}
