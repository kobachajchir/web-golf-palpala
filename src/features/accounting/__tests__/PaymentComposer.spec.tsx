import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentComposer } from '../components/PaymentComposer';
import { fakeTimestamp } from './testUtils';

test('PaymentComposer renders required manual payment controls', () => {
  const html = renderToStaticMarkup(
    <PaymentComposer
      memberId="mem_123"
      mode="manual"
      openItems={[{
        id: 'fee_2026_06_mem_123',
        kind: 'member_fee_charge',
        memberId: 'mem_123',
        period: '2026-06',
        description: 'Cuota junio',
        amountMinor: 4500000,
        status: 'pending',
      }]}
      paymentMethods={[{
        id: 'cash',
        name: 'Efectivo',
        bancarizado: false,
        active: true,
        sortOrder: 1,
        createdAt: fakeTimestamp(),
        createdBy: 'test',
        updatedAt: fakeTimestamp(),
        updatedBy: 'test',
      }]}
      onSubmitManual={() => undefined}
      onCreateCheckout={() => undefined}
    />,
  );

  assert.match(html, /Composer de pago/);
  assert.match(html, /Cuota junio/);
  assert.match(html, /Fecha de pago/);
});
