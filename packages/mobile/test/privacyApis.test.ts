/**
 * No file-timestamp or boot-time API in anything that ships (iOS build spec, section 15.1): the
 * app's and the widget's privacy manifests declare UserDefaults alone, so no reason C617.1 or
 * 35F9.1 is given, and a Swift file that named one of these APIs would need it. The widget reads
 * an answer's age from the `savedAt` it was saved with, never from the file. Every Swift file
 * under apps/ios that a target compiles is read, the generated ones too, and none of the tests.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../apps/ios/', import.meta.url);

/**
 * The required-reason APIs the manifests give no reason for (spec 15.1), found inside a longer
 * name too, whatever its case: `creationDateKey`, `fileModificationDate`.
 */
const APIS = [
  'creationDate',
  'modificationDate',
  'contentModificationDate',
  'systemUptime',
  'mach_absolute_time',
];
const NAMED = new RegExp(APIS.join('|'), 'i');

/** Build output and the generated project, which aren't source. */
const SKIPPED_FOLDER = /^(\..*|build|DerivedData|.*\.xcodeproj)$/;
/** The test targets: the app's three and each package's, none of which ships. */
const TEST_TARGET = /^(Apps\/Snow\/(Tests|UITests|StoreKitTests)|Packages\/[^/]+\/Tests)\//;

/** Every Swift file under apps/ios that ships, as swiftLiterals.test.ts walks them. */
function shippedSwift(dir = ''): string[] {
  return readdirSync(new URL(dir ? `${dir}/` : './', root)).flatMap((name) => {
    const path = dir ? `${dir}/${name}` : name;
    if (statSync(new URL(path, root)).isDirectory()) {
      return SKIPPED_FOLDER.test(name) ? [] : shippedSwift(path);
    }
    return name.endsWith('.swift') && !TEST_TARGET.test(path) ? [path] : [];
  });
}

/** The lines of `swift` that name one of the APIs, as `path:line: text`, comments too. */
export function namingLines(path: string, swift: string): string[] {
  return swift.split('\n').flatMap((line, i) => {
    return NAMED.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [];
  });
}

describe('the Swift that ships', () => {
  it('names no file-timestamp or boot-time API', () => {
    const files = shippedSwift();
    for (const folder of ['Apps/Snow/App', 'Apps/Snow/Widgets', 'Packages/IsItCore/Sources']) {
      expect(
        files.some((f) => f.startsWith(`${folder}/`)),
        folder,
      ).toBe(true);
    }
    expect(files.some((f) => f.includes('/Generated/'))).toBe(true);
    expect(files.some((f) => TEST_TARGET.test(f))).toBe(false);
    const found = files.flatMap((path) =>
      namingLines(path, readFileSync(new URL(path, root), 'utf8')),
    );
    expect(found).toEqual([]);
  });

  it('finds each API however it is reached, its keys too', () => {
    for (const bad of [
      'let made = attributes[.creationDate] as? Date',
      'let values = try url.resourceValues(forKeys: [.contentModificationDateKey])',
      'if let date = values.contentModificationDate {',
      'let changed = attributes[FileAttributeKey.modificationDate]',
      'let keys: Set<URLResourceKey> = [.creationDateKey]',
      'let changed = try FileManager.default.attributesOfItem(atPath: path).fileModificationDate()',
      'let up = ProcessInfo.processInfo.systemUptime',
      'let ticks = mach_absolute_time()',
      '/// Reads `creationDate`.',
    ]) {
      expect(namingLines('x.swift', bad), bad).toEqual([`x.swift:1: ${bad}`]);
    }
    for (const fine of [
      'let saved = Date(timeIntervalSince1970: savedAt / 1000)',
      'let age = now.timeIntervalSince(saved)',
      'ContinuousClock.now',
    ]) {
      expect(namingLines('x.swift', fine), fine).toEqual([]);
    }
  });
});
