import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const auth = require('../functions/node_modules/firebase-tools/lib/auth.js');
const execute = process.argv.includes('--execute');
const account = auth.getGlobalDefaultAccount();
const access = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
const headers = { Authorization: `Bearer ${access.access_token}`, 'Content-Type': 'application/json' };
const base = 'https://firestore.googleapis.com/v1/projects/webgolfclub/databases/(default)/documents';
const decode = v => v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : undefined) ?? v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? (v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k,x]) => [k,decode(x)])) : v.arrayValue ? (v.arrayValue.values ?? []).map(decode) : null);
async function request(url, body) {
 const response = await fetch(url, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) });
 const result = await response.json(); if (!response.ok) throw Error(JSON.stringify(result.error)); return result;
}
async function query(collection, field, value) {
 const structuredQuery = { from: [{ collectionId: collection }] };
 if (field) structuredQuery.where = { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } };
 return (await request(`${base}:runQuery`, { structuredQuery })).filter(x => x.document).map(({document:d}) => ({ name:d.name, updateTime:d.updateTime, id:d.name.split('/').at(-1), ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k,v]) => [k,decode(v)])) }));
}
const audit = { executed: execute, actor: account.user.email, timestamp: new Date().toISOString(), enabled: [], manualReview: [] };
const configurations = await query('salary_configurations');
for (const employeeId of ['MX0nLxwErb1pwSC6mNxQ', 'Slk7feSy09D4Vj0QIjei']) {
 const active = configurations.filter(x => x.employeeId === employeeId && x.isActive);
 if (active.length !== 1) throw Error(`Configuracion activa ambigua: ${employeeId}`);
 const config = active[0]; if (config.allowOvertime) continue;
 const record = { employeeId, configurationId: config.id, previous: false, next: true };
 if (execute) {
  const auditId = `overtime-enable-${config.id}`;
  await request(`${base}:commit`, { writes: [
   { update: { name:config.name, fields: { allowOvertime:{booleanValue:true}, updatedBy:{stringValue:account.user.email} } }, updateMask:{fieldPaths:['allowOvertime','updatedBy']}, currentDocument:{updateTime:config.updateTime}, updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}] },
   { update: { name:`projects/webgolfclub/databases/(default)/documents/accounting_recovery_audit/${auditId}`, fields:{ employeeId:{stringValue:employeeId}, configurationId:{stringValue:config.id}, previous:{booleanValue:false}, next:{booleanValue:true}, actor:{stringValue:account.user.email}, reason:{stringValue:'Habilitacion de horas extras solicitada para octubre 2026'} } }, currentDocument:{exists:false}, updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}] }
  ] });
 }
 audit.enabled.push(record);
}
const plans = await query('financial_movements','installmentRole','charge');
const charges = await query('member_fee_charges');
const requestedPlanId = process.argv.find(value => value.startsWith('--plan-id='))?.slice('--plan-id='.length);
for (const plan of plans.filter(x => x.categoryId === 'cuota_societaria' && (!requestedPlanId || requestedPlanId === x.id))) {
 const payments = (await query('financial_movements', 'installmentPlanId', plan.id)).filter(x => x.installmentRole === 'payment' && x.status === 'posted');
 const effectivePaid = payments.reduce((sum, payment) => sum + (payment.netAmountMinor ?? 0), 0);
 const allocations = plan.metadata?.memberFeeRenewalAllocations;
 const mappedIds = allocations?.map(x => x.chargeId).filter(Boolean) ?? [];
 const issues = [];
 if (!mappedIds.length) issues.push('Sin cuotas asociadas explícitamente');
 if (effectivePaid !== plan.installmentPaidAmountMinor) issues.push('El total guardado difiere de los pagos efectivos');
 for (const chargeId of mappedIds) {
  const charge = charges.find(x => x.id === chargeId);
  if (!charge) issues.push('No existe la cuota asociada: ' + chargeId);
  else if (effectivePaid >= (plan.installmentTotalAmountMinor ?? plan.netAmountMinor) && charge.status !== 'paid') issues.push('Plan completo con cuota pendiente: ' + chargeId);
 }
 if (!issues.length) continue;
 audit.manualReview.push({
  planId: plan.id, memberId: plan.thirdPartyId, reason: issues.join('. '),
  capitalAmountMinor: plan.installmentBaseAmountMinor, totalAmountMinor: plan.installmentTotalAmountMinor,
  effectivePaidAmountMinor: effectivePaid,
  payments: payments.map(payment => ({ movementId: payment.id, amountMinor: payment.netAmountMinor, receiptNumber: payment.metadata?.receiptNumber ?? null, operationDate: payment.operationDate })),
  candidateCharges: charges.filter(charge => charge.memberId === plan.thirdPartyId || (charge.billingMode === 'single_group_charge' && charge.holderMemberId === plan.thirdPartyId)).map(charge => ({ chargeId: charge.id, period: charge.period, status: charge.status, amountMinor: charge.settlementAmountMinor ?? charge.finalAmountMinor, remainingAmountMinor: charge.remainingAmountMinor })),
  action: 'Revisar comprobantes en Cuotas > Sincronización > Asociar cuotas a un plan antiguo. No se infiere por fecha ni se aplican reparaciones desde este inventario.',
 });
}
console.log(JSON.stringify(audit,null,2));
