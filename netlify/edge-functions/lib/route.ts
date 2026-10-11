/**
 * Which site a request is for. One deploy serves all three: isithot.today as it is, and
 * isitwet.today and willitsnow.today from the pages under their prefixes (/wet, /snow). Pure and
 * import-free so it runs in the Deno edge runtime and in vitest alike. The hosts and prefixes
 * mirror SITES in packages/core/src/config.ts (a test checks).
 */

/**
 * Each site's host, the prefix its pages live under in this deploy, and the header that makes a
 * deploy preview (or local dev) act as that site. isithot.today's pages are at the root.
 */
export const SITES = {
  hot: { host: 'isithot.today', prefix: '', header: null },
  wet: { host: 'isitwet.today', prefix: '/wet', header: 'x-isitwet-host' },
  snow: { host: 'willitsnow.today', prefix: '/snow', header: 'x-willitsnow-host' },
} as const;

type Site = keyof typeof SITES;
const IDS = Object.keys(SITES) as Site[];

export interface RouteRequest {
  /** The request's hostname, e.g. "isitwet.today". */
  host: string;
  /** The URL path, e.g. "/in/london-gb". */
  pathname: string;
  /** The query string with its "?", or "" (as `URL.search`). */
  search: string;
  /** True on any deploy but production: only then are the sites' headers honoured. */
  preview: boolean;
  /** The request's headers (only the sites' own, such as x-isitwet-host, are read). */
  headers: { get(name: string): string | null };
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
const redirect = (to: string): Route => ({ kind: 'redirect', to, status: 301 });

/** Whether a path is under a prefix: the prefix itself or below it ("/wetter" is not). */
const under = (pathname: string, prefix: string) =>
  !!prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`));

export function route({ host, pathname, search, preview, headers }: RouteRequest): Route {
  // URL.hostname is lower case already; a fully qualified "isitwet.today." is the same host.
  const name = host.toLowerCase().replace(/\.$/, '');

  // www of a prefixed site goes to its own domain (Netlify does this for isithot.today itself).
  const www = IDS.find((s) => SITES[s].prefix && name === `www.${SITES[s].host}`);
  if (www) return redirect(`https://${SITES[www].host}${pathname}${search}`);

  const real = IDS.find((s) => name === SITES[s].host || name === `www.${SITES[s].host}`);
  // Off production a header can make any host act as a site (the first, if several are sent).
  const asked = (s: Site) => {
    const { header } = SITES[s];
    return !!header && headers.get(header) === '1';
  };
  const site = real ?? (preview ? IDS.find(asked) : undefined);
  if (!site) return PASS;

  const other = IDS.find((s) => s !== site && under(pathname, SITES[s].prefix));
  if (other) {
    // A path that belongs to another site: on a real host, go there. A preview serves it as it
    // is (every site lives under its prefix there).
    const rest = pathname.slice(SITES[other].prefix.length) || '/';
    return real ? redirect(`https://${SITES[other].host}${rest}${search}`) : PASS;
  }

  // The function runs again on its own rewrite, so paths under the site's prefix must pass, never
  // redirect: that would loop. Requested directly they serve the same pages, whose canonical
  // URLs omit the prefix.
  const { prefix } = SITES[site];
  if (!prefix || under(pathname, prefix)) return PASS;
  return { kind: 'rewrite', to: `${prefix}${pathname === '/' ? '' : pathname}${search}` };
}
