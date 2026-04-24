import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { buildHealthcheckPayload } from './health.service.js';

export const healthcheck = onRequest({ cors: true }, (request, response) => {
  if (request.method !== 'GET') {
    response.set('Allow', 'GET');
    response.status(405).json({
      error: 'Method Not Allowed',
    });
    return;
  }

  const payload = buildHealthcheckPayload();
  logger.info('Healthcheck requested', {
    method: request.method,
    environment: payload.environment,
  });

  response.status(200).json(payload);
});
