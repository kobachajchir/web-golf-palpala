import {
  connectFunctionsEmulator,
  getFunctions,
  type Functions,
} from 'firebase/functions';
import { app, firebaseEmulatorConfig, useFirebaseEmulators } from './firebase';

const emulatorState = globalThis as typeof globalThis & {
  __WEB_GOLF_FIREBASE_FUNCTIONS_EMULATOR_CONNECTED__?: boolean;
};

export function getFirebaseFunctions(functionsInstance?: Functions): Functions {
  if (functionsInstance) {
    return functionsInstance;
  }

  const functionsRef = getFunctions(app);

  if (useFirebaseEmulators && !emulatorState.__WEB_GOLF_FIREBASE_FUNCTIONS_EMULATOR_CONNECTED__) {
    connectFunctionsEmulator(
      functionsRef,
      firebaseEmulatorConfig.functionsHost,
      firebaseEmulatorConfig.functionsPort,
    );
    emulatorState.__WEB_GOLF_FIREBASE_FUNCTIONS_EMULATOR_CONNECTED__ = true;
  }

  return functionsRef;
}
