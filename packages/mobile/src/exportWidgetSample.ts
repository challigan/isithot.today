/**
 * `WidgetSample.swift` (iOS build spec, section 11.3: the gallery and the placeholder show "the
 * real design with sample data"): one fixture's face at its own moment, as `widgetFace` words it,
 * written as JSON that IsItLogic's `WidgetFace.sample` decodes once. Only the face is written, not
 * the fixture, so the sample brings no other topic's answers into the app or the widget.
 */
import { widgetEntries } from '@isithot/client';
import { generatedHeader } from './swift';
import type { FixtureSet } from './vectors';
import { widgetFace, type WidgetFace } from './widgetFace';

/** The gallery's sample (spec 11.3): durham-tomorrow, faced at its own moment (6:05pm). */
export const WIDGET_SAMPLE = { fixture: 'durham-tomorrow' } as const;

export const WIDGET_SAMPLE_PATH =
  'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/WidgetSample.swift';

export const WIDGET_SAMPLE_SOURCE = 'packages/mobile/src/exportWidgetSample.ts';

/**
 * The sample's face: the fixture's first entry at its own moment (`_fixture.now`), fetched then
 * and unlocked, as the gallery shows whatever the purchase.
 */
export function widgetSampleFace(fixtures: FixtureSet): WidgetFace {
  const f = fixtures.get(WIDGET_SAMPLE.fixture);
  if (!f) throw new Error(`No fixture ${WIDGET_SAMPLE.fixture}`);
  const now = Date.parse(f._fixture.now);
  const { entries } = widgetEntries(f, { fetchedAt: now, now, unlocked: true });
  return widgetFace(entries[0]!, f.snow!.unit);
}

/**
 * The Swift: the face as two-space JSON in a raw multi-line string. JSON writes every quote in a
 * string as `\"`, so the string can't be ended early, but `\#` would start an escape in it, so a
 * face whose JSON holds one throws.
 */
export function widgetSampleSwift(
  fixtures: FixtureSet,
  face: WidgetFace = widgetSampleFace(fixtures),
): string {
  const json = JSON.stringify(face, null, 2);
  if (json.includes('\\#')) throw new Error('The face would start an escape in a raw string');
  return [
    generatedHeader(WIDGET_SAMPLE_SOURCE),
    '',
    '/// What the widget gallery and the placeholder show (iOS build spec, section 11.3: "the real',
    '/// design with sample data"): the durham-tomorrow fixture\'s face at 6:05pm in Durham on',
    '/// 16 December 2026, when the middle view reads Tomorrow: Yes, all six forecasts expecting snow,',
    "/// as packages/mobile `widgetFace` words it. IsItLogic's `WidgetFace.sample` reads it.",
    'public enum WidgetSample {',
    "  /// The face, as JSON (`WidgetFace`'s keys).",
    '  public static let face = #"""',
    ...json.split('\n').map((line) => `    ${line}`),
    '    """#',
    '}',
    '',
  ].join('\n');
}
