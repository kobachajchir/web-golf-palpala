import { getAuth, type Auth } from 'firebase-admin/auth';
import type { CustomClaims } from '../../domain/models.js';
import type { AuthGateway } from '../../domain/ports.js';

export async function setCustomClaimsPreservingInternalRoles(
  uid: string,
  claims: CustomClaims,
  auth: Auth = getAuth(),
): Promise<void> {
  const currentUser = await auth.getUser(uid);
  const nextClaims = currentUser.customClaims?.desarrollador === true
    ? { ...claims, desarrollador: true }
    : claims;
  await auth.setCustomUserClaims(uid, nextClaims);
}

export class FirebaseAuthGateway implements AuthGateway {
  public async setCustomClaims(uid: string, claims: CustomClaims): Promise<void> {
    await setCustomClaimsPreservingInternalRoles(uid, claims);
  }
}