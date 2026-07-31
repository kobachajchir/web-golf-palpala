import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSyntheticAuthEmail, generateMemberTemporaryPassword, normalizeMemberNumber, } from '../../src/modules/auth/member-number-auth.js';
test('normaliza numero de socio numerico a 6 digitos', () => {
    assert.equal(normalizeMemberNumber(' 123 '), '000123');
    assert.equal(normalizeMemberNumber('1 2 3'), '000123');
});
test('construye email sintetico interno sin exponer dominio real', () => {
    assert.equal(buildSyntheticAuthEmail('123'), 'socio-000123@club-auth.local');
});
test('genera la clave temporal global para primer ingreso', () => {
    const first = generateMemberTemporaryPassword('999', new Date('2026-05-07T12:34:56.000Z'), 'ABC123XYZ9');
    const second = generateMemberTemporaryPassword('999', new Date('2026-05-07T12:34:56.000Z'), 'ZZZ987QQQ1');
    const otherMember = generateMemberTemporaryPassword('998', new Date('2026-05-07T12:34:56.000Z'), 'ABC123XYZ9');
    assert.equal(first.temporaryPassword, 'password');
    assert.equal(first.passwordGeneratedAt, '2026-05-07T12:34:56.000Z');
    assert.equal(second.temporaryPassword, 'password');
    assert.equal(otherMember.temporaryPassword, 'password');
});
//# sourceMappingURL=auth.member-number.test.js.map