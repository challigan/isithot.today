/**
 * Today's rain, snow and wind answers are for the rest of the day from the hour they were worked
 * out, and from 6pm a page shows tomorrow: nothing that carries them may be served from the CDN
 * past the next forecast hour, whether fresh (max-age) or stale while it revalidates.
 */
import { expect, serverNow, test } from './helpers';

const HOUR = 60 * 60 * 1000;

/** Seconds to the next hour on the server's clock: the synthetic forecasts are hourly. */
const toNextHour = () => Math.ceil((HOUR - (serverNow() % HOUR)) / 1000);

for (const path of [
  '/api/v1/today?place=london-gb&units=c',
  '/in/london-gb',
  '/wet/in/london-gb',
  '/wet/og/london-gb.png',
  '/snow/in/london-gb',
  '/snow/og/london-gb.png',
  '/wind/in/london-gb',
  '/wind/og/london-gb.png',
  '/api/v1/today?place=london-gb&units=c&windUnits=kmh',
]) {
  test(`${path} is not served from the CDN past the forecast hour`, async ({ request }) => {
    // Worked out before asking, so the server's own count can only be smaller.
    const left = toNextHour();
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    const cdn = res.headers()['netlify-cdn-cache-control'] ?? '';
    const m = /max-age=(\d+), stale-while-revalidate=(\d+)/.exec(cdn);
    expect(m, cdn).not.toBeNull();
    const [maxAge, swr] = [Number(m![1]), Number(m![2])];
    // A minute at least, even in the last seconds of the hour.
    expect(maxAge + swr, cdn).toBeLessThanOrEqual(Math.max(60, left));
    expect(
      Number(/max-age=(\d+)/.exec(res.headers()['cache-control'] ?? '')?.[1]),
    ).toBeLessThanOrEqual(Math.max(60, left));
  });
}
