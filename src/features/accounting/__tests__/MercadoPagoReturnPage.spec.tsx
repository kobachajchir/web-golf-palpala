import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MercadoPagoReturn } from '../../../pages/MercadoPagoReturn';

test('MercadoPagoReturn keeps the return page informational', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/payments/mercado-pago/return/pending?sessionId=mps_1001']}>
      <Routes>
        <Route path="/payments/mercado-pago/return/:result" element={<MercadoPagoReturn />} />
      </Routes>
    </MemoryRouter>,
  );

  assert.match(html, /pantalla de retorno es informativa/);
  assert.match(html, /Ir a contabilidad/);
});
