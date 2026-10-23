import type { APIRoute } from 'astro';
import { SITES, listed, type Topic } from '@isithot/core';
import { CITIES } from '@isithot/server';

/**
 * A site's pages for search engines, with URLs on the site's own domain (never the deploy URL):
 * home, About, the places page, every city page the site lists (core `listed`) and, on
 * willitsnow.today alone, the snow app's support page (every site's copy is canonical there). No
 * `lastmod` (nothing here knows when a page last changed), `changefreq` or `priority` (Google
 * ignores both).
 */
export const sitemapXml = (topic: Topic): Response => {
  const paths = [
    '/',
    '/about',
    '/places',
    ...(topic === 'snow' ? ['/support'] : []),
    ...CITIES.filter((c) => listed(c, topic)).map((c) => `/in/${c.slug}`),
  ];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths
      .map((p) => `  <url><loc>${new URL(p, SITES[topic].url).toString()}</loc></url>`)
      .join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};

export const GET: APIRoute = () => sitemapXml('hot');
