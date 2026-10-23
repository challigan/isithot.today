/**
 * `Keys.swift` (iOS build spec, section 6.8): where the native apps keep things, from
 * packages/client's `keys.ts`, so the Swift side never retypes a key.
 */
import { APP_GROUP_KEYS, APP_KEYS, STORE_VERSION } from '@isithot/client';
import { generatedHeader, swiftIdentifier, swiftString } from './swift';

export const KEYS_PATH = 'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/Keys.swift';

const members = (keys: Readonly<Record<string, string>>): string[] =>
  Object.entries(keys).map(
    ([name, key]) => `    public static let ${swiftIdentifier(name)} = ${swiftString(key)}`,
  );

export function keysSwift(): string {
  return [
    generatedHeader('packages/client/src/keys.ts'),
    '',
    '/// Where the apps keep things. What is stored under another `storeVersion` is ignored, not',
    '/// migrated.',
    'public enum Keys {',
    '  /// Shared with the widgets through the App Group: defaults, and `today`, the last good',
    "  /// answer, a file in the group's container.",
    '  public enum AppGroup {',
    ...members(APP_GROUP_KEYS),
    '  }',
    '',
    "  /// The app's own defaults.",
    '  public enum App {',
    ...members(APP_KEYS),
    '  }',
    '',
    '  /// The version of what is stored under these keys.',
    `  public static let storeVersion = ${STORE_VERSION}`,
    '}',
    '',
  ].join('\n');
}
