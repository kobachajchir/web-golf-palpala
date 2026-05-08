import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { firestore } from '../../lib/firebase';
import { createWebConverter } from '../users/infrastructure/firestore/converters';
import type {
  EntityWithId,
  ExecutiveBoardMemberDocument,
  ExecutiveBoardTermDocument,
} from './models';

function requireFirestore(): Firestore {
  if (!firestore) {
    throw new Error('Firestore is not initialized in this environment.');
  }

  return firestore;
}

function withId<T extends object>(id: string, data: T): EntityWithId<T> {
  return { id, ...data };
}

export async function getActiveExecutiveBoard(db: Firestore = requireFirestore()): Promise<{
  term: EntityWithId<ExecutiveBoardTermDocument> | null;
  members: Array<EntityWithId<ExecutiveBoardMemberDocument>>;
}> {
  const termsRef = collection(db, 'executive_board_terms').withConverter(
    createWebConverter<ExecutiveBoardTermDocument & DocumentData>(),
  );
  const membersRef = collection(db, 'executive_board_members').withConverter(
    createWebConverter<ExecutiveBoardMemberDocument & DocumentData>(),
  );
  const termSnapshot = await getDocs(query(termsRef, where('active', '==', true), limit(1)));
  const termDoc = termSnapshot.docs[0];

  if (!termDoc) {
    return { term: null, members: [] };
  }

  const membersSnapshot = await getDocs(
    query(
      membersRef,
      where('termId', '==', termDoc.id),
      where('active', '==', true),
      orderBy('order', 'asc'),
    ),
  );

  return {
    term: withId(termDoc.id, termDoc.data() as ExecutiveBoardTermDocument),
    members: membersSnapshot.docs.map((entry) =>
      withId(entry.id, entry.data() as ExecutiveBoardMemberDocument),
    ),
  };
}

export async function getExecutiveBoardTerm(
  termId: string,
  db: Firestore = requireFirestore(),
): Promise<EntityWithId<ExecutiveBoardTermDocument> | null> {
  const termRef = doc(db, 'executive_board_terms', termId).withConverter(
    createWebConverter<ExecutiveBoardTermDocument & DocumentData>(),
  );
  const snapshot = await getDoc(termRef);
  return snapshot.exists() ? withId(snapshot.id, snapshot.data() as ExecutiveBoardTermDocument) : null;
}
