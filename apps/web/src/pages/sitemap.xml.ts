import type { APIRoute } from 'astro';
import { CITIES } from '@isithot/server';

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://isithot.today');
  const urls = [
    { path: '/', priority: '1.0', freq: 'hourly' },
    { path: '/about', priority: '0.5', freq: 'monthly' },
    ...CITIES.map((c) => ({ path: `/in/${c.slug}`, priority: '0.8', freq: 'daily' })),
  ];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          `  <url><loc>${new URL(u.path, base).toString()}</loc><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`,
      )
      .join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
