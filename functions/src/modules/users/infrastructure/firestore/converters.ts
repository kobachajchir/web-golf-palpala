import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  WithFieldValue,
} from 'firebase-admin/firestore';

export function createAdminConverter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(modelObject: WithFieldValue<T>): DocumentData {
      return modelObject as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): T {
      return snapshot.data() as T;
    },
  };
}
