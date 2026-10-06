import type { Config, Context } from '@netlify/functions';
import { handleToday } from '../lib/server.mjs';

export default async (request: Request, context: Context): Promise<Response> => {
  const response = await handleToday(request, {
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

// Must be a literal: Netlify reads it statically. Mirrors RATE_LIMIT in packages/core/config.ts.
export const config: Config = {
  path: '/api/v1/today',
  method: 'GET',
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
    action: 'rewrite',
    to: '/api/v1/rate-limited',
  },
};
