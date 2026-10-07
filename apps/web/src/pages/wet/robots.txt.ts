import type { APIRoute } from 'astro';
import { SITES } from '@isithot/core';
import { robotsTxt } from '../robots.txt.ts';

/** isitwet.today/robots.txt (served from here by the edge function's rewrite). */
export const GET: APIRoute = () => robotsTxt(SITES.wet.url);
