import { Timestamp } from 'firebase-admin/firestore';
import { ACCOUNTING_COLLECTIONS, FINANCIAL_EXPENSE_CATEGORY_IDS, FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS, } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, calculateAmountFromBps, ensureStaff, parseOptionalNullableString, parseRequiredBoolean, parseRequiredAmountMinor, parseRequiredIsoDate, parseRequiredString, toClubAccountingPeriod, } from '../shared.js';
import { buildMovementPatchForVoid } from '../movement-helpers.js';
function getMovementMetadataString(movement, key) {
    const value = movement.metadata?.[key];
    return typeof value === 'string' ? value.trim() : '';
}
function getBalanceLinkedMovementId(movement) {
    if (movement.reversalOfMovementId) {
        return movement.reversalOfMovementId;
    }
    if (movement.originType === 'internal_transfer') {
        return getMovementMetadataString(movement, 'counterpartMovementId') || movement.originId || '';
    }
    return '';
}
function appendBalanceInclusionHistory(movement, entry) {
    const current = movement.metadata?.balanceInclusionHistory;
    return [...(Array.isArray(current) ? current.slice(-19) : []), entry];
}
function reverseMovementType(movementType) {
    return movementType === 'income' ? 'expense' : 'income';
}
function toClubDayKey(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}
function signedMovementAmount(movementType, netAmountMinor) {
    return movementType === 'income' ? netAmountMinor : -netAmountMinor;
}
function applyClosureContribution(expectedByPaymentMethod, paymentMethodId, amountMinor) {
    const key = paymentMethodId ?? 'sin_medio';
    expectedByPaymentMethod[key] = (expectedByPaymentMethod[key] ?? 0) + amountMinor;
}
function buildClosureEditPatch(params) {
    const expectedByPaymentMethod = { ...(params.closure.expectedByPaymentMethod ?? {}) };
    if (params.removeOld) {
        applyClosureContribution(expectedByPaymentMethod, params.oldPaymentMethodId, -params.oldSignedAmountMinor);
    }
    if (params.addNext) {
        applyClosureContribution(expectedByPaymentMethod, params.nextPaymentMethodId, params.nextSignedAmountMinor);
    }
    const movementIds = params.addNext
        ? Array.from(new Set([...params.closure.movementIds, params.movementId]))
        : params.closure.movementIds.filter((movementId) => movementId !== params.movementId);
    const cashExpectedMinor = expectedByPaymentMethod[PAYMENT_METHOD_IDS.cash] ?? 0;
    return {
        expectedByPaymentMethod,
        cashExpectedMinor,
        movementIds,
        differenceMinor: params.closure.cashCountedMinor === null || params.closure.cashCountedMinor === undefined
            ? params.closure.differenceMinor ?? null
            : params.closure.cashCountedMinor - cashExpectedMinor,
    };
}
export async function voidFinancialMovementUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const movement = await dataAccess.financialMovements.getById(params.input.movementId);
        assertCondition(movement, 'not-found', `No existe financial_movements/${params.input.movementId}.`);
        assertCondition(!movement.installmentPlanId, 'failed-precondition', 'Las cargas en cuotas se administran desde su detalle.');
        if (movement.status === 'voided' || movement.status === 'reversed') {
            return {
                movementId: movement.id,
                duplicate: true,
            };
        }
        if (movement.status !== 'posted') {
            await dataAccess.financialMovements.update(movement.id, buildMovementPatchForVoid({
                existingMovement: movement,
                reason: params.input.reason,
            }), actor.uid);
            return {
                movementId: movement.id,
                duplicate: false,
            };
        }
        const reversalMovementId = await dataAccess.financialMovements.create({
            movementType: reverseMovementType(movement.movementType),
            categoryId: movement.categoryId,
            categoryCodeSnapshot: movement.categoryCodeSnapshot,
            status: 'posted',
            operationDate: Timestamp.fromDate(new Date()),
            postingDate: Timestamp.fromDate(new Date()),
            accountingPeriod: toClubAccountingPeriod(new Date()),
            originType: 'movement_reversal',
            originCollection: ACCOUNTING_COLLECTIONS.financialMovements,
            originId: movement.id,
            thirdPartyType: movement.thirdPartyType ?? null,
            thirdPartyId: movement.thirdPartyId ?? null,
            paymentMethodId: movement.paymentMethodId ?? null,
            paymentMethodCodeSnapshot: movement.paymentMethodCodeSnapshot ?? null,
            grossAmountMinor: movement.grossAmountMinor,
            appliedCommissionPctBps: movement.appliedCommissionPctBps ?? null,
            appliedCommissionAmountMinor: movement.appliedCommissionAmountMinor ?? null,
            netAmountMinor: movement.netAmountMinor,
            bancarizado: movement.bancarizado,
            imputableImpositivo: movement.imputableImpositivo,
            settlementId: movement.settlementId ?? null,
            registeredByUid: actor.uid,
            approvedByUid: actor.uid,
            approvedAt: Timestamp.fromDate(new Date()),
            reversalOfMovementId: movement.id,
            voidReason: null,
            excludeFromBalance: movement.excludeFromBalance ?? false,
            balanceExclusionReason: movement.balanceExclusionReason ?? null,
            balanceExcludedAt: movement.balanceExcludedAt ?? null,
            balanceExcludedByUid: movement.balanceExcludedByUid ?? null,
            metadata: {
                reversesMovementId: movement.id,
            },
            notes: `Reverso de ${movement.id}.`,
        }, actor.uid);
        await dataAccess.financialMovements.update(movement.id, {
            status: 'reversed',
            voidReason: params.input.reason,
            reversalOfMovementId: reversalMovementId,
        }, actor.uid);
        if (movement.originCollection === 'member_fee_charges' && movement.originId) {
            const memberFeeCharge = await dataAccess.memberFeeCharges.getById(movement.originId);
            await dataAccess.memberFeeCharges.update(movement.originId, {
                status: 'pending',
                paidMovementId: null,
                paidAt: null,
                paidAmountMinor: null,
                paymentDiscountPctBps: null,
                paymentDiscountAmountMinor: null,
            }, actor.uid);
            const memberIdToUpdate = memberFeeCharge?.memberId ?? memberFeeCharge?.holderMemberId ?? null;
            if (memberIdToUpdate) {
                await dataAccess.members.update(memberIdToUpdate, {
                    membershipRenewalStatus: 'needs_renewal',
                    membershipRenewalDueAt: null,
                    lastFeePaymentAt: null,
                    lastFeePaidAmountMinor: null,
                    lastFeeDiscountPctBps: null,
                    lastFeeDiscountAmountMinor: null,
                }, actor.uid);
            }
        }
        if (movement.originCollection === 'handicap_charges' && movement.originId) {
            const handicapCharge = await dataAccess.handicapCharges.getById(movement.originId);
            if (handicapCharge) {
                await dataAccess.handicapCharges.update(handicapCharge.id, movement.movementType === 'income'
                    ? { incomeMovementId: null, status: 'pending_collection' }
                    : { expenseMovementId: null, status: handicapCharge.incomeMovementId ? 'collected' : 'pending_collection' }, actor.uid);
            }
        }
        if (movement.originCollection === 'expense_submissions' && movement.originId) {
            await dataAccess.expenseSubmissions.update(movement.originId, {
                status: 'approved',
                linkedMovementId: null,
            }, actor.uid);
        }
        return {
            movementId: movement.id,
            reversalMovementId,
            duplicate: false,
        };
    });
}
function getMovementEditHistory(metadata) {
    const history = metadata?.editHistory;
    return Array.isArray(history) ? history.slice(-19) : [];
}
export async function editFinancialMovementUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const movement = await dataAccess.financialMovements.getById(params.input.movementId);
        assertCondition(movement, 'not-found', `No existe financial_movements/${params.input.movementId}.`);
        assertCondition(!movement.installmentPlanId, 'failed-precondition', 'Las cargas en cuotas se administran desde su detalle.');
        assertCondition(movement.status === 'posted', 'failed-precondition', 'Solo se pueden editar movimientos posteados.');
        assertCondition(params.input.grossAmountMinor > 0, 'invalid-argument', 'El monto debe ser mayor a cero.');
        assertCondition(params.input.reason.trim().length >= 5, 'invalid-argument', 'El motivo de edicion debe tener al menos 5 caracteres.');
        const incomeCategory = movement.movementType === 'income'
            ? await dataAccess.financialIncomeCategories.getById(params.input.categoryId)
            : null;
        const expenseCategory = movement.movementType === 'expense'
            ? await dataAccess.financialExpenseCategories.getById(params.input.categoryId)
            : null;
        const category = incomeCategory ?? expenseCategory;
        assertCondition(category, 'not-found', `No existe la categoria ${params.input.categoryId}.`);
        assertCondition(category.active, 'failed-precondition', `La categoria ${params.input.categoryId} esta inactiva.`);
        const paymentMethod = params.input.paymentMethodId
            ? await dataAccess.paymentMethods.getById(params.input.paymentMethodId)
            : null;
        if (params.input.paymentMethodId) {
            assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${params.input.paymentMethodId}.`);
            assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${params.input.paymentMethodId} esta inactivo.`);
        }
        assertCondition(paymentMethod, 'invalid-argument', 'Los ingresos y egresos deben tener un medio de pago.');
        assertCondition(params.input.paymentMethodId !== PAYMENT_METHOD_IDS.debitMacro
            || params.input.categoryId === FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, 'invalid-argument', 'Cuenta debito Macro solo esta disponible para cuotas societarias.');
        let appliedCommissionPctBps = null;
        let appliedCommissionAmountMinor = null;
        let grossAmountMinor = params.input.grossAmountMinor;
        let netAmountMinor = params.input.grossAmountMinor;
        const commissionRule = await dataAccess.paymentCommissionRules.getActiveByPaymentMethodId(paymentMethod.id);
        if (commissionRule) {
            appliedCommissionPctBps = commissionRule.percentageBps;
            appliedCommissionAmountMinor = calculateAmountFromBps(params.input.grossAmountMinor, commissionRule.percentageBps);
            if (movement.movementType === 'income') {
                grossAmountMinor += appliedCommissionAmountMinor;
            }
            else {
                netAmountMinor += appliedCommissionAmountMinor;
            }
        }
        const description = params.input.description?.trim() || null;
        const paymentReference = params.input.paymentReference?.trim() || null;
        const thirdPartyLabel = params.input.thirdPartyLabel?.trim() || null;
        const previousMetadata = movement.metadata ?? {};
        const editedAt = new Date();
        const metadata = {
            ...previousMetadata,
            description,
            paymentReference,
            ...(movement.movementType === 'income'
                ? { payerName: thirdPartyLabel }
                : { vendorName: thirdPartyLabel }),
            editHistory: [
                ...getMovementEditHistory(previousMetadata),
                {
                    editedAt: editedAt.toISOString(),
                    editedByUid: actor.uid,
                    reason: params.input.reason.trim(),
                    previous: {
                        categoryId: movement.categoryId,
                        paymentMethodId: movement.paymentMethodId ?? null,
                        grossAmountMinor: movement.grossAmountMinor,
                        netAmountMinor: movement.netAmountMinor,
                        operationDate: movement.operationDate.toDate().toISOString(),
                        description: typeof previousMetadata.description === 'string' ? previousMetadata.description : null,
                        paymentReference: typeof previousMetadata.paymentReference === 'string' ? previousMetadata.paymentReference : null,
                        notes: movement.notes ?? null,
                    },
                },
            ],
            lastEditReason: params.input.reason.trim(),
            lastEditedAt: editedAt.toISOString(),
            lastEditedByUid: actor.uid,
            appliedCommissionPctBps,
            appliedCommissionAmountMinor,
            ...(movement.movementType === 'income'
                ? { clubAmountMinor: netAmountMinor, amountToChargeMinor: grossAmountMinor }
                : { expenseBaseAmountMinor: grossAmountMinor, expenseTotalDebitedMinor: netAmountMinor }),
        };
        const isOvertime = params.input.categoryId === FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra;
        const isInternalTransfer = params.input.categoryId === FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer
            || params.input.categoryId === FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer;
        const bancarizado = paymentMethod.bancarizado;
        const imputableImpositivo = isOvertime || isInternalTransfer
            ? false
            : movement.movementType === 'income'
                ? true
                : expenseCategory?.defaultImputableImpositivo ?? movement.imputableImpositivo;
        const oldClosuresPage = await dataAccess.cashClosures.listPage({
            period: movement.accountingPeriod,
            limit: 100,
        });
        const nextAccountingPeriod = toClubAccountingPeriod(params.input.operationDate);
        const nextClosuresPage = nextAccountingPeriod === movement.accountingPeriod
            ? oldClosuresPage
            : await dataAccess.cashClosures.listPage({
                period: nextAccountingPeriod,
                limit: 100,
            });
        const closuresById = new Map([...oldClosuresPage.items, ...nextClosuresPage.items].map((closure) => [closure.id, closure]));
        const oldClosure = Array.from(closuresById.values()).find((closure) => closure.movementIds.includes(movement.id)) ?? null;
        const nextDayKey = toClubDayKey(params.input.operationDate);
        const nextClosure = Array.from(closuresById.values()).find((closure) => closure.status !== 'voided'
            && toClubDayKey(closure.closureDate.toDate()) === nextDayKey) ?? null;
        const closurePatches = new Map();
        const oldSignedAmountMinor = signedMovementAmount(movement.movementType, movement.netAmountMinor);
        const nextSignedAmountMinor = signedMovementAmount(movement.movementType, netAmountMinor);
        if (oldClosure) {
            closurePatches.set(oldClosure.id, buildClosureEditPatch({
                closure: oldClosure,
                movementId: movement.id,
                removeOld: true,
                addNext: nextClosure?.id === oldClosure.id,
                oldPaymentMethodId: movement.paymentMethodCodeSnapshot,
                oldSignedAmountMinor,
                nextPaymentMethodId: paymentMethod?.id,
                nextSignedAmountMinor,
            }));
        }
        if (nextClosure && nextClosure.id !== oldClosure?.id) {
            closurePatches.set(nextClosure.id, buildClosureEditPatch({
                closure: nextClosure,
                movementId: movement.id,
                removeOld: false,
                addNext: true,
                oldPaymentMethodId: movement.paymentMethodCodeSnapshot,
                oldSignedAmountMinor,
                nextPaymentMethodId: paymentMethod?.id,
                nextSignedAmountMinor,
            }));
        }
        await dataAccess.financialMovements.update(movement.id, {
            categoryId: category.id,
            categoryCodeSnapshot: category.id,
            operationDate: Timestamp.fromDate(params.input.operationDate),
            accountingPeriod: nextAccountingPeriod,
            paymentMethodId: paymentMethod?.id ?? null,
            paymentMethodCodeSnapshot: paymentMethod?.id ?? null,
            grossAmountMinor,
            appliedCommissionPctBps,
            appliedCommissionAmountMinor,
            netAmountMinor,
            bancarizado,
            imputableImpositivo,
            approvedByUid: actor.uid,
            approvedAt: Timestamp.fromDate(editedAt),
            metadata,
            notes: params.input.notes?.trim() || description,
        }, actor.uid);
        for (const [closureId, patch] of closurePatches) {
            await dataAccess.cashClosures.update(closureId, patch, actor.uid);
        }
        if (movement.originCollection === ACCOUNTING_COLLECTIONS.memberFeeCharges && movement.originId) {
            await dataAccess.memberFeeCharges.update(movement.originId, {
                paidAt: Timestamp.fromDate(params.input.operationDate),
                paidAmountMinor: params.input.grossAmountMinor,
            }, actor.uid);
        }
        if (movement.originCollection === ACCOUNTING_COLLECTIONS.expenseSubmissions && movement.originId) {
            await dataAccess.expenseSubmissions.update(movement.originId, {
                categoryId: category.id,
                categoryCodeSnapshot: category.id,
                description: description ?? category.name,
                expenseDate: Timestamp.fromDate(params.input.operationDate),
                amountMinor: params.input.grossAmountMinor,
                vendorName: thirdPartyLabel,
                paymentMethodId: paymentMethod?.id ?? null,
            }, actor.uid);
        }
        if (movement.originCollection === ACCOUNTING_COLLECTIONS.handicapCharges && movement.originId) {
            await dataAccess.handicapCharges.update(movement.originId, movement.movementType === 'income'
                ? { collectionAmountMinor: params.input.grossAmountMinor, notes: params.input.notes ?? null }
                : { transferAmountMinor: params.input.grossAmountMinor, notes: params.input.notes ?? null }, actor.uid);
        }
        return { movementId: movement.id, status: 'posted' };
    });
}
export async function setFinancialMovementBalanceInclusionUseCase(params) {
    const actor = ensureStaff(params.actor);
    assertCondition(params.input.reason.trim().length >= 5, 'invalid-argument', 'El motivo debe tener al menos 5 caracteres.');
    return params.transactions.runInTransaction(async (dataAccess) => {
        const movement = await dataAccess.financialMovements.getById(params.input.movementId);
        assertCondition(movement, 'not-found', `No existe financial_movements/${params.input.movementId}.`);
        assertCondition(movement.status !== 'voided', 'failed-precondition', 'Los movimientos anulados ya no se cuentan en balance.');
        assertCondition(!movement.installmentPlanId, 'failed-precondition', 'Las cargas en cuotas se administran desde su detalle.');
        const linkedMovementId = getBalanceLinkedMovementId(movement);
        const mustHaveLinkedMovement = movement.status === 'reversed'
            || movement.originType === 'movement_reversal'
            || movement.originType === 'internal_transfer';
        assertCondition(!mustHaveLinkedMovement || linkedMovementId, 'failed-precondition', 'El movimiento vinculado no esta identificado y no se puede actualizar el balance de forma segura.');
        const linkedMovement = linkedMovementId
            ? await dataAccess.financialMovements.getById(linkedMovementId)
            : null;
        if (linkedMovementId) {
            assertCondition(linkedMovement, 'not-found', `No existe financial_movements/${linkedMovementId}.`);
        }
        if (movement.reversalOfMovementId && linkedMovement) {
            assertCondition(linkedMovement.reversalOfMovementId === movement.id, 'failed-precondition', 'La vinculacion entre el movimiento original y su reverso no es reciproca.');
        }
        const targets = linkedMovement ? [movement, linkedMovement] : [movement];
        const changedAt = new Date();
        const reason = params.input.reason.trim();
        for (const target of targets) {
            const historyEntry = {
                changedAt: changedAt.toISOString(),
                changedByUid: actor.uid,
                excluded: params.input.excluded,
                reason,
                previousExcluded: target.excludeFromBalance === true,
                linkedMovementId: target.id === movement.id ? linkedMovement?.id ?? null : movement.id,
            };
            await dataAccess.financialMovements.update(target.id, {
                excludeFromBalance: params.input.excluded,
                balanceExclusionReason: params.input.excluded ? reason : null,
                balanceExcludedAt: params.input.excluded ? Timestamp.fromDate(changedAt) : null,
                balanceExcludedByUid: params.input.excluded ? actor.uid : null,
                metadata: {
                    ...(target.metadata ?? {}),
                    balanceInclusionHistory: appendBalanceInclusionHistory(target, historyEntry),
                    lastBalanceInclusionChange: historyEntry,
                },
            }, actor.uid);
        }
        return {
            movementId: movement.id,
            excluded: params.input.excluded,
            affectedMovementIds: targets.map((target) => target.id),
        };
    });
}
export function parseVoidFinancialMovementInput(payload) {
    const data = assertIsRecord(payload);
    return {
        movementId: parseRequiredString(data, 'movementId'),
        reason: parseRequiredString(data, 'reason'),
    };
}
export function parseEditFinancialMovementInput(payload) {
    const data = assertIsRecord(payload);
    return {
        movementId: parseRequiredString(data, 'movementId'),
        categoryId: parseRequiredString(data, 'categoryId'),
        paymentMethodId: parseOptionalNullableString(data, 'paymentMethodId'),
        grossAmountMinor: parseRequiredAmountMinor(data, 'grossAmountMinor'),
        operationDate: parseRequiredIsoDate(data, 'operationDate'),
        description: parseOptionalNullableString(data, 'description'),
        paymentReference: parseOptionalNullableString(data, 'paymentReference'),
        thirdPartyLabel: parseOptionalNullableString(data, 'thirdPartyLabel'),
        notes: parseOptionalNullableString(data, 'notes'),
        reason: parseRequiredString(data, 'reason'),
    };
}
export function parseSetFinancialMovementBalanceInclusionInput(payload) {
    const data = assertIsRecord(payload);
    return {
        movementId: parseRequiredString(data, 'movementId'),
        excluded: parseRequiredBoolean(data, 'excluded'),
        reason: parseRequiredString(data, 'reason'),
    };
}
//# sourceMappingURL=movement.use-cases.js.map