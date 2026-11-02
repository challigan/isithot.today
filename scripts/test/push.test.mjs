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
import pngjs from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';

const { PNG } = pngjs;

// apps/ios/ci/push.sh, run from a copy of the parts of the repo it uses, against a stand-in for
// xcrun (simctl's launch, push, screenshot, terminate and `spawn … log show`) and for sleep, on a
// clock of their own (BANNER_CLOCK, a file of seconds): each call moves it on by what that call
// takes on the runner, and a screenshot shows the screen as it is at that moment, with a banner
// over the app or the Home Screen for as long after each push as the scenario says, the app's
// page redrawn below the band, or the Home Screen dimmed all over. So the step's timings, main's
// on 1d643d3 among them, can be played in no time, without a simulator.
const repo = new URL('../../', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'push-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PAYLOAD =
  'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures/Payloads/evening.apns';
for (const path of ['apps/ios/ci/push.sh', 'apps/ios/ci/banner.mjs', PAYLOAD]) {
  if (!existsSync(join(repo, path))) continue;
  mkdirSync(join(root, path, '..'), { recursive: true });
  copyFileSync(join(repo, path), join(root, path));
}
const SCRIPT = join(root, 'apps/ios/ci/push.sh');
const shots = join(root, 'apps/ios/build/attachments/Push');
const state = join(root, 'state');
const bin = join(root, 'bin');
mkdirSync(bin);

// The screens, small: the app on Durham, the Home Screen, each with the banner over its top
// (rows 4 to 27 of 130, within the top quarter), the app redrawn below the band, with and
// without the banner, and the Home Screen dimmed all over, as under an alert.
const [W, H] = [60, 130];
function screen(colour, ...bands) {
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    const band = bands.findLast(([top, bottom]) => y >= top && y <= bottom);
    for (let x = 0; x < W; x++) png.data.set([...(band ? band[2] : colour), 255], (y * W + x) * 4);
  }
  return PNG.sync.write(png);
}
const BANNER = [4, 27, [230, 230, 235]];
const REDRAWN = [80, 90, [200, 40, 40]];
const images = join(root, 'images');
mkdirSync(images);
const SCREENS = {
  app: screen([40, 60, 120]),
  'app-banner': screen([40, 60, 120], BANNER),
  'app-redrawn': screen([40, 60, 120], REDRAWN),
  'app-redrawn-banner': screen([40, 60, 120], REDRAWN, BANNER),
  home: screen([10, 120, 60]),
  'home-banner': screen([10, 120, 60], BANNER),
  'home-dimmed': screen([5, 60, 30]),
};
for (const [name, png] of Object.entries(SCREENS)) writeFileSync(join(images, `${name}.png`), png);

// The stand-ins. xcrun: `simctl spawn … log show` prints the scenario's log, or a line of its
// own, and exits with its status; `launch` starts the app, writing the app's line to its
// --stdout file when the scenario has one; `push` notes when it began and over what, or fails
// when the scenario says; `io … screenshot` writes the screen as it is halfway through the
// call; `terminate` stops the app. Each call is noted in calls.log.
const fake = (name, body) => {
  writeFileSync(join(bin, name), `#!/usr/bin/env node\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};
const common = `
const fs = require('fs');
const path = require('path');
const state = process.env.FAKE_STATE;
const read = (name, fallback) => {
  const file = path.join(state, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
};
const write = (name, value) => fs.writeFileSync(path.join(state, name), JSON.stringify(value));
const clock = process.env.BANNER_CLOCK;
const now = () => Number(fs.readFileSync(clock, 'utf8'));
const advance = (seconds) => fs.writeFileSync(clock, String(now() + seconds));
const note = (line) => fs.appendFileSync(path.join(state, 'calls.log'), line + '\\n');
const scenario = read('scenario.json', {});
`;
fake(
  'xcrun',
  `${common}
const [, command, ...rest] = process.argv.slice(2);
if (command === 'spawn') {
  const [, tool, verb] = rest;
  const start = rest[rest.indexOf('--start') + 1];
  note(tool + ' ' + verb + (rest.includes('--start') ? ' --start ' + start : ''));
  const log = scenario.log ?? { status: 0, out: 'the simulator log of the step' };
  console.log(log.out);
  process.exit(log.status);
} else if (command === 'launch') {
  const stdout = rest.find((arg) => arg.startsWith('--stdout='));
  write('app.json', true);
  if (stdout && scenario.line !== null) {
    fs.writeFileSync(stdout.slice('--stdout='.length), (scenario.line ?? '') + '\\n');
  }
  note('launch' + (stdout ? ' --stdout' : ''));
  advance(scenario.launch ?? 1);
} else if (command === 'push') {
  const over = read('app.json', false) ? 'app' : 'home';
  const pushes = read('pushes.json', []);
  pushes.push({ at: now(), over });
  write('pushes.json', pushes);
  note('push ' + over);
  advance((scenario.pushTakes ?? {})[over] ?? 0.3);
  if (scenario.pushFails) {
    console.error('An error was encountered processing the command (code=1)');
    process.exit(1);
  }
  console.log("Notification sent to 'today.willitsnow.app'");
} else if (command === 'io') {
  const file = rest[2];
  const takes = scenario.shotTakes ?? 0.8;
  const at = now() + takes / 2;
  const over = read('app.json', false) ? 'app' : 'home';
  let name = over;
  const push = read('pushes.json', []).filter((p) => p.over === over).pop();
  if (push) {
    const since = at - push.at;
    const banner = (scenario.banner ?? {})[over];
    const redraw = (scenario.redraw ?? {})[over];
    const dim = (scenario.dim ?? {})[over];
    if (dim !== undefined && since >= dim) name += '-dimmed';
    if (redraw !== undefined && since >= redraw) name += '-redrawn';
    if (banner && since >= banner[0] && since < banner[1]) name += '-banner';
  }
  fs.copyFileSync(path.join(process.env.FAKE_IMAGES, name + '.png'), file);
  note('screenshot ' + name + ' ' + (push ? (at - push.at).toFixed(2) : '-'));
  advance(takes);
} else if (command === 'terminate') {
  write('app.json', false);
  note('terminate');
  advance(0.2);
} else {
  console.error('the stand-in has no simctl ' + command);
  process.exit(64);
}`,
);
fake('sleep', `${common}\nnote('sleep ' + process.argv[2]);\nadvance(Number(process.argv[2]));`);

const ALLOWED =
  'debug-notifications shown authorizationStatus=authorized alertSetting=enabled alertStyle=banner';

/** Runs push.sh on `scenario`: what it printed, how it ended, the calls and the shots kept. */
function run(scenario) {
  rmSync(state, { recursive: true, force: true });
  mkdirSync(state);
  const clock = join(state, 'clock');
  writeFileSync(clock, '0');
  writeFileSync(join(state, 'scenario.json'), JSON.stringify({ line: ALLOWED, ...scenario }));
  const summary = join(state, 'summary.md');
  const result = spawnSync('bash', [SCRIPT, 'UDID'], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      BANNER_CLOCK: clock,
      FAKE_STATE: state,
      FAKE_IMAGES: images,
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  const kept = (name) => {
    const file = join(shots, name);
    return existsSync(file) ? readFileSync(file) : null;
  };
  return {
    status: result.status,
    out: `${result.stdout}${result.stderr}`,
    calls: readFileSync(join(state, 'calls.log'), 'utf8').trim().split('\n'),
    app: kept('notification-banner-app.png'),
    home: kept('notification-banner-home.png'),
    summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
  };
}

/** The errors push.sh annotated, in order. */
const errors = (out) =>
  out
    .split('\n')
    .filter((line) => line.startsWith('::error::'))
    .map((line) => line.slice('::error::push.sh: '.length));

/** The warnings push.sh annotated, in order. */
const warnings = (out) =>
  out
    .split('\n')
    .filter((line) => line.startsWith('::warning::'))
    .map((line) => line.slice('::warning::push.sh: '.length));

describe('push.sh', () => {
  it('finds a banner that comes 4 s after the push, which one screenshot 2 s after it misses', () => {
    const result = run({ banner: { app: [4, 9], home: [4, 9] } });
    expect(errors(result.out)).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.app).toEqual(SCREENS['app-banner']);
    expect(result.home).toEqual(SCREENS['home-banner']);
    expect(result.summary).toBe(
      '### Notification banner: shown over the app and on the Home Screen (simctl push)\n',
    );
  });

  it('finds a banner shown from 0.4 to 5 s after a push call that takes 2.68 s', () => {
    // The push call's 2.68 s and the screenshot's 0.87 s are main's second push on 1d643d3, whose
    // one screenshot began 5.04 s after it. The banner's times are made up: nothing on record
    // shows main's banner was ever drawn, or for how long a banner stays.
    const result = run({
      banner: { app: [1, 6], home: [0.4, 5] },
      pushTakes: { app: 0.79, home: 2.68 },
      shotTakes: 0.87,
    });
    expect(errors(result.out)).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.home).toEqual(SCREENS['home-banner']);
  });

  it('waits for the banner to go before closing the app, so the Home Screen is at rest without it', () => {
    const result = run({ banner: { app: [4, 9], home: [4, 9] } });
    const terminate = result.calls.indexOf('terminate');
    const before = result.calls.slice(0, terminate).filter((call) => call.startsWith('screenshot'));
    expect(before.at(-1)).toMatch(/^screenshot app (9|1\d)\./);
    expect(result.calls).not.toContainEqual(expect.stringMatching(/^sleep/));
  });

  it('never takes the app redrawing below the banner for one', () => {
    const result = run({ redraw: { app: 1 }, banner: { home: [4, 9] }, shotTakes: 2 });
    expect(result.status).toBe(1);
    expect(result.app).toBeNull();
    expect(errors(result.out)[0]).toMatch(/^No banner over the app within 20 s of simctl push/);
  });

  it('sees the banner over the app as the page redraws below it, and its going from the band', () => {
    const result = run({ redraw: { app: 1 }, banner: { app: [4, 9], home: [4, 9] } });
    expect(errors(result.out)).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.app).toEqual(SCREENS['app-redrawn-banner']);
    expect(result.out).toMatch(/a banner: rows 4 to 27 .*; and \d+ pixels below the band/);
  });

  it('never takes the Home Screen dimmed all over for a banner', () => {
    const result = run({ banner: { app: [4, 9] }, dim: { home: 1 }, shotTakes: 2 });
    expect(result.status).toBe(1);
    expect(result.home).toBeNull();
    expect(errors(result.out)).toEqual([
      expect.stringMatching(/^No banner on the Home Screen within 20 s of simctl push/),
    ]);
    expect(result.out).toMatch(/no banner: rows 0 to 31 changed across the width down to/);
  });

  it("says so when the banner over the app hasn't gone 40 s after the push", () => {
    const result = run({ banner: { app: [4, 100], home: [4, 9] }, shotTakes: 2 });
    expect(result.status).toBe(1);
    expect(result.app).toEqual(SCREENS['app-banner']);
    expect(errors(result.out)).toEqual([
      expect.stringMatching(/^The banner over the app hadn't gone 40 s after simctl push/),
    ]);
  });

  it('ends at the banner on the Home Screen, as nothing follows it', () => {
    const result = run({ banner: { app: [4, 9], home: [4, 100] }, shotTakes: 2 });
    expect(errors(result.out)).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.home).toEqual(SCREENS['home-banner']);
    const pushed = result.calls.lastIndexOf('push home');
    const after = result.calls.slice(pushed).filter((call) => call.startsWith('screenshot'));
    expect(after.filter((call) => call.startsWith('screenshot home-banner'))).toHaveLength(1);
    expect(after.at(-1)).toMatch(/^screenshot home-banner /);
  });

  it('says when every screenshot was taken when no banner comes, and fails', () => {
    const result = run({ shotTakes: 2 });
    expect(result.status).toBe(1);
    expect(errors(result.out)).toEqual([
      expect.stringMatching(/^No banner over the app within 20 s of simctl push/),
      expect.stringMatching(/^No banner on the Home Screen within 20 s of simctl push/),
    ]);
    expect(result.out).toMatch(
      /No banner within 20 s: \d+ reads, begun at \+0\.30 s, \+2\.30 s, \+4\.30 s,/,
    );
    expect(result.summary).toBe('### Notification banner: failed (see the errors above)\n');
  });

  it('names the permission the app read, rather than guessing at it', () => {
    const line =
      'debug-notifications shown authorizationStatus=denied alertSetting=disabled alertStyle=none';
    const result = run({ line, shotTakes: 2 });
    expect(result.status).toBe(1);
    expect(errors(result.out)[0]).toBe(
      "Notifications aren't allowed on this simulator, as the app reads them: " +
        'authorizationStatus=denied alertSetting=disabled alertStyle=none ' +
        '(NotificationPermissionTests allows them at the prompt)',
    );
  });

  it("waits for the app's line, and when it never comes, says so and still pushes", () => {
    const result = run({ line: null, banner: { app: [4, 9], home: [4, 9] } });
    expect(result.status).toBe(1);
    expect(errors(result.out)).toEqual([
      "The app never said its answer was on screen within 60 s of its launch (Push/app-stdout.txt), so the permission it reads isn't known",
    ]);
    expect(result.calls.filter((call) => call.startsWith('push'))).toEqual([
      'push app',
      'push home',
    ]);
    expect(result.app).toEqual(SCREENS['app-banner']);
    expect(result.home).toEqual(SCREENS['home-banner']);
    expect(result.summary).toBe('### Notification banner: failed (see the errors above)\n');
  });

  it("reads the simulator's log of the step once both pushes are done, and keeps the app's output", () => {
    const result = run({ banner: { app: [4, 9], home: [4, 9] } });
    const reads = result.calls.filter((call) => call.startsWith('log '));
    expect(reads).toEqual([
      expect.stringMatching(/^log show --start \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/),
    ]);
    expect(result.calls.at(-1)).toBe(reads[0]);
    expect(readFileSync(join(shots, 'simulator.log'), 'utf8')).toBe(
      'the simulator log of the step\n',
    );
    expect(readFileSync(join(shots, 'app-stdout.txt'), 'utf8')).toBe(`${ALLOWED}\n`);
    expect(warnings(result.out)).toEqual([]);
  });

  it("warns when the simulator's log can't be read, and still judges the banners", () => {
    const result = run({
      banner: { app: [4, 9], home: [4, 9] },
      log: { status: 64, out: 'log: Invalid predicate' },
    });
    expect(result.status).toBe(0);
    expect(warnings(result.out)).toEqual([
      "The simulator's log couldn't be read (log show exited 64): log: Invalid predicate",
    ]);
  });

  it("reads the simulator's log when the step stops early too", () => {
    const result = run({ pushFails: true });
    expect(result.status).toBe(1);
    expect(errors(result.out)).toEqual(["simctl push couldn't deliver evening.apns (see the log)"]);
    expect(result.calls.at(-1)).toMatch(/^log show --start /);
    expect(readFileSync(join(shots, 'simulator.log'), 'utf8')).toBe(
      'the simulator log of the step\n',
    );
  });
});
