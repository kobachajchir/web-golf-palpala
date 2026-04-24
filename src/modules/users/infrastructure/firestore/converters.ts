import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  WithFieldValue,
} from 'firebase/firestore';

export function createWebConverter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(modelObject: WithFieldValue<T>): DocumentData {
      return modelObject as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot<DocumentData, DocumentData>, _options?: SnapshotOptions): T {
      return snapshot.data() as T;
    },
  };
}
