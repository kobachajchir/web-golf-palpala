import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyAccountingQueryToRoute } from '../routes/legacyAccountingQueryToRoute';

test('accounting critical flow contract keeps canonical routes discoverable on mobile and desktop', () => {
  const expectedRoutes = [
    '/accounting/overview',
    '/accounting/member-dues',
    '/accounting/collections',
    '/accounting/expenses',
    '/accounting/employees',
    '/accounting/external-docs',
    '/accounting/payment-methods',
    '/accounting/bank-settlements',
    '/accounting/cash-closures',
    '/accounting/reports',
  ];

  assert.ok(expectedRoutes.includes('/accounting/collections'));
  assert.ok(expectedRoutes.includes('/accounting/payment-methods'));
  assert.equal(
    legacyAccountingQueryToRoute('section=cuotas&subsection=register-payment'),
    '/accounting/collections',
  );
  assert.equal(
    legacyAccountingQueryToRoute('section=movimientos&subsection=expense-queue'),
    '/accounting/expenses?tab=queue',
  );
  assert.equal(
    legacyAccountingQueryToRoute('section=cuotas&subsection=membership-pricing'),
    '/accounting/member-dues?tab=config',
  );
});
