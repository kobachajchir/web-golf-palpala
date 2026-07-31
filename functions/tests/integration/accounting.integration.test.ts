import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { deleteApp, getApp, getApps, initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  accountingCreateHandicapCharge,
  accountingCreateMacroDebitSettlement,
  accountingGenerateCuota,
  accountingGenerateFeePreview,
  accountingPostExpenseMovement,
  accountingPostSalaryPayment,
  accountingReconcileMacroSettlement,
  accountingRecordExternalReference,
  accountingRegisterPayment,
  accountingReviewExpense,
  accountingSetCreditCommissionRule,
  accountingSubmitExpense,
  accountingTransferHandicapToAssociation,
  accountingUpsertFinancialConfig,
  accountingUpsertSalaryConfiguration,
  accountingVoidFinancialMovement,
} from '../../src/index.js';

const projectId = 'demo-web-golf-palpala';
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });

function getAdminApp() {
  return getApps().length > 0 ? getApp() : initializeApp({ projectId });
}

function db() {
  return getFirestore(getAdminApp());
}

async function clearFirestore() {
  const firestore = db();
  const collections = [
    'users',
    'members',
    'employees',
    'financial_configs',
    'payment_methods',
    'payment_commission_rules',
    'financial_income_categories',
    'financial_expense_categories',
    'financial_movements',
    'macro_debit_settlements',
    'expense_submissions',
    'salary_configurations',
    'salary_payments',
    'external_accounting_references',
    'handicap_charges',
    'member_fee_charges',
  ];

  for (const collectionName of collections) {
    const snapshot = await firestore.collection(collectionName).get();
    await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
  }
}

function audit(now: Timestamp, actor = 'system') {
  return {
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    updatedBy: actor,
  };
}

function auth(uid: string, token: Record<string, unknown>) {
  return {
    uid,
    token: {
      aud: projectId,
      auth_time: 1,
      exp: 9_999_999_999,
      firebase: {
        identities: {},
        sign_in_provider: 'custom',
      },
      iat: 1,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: uid,
      uid,
      ...token,
    } as DecodedIdToken,
    rawToken: 'raw-token',
  };
}

function callableRequest<T>(data: T, authData?: ReturnType<typeof auth>) {
  return {
    data,
    auth: authData,
    rawRequest: { headers: {} } as never,
    acceptsStreaming: false,
  } as never;
}

function expectHttpsError(code: string) {
  return (error: unknown) => {
    if (error instanceof HttpsError && error.code === code) {
      return true;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    const fallbackMatchers: Record<string, RegExp> = {
      'unauthenticated': /iniciar sesi[oó]n/i,
      'permission-denied': /(solo |permiso|no est[aá] activo)/i,
      'invalid-argument': /(campo |debe )/i,
      'not-found': /no existe /i,
      'failed-precondition': /(solo se puede|no puede|debe estar|configuraci[oó]n)/i,
    };

    return fallbackMatchers[code]?.test(error.message) ?? false;
  };
}

async function seedBaseData() {
  const firestore = db();
  const now = Timestamp.fromDate(new Date('2026-04-24T00:00:00.000Z'));

  await firestore.doc('users/directivo-1').set({
    email: 'directivo@club.test',
    displayName: 'Directivo',
    primaryRoleId: 'directivo',
    roleIds: ['directivo'],
    profileType: 'none',
    active: true,
    claimsVersion: 1,
    ...audit(now),
  });

  await firestore.doc('users/admin-1').set({
    email: 'admin@club.test',
    displayName: 'Administrativo',
    primaryRoleId: 'administrativo',
    roleIds: ['administrativo'],
    profileType: 'none',
    active: true,
    claimsVersion: 1,
    ...audit(now),
  });

  await firestore.doc('users/employee-user-1').set({
    email: 'employee@club.test',
    displayName: 'Empleado',
    primaryRoleId: 'empleado',
    roleIds: ['empleado'],
    profileType: 'employee',
    profileId: 'employee-1',
    active: true,
    claimsVersion: 1,
    ...audit(now),
  });

  await firestore.doc('users/socio-1').set({
    email: 'socio@club.test',
    displayName: 'Socio',
    primaryRoleId: 'socio',
    roleIds: ['socio'],
    profileType: 'member',
    profileId: 'member-1',
    active: true,
    claimsVersion: 1,
    ...audit(now),
  });

  await firestore.doc('members/member-1').set({
    memberNumber: '0001',
    firstName: 'Socio',
    lastName: 'Uno',
    linkedUserId: 'socio-1',
    typeId: 'pleno',
    typeCodeSnapshot: 'pleno',
    status: 'active',
    isFamilyHolder: false,
    joinedAt: now,
    ...audit(now),
  });

  await firestore.doc('employees/employee-1').set({
    firstName: 'Empleado',
    lastName: 'Uno',
    linkedUserId: 'employee-user-1',
    position: 'Mantenimiento',
    contractType: 'monthly',
    status: 'active',
    startDate: now,
    canSubmitExpenses: true,
    ...audit(now),
  });

  await firestore.doc('financial_configs/config-1').set({
    version: 1,
    isActive: true,
    effectiveFrom: now,
    effectiveTo: null,
    currency: 'ARS',
    fullMemberFeeMinor: 11_000_000,
    familyAssociatePctBps: 5_000,
    lifetimePctBps: 5_000,
    minorPctBps: 3_000,
    licensePctBps: 0,
    maxLicenseMonths: 6,
    creditCommissionPctBps: 300,
    familyGroupBillingMode: 'per_member',
    allowStandaloneMinor: true,
    membershipChargePersistenceMode: 'member_fee_charges',
    greenFeeAppliesToMembers: true,
    cantineroContractMode: 'fixed_monthly',
    advertisingDefaultPeriodicity: 'monthly',
    requireApprovalForExpensePosting: true,
    requireApprovalForOvertimePosting: true,
    ...audit(now),
  });

  await firestore.doc('payment_methods/cash').set({
    name: 'Cash',
    bancarizado: false,
    specialReportingType: null,
    active: true,
    sortOrder: 10,
    ...audit(now),
  });
  await firestore.doc('payment_methods/credit').set({
    name: 'Credit',
    bancarizado: true,
    specialReportingType: null,
    active: true,
    sortOrder: 20,
    ...audit(now),
  });
  await firestore.doc('payment_methods/transfer').set({
    name: 'Transfer',
    bancarizado: true,
    specialReportingType: null,
    active: true,
    sortOrder: 30,
    ...audit(now),
  });
  await firestore.doc('payment_methods/debit').set({
    name: 'Debit',
    bancarizado: true,
    specialReportingType: null,
    active: true,
    sortOrder: 35,
    ...audit(now),
  });
  await firestore.doc('payment_methods/debit_macro').set({
    name: 'Debit Macro',
    bancarizado: true,
    specialReportingType: 'macro_debit',
    active: true,
    sortOrder: 40,
    ...audit(now),
  });

  await firestore.doc('payment_commission_rules/rule-1').set({
    paymentMethodId: 'credit',
    percentageBps: 300,
    isActive: true,
    validFrom: now,
    validTo: null,
    setByUid: 'directivo-1',
    ...audit(now),
  });

  await firestore.doc('financial_income_categories/green_fee').set({
    name: 'Green fee',
    originType: 'green_fee',
    active: true,
    sortOrder: 10,
    ...audit(now),
  });
  await firestore.doc('financial_income_categories/cuota_societaria').set({
    name: 'Cuota societaria',
    originType: 'member_fee_charge',
    active: true,
    sortOrder: 20,
    ...audit(now),
  });
  await firestore.doc('financial_income_categories/handicap').set({
    name: 'Handicap',
    originType: 'handicap',
    active: true,
    sortOrder: 30,
    ...audit(now),
  });

  await firestore.doc('financial_expense_categories/combustible').set({
    name: 'Combustible',
    defaultBancarizado: false,
    defaultImputableImpositivo: true,
    active: true,
    sortOrder: 10,
    ...audit(now),
  });
  await firestore.doc('financial_expense_categories/sueldo').set({
    name: 'Sueldo',
    defaultBancarizado: true,
    defaultImputableImpositivo: true,
    active: true,
    sortOrder: 20,
    ...audit(now),
  });
  await firestore.doc('financial_expense_categories/horas_extra').set({
    name: 'Horas extra',
    defaultBancarizado: false,
    defaultImputableImpositivo: false,
    active: true,
    sortOrder: 30,
    ...audit(now),
  });

  await firestore.doc('financial_movements/movement-debit-1').set({
    movementType: 'income',
    categoryId: 'green_fee',
    categoryCodeSnapshot: 'green_fee',
    status: 'posted',
    operationDate: now,
    postingDate: now,
    accountingPeriod: '2026-04',
    originType: 'green_fee',
    originCollection: null,
    originId: null,
    thirdPartyType: 'member',
    thirdPartyId: 'member-1',
    paymentMethodId: 'debit_macro',
    paymentMethodCodeSnapshot: 'debit_macro',
    grossAmountMinor: 100000,
    appliedCommissionPctBps: null,
    appliedCommissionAmountMinor: null,
    netAmountMinor: 100000,
    bancarizado: true,
    imputableImpositivo: true,
    settlementId: null,
    registeredByUid: 'admin-1',
    approvedByUid: 'admin-1',
    approvedAt: now,
    reversalOfMovementId: null,
    voidReason: null,
    metadata: {},
    notes: null,
    ...audit(now),
  });

  await firestore.doc('financial_movements/movement-posted-1').set({
    movementType: 'income',
    categoryId: 'green_fee',
    categoryCodeSnapshot: 'green_fee',
    status: 'posted',
    operationDate: now,
    postingDate: now,
    accountingPeriod: '2026-04',
    originType: 'green_fee',
    originCollection: null,
    originId: null,
    thirdPartyType: 'member',
    thirdPartyId: 'member-1',
    paymentMethodId: 'cash',
    paymentMethodCodeSnapshot: 'cash',
    grossAmountMinor: 50000,
    appliedCommissionPctBps: null,
    appliedCommissionAmountMinor: null,
    netAmountMinor: 50000,
    bancarizado: false,
    imputableImpositivo: true,
    settlementId: null,
    registeredByUid: 'admin-1',
    approvedByUid: 'admin-1',
    approvedAt: now,
    reversalOfMovementId: null,
    voidReason: null,
    metadata: {},
    notes: null,
    ...audit(now),
  });

  await firestore.doc('macro_debit_settlements/settlement-1').set({
    month: '2026-04',
    bankName: 'Banco Macro',
    externalBatchRef: 'batch-existing',
    grossAmountMinor: 100000,
    commissionAmountMinor: 0,
    netAmountMinor: 100000,
    movementCount: 1,
    status: 'imported',
    statementFileUrl: null,
    accreditedAt: now,
    importedByUid: 'directivo-1',
    notes: null,
    ...audit(now),
  });

  await firestore.doc('expense_submissions/expense-1').set({
    employeeId: 'employee-1',
    categoryId: 'combustible',
    categoryCodeSnapshot: 'combustible',
    description: 'Combustible',
    expenseDate: now,
    amountMinor: 20000,
    liters: 10,
    vendorName: 'YPF',
    receiptFileUrl: null,
    status: 'submitted',
    reviewedByUid: null,
    reviewedAt: null,
    rejectionReason: null,
    linkedMovementId: null,
    paymentMethodId: 'cash',
    ...audit(now),
  });

  await firestore.doc('expense_submissions/expense-approved-1').set({
    employeeId: 'employee-1',
    categoryId: 'combustible',
    categoryCodeSnapshot: 'combustible',
    description: 'Combustible aprobado',
    expenseDate: now,
    amountMinor: 30000,
    liters: 12,
    vendorName: 'YPF',
    receiptFileUrl: null,
    status: 'approved',
    reviewedByUid: 'admin-1',
    reviewedAt: now,
    rejectionReason: null,
    linkedMovementId: null,
    paymentMethodId: 'cash',
    ...audit(now),
  });

  await firestore.doc('salary_configurations/salary-config-1').set({
    employeeId: 'employee-1',
    contractType: 'monthly',
    baseAmountMinor: 25000000,
    periodicity: 'monthly',
    effectiveFrom: now,
    effectiveTo: null,
    isActive: true,
    allowOvertime: true,
    notes: null,
    setByUid: 'directivo-1',
    ...audit(now),
  });

  await firestore.doc('handicap_charges/handicap-charge-collected-1').set({
    memberId: 'member-1',
    handicapId: null,
    period: '2026-04',
    collectionAmountMinor: 120000,
    transferAmountMinor: 120000,
    associationName: 'AAG',
    incomeMovementId: 'movement-posted-1',
    expenseMovementId: null,
    status: 'collected',
    transferDueDate: null,
    notes: null,
    ...audit(now),
  });
}

beforeEach(async () => {
  await clearFirestore();
  await seedBaseData();
});

after(async () => {
  if (getApps().length > 0) {
    await deleteApp(getApp());
  }
});

test('todas las callables validan auth', async () => {
  const cases = [
    { fn: accountingUpsertFinancialConfig, payload: { fullMemberFeeMinor: 11000000, familyAssociatePctBps: 5000, lifetimePctBps: 5000, minorPctBps: 3000, licensePctBps: 0, maxLicenseMonths: 6, familyGroupBillingMode: 'per_member', membershipChargePersistenceMode: 'member_fee_charges', cantineroContractMode: 'fixed_monthly', advertisingDefaultPeriodicity: 'monthly' } },
    { fn: accountingSetCreditCommissionRule, payload: { percentageBps: 300 } },
    { fn: accountingGenerateFeePreview, payload: { memberId: 'member-1', period: '2026-04' } },
    { fn: accountingGenerateCuota, payload: { memberId: 'member-1', period: '2026-04' } },
    { fn: accountingRegisterPayment, payload: { sourceType: 'green_fee', memberId: 'member-1', categoryId: 'green_fee', paymentMethodId: 'cash', grossAmountMinor: 10000, operationDate: '2026-04-24T00:00:00.000Z' } },
    { fn: accountingCreateMacroDebitSettlement, payload: { month: '2026-04', externalBatchRef: 'batch-2', movementIds: ['movement-debit-1'], accreditedAt: '2026-04-24T00:00:00.000Z' } },
    { fn: accountingReconcileMacroSettlement, payload: { settlementId: 'settlement-1' } },
    { fn: accountingSubmitExpense, payload: { employeeId: 'employee-1', categoryId: 'combustible', description: 'Fuel', expenseDate: '2026-04-24T00:00:00.000Z', amountMinor: 1000, liters: 5 } },
    { fn: accountingReviewExpense, payload: { expenseSubmissionId: 'expense-1', decision: 'approved' } },
    { fn: accountingPostExpenseMovement, payload: { expenseSubmissionId: 'expense-approved-1' } },
    { fn: accountingUpsertSalaryConfiguration, payload: { employeeId: 'employee-1', contractType: 'monthly', baseAmountMinor: 25000000, periodicity: 'monthly', effectiveFrom: '2026-04-01T00:00:00.000Z' } },
    { fn: accountingPostSalaryPayment, payload: { employeeId: 'employee-1', period: '2026-04', salaryGrossMinor: 25000000, bankedAmountMinor: 25000000, nonBankedAmountMinor: 0 } },
    { fn: accountingRecordExternalReference, payload: { referenceType: 'F931', period: '2026-04', amountMinor: 1000 } },
    { fn: accountingCreateHandicapCharge, payload: { memberId: 'member-1', period: '2026-04', collectionAmountMinor: 1000, transferAmountMinor: 1000, associationName: 'AAG' } },
    { fn: accountingTransferHandicapToAssociation, payload: { handicapChargeId: 'handicap-charge-collected-1' } },
    { fn: accountingVoidFinancialMovement, payload: { movementId: 'movement-posted-1', reason: 'duplicado' } },
  ];

  for (const item of cases) {
    await assert.rejects(
      () => item.fn.run(callableRequest(item.payload)),
      expectHttpsError('unauthenticated'),
    );
  }
});

test('todas las callables validan rol', async () => {
  const socioAuth = auth('socio-1', { socio: true, claimsVersion: 1 });
  const cases = [
    { fn: accountingUpsertFinancialConfig, payload: { fullMemberFeeMinor: 11000000, familyAssociatePctBps: 5000, lifetimePctBps: 5000, minorPctBps: 3000, licensePctBps: 0, maxLicenseMonths: 6, familyGroupBillingMode: 'per_member', membershipChargePersistenceMode: 'member_fee_charges', cantineroContractMode: 'fixed_monthly', advertisingDefaultPeriodicity: 'monthly' } },
    { fn: accountingSetCreditCommissionRule, payload: { percentageBps: 300 } },
    { fn: accountingGenerateFeePreview, payload: { memberId: 'member-1', period: '2026-04' } },
    { fn: accountingGenerateCuota, payload: { memberId: 'member-1', period: '2026-04' } },
    { fn: accountingRegisterPayment, payload: { sourceType: 'green_fee', memberId: 'member-1', categoryId: 'green_fee', paymentMethodId: 'cash', grossAmountMinor: 10000, operationDate: '2026-04-24T00:00:00.000Z' } },
    { fn: accountingCreateMacroDebitSettlement, payload: { month: '2026-04', externalBatchRef: 'batch-2', movementIds: ['movement-debit-1'], accreditedAt: '2026-04-24T00:00:00.000Z' } },
    { fn: accountingReconcileMacroSettlement, payload: { settlementId: 'settlement-1' } },
    { fn: accountingSubmitExpense, payload: { employeeId: 'employee-1', categoryId: 'combustible', description: 'Fuel', expenseDate: '2026-04-24T00:00:00.000Z', amountMinor: 1000, liters: 5 } },
    { fn: accountingReviewExpense, payload: { expenseSubmissionId: 'expense-1', decision: 'approved' } },
    { fn: accountingPostExpenseMovement, payload: { expenseSubmissionId: 'expense-approved-1' } },
    { fn: accountingUpsertSalaryConfiguration, payload: { employeeId: 'employee-1', contractType: 'monthly', baseAmountMinor: 25000000, periodicity: 'monthly', effectiveFrom: '2026-04-01T00:00:00.000Z' } },
    { fn: accountingPostSalaryPayment, payload: { employeeId: 'employee-1', period: '2026-04', salaryGrossMinor: 25000000, bankedAmountMinor: 25000000, nonBankedAmountMinor: 0 } },
    { fn: accountingRecordExternalReference, payload: { referenceType: 'F931', period: '2026-04', amountMinor: 1000 } },
    { fn: accountingCreateHandicapCharge, payload: { memberId: 'member-1', period: '2026-04', collectionAmountMinor: 1000, transferAmountMinor: 1000, associationName: 'AAG' } },
    { fn: accountingTransferHandicapToAssociation, payload: { handicapChargeId: 'handicap-charge-collected-1' } },
    { fn: accountingVoidFinancialMovement, payload: { movementId: 'movement-posted-1', reason: 'duplicado' } },
  ];

  for (const item of cases) {
    await assert.rejects(
      () => item.fn.run(callableRequest(item.payload, socioAuth)),
      expectHttpsError('permission-denied'),
    );
  }
});

test('payload inválido falla con error claro', async () => {
  const directivoAuth = auth('directivo-1', { directivo: true, claimsVersion: 1 });
  const cases = [
    accountingUpsertFinancialConfig,
    accountingSetCreditCommissionRule,
    accountingGenerateFeePreview,
    accountingGenerateCuota,
    accountingRegisterPayment,
    accountingCreateMacroDebitSettlement,
    accountingReconcileMacroSettlement,
    accountingSubmitExpense,
    accountingReviewExpense,
    accountingPostExpenseMovement,
    accountingUpsertSalaryConfiguration,
    accountingPostSalaryPayment,
    accountingRecordExternalReference,
    accountingCreateHandicapCharge,
    accountingTransferHandicapToAssociation,
    accountingVoidFinancialMovement,
  ];

  for (const callable of cases) {
    await assert.rejects(
      () => callable.run(callableRequest({}, directivoAuth)),
      expectHttpsError('invalid-argument'),
    );
  }
});

test('directivo y administrativo pueden modificar cuotas, pero administrativo no controles sensibles', async () => {
  const directivoAuth = auth('directivo-1', { directivo: true, claimsVersion: 1 });
  const adminAuth = auth('admin-1', { administrativo: true, claimsVersion: 1 });

  const directivoResult = await accountingUpsertFinancialConfig.run(callableRequest({
    fullMemberFeeMinor: 11000000,
    familyAssociatePctBps: 5000,
    lifetimePctBps: 5000,
    minorPctBps: 3000,
    licensePctBps: 0,
    maxLicenseMonths: 6,
    familyGroupBillingMode: 'per_member',
    membershipChargePersistenceMode: 'member_fee_charges',
    cantineroContractMode: 'fixed_monthly',
    advertisingDefaultPeriodicity: 'monthly',
  }, directivoAuth));

  assert.ok(directivoResult.configId);
  const adminResult = await accountingUpsertFinancialConfig.run(callableRequest({
    fullMemberFeeMinor: 12000000,
    familyAssociatePctBps: 5000,
    lifetimePctBps: 5000,
    minorPctBps: 3000,
    licensePctBps: 0,
    maxLicenseMonths: 6,
    familyGroupBillingMode: 'per_member',
    membershipChargePersistenceMode: 'member_fee_charges',
    cantineroContractMode: 'fixed_monthly',
    advertisingDefaultPeriodicity: 'monthly',
  }, adminAuth));

  assert.ok(adminResult.configId);
  await assert.rejects(
    () => accountingUpsertFinancialConfig.run(callableRequest({
      fullMemberFeeMinor: 11000000,
      familyAssociatePctBps: 5000,
      lifetimePctBps: 5000,
      minorPctBps: 3000,
      licensePctBps: 0,
      maxLicenseMonths: 12,
      familyGroupBillingMode: 'per_member',
      membershipChargePersistenceMode: 'member_fee_charges',
      cantineroContractMode: 'fixed_monthly',
      advertisingDefaultPeriodicity: 'monthly',
    }, adminAuth)),
    expectHttpsError('permission-denied'),
  );
});

test('directivo y administrativo pueden modificar salary_configurations y empleado no', async () => {
  const directivoAuth = auth('directivo-1', { directivo: true, claimsVersion: 1 });
  const adminAuth = auth('admin-1', { administrativo: true, claimsVersion: 1 });
  const employeeAuth = auth('employee-user-1', { empleado: true, claimsVersion: 1 });

  const directivoResult = await accountingUpsertSalaryConfiguration.run(callableRequest({
    employeeId: 'employee-1',
    contractType: 'monthly',
    baseAmountMinor: 25000000,
    periodicity: 'monthly',
    effectiveFrom: '2026-04-01T00:00:00.000Z',
    allowOvertime: true,
  }, directivoAuth));

  assert.ok(directivoResult.salaryConfigurationId);
  const adminResult = await accountingUpsertSalaryConfiguration.run(callableRequest({
    employeeId: 'employee-1',
    contractType: 'monthly',
    baseAmountMinor: 26000000,
    periodicity: 'monthly',
    effectiveFrom: '2026-05-01T00:00:00.000Z',
    allowOvertime: true,
  }, adminAuth));

  assert.ok(adminResult.salaryConfigurationId);
  await assert.rejects(
    () => accountingUpsertSalaryConfiguration.run(callableRequest({
      employeeId: 'employee-1',
      contractType: 'monthly',
      baseAmountMinor: 27000000,
      periodicity: 'monthly',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
      allowOvertime: true,
    }, employeeAuth)),
    expectHttpsError('permission-denied'),
  );
});

test('empleado puede crear su propia expense_submission y no puede aprobar rendición', async () => {
  const employeeAuth = auth('employee-user-1', { empleado: true, claimsVersion: 1 });

  const created = await accountingSubmitExpense.run(callableRequest({
    employeeId: 'employee-1',
    categoryId: 'combustible',
    description: 'Carga para carrito',
    expenseDate: '2026-04-24T00:00:00.000Z',
    amountMinor: 15000,
    liters: 8,
    vendorName: 'YPF',
  }, employeeAuth));

  assert.ok(created.expenseSubmissionId);
  await assert.rejects(
    () => accountingReviewExpense.run(callableRequest({
      expenseSubmissionId: 'expense-1',
      decision: 'approved',
    }, employeeAuth)),
    expectHttpsError('permission-denied'),
  );
});

test('postExpenseMovement solo desde approved', async () => {
  const adminAuth = auth('admin-1', { administrativo: true, claimsVersion: 1 });

  await assert.rejects(
    () => accountingPostExpenseMovement.run(callableRequest({
      expenseSubmissionId: 'expense-1',
    }, adminAuth)),
    expectHttpsError('failed-precondition'),
  );
});

test('referencias inexistentes fallan', async () => {
  const adminAuth = auth('admin-1', { administrativo: true, claimsVersion: 1 });
  const directivoAuth = auth('directivo-1', { directivo: true, claimsVersion: 1 });

  await assert.rejects(
    () => accountingGenerateFeePreview.run(callableRequest({ memberId: 'member-missing', period: '2026-04' }, adminAuth)),
    expectHttpsError('not-found'),
  );
  await assert.rejects(
    () => accountingCreateHandicapCharge.run(callableRequest({ memberId: 'member-missing', period: '2026-04', collectionAmountMinor: 1000, transferAmountMinor: 1000, associationName: 'AAG' }, adminAuth)),
    expectHttpsError('not-found'),
  );
  await assert.rejects(
    () => accountingRecordExternalReference.run(callableRequest({ referenceType: 'F931', period: '2026-04', amountMinor: 1000, linkedMovementId: 'movement-missing' }, directivoAuth)),
    expectHttpsError('not-found'),
  );
});

test('voidFinancialMovement requiere directivo', async () => {
  const adminAuth = auth('admin-1', { administrativo: true, claimsVersion: 1 });
  await assert.rejects(
    () => accountingVoidFinancialMovement.run(callableRequest({ movementId: 'movement-posted-1', reason: 'duplicado' }, adminAuth)),
    expectHttpsError('permission-denied'),
  );
});

test('transacciones no generan duplicados', async () => {
  const adminAuth = auth('admin-1', { administrativo: true, claimsVersion: 1 });
  const directivoAuth = auth('directivo-1', { directivo: true, claimsVersion: 1 });

  const firstCharge = await accountingGenerateCuota.run(callableRequest({
    memberId: 'member-1',
    period: '2026-04',
  }, adminAuth));
  const secondCharge = await accountingGenerateCuota.run(callableRequest({
    memberId: 'member-1',
    period: '2026-04',
  }, adminAuth));

  assert.equal(secondCharge.duplicate, true);
  assert.equal(secondCharge.memberFeeChargeId, firstCharge.memberFeeChargeId);

  const firstSettlement = await accountingCreateMacroDebitSettlement.run(callableRequest({
    month: '2026-04',
    externalBatchRef: 'batch-idempotent',
    movementIds: ['movement-debit-1'],
    accreditedAt: '2026-04-24T00:00:00.000Z',
  }, directivoAuth));
  const secondSettlement = await accountingCreateMacroDebitSettlement.run(callableRequest({
    month: '2026-04',
    externalBatchRef: 'batch-idempotent',
    movementIds: ['movement-debit-1'],
    accreditedAt: '2026-04-24T00:00:00.000Z',
  }, directivoAuth));

  assert.equal(secondSettlement.duplicate, true);
  assert.equal(secondSettlement.settlementId, firstSettlement.settlementId);
});
