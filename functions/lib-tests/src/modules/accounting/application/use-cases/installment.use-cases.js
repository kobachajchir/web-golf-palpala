import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { prepareMemberFeeStatus } from '../member-fee-status.js';
import { ACCOUNTING_COLLECTIONS, FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, calculateAmountFromBps, ensureAuthenticatedActor, ensureStaff, parseOptionalNullableString, parseOptionalRecord, parseRequiredAmountMinor, parseRequiredBps, parseRequiredInteger, parseRequiredIsoDate, parseRequiredString, toClubAccountingPeriod, } from '../shared.js';
import { assertCashOperationDateAllowed } from '../cash-closure-guards.js';
import { createPostedMovement } from '../movement-helpers.js';
import { assertChargeNotLockedByPartialPlan } from '../member-fee-plan-lock.js';
import { buildMemberFeeChargeCreateData, computeFeePreviewInternal } from './fee.use-cases.js';
function isAccountingPeriod(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}
function readMemberFeePlanAllocations(metadata) {
    const value = metadata?.memberFeeRenewalAllocations;
    if (!Array.isArray(value))
        return [];
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object')
            return [];
        const record = entry;
        if (!isAccountingPeriod(record.period)
            || typeof record.settlementAmountMinor !== 'number'
            || !Number.isInteger(record.settlementAmountMinor)
            || record.settlementAmountMinor <= 0) {
            return [];
        }
        const discountMode = record.discountMode === 'automatic' || record.discountMode === 'manual'
            ? record.discountMode
            : 'none';
        return [{
                chargeId: typeof record.chargeId === 'string' && record.chargeId.trim() ? record.chargeId : null,
                period: record.period,
                settlementAmountMinor: record.settlementAmountMinor,
                discountPctBps: typeof record.discountPctBps === 'number' ? record.discountPctBps : 0,
                discountAmountMinor: typeof record.discountAmountMinor === 'number' ? record.discountAmountMinor : 0,
                discountMode,
            }];
    });
}
function isOpenMemberFeeCharge(charge) {
    return charge.status === 'pending' || charge.status === 'overdue';
}
async function resolveLegacyMemberFeeAllocation(dataAccess, root) {
    const memberId = root.thirdPartyType === 'member' ? root.thirdPartyId : null;
    const period = root.metadata?.periodMonth;
    if (!memberId || !isAccountingPeriod(period))
        return [];
    const member = await dataAccess.members.getById(memberId);
    if (!member)
        return [];
    const pages = await Promise.all([
        dataAccess.memberFeeCharges.listPage({ memberId, period, limit: 100 }),
        ...(member.familyGroupId
            ? [dataAccess.memberFeeCharges.listPage({ familyGroupId: member.familyGroupId, period, limit: 100 })]
            : []),
    ]);
    const candidates = new Map();
    pages.flatMap((page) => page.items)
        .filter(isOpenMemberFeeCharge)
        .forEach((charge) => candidates.set(charge.id, charge));
    if (candidates.size !== 1)
        return [];
    const charge = [...candidates.values()][0];
    return [{
            chargeId: charge.id,
            period,
            settlementAmountMinor: charge.settlementAmountMinor ?? charge.finalAmountMinor,
            discountPctBps: charge.paymentDiscountPctBps ?? 0,
            discountAmountMinor: charge.paymentDiscountAmountMinor ?? 0,
            discountMode: charge.paymentDiscountMode ?? 'none',
        }];
}
async function prepareCompletedMemberFeeRenewals(params) {
    const actions = [];
    if (params.root.categoryId !== FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria
        && params.root.categoryCodeSnapshot !== FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria) {
        return actions;
    }
    const memberId = typeof params.root.metadata?.memberFeeMemberId === 'string'
        ? params.root.metadata.memberFeeMemberId
        : params.root.thirdPartyType === 'member'
            ? params.root.thirdPartyId
            : null;
    if (!memberId)
        return actions;
    const member = await params.dataAccess.members.getById(memberId);
    if (!member)
        return actions;
    const storedAllocations = readMemberFeePlanAllocations(params.root.metadata);
    const allocations = storedAllocations.length > 0
        ? storedAllocations
        : await resolveLegacyMemberFeeAllocation(params.dataAccess, params.root);
    for (const allocation of allocations) {
        let charge = allocation.chargeId
            ? await params.dataAccess.memberFeeCharges.getById(allocation.chargeId)
            : null;
        let createData = null;
        if (!charge) {
            const preview = await computeFeePreviewInternal({
                dataAccess: params.dataAccess,
                memberId,
                period: allocation.period,
            });
            charge = await params.dataAccess.memberFeeCharges.findDuplicate({
                memberId: preview.billingMode === 'per_member' ? preview.memberId : preview.holderMemberId ?? null,
                familyGroupId: preview.billingMode === 'single_group_charge' ? preview.familyGroupId ?? null : null,
                period: preview.period,
                billingMode: preview.billingMode,
            });
            if (!charge) {
                createData = buildMemberFeeChargeCreateData({
                    preview,
                    actorUid: params.actorUid,
                    dueDate: new Date(allocation.period + '-01T00:00:00-03:00'),
                    notes: 'Cuota creada al completar un plan de pagos parciales.',
                });
                charge = { ...createData, id: 'temp-id' };
            }
        }
        const resolvedCharge = charge;
        const belongsToMember = resolvedCharge.memberId === memberId
            || Boolean(member.familyGroupId && resolvedCharge.familyGroupId === member.familyGroupId);
        assertCondition(belongsToMember && resolvedCharge.period === allocation.period, 'failed-precondition', 'La renovacion vinculada al plan no corresponde al socio y periodo seleccionados.');
        assertCondition(resolvedCharge.status !== 'paid' && resolvedCharge.status !== 'exempt', 'failed-precondition', `La cuota ${resolvedCharge.period} ya fue cobrada por otra via. No se registran mas abonos en este plan para evitar un cobro duplicado.`);
        if (resolvedCharge.activePartialPlanId && resolvedCharge.activePartialPlanId !== params.root.id) {
            await assertChargeNotLockedByPartialPlan(params.dataAccess, resolvedCharge, params.root.id);
        }
        const paidFromRemaining = typeof resolvedCharge.remainingAmountMinor === 'number'
            ? (resolvedCharge.settlementAmountMinor ?? resolvedCharge.finalAmountMinor) - resolvedCharge.remainingAmountMinor
            : 0;
        const previouslyPaidMinor = Math.max(resolvedCharge.paidClubAmountMinor ?? 0, resolvedCharge.paidAmountMinor ?? 0, paidFromRemaining, 0);
        const usesLegacyUnpaidSettlement = resolvedCharge.settlementAmountMinor === resolvedCharge.finalAmountMinor
            && previouslyPaidMinor === 0
            && (resolvedCharge.paymentDiscountAmountMinor ?? 0) === 0;
        const settlementAmountMinor = usesLegacyUnpaidSettlement
            ? allocation.settlementAmountMinor
            : resolvedCharge.settlementAmountMinor ?? allocation.settlementAmountMinor;
        const paidAmountMinor = Math.min(previouslyPaidMinor + allocation.settlementAmountMinor, settlementAmountMinor);
        const completed = paidAmountMinor >= settlementAmountMinor;
        const updatePayload = {
            status: completed ? 'paid' : resolvedCharge.status,
            paidAt: completed ? Timestamp.fromDate(params.paidAt) : resolvedCharge.paidAt ?? null,
            paidAmountMinor,
            settlementAmountMinor,
            paidClubAmountMinor: paidAmountMinor,
            remainingAmountMinor: Math.max(settlementAmountMinor - paidAmountMinor, 0),
            paymentDiscountPctBps: allocation.discountPctBps,
            paymentDiscountAmountMinor: allocation.discountAmountMinor,
            paymentDiscountMode: allocation.discountMode,
            activePartialPlanId: null,
            _completed: completed,
            _previousPaymentMovementIds: resolvedCharge.paymentMovementIds ?? [],
            _previousPaidMovementId: resolvedCharge.paidMovementId ?? null,
        };
        if (createData) {
            actions.push({ type: 'create', data: { ...createData, ...updatePayload } });
        }
        else {
            actions.push({ type: 'update', id: resolvedCharge.id, data: updatePayload });
        }
    }
    return actions;
}
async function applyCompletedMemberFeeRenewals(params) {
    for (const action of params.actions) {
        const { _completed, _previousPaymentMovementIds, _previousPaidMovementId, ...payload } = action.data;
        const finalPayload = {
            ...payload,
            paidMovementId: _completed ? params.paymentMovementId : _previousPaidMovementId,
            paymentMovementIds: [...new Set([..._previousPaymentMovementIds, ...params.paymentMovementIds])],
        };
        if (action.type === 'create') {
            await params.dataAccess.memberFeeCharges.create(finalPayload, params.actorUid);
        }
        else {
            await params.dataAccess.memberFeeCharges.update(action.id, finalPayload, params.actorUid);
        }
    }
}
function isMemberFeePlan(root) {
    return root.categoryId === FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria
        || root.categoryCodeSnapshot === FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria;
}
/**
 * Resuelve (y si hace falta prepara la emision de) las cuotas que cubre un plan de pagos
 * parciales para poder reservarlas. Solo lee: las escrituras se hacen despues de crear el plan.
 */
async function resolvePlanAllocationsForLock(params) {
    const member = await params.dataAccess.members.getById(params.memberId);
    assertCondition(member, 'not-found', `No existe members/${params.memberId}.`);
    const resolved = [];
    const seen = new Set();
    for (const allocation of params.allocations) {
        let charge = allocation.chargeId
            ? await params.dataAccess.memberFeeCharges.getById(allocation.chargeId)
            : null;
        let createData = null;
        if (!charge) {
            const preview = await computeFeePreviewInternal({ dataAccess: params.dataAccess, memberId: params.memberId, period: allocation.period });
            charge = await params.dataAccess.memberFeeCharges.findDuplicate({
                memberId: preview.billingMode === 'per_member' ? preview.memberId : preview.holderMemberId ?? null,
                familyGroupId: preview.billingMode === 'single_group_charge' ? preview.familyGroupId ?? null : null,
                period: preview.period,
                billingMode: preview.billingMode,
            });
            if (!charge) {
                const periodKey = `new:${allocation.period}`;
                assertCondition(!seen.has(periodKey), 'invalid-argument', 'El mismo mes no puede incluirse dos veces en el plan.');
                seen.add(periodKey);
                createData = buildMemberFeeChargeCreateData({
                    preview,
                    actorUid: params.actorUid,
                    dueDate: new Date(allocation.period + '-01T00:00:00-03:00'),
                    notes: 'Cuota emitida al crear un plan de pagos parciales.',
                });
            }
        }
        if (charge) {
            const belongsToMember = charge.memberId === params.memberId
                || charge.holderMemberId === params.memberId
                || Boolean(member.familyGroupId && charge.familyGroupId === member.familyGroupId && charge.billingMode === 'single_group_charge');
            assertCondition(belongsToMember && charge.period === allocation.period, 'failed-precondition', 'La cuota seleccionada no corresponde al socio y periodo del plan.');
            assertCondition(charge.status === 'pending' || charge.status === 'overdue', 'failed-precondition', `La cuota ${charge.period} ya no admite pagos.`);
            await assertChargeNotLockedByPartialPlan(params.dataAccess, charge);
            assertCondition(!seen.has(charge.id), 'invalid-argument', 'La misma cuota no puede incluirse dos veces en el plan.');
            seen.add(charge.id);
        }
        resolved.push({ allocation, existingChargeId: charge?.id ?? null, createData });
    }
    return resolved;
}
/** Antes de aceptar un abono, verifica que las cuotas del plan no se hayan cobrado por otra via. */
async function assertPlanChargesStillOpen(dataAccess, root) {
    if (!isMemberFeePlan(root))
        return;
    for (const allocation of readMemberFeePlanAllocations(root.metadata)) {
        if (!allocation.chargeId)
            continue;
        const charge = await dataAccess.memberFeeCharges.getById(allocation.chargeId);
        if (!charge)
            continue;
        assertCondition(charge.status !== 'paid' && charge.status !== 'exempt', 'failed-precondition', `La cuota ${charge.period} ya fue cobrada por otra via. No se registran mas abonos en este plan para evitar un cobro duplicado; revisa el caso con administracion.`);
        await assertChargeNotLockedByPartialPlan(dataAccess, charge, root.id);
    }
}
function splitAmount(amountMinor, count) {
    const base = Math.floor(amountMinor / count);
    const remainder = amountMinor - base * count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
function addMonthsToPeriod(operationDate, monthOffset) {
    const date = new Date(Date.UTC(operationDate.getUTCFullYear(), operationDate.getUTCMonth() + monthOffset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function readNumberArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
        ? value
        : [];
}
function buildReceiptNumber(operationDate, movementId) {
    const year = operationDate.getUTCFullYear();
    const month = String(operationDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(operationDate.getUTCDate()).padStart(2, '0');
    return `REC-${year}${month}${day}-${movementId.slice(0, 8).toUpperCase()}`;
}
export async function createInstallmentPlanUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        await assertCashOperationDateAllowed({ dataAccess, operationDate: params.input.operationDate });
        assertCondition(params.input.baseAmountMinor > 0, 'invalid-argument', 'El importe debe ser mayor a cero.');
        const isFlexiblePartialPlan = params.input.installmentCount === undefined;
        if (!isFlexiblePartialPlan) {
            assertCondition(params.input.installmentCount >= 2 && params.input.installmentCount <= 120, 'invalid-argument', 'La cantidad de cuotas debe estar entre 2 y 120.');
        }
        assertCondition(params.input.interestPctBps >= 0 && params.input.interestPctBps <= 10000, 'invalid-argument', 'El interes debe estar entre 0 y 100%.');
        const incomeCategory = params.input.movementType === 'income'
            ? await dataAccess.financialIncomeCategories.getById(params.input.categoryId)
            : null;
        const expenseCategory = params.input.movementType === 'expense'
            ? await dataAccess.financialExpenseCategories.getById(params.input.categoryId)
            : null;
        const category = incomeCategory ?? expenseCategory;
        assertCondition(category, 'not-found', `No existe la categoria ${params.input.categoryId}.`);
        assertCondition(category.active, 'failed-precondition', `La categoria ${params.input.categoryId} esta inactiva.`);
        const requestedAllocations = params.input.movementType === 'income' && category.id === FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria
            ? readMemberFeePlanAllocations(params.input.metadata)
            : [];
        const allocationMemberId = typeof params.input.metadata?.memberFeeMemberId === 'string'
            ? params.input.metadata.memberFeeMemberId
            : params.input.thirdPartyType === 'member' ? params.input.thirdPartyId ?? null : null;
        assertCondition(requestedAllocations.length === 0 || Boolean(allocationMemberId), 'invalid-argument', 'El plan de cuotas societarias debe indicar el socio.');
        const resolvedAllocations = requestedAllocations.length > 0
            ? await resolvePlanAllocationsForLock({ dataAccess, actorUid: actor.uid, memberId: allocationMemberId, allocations: requestedAllocations })
            : [];
        const interestAmountMinor = calculateAmountFromBps(params.input.baseAmountMinor, params.input.interestPctBps);
        const totalAmountMinor = params.input.baseAmountMinor + interestAmountMinor;
        const principalAmountsMinor = isFlexiblePartialPlan
            ? [params.input.baseAmountMinor]
            : splitAmount(params.input.baseAmountMinor, params.input.installmentCount);
        const monthlyInterestAmountsMinor = isFlexiblePartialPlan
            ? [interestAmountMinor]
            : splitAmount(interestAmountMinor, params.input.installmentCount);
        const installmentAmountsMinor = principalAmountsMinor.map((principalAmountMinor, index) => principalAmountMinor + (monthlyInterestAmountsMinor[index] ?? 0));
        const schedule = (isFlexiblePartialPlan ? [] : installmentAmountsMinor).map((amountMinor, index) => ({
            installmentNumber: index + 1,
            period: addMonthsToPeriod(params.input.operationDate, index),
            principalAmountMinor: principalAmountsMinor[index],
            interestAmountMinor: monthlyInterestAmountsMinor[index],
            amountMinor,
        }));
        const operationTimestamp = Timestamp.fromDate(params.input.operationDate);
        const movementId = await dataAccess.financialMovements.create({
            movementType: params.input.movementType,
            categoryId: category.id,
            categoryCodeSnapshot: category.id,
            status: 'pending',
            operationDate: operationTimestamp,
            postingDate: null,
            accountingPeriod: toClubAccountingPeriod(params.input.operationDate),
            originType: isFlexiblePartialPlan ? 'partial_payment_plan' : 'installment_charge',
            originCollection: null,
            originId: null,
            thirdPartyType: params.input.thirdPartyType ?? null,
            thirdPartyId: params.input.thirdPartyId ?? null,
            paymentMethodId: null,
            paymentMethodCodeSnapshot: null,
            grossAmountMinor: totalAmountMinor,
            appliedCommissionPctBps: null,
            appliedCommissionAmountMinor: null,
            netAmountMinor: totalAmountMinor,
            installmentPlanId: null,
            installmentRole: 'charge',
            installmentNumber: 0,
            installmentCount: params.input.installmentCount ?? null,
            installmentBaseAmountMinor: params.input.baseAmountMinor,
            installmentInterestPctBps: params.input.interestPctBps,
            installmentInterestAmountMinor: interestAmountMinor,
            installmentTotalAmountMinor: totalAmountMinor,
            installmentScheduledAmountMinor: null,
            installmentPaidAmountMinor: 0,
            installmentPaidCount: 0,
            bancarizado: false,
            imputableImpositivo: params.input.movementType === 'income'
                ? true
                : expenseCategory?.defaultImputableImpositivo ?? false,
            settlementId: null,
            registeredByUid: actor.uid,
            approvedByUid: actor.uid,
            approvedAt: operationTimestamp,
            reversalOfMovementId: null,
            voidReason: null,
            excludeFromBalance: true,
            balanceExclusionReason: isFlexiblePartialPlan
                ? 'Plan de pagos parciales: el balance se actualiza con cada pago efectivo.'
                : 'Carga en cuotas: el balance se actualiza con cada pago efectivo.',
            metadata: {
                ...(params.input.metadata ?? {}),
                partialPaymentMode: isFlexiblePartialPlan ? 'flexible' : 'scheduled',
                installmentSchedule: schedule,
                principalAmountsMinor,
                monthlyInterestAmountsMinor,
                installmentAmountsMinor,
                paymentReference: params.input.paymentReference ?? null,
            },
            notes: params.input.notes ?? null,
        }, actor.uid);
        const lockedAllocations = [];
        for (const entry of resolvedAllocations) {
            let chargeId = entry.existingChargeId;
            if (entry.createData) {
                chargeId = await dataAccess.memberFeeCharges.create({ ...entry.createData, activePartialPlanId: movementId }, actor.uid);
            }
            else if (chargeId) {
                await dataAccess.memberFeeCharges.update(chargeId, { activePartialPlanId: movementId }, actor.uid);
            }
            lockedAllocations.push({ ...entry.allocation, chargeId });
        }
        await dataAccess.financialMovements.update(movementId, {
            installmentPlanId: movementId,
            originId: movementId,
            metadata: {
                ...(params.input.metadata ?? {}),
                ...(resolvedAllocations.length > 0 ? { memberFeeRenewalAllocations: lockedAllocations } : {}),
                installmentPlanId: movementId,
                partialPaymentMode: isFlexiblePartialPlan ? 'flexible' : 'scheduled',
                installmentSchedule: schedule,
                principalAmountsMinor,
                monthlyInterestAmountsMinor,
                installmentAmountsMinor,
                paymentReference: params.input.paymentReference ?? null,
            },
        }, actor.uid);
        return {
            movementId,
            installmentPlanId: movementId,
            installmentCount: params.input.installmentCount ?? null,
            interestAmountMinor,
            totalAmountMinor,
            monthlyInterestAmountsMinor,
            installmentAmountsMinor,
        };
    });
}
export async function registerInstallmentPaymentUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const operationKey = params.input.idempotencyKey ? createHash('sha256').update(actor.uid + ':partial:' + params.input.idempotencyKey).digest('hex') : null;
        const fingerprint = createHash('sha256').update(JSON.stringify(params.input)).digest('hex');
        const previous = operationKey ? await dataAccess.operations?.get(operationKey) : null;
        if (previous) {
            assertCondition(previous.fingerprint === fingerprint, 'already-exists', 'Ya se registro un abono con esta operacion (posiblemente tras un corte o una demora). Revisa el detalle del plan antes de volver a cobrar.', { movementId: previous.result?.movementId ?? null });
            return { ...previous.result, duplicate: true };
        }
        await assertCashOperationDateAllowed({ dataAccess, operationDate: params.input.operationDate });
        const root = await dataAccess.financialMovements.getById(params.input.installmentPlanId);
        assertCondition(root, 'not-found', `No existe la carga ${params.input.installmentPlanId}.`);
        assertCondition(root.installmentRole === 'charge', 'failed-precondition', 'El movimiento no es una carga en cuotas.');
        assertCondition(root.status !== 'voided' && root.status !== 'reversed', 'failed-precondition', 'La carga esta anulada.');
        assertCondition(root.status === 'pending', 'failed-precondition', 'El plan ya esta completo.');
        await assertPlanChargesStillOpen(dataAccess, root);
        const linkedMovements = await dataAccess.financialMovements.listByInstallmentPlanId(root.id);
        const postedPayments = linkedMovements
            .filter((movement) => movement.installmentRole === 'payment' && movement.status === 'posted')
            .sort((left, right) => (left.installmentNumber ?? 0) - (right.installmentNumber ?? 0));
        const installmentCount = root.installmentCount ?? 0;
        const isFlexiblePartialPlan = root.metadata?.partialPaymentMode === 'flexible' || installmentCount === 0;
        const nextInstallmentNumber = postedPayments.length + 1;
        if (!isFlexiblePartialPlan) {
            assertCondition(nextInstallmentNumber <= installmentCount, 'failed-precondition', 'Todas las cuotas ya estan pagadas.');
        }
        const installmentAmountsMinor = readNumberArray(root.metadata?.installmentAmountsMinor);
        const monthlyInterestAmountsMinor = readNumberArray(root.metadata?.monthlyInterestAmountsMinor);
        const totalAmountMinor = root.installmentTotalAmountMinor ?? root.netAmountMinor;
        const currentPaidAmountMinor = root.installmentPaidAmountMinor ?? 0;
        const remainingBeforePaymentMinor = Math.max(totalAmountMinor - currentPaidAmountMinor, 0);
        const scheduledAmountMinor = isFlexiblePartialPlan
            ? params.input.amountMinor
            : installmentAmountsMinor[nextInstallmentNumber - 1];
        assertCondition(typeof scheduledAmountMinor === 'number' && scheduledAmountMinor > 0, 'invalid-argument', isFlexiblePartialPlan ? 'Indica el importe del pago parcial.' : 'La carga no tiene un cronograma de cuotas valido.');
        assertCondition(scheduledAmountMinor <= remainingBeforePaymentMinor, 'invalid-argument', 'El pago supera el saldo pendiente.');
        const paymentMethod = await dataAccess.paymentMethods.getById(params.input.paymentMethodId);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.input.paymentMethodId}.`);
        assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.input.paymentMethodId} esta inactivo.`);
        const paymentReference = params.input.paymentReference?.trim() || null;
        assertCondition(paymentMethod.id === PAYMENT_METHOD_IDS.cash || Boolean(paymentReference), 'invalid-argument', 'La referencia es obligatoria para medios distintos de efectivo.');
        const activeCommissionRule = await dataAccess.paymentCommissionRules.getActiveByPaymentMethodId(paymentMethod.id);
        const paidAmountMinor = currentPaidAmountMinor + scheduledAmountMinor;
        const paidCount = postedPayments.length + 1;
        const completed = paidAmountMinor >= totalAmountMinor;
        let memberFeeActions = [];
        if (completed) {
            memberFeeActions = await prepareCompletedMemberFeeRenewals({
                dataAccess,
                actorUid: actor.uid,
                root,
                paidAt: params.input.operationDate,
            });
        }
        const membershipStatus = completed && root.thirdPartyType === 'member' && root.thirdPartyId
            ? await prepareMemberFeeStatus(dataAccess, root.thirdPartyId, memberFeeActions.map((action) => ({ id: action.type === 'update' ? action.id : undefined, period: action.data.period, status: action.data.status }))) : null;
        const movement = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: root.movementType,
            categoryId: root.categoryId,
            categoryCodeSnapshot: root.categoryCodeSnapshot,
            grossAmountMinor: scheduledAmountMinor,
            operationDate: params.input.operationDate,
            originType: isFlexiblePartialPlan ? 'partial_payment' : 'installment_payment',
            originCollection: ACCOUNTING_COLLECTIONS.financialMovements,
            originId: root.id,
            thirdPartyType: root.thirdPartyType ?? null,
            thirdPartyId: root.thirdPartyId ?? null,
            paymentMethodId: paymentMethod.id,
            prefetchedPaymentMethod: paymentMethod,
            prefetchedActiveCommissionRule: activeCommissionRule,
            bancarizado: paymentMethod.bancarizado,
            imputableImpositivo: root.imputableImpositivo,
            metadata: {
                ...(root.metadata ?? {}),
                installmentPlanId: root.id,
                installmentNumber: nextInstallmentNumber,
                installmentCount: isFlexiblePartialPlan ? null : installmentCount,
                partialPaymentMode: isFlexiblePartialPlan ? 'flexible' : 'scheduled',
                scheduledAmountMinor,
                monthlyInterestAmountMinor: monthlyInterestAmountsMinor[nextInstallmentNumber - 1] ?? 0,
                paymentReference,
            },
            notes: params.input.notes ?? root.notes ?? null,
            applyPaymentCommission: true,
            paymentCommissionMode: root.movementType === 'income' ? 'add_to_charge' : 'add_to_expense',
        });
        const receiptNumber = root.movementType === 'income'
            ? buildReceiptNumber(params.input.operationDate, movement.movementId)
            : null;
        await dataAccess.financialMovements.update(movement.movementId, {
            installmentPlanId: root.id,
            installmentRole: 'payment',
            installmentNumber: nextInstallmentNumber,
            installmentCount: isFlexiblePartialPlan ? null : installmentCount,
            installmentBaseAmountMinor: root.installmentBaseAmountMinor ?? null,
            installmentInterestPctBps: root.installmentInterestPctBps ?? 0,
            installmentInterestAmountMinor: root.installmentInterestAmountMinor ?? 0,
            installmentTotalAmountMinor: root.installmentTotalAmountMinor ?? root.netAmountMinor,
            installmentScheduledAmountMinor: scheduledAmountMinor,
            installmentPaidAmountMinor: paidAmountMinor,
            installmentPaidCount: paidCount,
            metadata: {
                ...(root.metadata ?? {}),
                installmentPlanId: root.id,
                installmentNumber: nextInstallmentNumber,
                installmentCount: isFlexiblePartialPlan ? null : installmentCount,
                partialPaymentMode: isFlexiblePartialPlan ? 'flexible' : 'scheduled',
                scheduledAmountMinor,
                monthlyInterestAmountMinor: monthlyInterestAmountsMinor[nextInstallmentNumber - 1] ?? 0,
                paymentReference,
                receiptNumber,
                receiptIssuedAt: receiptNumber ? Timestamp.fromDate(params.input.operationDate) : null,
                receiptSource: receiptNumber ? 'installment_payment' : null,
                appliedCommissionPctBps: movement.appliedCommissionPctBps,
                appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
                clubAmountMinor: root.movementType === 'income' ? movement.netAmountMinor : null,
                amountToChargeMinor: root.movementType === 'income' ? movement.grossAmountMinor : null,
                expenseBaseAmountMinor: root.movementType === 'expense' ? movement.grossAmountMinor : null,
                expenseTotalDebitedMinor: root.movementType === 'expense' ? movement.netAmountMinor : null,
            },
        }, actor.uid);
        await dataAccess.financialMovements.update(root.id, {
            status: completed ? 'posted' : 'pending',
            installmentPaidAmountMinor: paidAmountMinor,
            installmentPaidCount: paidCount,
        }, actor.uid);
        if (completed) {
            await applyCompletedMemberFeeRenewals({
                dataAccess,
                actorUid: actor.uid,
                actions: memberFeeActions,
                paymentMovementId: movement.movementId,
                paymentMovementIds: [...postedPayments.map((payment) => payment.id), movement.movementId],
            });
        }
        if (membershipStatus && root.thirdPartyId)
            await dataAccess.members.update(root.thirdPartyId, membershipStatus, actor.uid);
        const result = {
            duplicate: false,
            movementId: movement.movementId,
            installmentPlanId: root.id,
            installmentNumber: nextInstallmentNumber,
            installmentCount: isFlexiblePartialPlan ? null : installmentCount,
            scheduledAmountMinor,
            grossAmountMinor: movement.grossAmountMinor,
            netAmountMinor: movement.netAmountMinor,
            paidAmountMinor,
            totalAmountMinor: root.installmentTotalAmountMinor ?? root.netAmountMinor,
            completed,
            receiptNumber,
        };
        if (operationKey)
            await dataAccess.operations?.set(operationKey, fingerprint, result);
        return result;
    });
}
export async function listMyReceiptsUseCase(params) {
    const actor = ensureAuthenticatedActor(params.actor);
    assertCondition(actor.user.active, 'permission-denied', 'El usuario no esta activo.');
    if (actor.user.profileType !== 'member' || !actor.user.profileId) {
        return { receipts: [] };
    }
    const page = await params.transactions.getDataAccess().financialMovements.listPage({
        thirdPartyType: 'member',
        thirdPartyId: actor.user.profileId,
        limit: 100,
    });
    const receipts = page.items
        .filter((movement) => movement.movementType === 'income')
        .map((movement) => {
        const receiptNumber = typeof movement.metadata?.receiptNumber === 'string'
            ? movement.metadata.receiptNumber.trim()
            : '';
        if (!receiptNumber) {
            return null;
        }
        const description = typeof movement.metadata?.description === 'string'
            ? movement.metadata.description.trim()
            : '';
        const tournamentName = typeof movement.metadata?.tournamentName === 'string'
            ? movement.metadata.tournamentName.trim()
            : '';
        const paymentReference = typeof movement.metadata?.paymentReference === 'string'
            ? movement.metadata.paymentReference.trim()
            : null;
        return {
            id: movement.id,
            receiptNumber,
            movementId: movement.id,
            categoryId: movement.categoryId,
            concept: description || tournamentName || movement.categoryCodeSnapshot,
            operationDate: movement.operationDate.toDate().toISOString(),
            accountingPeriod: movement.accountingPeriod,
            paymentMethodId: movement.paymentMethodId ?? null,
            grossAmountMinor: movement.grossAmountMinor,
            netAmountMinor: movement.netAmountMinor,
            appliedCommissionPctBps: movement.appliedCommissionPctBps ?? null,
            appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor ?? null,
            paymentReference,
            notes: movement.notes ?? null,
            status: movement.status,
        };
    })
        .filter((receipt) => receipt !== null);
    return { receipts };
}
export function parseCreateInstallmentPlanInput(payload) {
    const data = assertIsRecord(payload);
    const movementType = parseRequiredString(data, 'movementType');
    assertCondition(movementType === 'income' || movementType === 'expense', 'invalid-argument', 'movementType invalido.');
    const thirdPartyType = parseOptionalNullableString(data, 'thirdPartyType');
    const thirdPartyId = parseOptionalNullableString(data, 'thirdPartyId');
    const paymentReference = parseOptionalNullableString(data, 'paymentReference');
    const notes = parseOptionalNullableString(data, 'notes');
    const metadata = parseOptionalRecord(data, 'metadata');
    return {
        movementType,
        categoryId: parseRequiredString(data, 'categoryId'),
        baseAmountMinor: parseRequiredAmountMinor(data, 'baseAmountMinor'),
        installmentCount: data.installmentCount === undefined ? undefined : parseRequiredInteger(data, 'installmentCount'),
        interestPctBps: parseRequiredBps(data, 'interestPctBps'),
        operationDate: parseRequiredIsoDate(data, 'operationDate'),
        ...(thirdPartyType !== undefined ? { thirdPartyType: thirdPartyType } : {}),
        ...(thirdPartyId !== undefined ? { thirdPartyId } : {}),
        ...(paymentReference !== undefined ? { paymentReference } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
    };
}
export function parseRegisterInstallmentPaymentInput(payload) {
    const data = assertIsRecord(payload);
    const paymentReference = parseOptionalNullableString(data, 'paymentReference');
    const notes = parseOptionalNullableString(data, 'notes');
    return {
        installmentPlanId: parseRequiredString(data, 'installmentPlanId'),
        idempotencyKey: typeof data.idempotencyKey === 'string' ? data.idempotencyKey : undefined,
        paymentMethodId: parseRequiredString(data, 'paymentMethodId'),
        operationDate: parseRequiredIsoDate(data, 'operationDate'),
        amountMinor: data.amountMinor === undefined ? undefined : parseRequiredAmountMinor(data, 'amountMinor'),
        ...(paymentReference !== undefined ? { paymentReference } : {}),
        ...(notes !== undefined ? { notes } : {}),
    };
}
//# sourceMappingURL=installment.use-cases.js.map