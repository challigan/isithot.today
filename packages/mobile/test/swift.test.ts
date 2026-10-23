import { describe, expect, it } from 'vitest';
import { APP_GROUP_KEYS, APP_KEYS, STORE_VERSION } from '@isithot/client';
import { KEYS_PATH, keysSwift } from '../src/exportKeys';
import {
  generatedHeader,
  swiftCall,
  swiftCase,
  swiftDouble,
  swiftIdentifier,
  swiftInt,
  swiftLet,
  swiftString,
  swiftTemplate,
  templateSlots,
} from '../src/swift';

describe('swiftString', () => {
  it('writes plain text, apostrophes, curly quotes and $ as they are', () => {
    expect(swiftString('place.v1')).toBe('"place.v1"');
    expect(swiftString("It'll snow.")).toBe('"It\'ll snow."');
    expect(swiftString('It’ll snow: “heavy”')).toBe('"It’ll snow: “heavy”"');
    expect(swiftString('£1.99 or $1.99')).toBe('"£1.99 or $1.99"');
    expect(swiftString('2–5cm · −2°')).toBe('"2–5cm · −2°"');
  });

  it('escapes backslashes, so no interpolation can start, and double quotes', () => {
    expect(swiftString('a\\b')).toBe('"a\\\\b"');
    expect(swiftString('\\(place)')).toBe('"\\\\(place)"');
    expect(swiftString('say "Yes."')).toBe('"say \\"Yes.\\""');
  });

  it('escapes line breaks, tabs and other control characters', () => {
    expect(swiftString('a\nb\rc\td')).toBe('"a\\nb\\rc\\td"');
    expect(swiftString('\u0000\u001f\u007f\u0085')).toBe('"\\u{0}\\u{1f}\\u{7f}\\u{85}"');
    expect(swiftString('a b c')).toBe('"a\\u{2028}b\\u{2029}c"');
  });

  it('keeps characters outside the Basic Multilingual Plane whole', () => {
    expect(swiftString('❄️ 🌨')).toBe('"❄️ 🌨"');
  });
});

describe('swiftTemplate', () => {
  it('interpolates each slot as the parameter of the same name', () => {
    expect(swiftTemplate('Place: {place}. Change place.')).toBe(
      '"Place: \\(place). Change place."',
    );
    expect(swiftTemplate('Version {version} ({build})')).toBe('"Version \\(version) (\\(build))"');
    expect(swiftTemplate('{snowy} of {total}')).toBe('"\\(snowy) of \\(total)"');
    expect(swiftTemplate('No slots')).toBe(swiftString('No slots'));
  });

  it('writes apostrophes, curly quotes and $ around the slots as they are', () => {
    expect(swiftTemplate("You're offline since {time}.")).toBe('"You\'re offline since \\(time)."');
    expect(swiftTemplate('It’s “{place}”')).toBe('"It’s “\\(place)”"');
    expect(swiftTemplate('$1 or {price}, $&')).toBe('"$1 or \\(price), $&"');
  });

  it('escapes backslashes and quotes around the slots, so only a slot interpolates', () => {
    // A backslash before a slot stays a backslash, and the slot still interpolates.
    expect(swiftTemplate('a\\{place}')).toBe('"a\\\\\\(place)"');
    expect(swiftTemplate('\\(not) {place}')).toBe('"\\\\(not) \\(place)"');
    expect(swiftTemplate('say "{answer}"\n')).toBe('"say \\"\\(answer)\\"\\n"');
  });

  it('throws on a slot that is not a Swift name, or a brace outside a slot', () => {
    for (const bad of ['{}', '{Place}', '{place name}', '{{place}}', 'a { b', 'b }']) {
      expect(() => swiftTemplate(bad)).toThrow();
    }
    // A keyword is a name, in backticks.
    expect(swiftTemplate('{in}x')).toBe('"\\(`in`)x"');
  });

  it('lists the slots once each, in order', () => {
    expect(templateSlots('Time: {time}\nPlace: {place}, {time}')).toEqual(['time', 'place']);
    expect(templateSlots('Settings')).toEqual([]);
  });
});

describe('swiftInt and swiftDouble', () => {
  it('writes integers grouped in threes from five digits', () => {
    expect([0, 7, 250, 1000, 9999].map(swiftInt)).toEqual(['0', '7', '250', '1000', '9999']);
    expect([10_000, 21_600, 600_000, 1_800_000].map(swiftInt)).toEqual([
      '10_000',
      '21_600',
      '600_000',
      '1_800_000',
    ]);
    expect(swiftInt(-90_000)).toBe('-90_000');
  });

  it('throws on anything but a safe integer', () => {
    for (const bad of [0.5, NaN, Infinity, 2 ** 53]) expect(() => swiftInt(bad)).toThrow();
  });

  it('writes doubles as the shortest text that reads back the same', () => {
    expect([0.05, 0.6, 5, 15, 1 / 3, 1e-7].map(swiftDouble)).toEqual([
      '0.05',
      '0.6',
      '5',
      '15',
      '0.3333333333333333',
      '1e-7',
    ]);
    expect(Number(swiftDouble(1 / 3))).toBe(1 / 3);
    for (const bad of [NaN, Infinity, -Infinity]) expect(() => swiftDouble(bad)).toThrow();
  });
});

describe('swiftLet, swiftCase and swiftCall', () => {
  it('keep a line that fits in 100 columns whole', () => {
    expect(swiftLet('  ', 'public static let a', '"b"')).toEqual(['  public static let a = "b"']);
    expect(swiftCase('    ', '.now', '"Now"')).toEqual(['    case .now: "Now"']);
    expect(swiftCall('    ', 'Model', ['id: "a"', 'name: "A"'], ',')).toEqual([
      '    Model(id: "a", name: "A"),',
    ]);
  });

  it('break a longer one as swift-format does', () => {
    const long = swiftString('x'.repeat(90));
    expect(swiftLet('  ', 'public static let a', long)).toEqual([
      '  public static let a =',
      `    ${long}`,
    ]);
    expect(swiftCase('    ', '.now', long)).toEqual(['    case .now:', `      ${long}`]);
    const args = ['g1: 0xf6eef9', 'g2: 0xe1c9e8', 'g3: 0xffe3d3', 'ink: 0x341a3c'];
    expect(swiftCall('    ', 'public static let nosnow = Palette', [...args, ...args])).toEqual([
      '    public static let nosnow = Palette(',
      ...[...args, ...args].map((a, i) => `      ${a}${i < 7 ? ',' : ''}`),
      '    )',
    ]);
  });
});

describe('swiftIdentifier', () => {
  it('takes lower camel case names, and backticks keywords', () => {
    expect(swiftIdentifier('alertSync')).toBe('alertSync');
    expect(swiftIdentifier('v1')).toBe('v1');
    expect(swiftIdentifier('in')).toBe('`in`');
    expect(swiftIdentifier('default')).toBe('`default`');
  });

  it('backticks every word swiftc 6.3.3 rejects as a member name', () => {
    // Each fails `swiftc -parse` in `public enum K { public static let <word> = "x" }`.
    const reserved = [
      ...['associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func'],
      ...['import', 'init', 'inout', 'internal', 'let', 'operator', 'precedencegroup'],
      ...['private', 'protocol', 'public', 'rethrows', 'static', 'struct', 'subscript'],
      ...['typealias', 'var', 'break', 'case', 'catch', 'continue', 'default', 'defer', 'do'],
      ...['else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return', 'throw'],
      ...['switch', 'where', 'while', 'as', 'false', 'is', 'nil', 'self', 'super', 'throws'],
      ...['true', 'try'],
    ];
    expect(new Set(reserved).size).toBe(51);
    for (const word of reserved) expect(swiftIdentifier(word)).toBe(`\`${word}\``);
  });

  it('leaves contextual keywords, which can name a member, as they are', () => {
    for (const word of ['get', 'set', 'open', 'some', 'async', 'await', 'package', 'willSet']) {
      expect(swiftIdentifier(word)).toBe(word);
    }
  });

  it('throws on anything else', () => {
    for (const name of ['', 'Place', 'last-view', 'ui.card', '1st', 'naïve', 'a b']) {
      expect(() => swiftIdentifier(name)).toThrow(/Not a lower camel case Swift name/);
    }
  });
});

describe('generatedHeader', () => {
  it('names the source and says not to edit', () => {
    expect(generatedHeader('packages/client/src/keys.ts')).toBe(
      '// Generated by pnpm mobile:generate from packages/client/src/keys.ts. Do not edit.',
    );
  });
});

describe('keysSwift', () => {
  const swift = keysSwift();

  it('goes into IsItModel’s generated folder, with the header first', () => {
    expect(KEYS_PATH).toBe('apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/Keys.swift');
    expect(swift.split('\n')[0]).toBe(generatedHeader('packages/client/src/keys.ts'));
    expect(swift.endsWith('}\n')).toBe(true);
  });

  it('has every key, in the client’s order, and the store version', () => {
    const lines = swift.split('\n');
    const keys = (from: string) => {
      const start = lines.indexOf(`  public enum ${from} {`);
      const end = lines.indexOf('  }', start);
      return lines.slice(start + 1, end);
    };
    expect(keys('AppGroup')).toEqual(
      Object.entries(APP_GROUP_KEYS).map(([k, v]) => `    public static let ${k} = "${v}"`),
    );
    expect(keys('App')).toEqual(
      Object.entries(APP_KEYS).map(([k, v]) => `    public static let ${k} = "${v}"`),
    );
    expect(lines).toContain(`  public static let storeVersion = ${STORE_VERSION}`);
  });

  it('is the same every time, within 100 columns', () => {
    expect(keysSwift()).toBe(swift);
    for (const line of swift.split('\n')) expect(line.length).toBeLessThanOrEqual(100);
  });
});
