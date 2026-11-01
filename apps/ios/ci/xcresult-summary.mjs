#!/usr/bin/env node
/**
 * Markdown for the GitHub step summary from xcresulttool's JSON (iOS build spec, section 18.1),
 * so an agent reading a run sees what failed, and where, without opening the result bundle.
 * ci/test.sh runs it after each xcodebuild:
 *
 *   node xcresult-summary.mjs build <build-results.json>
 *   node xcresult-summary.mjs tests <plan> <summary.json> <tests.json>
 *   node xcresult-summary.mjs timings <attachments folder>
 *   node xcresult-summary.mjs attachment <attachments folder> <name>
 *
 * The JSON is `xcrun xcresulttool get build-results`, `get test-results summary` and
 * `get test-results tests` (Xcode 16 and later). A field that isn't there is left out, never
 * guessed, and a file that is missing or empty says so. `timings` reads the UI tests' audit
 * times (`…-audit-times` and `audit-<screen>-times`, one line a call: UITests/ScreenAudit.swift
 * `AuditTime`) from the attachments `xcresulttool export attachments` wrote, by their
 * manifest.json: `print` in a UI test reaches neither the log nor the result bundle. `attachment`
 * prints the path of the file an attachment was exported to, found by the name the test gave it
 * (`app-upgrade`, the review screenshot), as the export names each file by a UUID.
 */
import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
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

/** At most this many of the slowest audit calls are listed, with every call that timed out. */
export const SLOWEST = 10;

/**
 * An attachment's name without what xcresulttool adds: the extension, and an `_<n>_<UUID>`
 * suffix ("audit-settings-times_0_6F1C…-….txt" is "audit-settings-times"), as contact-sheet.mjs
 * reads it.
 */
export function attachmentLabel(name) {
  return basename(name, extname(name)).replace(/_\d+_[0-9A-Fa-f-]{36}$/, '');
}

/**
 * An audit times attachment's calls: each line after the columns is seconds, place, kinds,
 * issues and a note, tab-separated (`AuditTime.line`). A line that isn't one is skipped.
 */
export function auditCalls(text) {
  const calls = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const [seconds, place, kinds, issues, note = ''] = line.split('\t');
    if (!/^\d+(\.\d+)?$/.test(seconds ?? '') || place === undefined || kinds === undefined) {
      continue;
    }
    calls.push({
      seconds: Number(seconds),
      place,
      kinds,
      issues: /^\d+$/.test(issues ?? '') ? Number(issues) : null,
      note,
    });
  }
  return calls;
}

/**
 * Every audit call the tests attached, from an export's manifest.json (an array of tests, each
 * with its `testIdentifier` and `attachments`, each with its `exportedFileName` and
 * `suggestedHumanReadableName`), with its test; null without a manifest.
 */
export function readAuditTimes(folder) {
  const manifest = readJson(join(folder, 'manifest.json'));
  if (!Array.isArray(manifest)) return null;
  const calls = [];
  for (const test of manifest) {
    for (const a of test?.attachments ?? []) {
      if (
        !a?.exportedFileName ||
        !/-times$/.test(attachmentLabel(a.suggestedHumanReadableName ?? ''))
      ) {
        continue;
      }
      let text;
      try {
        text = readFileSync(join(folder, a.exportedFileName), 'utf8');
      } catch {
        continue;
      }
      for (const call of auditCalls(text)) calls.push({ test: test.testIdentifier ?? '', ...call });
    }
  }
  return calls;
}

/**
 * The audit calls' times: how many, the slowest `SLOWEST` and every call with a note (one that
 * timed out, ran again or failed), slowest first; and the time of each attempt that timed out
 * (-56), which says roughly how long XCTest's deadline is.
 */
export function timingSummary(calls) {
  if (!calls) return '### Audit times: no attachments manifest (see the log)\n';
  if (!calls.length) return '### Audit times: none attached\n';
  const sorted = [...calls].sort((a, b) => b.seconds - a.seconds);
  const shown = sorted.filter((c, i) => i < SLOWEST || c.note !== '');
  const tests = new Set(calls.map((c) => c.test)).size;
  const out = [
    `### Audit times: ${calls.length} call${calls.length === 1 ? '' : 's'} in ${tests} ` +
      `test${tests === 1 ? '' : 's'}, the slowest ${sorted[0].seconds.toFixed(1)} s`,
  ];
  const timedOut = calls.flatMap((c) =>
    [...c.note.matchAll(/timed out \(-56\) after (\d+(?:\.\d+)?) s/g)].map((m) => m[1]),
  );
  if (timedOut.length) {
    out.push(
      '',
      `Timed out (-56, "Audit failed to complete in time") after ${timedOut.join(' s, ')} s: ` +
        "about XCTest's deadline for a call.",
    );
  }
  out.push('', '| Seconds | Test | Where | Kinds | Issues | Note |', '|---|---|---|---|---|---|');
  out.push(
    ...shown.map(
      (c) =>
        `| ${c.seconds.toFixed(1)} | ${cell(c.test)} | ${cell(c.place)} | ${cell(c.kinds)} | ` +
        `${c.issues ?? ''} | ${cell(c.note)} |`,
    ),
  );
  return `${out.join('\n')}\n`;
}

/**
 * The file the first attachment named `name` (as `attachmentLabel` reads it) was exported to, from
 * an export's manifest.json; null without a manifest, or with no such attachment.
 */
export function attachmentFile(folder, name) {
  const manifest = readJson(join(folder, 'manifest.json'));
  if (!Array.isArray(manifest)) return null;
  for (const test of manifest) {
    for (const a of test?.attachments ?? []) {
      if (a?.exportedFileName && attachmentLabel(a.suggestedHumanReadableName ?? '') === name) {
        return join(folder, a.exportedFileName);
      }
    }
  }
  return null;
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
  } else if (kind === 'timings' && args.length === 1) {
    process.stdout.write(timingSummary(readAuditTimes(args[0])));
  } else if (kind === 'attachment' && args.length === 2) {
    const file = attachmentFile(args[0], args[1]);
    if (!file) {
      console.error(`xcresult-summary: no attachment named ${args[1]} in ${args[0]}`);
      process.exit(1);
    }
    process.stdout.write(`${file}\n`);
  } else {
    console.error(
      'usage: xcresult-summary.mjs build <json> | tests <plan> <summary> <tests> | ' +
        'timings <attachments> | attachment <attachments> <name>',
    );
    process.exit(2);
  }
}
