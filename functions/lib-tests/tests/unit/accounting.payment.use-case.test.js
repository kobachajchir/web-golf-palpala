import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { FINANCIAL_EXPENSE_CATEGORY_IDS, FINANCIAL_INCOME_CATEGORY_IDS, PAYMENT_METHOD_IDS, } from '../../src/modules/accounting/domain/constants.js';
import { editInternalTransferUseCase, registerPaymentUseCase, transferFundsUseCase, } from '../../src/modules/accounting/application/use-cases/payment.use-cases.js';
import { setCreditCommissionRuleUseCase } from '../../src/modules/accounting/application/use-cases/config.use-cases.js';
import { registerMemberFeeBatchPaymentUseCase } from '../../src/modules/accounting/application/use-cases/member-fee-payment.use-cases.js';
import { InMemoryAccountingTransactionManager, createAccountingActor, seedActiveFinancialConfig, seedAccountingMember, seedCommissionRule, seedIncomeCategory, seedPaymentMethod, } from '../helpers/accounting-fakes.js';
function createAdminActor() {
    return createAccountingActor('admin-1', ['administrativo'], { administrativo: true });
}
function createDirectivoActor() {
    return createAccountingActor('board-1', ['directivo'], { directivo: true });
}
function setupPaymentFixture() {
    const manager = new InMemoryAccountingTransactionManager();
    seedActiveFinancialConfig(manager);
    seedAccountingMember(manager, 'member-1');
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.creditGalicia, { bancarizado: true });
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.cash, { bancarizado: false });
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.transferGalicia, { bancarizado: true });
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.debitGalicia, { bancarizado: true });
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.debitMacro, { bancarizado: true, specialReportingType: 'macro_debit' });
    seedCommissionRule(manager, 'credit-rule-1', { paymentMethodId: PAYMENT_METHOD_IDS.creditGalicia, percentageBps: 300 });
    seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.greenFee);
    seedIncomeCategory(manager, FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria, { originType: 'member_fee_charge' });
    return manager;
}
function createEmployeeActor() {
    return createAccountingActor('employee-1', ['empleado'], { empleado: true });
}
function timestamp(value) {
    return Timestamp.fromDate(new Date(value));
}
function seedPendingMemberFeeCharge(manager, memberFeeChargeId = 'fee-charge-1') {
    const now = timestamp('2026-05-01T00:00:00.000Z');
    manager.memberFeeCharges.set(memberFeeChargeId, {
        id: memberFeeChargeId,
        memberId: 'member-1',
        familyGroupId: null,
        holderMemberId: null,
        period: '2026-05',
        configVersion: 1,
        memberTypeCodeSnapshot: 'pleno',
        billingMode: 'per_member',
        baseAmountMinor: 11_000_000,
        appliedPctBps: 10_000,
        finalAmountMinor: 11_000_000,
        status: 'pending',
        dueDate: timestamp('2026-05-10T00:00:00.000Z'),
        generatedByUid: 'admin-1',
        createdAt: now,
        createdBy: 'admin-1',
        updatedAt: now,
        updatedBy: 'admin-1',
    });
}
test('credit_galicia agrega la comision al precio a cobrar y conserva el importe del club', async () => {
    const manager = setupPaymentFixture();
    const result = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.creditGalicia,
            paymentReference: 'TC-001',
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    });
    const movement = manager.financialMovements.get(result.movementId);
    assert.ok(movement);
    assert.equal(movement?.appliedCommissionPctBps, 300);
    assert.equal(movement?.appliedCommissionAmountMinor, 3_000);
    assert.equal(movement?.grossAmountMinor, 103_000);
    assert.equal(movement?.netAmountMinor, 100_000);
    assert.equal(result.grossAmountMinor, 103_000);
});
test('cambio de comisión futura no altera histórico', async () => {
    const manager = setupPaymentFixture();
    const firstPayment = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.creditGalicia,
            paymentReference: 'TC-002',
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    });
    await setCreditCommissionRuleUseCase({
        actor: createDirectivoActor(),
        input: {
            percentageBps: 500,
            validFrom: new Date('2026-05-01T00:00:00.000Z'),
        },
        transactions: manager,
    });
    const firstMovement = manager.financialMovements.get(firstPayment.movementId);
    assert.ok(firstMovement);
    assert.equal(firstMovement?.appliedCommissionPctBps, 300);
});
test('administracion puede cambiar la regla de comision de credito', async () => {
    const manager = setupPaymentFixture();
    const result = await setCreditCommissionRuleUseCase({
        actor: createAdminActor(),
        input: {
            percentageBps: 650,
            validFrom: new Date('2026-06-01T00:00:00.000Z'),
            notes: 'Actualizacion administrativa',
        },
        transactions: manager,
    });
    const newRule = manager.paymentCommissionRules.get(result.ruleId);
    const previousRule = manager.paymentCommissionRules.get('credit-rule-1');
    assert.equal(result.percentageBps, 650);
    assert.equal(newRule?.paymentMethodId, PAYMENT_METHOD_IDS.creditGalicia);
    assert.equal(newRule?.setByUid, 'admin-1');
    assert.equal(previousRule?.isActive, false);
});
test('cash = bancarizado false', async () => {
    const manager = setupPaymentFixture();
    const result = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    });
    assert.equal(manager.financialMovements.get(result.movementId)?.bancarizado, false);
});
test('transfer_galicia = bancarizado true', async () => {
    const manager = setupPaymentFixture();
    const result = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.transferGalicia,
            paymentReference: 'TR-001',
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    });
    assert.equal(manager.financialMovements.get(result.movementId)?.bancarizado, true);
});
test('debit_galicia = bancarizado true sin reporte Macro', async () => {
    const manager = setupPaymentFixture();
    const result = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.debitGalicia,
            paymentReference: 'DEB-001',
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    });
    const movement = manager.financialMovements.get(result.movementId);
    assert.equal(movement?.bancarizado, true);
    assert.equal(movement?.metadata?.specialReportingType, null);
});
test('debit_macro = bancarizado true + special reporting', async () => {
    const manager = setupPaymentFixture();
    const result = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'manual_income',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
            paymentMethodId: PAYMENT_METHOD_IDS.debitMacro,
            paymentReference: 'MACRO-001',
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    });
    const movement = manager.financialMovements.get(result.movementId);
    assert.equal(movement?.bancarizado, true);
    assert.equal(movement?.metadata?.specialReportingType, 'macro_debit');
});
test('debit_macro solo esta permitido para cuota societaria', async () => {
    const manager = setupPaymentFixture();
    await assert.rejects(() => registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.debitMacro,
            paymentReference: 'MACRO-002',
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    }), /solo esta disponible para cuotas societarias/i);
});
test('medios no efectivo requieren referencia de pago', async () => {
    const manager = setupPaymentFixture();
    await assert.rejects(() => registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.transferGalicia,
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    }), /referencia de pago/i);
});
test('transfer legacy no esta disponible para nuevos cobros', async () => {
    const manager = setupPaymentFixture();
    seedPaymentMethod(manager, PAYMENT_METHOD_IDS.transfer, { bancarizado: true });
    await assert.rejects(() => registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.transfer,
            paymentReference: 'TR-LEGACY',
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    }), /ya no esta disponible para nuevos cobros/i);
});
test('ingreso manual permite medios no efectivo sin referencia', async () => {
    const manager = setupPaymentFixture();
    const result = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'manual_income',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.transferGalicia,
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    });
    assert.ok(manager.financialMovements.get(result.movementId));
});
test('ingreso manual exige categoria de ingreso valida', async () => {
    const manager = setupPaymentFixture();
    await assert.rejects(() => registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'manual_income',
            categoryId: 'proveedores',
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    }), /financial_income_categories\/proveedores/i);
});
test('transferencia interna crea un egreso y un ingreso aun sin catalogos sembrados', async () => {
    const manager = setupPaymentFixture();
    const result = await transferFundsUseCase({
        actor: createAdminActor(),
        input: {
            sourcePaymentMethodId: PAYMENT_METHOD_IDS.cash,
            destinationPaymentMethodId: PAYMENT_METHOD_IDS.transferGalicia,
            amountMinor: 240_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
            reference: 'TRF-TEST-001',
        },
        transactions: manager,
    });
    const outgoing = manager.financialMovements.get(result.outgoingMovementId);
    const incoming = manager.financialMovements.get(result.incomingMovementId);
    assert.equal(outgoing?.movementType, 'expense');
    assert.equal(outgoing?.categoryId, FINANCIAL_EXPENSE_CATEGORY_IDS.internalTransfer);
    assert.equal(outgoing?.paymentMethodId, PAYMENT_METHOD_IDS.cash);
    assert.equal(incoming?.movementType, 'income');
    assert.equal(incoming?.categoryId, FINANCIAL_INCOME_CATEGORY_IDS.internalTransfer);
    assert.equal(incoming?.paymentMethodId, PAYMENT_METHOD_IDS.transferGalicia);
    assert.equal(result.reference, 'TRF-TEST-001');
});
test('edicion de transferencia historica actualiza las dos cuentas y conserva el par', async () => {
    const manager = setupPaymentFixture();
    const created = await transferFundsUseCase({
        actor: createAdminActor(),
        input: {
            sourcePaymentMethodId: PAYMENT_METHOD_IDS.cash,
            destinationPaymentMethodId: PAYMENT_METHOD_IDS.transferGalicia,
            amountMinor: 240_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
            reference: 'TRF-HIST-001',
        },
        transactions: manager,
    });
    const result = await editInternalTransferUseCase({
        actor: createAdminActor(),
        input: {
            movementId: created.outgoingMovementId,
            sourcePaymentMethodId: PAYMENT_METHOD_IDS.transferGalicia,
            destinationPaymentMethodId: PAYMENT_METHOD_IDS.cash,
            reference: 'TRF-HIST-CORREGIDA',
            notes: 'Cuentas verificadas contra el historial.',
            reason: 'Correccion de cuentas historicas',
        },
        transactions: manager,
    });
    const outgoing = manager.financialMovements.get(result.outgoingMovementId);
    const incoming = manager.financialMovements.get(result.incomingMovementId);
    assert.equal(outgoing?.paymentMethodId, PAYMENT_METHOD_IDS.transferGalicia);
    assert.equal(outgoing?.bancarizado, true);
    assert.equal(incoming?.paymentMethodId, PAYMENT_METHOD_IDS.cash);
    assert.equal(incoming?.bancarizado, false);
    assert.equal(outgoing?.originId, incoming?.id);
    assert.equal(incoming?.originId, outgoing?.id);
    assert.equal(outgoing?.netAmountMinor, 240_000);
    assert.equal(incoming?.netAmountMinor, 240_000);
    assert.equal(outgoing?.metadata?.transferReference, 'TRF-HIST-CORREGIDA');
    assert.equal(incoming?.metadata?.sourcePaymentMethodId, PAYMENT_METHOD_IDS.transferGalicia);
    assert.equal(incoming?.metadata?.destinationPaymentMethodId, PAYMENT_METHOD_IDS.cash);
    assert.equal(Array.isArray(outgoing?.metadata?.transferEditHistory), true);
});
test('referencia de pago queda en metadata del movimiento', async () => {
    const manager = setupPaymentFixture();
    const result = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.transferGalicia,
            paymentReference: 'TRX-123',
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    });
    const movement = manager.financialMovements.get(result.movementId);
    assert.equal(movement?.metadata?.paymentReference, 'TRX-123');
    assert.match(String(result.receiptNumber ?? ''), /^REC-20260401-/);
    assert.equal(movement?.metadata?.receiptNumber, result.receiptNumber);
});
test('empleado no puede registrar pagos', async () => {
    const manager = setupPaymentFixture();
    await assert.rejects(() => registerPaymentUseCase({
        actor: createEmployeeActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    }), /permisos|permission|directivo|administrativo/i);
});
test('no permite registrar pagos nuevos para socio dado de baja', async () => {
    const manager = setupPaymentFixture();
    seedAccountingMember(manager, 'member-1', { status: 'inactive' });
    await assert.rejects(() => registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    }), /dados de baja|suspendidos/i);
});
test('no permite cobrar cuota pendiente de socio dado de baja', async () => {
    const manager = setupPaymentFixture();
    seedPendingMemberFeeCharge(manager);
    seedAccountingMember(manager, 'member-1', { status: 'inactive' });
    await assert.rejects(() => registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'member_fee_charge',
            sourceId: 'fee-charge-1',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            grossAmountMinor: 11_000_000,
            operationDate: new Date('2026-05-05T03:00:00.000Z'),
        },
        transactions: manager,
    }), /dados de baja|suspendidos/i);
});
test('pronto pago aplica 10% del dia 1 al 10 y actualiza membresia', async () => {
    const manager = setupPaymentFixture();
    seedPendingMemberFeeCharge(manager);
    const result = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'member_fee_charge',
            sourceId: 'fee-charge-1',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            grossAmountMinor: 11_000_000,
            operationDate: new Date('2026-05-05T03:00:00.000Z'),
        },
        transactions: manager,
    });
    const movement = manager.financialMovements.get(result.movementId);
    const charge = manager.memberFeeCharges.get('fee-charge-1');
    const member = manager.members.get('member-1');
    assert.equal(movement?.grossAmountMinor, 9_900_000);
    assert.equal(movement?.netAmountMinor, 9_900_000);
    assert.equal(charge?.paidAmountMinor, 9_900_000);
    assert.equal(charge?.paymentDiscountPctBps, 1_000);
    assert.equal(charge?.paymentDiscountAmountMinor, 1_100_000);
    assert.equal(member?.membershipRenewalStatus, 'current');
    assert.equal(member?.lastFeePaidAmountMinor, 9_900_000);
});
test('cuota cobrada fuera del periodo no aplica pronto pago pero permite renovar', async () => {
    const manager = setupPaymentFixture();
    seedPendingMemberFeeCharge(manager);
    const result = await registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'member_fee_charge',
            sourceId: 'fee-charge-1',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.cuotaSocietaria,
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            grossAmountMinor: 11_000_000,
            operationDate: new Date('2026-06-05T03:00:00.000Z'),
        },
        transactions: manager,
    });
    const movement = manager.financialMovements.get(result.movementId);
    const charge = manager.memberFeeCharges.get('fee-charge-1');
    const metadata = movement?.metadata;
    const member = manager.members.get('member-1');
    assert.equal(movement?.grossAmountMinor, 11_000_000);
    assert.equal(charge?.paymentDiscountAmountMinor, 0);
    assert.equal(charge?.paymentDiscountPctBps, 0);
    assert.equal(metadata?.isFeePaymentOutsidePeriod, true);
    assert.equal(metadata?.feeChargePeriod, '2026-05');
    assert.equal(metadata?.feePaymentAccountingPeriod, '2026-06');
    assert.equal(member?.membershipRenewalStatus, 'current');
});
test('un cobro agrupa cuotas y admite pago parcial en un solo movimiento', async () => {
    const manager = setupPaymentFixture();
    seedPendingMemberFeeCharge(manager, 'fee-charge-1');
    seedPendingMemberFeeCharge(manager, 'fee-charge-2');
    const secondCharge = manager.memberFeeCharges.get('fee-charge-2');
    assert.ok(secondCharge);
    manager.memberFeeCharges.set('fee-charge-2', { ...secondCharge, period: '2026-06' });
    const result = await registerMemberFeeBatchPaymentUseCase({
        actor: createAdminActor(),
        input: {
            allocations: [
                { chargeId: 'fee-charge-1', amountMinor: 4_000_000, applyEarlyPaymentDiscount: false },
                { chargeId: 'fee-charge-2', applyEarlyPaymentDiscount: false },
            ],
            paymentMethodId: PAYMENT_METHOD_IDS.creditGalicia,
            paymentReference: 'TC-CUOTAS-001',
            operationDate: new Date('2026-07-15T12:00:00.000Z'),
        },
        transactions: manager,
    });
    assert.equal(manager.financialMovements.size, 1);
    assert.deepEqual(result.completedChargeIds, ['fee-charge-2']);
    assert.deepEqual(result.remainingChargeIds, ['fee-charge-1']);
    assert.equal(result.netAmountMinor, 15_000_000);
    assert.equal(result.grossAmountMinor, 15_450_000);
    assert.equal(manager.memberFeeCharges.get('fee-charge-1')?.remainingAmountMinor, 7_000_000);
    assert.equal(manager.memberFeeCharges.get('fee-charge-1')?.status, 'pending');
    assert.equal(manager.memberFeeCharges.get('fee-charge-2')?.status, 'paid');
    assert.equal(manager.financialMovements.get(result.movementId)?.metadata?.paymentAllocations?.length, 2);
});
test('una ficha exenta no admite ningun cobro asociado', async () => {
    const manager = setupPaymentFixture();
    seedAccountingMember(manager, 'member-1', {
        membershipBillingExempt: true,
        membershipBillingExemptReason: 'Usuario tecnico 999',
    });
    await assert.rejects(() => registerPaymentUseCase({
        actor: createAdminActor(),
        input: {
            sourceType: 'green_fee',
            memberId: 'member-1',
            categoryId: FINANCIAL_INCOME_CATEGORY_IDS.greenFee,
            paymentMethodId: PAYMENT_METHOD_IDS.cash,
            grossAmountMinor: 100_000,
            operationDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        transactions: manager,
    }), /exento|no admite cobros/i);
    assert.equal(manager.financialMovements.size, 0);
});
//# sourceMappingURL=accounting.payment.use-case.test.js.map