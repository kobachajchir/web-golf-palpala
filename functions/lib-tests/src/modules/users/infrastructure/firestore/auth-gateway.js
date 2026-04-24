import { getAuth } from 'firebase-admin/auth';
export class FirebaseAuthGateway {
    async setCustomClaims(uid, claims) {
        await getAuth().setCustomUserClaims(uid, claims);
    }
}
//# sourceMappingURL=auth-gateway.js.map