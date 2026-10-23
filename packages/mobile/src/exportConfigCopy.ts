/**
 * `Configs/Generated/Copy.xcconfig` (iOS build spec, sections 9.7 and 15.2): the strings the
 * app's Info.plist carries, as build settings, from `appCopy.ts`, so the location permission's
 * purpose string is written once, with the app's other words. Snow.xcconfig includes the file,
 * and Info.plist reads each setting (`NSLocationWhenInUseUsageDescription` is
 * `$(LOCATION_PURPOSE)`), which Xcode fills in when it builds the app.
 */
import { APP_COPY, INFO_PLIST_SETTINGS } from './appCopy';
import { generatedHeader } from './swift';

/** A folder of its own, which the generator owns, beside the hand-written xcconfigs. */
export const CONFIGS_GENERATED_DIR = 'apps/ios/Configs/Generated';

export const CONFIG_COPY_PATH = `${CONFIGS_GENERATED_DIR}/Copy.xcconfig`;

/**
 * `NAME = text`, refusing text an xcconfig would read as something else: `//` starts a comment,
 * `$(` a setting, and a line break, or spaces at either end, would be lost.
 */
export function xcconfigSetting(name: string, text: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Not a build setting's name: ${name}`);
  if (/\/\/|\$|[\r\n]|^\s|\s$/.test(text) || text === '') {
    throw new Error(`${name}: an xcconfig can't hold ${JSON.stringify(text)} as it is`);
  }
  return `${name} = ${text}`;
}

export function configCopy(
  settings: Readonly<Record<string, string>> = INFO_PLIST_SETTINGS,
  copy: Readonly<Record<string, string>> = APP_COPY,
): string {
  return [
    generatedHeader('packages/mobile/src/appCopy.ts'),
    '',
    "// The app's Info.plist strings, which it reads as these build settings (Snow.xcconfig",
    '// includes this file).',
    ...Object.entries(settings).map(([name, key]) => {
      const text = copy[key];
      if (text === undefined) throw new Error(`${name}: appCopy.ts has no ${key}`);
      return xcconfigSetting(name, text);
    }),
    '',
  ].join('\n');
}
