/**
 * The widget snapshots and the contrast gate judge one rect (iOS build spec, section 11.4): the
 * small and medium tiles the app's unit tests draw for the contact sheet
 * (apps/ios/Apps/Snow/Tests/WidgetSnapshotTests.swift, `size(_:)`) are `WIDGET_SIZES`, the
 * rects brandColours.ts's `inkOnWidget` samples the ink over. Were the two to part, a tile could
 * show a layout the gate never judged, and nothing on Linux or macOS would say so.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WIDGET_SIZES, type Area } from '../src/brandColours';

const SNAPSHOTS = 'apps/ios/Apps/Snow/Tests/WidgetSnapshotTests.swift';

/** Each family's size in `swift`, in its order: `case .small: CGSize(width: 170, height: 170)`. */
function snapshotSizes(swift: string): Record<string, Area> {
  const cases = swift.matchAll(/^\s*case \.(\w+): CGSize\(width: (\d+), height: (\d+)\)$/gm);
  return Object.fromEntries(
    [...cases].map((m) => [m[1]!, { width: Number(m[2]), height: Number(m[3]) }]),
  );
}

describe('the widget snapshots', () => {
  it("draw the small and the medium at WIDGET_SIZES', the rects the contrast gate judges", () => {
    const swift = readFileSync(new URL(`../../../${SNAPSHOTS}`, import.meta.url), 'utf8');
    const sizes = snapshotSizes(swift);
    expect(Object.keys(sizes)).toEqual(['small', 'medium', 'circular', 'rectangular', 'inline']);
    expect({ small: sizes.small, medium: sizes.medium }).toEqual(WIDGET_SIZES);
  });

  it("reads each family's case, and nothing else", () => {
    const swift = [
      '    switch family {',
      '    case .small: CGSize(width: 170, height: 170)',
      '    case .medium: CGSize(width: 364, height: 170)',
      '    // case .large: CGSize(width: 364, height: 382)',
      '    let other = CGSize(width: 1, height: 2)',
      '    }',
    ].join('\n');
    expect(snapshotSizes(swift)).toEqual({
      small: { width: 170, height: 170 },
      medium: { width: 364, height: 170 },
    });
  });
});
