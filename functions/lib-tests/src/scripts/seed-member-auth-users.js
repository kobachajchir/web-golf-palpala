import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildSyntheticAuthEmail, generateMemberTemporaryPassword, normalizeMemberNumber, } from '../modules/auth/member-number-auth.js';
import { buildCustomClaims, pickPrimaryRoleId } from '../modules/users/application/shared.js';
import { setCustomClaimsPreservingInternalRoles } from '../modules/users/infrastructure/firestore/auth-gateway.js';
import { DEFAULT_MEMBER_TYPES, DEFAULT_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLES, SYSTEM_ACTOR_UID, USERS_COLLECTIONS, } from '../modules/users/domain/constants.js';
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-web-golf-palpala';
const DRY_RUN = process.env.MEMBER_USERS_DRY_RUN === 'true' || process.argv.includes('--dry-run');
const LIMIT = Number(process.env.MEMBER_USERS_LIMIT ?? 0);
const REPORT_PATH = resolve(process.env.MEMBER_USERS_SEED_REPORT_PATH ?? resolve(process.cwd(), 'seed-reports', 'member-auth-users-seed-report.json'));
function ensureAdminApp() {
    if (getApps().length === 0) {
        initializeApp({ projectId: DEFAULT_PROJECT_ID });
    }
}
async function seedReferenceData() {
    const firestore = getFirestore();
    const batch = firestore.batch();
    const roleIds = ['comite_ejecutivo', 'directivo', 'administrativo', 'empleado', 'comision_directiva', 'socio'];
    DEFAULT_ROLES.forEach((role, index) => {
        batch.set(firestore.collection(USERS_COLLECTIONS.roles).doc(roleIds[index] ?? role.name.toLowerCase()), {
            ...role,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
    });
    DEFAULT_PERMISSIONS.forEach((permission) => {
        batch.set(firestore.collection(USERS_COLLECTIONS.permissions).doc(permission.id), {
            ...permission,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
    });
    DEFAULT_ROLE_PERMISSIONS.forEach((rolePermission) => {
        batch.set(firestore.collection(USERS_COLLECTIONS.rolePermissions).doc(rolePermission.id), {
            ...rolePermission,
            grantedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
    });
    DEFAULT_MEMBER_TYPES.forEach((memberType) => {
        batch.set(firestore.collection(USERS_COLLECTIONS.memberTypes).doc(memberType.id), {
            ...memberType,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: SYSTEM_ACTOR_UID,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: SYSTEM_ACTOR_UID,
        }, { merge: true });
    });
    await batch.commit();
}
function memberDisplayName(member) {
    return `${member.firstName} ${member.lastName}`.trim();
}
async function upsertAuthUser(email, displayName, temporaryPassword, linkedUserId) {
    const auth = getAuth();
    if (linkedUserId) {
        try {
            const existingUser = await auth.getUser(linkedUserId);
            await auth.updateUser(existingUser.uid, { displayName, password: temporaryPassword, disabled: false });
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
        const existingUser = await auth.getUserByEmail(email);
        await auth.updateUser(existingUser.uid, { displayName, password: temporaryPassword, disabled: false });
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
    const user = await auth.createUser({
        email,
        password: temporaryPassword,
        displayName,
        disabled: false,
    });
    return {
        uid: user.uid,
        created: true,
    };
}
async function run() {
    ensureAdminApp();
    const firestore = getFirestore();
    firestore.settings({ ignoreUndefinedProperties: true });
    await seedReferenceData();
    const membersSnapshot = await firestore.collection(USERS_COLLECTIONS.members).get();
    const members = membersSnapshot.docs
        .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
        .filter((member) => member.memberNumber?.trim())
        .slice(0, LIMIT > 0 ? LIMIT : undefined);
    const report = {
        ok: true,
        dryRun: DRY_RUN,
        projectId: DEFAULT_PROJECT_ID,
        processed: 0,
        createdAuthUsers: 0,
        updatedUsers: 0,
        skipped: [],
        linked: [],
    };
    for (const member of members) {
        const normalizedMemberNumber = normalizeMemberNumber(member.memberNumber);
        const authEmail = buildSyntheticAuthEmail(normalizedMemberNumber);
        const displayName = memberDisplayName(member);
        const roleIds = ['socio'];
        const generatedPassword = generateMemberTemporaryPassword(normalizedMemberNumber);
        if (DRY_RUN) {
            report.processed += 1;
            report.linked.push({
                memberId: member.id,
                memberNumber: normalizedMemberNumber,
                uid: 'dry-run',
                authEmail,
                temporaryPassword: generatedPassword.temporaryPassword,
                passwordGeneratedAt: generatedPassword.passwordGeneratedAt,
            });
            continue;
        }
        const identifierRef = firestore.collection(USERS_COLLECTIONS.memberLoginIdentifiers).doc(normalizedMemberNumber);
        const identifierSnapshot = await identifierRef.get();
        const identifierData = identifierSnapshot.exists ? identifierSnapshot.data() : null;
        if (identifierData?.memberId && identifierData.memberId !== member.id) {
            report.skipped.push({ memberId: member.id, reason: `memberNumber ${normalizedMemberNumber} ya apunta a ${identifierData.memberId}` });
            continue;
        }
        const authUser = await upsertAuthUser(authEmail, displayName, generatedPassword.temporaryPassword, member.linkedUserId ?? identifierData?.uid ?? null);
        const userRef = firestore.collection(USERS_COLLECTIONS.users).doc(authUser.uid);
        const userSnapshot = await userRef.get();
        const existingUser = userSnapshot.exists ? userSnapshot.data() : null;
        const mergedRoleIds = Array.from(new Set([...(existingUser?.roleIds ?? []), ...roleIds]));
        const claimsVersion = (existingUser?.claimsVersion ?? 0) + 1;
        await firestore.runTransaction(async (transaction) => {
            transaction.set(userRef, {
                email: authEmail,
                displayName,
                primaryRoleId: pickPrimaryRoleId(mergedRoleIds),
                roleIds: mergedRoleIds,
                profileType: 'member',
                profileId: member.id,
                active: true,
                claimsVersion,
                memberNumber: normalizedMemberNumber,
                authProviderMode: 'member_number_password',
                mustChangePassword: true,
                passwordResetRequiredReason: 'initial_default',
                createdAt: FieldValue.serverTimestamp(),
                createdBy: SYSTEM_ACTOR_UID,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            }, { merge: true });
            transaction.update(firestore.collection(USERS_COLLECTIONS.members).doc(member.id), {
                linkedUserId: authUser.uid,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            });
            transaction.set(identifierRef, {
                uid: authUser.uid,
                memberId: member.id,
                memberNumber: normalizedMemberNumber,
                active: true,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: SYSTEM_ACTOR_UID,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: SYSTEM_ACTOR_UID,
            }, { merge: true });
        });
        await setCustomClaimsPreservingInternalRoles(authUser.uid, buildCustomClaims(mergedRoleIds, claimsVersion, true));
        report.processed += 1;
        report.createdAuthUsers += authUser.created ? 1 : 0;
        report.updatedUsers += 1;
        report.linked.push({
            memberId: member.id,
            memberNumber: normalizedMemberNumber,
            uid: authUser.uid,
            authEmail,
            temporaryPassword: generatedPassword.temporaryPassword,
            passwordGeneratedAt: generatedPassword.passwordGeneratedAt,
        });
    }
    await mkdir(resolve(REPORT_PATH, '..'), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
}
void run().catch((error) => {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.error(`No pudimos seedear accesos de socios desde members. Motivo: ${message}`);
    process.exitCode = 1;
});
//# sourceMappingURL=seed-member-auth-users.js.map