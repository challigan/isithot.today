#!/usr/bin/env node
/**
 * Markdown for the GitHub step summary from xcresulttool's JSON (iOS build spec, section 18.1),
 * so an agent reading a run sees what failed, and where, without opening the result bundle.
 * ci/test.sh runs it after each xcodebuild:
 *
 *   node xcresult-summary.mjs build <build-results.json>
 *   node xcresult-summary.mjs tests <plan> <summary.json> <tests.json>
 *
 * The JSON is `xcrun xcresulttool get build-results`, `get test-results summary` and
 * `get test-results tests` (Xcode 16 and later). A field that isn't there is left out, never
 * guessed, and a file that is missing or empty says so.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** At most this many rows in a table; the rest are counted. */
export const MAX_ROWS = 50;

/** Text safe inside a Markdown table cell. */
export function cell(text) {
  return String(text ?? '')
    .trim()
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

/**
 * Where an issue is, from its `sourceURL`
 * (`file:///…/apps/ios/App.swift#…&StartingLineNumber=11&…`): the path from `apps/ios/` when it
 * is under it, and the line. The URL counts lines from 0, so the line shown is one more.
 */
export function sourceLocation(url) {
  if (typeof url !== 'string' || url === '') return null;
  const [path, fragment = ''] = url.split('#');
  let file = decodeURIComponent(path.replace(/^file:\/\//, ''));
  const under = file.indexOf('/apps/ios/');
  if (under >= 0) file = file.slice(under + 1);
  const start = new URLSearchParams(fragment).get('StartingLineNumber');
  const line = start !== null && /^\d+$/.test(start) ? Number(start) + 1 : null;
  return line === null ? file : `${file}:${line}`;
}

function rows(items, render) {
  const shown = items.slice(0, MAX_ROWS).map(render);
  if (items.length > MAX_ROWS) shown.push(`| | | …and ${items.length - MAX_ROWS} more |`);
  return shown;
}

/** The build's outcome, then every error and the first warnings, each with its place. */
export function buildSummary(json) {
  if (!json) return '### Build: no build results (see the log)\n';
  const errors = json.errors ?? [];
  const warnings = json.warnings ?? [];
  const status = json.status ?? (errors.length ? 'failed' : 'unknown');
  const out = [
    `### Build: ${status}, ${errors.length} error${errors.length === 1 ? '' : 's'}, ` +
      `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
  ];
  const issues = [
    ...errors.map((e) => ({ kind: 'error', ...e })),
    ...warnings.map((w) => ({ kind: 'warning', ...w })),
  ];
  if (issues.length) {
    out.push('', '| | Where | Target | Message |', '|---|---|---|---|');
    out.push(
      ...rows(
        issues,
        (i) =>
          `| ${i.kind} | ${cell(sourceLocation(i.sourceURL) ?? '')} | ${cell(i.targetName)} | ` +
          `${cell(i.message)} |`,
      ),
    );
  }
  return `${out.join('\n')}\n`;
}

/**
 * Every failure in the test tree: the test it is in, and the place and message from the failure
 * node's name ("AppGroupTests.swift:24: XCTUnwrap failed: …").
 */
export function failures(tests) {
  const found = [];
  const walk = (node, test) => {
    if (!node || typeof node !== 'object') return;
    const here = node.nodeType === 'Test Case' ? (node.nodeIdentifier ?? node.name) : test;
    if (node.nodeType === 'Failure Message') {
      const match = /^(.+?):(\d+): ([\s\S]*)$/.exec(node.name ?? '');
      found.push(
        match
          ? { test: here, where: `${match[1]}:${match[2]}`, message: match[3] }
          : { test: here, where: '', message: node.name ?? '' },
      );
    }
    for (const child of node.children ?? []) walk(child, here);
  };
  for (const node of tests?.testNodes ?? []) walk(node, '');
  return found;
}

/** A test plan's counts, then each failure with its place. */
export function testSummary(plan, summary, tests) {
  if (!summary) return `### ${plan}: no test results (see the log)\n`;
  const count = (n) => (typeof n === 'number' ? n : '?');
  const out = [
    `### ${plan}: ${summary.result ?? 'unknown'}, ${count(summary.totalTestCount)} tests: ` +
      `${count(summary.passedTests)} passed, ${count(summary.failedTests)} failed, ` +
      `${count(summary.skippedTests)} skipped`,
  ];
  if (summary.skippedTests > 0) {
    out.push('', 'Tests were skipped. The spec never allows that (section 0.2).');
  }
  let found = failures(tests);
  if (!found.length) {
    found = (summary.testFailures ?? []).map((f) => ({
      test: f.testIdentifierString ?? f.testName ?? '',
      where: '',
      message: f.failureText ?? '',
    }));
  }
  if (found.length) {
    out.push('', '| Test | Where | Failure |', '|---|---|---|');
    out.push(...rows(found, (f) => `| ${cell(f.test)} | ${cell(f.where)} | ${cell(f.message)} |`));
  }
  return `${out.join('\n')}\n`;
}

/** The JSON in `path`, or null when it is missing, empty or not JSON. */
export function readJson(path) {
  try {
    const text = readFileSync(path, 'utf8');
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [kind, ...args] = process.argv.slice(2);
  if (kind === 'build' && args.length === 1) {
    process.stdout.write(buildSummary(readJson(args[0])));
  } else if (kind === 'tests' && args.length === 3) {
    process.stdout.write(testSummary(args[0], readJson(args[1]), readJson(args[2])));
  } else {
    console.error('usage: xcresult-summary.mjs build <json> | tests <plan> <summary> <tests>');
    process.exit(2);
  }
}
