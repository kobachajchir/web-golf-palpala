import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AccountingCollectionsPage } from '../pages/AccountingCollectionsPage';

test('AccountingCollectionsPage exposes the guided collection workspace', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/accounting/caja?tab=cobros&memberId=mem_123']}>
      <AccountingCollectionsPage />
    </MemoryRouter>,
  );

  assert.match(html, /Workspace de caja societaria/);
  assert.match(html, /Buscar y seleccionar/);
  assert.match(html, /Cobro por categoria de ingreso/);
});
