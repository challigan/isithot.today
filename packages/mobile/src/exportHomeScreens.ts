/**
 * What the app's UI tests expect each screen they open to show (phase 5.4), from `page.json`:
 * `HomeScreens.json` in the UI test bundle, so a test reads the question, the answer, the verdict
 * and every row's label from the TypeScript reference instead of typing them. Each screen
 * (`homeScreens`, vectors.ts) names its fixture, the moment its clock reads, as `-now` takes it,
 * and how its request went; its pages are page.json's `homePage` cases for those inputs, Now,
 * the middle view and This week in the switcher's order, as they are there, its top bar the
 * `homeTopBar` case, and the view it opens on core `defaultView`'s. A screen page.json has no
 * case for throws, so the two can't part. Each page's band names the palette it is drawn in,
 * which `Surfaces.json` (brandColours.ts `surfacesJson`) gives the UI tests with the surfaces'
 * models: one file for every colour the tests' contrast proof reads.
 */
import { defaultView, type View } from '@isithot/core';
import type { PagePhase } from './page';
import {
  homeScreens,
  screenTopBar,
  type FixtureSet,
  type VectorCase,
  type VectorFile,
} from './vectors';

/** The UI tests' generated files: only this one. */
export const UI_TESTS_GENERATED_DIR = 'apps/ios/Apps/Snow/UITests/Generated';

export const HOME_SCREENS_PATH = `${UI_TESTS_GENERATED_DIR}/HomeScreens.json`;

/** The views in the switcher's order. */
const VIEWS = ['now', 'today', 'week'] as const;

/** One screen as the UI tests read it. */
export interface HomeScreenJson {
  name: string;
  fixture: string | null;
  /** ISO 8601 UTC, to the millisecond: the `-now` the test launches with. */
  now: string;
  phase: PagePhase;
  placeName: string | null;
  /** The view the app opens on at `now` (core `defaultView`): Today, or Now from 6pm. */
  defaultView: View;
  /** page.json's `homeTopBar` case's output. */
  topBar: unknown;
  /** page.json's `homePage` cases' outputs: Now, the middle view, This week. */
  pages: unknown[];
}

/** Whether a case's input is the one asked for, field by field, with nothing more. */
function sameInput(c: VectorCase, input: Record<string, unknown>): boolean {
  const have = c.in;
  const keys = new Set([...Object.keys(have), ...Object.keys(input)]);
  return [...keys].every((key) => JSON.stringify(have[key]) === JSON.stringify(input[key]));
}

/** The one case of `fn` in `page` with `input`; throws when there is none, or more than one. */
function caseFor(page: VectorFile, fn: string, input: Record<string, unknown>): VectorCase {
  const found = page.cases.filter((c) => c.fn === fn && sameInput(c, input));
  if (found.length !== 1) {
    throw new Error(`page.json has ${found.length} ${fn} cases for ${JSON.stringify(input)}`);
  }
  return found[0]!;
}

/** Every screen the UI tests open, with what page.json says each shows. */
export function homeScreensFrom(fixtures: FixtureSet, page: VectorFile): HomeScreenJson[] {
  return homeScreens(fixtures).map((screen) => {
    const pages = VIEWS.map(
      (view) =>
        caseFor(page, 'homePage', {
          fixture: screen.fixture,
          now: screen.now,
          phase: screen.phase,
          ...(screen.placeName === undefined ? {} : { placeName: screen.placeName }),
          view,
        }).out,
    );
    const res = screen.fixture === null ? null : (fixtures.get(screen.fixture) ?? null);
    return {
      name: screen.name,
      fixture: screen.fixture,
      now: new Date(screen.now).toISOString(),
      phase: screen.phase,
      placeName: screen.placeName ?? null,
      defaultView: defaultView(res, screen.now),
      topBar: caseFor(page, 'homeTopBar', screenTopBar(fixtures, screen)).out,
      pages,
    };
  });
}

/** `HomeScreens.json`: a screen to a line, so a changed screen is a changed line. */
export function homeScreensJson(fixtures: FixtureSet, page: VectorFile): string {
  const screens = homeScreensFrom(fixtures, page);
  return [
    '{',
    '  "source": "page.json (packages/mobile homePage and homeTopBar), by exportHomeScreens.ts",',
    '  "screens": [',
    screens.map((s) => `    ${JSON.stringify(s)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}
