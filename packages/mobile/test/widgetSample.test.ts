/**
 * The widget gallery's sample (`WidgetSample.swift`, spec 11.3): durham-tomorrow's face at its own
 * moment, as `widgetFace` words it and the vectors hold the Swift to, written as JSON the Swift
 * decodes once.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES, fixtureJson, makeFixture, type Fixture } from '../src/fixtures';
import {
  WIDGET_SAMPLE,
  WIDGET_SAMPLE_PATH,
  WIDGET_SAMPLE_SOURCE,
  widgetSampleFace,
  widgetSampleSwift,
} from '../src/exportWidgetSample';
import { generatedHeader } from '../src/swift';
import { vectorFiles } from '../src/vectors';
import type { WidgetFace } from '../src/widgetFace';

const fixtures = new Map<string, Fixture>();
let swift: string;
beforeAll(async () => {
  for (const s of FIXTURES) fixtures.set(s.name, JSON.parse(fixtureJson(await makeFixture(s))));
  swift = widgetSampleSwift(fixtures);
});

/** The JSON between the raw string's delimiters, its indentation taken off as Swift takes it. */
function sampleJson(text: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf('  public static let face = #"""');
  const end = lines.indexOf('    """#', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return lines
    .slice(start + 1, end)
    .map((line) => {
      expect(line.startsWith('    ')).toBe(true);
      return line.slice(4);
    })
    .join('\n');
}

describe('WidgetSample.swift', () => {
  it('goes into IsItModel, with the header first', () => {
    expect(WIDGET_SAMPLE_PATH).toBe(
      'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/WidgetSample.swift',
    );
    expect(WIDGET_SAMPLE_SOURCE).toBe('packages/mobile/src/exportWidgetSample.ts');
    expect(swift.split('\n')[0]).toBe(generatedHeader(WIDGET_SAMPLE_SOURCE));
    expect(swift).toContain('\npublic enum WidgetSample {\n');
    expect(swift.endsWith('}\n')).toBe(true);
  });

  it('holds the face as JSON, every key in its order', () => {
    const face = widgetSampleFace(fixtures);
    const json = sampleJson(swift);
    expect(JSON.parse(json)).toEqual(face);
    expect(json).toBe(JSON.stringify(face, null, 2));
    expect(Object.keys(JSON.parse(json))).toEqual([
      ...['state', 'link', 'band', 'place', 'slot', 'answer', 'detail', 'agreement'],
      ...['agreementShort', 'slotAnswer', 'inline', 'message', 'spoken', 'spokenShort'],
      ...['spokenGauge', 'now', 'week', 'weekLink'],
    ]);
  });

  it('is the face the vectors hold the Swift to for durham-tomorrow at 6:05pm', () => {
    const f = fixtures.get(WIDGET_SAMPLE.fixture)!;
    expect(WIDGET_SAMPLE.fixture).toBe('durham-tomorrow');
    expect(f._fixture.now).toBe('2026-12-16T18:05:00.000Z');
    const now = Date.parse(f._fixture.now);
    const found = vectorFiles(fixtures)
      .find((v) => v.name === 'widgetFace')!
      .vectors.cases.filter(
        (c) =>
          c.in.fixture === WIDGET_SAMPLE.fixture &&
          c.in.now === now &&
          c.in.index === 0 &&
          c.in.unlocked === true &&
          c.in.without === undefined &&
          c.in.placeName === undefined,
      );
    expect(found).toHaveLength(1);
    expect(found[0]!.out).toEqual(widgetSampleFace(fixtures));
  });

  it('reads as the design’s example: Durham, Tomorrow, Yes, all six forecasts', () => {
    const face: WidgetFace = widgetSampleFace(fixtures);
    expect(face).toMatchObject({
      state: 'ok',
      link: 'willitsnow://view/today',
      band: 'snow',
      place: 'Durham',
      slot: 'Tomorrow',
      answer: 'Yes.',
      detail: 'Snow · 4cm',
      agreement: { snowy: 6, total: 6 },
      agreementShort: '6 of 6 forecasts',
      slotAnswer: 'Tomorrow · Yes.',
      inline: 'Tomorrow: Snow',
      message: '',
      spoken: 'Durham. Tomorrow: Yes. Snow, 4cm. 6 of 6 forecasts expect snow.',
      spokenShort: 'Tomorrow: Yes. Snow, 4cm. 6 of 6 forecasts expect snow.',
      spokenGauge: 'Tomorrow: 6 of 6 forecasts expect snow.',
      now: { label: 'Now', text: 'No. Too warm for snow.', spoken: 'Now: No. Too warm for snow.' },
      weekLink: 'willitsnow://view/week',
    });
    expect(face.week).toEqual([
      {
        label: 'Fri',
        band: 'heavysnow',
        bandLabel: 'Heavy snow',
        agreement: { snowy: 6, total: 6 },
        spoken: 'Friday, 8cm, heavy snow, 6 of 6 forecasts expect snow',
      },
      expect.objectContaining({
        label: 'Sat',
        bandLabel: 'Dry',
        agreement: { snowy: 0, total: 6 },
      }),
      expect.objectContaining({
        label: 'Sun',
        bandLabel: 'Dry',
        agreement: { snowy: 0, total: 5 },
      }),
      expect.objectContaining({
        label: 'Mon',
        bandLabel: 'Dry',
        agreement: { snowy: 0, total: 5 },
      }),
    ]);
  });

  it('is the same every time, every line within 100 columns, and small', () => {
    expect(widgetSampleSwift(fixtures)).toBe(swift);
    for (const line of swift.split('\n')) expect(line.length, line).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(swift)).toBeLessThan(3000);
  });

  it('refuses a face whose JSON would start an escape in the raw string', () => {
    const face = widgetSampleFace(fixtures);
    // JSON writes a backslash as two, and a quote as \", so `\#` is the only way out.
    for (const place of ['A \\# B', 'A\\#']) {
      expect(() => widgetSampleSwift(fixtures, { ...face, place })).toThrow(/raw string/);
    }
    expect(() => widgetSampleSwift(new Map())).toThrow(/No fixture durham-tomorrow/);
  });
});
