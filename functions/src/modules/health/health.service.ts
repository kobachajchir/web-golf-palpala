import { getRuntimeEnvironment, type RuntimeEnvironment } from '../../config/runtime.js';

export interface HealthcheckPayload {
  status: 'ok';
  service: 'firebase-functions';
  environment: RuntimeEnvironment;
  timestamp: string;
}

export function buildHealthcheckPayload(): HealthcheckPayload {
  return {
    status: 'ok',
    service: 'firebase-functions',
    environment: getRuntimeEnvironment(),
    timestamp: new Date().toISOString(),
  };
}
