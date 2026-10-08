/**
 * Shared by the specs: the time of day at a place, and the clocks and places that keep each
 * test on the part of the day it was written for.
 *
 * The e2e server makes synthetic forecasts on the real clock, and from 6pm at a place its pages
 * open on Now with Tomorrow in the middle (core `showsTomorrow`). So a test written for a page
 * that opens on Today would change behaviour whenever CI runs in that place's evening. Each test
 * that relies on the time of day says so:
 * - A test that relies on a page opening on Today calls `keepToday` with the place's time zone
 *   (London for city pages, `ipPlace.tz` for home pages). In the place's evening it starts the
 *   browser's clock earlier that day, and the client then shows Today whatever the server
 *   rendered. A clock behind the server's has no answer for Now, so such tests leave Now alone.
 * - Home pages answer for the approximate (IP) place, which `test` moves with the x-nf-geo
 *   header the Netlify adapter reads in development: to where it is `ipHour` o'clock now (late
 *   morning, or E2E_IP_HOUR). A test that needs a home page in its daytime with Now answering
 *   (browser and server on one clock) sets `test.use({ ipHour: DAYTIME })`; one about the
 *   evening sets an evening hour.
 * - Checks of the server's own markup, and the Tomorrow tests: `cityAt` picks a city in the
 *   right part of its day.
 *
 * Two switches check that the suite passes at any time of day (playwright.config.ts):
 * E2E_IP_HOUR=HH puts the approximate place where it is HH o'clock (e.g. 20, its evening) for
 * every test that does not choose, and E2E_CLOCK=HH:MM runs the whole suite as if it were that
 * time in London: the server's clock moves (clock-shift.mjs), and `test` starts every page's
 * clock with it.
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
 * A time for the browser's clock at which a page for `tz` opens on Today and stays there for a
 * while (a test may move the clock on half an hour): the server's now, or from 5pm at the place
 * (on the server's clock) 4pm there that day.
 */
export function todayTime(tz = LONDON, ms = serverNow()): number {
  const { date, hour } = localTime(tz, ms);
  return hour >= 17 ? atLocal(tz, '16:00', date) : ms;
}

/**
 * For a test that relies on a page opening on Today: in the place's evening, start the browser's
 * clock at `todayTime`, and the client shows Today whatever the server rendered. Earlier in the
 * day the browser keeps the server's clock. Pinned back like this the browser may be too far
 * behind the server for Now to have an answer: tests using this leave Now alone.
 */
export async function keepToday(page: Page, tz = LONDON): Promise<void> {
  const now = serverNow();
  const time = todayTime(tz, now);
  if (time !== now) await startClock(page, time);
}

/** The approximate (IP) place: the x-nf-geo header that puts it there, and its time zone. */
export interface IpPlace {
  geo: string;
  tz: string;
}

/**
 * The approximate location the Netlify adapter reports in development (its own "Mock City"),
 * moved to the longitude where the local time is `hour` o'clock now. It is on the equator, so
 * its time zone is a whole number of hours from UTC (synthetic data: Etc/GMT±n by longitude).
 */
export function ipPlaceAt(hour: number, ms = serverNow()): IpPlace {
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
  return {
    geo: Buffer.from(JSON.stringify(geo)).toString('base64'),
    tz: syntheticTimezone(0, offset * 15),
  };
}

/** Late morning: a home page opens on Today, with Now answering. */
export const DAYTIME = 11;
/** The approximate place's hour for tests that do not choose one: E2E_IP_HOUR, or `DAYTIME`. */
export const IP_HOUR = Number(process.env.E2E_IP_HOUR || DAYTIME);

/**
 * Gets a browser context ready for a test: home pages find their approximate place at `place`,
 * and with E2E_CLOCK the pages' clocks follow the server's.
 */
export async function prepare(context: BrowserContext, place = ipPlaceAt(IP_HOUR)): Promise<void> {
  await context.setExtraHTTPHeaders({ 'x-nf-geo': place.geo });
  if (CLOCK_SHIFT) await startClock(context);
}

/**
 * `test` from Playwright, with every context `prepare`d. A test chooses the approximate place's
 * hour with `test.use({ ipHour })`, and reads where it is from `ipPlace`.
 */
export const test = base.extend<{ ipHour: number; ipPlace: IpPlace }>({
  ipHour: [IP_HOUR, { option: true }],
  ipPlace: async ({ ipHour }, use) => {
    await use(ipPlaceAt(ipHour));
  },
  context: async ({ context, ipPlace }, use) => {
    await prepare(context, ipPlace);
    await use(context);
  },
});
export { expect };

/** One half of the Hot | Wet toggle. */
export const toggle = (page: Page, topic: 'hot' | 'wet') =>
  page.locator(`#topic [data-topic=${topic}]`);

/** Hide or show the page as switching browser tabs does. */
export const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

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
