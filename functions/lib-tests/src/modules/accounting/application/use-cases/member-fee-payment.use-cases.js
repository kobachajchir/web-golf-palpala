import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, calculateAmountFromBps, calculateEarlyPaymentDiscount, calculateMembershipRenewalDueDateFromPeriod, ensureStaff, parseOptionalBoolean, parseOptionalNullableString, parseOptionalAccountingPeriod, parseOptionalString, parseRequiredAmountMinor, parseRequiredIsoDate, parseRequiredString, toClubAccountingPeriod, } from '../shared.js';
import { assertCashOperationDateAllowed } from '../cash-closure-guards.js';
import { createPostedMovement } from '../movement-helpers.js';
import { buildMemberFeeChargeCreateData, computeFeePreviewInternal, } from './fee.use-cases.js';
function buildReceiptNumber(operationDate, movementId) {
    const year = operationDate.getUTCFullYear();
    const month = String(operationDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(operationDate.getUTCDate()).padStart(2, '0');
    return `REC-${year}${month}${day}-${movementId.slice(0, 8).toUpperCase()}`;
}
function resolveStoredPaidAmount(charge, settlementAmountMinor) {
    if (typeof charge.paidClubAmountMinor === 'number') {
        return charge.paidClubAmountMinor;
    }
    if (charge.status === 'paid') {
        return charge.paidAmountMinor ?? settlementAmountMinor;
    }
    return charge.paidAmountMinor ?? 0;
}
function allocationIdentity(allocation) {
    return allocation.chargeId ?? `${allocation.memberId ?? ''}:${allocation.period ?? ''}`;
}
function getMembershipPeriodStart(period) {
    return new Date(`${period}-01T00:00:00-03:00`);
}
export async function registerMemberFeeBatchPaymentUseCase(params) {
    const actor = ensureStaff(params.actor);
    assertCondition(params.input.allocations.length > 0, 'invalid-argument', 'Selecciona al menos una cuota para cobrar.');
    assertCondition(params.input.allocations.length <= 100, 'invalid-argument', 'No se pueden cobrar mas de 100 cuotas a la vez.');
    assertCondition(params.input.allocations.every((allocation) => (Boolean(allocation.chargeId)
        ? !allocation.memberId && !allocation.period
        : Boolean(allocation.memberId && allocation.period))), 'invalid-argument', 'Cada cuota debe indicar chargeId o bien memberId y period para crearla al cobrar.');
    assertCondition(new Set(params.input.allocations.map(allocationIdentity)).size === params.input.allocations.length, 'invalid-argument', 'La misma cuota no puede incluirse dos veces en el cobro.');
    return params.transactions.runInTransaction(async (dataAccess) => {
        await assertCashOperationDateAllowed({ dataAccess, operationDate: params.input.operationDate });
        const [category, paymentMethod, activeConfig] = await Promise.all([
            dataAccess.financialIncomeCategories.getById(FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria),
            dataAccess.paymentMethods.getById(params.input.paymentMethodId),
            dataAccess.financialConfigs.getActive(),
        ]);
        assertCondition(category?.active, 'failed-precondition', 'La categoria cuota societaria no esta activa.');
        assertCondition(paymentMethod?.active, 'failed-precondition', 'El medio de pago no esta activo.');
        assertCondition(activeConfig, 'failed-precondition', 'No existe una configuracion financiera activa.');
        const paymentReference = params.input.paymentReference?.trim() || null;
        assertCondition(paymentMethod.id === PAYMENT_METHOD_IDS.cash || Boolean(paymentReference), 'invalid-argument', 'La referencia es obligatoria para medios distintos de efectivo.');
        const prepared = [];
        for (const inputAllocation of params.input.allocations) {
            let createData;
            let charge = inputAllocation.chargeId
                ? await dataAccess.memberFeeCharges.getById(inputAllocation.chargeId)
                : null;
            if (!inputAllocation.chargeId) {
                const memberId = inputAllocation.memberId;
                const period = inputAllocation.period;
                const preview = await computeFeePreviewInternal({ dataAccess, memberId, period });
                charge = await dataAccess.memberFeeCharges.findDuplicate({
                    memberId: preview.billingMode === 'per_member' ? preview.memberId : preview.holderMemberId ?? null,
                    familyGroupId: preview.billingMode === 'single_group_charge' ? preview.familyGroupId ?? null : null,
                    period: preview.period,
                    billingMode: preview.billingMode,
                });
                if (!charge) {
                    createData = buildMemberFeeChargeCreateData({
                        preview,
                        actorUid: actor.uid,
                        dueDate: getMembershipPeriodStart(period),
                        notes: `Cuota ${period} creada dentro del cobro administrativo.`,
                    });
                    const auditTimestamp = Timestamp.fromMillis(0);
                    charge = {
                        id: `pending:${allocationIdentity(inputAllocation)}`,
                        ...createData,
                        createdAt: auditTimestamp,
                        createdBy: actor.uid,
                        updatedAt: auditTimestamp,
                        updatedBy: actor.uid,
                    };
                }
            }
            assertCondition(charge, 'not-found', `No existe member_fee_charges/${inputAllocation.chargeId ?? allocationIdentity(inputAllocation)}.`);
            assertCondition(charge.status === 'pending' || charge.status === 'overdue', 'failed-precondition', `La cuota ${charge.period} ya no admite pagos.`);
            const memberId = charge.memberId ?? charge.holderMemberId ?? null;
            assertCondition(memberId, 'failed-precondition', 'La cuota no tiene socio asociado.');
            const member = await dataAccess.members.getById(memberId);
            assertCondition(member, 'not-found', `No existe members/${memberId}.`);
            assertCondition(!member.membershipBillingExempt, 'failed-precondition', 'El socio esta exento de cuota societaria.');
            let settlementAmountMinor = charge.settlementAmountMinor ?? null;
            let discountPctBps = charge.paymentDiscountPctBps ?? 0;
            let discountAmountMinor = charge.paymentDiscountAmountMinor ?? 0;
            let discountMode = charge.paymentDiscountMode ?? 'none';
            if (inputAllocation.settlementAmountMinor !== undefined) {
                settlementAmountMinor = inputAllocation.settlementAmountMinor;
                assertCondition(settlementAmountMinor > 0, 'invalid-argument', 'El monto final de la cuota debe ser mayor a cero.');
                discountAmountMinor = Math.max(charge.finalAmountMinor - settlementAmountMinor, 0);
                discountPctBps = charge.finalAmountMinor > 0
                    ? Math.round((discountAmountMinor * 10_000) / charge.finalAmountMinor)
                    : 0;
                discountMode = 'manual';
            }
            else if (settlementAmountMinor === null) {
                const paymentAccountingPeriod = toClubAccountingPeriod(params.input.operationDate);
                const isCurrentPeriodCharge = charge.period === paymentAccountingPeriod;
                const preview = calculateEarlyPaymentDiscount({
                    chargeAmountMinor: charge.finalAmountMinor,
                    config: activeConfig,
                    chargePeriod: charge.period,
                    operationDate: params.input.operationDate,
                });
                if (inputAllocation.applyEarlyPaymentDiscount === true && isCurrentPeriodCharge) {
                    discountPctBps = activeConfig.earlyPaymentDiscountPctBps ?? 0;
                    discountAmountMinor = calculateAmountFromBps(charge.finalAmountMinor, discountPctBps);
                    discountMode = preview.qualifies ? 'automatic' : 'manual';
                }
                else if (inputAllocation.applyEarlyPaymentDiscount === undefined && preview.qualifies) {
                    discountPctBps = preview.discountPctBps;
                    discountAmountMinor = preview.discountAmountMinor;
                    discountMode = 'automatic';
                }
                else {
                    discountPctBps = 0;
                    discountAmountMinor = 0;
                    discountMode = 'none';
                }
                settlementAmountMinor = Math.max(charge.finalAmountMinor - discountAmountMinor, 0);
            }
            const previouslyPaidMinor = resolveStoredPaidAmount(charge, settlementAmountMinor);
            const availableMinor = Math.max(settlementAmountMinor - previouslyPaidMinor, 0);
            assertCondition(availableMinor > 0, 'failed-precondition', `La cuota ${charge.period} no tiene saldo pendiente.`);
            const appliedAmountMinor = inputAllocation.amountMinor ?? availableMinor;
            assertCondition(appliedAmountMinor > 0, 'invalid-argument', 'El importe parcial debe ser mayor a cero.');
            assertCondition(appliedAmountMinor <= availableMinor, 'invalid-argument', `El pago supera el saldo de la cuota ${charge.period}.`);
            prepared.push({
                charge,
                memberId,
                settlementAmountMinor,
                previouslyPaidMinor,
                appliedAmountMinor,
                remainingAmountMinor: availableMinor - appliedAmountMinor,
                discountPctBps,
                discountAmountMinor,
                discountMode,
                createData,
            });
        }
        const memberIds = new Set(prepared.map((allocation) => allocation.memberId));
        assertCondition(memberIds.size === 1, 'invalid-argument', 'Un cobro multiple solo puede corresponder a un mismo socio.');
        const memberId = prepared[0].memberId;
        const openChargesBeforePayment = await dataAccess.memberFeeCharges.listPage({ memberId, limit: 100 });
        for (const allocation of prepared) {
            if (!allocation.createData)
                continue;
            const memberFeeChargeId = await dataAccess.memberFeeCharges.create(allocation.createData, actor.uid);
            allocation.charge = { ...allocation.charge, id: memberFeeChargeId };
            allocation.createData = undefined;
        }
        const clubAmountMinor = prepared.reduce((total, allocation) => total + allocation.appliedAmountMinor, 0);
        const movement = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'income',
            categoryId: category.id,
            categoryCodeSnapshot: category.id,
            grossAmountMinor: clubAmountMinor,
            operationDate: params.input.operationDate,
            originType: 'member_fee_payment',
            originCollection: 'member_fee_charges',
            originId: prepared.length === 1 ? prepared[0].charge.id : null,
            thirdPartyType: 'member',
            thirdPartyId: memberId,
            paymentMethodId: paymentMethod.id,
            bancarizado: paymentMethod.bancarizado,
            imputableImpositivo: true,
            applyPaymentCommission: true,
            paymentCommissionMode: 'add_to_charge',
            metadata: {
                idempotencyKey: params.input.idempotencyKey ?? null,
                paymentReference,
                feePaymentAccountingPeriod: toClubAccountingPeriod(params.input.operationDate),
                paymentAllocations: prepared.map((allocation) => ({
                    chargeId: allocation.charge.id,
                    period: allocation.charge.period,
                    appliedClubAmountMinor: allocation.appliedAmountMinor,
                    settlementAmountMinor: allocation.settlementAmountMinor,
                    remainingAmountMinor: allocation.remainingAmountMinor,
                    discountPctBps: allocation.discountPctBps,
                    discountAmountMinor: allocation.discountAmountMinor,
                    discountMode: allocation.discountMode,
                })),
            },
            notes: params.input.notes ?? null,
        });
        const receiptNumber = buildReceiptNumber(params.input.operationDate, movement.movementId);
        await dataAccess.financialMovements.update(movement.movementId, {
            metadata: {
                idempotencyKey: params.input.idempotencyKey ?? null,
                paymentReference,
                receiptNumber,
                receiptIssuedAt: Timestamp.fromDate(params.input.operationDate),
                receiptSource: 'member_fee_payment',
                appliedCommissionPctBps: movement.appliedCommissionPctBps,
                appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
                clubAmountMinor: movement.netAmountMinor,
                amountToChargeMinor: movement.grossAmountMinor,
                paymentAllocations: prepared.map((allocation) => ({
                    chargeId: allocation.charge.id,
                    period: allocation.charge.period,
                    appliedClubAmountMinor: allocation.appliedAmountMinor,
                    settlementAmountMinor: allocation.settlementAmountMinor,
                    remainingAmountMinor: allocation.remainingAmountMinor,
                    discountPctBps: allocation.discountPctBps,
                    discountAmountMinor: allocation.discountAmountMinor,
                    discountMode: allocation.discountMode,
                })),
            },
        }, actor.uid);
        for (const allocation of prepared) {
            const paidClubAmountMinor = allocation.previouslyPaidMinor + allocation.appliedAmountMinor;
            const completed = allocation.remainingAmountMinor === 0;
            await dataAccess.memberFeeCharges.update(allocation.charge.id, {
                status: completed ? 'paid' : allocation.charge.status,
                paidMovementId: completed ? movement.movementId : allocation.charge.paidMovementId ?? null,
                paymentMovementIds: [...new Set([...(allocation.charge.paymentMovementIds ?? (allocation.charge.paidMovementId ? [allocation.charge.paidMovementId] : [])), movement.movementId])],
                paidAt: completed ? Timestamp.fromDate(params.input.operationDate) : null,
                paidAmountMinor: paidClubAmountMinor,
                settlementAmountMinor: allocation.settlementAmountMinor,
                paidClubAmountMinor,
                remainingAmountMinor: allocation.remainingAmountMinor,
                paymentDiscountPctBps: allocation.discountPctBps,
                paymentDiscountAmountMinor: allocation.discountAmountMinor,
                paymentDiscountMode: allocation.discountMode,
            }, actor.uid);
        }
        const selectedIds = new Set(prepared.map((allocation) => allocation.charge.id));
        const keepsOpenDebt = prepared.some((allocation) => allocation.remainingAmountMinor > 0)
            || openChargesBeforePayment.items.some((charge) => {
                if (charge.status !== 'pending' && charge.status !== 'overdue')
                    return false;
                const selected = prepared.find((allocation) => allocation.charge.id === charge.id);
                return !selectedIds.has(charge.id) || Boolean(selected && selected.remainingAmountMinor > 0);
            });
        const latestPaidPeriod = prepared
            .map((allocation) => allocation.charge.period)
            .sort((left, right) => right.localeCompare(left))[0];
        await dataAccess.members.update(memberId, {
            lastFeePaymentAt: Timestamp.fromDate(params.input.operationDate),
            membershipRenewalDueAt: keepsOpenDebt
                ? undefined
                : Timestamp.fromDate(calculateMembershipRenewalDueDateFromPeriod(latestPaidPeriod)),
            membershipRenewalStatus: keepsOpenDebt ? 'needs_renewal' : 'current',
            lastFeePaidAmountMinor: clubAmountMinor,
        }, actor.uid);
        return {
            memberId,
            movementId: movement.movementId,
            grossAmountMinor: movement.grossAmountMinor,
            netAmountMinor: movement.netAmountMinor,
            appliedCommissionPctBps: movement.appliedCommissionPctBps,
            appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
            receiptNumber,
            completedChargeIds: prepared.filter((allocation) => allocation.remainingAmountMinor === 0).map((allocation) => allocation.charge.id),
            remainingChargeIds: prepared.filter((allocation) => allocation.remainingAmountMinor > 0).map((allocation) => allocation.charge.id),
        };
    });
}
export function parseRegisterMemberFeeBatchPaymentInput(payload) {
    const data = assertIsRecord(payload);
    assertCondition(Array.isArray(data.allocations), 'invalid-argument', 'allocations debe ser un arreglo.');
    const allocations = data.allocations.map((rawAllocation) => {
        const allocation = assertIsRecord(rawAllocation);
        return {
            chargeId: parseOptionalString(allocation, 'chargeId'),
            memberId: parseOptionalString(allocation, 'memberId'),
            period: parseOptionalAccountingPeriod(allocation, 'period'),
            amountMinor: allocation.amountMinor === undefined ? undefined : parseRequiredAmountMinor(allocation, 'amountMinor'),
            settlementAmountMinor: allocation.settlementAmountMinor === undefined ? undefined : parseRequiredAmountMinor(allocation, 'settlementAmountMinor'),
            applyEarlyPaymentDiscount: parseOptionalBoolean(allocation, 'applyEarlyPaymentDiscount'),
        };
    });
    return {
        allocations,
        paymentMethodId: parseRequiredString(data, 'paymentMethodId'),
        operationDate: parseRequiredIsoDate(data, 'operationDate'),
        paymentReference: parseOptionalNullableString(data, 'paymentReference'),
        notes: parseOptionalNullableString(data, 'notes'),
        idempotencyKey: parseOptionalString(data, 'idempotencyKey'),
    };
}
//# sourceMappingURL=member-fee-payment.use-cases.js.map