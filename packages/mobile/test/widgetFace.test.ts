/**
 * The widget's face (`widgetFace`) where the golden vectors don't reach: a day no forecast covers,
 * one forecast of six, the links, the locked face, and the week's rows read as the app's week
 * page reads them. Every face of the vectors, and of every fixture's plan, is held to the rules
 * the families depend on: nothing spoken holds the shown "·", and what the face words itself is
 * snow only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { COPY, snowAgreementLine, viewLabel } from '@isithot/core';
import { parseDeepLink, widgetEntries, type Route, type WidgetEntry } from '@isithot/client';
import { APP_COPY } from '../src/appCopy';
import { FIXTURES, fixtureJson, makeFixture, type Fixture } from '../src/fixtures';
import { fill, homePage, spokenWeekDay } from '../src/page';
import { vectorFiles } from '../src/vectors';
import { widgetFace, type WidgetFace } from '../src/widgetFace';

const fixtures = new Map<string, Fixture>();
let vectorFaces: WidgetFace[];
beforeAll(async () => {
  for (const s of FIXTURES) fixtures.set(s.name, JSON.parse(fixtureJson(await makeFixture(s))));
  const file = vectorFiles(fixtures).find((f) => f.name === 'widgetFace')!.vectors;
  vectorFaces = file.cases.map((c) => c.out as WidgetFace);
});

const fixture = (name: string): Fixture => fixtures.get(name)!;
const madeAt = (f: Fixture): number => Date.parse(f.snow!.days[0]!.from);

/** Every entry of a fixture's plan from when it was fetched, then from 6pm there. */
function entriesOf(f: Fixture): WidgetEntry[] {
  const fetchedAt = madeAt(f);
  const from = (now: number) => widgetEntries(f, { fetchedAt, now, unlocked: true }).entries;
  return [...from(fetchedAt), ...from(Date.parse(f._fixture.now))];
}

/** Every entry of every fixture's plan, each with the unit its face is in, locked and stale too. */
function everyEntry(): [WidgetEntry, Fixture | null][] {
  const all: [WidgetEntry, Fixture | null][] = [];
  for (const f of fixtures.values()) for (const e of entriesOf(f)) all.push([e, f]);
  const aberdeen = fixture('aberdeen-snow');
  const now = madeAt(aberdeen);
  const locked = widgetEntries(aberdeen, { fetchedAt: now, now, unlocked: false }).entries[0]!;
  const none = widgetEntries(null, { fetchedAt: now, now, unlocked: true }).entries[0]!;
  all.push([locked, aberdeen], [none, null]);
  return all;
}

const faceOf = ([entry, f]: [WidgetEntry, Fixture | null]): WidgetFace =>
  widgetFace(entry, f?.snow?.unit ?? 'cm');

/** Every string a face says aloud: the three families' sentences, Now's and the rows'. */
const spokenOf = (face: WidgetFace): string[] => [
  face.spoken,
  face.spokenShort,
  face.spokenGauge,
  ...(face.now ? [face.now.spoken] : []),
  ...face.week.map((row) => row.spoken),
];

/** Every string a face holds, shown or spoken. */
const stringsOf = (face: WidgetFace): string[] => [
  face.place,
  face.slot,
  face.answer,
  face.detail,
  face.agreementShort,
  face.slotAnswer,
  face.inline,
  face.message,
  ...spokenOf(face),
  ...(face.now ? [face.now.label, face.now.text] : []),
  ...face.week.flatMap((row) => [row.label, row.bandLabel]),
];

/** Durham at 6:05pm, the gallery's moment: Tomorrow, Yes, all six forecasts expecting snow. */
function durhamEntry(): WidgetEntry {
  const f = fixture('durham-tomorrow');
  const now = Date.parse(f._fixture.now);
  return widgetEntries(f, { fetchedAt: madeAt(f), now, unlocked: true }).entries[0]!;
}

describe('widgetFace', () => {
  it('leaves the dots and the count out for a day no forecast covers, and reads it short', () => {
    const entry = durhamEntry();
    const face = widgetFace({ ...entry, day: { ...entry.day!, snowy: 0, total: 0 } }, 'cm');
    expect(face.agreement).toBeNull();
    expect(face.agreementShort).toBe('');
    const heading = fill(APP_COPY.widgetHeading, {
      place: 'Durham',
      slot: 'Tomorrow',
      answer: 'Yes.',
    });
    expect(face.spoken).toBe(fill(APP_COPY.widgetSentenceShort, { heading, detail: 'Snow, 4cm' }));
    expect(face.spoken).toBe('Durham. Tomorrow: Yes. Snow, 4cm.');
    expect(face.spokenShort).toBe('Tomorrow: Yes. Snow, 4cm.');
    // The circular family has no gauge to read, so it says the answer.
    expect(face.spokenGauge).toBe('Tomorrow: Yes.');
  });

  it('says "expects" for one forecast of six', () => {
    const entry = durhamEntry();
    const face = widgetFace({ ...entry, day: { ...entry.day!, snowy: 1, total: 6 } }, 'cm');
    expect(face.agreement).toEqual({ snowy: 1, total: 6 });
    expect(face.agreementShort).toBe('1 of 6 forecasts');
    expect(face.spoken.endsWith(' 1 of 6 forecasts expects snow.')).toBe(true);
    expect(face.spokenGauge).toBe('Tomorrow: 1 of 6 forecasts expects snow.');
  });

  it('reads nothing aloud that holds the shown "·", on any face', () => {
    expect(vectorFaces.length).toBeGreaterThan(30);
    for (const face of [...vectorFaces, ...everyEntry().map(faceOf)]) {
      for (const text of spokenOf(face)) expect(text).not.toContain('·');
    }
  });

  it('links each tap to the page it names', () => {
    const route = (link: string): Route | null => parseDeepLink(link);
    const states = new Set<string>();
    for (const face of [...vectorFaces, ...everyEntry().map(faceOf)]) {
      states.add(face.state);
      if (face.state === 'locked') {
        expect(route(face.link)).toEqual({ kind: 'upgrade' });
        expect(face.weekLink).toBe('');
      } else {
        expect(route(face.link)).toEqual({ kind: 'view', view: 'today' });
        expect(face.weekLink === '' ? null : route(face.weekLink)).toEqual(
          face.state === 'ok' ? { kind: 'view', view: 'week' } : null,
        );
      }
    }
    expect(states).toEqual(new Set(['ok', 'locked', 'stale']));
  });

  it('holds no answer while locked, only the locked message', () => {
    const locked = everyEntry().filter(([e]) => e.state === 'locked');
    expect(locked.length).toBeGreaterThan(0);
    for (const face of [...vectorFaces, ...locked.map(faceOf)].filter(
      (f) => f.state === 'locked',
    )) {
      expect(face).toMatchObject({
        band: 'nosnow',
        answer: '',
        agreement: null,
        now: null,
        week: [],
      });
      for (const text of stringsOf(face)) expect(['', APP_COPY.widgetLocked]).toContain(text);
    }
  });

  it('carries every day of the week after the middle day, not the first four', () => {
    const f = fixture('durham-tomorrow');
    const now = Date.parse(f._fixture.now);
    const labels = (answer: Fixture, at: number): string[] => {
      const entry = widgetEntries(answer, { fetchedAt: madeAt(f), now: at, unlocked: true })
        .entries[0]!;
      return widgetFace(entry, 'cm').week.map((row) => row.label);
    };
    // At 5:59pm the middle day is Wednesday, today: the six days after it, to the week's end.
    expect(labels(f, now - 6 * 60 * 1000)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
    // At 6:05pm it is Thursday, tomorrow: the five after it.
    expect(labels(f, now)).toEqual(['Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
    // With no tomorrow for snow from 6pm there is no middle day, and the rows are the whole week.
    const noTomorrow: Fixture = { ...f, snow: { ...f.snow!, days: f.snow!.days.slice(0, 1) } };
    expect(labels(noTomorrow, now)).toEqual(['Today', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
  });

  it('reads each week row as the app’s week page reads it', () => {
    for (const name of ['aberdeen-snow', 'durham-tomorrow']) {
      const f = fixture(name);
      let rows = 0;
      for (const entry of entriesOf(f).filter((e) => e.state === 'ok')) {
        const page = homePage(f, { view: 'week', now: entry.date, phase: 'ready' });
        const spoken = new Map(page.week!.rows.map((row) => [row.label, row.spoken]));
        // A week's seven labels are distinct, so a row is found by its label.
        expect(spoken.size).toBe(page.week!.rows.length);
        for (const row of widgetFace(entry, f.snow!.unit).week) {
          expect(row.spoken, `${name} ${row.label}`).toBe(spoken.get(row.label));
          rows++;
        }
      }
      expect(rows, name).toBeGreaterThan(8);
    }
  });

  it('reads a row without counts without the agreement, as the app reads an older answer', () => {
    expect(spokenWeekDay({ name: 'Friday', amount: '8cm', bandLabel: 'Heavy snow' })).toBe(
      'Friday, 8cm, heavy snow',
    );
    // Either count missing is an older answer's row.
    for (const [snowy, total] of [
      [null, 6],
      [6, null],
      [6, undefined],
    ] as const) {
      expect(
        spokenWeekDay({ name: 'Friday', amount: '8cm', bandLabel: 'Heavy snow', snowy, total }),
      ).toBe('Friday, 8cm, heavy snow');
    }
    expect(
      spokenWeekDay({ name: 'Friday', amount: '8cm', bandLabel: 'Heavy snow', snowy: 6, total: 6 }),
    ).toBe(`Friday, 8cm, heavy snow, ${snowAgreementLine(6, 6)}`);
  });

  it('words nothing of another topic itself: only the answer’s own words say why there is no snow', () => {
    const otherTopic =
      /\b(websites?|isithot|isitwet|isitwindy|hot|wet|wind|windy|rain|rainy|android)\b/i;
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let checked = 0;
    for (const [entry, f] of everyEntry()) {
      const face = faceOf([entry, f]);
      // The answer's words: the place, the answer and band label, Now's, and the rows'.
      const own = [
        entry.placeName,
        ...(entry.day ? [entry.day.answer, entry.day.bandLabel] : []),
        ...(entry.now ? [entry.now.answer, entry.now.verdict] : []),
        ...entry.week.flatMap((d) => [d.label, d.bandLabel]),
      ].filter(Boolean);
      for (const text of stringsOf(face)) {
        const rest = own.reduce(
          (left, word) => left.replace(new RegExp(escape(word), 'gi'), ' '),
          text,
        );
        expect(rest, text).not.toMatch(otherTopic);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    // The server's own words do say why a day has no snow: leeds-dry's Today is rain.
    expect(fixture('leeds-dry').snow!.days[0]!.bandLabel).toBe('Rain');
  });

  it('says the stale message, and links to Today, with nothing to show', () => {
    const now = madeAt(fixture('aberdeen-snow'));
    const stale = widgetFace(
      widgetEntries(null, { fetchedAt: 0, now, unlocked: true }).entries[0]!,
      'cm',
    );
    expect(stale).toEqual({
      state: 'stale',
      link: 'willitsnow://view/today',
      band: 'nosnow',
      place: '',
      slot: '',
      answer: '',
      detail: '',
      agreement: null,
      agreementShort: '',
      slotAnswer: '',
      inline: APP_COPY.widgetStale,
      message: APP_COPY.widgetStale,
      spoken: APP_COPY.widgetStale,
      spokenShort: APP_COPY.widgetStale,
      spokenGauge: APP_COPY.widgetStale,
      now: null,
      week: [],
      weekLink: '',
    });
    expect(viewLabel('today')).toBe('Today');
    expect(COPY.notAvailable).toBe('Not available right now.');
  });
});
