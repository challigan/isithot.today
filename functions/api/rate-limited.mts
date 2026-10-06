import type { Config } from '@netlify/functions';
import { handleRateLimited } from '@isithot/server';

/** The rate limiter rewrites over-limit requests here so clients get the JSON error envelope. */
export default async (): Promise<Response> => handleRateLimited();

export const config: Config = {
  path: '/api/v1/rate-limited',
};
