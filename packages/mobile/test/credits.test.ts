import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALERTS, COPY, CREDIT_LINKS, MODELS, MODEL_AGENCIES } from '@isithot/core';
import { APP_COPY } from '../src/appCopy';
import { DATA_CREDITS, LICENCES_DIR, NOTICES, modelAgencies } from '../src/credits';
import {
  CREDITS_PATH,
  CREDITS_SOURCE,
  creditsSwift,
  swiftLabelledCall,
} from '../src/exportCredits';
import { generatedHeader } from '../src/swift';

const root = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The words that would name another weather type, website or app (spec 10.8). */
const OTHER =
  /\b(websites?|isithot|isitwet|isitwindy|hot|wet|wind|windy|rain|rainy|rainfall|android)\b/i;

describe('the credits beyond core', () => {
  it("names who runs each model, as the About page does, from core's MODELS", () => {
    expect(modelAgencies()).toBe(
      'ECMWF, NOAA (GFS), DWD (ICON), the Met Office (UKMO), Météo-France and ' +
        'Environment and Climate Change Canada (GEM)',
    );
    for (const m of MODELS) expect(modelAgencies()).toContain(MODEL_AGENCIES[m.id]!);
  });

  it("credits the climate records for snowfall, after core's own words, and the place names", () => {
    expect(DATA_CREDITS.map((c) => c.text)).toEqual([
      'Climate data: NASA POWER (Prediction Of Worldwide Energy Resources), long-term monthly ' +
        'averages of snowfall from the NASA Langley Research Center (LaRC) POWER Project, ' +
        'licensed under CC BY 4.0',
      'Place names: GeoNames, licensed under CC BY 4.0',
    ]);
    expect(DATA_CREDITS[0]!.text.startsWith(COPY.climateCredit)).toBe(true);
    // The licences are linked by core's list, as in the footer; GeoNames by its own.
    expect(CREDIT_LINKS.map((l) => l.phrase)).toEqual(
      expect.arrayContaining(['CC BY 4.0', 'NASA POWER']),
    );
    expect(DATA_CREDITS[1]!.links).toEqual([
      { phrase: 'GeoNames', url: 'https://www.geonames.org/' },
    ]);
  });

  it('lists the typeface and both of Google’s SDKs, naming no other weather, site or app', () => {
    expect(NOTICES.map((n) => n.name)).toEqual([
      'Bricolage Grotesque',
      'Google Mobile Ads SDK',
      'Google User Messaging Platform SDK',
    ]);
    // The typeface is the whole app's, not only the answer's, since the app sets its words in it.
    expect(NOTICES[0]!.summary).toBe(
      "The app's typeface. Copyright 2022 The Bricolage Grotesque Project Authors, licensed " +
        'under the SIL Open Font License, Version 1.1.',
    );
    for (const text of [
      modelAgencies(),
      ...DATA_CREDITS.map((c) => c.text),
      ...NOTICES.flatMap((n) => [n.name, n.summary]),
    ]) {
      expect(text).not.toMatch(OTHER);
      expect(text).not.toMatch(/^\s|\s$| {2}/);
    }
  });
});

describe('the bundled notices', () => {
  const files = readdirSync(new URL(`${LICENCES_DIR}/`, root)).filter((f) => !f.startsWith('.'));

  it('are one file per notice, and nothing else', () => {
    expect(files.sort()).toEqual(NOTICES.map((n) => `${n.file}.txt`).sort());
  });

  it("are the typeface's licence, word for word as its package has it", () => {
    const pnpm = readdirSync(new URL('node_modules/.pnpm/', root)).filter((name) =>
      name.startsWith('@fontsource-variable+bricolage-grotesque@'),
    );
    expect(pnpm).toHaveLength(1);
    const licence = read(
      `node_modules/.pnpm/${pnpm[0]}/node_modules/@fontsource-variable/bricolage-grotesque/LICENSE`,
    );
    expect(read(`${LICENCES_DIR}/BricolageGrotesque-OFL.txt`)).toBe(licence);
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
    expect(licence).toContain('Copyright 2022 The Bricolage Grotesque Project Authors');
  });

  it("are Google's packages' LICENSE files, at the revisions Package.resolved pins", () => {
    // Copied from the checkouts of the pinned revisions; a new pin means copying them again.
    const resolved = JSON.parse(read('apps/ios/Package.resolved')) as {
      pins: { identity: string; location: string; state: { revision: string } }[];
    };
    const pins = Object.fromEntries(resolved.pins.map((p) => [p.identity, p]));
    const google = [
      [
        'Google-Mobile-Ads-LICENSE',
        'swift-package-manager-google-mobile-ads',
        'd1fa1f5c1dfe3b43d56c73f4de388ad3316618bc',
      ],
      [
        'Google-UMP-LICENSE',
        'swift-package-manager-google-user-messaging-platform',
        '13b248eaa73b7826f0efb1bcf455e251d65ecb1b',
      ],
    ] as const;
    for (const [file, identity, revision] of google) {
      const text = read(`${LICENCES_DIR}/${file}.txt`);
      expect(sha256(text), file).toBe(
        'fd112c80352fc42a60f051012c6b9adef055123e395dece30fa8f44880f39e96',
      );
      expect(text.trimStart().startsWith('Apache License')).toBe(true);
      expect(text).toContain('Copyright 2021 Google LLC');
      expect(pins[identity]!.state.revision).toBe(revision);
      const notice = NOTICES.find((n) => n.file === file)!;
      expect(`${notice.url}.git`).toBe(pins[identity]!.location);
    }
  });
});

describe('creditsSwift', () => {
  const swift = creditsSwift();

  it('goes into IsItModel, with the header first', () => {
    expect(CREDITS_PATH).toBe(
      'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/AppCredits.swift',
    );
    expect(swift.split('\n')[0]).toBe(generatedHeader(CREDITS_SOURCE));
    expect(swift.endsWith('}\n')).toBe(true);
  });

  it('writes the agencies, the data credits and the notices, in order', () => {
    expect(swift).toContain(`  public static let modelAgencies =\n    "${modelAgencies()}"\n`);
    expect(swift).toContain(
      '    DataCredit(\n' +
        '      text: "Place names: GeoNames, licensed under CC BY 4.0",\n' +
        '      links: [Link(phrase: "GeoNames", url: "https://www.geonames.org/")]\n' +
        '    ),\n',
    );
    expect(swift).toContain('      links: []\n');
    const names = [...swift.matchAll(/^ {6}name: "([^"]+)",$/gm)].map((m) => m[1]);
    expect(names).toEqual(NOTICES.map((n) => n.name));
    for (const n of NOTICES) expect(swift).toContain(`      file: "${n.file}"\n`);
  });

  it('keeps within 100 columns, but for a string literal alone on its line', () => {
    expect(creditsSwift()).toBe(swift);
    for (const line of swift.split('\n')) {
      if (line.length > 100) expect(line.trim()).toMatch(/^"[^"]*",?$/);
    }
  });

  it('lays out a call as swift-format does', () => {
    expect(swiftLabelledCall('  ', 'A', [['x', '1']], ',')).toEqual(['  A(x: 1),']);
    const long = `"${'a'.repeat(100)}"`;
    expect(
      swiftLabelledCall('', 'A', [
        ['x', long],
        ['y', '[]'],
      ]),
    ).toEqual(['A(', '  x:', `    ${long},`, '  y: []', ')']);
  });
});

describe("Your privacy and the website's privacy notice", () => {
  // The notice's text, as a reader sees it: one space between words.
  const notice = read('apps/web/src/components/PrivacyBody.astro')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{' '\}/g, ' ')
    .replace(/\s+/g, ' ');

  it('say the same of what the app sends and keeps, and when it is deleted', () => {
    const pairs: [app: string, site: string][] = [
      [
        '(a town, or your location rounded to about 5 km)',
        'a town, or your location rounded to about 5 km',
      ],
      ['and your units to our server', 'and your units to our server'],
      ['a rough one from your internet connection', 'a rough location from your IP address'],
      ['Place names you search for go to Open-Meteo', 'place searches go to Open-Meteo'],
      [
        'The app keeps your place, units, recent and saved places and the last forecast on your iPhone.',
        'it keeps your place, units, recent and saved places and last answer on your iPhone',
      ],
      ["your device's notification token, an ID made from it", 'an ID made from the token'],
      [
        'the place, its time zone, your units and which notifications you chose',
        'its time zone, your units and which notifications you asked for',
      ],
      ["the app's version and when it last checked in", "the app's version"],
      ['turn notifications off in the app', 'when you turn notifications off in the app'],
      [
        'when Apple tells us the app is no longer installed',
        'when Apple tells us the app is no longer installed',
      ],
      ['about 90 days after you last open it', 'so about 90 days after you last opened it'],
      [
        "If you turn notifications off in your iPhone's Settings instead, we delete them the next time you open the app.",
        "If you turn notifications off in your iPhone's Settings instead, we delete it the next time you open the app.",
      ],
      // The run's and the tests' notes (sent/, test/ and judged/) outlive the rest by a few days.
      [
        'For a few days after each notification and each test, and after some forecast checks that found nothing to send, we also keep a note of it, even once the rest is deleted.',
        'For a few days after each notification and each test, and after some forecast checks that found nothing to send, we also keep a note of it, even once the rest is deleted,',
      ],
      ['It holds no token or place.', 'it holds no token or place.'],
      ['In the free version, Google shows the ads', 'The free version shows ads from Google AdMob'],
      [APP_COPY.privacyChoices, `Settings → ${APP_COPY.privacyChoices} lets you change it`],
      [APP_COPY.privacyPurchases, APP_COPY.privacyPurchases],
      [APP_COPY.privacyAccounts, 'It has no accounts.'],
    ];
    const app = [
      APP_COPY.privacyForecast,
      APP_COPY.privacyNotifications,
      APP_COPY.privacyAds,
      APP_COPY.seePrivacyChoices,
      APP_COPY.privacyPurchases,
      APP_COPY.privacyAccounts,
    ].join(' ');
    for (const [inApp, onSite] of pairs) {
      expect(app, inApp).toContain(inApp);
      expect(notice, onSite).toContain(onSite);
    }
    // The screen and its button, as the notice names them.
    expect(notice).toContain(`Settings → ${APP_COPY.yourPrivacy} shows the ID and the main things`);
    expect(notice).toContain(`"${APP_COPY.deleteMyData}" deletes them`);
  });

  it('give the same number of days', () => {
    const days = (text: string) => [...text.matchAll(/(\d+) days/g)].map((m) => m[1]);
    expect(days(APP_COPY.privacyNotifications)).toEqual(['90']);
    expect(new Set(days(notice))).toEqual(new Set(['90']));
    // The days the notifications run keeps a registration that has not checked in (core ALERTS).
    expect(days(APP_COPY.privacyNotifications)).toEqual([String(ALERTS.staleAfterDays)]);
  });
});
