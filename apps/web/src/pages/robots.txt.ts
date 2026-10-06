import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('/sitemap.xml', site ?? 'https://isithot.today').toString();
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
