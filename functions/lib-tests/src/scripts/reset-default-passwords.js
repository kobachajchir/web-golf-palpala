import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_TEMPORARY_PASSWORD, buildSyntheticAuthEmail, normalizeMemberNumber, } from '../modules/auth/member-number-auth.js';
import { buildCustomClaims, pickPrimaryRoleId } from '../modules/users/application/shared.js';
import { setCustomClaimsPreservingInternalRoles } from '../modules/users/infrastructure/firestore/auth-gateway.js';
import { SYSTEM_ACTOR_UID, USERS_COLLECTIONS } from '../modules/users/domain/constants.js';
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'webgolfclub';
const PAGE_SIZE = 400;
const ADMIN_EMPLOYEE_CODE = 'E001';
const REPORT_PATH = resolve(process.env.RESET_DEFAULT_PASSWORDS_REPORT_PATH
    ?? resolve(process.cwd(), 'seed-reports', `reset-default-passwords-${Date.now()}.json`));
function parseOptions() {
    const args = process.argv.slice(2);
    const projectArg = args.find((arg) => arg.startsWith('--project='));
    const limitArg = args.find((arg) => arg.startsWith('--limit='));
    const execute = args.includes('--execute') && args.includes('--yes-reset-default-passwords');
    const limit = Number(limitArg?.split('=')[1] ?? 0);
    return {
        projectId: projectArg?.split('=')[1]?.trim() || DEFAULT_PROJECT_ID,
        execute,
        limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0,
    };
}
function ensureAdminApp(projectId) {
    if (getApps().length === 0) {
        initializeApp({ projectId });
    }
}
async function listCollectionDocuments(collectionName, limit) {
    const firestore = getFirestore();
    const entries = [];
    let query = firestore.collection(collectionName).orderBy('__name__').limit(PAGE_SIZE);
    for (;;) {
        const remainingLimit = limit > 0 ? limit - entries.length : PAGE_SIZE;
        if (remainingLimit <= 0) {
            break;
        }
        const currentLimit = Math.min(PAGE_SIZE, remainingLimit);
        const snapshot = await query.limit(currentLimit).get();
        if (snapshot.empty) {
            break;
        }
        snapshot.docs.forEach((entry) => {
            entries.push({
                id: entry.id,
                data: entry.data(),
            });
        });
        const lastDocument = snapshot.docs.at(-1);
        if (!lastDocument || snapshot.size < currentLimit) {
            break;
        }
        query = firestore.collection(collectionName).orderBy('__name__').startAfter(lastDocument).limit(PAGE_SIZE);
    }
    return entries;
}
async function getOrCreateAuthUser(params) {
    const auth = getAuth();
    if (!params.execute) {
        return {
            uid: params.uid ?? `dry-run:${params.email}`,
            created: false,
        };
    }
    if (params.uid) {
        try {
            const existingUser = await auth.getUser(params.uid);
            await auth.updateUser(existingUser.uid, {
                email: params.email,
                displayName: params.displayName,
                password: DEFAULT_TEMPORARY_PASSWORD,
                disabled: !params.active,
            });
            return {
                uid: existingUser.uid,
                created: false,
            };
        }
        catch (error) {
            if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'auth/user-not-found') {
                throw error;
            }
        }
    }
    try {
        const existingUser = await auth.getUserByEmail(params.email);
        await auth.updateUser(existingUser.uid, {
            displayName: params.displayName,
            password: DEFAULT_TEMPORARY_PASSWORD,
            disabled: !params.active,
        });
        return {
            uid: existingUser.uid,
            created: false,
        };
    }
    catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'auth/user-not-found') {
            throw error;
        }
    }
    const created = await auth.createUser({
        email: params.email,
        displayName: params.displayName,
        password: DEFAULT_TEMPORARY_PASSWORD,
        disabled: !params.active,
    });
    return {
        uid: created.uid,
        created: true,
    };
}
function isMemberLoginActive(member) {
    return member.status !== 'inactive' && member.status !== 'suspended';
}
function getEmployeeCode(employeeId, employee) {
    return employee.employeeCode?.trim() || `E${employeeId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`;
}
function getDefaultEmployeeRoles(employeeCode) {
    return employeeCode.toUpperCase() === ADMIN_EMPLOYEE_CODE ? ['empleado', 'administrativo'] : ['empleado'];
}
async function resetExistingUser(params) {
    const email = params.user.email ?? '';
    const displayName = params.user.displayName ?? params.uid;
    if (!params.execute) {
        params.report.updatedAuthUsers += 1;
        params.report.updatedFirestoreUsers += 1;
        return;
    }
    try {
        await getAuth().updateUser(params.uid, {
            password: DEFAULT_TEMPORARY_PASSWORD,
            disabled: params.user.active === false,
        });
        await getFirestore().collection(USERS_COLLECTIONS.users).doc(params.uid).update({
            mustChangePassword: true,
            passwordResetRequiredReason: 'staff_reset',
            passwordUpdatedAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        });
        params.report.updatedAuthUsers += 1;
        params.report.updatedFirestoreUsers += 1;
    }
    catch (error) {
        params.report.failedUsers.push({
            key: params.uid,
            displayName,
            email,
            reason: error instanceof Error ? error.message : 'Error desconocido',
        });
    }
}
async function ensureMemberAccess(params) {
    const firestore = getFirestore();
    const normalizedMemberNumber = normalizeMemberNumber(params.member.memberNumber);
    const email = buildSyntheticAuthEmail(normalizedMemberNumber);
    const displayName = `${params.member.firstName} ${params.member.lastName}`.trim() || normalizedMemberNumber;
    const identifierRef = firestore.collection(USERS_COLLECTIONS.memberLoginIdentifiers).doc(normalizedMemberNumber);
    try {
        const identifierSnapshot = await identifierRef.get();
        const identifier = identifierSnapshot.exists
            ? identifierSnapshot.data()
            : null;
        const authUser = await getOrCreateAuthUser({
            uid: params.member.linkedUserId ?? identifier?.uid ?? null,
            email,
            displayName,
            active: isMemberLoginActive(params.member),
            execute: params.execute,
        });
        const userRef = firestore.collection(USERS_COLLECTIONS.users).doc(authUser.uid);
        const userSnapshot = params.execute ? await userRef.get() : null;
        const existingUser = userSnapshot?.exists ? userSnapshot.data() : null;
        const roleIds = Array.from(new Set(existingUser?.roleIds?.length ? existingUser.roleIds : ['socio']));
        const claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;
        const active = isMemberLoginActive(params.member);
        if (params.execute) {
            await userRef.set({
                email,
                displayName,
                primaryRoleId: pickPrimaryRoleId(roleIds),
                roleIds,
                profileType: 'member',
                profileId: params.memberId,
                active,
                claimsVersion,
                memberNumber: normalizedMemberNumber,
                authProviderMode: 'member_number_password',
                mustChangePassword: true,
                passwordResetRequiredReason: 'staff_reset',
                passwordUpdatedAt: FieldValue.delete(),
                createdAt: existingUser?.createdAt ?? FieldValue.serverTimestamp(),
                createdBy: existingUser?.createdBy ?? SYSTEM_ACTOR_UID,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            }, { merge: true });
            await firestore.collection(USERS_COLLECTIONS.members).doc(params.memberId).set({
                linkedUserId: authUser.uid,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            }, { merge: true });
            await identifierRef.set({
                uid: authUser.uid,
                memberId: params.memberId,
                memberNumber: params.member.memberNumber,
                active,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: SYSTEM_ACTOR_UID,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            }, { merge: true });
            await setCustomClaimsPreservingInternalRoles(authUser.uid, buildCustomClaims(roleIds, claimsVersion, active));
        }
        params.report.updatedAuthUsers += authUser.created ? 0 : 1;
        params.report.createdAuthUsers += authUser.created ? 1 : 0;
        params.report.updatedFirestoreUsers += 1;
        params.report.updatedMemberIdentifiers += 1;
    }
    catch (error) {
        params.report.failedUsers.push({
            key: `member:${normalizedMemberNumber}`,
            displayName,
            email,
            reason: error instanceof Error ? error.message : 'Error desconocido',
        });
    }
}
async function ensureEmployeeAccess(params) {
    const firestore = getFirestore();
    const employeeCode = getEmployeeCode(params.employeeId, params.employee);
    const shouldHaveAccess = Boolean(params.employee.linkedUserId) || employeeCode.toUpperCase() === ADMIN_EMPLOYEE_CODE;
    if (!shouldHaveAccess) {
        return;
    }
    const email = buildSyntheticAuthEmail(employeeCode);
    const displayName = `${params.employee.firstName} ${params.employee.lastName}`.trim() || employeeCode;
    try {
        const authUser = await getOrCreateAuthUser({
            uid: params.employee.linkedUserId ?? null,
            email,
            displayName,
            active: params.employee.status === 'active',
            execute: params.execute,
        });
        const userRef = firestore.collection(USERS_COLLECTIONS.users).doc(authUser.uid);
        const userSnapshot = params.execute ? await userRef.get() : null;
        const existingUser = userSnapshot?.exists ? userSnapshot.data() : null;
        const roleIds = Array.from(new Set(existingUser?.roleIds?.length ? existingUser.roleIds : getDefaultEmployeeRoles(employeeCode)));
        const claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;
        const active = params.employee.status === 'active';
        if (params.execute) {
            await userRef.set({
                email,
                displayName,
                primaryRoleId: pickPrimaryRoleId(roleIds),
                roleIds,
                profileType: 'employee',
                profileId: params.employeeId,
                active,
                claimsVersion,
                memberNumber: normalizeMemberNumber(employeeCode),
                authProviderMode: 'member_number_password',
                mustChangePassword: true,
                passwordResetRequiredReason: 'staff_reset',
                passwordUpdatedAt: FieldValue.delete(),
                createdAt: existingUser?.createdAt ?? FieldValue.serverTimestamp(),
                createdBy: existingUser?.createdBy ?? SYSTEM_ACTOR_UID,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            }, { merge: true });
            await firestore.collection(USERS_COLLECTIONS.employees).doc(params.employeeId).set({
                employeeCode,
                linkedUserId: authUser.uid,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            }, { merge: true });
            await setCustomClaimsPreservingInternalRoles(authUser.uid, buildCustomClaims(roleIds, claimsVersion, active));
        }
        params.report.updatedAuthUsers += authUser.created ? 0 : 1;
        params.report.createdAuthUsers += authUser.created ? 1 : 0;
        params.report.updatedFirestoreUsers += 1;
        params.report.updatedEmployeeLinks += 1;
    }
    catch (error) {
        params.report.failedUsers.push({
            key: `employee:${employeeCode}`,
            displayName,
            email,
            reason: error instanceof Error ? error.message : 'Error desconocido',
        });
    }
}
async function run() {
    const options = parseOptions();
    ensureAdminApp(options.projectId);
    const firestore = getFirestore();
    firestore.settings({ ignoreUndefinedProperties: true });
    const [users, members, employees] = await Promise.all([
        listCollectionDocuments(USERS_COLLECTIONS.users, options.limit),
        listCollectionDocuments(USERS_COLLECTIONS.members, options.limit),
        listCollectionDocuments(USERS_COLLECTIONS.employees, options.limit),
    ]);
    const report = {
        ok: true,
        mode: options.execute ? 'execute' : 'dry-run',
        projectId: options.projectId,
        defaultPassword: DEFAULT_TEMPORARY_PASSWORD,
        inspectedUsers: users.length,
        inspectedMembers: members.length,
        inspectedEmployees: employees.length,
        updatedAuthUsers: 0,
        createdAuthUsers: 0,
        updatedFirestoreUsers: 0,
        updatedMemberIdentifiers: 0,
        updatedEmployeeLinks: 0,
        failedUsers: [],
        confirmationRequiredForExecution: '--execute --yes-reset-default-passwords',
        reportPath: REPORT_PATH,
    };
    for (const user of users) {
        await resetExistingUser({
            uid: user.id,
            user: user.data,
            execute: options.execute,
            report,
        });
    }
    for (const member of members) {
        await ensureMemberAccess({
            memberId: member.id,
            member: member.data,
            execute: options.execute,
            report,
        });
    }
    for (const employee of employees) {
        await ensureEmployeeAccess({
            employeeId: employee.id,
            employee: employee.data,
            execute: options.execute,
            report,
        });
    }
    await mkdir(resolve(REPORT_PATH, '..'), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
}
void run().catch((error) => {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`No pudimos resetear las contrasenas por defecto. Motivo: ${message}`);
    process.exitCode = 1;
});
//# sourceMappingURL=reset-default-passwords.js.map