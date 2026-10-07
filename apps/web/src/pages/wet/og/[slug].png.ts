import type { APIRoute } from 'astro';
import { ogImage } from '../../og/[slug].png.ts';

export const prerender = false;

/** isitwet.today/og/<slug>.png (served from here by the edge function's rewrite). */
export const GET: APIRoute = ogImage('wet');
