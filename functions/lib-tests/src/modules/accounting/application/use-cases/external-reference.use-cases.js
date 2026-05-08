import { Timestamp } from 'firebase-admin/firestore';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureStaff, parseOptionalAccountingPeriod, parseOptionalIsoDate, parseOptionalNullableString, parseRequiredAccountingPeriod, parseRequiredAmountMinor, parseRequiredString, } from '../shared.js';
export async function recordExternalReferenceUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        if (params.input.linkedMovementId) {
            const linkedMovement = await dataAccess.financialMovements.getById(params.input.linkedMovementId);
            assertCondition(linkedMovement, 'not-found', `No existe financial_movements/${params.input.linkedMovementId}.`);
        }
        const status = params.input.linkedMovementId ? 'linked' : 'recorded';
        const referenceId = await dataAccess.externalAccountingReferences.create({
            referenceType: params.input.referenceType,
            providerName: params.input.providerName ?? null,
            period: params.input.period,
            referenceNumber: params.input.referenceNumber ?? null,
            amountMinor: params.input.amountMinor,
            dueDate: params.input.dueDate ? Timestamp.fromDate(params.input.dueDate) : null,
            documentDate: params.input.documentDate ? Timestamp.fromDate(params.input.documentDate) : null,
            attachmentUrl: params.input.attachmentUrl ?? null,
            linkedMovementId: params.input.linkedMovementId ?? null,
            status,
            notes: params.input.notes ?? null,
        }, actor.uid);
        return { referenceId, status };
    });
}
export function parseRecordExternalReferenceInput(payload) {
    const data = assertIsRecord(payload);
    return {
        referenceType: parseRequiredString(data, 'referenceType'),
        providerName: parseOptionalNullableString(data, 'providerName'),
        period: parseOptionalAccountingPeriod(data, 'period') ?? parseRequiredAccountingPeriod(data, 'period'),
        referenceNumber: parseOptionalNullableString(data, 'referenceNumber'),
        amountMinor: parseRequiredAmountMinor(data, 'amountMinor'),
        dueDate: parseOptionalIsoDate(data, 'dueDate') ?? null,
        documentDate: parseOptionalIsoDate(data, 'documentDate') ?? null,
        attachmentUrl: parseOptionalNullableString(data, 'attachmentUrl'),
        linkedMovementId: parseOptionalNullableString(data, 'linkedMovementId'),
        notes: parseOptionalNullableString(data, 'notes'),
    };
}
//# sourceMappingURL=external-reference.use-cases.js.map