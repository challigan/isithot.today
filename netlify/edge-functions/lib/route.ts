/**
 * Which site a request is for. One deploy serves both: isithot.today as it is, and isitwet.today
 * from the pages under /wet. Pure and import-free so it runs in the Deno edge runtime and in
 * vitest alike. The hostnames mirror SITES in packages/core/src/config.ts (a test checks).
 */

export const HOSTS = { hot: 'isithot.today', wet: 'isitwet.today' } as const;

/** Deploy previews (and local dev) treat requests with this header as if made to isitwet.today. */
export const WET_HOST_HEADER = 'x-isitwet-host';

export interface RouteRequest {
  /** The request's hostname, e.g. "isitwet.today". */
  host: string;
  /** The URL path, e.g. "/in/london-gb". */
  pathname: string;
  /** The query string with its "?", or "" (as `URL.search`). */
  search: string;
  /** True on any deploy but production: only then is the header honoured. */
  preview: boolean;
  /** The value of the x-isitwet-host header, if sent. */
  header: string | null;
}

/**
 * `pass` serves the request as it is. `rewrite` serves `to` (a path and query string) from this
 * deploy without changing the address. `redirect` sends the browser to `to` (an absolute URL).
 */
export type Route =
  | { kind: 'pass' }
  | { kind: 'rewrite'; to: string }
  | { kind: 'redirect'; to: string; status: 301 };

const PASS: Route = { kind: 'pass' };
const WET_PREFIX = '/wet';

const isWetPath = (pathname: string) =>
  pathname === WET_PREFIX || pathname.startsWith(`${WET_PREFIX}/`);

export function route({ host, pathname, search, preview, header }: RouteRequest): Route {
  // URL.hostname is lower case already; a fully qualified "isitwet.today." is the same host.
  const name = host.toLowerCase().replace(/\.$/, '');

  if (name === `www.${HOSTS.wet}`) {
    return { kind: 'redirect', to: `https://${HOSTS.wet}${pathname}${search}`, status: 301 };
  }

  if (name === HOSTS.wet || (preview && header === '1')) {
    // The function runs again on its own rewrite, so /wet paths must pass, never redirect: that
    // would loop. Requested directly they serve the same pages, whose canonical URLs omit /wet.
    if (isWetPath(pathname)) return PASS;
    return { kind: 'rewrite', to: `${WET_PREFIX}${pathname === '/' ? '' : pathname}${search}` };
  }

  if ((name === HOSTS.hot || name === `www.${HOSTS.hot}`) && isWetPath(pathname)) {
    const rest = pathname.slice(WET_PREFIX.length) || '/';
    return { kind: 'redirect', to: `https://${HOSTS.wet}${rest}${search}`, status: 301 };
  }

  return PASS;
}
