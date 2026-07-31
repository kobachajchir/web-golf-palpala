import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const projectId = 'demo-web-golf-palpala';
const rulesPath = path.resolve(process.cwd(), '..', 'rules', 'firestore.rules');

let testEnv: RulesTestEnvironment;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await fs.readFile(rulesPath, 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    const now = Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z'));

    await setDoc(doc(adminDb, 'users/user-1'), {
      email: 'user-1@club.test',
      displayName: 'User 1',
      primaryRoleId: 'socio',
      roleIds: ['socio'],
      profileType: 'member',
      profileId: 'member-1',
      active: true,
      claimsVersion: 1,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'users/user-2'), {
      email: 'user-2@club.test',
      displayName: 'User 2',
      primaryRoleId: 'socio',
      roleIds: ['socio'],
      profileType: 'member',
      profileId: 'member-2',
      active: true,
      claimsVersion: 1,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'users/directivo-1'), {
      email: 'directivo@club.test',
      displayName: 'Directivo',
      primaryRoleId: 'directivo',
      roleIds: ['directivo'],
      profileType: 'none',
      active: true,
      claimsVersion: 1,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'users/admin-1'), {
      email: 'admin@club.test',
      displayName: 'Administrativo',
      primaryRoleId: 'administrativo',
      roleIds: ['administrativo'],
      profileType: 'none',
      active: true,
      claimsVersion: 1,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'users/employee-user-1'), {
      email: 'employee@club.test',
      displayName: 'Empleado',
      primaryRoleId: 'empleado',
      roleIds: ['empleado'],
      profileType: 'employee',
      profileId: 'employee-1',
      active: true,
      claimsVersion: 1,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'members/member-1'), {
      memberNumber: '0001',
      firstName: 'Socio',
      lastName: 'Uno',
      linkedUserId: 'user-1',
      typeId: 'pleno',
      typeCodeSnapshot: 'pleno',
      status: 'active',
      familyGroupId: 'family-1',
      isFamilyHolder: false,
      joinedAt: now,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'members/member-3'), {
      memberNumber: '0003',
      firstName: 'Familiar',
      lastName: 'Uno',
      typeId: 'grupo_familiar_asociado',
      typeCodeSnapshot: 'grupo_familiar_asociado',
      status: 'active',
      familyGroupId: 'family-1',
      isFamilyHolder: false,
      joinedAt: now,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'family_groups/family-1'), {
      holderMemberId: 'member-1',
      memberIds: ['member-1', 'member-3'],
      active: true,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'members/member-2'), {
      memberNumber: '0002',
      firstName: 'Socio',
      lastName: 'Dos',
      linkedUserId: 'user-2',
      typeId: 'pleno',
      typeCodeSnapshot: 'pleno',
      status: 'active',
      isFamilyHolder: false,
      joinedAt: now,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'employees/employee-1'), {
      firstName: 'Empleado',
      lastName: 'Uno',
      linkedUserId: 'employee-user-1',
      position: 'Recepcion',
      contractType: 'monthly',
      status: 'active',
      startDate: now,
      canSubmitExpenses: false,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'financial_configs/config-1'), {
      version: 1,
      isActive: true,
      effectiveFrom: now,
      effectiveTo: null,
      currency: 'ARS',
      fullMemberFeeMinor: 11000000,
      familyAssociatePctBps: 5000,
      lifetimePctBps: 5000,
      minorPctBps: 3000,
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
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'salary_configurations/salary-config-1'), {
      employeeId: 'employee-1',
      contractType: 'monthly',
      baseAmountMinor: 25000000,
      periodicity: 'monthly',
      effectiveFrom: now,
      effectiveTo: null,
      isActive: true,
      allowOvertime: true,
      setByUid: 'directivo-1',
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'expense_submissions/expense-1'), {
      employeeId: 'employee-1',
      categoryId: 'combustible',
      categoryCodeSnapshot: 'combustible',
      description: 'Combustible',
      expenseDate: now,
      amountMinor: 15000,
      liters: 10,
      vendorName: 'YPF',
      receiptFileUrl: null,
      status: 'submitted',
      reviewedByUid: null,
      reviewedAt: null,
      rejectionReason: null,
      linkedMovementId: null,
      paymentMethodId: 'cash',
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });

    await setDoc(doc(adminDb, 'financial_movements/movement-1'), {
      movementType: 'income',
      categoryId: 'green_fee',
      categoryCodeSnapshot: 'green_fee',
      status: 'posted',
      operationDate: now,
      postingDate: now,
      accountingPeriod: '2026-01',
      originType: 'green_fee',
      originCollection: null,
      originId: null,
      thirdPartyType: 'member',
      thirdPartyId: 'member-1',
      paymentMethodId: 'cash',
      paymentMethodCodeSnapshot: 'cash',
      grossAmountMinor: 10000,
      appliedCommissionPctBps: null,
      appliedCommissionAmountMinor: null,
      netAmountMinor: 10000,
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
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

function createNotificationDelivery(overrides: Record<string, unknown> = {}) {
  const now = Timestamp.fromDate(new Date('2026-01-04T00:00:00.000Z'));

  return {
    notificationId: 'notification-1',
    type: 'test_notification',
    sourceModule: 'tests',
    sourceCollection: null,
    sourceId: null,
    recipientUserId: 'user-1',
    recipientDisplayName: 'User 1',
    recipientMemberNumber: '0001',
    recipientProfileType: 'member',
    recipientProfileId: 'member-1',
    recipientRoleIds: ['socio'],
    titleSnapshot: 'Aviso de prueba',
    bodySnapshot: 'Cuerpo del aviso',
    severity: 'info',
    deliveryScope: 'per_user',
    route: '/mi-membresia',
    action: null,
    attachments: [],
    metadata: {},
    status: 'unread',
    readAt: null,
    readByUid: null,
    readBySnapshot: null,
    actionedAt: null,
    actionedByUid: null,
    actionedBySnapshot: null,
    dismissedAt: null,
    dismissedByUid: null,
    createdAt: now,
    createdBy: 'system',
    updatedAt: now,
    updatedBy: 'system',
    ...overrides,
  };
}

test('user solo lee su propio users/{uid}', async () => {
  const ownDb = testEnv.authenticatedContext('user-1').firestore();
  const otherDb = testEnv.authenticatedContext('user-2').firestore();

  await assertSucceeds(getDoc(doc(ownDb, 'users/user-1')));
  await assertFails(getDoc(doc(otherDb, 'users/user-1')));
});

test('socio no puede modificar nombre, roles ni tipo de usuario', async () => {
  const ownDb = testEnv.authenticatedContext('user-1', { socio: true }).firestore();

  await assertFails(updateDoc(doc(ownDb, 'users/user-1'), {
    displayName: 'Nombre alterado',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(ownDb, 'users/user-1'), {
    roleIds: ['socio', 'administrativo'],
    primaryRoleId: 'administrativo',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(ownDb, 'members/member-1'), {
    firstName: 'Nombre alterado',
  }));
});
test('socio vinculado puede leer su member doc', async () => {
  const ownDb = testEnv.authenticatedContext('user-1').firestore();
  const otherDb = testEnv.authenticatedContext('user-2').firestore();

  await assertSucceeds(getDoc(doc(ownDb, 'members/member-1')));
  await assertFails(getDoc(doc(otherDb, 'members/member-1')));
});

test('socio vinculado puede leer su grupo familiar y miembros asociados', async () => {
  const ownDb = testEnv.authenticatedContext('user-1').firestore();
  const otherDb = testEnv.authenticatedContext('user-2').firestore();

  await assertSucceeds(getDoc(doc(ownDb, 'family_groups/family-1')));
  await assertSucceeds(getDoc(doc(ownDb, 'members/member-3')));
  await assertFails(getDoc(doc(otherDb, 'family_groups/family-1')));
  await assertFails(getDoc(doc(otherDb, 'members/member-3')));
});

test('un empleado sin staff no puede leer employees ajenos', async () => {
  const employeeDb = testEnv.authenticatedContext('employee-user-1', { empleado: true }).firestore();
  const adminDb = testEnv.authenticatedContext('admin-1', { administrativo: true }).firestore();

  await assertFails(getDoc(doc(employeeDb, 'employees/employee-1')));
  await assertSucceeds(getDoc(doc(adminDb, 'employees/employee-1')));
});

test('directivo puede modificar financial_configs', async () => {
  const directivoDb = testEnv.authenticatedContext('directivo-1', { directivo: true }).firestore();
  const now = Timestamp.fromDate(new Date('2026-01-02T00:00:00.000Z'));

  await assertSucceeds(setDoc(doc(directivoDb, 'financial_configs/config-2'), {
    version: 2,
    isActive: false,
    effectiveFrom: now,
    effectiveTo: null,
    currency: 'ARS',
    fullMemberFeeMinor: 12000000,
    familyAssociatePctBps: 5000,
    lifetimePctBps: 5000,
    minorPctBps: 3000,
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
    createdAt: now,
    createdBy: 'directivo-1',
    updatedAt: now,
    updatedBy: 'directivo-1',
  }));
});

test('administrativo puede modificar financial_configs', async () => {
  const adminDb = testEnv.authenticatedContext('admin-1', { administrativo: true }).firestore();
  const now = Timestamp.fromDate(new Date('2026-01-02T00:00:00.000Z'));

  await assertSucceeds(setDoc(doc(adminDb, 'financial_configs/config-2'), {
    version: 2,
    isActive: false,
    effectiveFrom: now,
    effectiveTo: null,
    currency: 'ARS',
    fullMemberFeeMinor: 12000000,
    familyAssociatePctBps: 5000,
    lifetimePctBps: 5000,
    minorPctBps: 3000,
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
    createdAt: now,
    createdBy: 'admin-1',
    updatedAt: now,
    updatedBy: 'admin-1',
  }));
});

test('administrativo puede crear reglas de comision de medios de pago', async () => {
  const adminDb = testEnv.authenticatedContext('admin-1', { administrativo: true }).firestore();
  const employeeDb = testEnv.authenticatedContext('employee-user-1', { empleado: true }).firestore();
  const now = Timestamp.fromDate(new Date('2026-01-02T00:00:00.000Z'));
  const commissionRule = {
    paymentMethodId: 'credit_galicia',
    percentageBps: 650,
    isActive: true,
    validFrom: now,
    validTo: null,
    setByUid: 'admin-1',
    breakdown: [
      { id: 'merchant', label: 'Arancel tarjeta', percentageBps: 650, isActive: true },
    ],
    notes: 'Actualizacion administrativa',
    createdAt: now,
    createdBy: 'admin-1',
    updatedAt: now,
    updatedBy: 'admin-1',
  };

  await assertSucceeds(setDoc(doc(adminDb, 'payment_commission_rules/rule-admin'), commissionRule));
  await assertFails(setDoc(doc(employeeDb, 'payment_commission_rules/rule-employee'), commissionRule));
});

test('administrativo tiene escritura completa sobre recursos contables sensibles', async () => {
  const adminDb = testEnv.authenticatedContext('admin-1', { administrativo: true }).firestore();
  const now = Timestamp.fromDate(new Date('2026-01-03T00:00:00.000Z'));
  const audit = {
    createdAt: now,
    createdBy: 'admin-1',
    updatedAt: now,
    updatedBy: 'admin-1',
  };

  await assertSucceeds(setDoc(doc(adminDb, 'payment_methods/admin-method'), {
    name: 'Transferencia administrativa',
    bancarizado: true,
    active: true,
    sortOrder: 99,
    ...audit,
  }));
  await assertSucceeds(setDoc(doc(adminDb, 'salary_payments/admin-payment'), {
    employeeId: 'employee-1',
    period: '2026-01',
    salaryConfigurationId: 'salary-config-1',
    salaryGrossMinor: 26000000,
    overtimeHours: null,
    overtimeAmountMinor: null,
    overtimeBancarizado: false,
    overtimeImputableImpositivo: false,
    bankedAmountMinor: 26000000,
    nonBankedAmountMinor: 0,
    linkedExternalReferenceIds: [],
    financialMovementIds: [],
    status: 'posted',
    approvedByUid: 'admin-1',
    ...audit,
  }));
  await assertSucceeds(setDoc(doc(adminDb, 'payroll_configs/current'), {
    paymentDay: 10,
    prepareReceiptsDaysBefore: 3,
    effectiveFrom: now,
    setByUid: 'admin-1',
    ...audit,
  }));
  await assertSucceeds(setDoc(doc(adminDb, 'employee_payroll_cycles/admin-cycle'), {
    employeeId: 'employee-1',
    period: '2026-01',
    salaryGrossMinor: 26000000,
    overtimeTotalHours: 0,
    overtimeTotalMinor: 0,
    bankedAmountMinor: 26000000,
    nonBankedAmountMinor: 0,
    linkedReferenceIds: [],
    linkedCertificateIds: [],
    financialMovementIds: [],
    status: 'posted',
    ...audit,
  }));
  await assertSucceeds(setDoc(doc(adminDb, 'accounting_reports/admin-report'), {
    title: 'Reporte administrativo',
    status: 'generated',
    ...audit,
  }));
  await assertSucceeds(updateDoc(doc(adminDb, 'financial_movements/movement-1'), {
    status: 'voided',
    voidReason: 'Correccion administrativa',
    updatedAt: now,
    updatedBy: 'admin-1',
  }));
});

test('directivo puede modificar salary_configurations', async () => {
  const directivoDb = testEnv.authenticatedContext('directivo-1', { directivo: true }).firestore();
  const now = Timestamp.fromDate(new Date('2026-01-02T00:00:00.000Z'));

  await assertSucceeds(setDoc(doc(directivoDb, 'salary_configurations/salary-config-2'), {
    employeeId: 'employee-1',
    contractType: 'monthly',
    baseAmountMinor: 26000000,
    periodicity: 'monthly',
    effectiveFrom: now,
    effectiveTo: null,
    isActive: false,
    allowOvertime: true,
    setByUid: 'directivo-1',
    createdAt: now,
    createdBy: 'directivo-1',
    updatedAt: now,
    updatedBy: 'directivo-1',
  }));
});

test('administrativo puede leer y escribir salary_configurations y empleado no', async () => {
  const adminDb = testEnv.authenticatedContext('admin-1', { administrativo: true }).firestore();
  const employeeDb = testEnv.authenticatedContext('employee-user-1', { empleado: true }).firestore();
  const now = Timestamp.fromDate(new Date('2026-01-02T00:00:00.000Z'));
  const salaryConfiguration = {
    employeeId: 'employee-1',
    contractType: 'monthly',
    baseAmountMinor: 26000000,
    periodicity: 'monthly',
    effectiveFrom: now,
    effectiveTo: null,
    isActive: false,
    allowOvertime: true,
    setByUid: 'admin-1',
    createdAt: now,
    createdBy: 'admin-1',
    updatedAt: now,
    updatedBy: 'admin-1',
  };

  await assertSucceeds(getDoc(doc(adminDb, 'salary_configurations/salary-config-1')));
  await assertSucceeds(setDoc(doc(adminDb, 'salary_configurations/salary-config-admin'), salaryConfiguration));
  await assertFails(getDoc(doc(employeeDb, 'salary_configurations/salary-config-1')));
  await assertFails(setDoc(doc(employeeDb, 'salary_configurations/salary-config-employee'), salaryConfiguration));
});

test('empleado puede crear su propia expense_submission', async () => {
  const employeeDb = testEnv.authenticatedContext('employee-user-1', { empleado: true }).firestore();
  const now = Timestamp.fromDate(new Date('2026-01-02T00:00:00.000Z'));

  await assertSucceeds(setDoc(doc(employeeDb, 'expense_submissions/expense-own'), {
    employeeId: 'employee-1',
    categoryId: 'combustible',
    categoryCodeSnapshot: 'combustible',
    description: 'Carga propia',
    expenseDate: now,
    amountMinor: 12000,
    liters: 8,
    vendorName: 'YPF',
    receiptFileUrl: null,
    status: 'submitted',
    reviewedByUid: null,
    reviewedAt: null,
    rejectionReason: null,
    linkedMovementId: null,
    paymentMethodId: 'cash',
    createdAt: now,
    createdBy: 'employee-user-1',
    updatedAt: now,
    updatedBy: 'employee-user-1',
  }));
});

test('empleado no puede aprobar rendición', async () => {
  const employeeDb = testEnv.authenticatedContext('employee-user-1', { empleado: true }).firestore();
  const now = Timestamp.fromDate(new Date('2026-01-03T00:00:00.000Z'));

  await assertFails(updateDoc(doc(employeeDb, 'expense_submissions/expense-1'), {
    status: 'approved',
    reviewedByUid: 'employee-user-1',
    reviewedAt: now,
  }));
});

test('no hard delete de financial_movements', async () => {
  const directivoDb = testEnv.authenticatedContext('directivo-1', { directivo: true }).firestore();
  await assertFails(deleteDoc(doc(directivoDb, 'financial_movements/movement-1')));
});

test('usuario especifico solo lee su propia entrega de notificacion', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'notification_deliveries/delivery-user-1'),
      createNotificationDelivery(),
    );
  });

  const ownDb = testEnv.authenticatedContext('user-1', { socio: true }).firestore();
  const otherDb = testEnv.authenticatedContext('user-2', { socio: true }).firestore();
  const adminDb = testEnv.authenticatedContext('admin-1', { administrativo: true }).firestore();

  await assertSucceeds(getDoc(doc(ownDb, 'notification_deliveries/delivery-user-1')));
  await assertFails(getDoc(doc(otherDb, 'notification_deliveries/delivery-user-1')));
  await assertSucceeds(getDoc(doc(adminDb, 'notification_deliveries/delivery-user-1')));
});

test('entrega por rol permite lectura del rol y bloquea roles no destinatarios', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'notification_deliveries/delivery-role-1'),
      createNotificationDelivery({
        notificationId: 'notification-role-1',
        recipientUserId: 'admin-1',
        recipientDisplayName: 'Administrativo',
        recipientRoleIds: ['administrativo', 'directivo'],
        deliveryScope: 'shared_role_action',
      }),
    );
  });

  const directivoDb = testEnv.authenticatedContext('directivo-1', { directivo: true }).firestore();
  const employeeDb = testEnv.authenticatedContext('employee-user-1', { empleado: true }).firestore();

  await assertSucceeds(getDoc(doc(directivoDb, 'notification_deliveries/delivery-role-1')));
  await assertFails(getDoc(doc(employeeDb, 'notification_deliveries/delivery-role-1')));
});

test('cliente no escribe notificaciones ni consultas de contacto', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'notification_deliveries/delivery-readonly-1'),
      createNotificationDelivery(),
    );
  });

  const ownDb = testEnv.authenticatedContext('user-1', { socio: true }).firestore();
  const adminDb = testEnv.authenticatedContext('admin-1', { administrativo: true }).firestore();

  await assertFails(updateDoc(doc(ownDb, 'notification_deliveries/delivery-readonly-1'), { status: 'read' }));
  await assertFails(setDoc(doc(adminDb, 'contact_inquiries/inquiry-1'), {
    channel: 'public_login_contact',
    senderName: 'Visitante',
    senderEmail: 'visitante@example.test',
    senderPhone: null,
    subject: 'Consulta',
    message: 'Mensaje',
    status: 'open',
    createdAt: Timestamp.fromDate(new Date('2026-01-04T00:00:00.000Z')),
    createdBy: 'admin-1',
    updatedAt: Timestamp.fromDate(new Date('2026-01-04T00:00:00.000Z')),
    updatedBy: 'admin-1',
  }));
});

test('directivo no puede exponer ni asignar el rol interno desarrollador', async () => {
  const directivoDb = testEnv.authenticatedContext('directivo-1', { directivo: true }).firestore();

  await assertSucceeds(updateDoc(doc(directivoDb, 'users/user-1'), {
    roleIds: ['socio', 'administrativo'],
    primaryRoleId: 'administrativo',
  }));
  await assertFails(updateDoc(doc(directivoDb, 'users/user-1'), {
    roleIds: ['socio', 'administrativo', 'desarrollador'],
  }));
  await assertFails(setDoc(doc(directivoDb, 'roles/desarrollador'), {
    name: 'Desarrollador',
    description: 'Rol interno',
    permissionIds: [],
    system: true,
    active: true,
    sortOrder: 999,
  }));
  await assertFails(getDoc(doc(directivoDb, 'roles/desarrollador')));
});
