import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { ACCOUNTING_COLLECTIONS, FINANCIAL_EXPENSE_CATEGORY_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import type { Actor, EmployeeAccountingLinkStatus, ExternalReferenceStatus, ExternalReferenceType } from '../../domain/models.js';
import type { AccountingTransactionManager } from '../../domain/ports.js';
import {
  assertIsRecord,
  ensureStaff,
  parseOptionalAccountingPeriod,
  parseOptionalIsoDate,
  parseOptionalNullableString,
  parseRequiredAccountingPeriod,
  parseRequiredAmountMinor,
  parseRequiredString,
  toClubAccountingPeriod,
} from '../shared.js';
import { buildMovementPatchForVoid, createPostedMovement } from '../movement-helpers.js';
import { assertCashOperationDateAllowed } from '../cash-closure-guards.js';

export interface RecordExternalReferenceInput {
  requestId?: string | null | undefined;
  employeeId?: string | null | undefined;
  referenceType: ExternalReferenceType;
  providerName?: string | null | undefined;
  period: string;
  referenceNumber?: string | null | undefined;
  amountMinor: number;
  allocatedAmountMinor?: number | null | undefined;
  dueDate?: Date | null | undefined;
  documentDate?: Date | null | undefined;
  attachmentUrl?: string | null | undefined;
  linkedMovementId?: string | null | undefined;
  paidAt?: Date | null | undefined;
  operationDate?: Date | null | undefined;
  paymentMethodId?: string | null | undefined;
  notes?: string | null | undefined;
}

export async function recordExternalReferenceUseCase(params: {
  actor: Actor | null;
  input: RecordExternalReferenceInput;
  transactions: AccountingTransactionManager;
}): Promise<{ referenceId: string; movementId: string; status: 'paid'; duplicate: boolean }> {
  const actor = ensureStaff(params.actor);
  const requestId = params.input.requestId?.trim();
  assertCondition(requestId && /^[A-Za-z0-9_-]{8,80}$/.test(requestId), 'invalid-argument', 'La solicitud de pago no tiene un identificador valido.');
  const referenceId = `labor_${createHash('sha256').update(`${actor.uid}:${requestId}`).digest('hex')}`;

  return params.transactions.runInTransaction(async (dataAccess) => {
    const existing = await dataAccess.externalAccountingReferences.getById(referenceId);
    if (existing) {
      assertCondition(existing.status === 'paid' && existing.linkedMovementId, 'failed-precondition', 'La solicitud ya existe, pero su pago no esta completo.');
      return { referenceId, movementId: existing.linkedMovementId, status: 'paid' as const, duplicate: true };
    }
    const operationDate = params.input.operationDate;
    const paymentMethodId = params.input.paymentMethodId?.trim();
    assertCondition(operationDate, 'invalid-argument', 'La fecha del pago es obligatoria.');
    assertCondition(paymentMethodId, 'invalid-argument', 'El medio de pago es obligatorio.');
    await assertCashOperationDateAllowed({ dataAccess, operationDate });
    if (params.input.employeeId) {
      const employee = await dataAccess.employees.getById(params.input.employeeId);
      assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);
    }

    const categoryIdByReferenceType: Record<ExternalReferenceType, string> = {
      F931: FINANCIAL_EXPENSE_CATEGORY_IDS.f931,
      OBRA_SOCIAL: FINANCIAL_EXPENSE_CATEGORY_IDS.obraSocial,
      ART: FINANCIAL_EXPENSE_CATEGORY_IDS.art,
      OTHER: FINANCIAL_EXPENSE_CATEGORY_IDS.varios,
    };
    const categoryId = categoryIdByReferenceType[params.input.referenceType];
    assertCondition(categoryId, 'invalid-argument', 'El tipo de documento laboral no es valido.');
    const category = await dataAccess.financialExpenseCategories.getById(categoryId);
    assertCondition(category, 'not-found', `No existe financial_expense_categories/${categoryId}.`);
    assertCondition(category.active, 'failed-precondition', `La categoria contable ${categoryId} esta inactiva.`);
    const paymentMethod = await dataAccess.paymentMethods.getById(paymentMethodId);
    assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${paymentMethodId}.`);
    assertCondition(paymentMethod.active, 'failed-precondition', `El medio de pago ${paymentMethodId} esta inactivo.`);
    const movement = await createPostedMovement({
      dataAccess,
      actorUid: actor.uid,
      movementType: 'expense',
      categoryId: category.id,
      categoryCodeSnapshot: category.id,
      grossAmountMinor: params.input.amountMinor,
      operationDate,
      originType: 'external_labor_document',
      originCollection: 'external_accounting_references',
      originId: referenceId,
      thirdPartyType: 'external',
      thirdPartyId: referenceId,
      paymentMethodId,
      prefetchedPaymentMethod: paymentMethod,
      bancarizado: category.defaultBancarizado,
      imputableImpositivo: category.defaultImputableImpositivo,
      metadata: {
        referenceType: params.input.referenceType,
        referenceNumber: params.input.referenceNumber ?? null,
        providerName: params.input.providerName ?? null,
        documentPeriod: params.input.period,
      },
      notes: params.input.notes ?? null,
      applyPaymentCommission: false,
    });
    await dataAccess.externalAccountingReferences.createWithId(referenceId, {
      employeeId: params.input.employeeId ?? null,
      referenceType: params.input.referenceType,
      providerName: params.input.providerName ?? null,
      period: params.input.period,
      referenceNumber: params.input.referenceNumber ?? null,
      amountMinor: params.input.amountMinor,
      dueDate: params.input.dueDate ? Timestamp.fromDate(params.input.dueDate) : null,
      documentDate: params.input.documentDate ? Timestamp.fromDate(params.input.documentDate) : null,
      attachmentUrl: params.input.attachmentUrl ?? null,
      linkedMovementId: movement.movementId,
      paidAt: Timestamp.fromDate(operationDate),
      paidByUid: actor.uid,
      status: 'paid',
      notes: params.input.notes ?? null,
    }, actor.uid);

    return { referenceId, movementId: movement.movementId, status: 'paid' as const, duplicate: false };
  });
}

export async function upsertEmployeeExternalReferenceUseCase(params: {
  actor: Actor | null;
  input: RecordExternalReferenceInput & { employeeId: string };
  transactions: AccountingTransactionManager;
}): Promise<{ referenceId: string; linkId: string; status: 'recorded' | 'linked' | 'paid'; duplicate: boolean }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const employee = await dataAccess.employees.getById(params.input.employeeId);
    assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);

    if (params.input.linkedMovementId) {
      const linkedMovement = await dataAccess.financialMovements.getById(params.input.linkedMovementId);
      assertCondition(linkedMovement, 'not-found', `No existe financial_movements/${params.input.linkedMovementId}.`);
    }

    const status: ExternalReferenceStatus = params.input.paidAt ? 'paid' : params.input.linkedMovementId ? 'linked' : 'recorded';
    const existingReference = await dataAccess.externalAccountingReferences.findByEmployeePeriodAndReferenceType({
      employeeId: employee.id,
      period: params.input.period,
      referenceType: params.input.referenceType,
    });
    const referenceData = {
      employeeId: employee.id,
      referenceType: params.input.referenceType,
      providerName: params.input.providerName ?? null,
      period: params.input.period,
      referenceNumber: params.input.referenceNumber ?? null,
      amountMinor: params.input.amountMinor,
      dueDate: params.input.dueDate ? Timestamp.fromDate(params.input.dueDate) : null,
      documentDate: params.input.documentDate ? Timestamp.fromDate(params.input.documentDate) : null,
      attachmentUrl: params.input.attachmentUrl ?? null,
      linkedMovementId: params.input.linkedMovementId ?? null,
      paidAt: params.input.paidAt ? Timestamp.fromDate(params.input.paidAt) : null,
      paidByUid: params.input.paidAt ? actor.uid : null,
      status,
      notes: params.input.notes ?? null,
    };
    const referenceId = existingReference
      ? existingReference.id
      : await dataAccess.externalAccountingReferences.create(referenceData, actor.uid);

    if (existingReference) {
      await dataAccess.externalAccountingReferences.update(existingReference.id, referenceData, actor.uid);
    }

    const existingLink = await dataAccess.employeeAccountingLinks.findByEmployeePeriodAndReferenceType({
      employeeId: employee.id,
      period: params.input.period,
      referenceType: params.input.referenceType,
    });
    const linkStatus: EmployeeAccountingLinkStatus = status;
    const linkData = {
      employeeId: employee.id,
      period: params.input.period,
      referenceId,
      referenceType: params.input.referenceType,
      allocatedAmountMinor: params.input.allocatedAmountMinor ?? params.input.amountMinor,
      paidAt: params.input.paidAt ? Timestamp.fromDate(params.input.paidAt) : null,
      status: linkStatus,
      notes: params.input.notes ?? null,
    };
    const linkId = existingLink
      ? existingLink.id
      : await dataAccess.employeeAccountingLinks.create(linkData, actor.uid);

    if (existingLink) {
      await dataAccess.employeeAccountingLinks.update(existingLink.id, linkData, actor.uid);
    }

    return {
      referenceId,
      linkId,
      status,
      duplicate: Boolean(existingReference || existingLink),
    };
  });
}

export function parseRecordExternalReferenceInput(payload: unknown): RecordExternalReferenceInput {
  const data = assertIsRecord(payload);

  return {
    requestId: parseOptionalNullableString(data, 'requestId'),
    employeeId: parseOptionalNullableString(data, 'employeeId'),
    referenceType: parseRequiredString(data, 'referenceType') as ExternalReferenceType,
    providerName: parseOptionalNullableString(data, 'providerName'),
    period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
    referenceNumber: parseOptionalNullableString(data, 'referenceNumber'),
    amountMinor: parseRequiredAmountMinor(data, 'amountMinor'),
    allocatedAmountMinor: 'allocatedAmountMinor' in data ? parseRequiredAmountMinor(data, 'allocatedAmountMinor') : null,
    dueDate: parseOptionalIsoDate(data, 'dueDate') ?? null,
    documentDate: parseOptionalIsoDate(data, 'documentDate') ?? null,
    attachmentUrl: parseOptionalNullableString(data, 'attachmentUrl'),
    linkedMovementId: parseOptionalNullableString(data, 'linkedMovementId'),
    paidAt: parseOptionalIsoDate(data, 'paidAt') ?? null,
    operationDate: parseOptionalIsoDate(data, 'operationDate') ?? null,
    paymentMethodId: parseOptionalNullableString(data, 'paymentMethodId'),
    notes: parseOptionalNullableString(data, 'notes'),
  };
}

export function parseUpsertEmployeeExternalReferenceInput(payload: unknown): RecordExternalReferenceInput & { employeeId: string } {
  const input = parseRecordExternalReferenceInput(payload);
  assertCondition(input.employeeId, 'invalid-argument', 'employeeId es obligatorio.');

  return {
    ...input,
    employeeId: input.employeeId,
  };
}

export async function deleteExternalReferenceUseCase(params: {
  actor: Actor | null;
  input: { referenceId: string };
  transactions: AccountingTransactionManager;
}): Promise<{ success: boolean; reversalMovementId: string | null }> {
  const actor = ensureStaff(params.actor);

  return params.transactions.runInTransaction(async (dataAccess) => {
    const reference = await dataAccess.externalAccountingReferences.getById(params.input.referenceId);
    assertCondition(reference, 'not-found', `No existe el documento laboral con ID ${params.input.referenceId}.`);

    let reversalMovementId: string | null = null;
    if (reference.linkedMovementId) {
      const movement = await dataAccess.financialMovements.getById(reference.linkedMovementId);
      if (movement && movement.status === 'posted') {
        const reversalDate = new Date();
        reversalMovementId = await dataAccess.financialMovements.create(
          {
            movementType: movement.movementType === 'income' ? 'expense' : 'income',
            categoryId: movement.categoryId,
            categoryCodeSnapshot: movement.categoryCodeSnapshot,
            status: 'posted',
            operationDate: Timestamp.fromDate(reversalDate),
            postingDate: Timestamp.fromDate(reversalDate),
            accountingPeriod: toClubAccountingPeriod(reversalDate),
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
            approvedAt: Timestamp.fromDate(reversalDate),
            reversalOfMovementId: movement.id,
            voidReason: null,
            excludeFromBalance: movement.excludeFromBalance ?? false,
            balanceExclusionReason: movement.balanceExclusionReason ?? null,
            balanceExcludedAt: movement.balanceExcludedAt ?? null,
            balanceExcludedByUid: movement.balanceExcludedByUid ?? null,
            metadata: { reversesMovementId: movement.id, deletedExternalReferenceId: reference.id },
            notes: `Reverso por eliminacion del documento laboral ${reference.id}.`,
          },
          actor.uid,
        );
        await dataAccess.financialMovements.update(movement.id, {
          status: 'reversed',
          voidReason: `Documento laboral ${reference.id} eliminado por error de carga.`,
          reversalOfMovementId: reversalMovementId,
        }, actor.uid);
      } else if (movement && movement.status !== 'voided' && movement.status !== 'reversed') {
        await dataAccess.financialMovements.update(movement.id, buildMovementPatchForVoid({
          existingMovement: movement,
          reason: `Documento laboral ${reference.id} eliminado por error de carga.`,
        }), actor.uid);
      }
    }

    const links = await dataAccess.employeeAccountingLinks.listByReferenceAndPeriod(reference.id, reference.period);
    for (const link of links) {
      await dataAccess.employeeAccountingLinks.delete(link.id, actor.uid);
    }
    await dataAccess.externalAccountingReferences.delete(reference.id, actor.uid);

    return { success: true, reversalMovementId };
  });
}

export function parseDeleteExternalReferenceInput(payload: unknown): { referenceId: string } {
  const data = assertIsRecord(payload);
  return {
    referenceId: parseRequiredString(data, 'referenceId'),
  };
}
