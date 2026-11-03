/**
 * The server's markup holds exactly the words the browser script writes into it (scripts/app.ts
 * `setText`), with no spacing around them. `setText` leaves words that are already there, so that
 * Today's live region is not read out again, and spacing around the server's words stayed in the
 * page whenever the browser's were the same, which depends on the hour: in PR #52's Playwright run
 * 41540438751 a home page's placeholder verdict kept its spacing (" It's warm, not hot. ") under
 * an answer with that verdict. Checked without JavaScript, so the page is the server's alone:
 * each site's home page (its loading state) and a city page in its daytime (Today) and in its
 * evening (Now, with Tomorrow in the middle).
 */
import { readFileSync } from 'node:fs';
import { SITES, TOPICS } from '../packages/core/src/config';
import { VIEWS } from '../packages/core/src/copy';
import { cityAt, expect, test } from './helpers';

/** Every view's lines: Today's ids are bare ("answer"), the others' prefixed ("now-answer"). */
const LINES = ['question', 'answer', 'verdict', 'detail'] as const;
const VIEW_IDS = VIEWS.flatMap((v) => LINES.map((key) => (v === 'today' ? key : `${v}-${key}`)));

/** Every element `setText` puts words in (the first test keeps this in step with app.ts). */
const IDS = [
  ...VIEW_IDS,
  'place',
  'agree',
  'smin',
  'smax',
  'strip-summary',
  'now-h',
  'week-h',
  'tab-today',
  'updated-at',
];

test('the list names every element setText writes into', () => {
  const app = readFileSync(new URL('../apps/web/src/scripts/app.ts', import.meta.url), 'utf8');
  // Each call's first argument: a quoted id, or each view's lines in renderPanel's loop.
  const args = [...app.matchAll(/(?<!function )\bsetText\((\w+\([^)]*\)|[^,]+),/g)].map((m) =>
    m[1]!.trim(),
  );
  const loop = app.match(
    /for \(const key of \[([^\]]*)\] as const\) \{\s*setText\(viewId\(d\.view, key\)/,
  );
  expect(loop?.[1]?.match(/[a-z-]+/g), "renderPanel's loop writes each view's lines").toEqual([
    ...LINES,
  ]);
  const ids = args.flatMap((arg) =>
    arg === 'viewId(d.view, key)'
      ? VIEW_IDS
      : [/^'([^']+)'$/.exec(arg)?.[1] ?? `a call this test cannot read: setText(${arg}, …)`],
  );
  expect([...new Set(ids)].sort()).toEqual([...IDS].sort());
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const topic of TOPICS) {
    const prefix = SITES[topic].prefix;
    test(`${prefix || '/'}: the server's words have no spacing around them`, async ({
      page,
      request,
    }) => {
      const day = await cityAt(request, '10:00', '15:30');
      const evening = await cityAt(request, '18:15', '22:15');
      const found: Record<string, string[]> = {};
      for (const path of [
        prefix || '/',
        `${prefix}/in/${day.slug}`,
        `${prefix}/in/${evening.slug}`,
      ]) {
        await page.goto(path);
        const padded = await page.evaluate(
          (ids) =>
            ids.flatMap((id) => {
              const el = document.getElementById(id);
              if (!el) return [`#${id} is missing`];
              const text = el.textContent ?? '';
              return text === text.trim() ? [] : [`#${id}: ${JSON.stringify(text)}`];
            }),
          IDS,
        );
        if (padded.length) found[path] = padded;
      }
      expect(found).toEqual({});
    });
  }
});
