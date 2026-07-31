import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ACCOUNTING_COLLECTIONS, SYSTEM_ACTOR_UID as ACCOUNTING_SYSTEM_ACTOR_UID, } from '../modules/accounting/domain/constants.js';
import { buildCustomClaims, pickPrimaryRoleId } from '../modules/users/application/shared.js';
import { setCustomClaimsPreservingInternalRoles } from '../modules/users/infrastructure/firestore/auth-gateway.js';
import { SYSTEM_ACTOR_UID, USERS_COLLECTIONS, } from '../modules/users/domain/constants.js';
import { buildSyntheticAuthEmail, generateMemberTemporaryPassword, normalizeMemberNumber, } from '../modules/auth/member-number-auth.js';
import { TOURNAMENTS_COLLECTIONS } from '../modules/tournaments/domain/constants.js';
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'webgolfclub';
const ADMIN_EMPLOYEE_CODE = 'E001';
const ADMIN_EMPLOYEE_ID = 'employee-administracion';
const ADMIN_DISPLAY_NAME = 'Administracion';
const PAGE_SIZE = 400;
const REPORT_PATH = resolve(process.env.RESET_OPERATIONAL_DATA_REPORT_PATH
    ?? resolve(process.cwd(), 'seed-reports', `reset-operational-data-${Date.now()}.json`));
const OPERATIONAL_COLLECTIONS_TO_DELETE = [
    ACCOUNTING_COLLECTIONS.memberFeeCharges,
    ACCOUNTING_COLLECTIONS.financialMovements,
    ACCOUNTING_COLLECTIONS.cashClosures,
    ACCOUNTING_COLLECTIONS.macroDebitSettlements,
    ACCOUNTING_COLLECTIONS.salaryConfigurations,
    ACCOUNTING_COLLECTIONS.salaryPayments,
    ACCOUNTING_COLLECTIONS.externalAccountingReferences,
    ACCOUNTING_COLLECTIONS.employeeAccountingLinks,
    ACCOUNTING_COLLECTIONS.employeeCertificates,
    ACCOUNTING_COLLECTIONS.employeePayrollCycles,
    ACCOUNTING_COLLECTIONS.expenseSubmissions,
    ACCOUNTING_COLLECTIONS.overtimeEntries,
    ACCOUNTING_COLLECTIONS.concessionContracts,
    ACCOUNTING_COLLECTIONS.advertisingContracts,
    ACCOUNTING_COLLECTIONS.handicapCharges,
    TOURNAMENTS_COLLECTIONS.tournaments,
    TOURNAMENTS_COLLECTIONS.registrations,
    TOURNAMENTS_COLLECTIONS.receipts,
    USERS_COLLECTIONS.passwordResetRequests,
    'accounting_reports',
    'notifications',
    'notification_deliveries',
    'notification_action_logs',
    'contact_inquiries',
];
function parseOptions() {
    const args = process.argv.slice(2);
    const projectArg = args.find((arg) => arg.startsWith('--project='));
    const execute = args.includes('--execute') && args.includes('--yes-delete-firestore-operational-data');
    return {
        projectId: projectArg?.split('=')[1]?.trim() || DEFAULT_PROJECT_ID,
        execute,
    };
}
function ensureAdminApp(projectId) {
    if (getApps().length === 0) {
        initializeApp({ projectId });
    }
}
function getNextMonthStart() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 3, 0, 0));
}
async function countCollection(collectionName) {
    const snapshot = await getFirestore().collection(collectionName).select().get();
    return snapshot.size;
}
async function deleteCollection(collectionName, execute) {
    if (!execute) {
        return countCollection(collectionName);
    }
    const firestore = getFirestore();
    let deletedCount = 0;
    for (;;) {
        const snapshot = await firestore.collection(collectionName).limit(PAGE_SIZE).get();
        if (snapshot.empty) {
            break;
        }
        const batch = firestore.batch();
        snapshot.docs.forEach((entry) => batch.delete(entry.ref));
        await batch.commit();
        deletedCount += snapshot.size;
    }
    return deletedCount;
}
async function resetMemberRenewals(execute) {
    const firestore = getFirestore();
    const snapshot = await firestore.collection(USERS_COLLECTIONS.members).select().get();
    if (!execute) {
        return snapshot.size;
    }
    const nextRenewalDueAt = Timestamp.fromDate(getNextMonthStart());
    let batch = firestore.batch();
    let pendingWrites = 0;
    let updatedCount = 0;
    for (const entry of snapshot.docs) {
        batch.update(entry.ref, {
            membershipRenewalStatus: 'current',
            membershipRenewalDueAt: nextRenewalDueAt,
            lastFeePaymentAt: FieldValue.delete(),
            lastFeePaidAmountMinor: FieldValue.delete(),
            lastFeeDiscountPctBps: FieldValue.delete(),
            lastFeeDiscountAmountMinor: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: ACCOUNTING_SYSTEM_ACTOR_UID,
        });
        pendingWrites += 1;
        updatedCount += 1;
        if (pendingWrites >= PAGE_SIZE) {
            await batch.commit();
            batch = firestore.batch();
            pendingWrites = 0;
        }
    }
    if (pendingWrites > 0) {
        await batch.commit();
    }
    return updatedCount;
}
async function getOrCreateAdminAuthUser(existingUid, password) {
    const auth = getAuth();
    const email = buildSyntheticAuthEmail(ADMIN_EMPLOYEE_CODE);
    try {
        const user = await auth.getUserByEmail(email);
        await auth.updateUser(user.uid, {
            displayName: ADMIN_DISPLAY_NAME,
            password,
            disabled: false,
        });
        return user.uid;
    }
    catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'auth/user-not-found') {
            throw error;
        }
    }
    if (existingUid) {
        await auth.updateUser(existingUid, {
            email,
            displayName: ADMIN_DISPLAY_NAME,
            password,
            disabled: false,
        });
        return existingUid;
    }
    const created = await auth.createUser({
        email,
        displayName: ADMIN_DISPLAY_NAME,
        password,
        disabled: false,
    });
    return created.uid;
}
async function cleanupEmployees(execute) {
    const firestore = getFirestore();
    const employeesSnapshot = await firestore.collection(USERS_COLLECTIONS.employees).get();
    const employees = employeesSnapshot.docs.map((entry) => ({
        id: entry.id,
        ref: entry.ref,
        data: entry.data(),
    }));
    const existingAdmin = employees.find((employee) => employee.data.employeeCode === ADMIN_EMPLOYEE_CODE) ?? null;
    const keptEmployeeId = existingAdmin?.id ?? ADMIN_EMPLOYEE_ID;
    const deletedEmployees = employees.filter((employee) => employee.id !== keptEmployeeId);
    const disabledLinkedUserIds = deletedEmployees
        .map((employee) => employee.data.linkedUserId)
        .filter((uid) => Boolean(uid));
    if (!execute) {
        return {
            keptEmployeeId,
            deletedEmployeeIds: deletedEmployees.map((employee) => employee.id),
            disabledLinkedUserIds,
            adminUid: existingAdmin?.data.linkedUserId ?? null,
            temporaryPassword: null,
        };
    }
    const generatedPassword = generateMemberTemporaryPassword(ADMIN_EMPLOYEE_CODE);
    const adminUid = await getOrCreateAdminAuthUser(existingAdmin?.data.linkedUserId ?? null, generatedPassword.temporaryPassword);
    const adminUserRef = firestore.collection(USERS_COLLECTIONS.users).doc(adminUid);
    const adminUserSnapshot = await adminUserRef.get();
    const existingAdminUser = adminUserSnapshot.exists ? adminUserSnapshot.data() : null;
    const roleIds = ['empleado', 'administrativo'];
    const claimsVersion = (existingAdminUser?.claimsVersion ?? 0) + 1;
    for (let index = 0; index < deletedEmployees.length; index += PAGE_SIZE) {
        const batch = firestore.batch();
        deletedEmployees.slice(index, index + PAGE_SIZE).forEach((employee) => batch.delete(employee.ref));
        await batch.commit();
    }
    const adminBatch = firestore.batch();
    adminBatch.set(firestore.collection(USERS_COLLECTIONS.employees).doc(keptEmployeeId), {
        employeeCode: ADMIN_EMPLOYEE_CODE,
        firstName: ADMIN_DISPLAY_NAME,
        lastName: '',
        dni: FieldValue.delete(),
        linkedMemberId: FieldValue.delete(),
        linkedUserId: adminUid,
        position: ADMIN_DISPLAY_NAME,
        contractType: 'monthly',
        status: 'active',
        startDate: Timestamp.fromDate(new Date('2026-01-01T03:00:00.000Z')),
        endDate: FieldValue.delete(),
        canSubmitExpenses: false,
        notes: 'Empleado administrativo principal conservado por limpieza operativa.',
        createdAt: existingAdmin?.data.createdAt ?? FieldValue.serverTimestamp(),
        createdBy: existingAdmin?.data.createdBy ?? SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
    }, { merge: true });
    adminBatch.set(adminUserRef, {
        email: buildSyntheticAuthEmail(ADMIN_EMPLOYEE_CODE),
        displayName: ADMIN_DISPLAY_NAME,
        primaryRoleId: pickPrimaryRoleId(roleIds),
        roleIds,
        profileType: 'employee',
        profileId: keptEmployeeId,
        active: true,
        claimsVersion,
        memberNumber: normalizeMemberNumber(ADMIN_EMPLOYEE_CODE),
        authProviderMode: 'member_number_password',
        mustChangePassword: true,
        passwordResetRequiredReason: 'staff_reset',
        createdAt: existingAdminUser?.createdAt ?? FieldValue.serverTimestamp(),
        createdBy: existingAdminUser?.createdBy ?? SYSTEM_ACTOR_UID,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: SYSTEM_ACTOR_UID,
    }, { merge: true });
    await adminBatch.commit();
    const disabledUserIds = disabledLinkedUserIds.filter((uid) => uid !== adminUid);
    for (let index = 0; index < disabledUserIds.length; index += PAGE_SIZE) {
        const batch = firestore.batch();
        for (const uid of disabledUserIds.slice(index, index + PAGE_SIZE)) {
            const userRef = firestore.collection(USERS_COLLECTIONS.users).doc(uid);
            batch.set(userRef, {
                active: false,
                roleIds: [],
                primaryRoleId: 'empleado',
                profileType: 'none',
                profileId: null,
                memberNumber: null,
                mustChangePassword: false,
                passwordResetRequiredReason: null,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            }, { merge: true });
        }
        await batch.commit();
    }
    for (const uid of disabledUserIds) {
        try {
            await getAuth().updateUser(uid, { disabled: true });
            await setCustomClaimsPreservingInternalRoles(uid, buildCustomClaims([], claimsVersion, false));
        }
        catch (error) {
            console.warn(`No pudimos desactivar Auth ${uid}:`, error);
        }
    }
    await setCustomClaimsPreservingInternalRoles(adminUid, buildCustomClaims(roleIds, claimsVersion, true));
    return {
        keptEmployeeId,
        deletedEmployeeIds: deletedEmployees.map((employee) => employee.id),
        disabledLinkedUserIds: disabledUserIds,
        adminUid,
        temporaryPassword: generatedPassword.temporaryPassword,
    };
}
async function run() {
    const options = parseOptions();
    ensureAdminApp(options.projectId);
    getFirestore().settings({ ignoreUndefinedProperties: true });
    const deletedCollections = {};
    for (const collectionName of OPERATIONAL_COLLECTIONS_TO_DELETE) {
        deletedCollections[collectionName] = await deleteCollection(collectionName, options.execute);
    }
    const resetMembersCount = await resetMemberRenewals(options.execute);
    const employeeCleanup = await cleanupEmployees(options.execute);
    const report = {
        ok: true,
        mode: options.execute ? 'execute' : 'dry-run',
        projectId: options.projectId,
        emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
        deletedCollections,
        resetMembersCount,
        employeeCleanup,
        preservedCollections: [
            USERS_COLLECTIONS.users,
            USERS_COLLECTIONS.members,
            USERS_COLLECTIONS.memberLoginIdentifiers,
            USERS_COLLECTIONS.roles,
            USERS_COLLECTIONS.permissions,
            USERS_COLLECTIONS.rolePermissions,
            USERS_COLLECTIONS.memberTypes,
            USERS_COLLECTIONS.familyGroups,
            'executive_board_terms',
            'executive_board_members',
            ACCOUNTING_COLLECTIONS.financialConfigs,
            ACCOUNTING_COLLECTIONS.paymentMethods,
            ACCOUNTING_COLLECTIONS.financialIncomeCategories,
            ACCOUNTING_COLLECTIONS.financialExpenseCategories,
            ACCOUNTING_COLLECTIONS.payrollConfigs,
        ],
        confirmationRequiredForExecution: '--execute --yes-delete-firestore-operational-data',
        reportPath: REPORT_PATH,
    };
    const reportForFile = {
        ...report,
        employeeCleanup: {
            ...report.employeeCleanup,
            temporaryPassword: report.employeeCleanup.temporaryPassword ? '<redacted: console-only>' : null,
        },
    };
    await mkdir(dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(reportForFile, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
}
run().catch((error) => {
    console.error('No pudimos limpiar los datos operativos.', error);
    process.exitCode = 1;
});
//# sourceMappingURL=reset-operational-data.js.map