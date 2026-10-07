import type { APIRoute } from 'astro';
import { handleSearch } from '@isithot/server';
import { platformFrom, via } from '../../../lib/platform';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) =>
  via(await handleSearch(request, platformFrom(locals)), 'astro');
