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
test('genera clave temporal con hash dependiente de socio y fecha', () => {
    const first = generateMemberTemporaryPassword('999', new Date('2026-05-07T12:34:56.000Z'));
    const second = generateMemberTemporaryPassword('999', new Date('2026-05-07T12:35:56.000Z'));
    const otherMember = generateMemberTemporaryPassword('998', new Date('2026-05-07T12:34:56.000Z'));
    assert.match(first.temporaryPassword, /^CGP-000999-[A-Z0-9]{10}$/);
    assert.equal(first.passwordGeneratedAt, '2026-05-07T12:34:56.000Z');
    assert.notEqual(first.temporaryPassword, second.temporaryPassword);
    assert.notEqual(first.temporaryPassword, otherMember.temporaryPassword);
});
//# sourceMappingURL=auth.member-number.test.js.map