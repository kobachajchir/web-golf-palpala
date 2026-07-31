import { getAuth } from 'firebase-admin/auth';
export async function setCustomClaimsPreservingInternalRoles(uid, claims, auth = getAuth()) {
    const currentUser = await auth.getUser(uid);
    const nextClaims = currentUser.customClaims?.desarrollador === true
        ? { ...claims, desarrollador: true }
        : claims;
    await auth.setCustomUserClaims(uid, nextClaims);
}
export class FirebaseAuthGateway {
    async setCustomClaims(uid, claims) {
        await setCustomClaimsPreservingInternalRoles(uid, claims);
    }
}
//# sourceMappingURL=auth-gateway.js.map