import type { Config, Context } from '@netlify/functions';
import { handleDevices } from '../lib/server.mjs';

/**
 * The apps' notification registrations: PUT registers a device's push token for its places,
 * DELETE forgets it (packages/server devices.ts). Where the connection is (`geo`) stands for where
 * the phone is when it doesn't share its location, as on /api/v1/today.
 */
export default async (request: Request, context: Context): Promise<Response> => {
  const response = await handleDevices(request, {
    env: (name) => Netlify.env.get(name),
    deployContext: context.deploy?.context,
    waitUntil: (promise) => context.waitUntil(promise),
    geo: {
      city: context.geo?.city,
      country: context.geo?.country?.code,
      region: context.geo?.subdivision?.name,
      lat: context.geo?.latitude,
      lon: context.geo?.longitude,
    },
  });
  response.headers.set('x-isithot-via', 'function');
  return response;
};

// Must be a literal: Netlify reads it statically. Mirrors DEVICE_LIMITS.perMinute in
// packages/server devices.ts.
export const config: Config = {
  path: '/api/v1/devices',
  method: ['PUT', 'DELETE'],
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
    action: 'rewrite',
    to: '/api/v1/rate-limited',
  },
};
