import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_EXPENSE_CATEGORY_IDS } from '../../domain/constants.js';
import { assertCondition } from '../../domain/errors.js';
import { assertIsRecord, ensureEmployeeOrStaff, ensureStaff, hasExecutiveAccess, parseOptionalFiniteNumber, parseOptionalNullableString, parseRequiredAmountMinor, parseRequiredIsoDate, parseRequiredString, } from '../shared.js';
import { createPostedMovement } from '../movement-helpers.js';
export async function submitExpenseUseCase(params) {
    const actor = ensureEmployeeOrStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const employee = await dataAccess.employees.getById(params.input.employeeId);
        assertCondition(employee, 'not-found', `No existe employees/${params.input.employeeId}.`);
        const category = await dataAccess.financialExpenseCategories.getById(params.input.categoryId);
        assertCondition(category, 'not-found', `No existe financial_expense_categories/${params.input.categoryId}.`);
        assertCondition(category.active, 'failed-precondition', `La categoría ${params.input.categoryId} está inactiva.`);
        const isStaff = hasExecutiveAccess(actor) || actor.claims.administrativo === true;
        if (!isStaff) {
            assertCondition(actor.user.profileType === 'employee', 'permission-denied', 'El usuario autenticado no está vinculado a un empleado.');
            assertCondition(actor.user.profileId === params.input.employeeId, 'permission-denied', 'Solo podés cargar tus propias rendiciones.');
            assertCondition(employee.canSubmitExpenses, 'permission-denied', 'El empleado no tiene habilitada la carga de rendiciones.');
        }
        if (category.id === FINANCIAL_EXPENSE_CATEGORY_IDS.combustible) {
            if (params.input.liters !== undefined && params.input.liters !== null) {
                assertCondition(params.input.liters >= 0, 'invalid-argument', 'liters no puede ser negativo.');
            }
        }
        else {
            assertCondition(params.input.liters === undefined || params.input.liters === null, 'invalid-argument', 'Solo combustible admite liters.');
        }
        const expenseSubmissionId = await dataAccess.expenseSubmissions.create({
            employeeId: employee.id,
            categoryId: category.id,
            categoryCodeSnapshot: category.id,
            description: params.input.description,
            expenseDate: Timestamp.fromDate(params.input.expenseDate),
            amountMinor: params.input.amountMinor,
            liters: params.input.liters ?? null,
            vendorName: params.input.vendorName ?? null,
            receiptFileUrl: params.input.receiptFileUrl ?? null,
            status: 'submitted',
            reviewedByUid: null,
            reviewedAt: null,
            rejectionReason: null,
            linkedMovementId: null,
            paymentMethodId: params.input.paymentMethodId ?? null,
        }, actor.uid);
        return { expenseSubmissionId };
    });
}
export async function reviewExpenseUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const expenseSubmission = await dataAccess.expenseSubmissions.getById(params.input.expenseSubmissionId);
        assertCondition(expenseSubmission, 'not-found', `No existe expense_submissions/${params.input.expenseSubmissionId}.`);
        assertCondition(expenseSubmission.status === 'submitted' || expenseSubmission.status === 'approved', 'failed-precondition', 'La rendición ya no admite revisión.');
        if (params.input.decision === 'rejected') {
            assertCondition(params.input.rejectionReason, 'invalid-argument', 'rejectionReason es obligatorio para rechazar.');
        }
        await dataAccess.expenseSubmissions.update(expenseSubmission.id, {
            status: params.input.decision,
            reviewedByUid: actor.uid,
            reviewedAt: Timestamp.fromDate(new Date()),
            rejectionReason: params.input.decision === 'rejected' ? params.input.rejectionReason ?? null : null,
        }, actor.uid);
        return {
            expenseSubmissionId: expenseSubmission.id,
            status: params.input.decision,
        };
    });
}
export async function postExpenseMovementUseCase(params) {
    const actor = ensureStaff(params.actor);
    return params.transactions.runInTransaction(async (dataAccess) => {
        const expenseSubmission = await dataAccess.expenseSubmissions.getById(params.input.expenseSubmissionId);
        assertCondition(expenseSubmission, 'not-found', `No existe expense_submissions/${params.input.expenseSubmissionId}.`);
        if (expenseSubmission.status === 'posted' && expenseSubmission.linkedMovementId) {
            return { movementId: expenseSubmission.linkedMovementId, duplicate: true };
        }
        const activeConfig = await dataAccess.financialConfigs.getActive();
        assertCondition(activeConfig, 'failed-precondition', 'No existe una configuración financiera activa.');
        assertCondition(!activeConfig.requireApprovalForExpensePosting || expenseSubmission.status === 'approved', 'failed-precondition', 'Solo se puede postear una rendición aprobada.');
        const category = await dataAccess.financialExpenseCategories.getById(expenseSubmission.categoryId);
        assertCondition(category, 'not-found', `No existe financial_expense_categories/${expenseSubmission.categoryId}.`);
        assertCondition(category.active, 'failed-precondition', `La categoría ${expenseSubmission.categoryId} está inactiva.`);
        const paymentMethod = expenseSubmission.paymentMethodId
            ? await dataAccess.paymentMethods.getById(expenseSubmission.paymentMethodId)
            : null;
        if (expenseSubmission.paymentMethodId) {
            assertCondition(paymentMethod, 'not-found', `No existe payment_methods/${expenseSubmission.paymentMethodId}.`);
        }
        const bancarizado = category.id === FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra
            ? false
            : paymentMethod?.bancarizado ?? category.defaultBancarizado;
        const imputableImpositivo = category.id === FINANCIAL_EXPENSE_CATEGORY_IDS.horasExtra
            ? false
            : category.defaultImputableImpositivo;
        const movement = await createPostedMovement({
            dataAccess,
            actorUid: actor.uid,
            movementType: 'expense',
            categoryId: category.id,
            categoryCodeSnapshot: category.id,
            grossAmountMinor: expenseSubmission.amountMinor,
            operationDate: expenseSubmission.expenseDate.toDate(),
            originType: 'expense_submission',
            originCollection: 'expense_submissions',
            originId: expenseSubmission.id,
            thirdPartyType: 'employee',
            thirdPartyId: expenseSubmission.employeeId,
            paymentMethodId: paymentMethod?.id ?? null,
            bancarizado,
            imputableImpositivo,
            ...(expenseSubmission.liters ? { metadata: { liters: expenseSubmission.liters } } : {}),
            notes: params.input.notes ?? null,
            applyPaymentCommission: false,
        });
        await dataAccess.expenseSubmissions.update(expenseSubmission.id, {
            status: 'posted',
            linkedMovementId: movement.movementId,
        }, actor.uid);
        return { movementId: movement.movementId, duplicate: false };
    });
}
export function parseSubmitExpenseInput(payload) {
    const data = assertIsRecord(payload);
    return {
        employeeId: parseRequiredString(data, 'employeeId'),
        categoryId: parseRequiredString(data, 'categoryId'),
        description: parseRequiredString(data, 'description'),
        expenseDate: parseRequiredIsoDate(data, 'expenseDate'),
        amountMinor: parseRequiredAmountMinor(data, 'amountMinor'),
        liters: parseOptionalFiniteNumber(data, 'liters') ?? null,
        vendorName: parseOptionalNullableString(data, 'vendorName'),
        receiptFileUrl: parseOptionalNullableString(data, 'receiptFileUrl'),
        paymentMethodId: parseOptionalNullableString(data, 'paymentMethodId'),
    };
}
export function parseReviewExpenseInput(payload) {
    const data = assertIsRecord(payload);
    return {
        expenseSubmissionId: parseRequiredString(data, 'expenseSubmissionId'),
        decision: parseRequiredString(data, 'decision'),
        rejectionReason: parseOptionalNullableString(data, 'rejectionReason'),
    };
}
export function parsePostExpenseMovementInput(payload) {
    const data = assertIsRecord(payload);
    return {
        expenseSubmissionId: parseRequiredString(data, 'expenseSubmissionId'),
        notes: parseOptionalNullableString(data, 'notes'),
    };
}
//# sourceMappingURL=expense.use-cases.js.map