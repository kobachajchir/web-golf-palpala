import assert from 'node:assert/strict';
import test from 'node:test';
import { getNextMemberNumberFromExisting } from '../../src/modules/users/application/use-cases/member-number.use-cases.js';

test('getNextMemberNumberFromExisting devuelve 1 cuando no hay socios numericos', () => {
  const result = getNextMemberNumberFromExisting(['legacy-a', 'ABC']);

  assert.equal(result.nextNumericId, 1);
  assert.equal(result.nextMemberNumber, '1');
  assert.equal(result.normalizedNextMemberNumber, '000001');
  assert.equal(result.numericCount, 0);
});

test('getNextMemberNumberFromExisting usa uno mas que el memberNumber mas alto', () => {
  const result = getNextMemberNumberFromExisting(['1', '7', '99', '12']);

  assert.equal(result.highestNumericId, 99);
  assert.equal(result.nextNumericId, 100);
  assert.equal(result.nextMemberNumber, '100');
  assert.equal(result.normalizedNextMemberNumber, '000100');
});

test('getNextMemberNumberFromExisting conserva ancho si los numeros estan paddeados', () => {
  const result = getNextMemberNumberFromExisting(['000007', '000099']);

  assert.equal(result.nextMemberNumber, '000100');
  assert.equal(result.normalizedNextMemberNumber, '000100');
});

