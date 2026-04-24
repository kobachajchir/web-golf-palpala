import { getAuth } from 'firebase-admin/auth';
import type { CustomClaims } from '../../domain/models.js';
import type { AuthGateway } from '../../domain/ports.js';

export class FirebaseAuthGateway implements AuthGateway {
  public async setCustomClaims(uid: string, claims: CustomClaims): Promise<void> {
    await getAuth().setCustomUserClaims(uid, claims);
  }
}
