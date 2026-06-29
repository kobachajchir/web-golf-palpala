import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyAccountingQueryToRoute } from '../routes/legacyAccountingQueryToRoute';

test('accounting critical flow contract keeps canonical routes discoverable on mobile and desktop', () => {
  const expectedRoutes = [
    '/accounting/overview',
    '/accounting/member-dues',
    '/accounting/caja',
    '/accounting/employees',
    '/accounting/external-docs',
    '/accounting/payment-methods',
    '/accounting/bank-settlements',
    '/accounting/cash-closures',
    '/accounting/reports',
  ];

  assert.ok(expectedRoutes.includes('/accounting/caja'));
  assert.ok(expectedRoutes.includes('/accounting/payment-methods'));
  assert.equal(
    legacyAccountingQueryToRoute('section=cuotas&subsection=register-payment'),
    '/accounting/caja?tab=cobros',
  );
  assert.equal(
    legacyAccountingQueryToRoute('section=movimientos&subsection=expense-queue'),
    '/accounting/caja?tab=rendiciones',
  );
  assert.equal(
    legacyAccountingQueryToRoute('section=cuotas&subsection=membership-pricing'),
    '/accounting/member-dues?tab=config',
  );
});
