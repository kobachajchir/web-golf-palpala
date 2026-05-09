import { Timestamp } from 'firebase-admin/firestore';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureNoSalaryFields, ensureStaff, parseOptionalBoolean, parseOptionalNullableIsoDate, parseOptionalNullableString, parseOptionalString, parseRequiredIsoDate, parseRequiredString, syncProfileLink, } from '../shared.js';
export async function createEmployeeUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const employeeId = await dataAccess.employees.create({
            employeeCode: params.input.employeeCode,
            firstName: params.input.firstName,
            lastName: params.input.lastName,
            dni: params.input.dni,
            linkedUserId: params.input.linkedUserId ?? undefined,
            position: params.input.position,
            contractType: params.input.contractType,
            status: 'active',
            startDate: Timestamp.fromDate(params.input.startDate),
            endDate: params.input.endDate ? Timestamp.fromDate(params.input.endDate) : undefined,
            canSubmitExpenses: params.input.canSubmitExpenses,
            notes: params.input.notes,
        }, actor.uid);
        if (params.input.linkedUserId) {
            await syncProfileLink({
                dataAccess,
                actorUid: actor.uid,
                nextLinkedUserId: params.input.linkedUserId,
                profileId: employeeId,
                profileType: 'employee',
            });
        }
        return { employeeId };
    });
}
export async function updateEmployeeUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const existingEmployee = await dataAccess.employees.getById(params.input.employeeId);
        assertCondition(existingEmployee, 'not-found', `No existe employees/${params.input.employeeId}.`);
        const nextLinkedUserId = params.input.linkedUserId === undefined ? existingEmployee.linkedUserId : params.input.linkedUserId ?? undefined;
        const shouldSyncProfileLink = params.input.linkedUserId !== undefined && existingEmployee.linkedUserId !== nextLinkedUserId;
        await dataAccess.employees.update(params.input.employeeId, {
            employeeCode: params.input.employeeCode === undefined ? undefined : params.input.employeeCode,
            firstName: params.input.firstName,
            lastName: params.input.lastName,
            dni: params.input.dni === undefined ? undefined : params.input.dni,
            linkedUserId: params.input.linkedUserId === undefined ? undefined : params.input.linkedUserId,
            position: params.input.position,
            contractType: params.input.contractType,
            status: params.input.status,
            startDate: params.input.startDate ? Timestamp.fromDate(params.input.startDate) : undefined,
            endDate: params.input.endDate === undefined
                ? undefined
                : params.input.endDate === null
                    ? null
                    : Timestamp.fromDate(params.input.endDate),
            canSubmitExpenses: params.input.canSubmitExpenses,
            notes: params.input.notes === undefined ? undefined : params.input.notes,
        }, actor.uid);
        if (shouldSyncProfileLink) {
            await syncProfileLink({
                dataAccess,
                actorUid: actor.uid,
                previousLinkedUserId: existingEmployee.linkedUserId,
                nextLinkedUserId,
                profileId: params.input.employeeId,
                profileType: 'employee',
            });
        }
        return { employeeId: params.input.employeeId };
    });
}
export function parseCreateEmployeeInput(payload) {
    const data = assertIsRecord(payload);
    ensureNoSalaryFields(data);
    return {
        firstName: parseRequiredString(data, 'firstName'),
        lastName: parseRequiredString(data, 'lastName'),
        position: parseRequiredString(data, 'position'),
        contractType: parseRequiredString(data, 'contractType'),
        startDate: parseRequiredIsoDate(data, 'startDate'),
        canSubmitExpenses: parseOptionalBoolean(data, 'canSubmitExpenses') ?? false,
        employeeCode: parseOptionalString(data, 'employeeCode'),
        dni: parseOptionalString(data, 'dni'),
        linkedUserId: parseOptionalNullableString(data, 'linkedUserId'),
        endDate: parseOptionalNullableIsoDate(data, 'endDate') ?? undefined,
        notes: parseOptionalString(data, 'notes'),
    };
}
export function parseUpdateEmployeeInput(payload) {
    const data = assertIsRecord(payload);
    ensureNoSalaryFields(data);
    return {
        employeeId: parseRequiredString(data, 'employeeId'),
        firstName: parseOptionalString(data, 'firstName'),
        lastName: parseOptionalString(data, 'lastName'),
        position: parseOptionalString(data, 'position'),
        contractType: parseOptionalString(data, 'contractType'),
        startDate: parseOptionalNullableIsoDate(data, 'startDate') ?? undefined,
        endDate: parseOptionalNullableIsoDate(data, 'endDate'),
        canSubmitExpenses: parseOptionalBoolean(data, 'canSubmitExpenses'),
        employeeCode: parseOptionalNullableString(data, 'employeeCode'),
        dni: parseOptionalNullableString(data, 'dni'),
        linkedUserId: parseOptionalNullableString(data, 'linkedUserId'),
        status: parseOptionalString(data, 'status'),
        notes: parseOptionalNullableString(data, 'notes'),
    };
}
//# sourceMappingURL=employee.use-cases.js.map