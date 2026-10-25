import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPY } from '@isithot/core';
import { APP_COPY } from '../src/appCopy';
import { NOTICES } from '../src/credits';
import { FONT_PATH, FONT_SCRIPT } from '../src/exportFont';
import { cmapCodePoints } from './fontTables';

/**
 * Settings and the pages it opens draw their titles in the answer's face (IsItUI's
 * `TextRole.title`, `BricolageAnswer`, near the website's 750 h1), which is a subset: letters,
 * digits, a little punctuation and the space (`make-answer-font.py`). A title with any other
 * character would draw it in the system's font, mid-word. These are every title the app sets in
 * it: Settings, its three pages, each notice's name, and the mail fallback's two.
 */
const TITLES = [
  APP_COPY.settings,
  COPY.howItWorks,
  APP_COPY.yourPrivacy,
  APP_COPY.credits,
  ...NOTICES.map((n) => n.name),
  APP_COPY.reportAd,
  APP_COPY.contactUs,
];

const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url));

/** The characters `make-answer-font.py` keeps: the text its subsetter is populated with. */
function answerSubset(script: string): Set<string> {
  const match = /subsetter\.populate\(\s*text="([^"\\]*)"\s*\)/.exec(script);
  if (!match) throw new Error(`${FONT_SCRIPT} no longer populates its subset with one string`);
  return new Set(match[1]);
}

/** The characters of `text` that `kept` has no glyph for. */
const missing = (text: string, kept: Set<string>) => [...text].filter((c) => !kept.has(c));

describe("the titles, in the answer's face", () => {
  const subset = answerSubset(repo(FONT_SCRIPT).toString('utf8'));
  const mapped = new Set(
    [...cmapCodePoints(new Uint8Array(repo(FONT_PATH)))].map((c) => String.fromCodePoint(c)),
  );

  it("are the app's nine, as the screens title themselves", () => {
    expect(TITLES).toEqual([
      'Settings',
      'How it works',
      'Your privacy',
      'Credits and licences',
      'Bricolage Grotesque',
      'Google Mobile Ads SDK',
      'Google User Messaging Platform SDK',
      'Report an ad',
      'Contact us',
    ]);
  });

  it("use only characters make-answer-font.py's subset keeps", () => {
    expect([...subset].join('')).toBe(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,'’!?…- ",
    );
    for (const title of TITLES) expect(missing(title, subset), title).toEqual([]);
  });

  it('each have a glyph in the font the app bundles', () => {
    expect(mapped).toEqual(subset);
    for (const title of TITLES) expect(missing(title, mapped), title).toEqual([]);
  });

  it('would fail a title with a letter or a sign the subset leaves out', () => {
    expect(missing('Łódź & Météo-France', subset)).toEqual(['Ł', 'ó', 'ź', '&', 'é', 'é']);
    expect(() => answerSubset('subsetter.populate(text=TEXT)')).toThrow(FONT_SCRIPT);
  });
});
