import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../../node_modules/typescript/lib/typescript.js';
async function load(path) {
 const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
 const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
 return import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
}
const amounts = await load('../../src/features/accounting/utils/accountingFormatters.ts');
const errors = await load('../../src/features/accounting/utils/accountingErrors.ts');
test('importes equivalentes conservan centavos', () => {
 for (const input of ['100.50', '100,50']) assert.equal(amounts.parseAmountInputToMinor(input), 10050);
 assert.equal(amounts.parseAmountInputToMinor('1.500,50'), 150050);
 assert.equal(amounts.parseNumberInputToMinor('100.50'), 10050);
 assert.ok(Number.isNaN(amounts.parseAmountInputToMinor('')));
});
test('el comprobante no oculta centavos', () => { assert.match(amounts.formatCurrency(10050), /100,50/); });
test('los errores tecnicos no se muestran al cliente', () => {
 assert.ok(!errors.accountingErrorMessage({ message: 'FirebaseError INTERNAL' }).includes('INTERNAL'));
 assert.match(errors.accountingErrorMessage({ code: 'functions/permission-denied' }), /permiso/);
 assert.match(errors.accountingErrorMessage({ code: 'functions/deadline-exceeded' }), /confirmar/);
});


test('importes ambiguos o con fracciones de centavo se rechazan', () => {
 for (const value of ['12.34.56', '1,500.50', '100,505', '1.2345', '1e3']) assert.ok(Number.isNaN(amounts.parseAmountInputToMinor(value)), value);
 assert.ok(Number.isNaN(amounts.parseNumberInputToMinor('100.505')));
});

test('la operacion conserva contenido y clave tras recarga, y bloquea cambios hasta resolver', async () => {
 const storage = new Map();
 globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
 const pending = await load('../../src/features/accounting/utils/pendingOperationKeys.ts');
 const first = pending.getOrCreateOperationKey('socio-1', { amount: 10050 });
 assert.equal(pending.getOrCreateOperationKey('socio-1', { amount: 10050 }), first);
 assert.deepEqual(pending.getPendingOperationPayload('socio-1'), { amount: 10050 });
 assert.throws(() => pending.getOrCreateOperationKey('socio-1', { amount: 15000 }), /anterior pendiente/);
 pending.releaseOperationKey('socio-1', 'late-key');
 assert.equal(pending.peekOperationKey('socio-1'), first);
 pending.releaseOperationKey('socio-1', first);
 assert.equal(pending.peekOperationKey('socio-1'), null);
 assert.equal(pending.getPendingOperationPayload('socio-1'), null);
});
