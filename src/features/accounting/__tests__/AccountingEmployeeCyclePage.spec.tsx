import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AccountingEmployeeCyclePage } from '../pages/AccountingEmployeeCyclePage';
import { renderWithAuth } from './testUtils';

test('AccountingEmployeeCyclePage routes employee period into the monthly cycle flow', () => {
  const html = renderToStaticMarkup(
    renderWithAuth(
      <MemoryRouter initialEntries={['/accounting/employees/emp_778?period=2026-05&section=settlement']}>
        <Routes>
          <Route path="/accounting/employees/:employeeId" element={<AccountingEmployeeCyclePage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );

  assert.match(html, /Cargando ciclo mensual/);
});
