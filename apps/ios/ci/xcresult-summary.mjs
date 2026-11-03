#!/usr/bin/env node
/**
 * Markdown for the GitHub step summary from xcresulttool's JSON (iOS build spec, section 18.1),
 * so an agent reading a run sees what failed, and where, without opening the result bundle.
 * ci/test.sh runs it after each xcodebuild:
 *
 *   node xcresult-summary.mjs build <build-results.json>
 *   node xcresult-summary.mjs tests <plan> <summary.json> <tests.json>
 *   node xcresult-summary.mjs timings <attachments folder>
 *   node xcresult-summary.mjs cancels <attachments folder>
 *   node xcresult-summary.mjs attachment <attachments folder> <name>
 *   node xcresult-summary.mjs ran <plan> <tests.json> <name>...
 *
 * The JSON is `xcrun xcresulttool get build-results`, `get test-results summary` and
 * `get test-results tests` (Xcode 16 and later). A field that isn't there is left out, never
 * guessed, and a file that is missing or empty says so. `timings` reads the UI tests' audit
 * times (`…-audit-times` and `audit-<screen>-times`, one line a call: UITests/ScreenAudit.swift
 * `AuditTime`) from the attachments `xcresulttool export attachments` wrote, by their
 * manifest.json: `print` in a UI test reaches neither the log nor the result bundle. `cancels`
 * lists every `gesture-cancelled` attachment (HomeScreens.swift's `cancelled`, one for each
 * gesture after which the app's count of touches the system cancelled rose), so a tap played
 * again shows in a passing run too. `attachment`
 * prints the path of the file an attachment was exported to, found by the name the test gave it
 * (`app-upgrade`, the review screenshot), as the export names each file by a UUID. `ran` checks
 * that each test an iteration run named (ci/test.sh's ONLY_TESTING) ran in the plan: it prints
 * nothing when each did, and otherwise says which didn't and exits 1, as xcodebuild runs a
 * misspelt class or method as nothing and passes.
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

/**
 * The names an iteration run gave (Target/Class or Target/Class/method, as ci/test.sh's
 * ONLY_TESTING has them) that ran no test in the test tree: each test case is named by its
 * bundle, its suite and itself without the "()" (WillItSnowUITests/NotificationsTests/
 * testWhereYouAre), and a name matches a test it is, or a class's tests.
 */
export function notRun(tests, names) {
  const ran = [];
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.nodeType === 'Test Case') {
      ran.push([...path, String(node.name ?? '').replace(/\(\)$/, '')].join('/'));
      return;
    }
    let inner = path;
    if (/test bundle$/i.test(node.nodeType ?? '')) inner = [node.name ?? ''];
    else if (node.nodeType === 'Test Suite') inner = [...path, node.name ?? ''];
    for (const child of node.children ?? []) walk(child, inner);
  };
  for (const node of tests?.testNodes ?? []) walk(node, []);
  return names.filter((name) => !ran.some((test) => test === name || test.startsWith(`${name}/`)));
}

/**
 * What `ran` says of a plan's run of the named tests: nothing when each ran, else which didn't;
 * and whether the step should pass.
 */
export function ranSummary(plan, tests, names) {
  if (!tests) {
    return {
      ok: false,
      text: `### ${plan}: no test tree, so the tests named (\`only\`) couldn’t be checked (see the log)\n`,
    };
  }
  const missing = notRun(tests, names);
  if (!missing.length) return { ok: true, text: '' };
  return {
    ok: false,
    text:
      `### ${plan}: no test ran for ${missing.join(', ')}, though named (\`only\`): a misspelt ` +
      'class or method, which xcodebuild runs as nothing\n',
  };
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
 * Every `gesture-cancelled` attachment the tests made, from an export's manifest.json, with its
 * test and its text (what was played, and `debug-cancels` before and after); null without a
 * manifest.
 */
export function readCancels(folder) {
  const manifest = readJson(join(folder, 'manifest.json'));
  if (!Array.isArray(manifest)) return null;
  const cancels = [];
  for (const test of manifest) {
    for (const a of test?.attachments ?? []) {
      if (
        !a?.exportedFileName ||
        attachmentLabel(a.suggestedHumanReadableName ?? '') !== 'gesture-cancelled'
      ) {
        continue;
      }
      try {
        const text = readFileSync(join(folder, a.exportedFileName), 'utf8').trim();
        cancels.push({ test: test.testIdentifier ?? '', text });
      } catch {
        continue;
      }
    }
  }
  return cancels;
}

/**
 * The touches the system cancelled, one row each: its test, and what was played with the counts
 * before and after. A tap that `watchedTap` played again passes its test, so only this says it
 * happened.
 */
export function cancelSummary(cancels) {
  const heading = '### Touches the system cancelled';
  if (!cancels) return `${heading}: no attachments manifest (see the log)\n`;
  if (!cancels.length) return `${heading}: none\n`;
  const tests = new Set(cancels.map((c) => c.test)).size;
  const out = [
    `${heading}: ${cancels.length} in ${tests} test${tests === 1 ? '' : 's'}`,
    '',
    "Each a gesture after which the app's `debug-cancels` rose (`gesture-cancelled`); a tap " +
      'or drag among them was played once more, and one cancelled twice fails its test. ' +
      "HomeTests' testASystemGestureCountsACancelledTouch cancels one on purpose; a control " +
      'cancelled run after run is a fault in the app, not the simulator.',
    '',
    '| Test | Played, and `debug-cancels` |',
    '|---|---|',
  ];
  const shown = cancels.slice(0, MAX_ROWS).map((c) => `| ${cell(c.test)} | ${cell(c.text)} |`);
  if (cancels.length > MAX_ROWS) shown.push(`| | …and ${cancels.length - MAX_ROWS} more |`);
  out.push(...shown);
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
  } else if (kind === 'cancels' && args.length === 1) {
    process.stdout.write(cancelSummary(readCancels(args[0])));
  } else if (kind === 'ran' && args.length >= 3) {
    const { ok, text } = ranSummary(args[0], readJson(args[1]), args.slice(2));
    process.stdout.write(text);
    // Not process.exit: on macOS a pipe's writes are asynchronous, and exiting could lose them.
    if (!ok) process.exitCode = 1;
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
        'timings <attachments> | cancels <attachments> | attachment <attachments> <name> | ' +
        'ran <plan> <tests> <name>...',
    );
    process.exit(2);
  }
}
