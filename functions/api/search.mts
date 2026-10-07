import type { Config, Context } from '@netlify/functions';
import { handleSearch } from '../lib/server.mjs';

export default async (request: Request, context: Context): Promise<Response> => {
  const response = await handleSearch(request, {
    env: (name) => Netlify.env.get(name),
    deployContext: context.deploy?.context,
    waitUntil: (promise) => context.waitUntil(promise),
  });
  response.headers.set('x-isithot-via', 'function');
  return response;
};

export const config: Config = {
  path: '/api/v1/search',
  method: 'GET',
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
    action: 'rewrite',
    to: '/api/v1/rate-limited',
  },
};
