/**
 * The fonts the app and its widget register (DECISIONS, "The iPhone app in the website's look"):
 * both Info.plists' `UIAppFonts` list every file `BrandFont` names, in its order. An extension
 * can't load the app's fonts, so the widget lists them too, and a face left out of either would
 * fall back to the system font without a word, which nothing on Linux would see.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAND_FONTS } from '../src/exportFont';

const PLISTS = ['apps/ios/Apps/Snow/Resources/Info.plist', 'apps/ios/Apps/Snow/Widgets/Info.plist'];

/** The strings of a property list's top-level array under `key`, in order. */
function plistStrings(plist: string, key: string): string[] {
  const at = plist.indexOf(`<key>${key}</key>`);
  if (at < 0) throw new Error(`No ${key}`);
  const array = /^\s*<array>([\s\S]*?)<\/array>/.exec(plist.slice(at + key.length + 11));
  if (!array) throw new Error(`${key} isn't an array`);
  return [...array[1]!.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]!);
}

describe('UIAppFonts', () => {
  it("lists every brand font's file in the app's and the widget's Info.plist", () => {
    const files = BRAND_FONTS.map((f) => `${f.name}.ttf`);
    expect(files).toEqual([
      'BricolageText-Regular.ttf',
      'BricolageText-Medium.ttf',
      'BricolageText-SemiBold.ttf',
      'BricolageAnswer.ttf',
    ]);
    for (const path of PLISTS) {
      const plist = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
      expect(plistStrings(plist, 'UIAppFonts'), path).toEqual(files);
    }
  });

  it('reads the array under its key, and nothing past it', () => {
    const plist =
      '<dict><key>A</key><array><string>a.ttf</string></array>' +
      '<key>UIAppFonts</key>\n\t<array>\n\t\t<string>x.ttf</string>\n\t\t<string>y.ttf</string>' +
      '\n\t</array><key>B</key><array><string>b</string></array></dict>';
    expect(plistStrings(plist, 'UIAppFonts')).toEqual(['x.ttf', 'y.ttf']);
    expect(() => plistStrings(plist, 'C')).toThrow(/No C/);
    expect(() => plistStrings('<key>C</key><string>c</string>', 'C')).toThrow(/isn't an array/);
  });
});
