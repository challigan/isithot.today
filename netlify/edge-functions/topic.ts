/**
 * Netlify edge function: serves isitwet.today, willitsnow.today and isitwindy.today from the /wet,
 * /snow and /wind pages of this deploy, and sends a path under another site's prefix
 * (isithot.today/wet, isitwet.today/snow, isitwindy.today/snow, …) to that site. The decisions live
 * in ./lib/route.ts (unit-tested); this only applies them. Runs in Deno, so no npm imports, and
 * relative imports keep their extension.
 */
import { route } from './lib/route.ts';

/** The part of Netlify's edge function context used here. */
interface Context {
  /** "production", "deploy-preview", "branch-deploy" or "dev". */
  deploy?: { context?: string };
}

export default (request: Request, context: Context): Response | URL | undefined => {
  const url = new URL(request.url);
  const result = route({
    host: url.hostname,
    pathname: url.pathname,
    search: url.search,
    // Without a deploy context, assume production: the headers must never work there.
    preview: (context.deploy?.context ?? 'production') !== 'production',
    headers: request.headers,
  });
  if (result.kind === 'rewrite') return new URL(result.to, url);
  if (result.kind === 'redirect') return Response.redirect(result.to, result.status);
  return undefined;
};

export const config = {
  path: '/*',
  // Assets, the API, Netlify's own paths and files that are the same on every site.
  excludedPath: ['/_astro/*', '/api/*', '/.netlify/*', '/ads.txt', '/version.json'],
  // If the function fails, serve the request as if it were not here (isithot.today pages).
  onError: 'bypass',
};
