import { useState } from 'react';
import { createAccountingCallables, type MemberFeePlanRecoveryResult } from '../../../modules/accounting/functions/accounting.callables';
import { UiActionButton } from '../../../components/UiActionButton';
import { AccountingInlineNotice } from './AccountingInlineNotice';
import type { AccountingNotice } from '../types/accounting';
import { accountingErrorMessage } from '../utils/accountingErrors';
import { formatCurrency, formatPeriod } from '../utils/accountingFormatters';

const api = createAccountingCallables();
export function MemberFeePlanRecovery() {
  const [planId, setPlanId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<MemberFeePlanRecoveryResult | null>(null);
  const [notice, setNotice] = useState<AccountingNotice>(null);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  async function review(execute: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const next = await api.recoverMemberFeePlan({ planId: planId.trim(), chargeIds: selected, execute, reason, expectedRevision: result?.revision ?? '' });
      setResult(next);
      setReviewed(!execute && selected.length > 0);
      setNotice({ kind: execute ? 'success' : 'info', message: execute ? 'Conciliación aplicada y auditada. Los ingresos y sus fechas se conservaron.' : 'Compará las cuotas con los comprobantes antes de aplicar. No se asignan meses automáticamente.' });
    } catch (error) { setReviewed(false); setNotice({ kind: 'error', message: accountingErrorMessage(error) }); }
    finally { setBusy(false); }
  }
  return <section className="floating-card accounting-panel">
    <h3>Asociar cuotas a un plan antiguo</h3>
    <p>Usá los comprobantes del socio para seleccionar las cuotas cubiertas. Los planes con saldo quedan asociados para continuar sus abonos; las cuotas sólo se cancelan al completar el total.</p>
    <AccountingInlineNotice notice={notice} />
    <form onSubmit={(event) => { event.preventDefault(); void review(false); }}>
      <fieldset disabled={busy || result?.applied} className="accounting-entry-form" style={{ border: 0, padding: 0 }}>
        <label className="form-field form-field--wide"><span>Identificador del plan (desde su movimiento)</span><input required value={planId} onChange={(event) => { setPlanId(event.target.value); setResult(null); setSelected([]); setReviewed(false); }} /></label>
        {result && <div className="form-field--wide">
          <strong>{result.memberName || 'Socio identificado'} · Capital {formatCurrency(result.capitalAmountMinor)} · Pagos efectivos {formatCurrency(result.effectivePaidAmountMinor)}</strong>
          {!result.complete && <p role="alert">El plan conserva saldo: la asociación reservará las cuotas para continuar pagando desde su detalle.</p>}
          <h4>Comprobantes registrados</h4>
          {result.payments.map((payment) => <p key={payment.id}>{payment.receiptNumber || 'Sin número de recibo'} · {formatCurrency(payment.amountMinor)} · Referencia {payment.id}</p>)}
          <h4>Cuotas candidatas: elegí según los comprobantes</h4>
          {result.candidates.map((charge) => <label className="check-field" key={charge.id}><input type="checkbox" checked={selected.includes(charge.id)} onChange={() => { setReviewed(false); setSelected((current) => current.includes(charge.id) ? current.filter((id) => id !== charge.id) : [...current, charge.id]); }} /><span>{formatPeriod(charge.period)} · {formatCurrency(charge.amountMinor)} · {charge.status === 'paid' ? 'Pagada' : charge.status === 'overdue' ? 'Vencida' : charge.status === 'exempt' ? 'Exenta' : 'Pendiente'}</span></label>)}
          <label className="form-field"><span>Motivo y comprobantes que justifican la asociación</span><textarea value={reason} onChange={(event) => { setReason(event.target.value); setReviewed(false); }} /></label>
          {reviewed && <div role="status"><h4>Cambios propuestos</h4>{result.changes.map((change) => <p key={change.chargeId}>{formatPeriod(change.period)}: saldo {formatCurrency(change.before.remainingAmountMinor)} → {formatCurrency(change.after.remainingAmountMinor)}. {result.complete ? 'Quedará pagada.' : 'Quedará reservada para este plan.'}</p>)}<p>Se guardarán responsable, motivo y valores anteriores y posteriores.</p></div>}
        </div>}
        <div className="form-actions form-field--wide"><UiActionButton type="submit" disabled={busy}>{busy ? 'Procesando…' : 'Revisar asociación'}</UiActionButton>{reviewed && result && <UiActionButton type="button" disabled={busy || reason.trim().length < 10} onClick={() => void review(true)}>Confirmar reparación</UiActionButton>}</div>
      </fieldset>
      {result?.applied && <UiActionButton type="button" onClick={() => { setResult(null); setPlanId(''); setSelected([]); setReason(''); setNotice(null); }}>Revisar otro plan</UiActionButton>}
    </form>
  </section>;
}
