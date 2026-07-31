import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildSyntheticAuthEmail, generateMemberTemporaryPassword, normalizeMemberNumber, } from '../modules/auth/member-number-auth.js';
import { buildCustomClaims, pickPrimaryRoleId } from '../modules/users/application/shared.js';
import { setCustomClaimsPreservingInternalRoles } from '../modules/users/infrastructure/firestore/auth-gateway.js';
import { SYSTEM_ACTOR_UID, USERS_COLLECTIONS } from '../modules/users/domain/constants.js';
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-web-golf-palpala';
const REPORT_PATH = resolve(process.env.TEST_EMPLOYEE_SEED_REPORT_PATH ?? resolve(process.cwd(), 'seed-reports', 'test-employees-seed-report.json'));
const TEST_EMPLOYEES = [
    { id: 'test-empleado-1', employeeCode: 'E001', firstName: 'Administrativo', lastName: 'Club', dni: '90000001', appAccess: true },
    { id: 'test-empleado-2', employeeCode: 'E002', firstName: 'Test', lastName: 'Empleado 2', dni: '90000002', appAccess: false },
    { id: 'test-empleado-3', employeeCode: 'E003', firstName: 'Test', lastName: 'Empleado 3', dni: '90000003', appAccess: false },
];
function ensureAdminApp() {
    if (getApps().length === 0) {
        initializeApp({ projectId: DEFAULT_PROJECT_ID });
    }
}
async function getOrCreateAuthUser(email, displayName, password) {
    const auth = getAuth();
    try {
        const existingUser = await auth.getUserByEmail(email);
        return {
            user: await auth.updateUser(existingUser.uid, {
                displayName,
                disabled: false,
                password,
            }),
            created: false,
        };
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code !== 'auth/user-not-found') {
            throw error;
        }
    }
    return {
        user: await auth.createUser({
            email,
            password,
            displayName,
            disabled: false,
        }),
        created: true,
    };
}
async function getExistingAuthUser(email) {
    try {
        return await getAuth().getUserByEmail(email);
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code !== 'auth/user-not-found') {
            throw error;
        }
    }
    return null;
}
async function run() {
    ensureAdminApp();
    const firestore = getFirestore();
    firestore.settings({ ignoreUndefinedProperties: true });
    const seeded = [];
    for (const employee of TEST_EMPLOYEES) {
        const normalizedLoginCode = normalizeMemberNumber(employee.employeeCode);
        const email = buildSyntheticAuthEmail(employee.employeeCode);
        const displayName = `${employee.firstName} ${employee.lastName}`.trim();
        const generatedPassword = generateMemberTemporaryPassword(employee.employeeCode);
        const defaultPassword = process.env.TEST_EMPLOYEE_DEFAULT_PASSWORD ?? generatedPassword.temporaryPassword;
        const passwordMode = process.env.TEST_EMPLOYEE_DEFAULT_PASSWORD ? 'env-default-password' : 'generated-temporary-password';
        const authUserResult = employee.appAccess
            ? await getOrCreateAuthUser(email, displayName, defaultPassword)
            : { user: await getExistingAuthUser(email), created: false };
        const userRef = authUserResult.user
            ? firestore.collection(USERS_COLLECTIONS.users).doc(authUserResult.user.uid)
            : null;
        const userSnapshot = userRef ? await userRef.get() : null;
        const existingUser = userSnapshot?.exists ? userSnapshot.data() : null;
        const roleIds = employee.appAccess ? ['empleado', 'administrativo'] : [];
        const claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;
        await firestore.runTransaction(async (transaction) => {
            const employeeRef = firestore.collection(USERS_COLLECTIONS.employees).doc(employee.id);
            transaction.set(employeeRef, {
                employeeCode: employee.employeeCode,
                firstName: employee.firstName,
                lastName: employee.lastName,
                dni: employee.dni,
                linkedUserId: employee.appAccess && authUserResult.user ? authUserResult.user.uid : FieldValue.delete(),
                position: employee.appAccess ? 'Administrativo' : 'Empleado de prueba',
                contractType: 'monthly',
                status: 'active',
                startDate: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000-03:00')),
                canSubmitExpenses: false,
                notes: 'Empleado de prueba creado por seed local.',
                createdAt: FieldValue.serverTimestamp(),
                createdBy: SYSTEM_ACTOR_UID,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            }, { merge: true });
            if (employee.appAccess && userRef) {
                transaction.set(userRef, {
                    email,
                    displayName,
                    primaryRoleId: pickPrimaryRoleId(roleIds),
                    roleIds,
                    profileType: 'employee',
                    profileId: employee.id,
                    active: true,
                    claimsVersion,
                    memberNumber: normalizedLoginCode,
                    authProviderMode: 'member_number_password',
                    mustChangePassword: false,
                    passwordResetRequiredReason: null,
                    createdAt: FieldValue.serverTimestamp(),
                    createdBy: SYSTEM_ACTOR_UID,
                    updatedAt: FieldValue.serverTimestamp(),
                    updatedBy: SYSTEM_ACTOR_UID,
                }, { merge: true });
            }
            else if (userRef) {
                transaction.set(userRef, {
                    email,
                    displayName,
                    primaryRoleId: 'empleado',
                    roleIds: [],
                    profileType: 'none',
                    profileId: null,
                    active: false,
                    claimsVersion,
                    memberNumber: null,
                    mustChangePassword: false,
                    passwordResetRequiredReason: null,
                    updatedAt: FieldValue.serverTimestamp(),
                    updatedBy: SYSTEM_ACTOR_UID,
                }, { merge: true });
            }
        });
        if (authUserResult.user) {
            if (employee.appAccess) {
                await setCustomClaimsPreservingInternalRoles(authUserResult.user.uid, buildCustomClaims(roleIds, claimsVersion, true));
            }
            else {
                await getAuth().updateUser(authUserResult.user.uid, { disabled: true });
                await setCustomClaimsPreservingInternalRoles(authUserResult.user.uid, buildCustomClaims([], claimsVersion, false));
            }
        }
        seeded.push({
            employeeId: employee.id,
            employeeCode: employee.employeeCode,
            normalizedLoginCode,
            uid: authUserResult.user?.uid ?? null,
            displayName,
            roleIds,
            authEmail: email,
            authUserCreated: authUserResult.created,
            appAccess: employee.appAccess,
            passwordMode: employee.appAccess ? passwordMode : null,
            passwordGeneratedAt: employee.appAccess && passwordMode === 'generated-temporary-password'
                ? generatedPassword.passwordGeneratedAt
                : null,
            temporaryPassword: employee.appAccess ? defaultPassword : null,
        });
    }
    const report = {
        ok: true,
        projectId: DEFAULT_PROJECT_ID,
        emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST),
        seeded,
    };
    await mkdir(dirname(REPORT_PATH), { recursive: true });
    const reportForFile = {
        ...report,
        seeded: report.seeded.map((entry) => ({
            ...entry,
            temporaryPassword: entry.temporaryPassword ? '<redacted: console-only>' : null,
        })),
    };
    await writeFile(REPORT_PATH, `${JSON.stringify(reportForFile, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
}
void run().catch((error) => {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`No pudimos seedear los empleados de prueba. Motivo: ${message}`);
    process.exitCode = 1;
});
//# sourceMappingURL=seed-test-employees.js.map