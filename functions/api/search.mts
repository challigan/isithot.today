import type { Config, Context } from '@netlify/functions';
import { handleSearch } from '@isithot/server';

export default async (request: Request, context: Context): Promise<Response> =>
  handleSearch(request, {
    env: (name) => Netlify.env.get(name),
    deployContext: context.deploy?.context,
    waitUntil: (promise) => context.waitUntil(promise),
  });

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
