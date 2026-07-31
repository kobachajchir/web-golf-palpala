import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMemberFeeEarlyPaymentPreview } from '../utils/memberFeeDiscounts.js';

const config = {
  earlyPaymentDiscountPctBps: 1_000,
  earlyPaymentDiscountDayOfMonth: 10,
};

test('pronto pago automatico solo descuenta la cuota del mes del pago', () => {
  const current = calculateMemberFeeEarlyPaymentPreview({
    amountMinor: 11_000_000,
    period: '2026-06',
    paymentDate: '2026-06-05',
    config,
  });
  const overdue = calculateMemberFeeEarlyPaymentPreview({
    amountMinor: 11_000_000,
    period: '2026-05',
    paymentDate: '2026-06-05',
    config,
  });

  assert.equal(current.payableAmountMinor, 9_900_000);
  assert.equal(overdue.payableAmountMinor, 11_000_000);
  assert.equal(overdue.discountAmountMinor, 0);
});

test('el descuento manual conserva la cuota atrasada sin descuento', () => {
  const current = calculateMemberFeeEarlyPaymentPreview({
    amountMinor: 11_000_000,
    period: '2026-06',
    paymentDate: '2026-06-20',
    config,
    forceDiscount: true,
  });
  const overdue = calculateMemberFeeEarlyPaymentPreview({
    amountMinor: 11_000_000,
    period: '2026-05',
    paymentDate: '2026-06-20',
    config,
    forceDiscount: true,
  });

  assert.equal(current.payableAmountMinor, 9_900_000);
  assert.equal(overdue.payableAmountMinor, 11_000_000);
  assert.equal(overdue.discountPctBps, 0);
});
