/**
 * No user-facing string literal in the app's Swift (iOS build spec, section 10, Appendix D and
 * phase 6's exit): every word on screen and every accessibility label comes from the generated
 * copy (`CoreCopy`, `AppCopy`, `AppCredits`), the presenters that build on it, or the server's
 * answer through `Text(verbatim:)`. Two guards, both reading every Swift file the app and its
 * packages compile (not the tests, which assert the words):
 *
 * - no SwiftUI view or modifier is given a literal straight after its parenthesis, whatever it
 *   says (`Text("cm")` too), read line by line;
 * - no string literal anywhere outside the generated folders holds words for someone, unless the
 *   allowlist below says why it is never shown. The literals are read by `swiftLiterals`
 *   (packages/mobile `swiftLiterals.ts`), a lexer that knows Swift's comments, raw and
 *   multi-line strings and interpolations, and the call and argument label each literal belongs
 *   to. A literal with a letter in it is words when a view or label is given it, however
 *   (`Text(verbatim: "in")`, `Text(verbatim: "\(depth) cm")`, a `prompt:`); anywhere else, when
 *   it looks like prose: two words, one capitalised or sentence-ending word, or one word set
 *   beside other text with a space (`"ID " + prefix`).
 *
 * What still passes is one lowercase word or a symbol alone, outside any view (`let unit = "cm"`):
 * it can't be told from a key by its shape. The copy's own tests hold the words, and a view given
 * it fails the second guard. A stray word belongs in packages/mobile `appCopy.ts`, then
 * `pnpm mobile:generate`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { swiftLiterals, type SwiftLiteral } from '../src/swiftLiterals';

const root = new URL('../../../apps/ios/', import.meta.url);

/** What the app compiles: the app and widget, and the packages' sources. */
const SOURCES = [
  'Apps/Snow/App',
  'Apps/Snow/Widgets',
  'Packages/IsItKit/Sources',
  'Packages/IsItCore/Sources',
];

/**
 * A view or a modifier that shows its string argument, given a literal: `Text("Hi")` (a
 * `LocalizedStringKey`), `Button("OK") {…}`, `.navigationTitle("Settings")`,
 * `.accessibilityLabel("Close")`, `.searchable(text: $q, prompt: "Town")`. `Text(verbatim:)`
 * takes data, and is fine.
 */
const LITERAL = new RegExp(
  [
    String.raw`\b(Text|Label|Button|Toggle|Picker|Link|Section|TextField|SecureField|Menu|LabeledContent|NavigationLink|ProgressView|ShareLink|Announcement)\(\s*"`,
    String.raw`\.(navigationTitle|accessibilityLabel|accessibilityHint|accessibilityValue|help|alert|confirmationDialog|badge)\(\s*"`,
    // A label's literal that holds words; one that only interpolates data ("\(name) \(amount)")
    // words nothing of its own.
    String.raw`\b(prompt|title|message):\s*"(?!\\\()`,
  ].join('|'),
);

/** Every `.swift` file under `dir`. */
function swiftFiles(dir: string): string[] {
  return readdirSync(new URL(`${dir}/`, root)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(new URL(path, root)).isDirectory()) return swiftFiles(path);
    return name.endsWith('.swift') ? [path] : [];
  });
}

/** The lines of `swift` that give a view a literal, as `path:line: text`; comments aside. */
export function literalLines(path: string, swift: string): string[] {
  return swift.split('\n').flatMap((line, i) => {
    const code = line.trimStart();
    if (code.startsWith('//')) return [];
    return LITERAL.test(code) ? [`${path}:${i + 1}: ${code}`] : [];
  });
}

describe('the Swift sources', () => {
  it('give no view or label a string literal', () => {
    const files = SOURCES.flatMap(swiftFiles);
    expect(files.length).toBeGreaterThan(20);
    const found = files.flatMap((path) =>
      literalLines(path, readFileSync(new URL(path, root), 'utf8')),
    );
    expect(found).toEqual([]);
  });

  it('finds a literal however it is given, and allows data, symbols and identifiers', () => {
    for (const bad of [
      'Text("Settings")',
      'Button("OK") { done() }',
      '  .navigationTitle("Settings")',
      '.accessibilityLabel( "Close")',
      '.searchable(text: $query, prompt: "Town or city")',
      'Label("Copy", systemImage: "doc.on.doc")',
      'Section("About") {',
      'AccessibilityNotification.Announcement("Copied.").post()',
      '.alert("Report an ad", isPresented: $shown) {}',
      'Alert(title: "Report an ad")',
    ]) {
      expect(literalLines('x.swift', bad), bad).toEqual([`x.swift:1: ${bad.trimStart()}`]);
    }
    for (const fine of [
      'Text(verbatim: page.verdict)',
      'Text(AppCopy.settings)',
      'Image(systemName: "gearshape")',
      '.accessibilityIdentifier("settings")',
      '.font(.custom("BricolageAnswer", size: 64, relativeTo: .largeTitle))',
      '/// Reads `Text("x")` aloud.',
      'Button { open() } label: { Text(verbatim: row.title) }',
      'Bundle.main.url(forResource: name, withExtension: "txt")',
      'Dot(left: x, title: "\\(model.name) \\(amount)")',
    ]) {
      expect(literalLines('x.swift', fine), fine).toEqual([]);
    }
  });
});

/**
 * Where the prose guard looks: every Swift file under apps/ios, but these. Generated folders
 * hold the copy itself (`IsItModel/Generated`, `SnowKit/Generated`), written by
 * `pnpm mobile:generate` from the TypeScript, whose tests check its words. The test targets
 * (`Apps/Snow/Tests`, `Apps/Snow/UITests`, `Apps/Snow/StoreKitTests` and each package's `Tests`)
 * are never shipped: their literals are the words they expect on screen and their own failure
 * messages. Build output (`.build`, `.spm`, `build`, `DerivedData`, the generated `.xcodeproj`)
 * isn't source.
 */
const SKIPPED_FOLDER = /^(\..*|build|DerivedData|Generated|.*\.xcodeproj)$/;
const TEST_TARGET = /^(Apps\/Snow\/(Tests|UITests|StoreKitTests)|Packages\/[^/]+\/Tests)\//;

/** Every Swift file under apps/ios that ships, from the folders above. */
function shippedSwift(dir = ''): string[] {
  return readdirSync(new URL(dir ? `${dir}/` : './', root)).flatMap((name) => {
    const path = dir ? `${dir}/${name}` : name;
    if (statSync(new URL(path, root)).isDirectory()) {
      return SKIPPED_FOLDER.test(name) ? [] : shippedSwift(path);
    }
    return name.endsWith('.swift') && !TEST_TARGET.test(path) ? [path] : [];
  });
}

/**
 * A word as prose has it: letters, with an apostrophe or a hyphen inside ("isn't",
 * "one-off"), and the punctuation around it. A key, a path, a URL, a format specifier or a
 * number ("units", "/api/v1/search?", "mailto:", "%d", "HTTP/1.1") is a single token of
 * another shape, so it is no word.
 */
const WORD = /^[("“‘]?\p{L}+(?:['’-]\p{L}+)*[)"”’.,;:!?…]*$/u;
/** One capitalised word, as a label or a heading is ("Settings", "Copied."); not CamelCase. */
const CAPITALISED = /^[("“‘]?\p{Lu}\p{Ll}+(?:['’-]\p{Ll}+)*[)"”’.,;:!?…]*$/u;
/** One lowercase word that ends a sentence ("done."). */
const SENTENCE_END = /^\p{Ll}+[.!?…]$/u;

/**
 * Whether a literal's text reads as words for someone: two words or more ("Close the sheet",
 * "Not a view: {}"); one word set beside other text with a space, a piece of a sentence ("ID {}",
 * "{} cm", "ID " before a value); or one capitalised or sentence-ending word, alone among keys
 * and interpolations ("Settings", "Version {} ({})", "done."). Interpolations (`{}`) are data.
 */
export function looksLikeProse(text: string): boolean {
  const tokens = text.replaceAll('{}', ' ').split(/\s+/).filter(Boolean);
  const words = tokens.filter((t) => WORD.test(t));
  if (words.length >= 2) return true;
  if (words.length === 1 && /\s/.test(text)) return true;
  return words.some((w) => CAPITALISED.test(w) || SENTENCE_END.test(w));
}

/**
 * The calls that show or read out the string they are given unlabelled: SwiftUI's views and
 * modifiers (the first guard's), and the announcement VoiceOver reads.
 */
const SHOWN_BY = new Set([
  'Text',
  'Label',
  'Button',
  'Toggle',
  'Picker',
  'Link',
  'Section',
  'TextField',
  'SecureField',
  'Menu',
  'LabeledContent',
  'NavigationLink',
  'ProgressView',
  'ShareLink',
  'Announcement',
  'navigationTitle',
  'accessibilityLabel',
  'accessibilityHint',
  'accessibilityValue',
  'help',
  'alert',
  'confirmationDialog',
  'badge',
]);
/** The argument labels whose string is shown, whatever the call: `Text(verbatim:)`, a prompt. */
const SHOWN_AS = new Set(['verbatim', 'prompt', 'title', 'message']);

/**
 * Whether `literal` is given to a view or a label to show or read out: then any letter in it is
 * a word for someone, whatever its shape (`Text(verbatim: "in")`). UIKit's announcement
 * (`UIAccessibility.post(notification:argument:)`) reads its argument.
 */
export function shown(literal: SwiftLiteral): boolean {
  if (SHOWN_AS.has(literal.label)) return true;
  if (literal.callee === 'post' && literal.label === 'argument') return true;
  return SHOWN_BY.has(literal.callee) && literal.label === '';
}

/**
 * The allowlist: literals that look like prose but are never shown or read out. By the call
 * a literal is an argument of, whatever it says:
 */
const NEVER_SHOWN_IN: Record<string, string> = {
  // A UI test's handle on a view. VoiceOver never reads it, and nothing shows it.
  accessibilityIdentifier: 'an accessibility identifier',
  // A crash's message, for whoever reads the log: DebugHooks.swift's bad launch arguments and
  // fixtures, which stop a Debug build so that a UI test can't pass on the wrong screen.
  fatalError: "a crash's message",
  preconditionFailure: "a crash's message",
  assertionFailure: "a crash's message",
  precondition: "a crash's message",
  assert: "a crash's message",
  // A folder in the app's container or bundle ("Library", "Caches", "Search").
  appendingPathComponent: 'a folder',
};

/** By its argument label, whatever the call: */
const NEVER_SHOWN_AS: Record<string, string> = {
  // A DecodingError's description, for the developer: an answer that doesn't decode shows
  // `CoreCopy.unavailable`, never the error (APIClient's FetchError carries no text of its own).
  debugDescription: "a decoding error's description",
  // A file or folder in the bundle (`Bundle.url(forResource:withExtension:subdirectory:)`):
  // "Fixtures".
  forResource: 'a file in the bundle',
  withExtension: 'a file in the bundle',
  subdirectory: 'a folder in the bundle',
  // An Info.plist key ("CFBundleShortVersionString").
  forInfoDictionaryKey: 'an Info.plist key',
  // An SF Symbol's name ("gearshape").
  systemName: "an SF Symbol's name",
};

/** And these words, each a name where it is used, never shown: */
const NAMES: Record<string, string> = {
  // The HTTP request header APIClient sends (`Accept: application/json`).
  Accept: 'an HTTP header',
  // JavaScript's `String(n)` for an infinite number, which JavaScriptNumber ports for keys and
  // queries (never on screen).
  Infinity: "JavaScript's text for a number",
  // SnowKit's folder of PNG glyphs, which IsItKit's manifest leaves out (`exclude:`).
  Fallback: 'a folder in a package',
};

/** Why `literal` may say what it does, or nil when it is words with no reason to be. */
export function allowed(literal: SwiftLiteral): string | undefined {
  if (shown(literal)) return /\p{L}/u.test(literal.text) ? undefined : 'no words';
  if (!looksLikeProse(literal.text)) return 'not prose';
  return NEVER_SHOWN_IN[literal.callee] ?? NEVER_SHOWN_AS[literal.label] ?? NAMES[literal.text];
}

/** The prose literals in `swift` with no reason to be there, as `path:line: "text"`. */
export function proseLines(path: string, swift: string): string[] {
  return swiftLiterals(swift)
    .filter((literal) => allowed(literal) === undefined)
    .map((literal) => `${path}:${literal.line}: ${JSON.stringify(literal.text)}`);
}

describe('the Swift sources, outside the generated copy', () => {
  it('hold no literal that looks like prose, but what the allowlist says is never shown', () => {
    const files = shippedSwift();
    // Every folder that ships is read, and none of the tests.
    for (const folder of [...SOURCES, 'Packages/IsItKit/Package.swift']) {
      expect(
        files.some((f) => f.startsWith(folder)),
        folder,
      ).toBe(true);
    }
    expect(files.some((f) => f.includes('/Generated/') || TEST_TARGET.test(f))).toBe(false);
    // The test targets left out: the app's three and each package's, and nothing that ships.
    for (const folder of [
      'Apps/Snow/Tests',
      'Apps/Snow/UITests',
      'Apps/Snow/StoreKitTests',
      'Packages/IsItCore/Tests',
    ]) {
      expect(TEST_TARGET.test(`${folder}/A.swift`), folder).toBe(true);
    }
    for (const folder of SOURCES) expect(TEST_TARGET.test(`${folder}/A.swift`), folder).toBe(false);
    expect(files.length).toBeGreaterThan(60);
    const found = files.flatMap((path) =>
      proseLines(path, readFileSync(new URL(path, root), 'utf8')),
    );
    expect(found).toEqual([]);
  });

  it('every allowlisted name is still used, so the list says what the code holds', () => {
    const literals = shippedSwift().flatMap((path) =>
      swiftLiterals(readFileSync(new URL(path, root), 'utf8')),
    );
    for (const name of Object.keys(NAMES)) {
      expect(
        literals.some((l) => l.text === name),
        name,
      ).toBe(true);
    }
  });

  it('tells prose from keys, identifiers, URLs and format specifiers', () => {
    for (const prose of [
      'Settings',
      'Copied.',
      'done.',
      'Close the sheet',
      "You're offline. Showing the forecast from {}.",
      'Version {} ({})',
      'Place: {}. Change place.',
      'label BEGINSWITH %@',
      '“Recent”',
      'One-off',
      // One word beside a value, with a space: a piece of a sentence.
      'ID {}',
      '{} cm',
      '{} of {}',
      'ID ',
    ]) {
      expect(looksLikeProse(prose), prose).toBe(true);
    }
    for (const data of [
      '',
      'units',
      'cm',
      '-resetStore',
      'recent-heading',
      'result-{}',
      'IsItCore',
      'CFBundleShortVersionString',
      'Content-Type',
      'GET',
      'HTTP/1.1',
      'application/json',
      '/api/v1/search?',
      'mailto:',
      'https://willitsnow.today',
      'willitsnow://',
      'point:{},{}',
      '{} {}',
      '{}, {}',
      ', ',
      '%d',
      '%.1f',
      '%@ %@',
      'Z',
      'e+',
      'NaN',
      'location.fill',
    ]) {
      expect(looksLikeProse(data), data).toBe(false);
    }
  });

  it('finds prose wherever it is, and allows it only where it is never shown', () => {
    const found = (swift: string) => proseLines('x.swift', swift);
    expect(found('let title = "Settings"')).toEqual(['x.swift:1: "Settings"']);
    expect(found('Text(verbatim: "Close the sheet")')).toEqual(['x.swift:1: "Close the sheet"']);
    expect(found('let a = 1\nlabel = flag ? "On" : "Off"')).toEqual([
      'x.swift:2: "On"',
      'x.swift:2: "Off"',
    ]);
    // Inside an interpolation, and in a raw or multi-line literal.
    expect(found('let s = "\\(ok ? "Done." : "x")"')).toEqual(['x.swift:1: "Done."']);
    expect(found('let s = #"Say "hi" there"#')).toEqual(['x.swift:1: "Say \\"hi\\" there"']);
    expect(found('let s = """\n  Two words\n  and more\n  """')).toEqual([
      'x.swift:1: "Two words\\nand more"',
    ]);
    // A view given words, even inside a call that may hold names.
    expect(found('fatalErrorView(message: "Something went wrong")')).toEqual([
      'x.swift:1: "Something went wrong"',
    ]);
    // Never shown: a crash's message, an identifier, a decoding error, a bundle's file, a name.
    expect(found('fatalError("-now: \\(text) isn\'t an ISO 8601 moment")')).toEqual([]);
    expect(found('fatalError(\n  "The app has no fixtures"\n)')).toEqual([]);
    expect(found('.accessibilityIdentifier("Close")')).toEqual([]);
    expect(
      found('throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not a view: \\(t)")'),
    ).toEqual([]);
    expect(found('Bundle.main.url(forResource: "Fixtures", withExtension: nil)')).toEqual([]);
    expect(found('folder.appendingPathComponent("Search", isDirectory: true)')).toEqual([]);
    expect(found('request.setValue("application/json", forHTTPHeaderField: "Accept")')).toEqual([]);
    // The call is the literal's own: a closure inside an allowed call is not allowed.
    expect(found('fatalError(describe { "Two words" })')).toEqual(['x.swift:1: "Two words"']);
    // Comments are not code.
    expect(found('// Settings\n/* A /* nested */ comment */ let x = 1')).toEqual([]);
  });

  it('finds a word given to a view however it is written, and one set beside a value', () => {
    // Both guards, as the Swift is held to them.
    const flagged = (swift: string) => [
      ...literalLines('x.swift', swift),
      ...proseLines('x.swift', swift),
    ];
    for (const bad of [
      'Text(verbatim: "\\(depth) cm")',
      'Text(verbatim: "in")',
      '.accessibilityLabel(Text(verbatim: "close"))',
      'Text(verbatim: "\\(snowy) of \\(total)")',
      'Text(verbatim: "ID \\(prefix)")',
      'let line = "ID " + prefix',
      'Label("copy", systemImage: "doc.on.doc")',
      'TextField(text: $query, prompt: Text(verbatim: "town"))',
      'UIAccessibility.post(notification: .announcement, argument: "copied")',
    ]) {
      expect(flagged(bad), bad).not.toEqual([]);
    }
    for (const fine of [
      'Text(verbatim: page.verdict)',
      'Text(verbatim: "\\(model.name) \\(amount)")',
      'Text(verbatim: ", ")',
      'Label(title, systemImage: "doc.on.doc")',
      '.accessibilityIdentifier("result-\\(row.id)")',
      'let key = "city:\\(slug)"',
      // The limit: one lowercase word alone, outside any view, is a key by its shape.
      'let unit = "cm"',
    ]) {
      expect(flagged(fine), fine).toEqual([]);
    }
  });
});

describe('swiftLiterals', () => {
  it('reads each literal with its line, its text, its call and its label', () => {
    const swift = [
      'Text(verbatim: "one")',
      '  .accessibilityIdentifier("two")',
      'let x = Foo.bar(3, name: "three", ["four": "five"]) { "six" }',
    ].join('\n');
    expect(swiftLiterals(swift)).toEqual([
      { line: 1, text: 'one', callee: 'Text', label: 'verbatim' },
      { line: 2, text: 'two', callee: 'accessibilityIdentifier', label: '' },
      { line: 3, text: 'three', callee: 'bar', label: 'name' },
      { line: 3, text: 'four', callee: '', label: '' },
      { line: 3, text: 'five', callee: '', label: '' },
      { line: 3, text: 'six', callee: '', label: '' },
    ]);
  });

  it('reads escapes, interpolations, raw literals and multi-line literals as Swift does', () => {
    const texts = (swift: string) => swiftLiterals(swift).map((l) => l.text);
    expect(texts(String.raw`"a\"b\\c\n\t\r\0\u{e9}"`)).toEqual(['a"b\\c\n\t\r\0é']);
    expect(texts(String.raw`"\(a) and \(f(b, "c")) \(d["e"] ?? "f")"`)).toEqual([
      '{} and {} {}',
      'c',
      'e',
      'f',
    ]);
    expect(texts(String.raw`#"a "quoted" \n \#(x) \#n"#`)).toEqual(['a "quoted" \\n {} \n']);
    expect(texts('##"a "# b"##')).toEqual(['a "# b']);
    expect(texts('"""\n    one\n      two \\\n    three\n    """')).toEqual(['one\n  two three']);
    expect(texts('#"""\n  a """ b\n  """#')).toEqual(['a """ b']);
    // `#if` and other directives, key paths and division are code.
    expect(texts('#if DEBUG\nlet k = \\Foo.bar\nlet r = a / b\n#endif')).toEqual([]);
  });

  it('skips comments, nested block comments included', () => {
    expect(swiftLiterals('// "a"\n/* "b" /* "c" */ "d" */\nlet e = "e" // "f"')).toEqual([
      { line: 3, text: 'e', callee: '', label: '' },
    ]);
  });

  it('fails on what it cannot close, rather than misread what follows', () => {
    expect(() => swiftLiterals('let a = "open\nlet b = 1')).toThrow(
      'An unclosed string literal at line 1',
    );
    expect(() => swiftLiterals('let a = """\nopen')).toThrow(
      'An unclosed string literal at line 1',
    );
    expect(() => swiftLiterals('let a = "\\(b"')).toThrow('An unclosed string literal');
    expect(() => swiftLiterals('let a = 1\n/* open')).toThrow(
      'An unclosed block comment at line 2',
    );
    expect(() => swiftLiterals('f(a]')).toThrow('An unmatched ] at line 1');
    expect(() => swiftLiterals('f(a')).toThrow('An unclosed ) bracket');
  });
});
