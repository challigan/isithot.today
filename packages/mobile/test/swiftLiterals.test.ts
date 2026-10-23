/**
 * No user-facing string literal in the app's Swift (iOS build spec, section 10, and phase 6's
 * exit): every word on screen and every accessibility label comes from the generated copy
 * (`CoreCopy`, `AppCopy`, `AppCredits`), the presenters that build on it, or the server's answer
 * through `Text(verbatim:)`. This reads every Swift file the app and its packages compile (not
 * the tests, which assert the words) and fails on a SwiftUI view or modifier given a literal.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
