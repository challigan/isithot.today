/**
 * No `ViewThatFits` in what the app's accessibility audits see (DECISIONS, "The iPhone app in the
 * website's look": each element laid out once, with accessibility sizes a branch on
 * `isAccessibilitySize`, never `ViewThatFits`). A `ViewThatFits` of a row and a column holds two
 * copies of every view in it, and the audit's Dynamic Type and clipped-text checks failed both
 * times one reached a macOS run: the top bar's approximate line on PR #33's ("partially
 * unsupported"), and the notification card's buttons on PR #43's first ("partially unsupported"
 * at Large, "Text clipped" with no element at AX3). Each passed once its views were laid out once,
 * in a `FlowLayout` (IsItUI `Layouts.swift`). The widgets' faces (IsItWidgetUI) are left out:
 * no audit runs on a widget, and WidgetKit draws each size once.
 *
 * Code only: a line that is a comment, or the comment after code, may name `ViewThatFits`, as
 * Layouts.swift's and HomePager.swift's say why they don't use it. IsItUI has no block comments.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../apps/ios/', import.meta.url);

/** What the audits see: the app's own views and IsItUI's. */
const AUDITED = ['Apps/Snow/App', 'Packages/IsItKit/Sources/IsItUI'];

/** Every `.swift` file under `dir`. */
function swiftFiles(dir: string): string[] {
  return readdirSync(new URL(`${dir}/`, root)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(new URL(path, root)).isDirectory()) return swiftFiles(path);
    return name.endsWith('.swift') ? [path] : [];
  });
}

/** The lines of `swift` whose code uses `ViewThatFits`, as `path:line: text`; comments aside. */
export function viewThatFitsLines(path: string, swift: string): string[] {
  return swift.split('\n').flatMap((line, i) => {
    const code = line.trimStart();
    if (code.startsWith('//')) return [];
    const before = code.split('//')[0] ?? '';
    return /\bViewThatFits\b/.test(before) ? [`${path}:${i + 1}: ${code}`] : [];
  });
}

describe('the audited Swift', () => {
  it('finds ViewThatFits in code, and not in a comment', () => {
    const swift = [
      '/// Wraps, where `ViewThatFits` chooses between copies of it.',
      '  // not `ViewThatFits` between two copies of them',
      '    ViewThatFits(in: .horizontal) {',
      '    FlowLayout(spacing: 10, lineSpacing: 10) {  // not ViewThatFits',
      '    let fits = ViewThatFits { a; b }',
    ].join('\n');
    expect(viewThatFitsLines('X.swift', swift)).toEqual([
      'X.swift:3: ViewThatFits(in: .horizontal) {',
      'X.swift:5: let fits = ViewThatFits { a; b }',
    ]);
  });

  it('lays every view out once: no ViewThatFits', () => {
    const files = AUDITED.flatMap(swiftFiles);
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('Packages/IsItKit/Sources/IsItUI/NotificationCardView.swift');
    const found = files.flatMap((path) =>
      viewThatFitsLines(path, readFileSync(new URL(path, root), 'utf8')),
    );
    expect(found).toEqual([]);
  });
});
