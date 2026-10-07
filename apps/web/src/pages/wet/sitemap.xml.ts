import type { APIRoute } from 'astro';
import { SITES } from '@isithot/core';
import { sitemapXml } from '../sitemap.xml.ts';

/** isitwet.today/sitemap.xml (served from here by the edge function's rewrite). */
export const GET: APIRoute = () => sitemapXml(SITES.wet.url);
