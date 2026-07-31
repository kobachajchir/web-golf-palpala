import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { EntityWithId, FinancialMovementDocument } from '../../../modules/accounting/domain/models';
import { createAccountingCallables } from '../../../modules/accounting/functions/accounting.callables';
import { createFinancialMovementsRepository } from '../../../modules/accounting/infrastructure/firestore/repositories';
import type { EmployeeDocument, MemberDocument } from '../../../modules/users/domain/models';
import type { PaymentMethod } from '../types/payment';
import {
  buildArgentinaDateIso,
  formatCurrency,
  getSignedMovementAmount,
  parseAmountInputToMinor,
  timestampToDate,
} from '../utils/accountingFormatters';
import { getCategoryLabel } from '../utils/accountingCategories';
import { calculatePaymentCommission, getPaymentMethodDisplayName } from '../utils/paymentMethods';
import { isMovementExcludedFromBalance } from '../utils/balanceInclusion';
import { AccountingOperationModal } from './AccountingOperationModal';
import { InstallmentProgress } from './InstallmentProgress';
import { PaymentCommissionSummary } from './PaymentCommissionSummary';

const accountingCallables = createAccountingCallables();

function formatMovementDateTime(value: FinancialMovementDocument['operationDate'] | Date | null | undefined) {
  const date = timestampToDate(value);
  if (!date) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getEmployeeDisplayName(employee: EntityWithId<EmployeeDocument>) {
  return `${employee.lastName}, ${employee.firstName}`;
}

function resolveMovementThirdPartyLabel(
  movement: EntityWithId<FinancialMovementDocument>,
  members: Array<EntityWithId<MemberDocument>>,
  employees: Array<EntityWithId<EmployeeDocument>>,
) {
  if (movement.thirdPartyType === 'member' && movement.thirdPartyId) {
    const member = members.find((entry) => entry.id === movement.thirdPartyId);
    return member ? `${member.lastName}, ${member.firstName} - socio ${member.memberNumber}` : movement.thirdPartyId;
  }
  if (movement.thirdPartyType === 'employee' && movement.thirdPartyId) {
    const employee = employees.find((entry) => entry.id === movement.thirdPartyId);
    return employee ? getEmployeeDisplayName(employee) : movement.thirdPartyId;
  }
  if (typeof movement.metadata?.payerName === 'string' && movement.metadata.payerName.trim()) {
    return movement.metadata.payerName;
  }
  if (typeof movement.metadata?.vendorName === 'string' && movement.metadata.vendorName.trim()) {
    return movement.metadata.vendorName;
  }
  return movement.thirdPartyId ?? 'Sin persona asociada';
}

function readSchedule(movement: EntityWithId<FinancialMovementDocument>) {
  const schedule = movement.metadata?.installmentSchedule;
  return Array.isArray(schedule)
    ? schedule.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : [];
}

function formatPeriod(period: unknown) {
  if (typeof period !== 'string' || !/^\d{4}-\d{2}$/.test(period)) {
    return 'Sin periodo';
  }
  const [year, month] = period.split('-');
  return `${month}/${year}`;
}

export function AccountingMovementDetailModal({
  movement,
  members = [],
  employees = [],
  paymentMethods = [],
  initialAction = 'details',
  onSelectMovement,
  onChanged,
  onClose,
}: {
  movement: EntityWithId<FinancialMovementDocument>;
  members?: Array<EntityWithId<MemberDocument>>;
  employees?: Array<EntityWithId<EmployeeDocument>>;
  paymentMethods?: PaymentMethod[];
  initialAction?: 'details' | 'register-partial-payment';
  onSelectMovement?: (movement: EntityWithId<FinancialMovementDocument>) => void;
  onChanged?: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [linkedMovements, setLinkedMovements] = useState<Array<EntityWithId<FinancialMovementDocument>>>([]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [savingInstallment, setSavingInstallment] = useState(false);
  const [installmentError, setInstallmentError] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? '');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [partialAmount, setPartialAmount] = useState('');
  const paymentFormRef = useRef<HTMLFormElement | null>(null);
  const partialAmountInputRef = useRef<HTMLInputElement | null>(null);
  const handledInitialActionRef = useRef(false);
  const planId = movement.installmentPlanId ?? null;

  const loadPlan = async () => {
    if (!planId) {
      setLinkedMovements([]);
      return;
    }
    setLoadingPlan(true);
    try {
      setLinkedMovements(await createFinancialMovementsRepository().listByInstallmentPlanId(planId));
    } finally {
      setLoadingPlan(false);
    }
  };

  useEffect(() => {
    void loadPlan();
  }, [planId]);

  useEffect(() => {
    if (!paymentMethods.some((method) => method.id === paymentMethodId)) {
      setPaymentMethodId(paymentMethods[0]?.id ?? '');
    }
  }, [paymentMethodId, paymentMethods]);

  const rootMovement = useMemo(
    () => linkedMovements.find((entry) => entry.installmentRole === 'charge')
      ?? (movement.installmentRole === 'charge' ? movement : null),
    [linkedMovements, movement],
  );
  const paidInstallments = useMemo(
    () => linkedMovements
      .filter((entry) => entry.installmentRole === 'payment' && entry.status === 'posted')
      .sort((left, right) => (left.installmentNumber ?? 0) - (right.installmentNumber ?? 0)),
    [linkedMovements],
  );
  const schedule = rootMovement ? readSchedule(rootMovement) : [];
  const installmentCount = rootMovement?.installmentCount ?? schedule.length;
  const isFlexiblePartialPlan = rootMovement?.metadata?.partialPaymentMode === 'flexible' || Boolean(rootMovement && installmentCount === 0);
  const planTotalAmountMinor = rootMovement?.installmentTotalAmountMinor ?? rootMovement?.netAmountMinor ?? 0;
  const planPaidAmountMinor = rootMovement?.installmentPaidAmountMinor ?? 0;
  const planRemainingAmountMinor = Math.max(planTotalAmountMinor - planPaidAmountMinor, 0);
  const completed = Boolean(rootMovement && (isFlexiblePartialPlan
    ? planRemainingAmountMinor === 0
    : (rootMovement.installmentPaidCount ?? 0) >= installmentCount));
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === paymentMethodId) ?? null;
  const nextInstallmentIndex = rootMovement?.installmentPaidCount ?? 0;
  const nextSchedule = schedule[nextInstallmentIndex] ?? {};
  const parsedPartialAmountMinor = parseAmountInputToMinor(partialAmount);
  const nextInstallmentAmountMinor = isFlexiblePartialPlan
    ? (Number.isFinite(parsedPartialAmountMinor) ? parsedPartialAmountMinor : 0)
    : typeof nextSchedule.amountMinor === 'number'
      ? nextSchedule.amountMinor
      : rootMovement?.installmentScheduledAmountMinor ?? 0;
  const nextPaymentCommission = calculatePaymentCommission(nextInstallmentAmountMinor, selectedPaymentMethod);
  useEffect(() => {
    handledInitialActionRef.current = false;
  }, [initialAction, movement.id]);

  useEffect(() => {
    if (
      initialAction !== 'register-partial-payment'
      || handledInitialActionRef.current
      || !isFlexiblePartialPlan
      || completed
      || !paymentFormRef.current
    ) return undefined;
    handledInitialActionRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      paymentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      partialAmountInputRef.current?.focus();
      partialAmountInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [completed, initialAction, isFlexiblePartialPlan, rootMovement?.id]);

  useEffect(() => {
    if (isFlexiblePartialPlan && planRemainingAmountMinor > 0) {
      setPartialAmount(String(planRemainingAmountMinor / 100));
    }
  }, [isFlexiblePartialPlan, planRemainingAmountMinor, rootMovement?.id]);

  const handleInstallmentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rootMovement || !paymentMethodId) {
      setInstallmentError('Selecciona un medio de pago.');
      return;
    }
    if (isFlexiblePartialPlan && (!Number.isFinite(parsedPartialAmountMinor) || parsedPartialAmountMinor <= 0 || parsedPartialAmountMinor > planRemainingAmountMinor)) {
      setInstallmentError('Ingresa un monto mayor a cero que no supere el saldo pendiente.');
      return;
    }
    setSavingInstallment(true);
    setInstallmentError('');
    try {
      await accountingCallables.registerInstallmentPayment({
        installmentPlanId: rootMovement.id,
        paymentMethodId,
        operationDate: buildArgentinaDateIso(todayInputValue()),
        ...(isFlexiblePartialPlan ? { amountMinor: parsedPartialAmountMinor } : {}),
        paymentReference: paymentReference.trim() || null,
        notes: paymentNotes.trim() || null,
      });
      setPaymentReference('');
      setPaymentNotes('');
      await Promise.all([loadPlan(), Promise.resolve(onChanged?.())]);
    } catch (error) {
      setInstallmentError(error instanceof Error ? error.message : 'No pudimos registrar la cuota.');
    } finally {
      setSavingInstallment(false);
    }
  };

  return (
    <AccountingOperationModal title="Detalle del movimiento" onClose={onClose}>
      <section className="accounting-movement-detail">
        {isMovementExcludedFromBalance(movement) && (
          <div className="profile-note accounting-balance-exclusion-note">
            Este movimiento esta visible para auditoria, pero no se cuenta en el balance.
            {movement.balanceExclusionReason ? ` Motivo: ${movement.balanceExclusionReason}` : ''}
          </div>
        )}
        <div className={`accounting-movement-detail__hero accounting-movement-detail__hero--${movement.movementType}`}>
          <span>Detalle del Movimiento</span>
          <div>
            <strong>{movement.movementType === 'income' ? 'Ingreso' : 'Egreso'}</strong>
            <strong>{formatCurrency(getSignedMovementAmount(movement))}</strong>
          </div>
          {movement.installmentPlanId && (
            <div className="accounting-movement-detail__pills">
              <span className="status-chip status-chip--installments">{movement.metadata?.partialPaymentMode === 'flexible' ? 'PAGOS PARCIALES' : 'CUOTAS'}</span>
              {movement.installmentRole === 'charge' && <span className="status-chip status-chip--charge">CARGA</span>}
            </div>
          )}
        </div>
        <dl className="description-list">
          <div><dt>Categoria</dt><dd>{getCategoryLabel(movement.categoryId)}</dd></div>
          <div><dt>Medio de pago</dt><dd>{getPaymentMethodDisplayName(movement.paymentMethodCodeSnapshot)}</dd></div>
          <div><dt>Fecha y hora</dt><dd>{formatMovementDateTime(movement.operationDate)}</dd></div>
          <div><dt>Registrado por</dt><dd>{(() => {
            const actorUid = movement.registeredByUid || movement.createdBy;
            const employee = employees.find((entry) => entry.linkedUserId === actorUid);
            return employee
              ? `${employee.lastName}, ${employee.firstName}${employee.employeeCode ? ` - legajo ${employee.employeeCode}` : ''}`
              : 'Usuario del sistema';
          })()}</dd></div>
          <div><dt>Persona</dt><dd>{resolveMovementThirdPartyLabel(movement, members, employees)}</dd></div>
          <div><dt>Referencia</dt><dd>{typeof movement.metadata?.paymentReference === 'string' ? movement.metadata.paymentReference : 'Sin referencia'}</dd></div>
          <div><dt>Notas</dt><dd>{movement.notes ?? (typeof movement.metadata?.description === 'string' ? movement.metadata.description : 'Sin notas')}</dd></div>
        </dl>

        {movement.appliedCommissionPctBps !== null && movement.appliedCommissionPctBps !== undefined && (
          <PaymentCommissionSummary
            direction={movement.movementType}
            baseAmountMinor={movement.movementType === 'income' ? movement.netAmountMinor : movement.grossAmountMinor}
            commissionAmountMinor={movement.appliedCommissionAmountMinor ?? 0}
            commissionPctBps={movement.appliedCommissionPctBps}
            totalAmountMinor={movement.movementType === 'income' ? movement.grossAmountMinor : movement.netAmountMinor}
          />
        )}

        {rootMovement && (
          <section className="accounting-installment-detail">
            <div className="accounting-section-header accounting-section-header--plain">
              <div>
                <p className="eyebrow">{isFlexiblePartialPlan ? 'Pagos parciales' : 'Cuotas'}</p>
                <h3>{isFlexiblePartialPlan ? 'Pagos parciales y movimientos asociados' : 'Cuotas y movimientos asociados'}</h3>
              </div>
              <strong>{isFlexiblePartialPlan ? `${formatCurrency(planRemainingAmountMinor)} pendientes` : `${rootMovement.installmentPaidCount ?? 0} de ${installmentCount} pagadas`}</strong>
            </div>
            {!isFlexiblePartialPlan && <InstallmentProgress movement={rootMovement} />}
            <dl className="description-list accounting-installment-summary">
              <div><dt>Importe base</dt><dd>{formatCurrency(rootMovement.installmentBaseAmountMinor ?? 0)}</dd></div>
              <div><dt>Interes total</dt><dd>{((rootMovement.installmentInterestPctBps ?? 0) / 100).toFixed(2)}% - {formatCurrency(rootMovement.installmentInterestAmountMinor ?? 0)}</dd></div>
              {!isFlexiblePartialPlan && <div><dt>Interes mensual promedio</dt><dd>{formatCurrency(Math.round((rootMovement.installmentInterestAmountMinor ?? 0) / Math.max(installmentCount, 1)))}</dd></div>}
              {isFlexiblePartialPlan && <div><dt>Pagado</dt><dd>{formatCurrency(planPaidAmountMinor)}</dd></div>}
              {isFlexiblePartialPlan && <div><dt>Saldo</dt><dd>{formatCurrency(planRemainingAmountMinor)}</dd></div>}
              <div><dt>Total</dt><dd>{formatCurrency(rootMovement.installmentTotalAmountMinor ?? rootMovement.netAmountMinor)}</dd></div>
            </dl>

            <div className="accounting-table-wrap">
              <table className="accounting-data-table accounting-installment-table">
                <thead><tr><th>Item</th><th>Periodo</th><th>Interes</th><th>Medio</th><th>Estado</th><th>Monto</th><th>Accion</th></tr></thead>
                <tbody>
                  <tr>
                    <td><span className="status-chip status-chip--charge">CARGA</span></td>
                    <td>{rootMovement.accountingPeriod}</td>
                    <td>{formatCurrency(rootMovement.installmentInterestAmountMinor ?? 0)}</td>
                    <td>Sin medio</td>
                    <td><span className={`status-chip status-chip--${completed ? 'paid' : 'pending'}`}>{completed ? 'Completa' : 'Pendiente'}</span></td>
                    <td>{formatCurrency(rootMovement.installmentTotalAmountMinor ?? rootMovement.netAmountMinor)}</td>
                    <td><button type="button" className="btn-secondary" onClick={() => onSelectMovement?.(rootMovement)}>Ver movimiento</button></td>
                  </tr>
                  {isFlexiblePartialPlan && paidInstallments.map((payment, index) => (
                    <tr key={payment.id}>
                      <td><strong>Pago {index + 1}</strong></td>
                      <td>{payment.accountingPeriod}</td>
                      <td>{formatCurrency(typeof payment.metadata?.monthlyInterestAmountMinor === 'number' ? payment.metadata.monthlyInterestAmountMinor : 0)}</td>
                      <td>{getPaymentMethodDisplayName(payment.paymentMethodCodeSnapshot)}</td>
                      <td><span className="status-chip status-chip--paid">Registrado</span></td>
                      <td>{formatCurrency(payment.installmentScheduledAmountMinor ?? payment.netAmountMinor)}</td>
                      <td><button type="button" className="btn-secondary" onClick={() => onSelectMovement?.(payment)}>Ver movimiento</button></td>
                    </tr>
                  ))}
                  {!isFlexiblePartialPlan && Array.from({ length: installmentCount }, (_, index) => {
                    const installmentNumber = index + 1;
                    const payment = paidInstallments.find((entry) => entry.installmentNumber === installmentNumber) ?? null;
                    const scheduled = schedule[index] ?? {};
                    const amountMinor = typeof scheduled.amountMinor === 'number'
                      ? scheduled.amountMinor
                      : payment?.installmentScheduledAmountMinor ?? 0;
                    const interestMinor = typeof scheduled.interestAmountMinor === 'number'
                      ? scheduled.interestAmountMinor
                      : typeof payment?.metadata?.monthlyInterestAmountMinor === 'number'
                        ? payment.metadata.monthlyInterestAmountMinor
                        : 0;
                    return (
                      <tr key={installmentNumber}>
                        <td><strong>Cuota {installmentNumber}/{installmentCount}</strong></td>
                        <td>{formatPeriod(scheduled.period)}</td>
                        <td>{formatCurrency(interestMinor)}</td>
                        <td>{payment ? getPaymentMethodDisplayName(payment.paymentMethodCodeSnapshot) : 'A definir'}</td>
                        <td><span className={`status-chip status-chip--${payment ? 'paid' : 'pending'}`}>{payment ? 'Pagada' : 'Pendiente'}</span></td>
                        <td>{formatCurrency(amountMinor)}</td>
                        <td>{payment ? <button type="button" className="btn-secondary" onClick={() => onSelectMovement?.(payment)}>Ver movimiento</button> : 'Sin movimiento'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!completed && (
              <form ref={paymentFormRef} className="accounting-entry-form accounting-installment-payment-form" onSubmit={handleInstallmentSubmit}>
                <div className="accounting-section-header accounting-section-header--plain form-field--wide">
                  <div><p className="eyebrow">{isFlexiblePartialPlan ? 'Nuevo pago parcial' : 'Siguiente cuota'}</p><h4>{isFlexiblePartialPlan ? 'Registrar pago' : `Registrar cuota ${(rootMovement.installmentPaidCount ?? 0) + 1}`}</h4></div>
                </div>
                {isFlexiblePartialPlan && (
                  <label className="form-field accounting-money-field"><span>Importe aplicado al saldo</span><input ref={partialAmountInputRef} type="number" min="0.01" max={planRemainingAmountMinor / 100} step="0.01" inputMode="decimal" value={partialAmount} onChange={(event) => setPartialAmount(event.target.value)} /><small>Saldo disponible: {formatCurrency(planRemainingAmountMinor)}</small></label>
                )}
                <label className="form-field">
                  <span>Medio de pago</span>
                  <select value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)}>
                    {paymentMethods.length === 0 && <option value="">Sin medios activos</option>}
                    {paymentMethods.map((method) => <option key={method.id} value={method.id}>{getPaymentMethodDisplayName(method)}</option>)}
                  </select>
                </label>
                <label className="form-field"><span>Referencia</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label>
                <label className="form-field form-field--wide"><span>Notas</span><textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} /></label>
                {selectedPaymentMethod && (
                  <PaymentCommissionSummary
                    direction={rootMovement.movementType}
                    baseAmountMinor={nextInstallmentAmountMinor}
                    commissionAmountMinor={nextPaymentCommission.commissionAmountMinor}
                    commissionPctBps={nextPaymentCommission.percentageBps}
                    totalAmountMinor={nextPaymentCommission.totalAmountMinor}
                    breakdown={selectedPaymentMethod.activeCommissionBreakdown ?? []}
                  />
                )}
                {installmentError && <div className="error-message form-field--wide">{installmentError}</div>}
                <div className="form-actions form-actions--right form-field--wide">
                  <button type="submit" className="btn-primary" disabled={savingInstallment || loadingPlan || !paymentMethodId}>
                    {savingInstallment ? 'Registrando...' : isFlexiblePartialPlan ? 'Registrar pago parcial' : 'Registrar cuota'}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}
      </section>
    </AccountingOperationModal>
  );
}
