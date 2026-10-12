import type { APIRoute } from 'astro';
import { sitemapXml } from '../sitemap.xml.ts';

/** willitsnow.today/sitemap.xml (served from here by the edge function's rewrite). */
export const GET: APIRoute = () => sitemapXml('snow');
