import { Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_FINANCIAL_EXPENSE_CATEGORIES, DEFAULT_FINANCIAL_INCOME_CATEGORIES, FINANCIAL_EXPENSE_CATEGORY_IDS, FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS, } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, calculateEarlyPaymentDiscount, calculateMembershipRenewalDueDate, ensureStaff, parseOptionalIsoDate, parseOptionalNullableString, parseOptionalRecord, parseRequiredAmountMinor, parseRequiredIsoDate, parseRequiredString, toClubAccountingPeriod, } from '../shared.js';
import { createPostedMovement } from '../movement-helpers.js';
import { assertCashOperationDateAllowed } from '../cash-closure-guards.js';
function getMovementMetadataString(movement, key) {
    const value = movement.metadata?.[key];
    return typeof value === 'string' ? value.trim() : '';
}
function isInternalTransferMovement(movement) {
    return movement.originType === 'internal_transfer'
        || movement.categoryId === FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer
        || movement.categoryId === FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer;
}
function appendTransferEditHistory(movement, entry) {
    const current = movement.metadata?.transferEditHistory;
    return [...(Array.isArray(current) ? current.slice(-19) : []), entry];
}
function buildReceiptNumber(operationDate, movementId) {
    const year = operationDate.getUTCFullYear();
    const month = String(operationDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(operationDate.getUTCDate()).padStart(2, '0');
    return `REC-${year}${month}${day}-${movementId.slice(0, 8).toUpperCase()}`;
}
function getReceiptNumberFromMovementMetadata(metadata) {
    const receiptNumber = metadata?.receiptNumber;
    return typeof receiptNumber === 'string' && receiptNumber.trim().length > 0 ? receiptNumber : null;
}
const LEGACY_INCOME_PAYMENT_METHOD_IDS = new Set([
    PAYMENT_METHOD_IDS.transfer,
    PAYMENT_METHOD_IDS.debit,
    PAYMENT_METHOD_IDS.credit,
]);
function assertPaymentMethodAllowedForIncomeCategory(paymentMethodId, categoryId) {
    assertCondition(!LEGACY_INCOME_PAYMENT_METHOD_IDS.has(paymentMethodId), 'failed-precondition', `El medio de pago ${paymentMethodId} ya no esta disponible para nuevos cobros.`);
    assertCondition(paymentMethodId !== PAYMENT_METHOD_IDS.debitMacro || categoryId === FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, 'invalid-argument', 'Cuenta debito Macro solo esta disponible para cuotas societarias.');
}
export async function registerPaymentUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        await assertCashOperationDateAllowed({
            dataAccess,
            operationDate: params.input.operationDate,
        });
        const category = await dataAccess.financialIncomeCategories.getById(params.input.categoryId);
        assertCondition(category, 'not-found', `No existe financial_income_categories/${params.input.categoryId}.`);
        assertCondition(category.active, 'failed-precondition', `La categoría ${params.input.categoryId} está inactiva.`);
        const paymentMethod = await dataAccess.paymentMethods.getById(params.input.paymentMethodId);
        assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.input.paymentMethodId}.`);
        assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.input.paymentMethodId} está inactivo.`);
        assertPaymentMethodAllowedForIncomeCategory(paymentMethod.id, category.id);
        const paymentReference = params.input.paymentReference?.trim() || null;
        const paymentReferenceRequired = params.input.sourceType !== 'manual_income' && paymentMethod.id !== PAYMENT_METHOD_IDS.cash;
        assertCondition(!paymentReferenceRequired || Boolean(paymentReference), 'invalid-argument', 'La referencia de pago es obligatoria para medios distintos de efectivo.');
        if (params.input.memberId) {
            const member = await dataAccess.members.getById(params.input.memberId);
            assertCondition(member, 'not-found', `No existe members/${params.input.memberId}.`);
            assertCondition(member.status !== 'inactive' && member.status !== 'suspended', 'failed-precondition', 'No se pueden registrar pagos nuevos para socios dados de baja o suspendidos.');
            assertCondition(!member.membershipBillingExempt, 'failed-precondition', 'El usuario tecnico esta exento y no admite cobros asociados a su ficha.');
        }
        let memberFeeChargeToPay = null;
        let feePaymentSnapshot = null;
        let feePaymentAccountingPeriod = null;
        let isFeePaymentOutsidePeriod = false;
        if (params.input.sourceType === 'member_fee_charge') {
            assertCondition(params.input.sourceId, 'invalid-argument', 'sourceId es obligatorio para member_fee_charge.');
            const memberFeeCharge = await dataAccess.memberFeeCharges.getById(params.input.sourceId);
            assertCondition(memberFeeCharge, 'not-found', `No existe member_fee_charges/${params.input.sourceId}.`);
            memberFeeChargeToPay = memberFeeCharge;
            if (memberFeeCharge.status === 'paid' && memberFeeCharge.paidMovementId) {
                const existingMovement = await dataAccess.financialMovements.getById(memberFeeCharge.paidMovementId);
                assertCondition(existingMovement, 'failed-precondition', 'La cuota ya fue pagada y el movimiento vinculado no existe.');
                return {
                    movementId: existingMovement.id,
                    grossAmountMinor: existingMovement.grossAmountMinor,
                    netAmountMinor: existingMovement.netAmountMinor,
                    appliedCommissionPctBps: existingMovement.appliedCommissionPctBps ?? null,
                    appliedCommissionAmountMinor: existingMovement.appliedCommissionAmountMinor ?? null,
                    duplicate: true,
                    receiptNumber: getReceiptNumberFromMovementMetadata(existingMovement.metadata),
                };
            }
            assertCondition(memberFeeCharge.status === 'pending' || memberFeeCharge.status === 'overdue', 'failed-precondition', 'Solo se pueden cobrar cuotas pendientes o vencidas.');
            const chargeMemberId = memberFeeCharge.memberId ?? memberFeeCharge.holderMemberId ?? null;
            assertCondition(chargeMemberId, 'failed-precondition', 'La cuota no tiene socio asociado para validar el cobro.');
            const chargeMember = await dataAccess.members.getById(chargeMemberId);
            assertCondition(chargeMember, 'not-found', `No existe members/${chargeMemberId}.`);
            assertCondition(chargeMember.status !== 'inactive' && chargeMember.status !== 'suspended', 'failed-precondition', 'No se pueden cobrar cuotas de socios dados de baja o suspendidos.');
            assertCondition(!chargeMember.membershipBillingExempt, 'failed-precondition', 'El usuario tecnico esta exento y no admite cobros de cuota societaria.');
            const activeConfig = await dataAccess.financialConfigs.getActive();
            assertCondition(activeConfig, 'failed-precondition', 'No existe una configuración financiera activa.');
            feePaymentAccountingPeriod = toClubAccountingPeriod(params.input.operationDate);
            isFeePaymentOutsidePeriod = feePaymentAccountingPeriod !== memberFeeCharge.period;
            feePaymentSnapshot = calculateEarlyPaymentDiscount({
                chargeAmountMinor: memberFeeCharge.finalAmountMinor,
                config: activeConfig,
                chargePeriod: memberFeeCharge.period,
                operationDate: params.input.operationDate,
            });
        }
        let handicapChargeId = null;
        if (params.input.sourceType === 'handicap' && params.input.sourceId) {
            const handicapCharge = await dataAccess.handicapCharges.getById(params.input.sourceId);
            assertCondition(handicapCharge, 'not-found', `No existe handicap_charges/${params.input.sourceId}.`);
            if (handicapCharge.incomeMovementId) {
                const existingMovement = await dataAccess.financialMovements.getById(handicapCharge.incomeMovementId);
                if (existingMovement) {
                    return {
                        movementId: existingMovement.id,
                        grossAmountMinor: existingMovement.grossAmountMinor,
                        netAmountMinor: existingMovement.netAmountMinor,
                        appliedCommissionPctBps: existingMovement.appliedCommissionPctBps ?? null,
                        appliedCommissionAmountMinor: existingMovement.appliedCommissionAmountMinor ?? null,
                        duplicate: true,
                        receiptNumber: getReceiptNumberFromMovementMetadata(existingMovement.metadata),
                    };
                }
            }
            handicapChargeId = handicapCharge.id;
        }
        if (params.input.sourceType === 'handicap' && !params.input.sourceId) {
            const metadata = params.input.metadata ?? {};
            const period = typeof metadata.period === 'string' ? metadata.period : null;
            const associationName = typeof metadata.associationName === 'string' ? metadata.associationName : null;
            const transferAmountMinor = typeof metadata.transferAmountMinor === 'number' ? metadata.transferAmountMinor : params.input.grossAmountMinor;
            assertCondition(params.input.memberId, 'invalid-argument', 'memberId es obligatorio para crear handicap_charges al cobrar handicap.');
            assertCondition(period, 'invalid-argument', 'metadata.period es obligatorio para crear handicap_charges.');
            assertCondition(associationName, 'invalid-argument', 'metadata.associationName es obligatorio para crear handicap_charges.');
            const existingCharge = await dataAccess.handicapCharges.findByMemberAndPeriod(params.input.memberId, period);
            if (existingCharge?.incomeMovementId) {
                const existingMovement = await dataAccess.financialMovements.getById(existingCharge.incomeMovementId);
                if (existingMovement) {
                    return {
                        movementId: existingMovement.id,
                        grossAmountMinor: existingMovement.grossAmountMinor,
                        netAmountMinor: existingMovement.netAmountMinor,
                        appliedCommissionPctBps: existingMovement.appliedCommissionPctBps ?? null,
                        appliedCommissionAmountMinor: existingMovement.appliedCommissionAmountMinor ?? null,
                        duplicate: true,
                        receiptNumber: getReceiptNumberFromMovementMetadata(existingMovement.metadata),
                    };
                }
            }
            handicapChargeId = existingCharge?.id
                ?? await dataAccess.handicapCharges.create({
                    memberId: params.input.memberId,
                    handicapId: typeof metadata.handicapId === 'string' ? metadata.handicapId : null,
                    period,
                    collectionAmountMinor: params.input.grossAmountMinor,
                    transferAmountMinor,
                    associationName,
                    incomeMovementId: null,
                    expenseMovementId: null,
                    status: 'pending_collection',
                    transferDueDate: null,
                    notes: params.input.notes ?? null,
                }, actor.uid);
        }
        const feeMemberId = memberFeeChargeToPay?.memberId ?? memberFeeChargeToPay?.holderMemberId ?? null;
        const resolvedMemberId = feeMemberId ?? params.input.memberId ?? null;
        const thirdPartyType = params.input.thirdPartyType
            ?? (resolvedMemberId ? 'member' : null);
        const thirdPartyId = params.input.thirdPartyId
            ?? resolvedMemberId
            ?? null;
        const effectiveGrossAmountMinor = feePaymentSnapshot?.paidAmountMinor ?? params.input.grossAmountMinor;
        const movement = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'income',
            categoryId: category.id,
            categoryCodeSnapshot: category.id,
            grossAmountMinor: effectiveGrossAmountMinor,
            operationDate: params.input.operationDate,
            originType: params.input.sourceType,
            originCollection: params.input.sourceType === 'member_fee_charge'
                ? 'member_fee_charges'
                : params.input.sourceType === 'handicap'
                    ? 'handicap_charges'
                    : null,
            originId: params.input.sourceId ?? handicapChargeId,
            thirdPartyType,
            thirdPartyId,
            paymentMethodId: paymentMethod.id,
            bancarizado: paymentMethod.bancarizado,
            imputableImpositivo: true,
            metadata: {
                ...(params.input.metadata ?? {}),
                ...(paymentReference ? { paymentReference } : {}),
                specialReportingType: paymentMethod.specialReportingType ?? null,
                ...(feePaymentSnapshot
                    ? {
                        originalFeeAmountMinor: memberFeeChargeToPay?.finalAmountMinor ?? params.input.grossAmountMinor,
                        earlyPaymentDiscountPctBps: feePaymentSnapshot.discountPctBps,
                        earlyPaymentDiscountAmountMinor: feePaymentSnapshot.discountAmountMinor,
                        paidWithinEarlyPaymentWindow: feePaymentSnapshot.qualifies,
                        feeChargePeriod: memberFeeChargeToPay?.period ?? null,
                        feePaymentAccountingPeriod,
                        isFeePaymentOutsidePeriod,
                    }
                    : {}),
            },
            notes: params.input.notes ?? null,
            applyPaymentCommission: true,
            paymentCommissionMode: 'add_to_charge',
        });
        const receiptNumber = buildReceiptNumber(params.input.operationDate, movement.movementId);
        await dataAccess.financialMovements.update(movement.movementId, {
            metadata: {
                ...(params.input.metadata ?? {}),
                ...(paymentReference ? { paymentReference } : {}),
                receiptNumber,
                receiptIssuedAt: Timestamp.fromDate(params.input.operationDate),
                receiptSource: params.input.sourceType,
                appliedCommissionPctBps: movement.appliedCommissionPctBps,
                appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
                clubAmountMinor: movement.netAmountMinor,
                amountToChargeMinor: movement.grossAmountMinor,
                specialReportingType: paymentMethod.specialReportingType ?? null,
                ...(feePaymentSnapshot
                    ? {
                        originalFeeAmountMinor: memberFeeChargeToPay?.finalAmountMinor ?? params.input.grossAmountMinor,
                        earlyPaymentDiscountPctBps: feePaymentSnapshot.discountPctBps,
                        earlyPaymentDiscountAmountMinor: feePaymentSnapshot.discountAmountMinor,
                        paidWithinEarlyPaymentWindow: feePaymentSnapshot.qualifies,
                        feeChargePeriod: memberFeeChargeToPay?.period ?? null,
                        feePaymentAccountingPeriod,
                        isFeePaymentOutsidePeriod,
                    }
                    : {}),
            },
        }, actor.uid);
        if (params.input.sourceType === 'member_fee_charge' && params.input.sourceId) {
            await dataAccess.memberFeeCharges.update(params.input.sourceId, {
                status: 'paid',
                paidMovementId: movement.movementId,
                paidAt: Timestamp.fromDate(params.input.operationDate),
                paidAmountMinor: effectiveGrossAmountMinor,
                paymentDiscountPctBps: feePaymentSnapshot?.discountPctBps ?? 0,
                paymentDiscountAmountMinor: feePaymentSnapshot?.discountAmountMinor ?? 0,
            }, actor.uid);
            const memberIdToUpdate = feeMemberId;
            if (memberIdToUpdate) {
                await dataAccess.members.update(memberIdToUpdate, {
                    lastFeePaymentAt: Timestamp.fromDate(params.input.operationDate),
                    membershipRenewalDueAt: Timestamp.fromDate(calculateMembershipRenewalDueDate(params.input.operationDate)),
                    membershipRenewalStatus: 'current',
                    lastFeePaidAmountMinor: effectiveGrossAmountMinor,
                    lastFeeDiscountPctBps: feePaymentSnapshot?.discountPctBps ?? 0,
                    lastFeeDiscountAmountMinor: feePaymentSnapshot?.discountAmountMinor ?? 0,
                }, actor.uid);
            }
        }
        if (handicapChargeId) {
            await dataAccess.handicapCharges.update(handicapChargeId, {
                collectionAmountMinor: params.input.grossAmountMinor,
                incomeMovementId: movement.movementId,
                status: 'collected',
            }, actor.uid);
        }
        if (params.input.sourceType === 'member_fee_charge' && category.id !== FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria) {
            await dataAccess.financialMovements.update(movement.movementId, {
                metadata: {
                    ...(params.input.metadata ?? {}),
                    ...(paymentReference ? { paymentReference } : {}),
                    receiptNumber,
                    receiptIssuedAt: Timestamp.fromDate(params.input.operationDate),
                    receiptSource: params.input.sourceType,
                    appliedCommissionPctBps: movement.appliedCommissionPctBps,
                    appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
                    clubAmountMinor: movement.netAmountMinor,
                    amountToChargeMinor: movement.grossAmountMinor,
                    specialReportingType: paymentMethod.specialReportingType ?? null,
                    ...(feePaymentSnapshot
                        ? {
                            originalFeeAmountMinor: memberFeeChargeToPay?.finalAmountMinor ?? params.input.grossAmountMinor,
                            earlyPaymentDiscountPctBps: feePaymentSnapshot.discountPctBps,
                            earlyPaymentDiscountAmountMinor: feePaymentSnapshot.discountAmountMinor,
                            paidWithinEarlyPaymentWindow: feePaymentSnapshot.qualifies,
                            feeChargePeriod: memberFeeChargeToPay?.period ?? null,
                            feePaymentAccountingPeriod,
                            isFeePaymentOutsidePeriod,
                        }
                        : {}),
                    warning: 'El cobro de cuota se registró con una categoría distinta de cuota_societaria.',
                },
            }, actor.uid);
        }
        return {
            movementId: movement.movementId,
            grossAmountMinor: movement.grossAmountMinor,
            netAmountMinor: movement.netAmountMinor,
            appliedCommissionPctBps: movement.appliedCommissionPctBps,
            appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor,
            duplicate: false,
            receiptNumber,
        };
    });
}
export async function transferFundsUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        await assertCashOperationDateAllowed({
            dataAccess,
            operationDate: params.input.operationDate,
        });
        assertCondition(params.input.amountMinor > 0, 'invalid-argument', 'El monto de la transferencia debe ser mayor a cero.');
        assertCondition(params.input.sourcePaymentMethodId !== params.input.destinationPaymentMethodId, 'invalid-argument', 'La cuenta origen y destino no pueden ser la misma.');
        const [sourceMethod, destinationMethod, storedIncomeCategory, storedExpenseCategory] = await Promise.all([
            dataAccess.paymentMethods.getById(params.input.sourcePaymentMethodId),
            dataAccess.paymentMethods.getById(params.input.destinationPaymentMethodId),
            dataAccess.financialIncomeCategories.getById(FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer),
            dataAccess.financialExpenseCategories.getById(FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer),
        ]);
        const defaultIncomeCategory = DEFAULT_FINANCIAL_INCOME_CATEGORIES.find((category) => category.id === FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer);
        const defaultExpenseCategory = DEFAULT_FINANCIAL_EXPENSE_CATEGORIES.find((category) => category.id === FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer);
        const incomeCategory = storedIncomeCategory
            ?? (defaultIncomeCategory ? { id: defaultIncomeCategory.id, ...defaultIncomeCategory.data } : null);
        const expenseCategory = storedExpenseCategory
            ?? (defaultExpenseCategory ? { id: defaultExpenseCategory.id, ...defaultExpenseCategory.data } : null);
        assertCondition(sourceMethod, 'not-found', `No existe payment_methods/${params.input.sourcePaymentMethodId}.`);
        assertCondition(destinationMethod, 'not-found', `No existe payment_methods/${params.input.destinationPaymentMethodId}.`);
        assertCondition(sourceMethod.active, 'failed-precondition', `El medio de pago ${params.input.sourcePaymentMethodId} estÃ¡ inactivo.`);
        assertCondition(destinationMethod.active, 'failed-precondition', `El medio de pago ${params.input.destinationPaymentMethodId} estÃ¡ inactivo.`);
        assertCondition(incomeCategory, 'not-found', `No existe financial_income_categories/${FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer}.`);
        assertCondition(expenseCategory, 'not-found', `No existe financial_expense_categories/${FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer}.`);
        assertCondition(incomeCategory.active, 'failed-precondition', 'Falta activar la categorÃ­a de ingreso por transferencia interna.');
        assertCondition(expenseCategory.active, 'failed-precondition', 'Falta activar la categorÃ­a de egreso por transferencia interna.');
        const reference = params.input.reference?.trim()
            || `TRF-${params.input.operationDate.toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).toUpperCase()}`;
        const commonMetadata = {
            transferReference: reference,
            sourcePaymentMethodId: sourceMethod.id,
            destinationPaymentMethodId: destinationMethod.id,
            sourcePaymentMethodName: sourceMethod.name,
            destinationPaymentMethodName: destinationMethod.name,
        };
        const outgoing = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'expense',
            categoryId: expenseCategory.id,
            categoryCodeSnapshot: expenseCategory.id,
            grossAmountMinor: params.input.amountMinor,
            operationDate: params.input.operationDate,
            originType: 'internal_transfer',
            originCollection: null,
            originId: null,
            thirdPartyType: null,
            thirdPartyId: null,
            paymentMethodId: sourceMethod.id,
            bancarizado: sourceMethod.bancarizado,
            imputableImpositivo: false,
            metadata: {
                ...commonMetadata,
                transferDirection: 'out',
            },
            notes: params.input.notes ?? `Transferencia interna a ${destinationMethod.name}`,
        });
        const incoming = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'income',
            categoryId: incomeCategory.id,
            categoryCodeSnapshot: incomeCategory.id,
            grossAmountMinor: params.input.amountMinor,
            operationDate: params.input.operationDate,
            originType: 'internal_transfer',
            originCollection: null,
            originId: outgoing.movementId,
            thirdPartyType: null,
            thirdPartyId: null,
            paymentMethodId: destinationMethod.id,
            bancarizado: destinationMethod.bancarizado,
            imputableImpositivo: false,
            metadata: {
                ...commonMetadata,
                transferDirection: 'in',
                counterpartMovementId: outgoing.movementId,
            },
            notes: params.input.notes ?? `Transferencia interna desde ${sourceMethod.name}`,
        });
        await dataAccess.financialMovements.update(outgoing.movementId, {
            originId: incoming.movementId,
            metadata: {
                ...commonMetadata,
                transferDirection: 'out',
                counterpartMovementId: incoming.movementId,
            },
        }, actor.uid);
        return {
            outgoingMovementId: outgoing.movementId,
            incomingMovementId: incoming.movementId,
            amountMinor: params.input.amountMinor,
            reference,
        };
    });
}
export async function editInternalTransferUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const selectedMovement = await dataAccess.financialMovements.getById(params.input.movementId);
        assertCondition(selectedMovement, 'not-found', `No existe financial_movements/${params.input.movementId}.`);
        assertCondition(isInternalTransferMovement(selectedMovement), 'failed-precondition', 'El movimiento no es una transferencia interna.');
        assertCondition(selectedMovement.status === 'posted', 'failed-precondition', 'Solo se pueden editar transferencias posteadas.');
        assertCondition(params.input.reason.trim().length >= 5, 'invalid-argument', 'El motivo de edicion debe tener al menos 5 caracteres.');
        assertCondition(params.input.sourcePaymentMethodId !== params.input.destinationPaymentMethodId, 'invalid-argument', 'La cuenta origen y destino no pueden ser la misma.');
        const counterpartMovementId = getMovementMetadataString(selectedMovement, 'counterpartMovementId')
            || selectedMovement.originId
            || '';
        assertCondition(counterpartMovementId, 'failed-precondition', 'La transferencia historica no tiene vinculado su contramovimiento.');
        const counterpartMovement = await dataAccess.financialMovements.getById(counterpartMovementId);
        assertCondition(counterpartMovement, 'not-found', `No existe financial_movements/${counterpartMovementId}.`);
        assertCondition(isInternalTransferMovement(counterpartMovement), 'failed-precondition', 'El contramovimiento no pertenece a una transferencia interna.');
        assertCondition(counterpartMovement.status === 'posted', 'failed-precondition', 'El contramovimiento de la transferencia no esta posteado.');
        assertCondition(selectedMovement.movementType !== counterpartMovement.movementType, 'failed-precondition', 'La transferencia debe tener un egreso y un ingreso vinculados.');
        const outgoing = selectedMovement.movementType === 'expense' ? selectedMovement : counterpartMovement;
        const incoming = selectedMovement.movementType === 'income' ? selectedMovement : counterpartMovement;
        const [sourceMethod, destinationMethod] = await Promise.all([
            dataAccess.paymentMethods.getById(params.input.sourcePaymentMethodId),
            dataAccess.paymentMethods.getById(params.input.destinationPaymentMethodId),
        ]);
        assertCondition(sourceMethod, 'not-found', `No existe payment_methods/${params.input.sourcePaymentMethodId}.`);
        assertCondition(destinationMethod, 'not-found', `No existe payment_methods/${params.input.destinationPaymentMethodId}.`);
        assertCondition(sourceMethod.active, 'failed-precondition', `El medio de pago ${sourceMethod.id} esta inactivo.`);
        assertCondition(destinationMethod.active, 'failed-precondition', `El medio de pago ${destinationMethod.id} esta inactivo.`);
        const editedAt = new Date();
        const reference = params.input.reference?.trim()
            || getMovementMetadataString(outgoing, 'transferReference')
            || getMovementMetadataString(incoming, 'transferReference')
            || `TRF-HIST-${outgoing.id.slice(0, 8).toUpperCase()}`;
        const notes = params.input.notes?.trim() || null;
        const previousSnapshot = {
            sourcePaymentMethodId: outgoing.paymentMethodId ?? outgoing.paymentMethodCodeSnapshot ?? null,
            destinationPaymentMethodId: incoming.paymentMethodId ?? incoming.paymentMethodCodeSnapshot ?? null,
            sourceMetadataPaymentMethodId: getMovementMetadataString(outgoing, 'sourcePaymentMethodId') || null,
            destinationMetadataPaymentMethodId: getMovementMetadataString(outgoing, 'destinationPaymentMethodId') || null,
            reference: getMovementMetadataString(outgoing, 'transferReference') || null,
            notes: outgoing.notes ?? incoming.notes ?? null,
        };
        const editHistoryEntry = {
            editedAt: editedAt.toISOString(),
            editedByUid: actor.uid,
            reason: params.input.reason.trim(),
            previous: previousSnapshot,
        };
        const commonMetadata = {
            transferReference: reference,
            sourcePaymentMethodId: sourceMethod.id,
            destinationPaymentMethodId: destinationMethod.id,
            sourcePaymentMethodName: sourceMethod.name,
            destinationPaymentMethodName: destinationMethod.name,
            lastEditReason: params.input.reason.trim(),
            lastEditedAt: editedAt.toISOString(),
            lastEditedByUid: actor.uid,
        };
        await dataAccess.financialMovements.update(outgoing.id, {
            categoryId: FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer,
            categoryCodeSnapshot: FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer,
            originType: 'internal_transfer',
            originId: incoming.id,
            paymentMethodId: sourceMethod.id,
            paymentMethodCodeSnapshot: sourceMethod.id,
            bancarizado: sourceMethod.bancarizado,
            imputableImpositivo: false,
            approvedByUid: actor.uid,
            approvedAt: Timestamp.fromDate(editedAt),
            metadata: {
                ...(outgoing.metadata ?? {}),
                ...commonMetadata,
                transferDirection: 'out',
                counterpartMovementId: incoming.id,
                transferEditHistory: appendTransferEditHistory(outgoing, editHistoryEntry),
            },
            notes,
        }, actor.uid);
        await dataAccess.financialMovements.update(incoming.id, {
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer,
            categoryCodeSnapshot: FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer,
            originType: 'internal_transfer',
            originId: outgoing.id,
            paymentMethodId: destinationMethod.id,
            paymentMethodCodeSnapshot: destinationMethod.id,
            bancarizado: destinationMethod.bancarizado,
            imputableImpositivo: false,
            approvedByUid: actor.uid,
            approvedAt: Timestamp.fromDate(editedAt),
            metadata: {
                ...(incoming.metadata ?? {}),
                ...commonMetadata,
                transferDirection: 'in',
                counterpartMovementId: outgoing.id,
                transferEditHistory: appendTransferEditHistory(incoming, editHistoryEntry),
            },
            notes,
        }, actor.uid);
        return {
            outgoingMovementId: outgoing.id,
            incomingMovementId: incoming.id,
            reference,
        };
    });
}
export function parseRegisterPaymentInput(payload) {
    const data = assertIsRecord(payload);
    return {
        sourceType: parseRequiredString(data, 'sourceType'),
        sourceId: parseOptionalNullableString(data, 'sourceId'),
        memberId: parseOptionalNullableString(data, 'memberId'),
        thirdPartyType: parseOptionalNullableString(data, 'thirdPartyType'),
        thirdPartyId: parseOptionalNullableString(data, 'thirdPartyId'),
        categoryId: parseRequiredString(data, 'categoryId'),
        paymentMethodId: parseRequiredString(data, 'paymentMethodId'),
        paymentReference: parseOptionalNullableString(data, 'paymentReference'),
        grossAmountMinor: parseRequiredAmountMinor(data, 'grossAmountMinor'),
        operationDate: parseOptionalIsoDate(data, 'operationDate') ?? parseRequiredIsoDate(data, 'operationDate'),
        notes: parseOptionalNullableString(data, 'notes'),
        metadata: parseOptionalRecord(data, 'metadata'),
    };
}
export function parseTransferFundsInput(payload) {
    const data = assertIsRecord(payload);
    return {
        sourcePaymentMethodId: parseRequiredString(data, 'sourcePaymentMethodId'),
        destinationPaymentMethodId: parseRequiredString(data, 'destinationPaymentMethodId'),
        amountMinor: parseRequiredAmountMinor(data, 'amountMinor'),
        operationDate: parseOptionalIsoDate(data, 'operationDate') ?? parseRequiredIsoDate(data, 'operationDate'),
        reference: parseOptionalNullableString(data, 'reference'),
        notes: parseOptionalNullableString(data, 'notes'),
    };
}
export function parseEditInternalTransferInput(payload) {
    const data = assertIsRecord(payload);
    return {
        movementId: parseRequiredString(data, 'movementId'),
        sourcePaymentMethodId: parseRequiredString(data, 'sourcePaymentMethodId'),
        destinationPaymentMethodId: parseRequiredString(data, 'destinationPaymentMethodId'),
        reference: parseOptionalNullableString(data, 'reference'),
        notes: parseOptionalNullableString(data, 'notes'),
        reason: parseRequiredString(data, 'reason'),
    };
}
//# sourceMappingURL=payment.use-cases.js.map