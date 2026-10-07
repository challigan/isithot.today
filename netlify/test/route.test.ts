import { describe, expect, it } from 'vitest';
import { SITES } from '../../packages/core/src/config';
import { HOSTS, route, type Route, type RouteRequest } from '../edge-functions/lib/route.ts';

const PASS: Route = { kind: 'pass' };
const rewrite = (to: string): Route => ({ kind: 'rewrite', to });
const redirect = (to: string): Route => ({ kind: 'redirect', to, status: 301 });

/** A production request to `host` for `path` (with any query string). */
function req(host: string, path: string, extra: Partial<RouteRequest> = {}): RouteRequest {
  const url = new URL(path, `https://${host}`);
  return {
    host: url.hostname,
    pathname: url.pathname,
    search: url.search,
    preview: false,
    header: null,
    ...extra,
  };
}

const PREVIEW = 'deploy-preview-7--isithotapp.netlify.app';
const overridden = { preview: true, header: '1' };

describe('route', () => {
  it('uses the hostnames of the two sites in core', () => {
    expect(`https://${HOSTS.hot}`).toBe(SITES.hot.url);
    expect(`https://${HOSTS.wet}`).toBe(SITES.wet.url);
    expect(HOSTS.hot).toBe(SITES.hot.name);
    expect(HOSTS.wet).toBe(SITES.wet.name);
  });

  it.each<[string, string]>([
    ['/', '/wet'],
    ['/?lat=51.5&lon=-0.12&name=X', '/wet?lat=51.5&lon=-0.12&name=X'],
    ['/in/london-gb', '/wet/in/london-gb'],
    ['/in/london-gb?units=f', '/wet/in/london-gb?units=f'],
    ['/about', '/wet/about'],
    ['/robots.txt', '/wet/robots.txt'],
    ['/sitemap.xml', '/wet/sitemap.xml'],
    ['/og/london-gb.png', '/wet/og/london-gb.png'],
    ['/favicon.svg', '/wet/favicon.svg'],
    ['/no/such/page', '/wet/no/such/page'],
    ['/wetter', '/wet/wetter'],
  ])('isitwet.today%s is served from %s', (path, to) => {
    expect(route(req('isitwet.today', path))).toEqual(rewrite(to));
  });

  it.each(['/wet', '/wet/', '/wet/in/london-gb', '/wet/og/london-gb.png', '/wet?x=1'])(
    'isitwet.today%s passes, so the rewrite does not loop',
    (path) => {
      expect(route(req('isitwet.today', path))).toEqual(PASS);
    },
  );

  it('passes its own rewrites, and redirects land on pages it serves', () => {
    const paths = ['/', '/?lat=51.5', '/in/london-gb?units=f', '/about', '/wetter', '/wet/x'];
    for (const [host, extra] of [
      ['isitwet.today', {}],
      [PREVIEW, overridden],
    ] as const) {
      for (const path of paths) {
        const first = route(req(host, path, extra));
        if (first.kind === 'rewrite') expect(route(req(host, first.to, extra))).toEqual(PASS);
      }
    }
    for (const host of ['isithot.today', 'www.isithot.today', 'www.isitwet.today']) {
      for (const path of paths.map((p) => `/wet${p}`)) {
        const first = route(req(host, path));
        expect(first).toMatchObject({ kind: 'redirect', status: 301 });
        const landed = new URL((first as { to: string }).to);
        expect(landed.origin).toBe(SITES.wet.url);
        expect(route(req(landed.host, landed.pathname + landed.search)).kind).not.toBe('redirect');
      }
    }
  });

  it.each<[string, string]>([
    ['/', 'https://isitwet.today/'],
    ['/in/london-gb?units=f', 'https://isitwet.today/in/london-gb?units=f'],
    ['/wet', 'https://isitwet.today/wet'],
  ])('www.isitwet.today%s redirects to %s', (path, to) => {
    expect(route(req('www.isitwet.today', path))).toEqual(redirect(to));
  });

  it.each<[string, string]>([
    ['/wet', 'https://isitwet.today/'],
    ['/wet/', 'https://isitwet.today/'],
    ['/wet?lat=51.5&lon=-0.12', 'https://isitwet.today/?lat=51.5&lon=-0.12'],
    ['/wet/in/london-gb', 'https://isitwet.today/in/london-gb'],
    ['/wet/in/london-gb?units=f', 'https://isitwet.today/in/london-gb?units=f'],
    ['/wet/about', 'https://isitwet.today/about'],
    ['/wet/og/london-gb.png', 'https://isitwet.today/og/london-gb.png'],
  ])('isithot.today%s redirects to %s', (path, to) => {
    expect(route(req('isithot.today', path))).toEqual(redirect(to));
    expect(route(req('www.isithot.today', path))).toEqual(redirect(to));
  });

  it.each([
    '/',
    '/?lat=51.5&lon=-0.12',
    '/in/london-gb',
    '/about',
    '/robots.txt',
    '/og/london-gb.png',
    '/no/such/page',
    '/wetter',
  ])('isithot.today%s passes', (path) => {
    expect(route(req('isithot.today', path))).toEqual(PASS);
    expect(route(req('www.isithot.today', path))).toEqual(PASS);
  });

  it('ignores case and a trailing dot in the host', () => {
    expect(route({ ...req('isitwet.today', '/about'), host: 'IsItWet.Today.' })).toEqual(
      rewrite('/wet/about'),
    );
    expect(route({ ...req('isithot.today', '/wet'), host: 'isithot.today.' })).toEqual(
      redirect('https://isitwet.today/'),
    );
  });

  it('keeps an odd path on isitwet.today when redirecting away from /wet', () => {
    // Absolute targets keep a path like //example.com on our own host, never another site.
    expect(route(req('isithot.today', '/wet//example.com'))).toEqual(
      redirect('https://isitwet.today//example.com'),
    );
  });

  describe('on deploy previews and locally', () => {
    it.each([PREVIEW, 'localhost', '127.0.0.1', 'isithotapp.netlify.app'])(
      '%s passes without the header',
      (host) => {
        for (const path of ['/', '/in/london-gb', '/wet', '/wet/in/london-gb', '/robots.txt']) {
          expect(route(req(host, path, { preview: true }))).toEqual(PASS);
          expect(route(req(host, path))).toEqual(PASS);
        }
      },
    );

    it.each([PREVIEW, 'localhost'])('%s with x-isitwet-host: 1 acts as isitwet.today', (host) => {
      expect(route(req(host, '/', overridden))).toEqual(rewrite('/wet'));
      expect(route(req(host, '/?lat=51.5&lon=-0.12&name=X', overridden))).toEqual(
        rewrite('/wet?lat=51.5&lon=-0.12&name=X'),
      );
      expect(route(req(host, '/in/london-gb', overridden))).toEqual(rewrite('/wet/in/london-gb'));
      expect(route(req(host, '/robots.txt', overridden))).toEqual(rewrite('/wet/robots.txt'));
      expect(route(req(host, '/wet', overridden))).toEqual(PASS);
      expect(route(req(host, '/wet/in/london-gb', overridden))).toEqual(PASS);
    });

    it('honours only the value 1', () => {
      for (const header of ['0', 'true', 'yes', '']) {
        expect(route(req(PREVIEW, '/', { preview: true, header }))).toEqual(PASS);
      }
    });
  });

  it('ignores the header in production', () => {
    for (const host of ['isithot.today', 'www.isithot.today', 'isithotapp.netlify.app']) {
      expect(route(req(host, '/', { header: '1' }))).toEqual(PASS);
      expect(route(req(host, '/in/london-gb', { header: '1' }))).toEqual(PASS);
    }
    expect(route(req('isithot.today', '/wet', { header: '1' }))).toEqual(
      redirect('https://isitwet.today/'),
    );
  });

  it('treats the real hosts the same on any deploy', () => {
    expect(route(req('isitwet.today', '/in/london-gb', { preview: true }))).toEqual(
      rewrite('/wet/in/london-gb'),
    );
    expect(route(req('isithot.today', '/wet/in/london-gb', { preview: true }))).toEqual(
      redirect('https://isitwet.today/in/london-gb'),
    );
  });
});
