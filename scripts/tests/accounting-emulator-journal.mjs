import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.GCLOUD_PROJECT !== 'demo-web-golf-palpala') throw new Error('Sólo se admite el emulador demo local.');
initializeApp({projectId:'demo-web-golf-palpala'});
const db=getFirestore();
const login=await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'socio-000999@club-auth.local',password:process.env.ACCOUNTING_TEST_PASSWORD,returnSecureToken:true})})).json();
assert.ok(login.idToken);
async function call(name,data){const response=await fetch(`http://127.0.0.1:5001/demo-web-golf-palpala/us-central1/${name}`,{method:'POST',headers:{Authorization:'Bearer '+login.idToken,'Content-Type':'application/json'},body:JSON.stringify({data})});const body=await response.json();if(body.error)throw Error(body.error.message);return body.result;}
const day=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const today=day(new Date());
const movements=(await db.collection('financial_movements').get()).docs.map(doc=>({id:doc.id,...doc.data()}));
const effective=movement=>movement.installmentRole!=='charge'&&(movement.status==='posted'||movement.status==='reversed'&&movement.reversalOfMovementId);
const closures=await db.collection('cash_closures').where('status','==','open').get();
let closed=0;
for(const document of closures.docs){const closure=document.data();const closureDay=day(closure.closureDate.toDate());if(closureDay>=today)continue;const rows=movements.filter(movement=>effective(movement)&&day(movement.operationDate.toDate())===closureDay);const cash=rows.filter(movement=>movement.paymentMethodCodeSnapshot==='cash').reduce((sum,movement)=>sum+(movement.movementType==='income'?movement.netAmountMinor:-movement.netAmountMinor),closure.openingBalanceMinor??0);const result=await call('accountingCloseCashClosure',{cashClosureId:document.id,cashCountedMinor:cash});assert.equal(result.differenceMinor,0);assert.equal((await document.ref.get()).data().movementIds.length,rows.length);closed++;}
if(!closures.docs.some(doc=>day(doc.data().closureDate.toDate())===today))await call('accountingCreateCashClosure',{period:today.slice(0,7),closureDate:today+'T09:00:00-03:00',openingBalanceMinor:0});
const batch=db.batch();
for(let index=0;index<225;index++)batch.set(db.collection('financial_movements').doc('qa-page-'+index),{movementType:'income',categoryId:'cuota_societaria',categoryCodeSnapshot:'cuota_societaria',status:'posted',operationDate:Timestamp.now(),accountingPeriod:today.slice(0,7),originType:'manual_income',paymentMethodId:'cash',paymentMethodCodeSnapshot:'cash',netAmountMinor:1,grossAmountMinor:1,bancarizado:false,imputableImpositivo:false,registeredByUid:login.localId,createdAt:Timestamp.now(),updatedAt:Timestamp.now(),createdBy:'qa',updatedBy:'qa'});
await batch.commit();
const all=(await db.collection('financial_movements').where('accountingPeriod','==',today.slice(0,7)).get()).docs.map(doc=>doc.data()).filter(movement=>effective(movement)&&!movement.excludeFromBalance&&movement.originType!=='internal_transfer');
const expectedIncome=all.filter(movement=>movement.movementType==='income').reduce((sum,movement)=>sum+movement.netAmountMinor,0);
const expectedExpense=all.filter(movement=>movement.movementType==='expense').reduce((sum,movement)=>sum+movement.netAmountMinor,0);
const payload={requestId:'qa-pages-'+Date.now(),title:'Prueba aislada: más de 100 movimientos',template:'categories',scope:'period',period:today.slice(0,7),movementTypes:['income','expense'],categoryIds:[],includePaidDues:false,includeUnpaidPeriod:false,includeUnpaidAccumulated:false};
const result=await call('accountingGenerateReport',payload);const report=(await db.collection('accounting_reports').doc(result.reportId).get()).data();assert.equal(report.summary.incomeTotalMinor,expectedIncome);assert.equal(report.summary.expenseTotalMinor,expectedExpense);assert.equal(report.summary.netTotalMinor,expectedIncome-expectedExpense);assert.ok(report.summary.movementCount>225);
console.log(JSON.stringify({ok:true,closedJournals:closed,reportedMovements:report.summary.movementCount,reportId:result.reportId},null,2));
