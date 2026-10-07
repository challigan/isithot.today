/**
 * The API is served by the Netlify Functions in /functions/api. These Astro routes answer the
 * same URLs with the same handlers, for `astro dev` and as a fallback if the platform ever
 * routes /api/* to the site's server function instead.
 */
import type { APIRoute } from 'astro';
import { handleToday } from '@isithot/server';
import { requestPlatformFrom, via } from '../../../lib/platform';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) =>
  via(await handleToday(request, requestPlatformFrom(locals)), 'astro');
