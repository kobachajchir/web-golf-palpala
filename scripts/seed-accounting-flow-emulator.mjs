import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.GCLOUD_PROJECT !== 'demo-web-golf-palpala') throw new Error('Este fixture sólo puede ejecutarse en el emulador demo local.');
initializeApp({ projectId: 'demo-web-golf-palpala' });
const db = getFirestore();
const template = (await db.collection('members').doc('dev-member-999-koba-chajchir').get()).data();
if (!template) throw new Error('Primero cargá el usuario administrativo de prueba.');
const now = Timestamp.now();
const memberId = 'qa-accounting-member';
await db.collection('members').doc(memberId).set({ ...template, memberNumber: '1001', normalizedMemberNumber: '001001', firstName: 'Socio de prueba', lastName: 'Contabilidad', dni: '00001001', membershipBillingExempt: false, membershipStartDate: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')), status: 'active', familyGroupId: null, userId: null, authUid: null });
const batch = db.batch();
for (let offset = 0; offset < 28; offset++) {
  const date = new Date(Date.UTC(2026, 10 - offset, 1));
  const period = date.toISOString().slice(0, 7);
  batch.set(db.collection('member_fee_charges').doc('qa-fee-' + period), { memberId, familyGroupId: null, holderMemberId: null, period, configVersion: 1, memberTypeCodeSnapshot: 'pleno', billingMode: 'per_member', baseAmountMinor: 10050, appliedPctBps: 10000, finalAmountMinor: 10050, status: 'pending', dueDate: now, generatedByUid: 'qa', createdAt: now, createdBy: 'qa', updatedAt: now, updatedBy: 'qa' });
}
await batch.commit();
console.log('Fixture demo listo: socio 1001 con 28 cuotas; no se generaron movimientos.');
