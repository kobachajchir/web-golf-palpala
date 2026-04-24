import { getRuntimeEnvironment } from '../../config/runtime.js';
export function buildHealthcheckPayload() {
    return {
        status: 'ok',
        service: 'firebase-functions',
        environment: getRuntimeEnvironment(),
        timestamp: new Date().toISOString(),
    };
}
//# sourceMappingURL=health.service.js.map