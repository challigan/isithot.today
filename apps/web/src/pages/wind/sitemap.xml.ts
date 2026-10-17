import type { APIRoute } from 'astro';
import { sitemapXml } from '../sitemap.xml.ts';

/** isitwindy.today/sitemap.xml (served from here by the edge function's rewrite). */
export const GET: APIRoute = () => sitemapXml('wind');
