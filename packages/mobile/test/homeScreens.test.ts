import { beforeAll, describe, expect, it } from 'vitest';
import { COPY, SNOW_PALETTES, defaultView, localDateTime } from '@isithot/core';
import { usableUntil } from '@isithot/client';
import { APP_COPY } from '../src/appCopy';
import {
  HOME_SCREENS_PATH,
  UI_TESTS_GENERATED_DIR,
  homeScreensFrom,
  homeScreensJson,
  type HomeScreenJson,
} from '../src/exportHomeScreens';
import { surfacesJson } from '../src/brandColours';
import { UNKNOWN_BAND_DRAWS_AS } from '../src/exportPalettes';
import { FIXTURES, fixtureJson, makeFixture, type Fixture } from '../src/fixtures';
import { fill } from '../src/page';
import { RUNNING_LEAD_MS, homeScreens, vectorFiles, type VectorFile } from '../src/vectors';

const fixtures = new Map<string, Fixture>();
let page: VectorFile;
let screens: HomeScreenJson[];
beforeAll(async () => {
  for (const s of FIXTURES) fixtures.set(s.name, JSON.parse(fixtureJson(await makeFixture(s))));
  page = vectorFiles(fixtures).find((f) => f.name === 'page')!.vectors;
  screens = homeScreensFrom(fixtures, page);
});

// The pages as the file has them: JSON, read loosely here, as the UI tests will.
/* eslint-disable @typescript-eslint/no-explicit-any */
const screen = (name: string): HomeScreenJson => {
  const found = screens.find((s) => s.name === name);
  if (!found) throw new Error(`No screen ${name}`);
  return found;
};
const pages = (name: string): any[] => screen(name).pages as any[];
const own = (name: string): number => Date.parse(fixtures.get(name)!._fixture.now);

describe('HomeScreens.json', () => {
  it('sits in the UI tests’ generated folder', () => {
    expect(HOME_SCREENS_PATH).toBe(`${UI_TESTS_GENERATED_DIR}/HomeScreens.json`);
    expect(UI_TESTS_GENERATED_DIR).toBe('apps/ios/Apps/Snow/UITests/Generated');
  });

  it('gives each screen once, with its pages in the switcher’s order, as page.json has them', () => {
    const names = screens.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(homeScreens(fixtures).map((s) => s.name));
    for (const s of screens) {
      expect(
        (s.pages as any[]).map((p) => p.view),
        s.name,
      ).toEqual(['now', 'today', 'week']);
      for (const p of s.pages as any[]) {
        const found = page.cases.filter(
          (c) =>
            c.fn === 'homePage' &&
            JSON.stringify(c.out) === JSON.stringify(p) &&
            (c.in as any).fixture === s.fixture &&
            (c.in as any).now === Date.parse(s.now) &&
            (c.in as any).phase === s.phase &&
            (c.in as any).without === undefined &&
            (c.in as any).message === undefined &&
            ((c.in as any).placeName ?? null) === s.placeName,
        );
        expect(found, `${s.name} ${p.view}`).toHaveLength(1);
      }
      const bars = page.cases.filter(
        (c) => c.fn === 'homeTopBar' && JSON.stringify(c.out) === JSON.stringify(s.topBar),
      );
      expect(bars.length, s.name).toBeGreaterThan(0);
    }
  });

  it('opens on Today, or on Now from 6pm at the place, as core’s defaultView says', () => {
    for (const s of screens) {
      const res = s.fixture === null ? null : fixtures.get(s.fixture)!;
      expect(s.defaultView, s.name).toBe(defaultView(res, Date.parse(s.now)));
      expect(s.defaultView, s.name).toBe((s.pages as any[])[1].tomorrow ? 'now' : 'today');
    }
    expect(screen('durham-tomorrow').defaultView).toBe('now');
    expect(screen('durham-at-6pm').defaultView).toBe('now');
    expect(screen('durham-before-6pm').defaultView).toBe('today');
    expect(screen('aberdeen-snow').defaultView).toBe('today');
  });

  it('writes each moment as -now reads it: ISO 8601 UTC, to the millisecond', () => {
    for (const s of screens) {
      expect(s.now, s.name).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      expect(new Date(Date.parse(s.now)).toISOString()).toBe(s.now);
    }
  });

  it('has HomeTests’ fixtures at their own moments, each page with its rows', () => {
    for (const name of ['aberdeen-snow', 'durham-tomorrow', 'leeds-dry']) {
      const s = screen(name);
      expect(Date.parse(s.now)).toBe(own(name));
      expect(s.phase).toBe('ready');
      const [now, middle, week] = pages(name);
      for (const p of [now, middle, week]) expect(p.state, `${name} ${p.view}`).toBe('ready');
      expect(now.hours.rows.length).toBeGreaterThan(0);
      expect(middle.day.lines.length).toBeGreaterThan(0);
      expect(week.week.heading).toBe(COPY.nextDays);
      expect(week.week.rows.length).toBe(7);
      expect((s.topBar as any).placeLabel).toBe(
        fill(APP_COPY.placeButtonLabel, { place: fixtures.get(name)!.location.name }),
      );
      // On approximate location: the website's chip, and no line beside it.
      expect((s.topBar as any).approximate).toBeNull();
      expect((s.topBar as any).useMyLocation).toBe(COPY.useExactLocation);
    }
    expect(pages('durham-tomorrow')[1].label).toBe('Tomorrow');
    expect(pages('aberdeen-snow')[1].label).toBe('Today');
  });

  it('has Durham at 5:59pm and 6pm at the place, and two minutes before 6pm', () => {
    const local = (name: string) => localDateTime('Europe/London', new Date(screen(name).now));
    expect(Math.round(local('durham-before-6pm').hours * 60)).toBe(17 * 60 + 59);
    expect(Math.round(local('durham-at-6pm').hours * 60)).toBe(18 * 60);
    expect(
      Date.parse(screen('durham-at-6pm').now) - Date.parse(screen('durham-flip-start').now),
    ).toBe(RUNNING_LEAD_MS);
    expect(RUNNING_LEAD_MS).toBe(120_000);
    expect(Math.round(local('durham-flip-start').hours * 60)).toBe(17 * 60 + 58);
    expect(pages('durham-before-6pm')[1].label).toBe('Today');
    expect(pages('durham-flip-start')).toEqual(pages('durham-before-6pm'));
    expect(pages('durham-at-6pm')[1].label).toBe('Tomorrow');
    expect(pages('durham-at-6pm')[1].heading).toBe(pages('durham-tomorrow')[1].heading);
  });

  it('has the first place under Nearby, a chosen place, answered with the same fixture', () => {
    const s = screen('aberdeen-snow-nearby');
    const nearby = fixtures.get('aberdeen-snow')!.nearby![0]!.name;
    expect(s.placeName).toBe(nearby);
    expect((s.topBar as any).place).toBe(nearby);
    expect((s.topBar as any).approximate).toBeNull();
    for (const p of s.pages as any[]) expect(p.heading.startsWith(`${nearby}. `)).toBe(true);
  });

  it('has OfflineTests’ saved answer an hour on, at its end, and after a failed request', () => {
    const aberdeen = fixtures.get('aberdeen-snow')!;
    const offline = fill(APP_COPY.offline, { time: aberdeen.updated!.clock });
    // An hour on with no connection: the hour ahead's Now, and the offline line.
    const ahead = screen('aberdeen-snow-hour-ahead-offline');
    expect(Date.parse(ahead.now)).toBe(Date.parse(aberdeen.snow!.ahead![0]!.time) + 30 * 60_000);
    expect(pages('aberdeen-snow-hour-ahead-offline')[0].verdict).not.toBe(
      pages('aberdeen-snow')[0].verdict,
    );
    // Its last two minutes, still shown; then at usableUntil, no recent forecast on every page.
    const until = usableUntil(aberdeen);
    expect(Date.parse(screen('aberdeen-snow-last-minutes-offline').now)).toBe(
      until - RUNNING_LEAD_MS,
    );
    expect(Date.parse(screen('aberdeen-snow-past-offline').now)).toBe(until);
    for (const name of ['aberdeen-snow-hour-ahead-offline', 'aberdeen-snow-last-minutes-offline']) {
      for (const p of pages(name)) {
        expect(p.state, `${name} ${p.view}`).toBe('ready');
        expect(p.footer.notice).toBe(offline);
        expect(p.retry).toBeNull();
      }
    }
    for (const p of pages('aberdeen-snow-past-offline')) {
      expect(p.state, p.view).toBe('noRecent');
      expect(p.answer).toBe(APP_COPY.staleApp);
      expect(p.verdict).toBeNull();
      expect(p.footer.notice).toBeNull();
    }
    // A failed request over the answer: it stays, with the unavailable line and Retry.
    const failed = screen('aberdeen-snow-unavailable');
    expect(Date.parse(failed.now)).toBe(own('aberdeen-snow') + 15 * 60_000);
    for (const p of pages('aberdeen-snow-unavailable')) {
      expect(p.state).toBe('ready');
      expect(p.footer.notice).toBe(COPY.unavailable);
      expect(p.retry).toBe(COPY.retry);
    }
    // Nothing saved and no connection: no recent forecast, Retry, and the place not yet known.
    const nothing = screen('nothing-offline');
    expect(nothing.fixture).toBeNull();
    expect((nothing.topBar as any).place).toBe(COPY.locating);
    for (const p of pages('nothing-offline')) {
      expect(p.state).toBe('error');
      expect(p.answer).toBe(APP_COPY.staleApp);
      expect(p.retry).toBe(COPY.retry);
      expect(p.footer).toBeNull();
    }
  });

  it('names a band on every page, or none, which Surfaces.json has a palette for', () => {
    // The contrast proof reads every palette from Surfaces.json, not from here: one source.
    expect(JSON.parse(homeScreensJson(fixtures, page)).palettes).toBeUndefined();
    const palettes = Object.keys(JSON.parse(surfacesJson()).palettes);
    expect(palettes).toEqual(Object.keys(SNOW_PALETTES));
    expect(palettes).toContain(UNKNOWN_BAND_DRAWS_AS);
    for (const s of screens) {
      for (const p of s.pages as any[]) {
        if (p.band !== null) expect(palettes, `${s.name} ${p.view}`).toContain(p.band);
      }
    }
  });

  it('gives the pages PickerTests open the picker over, at the first launch’s moment', () => {
    const first = own('ip-first-launch');
    const byIp = screen('picker-first-launch');
    expect(byIp.fixture).toBe('ip-first-launch');
    expect(Date.parse(byIp.now)).toBe(first);
    expect((byIp.topBar as any).useMyLocation).toBe(COPY.useExactLocation);
    const leeds = screen('picker-leeds');
    expect(leeds.fixture).toBe('leeds-dry');
    expect(Date.parse(leeds.now)).toBe(first);
    // Chosen from a search: a city page, so not approximate.
    expect((leeds.topBar as any).useMyLocation).toBeNull();
    for (const s of [byIp, leeds]) {
      expect(s.defaultView, s.name).toBe('today');
      expect(pages(s.name)[1].band, s.name).toBe('nosnow');
    }
  });

  it('writes a screen to a line, and throws for a screen page.json has no case for', () => {
    const text = homeScreensJson(fixtures, page);
    const lines = text.split('\n');
    expect(lines.slice(0, 3)).toEqual([
      '{',
      '  "source": "page.json (packages/mobile homePage and homeTopBar), by exportHomeScreens.ts",',
      '  "screens": [',
    ]);
    expect(lines.length).toBe(screens.length + 6);
    expect(text.endsWith('\n  ]\n}\n')).toBe(true);
    expect(JSON.parse(text).screens).toEqual(JSON.parse(JSON.stringify(screens)));
    const noBars = { ...page, cases: page.cases.filter((c) => c.fn !== 'homeTopBar') };
    expect(() => homeScreensJson(fixtures, noBars)).toThrow(/0 homeTopBar cases/);
    const noPages = { ...page, cases: page.cases.filter((c) => c.fn !== 'homePage') };
    expect(() => homeScreensJson(fixtures, noPages)).toThrow(/0 homePage cases/);
  });
});
