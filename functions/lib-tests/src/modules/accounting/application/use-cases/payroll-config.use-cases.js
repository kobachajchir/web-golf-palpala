import { Timestamp } from 'firebase-admin/firestore';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureDirectivo, parseOptionalFiniteNumber, parseOptionalIsoDate, parseRequiredFiniteNumber, } from '../shared.js';
function assertIntegerRange(value, field, min, max) {
    assertCondition(Number.isInteger(value) && value >= min && value <= max, 'invalid-argument', `${field} debe estar entre ${min} y ${max}.`);
}
export async function upsertPayrollConfigUseCase(params) {
    const actor = ensureDirectivo(params.actor);
    assertIntegerRange(params.input.paymentDay, 'paymentDay', 1, 28);
    if (params.input.prepareReceiptsDaysBefore !== undefined && params.input.prepareReceiptsDaysBefore !== null) {
        assertIntegerRange(params.input.prepareReceiptsDaysBefore, 'prepareReceiptsDaysBefore', 0, 15);
    }
    return params.transactions.runInTransaction(async (dataAccess) => {
        await dataAccess.payrollConfigs.setCurrent({
            paymentDay: params.input.paymentDay,
            prepareReceiptsDaysBefore: params.input.prepareReceiptsDaysBefore ?? null,
            isActive: true,
            effectiveFrom: Timestamp.fromDate(params.input.effectiveFrom ?? new Date()),
        }, actor.uid);
        return {
            payrollConfigId: 'current',
            paymentDay: params.input.paymentDay,
            prepareReceiptsDaysBefore: params.input.prepareReceiptsDaysBefore ?? null,
        };
    });
}
export function parseUpsertPayrollConfigInput(payload) {
    const data = assertIsRecord(payload);
    return {
        paymentDay: parseRequiredFiniteNumber(data, 'paymentDay'),
        prepareReceiptsDaysBefore: parseOptionalFiniteNumber(data, 'prepareReceiptsDaysBefore') ?? null,
        effectiveFrom: parseOptionalIsoDate(data, 'effectiveFrom'),
    };
}
//# sourceMappingURL=payroll-config.use-cases.js.map