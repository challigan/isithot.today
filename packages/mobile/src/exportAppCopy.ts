/**
 * `AppCopy.swift` (iOS build spec, sections 7.1 and 10.9): the app's own strings, from
 * `appCopy.ts`, in its order. A string without slots is a constant; one with `{name}` slots is a
 * function with a `String` parameter for each, in the order they first appear. The strings App
 * Intents reads as literals when the app is built (`APP_INTENT_KEYS`) are left out.
 */
import { APP_COPY, APP_INTENT_KEYS } from './appCopy';
import {
  generatedHeader,
  swiftIdentifier,
  swiftLet,
  swiftString,
  swiftTemplate,
  templateSlots,
} from './swift';

export const APP_COPY_PATH = 'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/AppCopy.swift';

export const APP_COPY_SOURCE = 'packages/mobile/src/appCopy.ts';

/** The Swift for one string: a `static let`, or a `static func` that fills its slots. */
export function appCopyMember(key: string, text: string): string[] {
  const name = swiftIdentifier(key);
  const slots = templateSlots(text);
  if (!slots.length) return swiftLet('  ', `public static let ${name}`, swiftString(text));
  const params = slots.map((slot) => `${swiftIdentifier(slot)}: String`).join(', ');
  return [
    `  public static func ${name}(${params}) -> String {`,
    `    ${swiftTemplate(text)}`,
    '  }',
  ];
}

/** The members in order, with a blank line either side of each function. */
function spaced(members: string[][]): string[] {
  const isFunction = (member: string[] | undefined) => member?.[0]!.includes(' func ') ?? false;
  return members.flatMap((member, i) =>
    i > 0 && (isFunction(member) || isFunction(members[i - 1])) ? ['', ...member] : member,
  );
}

export function appCopySwift(copy: Readonly<Record<string, string>> = APP_COPY): string {
  return [
    generatedHeader(APP_COPY_SOURCE),
    '',
    "/// The app's own words, British English in sentence case: everything it says that the",
    "/// website doesn't (`CoreCopy`) and the server doesn't word. A string with slots is a",
    '/// function that fills them.',
    'public enum AppCopy {',
    ...spaced(
      Object.entries(copy)
        .filter(([key]) => !(APP_INTENT_KEYS as readonly string[]).includes(key))
        .map(([key, text]) => appCopyMember(key, text)),
    ),
    '}',
    '',
  ].join('\n');
}
