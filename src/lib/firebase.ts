import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import type { Analytics } from 'firebase/analytics';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const REQUIRED_FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

type RequiredFirebaseEnvKey = (typeof REQUIRED_FIREBASE_ENV_KEYS)[number];

function getRequiredFirebaseEnv(key: RequiredFirebaseEnvKey): string {
  const value = import.meta.env[key];

  if (!value) {
    throw new Error(`Missing Firebase environment variable: ${key}`);
  }

  return value;
}

const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID;

export const firebaseConfig: FirebaseOptions = {
  apiKey: getRequiredFirebaseEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getRequiredFirebaseEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getRequiredFirebaseEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getRequiredFirebaseEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getRequiredFirebaseEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getRequiredFirebaseEnv('VITE_FIREBASE_APP_ID'),
  ...(measurementId ? { measurementId } : {}),
};

const isBrowser = typeof window !== 'undefined';

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth: Auth | null = isBrowser ? getAuth(app) : null;
export const firestore: Firestore | null = isBrowser ? getFirestore(app) : null;
export const storage: FirebaseStorage | null = isBrowser ? getStorage(app) : null;

let analyticsPromise: Promise<Analytics | null> | null = null;

export async function getAnalyticsInstance(): Promise<Analytics | null> {
  if (!isBrowser || !measurementId) {
    return null;
  }

  if (!analyticsPromise) {
    analyticsPromise = import('firebase/analytics')
      .then(async ({ getAnalytics, isSupported }) => {
        const analyticsSupported = await isSupported();
        return analyticsSupported ? getAnalytics(app) : null;
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('Firebase Analytics could not be initialized.', error);
        }

        return null;
      });
  }

  return analyticsPromise;
}
