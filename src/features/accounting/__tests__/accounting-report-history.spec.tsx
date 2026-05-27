import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AccountingReportsPage } from '../pages/AccountingReportsPage';
import { renderWithAuth } from './testUtils';

test('AccountingReportsPage communicates persistent institutional history', () => {
  const html = renderToStaticMarkup(
    renderWithAuth(
      <MemoryRouter initialEntries={['/accounting/reports']}>
        <AccountingReportsPage />
      </MemoryRouter>,
    ),
  );

  assert.match(html, /Historial institucional/);
  assert.match(html, /Firestore/);
});
