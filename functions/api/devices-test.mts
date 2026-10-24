import type { Config, Context } from '@netlify/functions';
import { handleDeviceTest } from '../lib/server.mjs';

/**
 * "Send a test notification": one notification now for a registered device's place
 * (packages/server devices.ts).
 */
export default async (request: Request, context: Context): Promise<Response> => {
  const response = await handleDeviceTest(request, {
    env: (name) => Netlify.env.get(name),
    deployContext: context.deploy?.context,
    waitUntil: (promise) => context.waitUntil(promise),
  });
  response.headers.set('x-isithot-via', 'function');
  return response;
};

// Must be a literal: Netlify reads it statically. Mirrors DEVICE_LIMITS.perMinute in
// packages/server devices.ts.
export const config: Config = {
  path: '/api/v1/devices/test',
  method: 'POST',
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
    action: 'rewrite',
    to: '/api/v1/rate-limited',
  },
};
