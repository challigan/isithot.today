/**
 * Shared by the specs: the time of day at a place, and the clocks and places that keep each
 * test on the part of the day it was written for.
 *
 * The e2e server makes synthetic forecasts on the real clock, and from 6pm at a place its pages
 * open on Now with Tomorrow in the middle (core `showsTomorrow`). So a test written for a page
 * that opens on Today would change behaviour whenever CI runs in that place's evening. Each kind
 * of test is kept on its slot a different way:
 * - Home pages (`test` below): the approximate (IP) place is moved to wherever it is late morning
 *   now, with the x-nf-geo header the Netlify adapter reads in development. Browser and server
 *   stay on the same clock, so "now" and the rest of the page are as a visitor sees them.
 * - City pages of fixed places (London, Bristol): `keepToday` starts the browser clock at 5pm
 *   there from 5:30pm on, and the client then shows Today whatever the server rendered.
 * - Checks of the server's own markup, and the Tomorrow tests: `cityAt` picks a city in the
 *   right part of its day.
 *
 * E2E_CLOCK=HH:MM runs the whole suite as if it were that time in London (playwright.config.ts):
 * the server's clock moves (clock-shift.mjs), and `test` starts every page's clock with it.
 */
import { readFileSync } from 'node:fs';
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { GRID } from '../packages/core/src/config';
import { roundToGrid } from '../packages/core/src/geo';
import { syntheticTimezone } from '../packages/providers/src/synthetic';
import type { TodayResponse } from '../packages/core/src/types';
import { LONDON, atLocal, localTime, minutes, serverNow, CLOCK_SHIFT } from './time';

export { LONDON, atLocal, localTime, serverNow, CLOCK_SHIFT };

/**
 * Starts the browser's clock at `time` (default: the server's now). It runs on in real time from
 * there, and the test can move it on (`page.clock.runFor`, `fastForward`).
 */
export async function startClock(target: Page | BrowserContext, time = serverNow()): Promise<void> {
  await target.clock.install({ time });
}

/** Starts the browser's clock at `hhmm` at the place, on the place's date on the server. */
export async function pinLocalTime(
  target: Page | BrowserContext,
  tz: string,
  hhmm: string,
  date?: string,
): Promise<number> {
  const time = atLocal(tz, hhmm, date);
  await startClock(target, time);
  return time;
}

/**
 * For a test of a city page that expects it to open on Today: from 5:30pm at the place (on the
 * server's clock), start the browser at 5pm there, and the client shows Today whatever the
 * server rendered. Earlier in the day the browser keeps the server's clock. Pinned back like
 * this the browser may be too far behind the server for Now to have an answer: tests using this
 * do not look at Now.
 */
export async function keepToday(page: Page, tz = LONDON): Promise<void> {
  const { hour, minute } = localTime(tz);
  if (hour * 60 + minute >= minutes('17:30')) await pinLocalTime(page, tz, '17:00');
}

/**
 * The approximate location the Netlify adapter reports in development (its own "Mock City"),
 * moved to the longitude where the local time is `hour` o'clock now. It is on the equator, so
 * its time zone is a whole number of hours from UTC (synthetic data: Etc/GMT±n by longitude).
 */
export function ipPlaceAt(hour: number, ms = serverNow()): string {
  let offset = hour - new Date(ms).getUTCHours();
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  const geo = {
    city: 'Mock City',
    country: { code: 'mock', name: 'Mock Country' },
    subdivision: { code: 'SD', name: 'Mock Subdivision' },
    latitude: 0,
    longitude: offset * 15,
  };
  return Buffer.from(JSON.stringify(geo)).toString('base64');
}

/**
 * Gets a browser context ready for a test: home pages find their approximate place where it is
 * late morning, and with E2E_CLOCK the pages' clocks follow the server's.
 */
export async function prepare(context: BrowserContext): Promise<void> {
  await context.setExtraHTTPHeaders({ 'x-nf-geo': ipPlaceAt(11) });
  if (CLOCK_SHIFT) await startClock(context);
}

/** `test` from Playwright, with every context `prepare`d. */
export const test = base.extend({
  context: async ({ context }, use) => {
    await prepare(context);
    await use(context);
  },
});
export { expect };

interface CityRow {
  slug: string;
  name: string;
  lat: number;
  lon: number;
}

const CITIES = JSON.parse(
  readFileSync(new URL('../data/cities.json', import.meta.url), 'utf8'),
) as CityRow[];

export interface CityAt {
  slug: string;
  name: string;
  tz: string;
  /** The page's answer, as the API gives it now. */
  data: TodayResponse;
}

/**
 * A city page where the local time (on the server's clock) is from `from` up to `to` (HH:MM, the
 * same day), the first in the city list (London first). The city list spans enough time zones
 * that a window of four hours always has one.
 */
export async function cityAt(
  request: APIRequestContext,
  from: string,
  to: string,
): Promise<CityAt> {
  const inWindow = (tz: string): boolean => {
    const { hour, minute } = localTime(tz);
    const m = hour * 60 + minute;
    return m >= minutes(from) && m < minutes(to);
  };
  // The server answers for the city's point on its forecast grid.
  const zone = (c: CityRow) =>
    syntheticTimezone(roundToGrid(c.lat, GRID.forecast), roundToGrid(c.lon, GRID.forecast));
  for (const city of CITIES.filter((c) => inWindow(zone(c)))) {
    const res = await request.get(`/api/v1/today?place=${city.slug}&units=c`);
    const data = (await res.json()) as TodayResponse;
    // Trust the server's time zone over the guess (and skip a city whose zone was misjudged).
    if (!res.ok() || !inWindow(data.location.timezone)) continue;
    return { slug: city.slug, name: city.name, tz: data.location.timezone, data };
  }
  throw new Error(`No city page between ${from} and ${to} local time`);
}
