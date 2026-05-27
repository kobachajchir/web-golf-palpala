import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { DangerActionDialog } from '../components/DangerActionDialog';

test('DangerActionDialog requires an auditable reason before confirming', () => {
  const html = renderToStaticMarkup(
    <DangerActionDialog
      open
      title="Anular movimiento"
      description="La anulacion genera reverso."
      reason="corto"
      onReasonChange={() => undefined}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );

  assert.match(html, /Motivo obligatorio/);
  assert.match(html, /El motivo debe tener al menos 10 caracteres/);
  assert.match(html, /disabled/);
});
