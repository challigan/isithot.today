import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// apps/ios/ci/test.sh, run from a copy of the parts of the repo it reads (itself, the result
// summariser and the three test plans), against stand-ins for xcodebuild, which writes each
// call's arguments to a log and makes the result bundle, and for xcrun's xcresulttool, whose
// test tree holds the tests the scenario says ran (FAKE_RAN). So the UI plan's split between the
// ios job (`UI`, without the screen audits) and the audits job (`Audit`, only them) is checked
// without a Mac.
const repo = new URL('../../', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'test-sh-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

for (const path of [
  'apps/ios/ci/test.sh',
  'apps/ios/ci/xcresult-summary.mjs',
  'apps/ios/TestPlans/Unit.xctestplan',
  'apps/ios/TestPlans/UI.xctestplan',
  'apps/ios/TestPlans/StoreKit.xctestplan',
]) {
  mkdirSync(join(root, path, '..'), { recursive: true });
  copyFileSync(join(repo, path), join(root, path));
}
const SCRIPT = join(root, 'apps/ios/ci/test.sh');
const build = join(root, 'apps/ios/build');
const bin = join(root, 'bin');
const log = join(root, 'xcodebuild.log');
mkdirSync(bin);

function tool(name, body) {
  const path = join(bin, name);
  writeFileSync(path, `#!/usr/bin/env node\n${body}`);
  chmodSync(path, 0o755);
}
tool(
  'xcodebuild',
  `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
const bundle = args[args.indexOf('-resultBundlePath') + 1];
fs.mkdirSync(bundle, { recursive: true });
process.exitCode = Number(process.env.FAKE_STATUS || 0);
`,
);
tool(
  'xcrun',
  `const args = process.argv.slice(2).join(' ');
if (args.startsWith('xcresulttool get test-results tests')) {
  // The tests that ran, Target/Class/method, as the test tree names them.
  const bundles = new Map();
  for (const test of (process.env.FAKE_RAN || '').split(',').filter(Boolean)) {
    const [target, suite, method] = test.split('/');
    if (!bundles.has(target)) bundles.set(target, new Map());
    const suites = bundles.get(target);
    if (!suites.has(suite)) suites.set(suite, []);
    suites.get(suite).push({ name: method + '()', nodeType: 'Test Case', result: 'Passed' });
  }
  const children = [...bundles].map(([name, suites]) => ({
    name,
    nodeType: 'UI test bundle',
    children: [...suites].map(([suite, cases]) => ({
      name: suite,
      nodeType: 'Test Suite',
      children: cases,
    })),
  }));
  process.stdout.write(JSON.stringify({ testNodes: [{ name: 'Plan', nodeType: 'Test Plan', children }] }));
} else if (args.startsWith('xcresulttool get')) {
  process.stdout.write('{}');
}
`,
);

const AUDIT = 'WillItSnowUITests/HomeAuditTests/testLeedsDryAtAX3';
const NOTIFICATIONS = 'WillItSnowUITests/NotificationsTests/testWhereYouAre';

function run(what, { only = '', ran = '', status = 0 } = {}) {
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  // The runner's summary file is not this test's to write to.
  delete env.GITHUB_STEP_SUMMARY;
  Object.assign(env, {
    FAKE_LOG: log,
    FAKE_RAN: ran,
    FAKE_STATUS: String(status),
    ONLY_TESTING: only,
  });
  rmSync(log, { force: true });
  const result = spawnSync('bash', [SCRIPT, what, 'UDID'], { encoding: 'utf8', env });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  return { status: result.status, out: result.stdout + result.stderr, calls };
}

/** The test filters of an xcodebuild call, and its plan. */
function filters(call) {
  return {
    plan: call[call.indexOf('-testPlan') + 1],
    filters: call.filter((arg) => /^-(only|skip)-testing:/.test(arg)),
    bundle: call[call.indexOf('-resultBundlePath') + 1].replace(`${build}/`, ''),
  };
}

beforeEach(() => rmSync(build, { recursive: true, force: true }));

describe('test.sh: the UI plan in two jobs', () => {
  it('runs the UI plan without the screen audits for the ios job', () => {
    const { status, out, calls } = run('UI', { ran: NOTIFICATIONS });
    expect(status).toBe(0);
    // The sheets' and the picker's audit calls are timed here, as ever.
    expect(out).toContain('### Audit times');
    expect(calls.map(filters)).toEqual([
      {
        plan: 'UI',
        filters: ['-skip-testing:WillItSnowUITests/HomeAuditTests'],
        bundle: 'UI.xcresult',
      },
    ]);
  });

  it('runs only the screen audits, from the UI plan, for the audits job', () => {
    const { status, out, calls } = run('Audit', { ran: AUDIT });
    expect(status).toBe(0);
    expect(calls.map(filters)).toEqual([
      {
        plan: 'UI',
        filters: ['-only-testing:WillItSnowUITests/HomeAuditTests'],
        bundle: 'Audit.xcresult',
      },
    ]);
    expect(out).not.toContain('no test of');
    expect(out).toContain('### Audit times');
    expect(existsSync(join(build, 'attachments/Audit'))).toBe(true);
  });

  it('fails the audits when none of them ran, though xcodebuild passed', () => {
    const { status, out } = run('Audit', { ran: NOTIFICATIONS });
    expect(status).toBe(1);
    expect(out).toContain(
      '### Audit: no test of WillItSnowUITests/HomeAuditTests ran: renamed or moved?',
    );
  });

  it('keeps xcodebuild’s own failure', () => {
    expect(run('Audit', { ran: AUDIT, status: 65 }).status).toBe(65);
    expect(run('UI', { ran: NOTIFICATIONS, status: 65 }).status).toBe(65);
  });

  it('gives an iteration run’s names to the job each belongs to', () => {
    const only = `${NOTIFICATIONS},${AUDIT}`;
    const ran = only;
    const ui = run('UI', { only, ran });
    expect(ui.status).toBe(0);
    expect(ui.calls.map(filters)).toEqual([
      { plan: 'UI', filters: [`-only-testing:${NOTIFICATIONS}`], bundle: 'UI.xcresult' },
    ]);
    const audit = run('Audit', { only, ran });
    expect(audit.status).toBe(0);
    expect(audit.calls.map(filters)).toEqual([
      { plan: 'UI', filters: [`-only-testing:${AUDIT}`], bundle: 'Audit.xcresult' },
    ]);
    // The whole class is the audits job's too.
    const whole = run('Audit', { only: 'WillItSnowUITests/HomeAuditTests', ran: AUDIT });
    expect(whole.status).toBe(0);
    expect(whole.calls.map(filters)[0].filters).toEqual([
      '-only-testing:WillItSnowUITests/HomeAuditTests',
    ]);
  });

  it('runs nothing in a job none of whose tests an iteration run names', () => {
    const ui = run('UI', { only: AUDIT });
    expect(ui.status).toBe(0);
    expect(ui.calls).toEqual([]);
    expect(ui.out).toContain(`### UI: not run (ONLY_TESTING names none of its tests: ${AUDIT})`);
    const audit = run('Audit', { only: NOTIFICATIONS });
    expect(audit.status).toBe(0);
    expect(audit.calls).toEqual([]);
    expect(audit.out).toContain('### Audit: not run');
    expect(run('Unit', { only: `${NOTIFICATIONS},${AUDIT}` }).calls).toEqual([]);
  });

  it('fails an iteration run’s misspelt audit, as for any plan', () => {
    const misspelt = 'WillItSnowUITests/HomeAuditTests/testLeedsDryAtAX4';
    const { status, out } = run('Audit', { only: misspelt, ran: AUDIT });
    expect(status).toBe(1);
    expect(out).toContain(`no test ran for ${misspelt}`);
  });

  it('leaves the other plans as they were', () => {
    const unit = run('Unit', { ran: 'WillItSnowTests/AppGroupTests/testTheAppGroupOpens' });
    expect(unit.status).toBe(0);
    expect(unit.out).not.toContain('### Audit times');
    expect(unit.calls.map(filters)).toEqual([
      { plan: 'Unit', filters: [], bundle: 'Unit.xcresult' },
    ]);
    const storeKit = run('StoreKit', { ran: 'WillItSnowStoreKitTests/PurchaseTests/testBuys' });
    expect(storeKit.calls.map(filters)).toEqual([
      { plan: 'StoreKit', filters: [], bundle: 'StoreKit.xcresult' },
    ]);
    expect(run('Audits').status).toBe(2);
  });
});
