import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { Actor, EntityWithId, MemberFeeChargeDocument } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import { assertCondition } from '../../domain/errors.js';
import { ensureDirectivo } from '../shared.js';
import { prepareMemberFeeStatus } from '../member-fee-status.js';

export interface RecoverMemberFeePlanInput {
  planId: string;
  chargeIds: string[];
  execute: boolean;
  reason: string;
  expectedRevision: string;
}

/** Administrative mapping backed by receipts. Never infers coverage from a payment date. */
export async function recoverMemberFeePlanUseCase(params: { actor: Actor | null; input: RecoverMemberFeePlanInput; transactions: AccountingTransactionManager }) {
  const actor = ensureDirectivo(params.actor);
  const input = params.input;
  assertCondition(input.chargeIds.length <= 50 && new Set(input.chargeIds).size === input.chargeIds.length, 'invalid-argument', 'Seleccioná hasta 50 cuotas distintas.');
  return params.transactions.runInTransaction(async (data) => {
    const root = await data.financialMovements.getById(input.planId);
    assertCondition(root && root.installmentRole === 'charge' && root.thirdPartyType === 'member' && root.thirdPartyId && root.categoryCodeSnapshot === 'cuota_societaria', 'failed-precondition', 'El comprobante no corresponde a un plan de cuotas de socio.');
    assertCondition(root.status !== 'voided' && root.status !== 'reversed', 'failed-precondition', 'El plan está anulado.');
    const member = await data.members.getById(root.thirdPartyId);
    assertCondition(member, 'not-found', 'No encontramos al socio del plan.');
    const payments = (await data.financialMovements.listByInstallmentPlanId(root.id))
      .filter((item) => item.installmentRole === 'payment' && item.status === 'posted')
      .sort((a, b) => a.operationDate.toMillis() - b.operationDate.toMillis() || a.id.localeCompare(b.id));
    const effectivePaid = payments.reduce((sum, item) => sum + item.netAmountMinor, 0);
    const total = root.installmentTotalAmountMinor ?? root.netAmountMinor;
    const capital = root.installmentBaseAmountMinor ?? total;
    const complete = effectivePaid === total && total > 0;
    const candidatesById = new Map<string, EntityWithId<MemberFeeChargeDocument>>();
    for (const filter of [{ memberId: member.id }, ...(member.familyGroupId ? [{ familyGroupId: member.familyGroupId }] : [])]) {
      let cursorId: string | undefined;
      do {
        const page = await data.memberFeeCharges.listPage({ ...filter, limit: 100, ...(cursorId ? { cursorId } : {}) });
        for (const charge of page.items) if (charge.memberId === member.id || (charge.billingMode === 'single_group_charge' && charge.familyGroupId === member.familyGroupId)) candidatesById.set(charge.id, charge);
        cursorId = page.nextCursorId;
      } while (cursorId);
    }
    const selected = input.chargeIds.map((id) => {
      const charge = candidatesById.get(id);
      assertCondition(charge, 'failed-precondition', 'Una cuota seleccionada no pertenece al socio ni a su cargo familiar grupal.');
      return charge;
    });
    const revision = createHash('sha256').update(JSON.stringify({ root, payments, selected })).digest('hex');
    const paymentIds = new Set(payments.map((payment) => payment.id));
    const changes = selected.map((charge) => {
      assertCondition(!charge.activePartialPlanId || charge.activePartialPlanId === root.id, 'failed-precondition', 'Una cuota está reservada para otro plan.');
      const linked = [...(charge.paymentMovementIds ?? []), ...(charge.paidMovementId ? [charge.paidMovementId] : [])];
      assertCondition(linked.every((id) => paymentIds.has(id)), 'failed-precondition', 'Una cuota tiene otros pagos. Requiere revisión individual para conservarlos.');
      assertCondition(complete || charge.status !== 'paid', 'failed-precondition', 'Una cuota pagada no puede reservarse para un plan con saldo.');
      assertCondition(charge.status !== 'exempt' && charge.status !== 'cancelled', 'failed-precondition', 'No se puede asociar una cuota exenta o anulada.');
      assertCondition(linked.length > 0 || (charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0) === 0, 'failed-precondition', 'La cuota tiene abonos sin comprobante vinculado. Requiere revisión individual.');
      const settlement = charge.settlementAmountMinor ?? charge.finalAmountMinor;
      return { chargeId: charge.id, period: charge.period, before: { status: charge.status, paidAmountMinor: charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0, remainingAmountMinor: charge.remainingAmountMinor ?? settlement, paymentMovementIds: linked }, after: { status: complete ? 'paid' as const : charge.status, paidAmountMinor: complete ? settlement : charge.paidAmountMinor ?? 0, paidClubAmountMinor: complete ? settlement : charge.paidClubAmountMinor ?? 0, remainingAmountMinor: complete ? 0 : settlement - (charge.paidClubAmountMinor ?? charge.paidAmountMinor ?? 0), settlementAmountMinor: settlement, activePartialPlanId: complete ? null : root.id, paidMovementId: complete ? payments.at(-1)?.id ?? null : charge.paidMovementId ?? null, paymentMovementIds: complete ? [...paymentIds] : charge.paymentMovementIds ?? [], paidAt: complete ? payments.at(-1)?.operationDate ?? null : charge.paidAt ?? null } };
    });
    const selectedCapital = changes.reduce((sum, change) => sum + change.after.settlementAmountMinor, 0);
    const result = { rootBefore: { status: root.status, installmentPaidAmountMinor: root.installmentPaidAmountMinor ?? null, installmentPaidCount: root.installmentPaidCount ?? null, metadata: root.metadata ?? null }, planId: root.id, memberId: member.id, memberName: `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim(), effectivePaidAmountMinor: effectivePaid, capitalAmountMinor: capital, complete, revision, payments: payments.map((payment) => ({ id: payment.id, amountMinor: payment.netAmountMinor, receiptNumber: payment.metadata?.receiptNumber ?? null })), candidates: [...candidatesById.values()].map((charge) => ({ id: charge.id, period: charge.period, status: charge.status, amountMinor: charge.settlementAmountMinor ?? charge.finalAmountMinor })), changes, applied: false };
    if (!input.execute) return result;
    assertCondition(effectivePaid <= total && total > 0 && payments.length > 0 && payments.length <= 100, 'failed-precondition', 'El plan tiene importes inconsistentes, no posee pagos efectivos o excede el tamaño de reparación.');
    assertCondition(changes.length > 0 && selectedCapital === capital, 'failed-precondition', 'El capital de las cuotas seleccionadas debe coincidir con el capital del plan.');
    assertCondition(input.reason.trim().length >= 10, 'invalid-argument', 'Ingresá el motivo y la referencia de los comprobantes (al menos 10 caracteres).');
    assertCondition(input.expectedRevision === revision, 'failed-precondition', 'Los datos cambiaron desde la vista previa. Volvé a revisar antes de aplicar.');
    assertCondition(data.operations, 'failed-precondition', 'No está disponible el registro de auditoría.');
    const auditKey = 'recovery:' + createHash('sha256').update(root.id).digest('hex');
    const previousAudit = await data.operations.get(auditKey);
    assertCondition(!previousAudit, 'failed-precondition', 'Este plan ya fue conciliado. Revisá su auditoría antes de modificarlo otra vez.');
    const status = await prepareMemberFeeStatus(data, member.id, changes.map((change) => ({ id: change.chargeId, period: change.period, status: change.after.status })));
    // All reads above; only metadata and debt applications change, never money or dates.
    for (const change of changes) await data.memberFeeCharges.update(change.chargeId, change.after, actor.uid);
    const allocations = changes.map((change) => ({ chargeId: change.chargeId, period: change.period, settlementAmountMinor: change.after.settlementAmountMinor, discountPctBps: candidatesById.get(change.chargeId)?.paymentDiscountPctBps ?? 0, discountAmountMinor: candidatesById.get(change.chargeId)?.paymentDiscountAmountMinor ?? 0, discountMode: candidatesById.get(change.chargeId)?.paymentDiscountMode ?? 'none' }));
    await data.financialMovements.update(root.id, { status: complete ? 'posted' : 'pending', installmentPaidAmountMinor: effectivePaid, installmentPaidCount: payments.length, metadata: { ...root.metadata, memberFeeMemberId: member.id, memberFeeRenewalAllocations: allocations, recoveryAuditKey: auditKey } }, actor.uid);
    await data.members.update(member.id, status, actor.uid);
    await data.operations.set(auditKey, revision, { ...result, applied: true, actorUid: actor.uid, reason: input.reason.trim(), repairedAt: Timestamp.now() });
    return { ...result, applied: true };
  });
}
