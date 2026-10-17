import { describe, expect, it } from 'vitest';
import { SITES as CORE, TOPICS } from '../../packages/core/src/config';
import { SITES, route, type Route, type RouteRequest } from '../edge-functions/lib/route.ts';

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
    headers: new Headers(),
    ...extra,
  };
}

/** Headers asking to act as a site: `{ 'x-isitwet-host': '1' }`. */
const sent = (values: Record<string, string>) => new Headers(values);

const PREVIEW = 'deploy-preview-7--isithotapp.netlify.app';
const overridden = { preview: true, headers: sent({ 'x-isitwet-host': '1' }) };

describe('route', () => {
  it('uses the hosts and prefixes of the sites in core', () => {
    expect(Object.keys(SITES)).toEqual(TOPICS);
    for (const t of TOPICS) {
      expect(`https://${SITES[t].host}`).toBe(CORE[t].url);
      expect(SITES[t].host).toBe(CORE[t].name);
      expect(SITES[t].prefix).toBe(CORE[t].prefix);
    }
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
        expect(landed.origin).toBe(CORE.wet.url);
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
      for (const value of ['0', 'true', 'yes', '']) {
        for (const name of ['x-isitwet-host', 'x-willitsnow-host', 'x-isitwindy-host']) {
          const headers = sent({ [name]: value });
          expect(route(req(PREVIEW, '/', { preview: true, headers }))).toEqual(PASS);
        }
      }
    });
  });

  it('ignores the headers in production', () => {
    for (const name of ['x-isitwet-host', 'x-willitsnow-host', 'x-isitwindy-host']) {
      const headers = sent({ [name]: '1' });
      for (const host of ['isithot.today', 'www.isithot.today', 'isithotapp.netlify.app']) {
        expect(route(req(host, '/', { headers }))).toEqual(PASS);
        expect(route(req(host, '/in/london-gb', { headers }))).toEqual(PASS);
      }
      expect(route(req('isithot.today', '/wet', { headers }))).toEqual(
        redirect('https://isitwet.today/'),
      );
    }
  });

  it('treats the real hosts the same on any deploy', () => {
    expect(route(req('isitwet.today', '/in/london-gb', { preview: true }))).toEqual(
      rewrite('/wet/in/london-gb'),
    );
    expect(route(req('isithot.today', '/wet/in/london-gb', { preview: true }))).toEqual(
      redirect('https://isitwet.today/in/london-gb'),
    );
  });

  describe('willitsnow.today, the third site', () => {
    const snowy = { preview: true, headers: sent({ 'x-willitsnow-host': '1' }) };

    it.each<[string, string]>([
      ['/', '/snow'],
      ['/?lat=51.5&lon=-0.12&name=X', '/snow?lat=51.5&lon=-0.12&name=X'],
      ['/in/london-gb', '/snow/in/london-gb'],
      ['/in/london-gb?units=f', '/snow/in/london-gb?units=f'],
      ['/about', '/snow/about'],
      ['/robots.txt', '/snow/robots.txt'],
      ['/sitemap.xml', '/snow/sitemap.xml'],
      ['/og/london-gb.png', '/snow/og/london-gb.png'],
      ['/favicon.svg', '/snow/favicon.svg'],
      ['/no/such/page', '/snow/no/such/page'],
      ['/snowy', '/snow/snowy'],
      ['/wetter', '/snow/wetter'],
    ])('willitsnow.today%s is served from %s', (path, to) => {
      expect(route(req('willitsnow.today', path))).toEqual(rewrite(to));
      expect(route(req(PREVIEW, path, snowy))).toEqual(rewrite(to));
    });

    it.each(['/snow', '/snow/', '/snow/in/london-gb', '/snow/og/london-gb.png', '/snow?x=1'])(
      'willitsnow.today%s passes, so the rewrite does not loop',
      (path) => {
        expect(route(req('willitsnow.today', path))).toEqual(PASS);
        expect(route(req(PREVIEW, path, snowy))).toEqual(PASS);
      },
    );

    it.each<[string, string]>([
      ['/', 'https://willitsnow.today/'],
      ['/in/london-gb?units=f', 'https://willitsnow.today/in/london-gb?units=f'],
      ['/snow', 'https://willitsnow.today/snow'],
    ])('www.willitsnow.today%s redirects to %s', (path, to) => {
      expect(route(req('www.willitsnow.today', path))).toEqual(redirect(to));
    });

    it('ignores case and a trailing dot in the host', () => {
      expect(route({ ...req('willitsnow.today', '/about'), host: 'WillItSnow.Today.' })).toEqual(
        rewrite('/snow/about'),
      );
      expect(route({ ...req('www.willitsnow.today', '/'), host: 'WWW.WillItSnow.Today' })).toEqual(
        redirect('https://willitsnow.today/'),
      );
    });

    it('with both headers on a preview, acts as the first site (isitwet.today)', () => {
      const headers = sent({ 'x-isitwet-host': '1', 'x-willitsnow-host': '1' });
      expect(route(req(PREVIEW, '/', { preview: true, headers }))).toEqual(rewrite('/wet'));
    });
  });

  describe('isitwindy.today, the fourth site', () => {
    const windy = { preview: true, headers: sent({ 'x-isitwindy-host': '1' }) };

    it.each<[string, string]>([
      ['/', '/wind'],
      ['/?lat=51.5&lon=-0.12&name=X', '/wind?lat=51.5&lon=-0.12&name=X'],
      ['/in/london-gb', '/wind/in/london-gb'],
      ['/in/london-gb?units=c&windUnits=kmh', '/wind/in/london-gb?units=c&windUnits=kmh'],
      ['/about', '/wind/about'],
      ['/places', '/wind/places'],
      ['/robots.txt', '/wind/robots.txt'],
      ['/sitemap.xml', '/wind/sitemap.xml'],
      ['/og/london-gb.png', '/wind/og/london-gb.png'],
      ['/favicon.svg', '/wind/favicon.svg'],
      ['/no/such/page', '/wind/no/such/page'],
      ['/windy', '/wind/windy'],
      ['/windows', '/wind/windows'],
    ])('isitwindy.today%s is served from %s', (path, to) => {
      expect(route(req('isitwindy.today', path))).toEqual(rewrite(to));
      expect(route(req(PREVIEW, path, windy))).toEqual(rewrite(to));
    });

    it.each(['/wind', '/wind/', '/wind/in/london-gb', '/wind/og/london-gb.png', '/wind?x=1'])(
      'isitwindy.today%s passes, so the rewrite does not loop',
      (path) => {
        expect(route(req('isitwindy.today', path))).toEqual(PASS);
        expect(route(req(PREVIEW, path, windy))).toEqual(PASS);
      },
    );

    it.each<[string, string]>([
      ['/', 'https://isitwindy.today/'],
      ['/in/london-gb?windUnits=kmh', 'https://isitwindy.today/in/london-gb?windUnits=kmh'],
      ['/wind', 'https://isitwindy.today/wind'],
    ])('www.isitwindy.today%s redirects to %s', (path, to) => {
      expect(route(req('www.isitwindy.today', path))).toEqual(redirect(to));
    });

    it('ignores case and a trailing dot in the host', () => {
      expect(route({ ...req('isitwindy.today', '/about'), host: 'IsItWindy.Today.' })).toEqual(
        rewrite('/wind/about'),
      );
      expect(route({ ...req('www.isitwindy.today', '/'), host: 'WWW.IsItWindy.Today' })).toEqual(
        redirect('https://isitwindy.today/'),
      );
    });

    it('treats the real host the same on any deploy', () => {
      expect(route(req('isitwindy.today', '/in/london-gb', { preview: true }))).toEqual(
        rewrite('/wind/in/london-gb'),
      );
    });

    it('with several headers on a preview, acts as the first site in table order', () => {
      const both = sent({ 'x-willitsnow-host': '1', 'x-isitwindy-host': '1' });
      expect(route(req(PREVIEW, '/', { preview: true, headers: both }))).toEqual(rewrite('/snow'));
    });

    it('needs the header to act as isitwindy.today on a preview, and never in production', () => {
      expect(route(req(PREVIEW, '/', { preview: true }))).toEqual(PASS);
      for (const host of ['isithot.today', 'isithotapp.netlify.app']) {
        expect(route(req(host, '/', { headers: windy.headers }))).toEqual(PASS);
      }
    });
  });

  describe("a path under another site's prefix", () => {
    it.each<[string, string, string]>([
      ['isithot.today', '/snow', 'https://willitsnow.today/'],
      ['isithot.today', '/snow/', 'https://willitsnow.today/'],
      ['isithot.today', '/snow?lat=51.5&lon=-0.12', 'https://willitsnow.today/?lat=51.5&lon=-0.12'],
      [
        'isithot.today',
        '/snow/in/london-gb?units=f',
        'https://willitsnow.today/in/london-gb?units=f',
      ],
      ['www.isithot.today', '/snow/about', 'https://willitsnow.today/about'],
      ['isitwet.today', '/snow', 'https://willitsnow.today/'],
      ['isitwet.today', '/snow/in/london-gb', 'https://willitsnow.today/in/london-gb'],
      ['isitwet.today', '/snow/og/london-gb.png', 'https://willitsnow.today/og/london-gb.png'],
      ['willitsnow.today', '/wet', 'https://isitwet.today/'],
      ['willitsnow.today', '/wet/in/london-gb', 'https://isitwet.today/in/london-gb'],
      ['willitsnow.today', '/wet?lat=51.5&lon=-0.12', 'https://isitwet.today/?lat=51.5&lon=-0.12'],
      ['willitsnow.today', '/wet//example.com', 'https://isitwet.today//example.com'],
      ['isithot.today', '/wind', 'https://isitwindy.today/'],
      [
        'isithot.today',
        '/wind/in/london-gb?units=c',
        'https://isitwindy.today/in/london-gb?units=c',
      ],
      ['www.isithot.today', '/wind/about', 'https://isitwindy.today/about'],
      ['isitwet.today', '/wind/og/london-gb.png', 'https://isitwindy.today/og/london-gb.png'],
      [
        'willitsnow.today',
        '/wind?lat=51.5&lon=-0.12',
        'https://isitwindy.today/?lat=51.5&lon=-0.12',
      ],
      ['isitwindy.today', '/snow', 'https://willitsnow.today/'],
      ['isitwindy.today', '/wet/in/london-gb', 'https://isitwet.today/in/london-gb'],
      [
        'isitwindy.today',
        '/snow/in/london-gb?units=f',
        'https://willitsnow.today/in/london-gb?units=f',
      ],
      ['isitwindy.today', '/wet//example.com', 'https://isitwet.today//example.com'],
    ])('%s%s redirects to %s', (host, path, to) => {
      expect(route(req(host, path))).toEqual(redirect(to));
      expect(route(req(host, path, { preview: true }))).toEqual(redirect(to));
    });

    it('lands on a page that does not redirect again, from every real host', () => {
      const paths = ['', '/', '?lat=51.5', '/in/london-gb?units=f', '/about', '/x'];
      for (const host of [
        'isithot.today',
        'www.isithot.today',
        'isitwet.today',
        'willitsnow.today',
        'isitwindy.today',
      ]) {
        for (const t of TOPICS) {
          const { prefix } = SITES[t];
          if (!prefix || host.endsWith(SITES[t].host)) continue;
          for (const path of paths.map((p) => `${prefix}${p}`)) {
            const first = route(req(host, path));
            expect(first).toMatchObject({ kind: 'redirect', status: 301 });
            const landed = new URL((first as { to: string }).to);
            expect(landed.origin).toBe(CORE[t].url);
            expect(route(req(landed.host, landed.pathname + landed.search)).kind).toBe('rewrite');
          }
        }
      }
    });

    it("is served as it is on a preview acting as a site (each site's pages are there)", () => {
      expect(route(req(PREVIEW, '/snow/in/london-gb', overridden))).toEqual(PASS);
      const snowy = { preview: true, headers: sent({ 'x-willitsnow-host': '1' }) };
      expect(route(req(PREVIEW, '/wet/in/london-gb', snowy))).toEqual(PASS);
      expect(route(req(PREVIEW, '/wind/in/london-gb', snowy))).toEqual(PASS);
      const windy = { preview: true, headers: sent({ 'x-isitwindy-host': '1' }) };
      expect(route(req(PREVIEW, '/snow/in/london-gb', windy))).toEqual(PASS);
    });
  });
});
