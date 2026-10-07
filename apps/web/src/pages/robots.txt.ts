import type { APIRoute } from 'astro';
import { SITES } from '@isithot/core';

/** Everything may be crawled; the sitemap is on the site's own domain, never the deploy URL. */
export const robotsTxt = (site: string): Response =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

export const GET: APIRoute = () => robotsTxt(SITES.hot.url);
