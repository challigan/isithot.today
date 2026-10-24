/**
 * Nothing the widget compiles names the ads SDKs or the app's location code. The archive check
 * (scripts/check-archive.sh) greps the widget's binary for those names, among its type names and
 * literals, and fails the build: the widget must not link Google Mobile Ads or UMP, and has no
 * location purpose string. A name in a literal fails it as surely as a link does, as the licence
 * files named in the generated credits once did (`"GoogleMobileAds-LICENSE"`), so this reads the
 * same patterns from the script and the same sources here, on Linux, before macOS CI does.
 * Comment lines never reach the binary and are skipped.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../apps/ios/', import.meta.url);

/**
 * What the widget compiles: its own sources and what it links (project.yml): IsItCore whole,
 * since IsItServices links IsItState, and IsItKit's IsItServices, IsItWidgetUI and SnowKit.
 */
const WIDGET = [
  'Apps/Snow/Widgets',
  'Packages/IsItCore/Sources',
  'Packages/IsItKit/Sources/IsItServices',
  'Packages/IsItKit/Sources/IsItWidgetUI',
  'Packages/IsItKit/Sources/SnowKit',
];

/** check-archive.sh's greps over the widget's strings. */
const script = readFileSync(new URL('../../../scripts/check-archive.sh', import.meta.url), 'utf8');
const patterns = [...script.matchAll(/grep -E -e '([^']+)' "\$work\/widget\.strings"/g)].map(
  (match) => match[1]!,
);
const forbidden = new RegExp(patterns.join('|'));

/** Every `.swift` file under `dir`. */
function swiftFiles(dir: string): string[] {
  return readdirSync(new URL(`${dir}/`, root)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(new URL(path, root)).isDirectory()) return swiftFiles(path);
    return name.endsWith('.swift') ? [path] : [];
  });
}

describe("the widget's strings", () => {
  it("reads both of check-archive.sh's greps: the ads SDKs and the location code", () => {
    expect(patterns).toEqual([
      'GoogleMobileAds|GADMobileAds|UserMessagingPlatform',
      'CLLocationManager|CoreLocationService',
    ]);
    expect(forbidden.test('file: "GoogleMobileAds-LICENSE"')).toBe(true);
    expect(forbidden.test('file: "Google-Mobile-Ads-LICENSE"')).toBe(false);
  });

  it('names none of them in anything the widget compiles', () => {
    const found = WIDGET.flatMap(swiftFiles).flatMap((path) =>
      readFileSync(new URL(path, root), 'utf8')
        .split('\n')
        .flatMap((text, i) =>
          !/^\s*\/\//.test(text) && forbidden.test(text)
            ? [`${path}:${i + 1}: ${text.trim()}`]
            : [],
        ),
    );
    expect(found).toEqual([]);
  });
});
