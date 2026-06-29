import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyAccountingQueryToRoute } from '../routes/legacyAccountingQueryToRoute';

test('quick action legacy routes redirect to canonical accounting tasks', () => {
  assert.equal(
    legacyAccountingQueryToRoute('section=cuotas&subsection=register-payment&memberId=mem_1'),
    '/accounting/caja?memberId=mem_1&tab=cobros',
  );
  assert.equal(
    legacyAccountingQueryToRoute('section=cuotas&subsection=generate-fee&period=2026-06'),
    '/accounting/member-dues?period=2026-06',
  );
  assert.equal(
    legacyAccountingQueryToRoute('section=movimientos&subsection=expense-form'),
    '/accounting/caja?tab=egresos',
  );
  assert.equal(
    legacyAccountingQueryToRoute('section=movimientos&subsection=expense-queue'),
    '/accounting/caja?tab=rendiciones',
  );
  assert.equal(
    legacyAccountingQueryToRoute('section=movimientos&subsection=mercado-pago'),
    '/accounting/caja?tab=cobros&mode=mercadopago',
  );
  assert.equal(
    legacyAccountingQueryToRoute('section=movimientos&subsection=payment-methods'),
    '/accounting/payment-methods',
  );
});

test('unknown legacy accounting query falls back to overview preserving useful params', () => {
  assert.equal(
    legacyAccountingQueryToRoute('section=desconocida&memberId=mem_2&foo=bar'),
    '/accounting/overview?memberId=mem_2',
  );
});
