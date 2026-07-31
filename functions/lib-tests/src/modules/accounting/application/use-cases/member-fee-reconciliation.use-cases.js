import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_INCOME_CATEGORY_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, buildFeePreview, calculateEarlyPaymentDiscount, calculateMembershipRenewalDueDateFromPeriod, ensureDirectivo, ensureStaff, parseOptionalBoolean, parseRequiredAccountingPeriod, } from '../shared.js';
const PAGE_SIZE = 200;
const MAX_REPAIR_WRITES = 350;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readNumber(record, field) {
    const value = record[field];
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}
function readDiscountMode(record) {
    const value = record.discountMode;
    return value === 'automatic' || value === 'manual' || value === 'none' ? value : undefined;
}
function chargeMemberId(charge) {
    return charge.memberId ?? charge.holderMemberId ?? null;
}
function movementClubAmountMinor(movement) {
    const metadata = movement.metadata;
    const storedClubAmount = isRecord(metadata) ? readNumber(metadata, 'clubAmountMinor') : undefined;
    return storedClubAmount && storedClubAmount > 0 ? storedClubAmount : movement.netAmountMinor;
}
function inferSettlementFromMovement(movement, charge, config) {
    const metadata = isRecord(movement.metadata) ? movement.metadata : {};
    const storedDiscountAmountMinor = readNumber(metadata, 'memberFeeEarlyPaymentDiscountAmountMinor')
        ?? readNumber(metadata, 'earlyPaymentDiscountAmountMinor');
    const storedDiscountPctBps = readNumber(metadata, 'earlyPaymentDiscountPctBps');
    if (storedDiscountAmountMinor !== undefined || storedDiscountPctBps !== undefined) {
        const discountAmountMinor = Math.max(storedDiscountAmountMinor ?? 0, 0);
        return {
            settlementAmountMinor: Math.max(charge.finalAmountMinor - discountAmountMinor, 0),
            discountPctBps: Math.max(storedDiscountPctBps ?? 0, 0),
            discountAmountMinor,
            discountMode: (discountAmountMinor > 0 ? 'automatic' : 'none'),
        };
    }
    if (config) {
        const calculated = calculateEarlyPaymentDiscount({
            chargeAmountMinor: charge.finalAmountMinor,
            config,
            chargePeriod: charge.period,
            operationDate: movement.operationDate.toDate(),
        });
        if (calculated.qualifies && movementClubAmountMinor(movement) === calculated.paidAmountMinor) {
            return {
                settlementAmountMinor: calculated.paidAmountMinor,
                discountPctBps: calculated.discountPctBps,
                discountAmountMinor: calculated.discountAmountMinor,
                discountMode: 'automatic',
            };
        }
    }
    return {
        settlementAmountMinor: charge.finalAmountMinor,
        discountPctBps: 0,
        discountAmountMinor: 0,
        discountMode: 'none',
    };
}
function buildMissingChargeSnapshot(params) {
    const preview = buildFeePreview({
        member: params.member,
        config: params.config,
        period: params.period,
    });
    const metadata = isRecord(params.movement.metadata) ? params.movement.metadata : {};
    const storedBaseAmountMinor = readNumber(metadata, 'memberFeeBaseAmountMinor');
    const storedTypeDiscountAmountMinor = readNumber(metadata, 'memberFeeTypeDiscountAmountMinor');
    const baseAmountMinor = storedBaseAmountMinor ?? preview.baseAmountMinor;
    const finalAmountMinor = storedBaseAmountMinor !== undefined || storedTypeDiscountAmountMinor !== undefined
        ? Math.max(baseAmountMinor - (storedTypeDiscountAmountMinor ?? 0), 0)
        : preview.finalAmountMinor;
    const appliedPctBps = baseAmountMinor > 0
        ? Math.max(0, Math.min(10_000, Math.round((finalAmountMinor * 10_000) / baseAmountMinor)))
        : preview.appliedPctBps;
    const chargeId = 'reconstructed:' + params.member.id + ':' + params.period;
    return {
        preview,
        charge: {
            id: chargeId,
            memberId: params.member.id,
            familyGroupId: preview.familyGroupId ?? null,
            holderMemberId: preview.holderMemberId ?? null,
            period: params.period,
            configVersion: preview.configVersion,
            memberTypeCodeSnapshot: preview.memberTypeCodeSnapshot,
            billingMode: preview.billingMode,
            baseAmountMinor,
            appliedPctBps,
            finalAmountMinor,
            status: 'pending',
            dueDate: null,
            generatedByUid: params.movement.registeredByUid,
            paidMovementId: null,
            paymentMovementIds: [],
            paidAt: null,
            paidAmountMinor: 0,
            settlementAmountMinor: null,
            paidClubAmountMinor: 0,
            remainingAmountMinor: finalAmountMinor,
            paymentDiscountPctBps: 0,
            paymentDiscountAmountMinor: 0,
            paymentDiscountMode: 'none',
            notes: null,
            createdAt: params.movement.createdAt,
            createdBy: params.movement.createdBy,
            updatedAt: params.movement.updatedAt,
            updatedBy: params.movement.updatedBy,
        },
    };
}
async function listMovementsForPeriod(dataAccess, period) {
    const items = [];
    let cursorId;
    do {
        const page = await dataAccess.financialMovements.listPage({
            accountingPeriod: period,
            status: 'posted',
            limit: PAGE_SIZE,
            ...(cursorId ? { cursorId } : {}),
        });
        items.push(...page.items);
        cursorId = page.nextCursorId;
    } while (cursorId);
    return items;
}
async function listChargesForPeriod(dataAccess, period) {
    const items = [];
    let cursorId;
    do {
        const page = await dataAccess.memberFeeCharges.listPage({
            period,
            limit: PAGE_SIZE,
            ...(cursorId ? { cursorId } : {}),
        });
        items.push(...page.items);
        cursorId = page.nextCursorId;
    } while (cursorId);
    return items;
}
async function listChargesForMember(dataAccess, memberId) {
    const items = [];
    let cursorId;
    do {
        const page = await dataAccess.memberFeeCharges.listPage({
            memberId,
            limit: PAGE_SIZE,
            ...(cursorId ? { cursorId } : {}),
        });
        items.push(...page.items);
        cursorId = page.nextCursorId;
    } while (cursorId);
    return items;
}
function parsePaymentAllocations(movement) {
    const metadata = isRecord(movement.metadata) ? movement.metadata : null;
    const allocations = metadata?.paymentAllocations;
    if (!Array.isArray(allocations))
        return [];
    return allocations.flatMap((value) => {
        if (!isRecord(value) || typeof value.chargeId !== 'string' || !value.chargeId.trim())
            return [];
        const appliedAmountMinor = readNumber(value, 'appliedClubAmountMinor');
        if (!appliedAmountMinor || appliedAmountMinor <= 0)
            return [];
        return [{
                chargeId: value.chargeId.trim(),
                appliedAmountMinor,
                settlementAmountMinor: readNumber(value, 'settlementAmountMinor'),
                discountPctBps: readNumber(value, 'discountPctBps'),
                discountAmountMinor: readNumber(value, 'discountAmountMinor'),
                discountMode: readDiscountMode(value),
            }];
    });
}
function getStoredPaidAmount(charge, settlementAmountMinor) {
    if (typeof charge.paidClubAmountMinor === 'number')
        return charge.paidClubAmountMinor;
    if (typeof charge.paidAmountMinor === 'number')
        return charge.paidAmountMinor;
    return charge.status === 'paid' ? settlementAmountMinor : 0;
}
function isOpenChargeStatus(status) {
    return status === 'pending' || status === 'overdue';
}
export async function reconcileMemberFeeRenewalsUseCase(params) {
    const actor = params.input.execute ? ensureDirectivo(params.actor) : ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const [allMovements, periodCharges, activeConfig] = await Promise.all([
            listMovementsForPeriod(dataAccess, params.input.period),
            listChargesForPeriod(dataAccess, params.input.period),
            dataAccess.financialConfigs.getActive(),
        ]);
        assertCondition(activeConfig, 'failed-precondition', 'No existe una configuracion financiera activa.');
        const feeMovements = allMovements
            .filter((movement) => movement.movementType === 'income'
            && movement.categoryCodeSnapshot === FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria
            && movement.status === 'posted')
            .sort((left, right) => left.operationDate.toMillis() - right.operationDate.toMillis());
        const chargeCache = new Map(periodCharges.map((charge) => [charge.id, charge]));
        const periodChargesByMemberId = new Map();
        periodCharges.forEach((charge) => {
            const memberId = chargeMemberId(charge);
            if (!memberId)
                return;
            const current = periodChargesByMemberId.get(memberId) ?? [];
            current.push(charge);
            periodChargesByMemberId.set(memberId, current);
        });
        const allocations = [];
        const skipped = [];
        for (const movement of feeMovements) {
            const explicitAllocations = parsePaymentAllocations(movement);
            if (explicitAllocations.length > 0) {
                for (const allocation of explicitAllocations) {
                    let charge = chargeCache.get(allocation.chargeId) ?? null;
                    if (!charge) {
                        charge = await dataAccess.memberFeeCharges.getById(allocation.chargeId);
                        if (charge)
                            chargeCache.set(charge.id, charge);
                    }
                    if (!charge) {
                        skipped.push({ movementId: movement.id, reason: `No existe la cuota explicita ${allocation.chargeId}.` });
                        continue;
                    }
                    const memberId = chargeMemberId(charge);
                    if (movement.thirdPartyId && memberId && movement.thirdPartyId !== memberId) {
                        skipped.push({ movementId: movement.id, reason: `La cuota ${charge.id} pertenece a otro socio.` });
                        continue;
                    }
                    allocations.push({ movement, charge, source: 'payment_allocation', ...allocation });
                }
                continue;
            }
            if (movement.originCollection === 'member_fee_charges' && movement.originId) {
                let charge = chargeCache.get(movement.originId) ?? null;
                if (!charge) {
                    charge = await dataAccess.memberFeeCharges.getById(movement.originId);
                    if (charge)
                        chargeCache.set(charge.id, charge);
                }
                if (!charge) {
                    skipped.push({ movementId: movement.id, reason: `No existe la cuota de origen ${movement.originId}.` });
                    continue;
                }
                allocations.push({
                    movement,
                    charge,
                    source: 'origin_charge',
                    appliedAmountMinor: movementClubAmountMinor(movement),
                    ...inferSettlementFromMovement(movement, charge, activeConfig),
                });
                continue;
            }
            if (movement.originType !== 'manual_income' || movement.thirdPartyType !== 'member' || !movement.thirdPartyId) {
                skipped.push({ movementId: movement.id, reason: 'El movimiento no tiene un vinculo inequivoco con una renovacion.' });
                continue;
            }
            const memberCharges = (periodChargesByMemberId.get(movement.thirdPartyId) ?? [])
                .filter((charge) => charge.billingMode === 'per_member');
            const openCandidates = memberCharges.filter((charge) => isOpenChargeStatus(charge.status));
            if (openCandidates.length > 1) {
                skipped.push({
                    movementId: movement.id,
                    reason: 'Hay mas de una cuota candidata para el mismo socio y periodo.',
                });
                continue;
            }
            let charge = openCandidates[0] ?? memberCharges.find((candidate) => candidate.paymentMovementIds?.includes(movement.id)
                || candidate.paidMovementId === movement.id) ?? null;
            if (!charge) {
                const duplicate = await dataAccess.memberFeeCharges.findDuplicate({
                    memberId: movement.thirdPartyId,
                    familyGroupId: null,
                    period: params.input.period,
                    billingMode: 'per_member',
                });
                if (duplicate) {
                    charge = duplicate;
                    chargeCache.set(charge.id, charge);
                }
            }
            if (!charge) {
                const member = await dataAccess.members.getById(movement.thirdPartyId);
                if (!member || member.status !== 'active' || member.membershipBillingExempt) {
                    skipped.push({
                        movementId: movement.id,
                        reason: 'El socio no existe, no esta activo o esta exento de cuota societaria.',
                    });
                    continue;
                }
                const reconstructed = buildMissingChargeSnapshot({
                    movement,
                    member,
                    config: activeConfig,
                    period: params.input.period,
                });
                if (reconstructed.preview.billingMode !== 'per_member' || reconstructed.charge.finalAmountMinor <= 0) {
                    skipped.push({
                        movementId: movement.id,
                        reason: 'La configuracion vigente no permite reconstruir una cuota individual para este socio.',
                    });
                    continue;
                }
                const inferred = inferSettlementFromMovement(movement, reconstructed.charge, activeConfig);
                const clubAmountMinor = movementClubAmountMinor(movement);
                if (clubAmountMinor <= 0 || clubAmountMinor > inferred.settlementAmountMinor) {
                    skipped.push({
                        movementId: movement.id,
                        reason: 'El importe del movimiento no es compatible con la cuota reconstruida.',
                    });
                    continue;
                }
                charge = reconstructed.charge;
                chargeCache.set(charge.id, charge);
                periodChargesByMemberId.set(movement.thirdPartyId, [...memberCharges, charge]);
            }
            allocations.push({
                movement,
                charge,
                source: 'period_member',
                appliedAmountMinor: movementClubAmountMinor(movement),
                ...inferSettlementFromMovement(movement, charge, activeConfig),
            });
        }
        const planned = new Map();
        const repairs = [];
        let alreadySynchronizedCount = 0;
        for (const allocation of allocations) {
            const existing = planned.get(allocation.charge.id);
            const settlementAmountMinor = existing?.settlementAmountMinor
                ?? allocation.charge.settlementAmountMinor
                ?? allocation.settlementAmountMinor
                ?? allocation.charge.finalAmountMinor;
            const movementIds = existing?.movementIds
                ?? [...new Set([
                        ...(allocation.charge.paymentMovementIds ?? []),
                        ...(allocation.charge.paidMovementId ? [allocation.charge.paidMovementId] : []),
                    ])];
            if (movementIds.includes(allocation.movement.id)) {
                alreadySynchronizedCount += 1;
                continue;
            }
            if (!isOpenChargeStatus(existing?.charge.status ?? allocation.charge.status)) {
                if (allocation.charge.status === 'paid')
                    alreadySynchronizedCount += 1;
                else
                    skipped.push({ movementId: allocation.movement.id, reason: `La cuota ${allocation.charge.id} no admite conciliacion por estado ${allocation.charge.status}.` });
                continue;
            }
            const paidClubAmountMinor = existing?.paidClubAmountMinor
                ?? getStoredPaidAmount(allocation.charge, settlementAmountMinor);
            const storedRemainingAmountMinor = allocation.charge.id.startsWith('reconstructed:')
                ? undefined
                : allocation.charge.remainingAmountMinor;
            const remainingAmountMinor = existing?.remainingAmountMinor
                ?? storedRemainingAmountMinor
                ?? Math.max(settlementAmountMinor - paidClubAmountMinor, 0);
            if (allocation.appliedAmountMinor <= 0 || allocation.appliedAmountMinor > remainingAmountMinor) {
                skipped.push({ movementId: allocation.movement.id, reason: `El importe no coincide con el saldo de la cuota ${allocation.charge.id}.` });
                continue;
            }
            const nextPaidClubAmountMinor = paidClubAmountMinor + allocation.appliedAmountMinor;
            const nextRemainingAmountMinor = remainingAmountMinor - allocation.appliedAmountMinor;
            const completed = nextRemainingAmountMinor === 0;
            planned.set(allocation.charge.id, {
                charge: allocation.charge,
                movementIds: [...movementIds, allocation.movement.id],
                paidClubAmountMinor: nextPaidClubAmountMinor,
                remainingAmountMinor: nextRemainingAmountMinor,
                settlementAmountMinor,
                paidMovementId: completed ? allocation.movement.id : existing?.paidMovementId ?? allocation.charge.paidMovementId ?? null,
                paidAt: completed ? allocation.movement.operationDate : existing?.paidAt ?? allocation.charge.paidAt ?? null,
                paymentDiscountPctBps: allocation.discountPctBps ?? existing?.paymentDiscountPctBps ?? allocation.charge.paymentDiscountPctBps ?? 0,
                paymentDiscountAmountMinor: allocation.discountAmountMinor ?? existing?.paymentDiscountAmountMinor ?? allocation.charge.paymentDiscountAmountMinor ?? 0,
                paymentDiscountMode: allocation.discountMode ?? existing?.paymentDiscountMode ?? allocation.charge.paymentDiscountMode ?? 'none',
                createDocument: existing?.createDocument ?? allocation.charge.id.startsWith('reconstructed:'),
            });
            repairs.push({
                movementId: allocation.movement.id,
                chargeId: allocation.charge.id,
                memberId: chargeMemberId(allocation.charge) ?? '',
                chargePeriod: allocation.charge.period,
                memberName: null,
                memberNumber: null,
                source: allocation.source,
                appliedAmountMinor: allocation.appliedAmountMinor,
                remainingAmountMinor: nextRemainingAmountMinor,
                completed,
            });
        }
        const affectedMemberIds = [...new Set([...planned.values()]
                .map((item) => chargeMemberId(item.charge))
                .filter((value) => Boolean(value)))];
        const memberPatches = new Map();
        for (const memberId of affectedMemberIds) {
            const memberCharges = await listChargesForMember(dataAccess, memberId);
            const hasReconstructedOpenCharge = [...planned.values()].some((repair) => chargeMemberId(repair.charge) === memberId && repair.remainingAmountMinor > 0);
            const simulatedOpen = hasReconstructedOpenCharge || memberCharges.some((charge) => {
                const repair = planned.get(charge.id);
                if (repair)
                    return repair.remainingAmountMinor > 0;
                return isOpenChargeStatus(charge.status) && (charge.remainingAmountMinor ?? charge.finalAmountMinor) > 0;
            });
            const memberRepairs = repairs
                .filter((repair) => repair.memberId === memberId)
                .map((repair) => ({ repair, movement: feeMovements.find((movement) => movement.id === repair.movementId) }))
                .filter((item) => Boolean(item.movement))
                .sort((left, right) => right.movement.operationDate.toMillis() - left.movement.operationDate.toMillis());
            const latest = memberRepairs[0];
            if (latest) {
                memberPatches.set(memberId, {
                    keepsOpenDebt: simulatedOpen,
                    latestPaymentAt: latest.movement.operationDate,
                    latestPaidAmountMinor: latest.repair.appliedAmountMinor,
                    latestPaidPeriod: latest.repair.chargePeriod,
                });
            }
        }
        const skippedMemberIdByMovementId = new Map(skipped.map((item) => [
            item.movementId,
            feeMovements.find((movement) => movement.id === item.movementId)?.thirdPartyId ?? null,
        ]));
        const diagnosticMemberIds = [...new Set([
                ...repairs.map((repair) => repair.memberId),
                ...skippedMemberIdByMovementId.values(),
            ].filter((value) => Boolean(value)))];
        const diagnosticMembers = await Promise.all(diagnosticMemberIds.map(async (memberId) => [memberId, await dataAccess.members.getById(memberId)]));
        const diagnosticMemberById = new Map(diagnosticMembers);
        assertCondition(planned.size + memberPatches.size <= MAX_REPAIR_WRITES, 'failed-precondition', `La sincronizacion requiere mas de ${MAX_REPAIR_WRITES} escrituras. Elegi un periodo mas acotado.`);
        if (params.input.execute) {
            const createdChargeIds = new Map();
            for (const repair of planned.values()) {
                const completed = repair.remainingAmountMinor === 0;
                const notes = [
                    repair.charge.notes?.trim(),
                    `Sincronizada con movimientos contables del periodo ${params.input.period}.`,
                ].filter(Boolean).join('\n');
                if (repair.createDocument) {
                    const createdChargeId = await dataAccess.memberFeeCharges.create({
                        memberId: repair.charge.memberId ?? null,
                        familyGroupId: repair.charge.familyGroupId ?? null,
                        holderMemberId: repair.charge.holderMemberId ?? null,
                        period: repair.charge.period,
                        configVersion: repair.charge.configVersion,
                        memberTypeCodeSnapshot: repair.charge.memberTypeCodeSnapshot,
                        billingMode: repair.charge.billingMode,
                        baseAmountMinor: repair.charge.baseAmountMinor,
                        appliedPctBps: repair.charge.appliedPctBps,
                        finalAmountMinor: repair.charge.finalAmountMinor,
                        status: completed ? 'paid' : repair.charge.status,
                        dueDate: repair.charge.dueDate ?? null,
                        generatedByUid: repair.charge.generatedByUid,
                        paidMovementId: repair.paidMovementId,
                        paymentMovementIds: repair.movementIds,
                        paidAt: repair.paidAt,
                        paidAmountMinor: repair.paidClubAmountMinor,
                        settlementAmountMinor: repair.settlementAmountMinor,
                        paidClubAmountMinor: repair.paidClubAmountMinor,
                        remainingAmountMinor: repair.remainingAmountMinor,
                        paymentDiscountPctBps: repair.paymentDiscountPctBps,
                        paymentDiscountAmountMinor: repair.paymentDiscountAmountMinor,
                        paymentDiscountMode: repair.paymentDiscountMode,
                        notes,
                    }, actor.uid);
                    createdChargeIds.set(repair.charge.id, createdChargeId);
                }
                else {
                    await dataAccess.memberFeeCharges.update(repair.charge.id, {
                        status: completed ? 'paid' : repair.charge.status,
                        paidMovementId: repair.paidMovementId,
                        paymentMovementIds: repair.movementIds,
                        paidAt: repair.paidAt,
                        paidAmountMinor: repair.paidClubAmountMinor,
                        settlementAmountMinor: repair.settlementAmountMinor,
                        paidClubAmountMinor: repair.paidClubAmountMinor,
                        remainingAmountMinor: repair.remainingAmountMinor,
                        paymentDiscountPctBps: repair.paymentDiscountPctBps,
                        paymentDiscountAmountMinor: repair.paymentDiscountAmountMinor,
                        paymentDiscountMode: repair.paymentDiscountMode,
                        notes,
                    }, actor.uid);
                }
            }
            for (const [memberId, patch] of memberPatches) {
                await dataAccess.members.update(memberId, {
                    membershipRenewalStatus: patch.keepsOpenDebt ? 'needs_renewal' : 'current',
                    membershipRenewalDueAt: patch.keepsOpenDebt
                        ? undefined
                        : Timestamp.fromDate(calculateMembershipRenewalDueDateFromPeriod(patch.latestPaidPeriod)),
                    lastFeePaymentAt: patch.latestPaymentAt,
                    lastFeePaidAmountMinor: patch.latestPaidAmountMinor,
                }, actor.uid);
            }
            repairs.forEach((repair) => {
                repair.chargeId = createdChargeIds.get(repair.chargeId) ?? repair.chargeId;
            });
        }
        return {
            period: params.input.period,
            mode: params.input.execute ? 'execute' : 'dry-run',
            scannedMovementCount: allMovements.length,
            feeMovementCount: feeMovements.length,
            scannedPeriodChargeCount: periodCharges.length,
            matchedAllocationCount: allocations.length,
            alreadySynchronizedCount,
            repairedChargeCount: planned.size,
            repairedMemberCount: memberPatches.size,
            ambiguousCount: skipped.length,
            skipped: skipped.map((item) => {
                const memberId = skippedMemberIdByMovementId.get(item.movementId) ?? null;
                const member = memberId ? diagnosticMemberById.get(memberId) : null;
                return {
                    ...item,
                    memberId,
                    memberName: member ? `${member.lastName}, ${member.firstName}` : null,
                    memberNumber: member?.memberNumber ?? null,
                };
            }),
            repairs: repairs.map((repair) => {
                const member = diagnosticMemberById.get(repair.memberId);
                return { ...repair, memberName: member ? `${member.lastName}, ${member.firstName}` : null, memberNumber: member?.memberNumber ?? null };
            }),
        };
    });
}
export function parseReconcileMemberFeeRenewalsInput(payload) {
    const data = assertIsRecord(payload);
    return {
        period: parseRequiredAccountingPeriod(data, 'period'),
        execute: parseOptionalBoolean(data, 'execute') ?? false,
    };
}
//# sourceMappingURL=member-fee-reconciliation.use-cases.js.map