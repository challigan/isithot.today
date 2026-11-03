#!/usr/bin/env node
/**
 * The banner step's waits (ci/push.sh), each a condition read from the simulator's screen or the
 * app's own output, never a guessed time. Every read prints its time, in seconds since the push
 * where there is one, so the step log shows when each screenshot was taken and what it found:
 *
 *   node banner.mjs line <file> <prefix> --within <s>
 *       Reads <file> four times a second until a line starts with <prefix>, and prints it: the
 *       app's own line on its standard output (`debug-notifications shown …`, DebugHooks).
 *   node banner.mjs settle <udid> <out.png> --within <s>
 *       Takes screenshots until two in a row are the same, pixel for pixel, and keeps the last
 *       as <out.png>: the screen at rest, the baseline a banner is looked for against.
 *   node banner.mjs push <udid> <bundle id> <payload> <baseline.png> <out.png> --within <s>
 *     [--gone <s>]
 *       Runs `simctl push`, then takes screenshots one after another until one shows a banner
 *       against <baseline.png> (`banner`), and keeps it as <out.png>. With --gone, then takes
 *       screenshots until the banner's band is the same as <baseline.png>'s again, the banner
 *       gone, for up to --gone seconds after the push: over the app, so the Home Screen's
 *       baseline is taken without it. Every read is timed from the push.
 *
 * A banner, over the app or on the Home Screen alike, is a block of rows within the banner's
 * band (the top quarter of the screen), each changed in most of its width (`ACROSS`), at least
 * `BLOCK` of the screen's height tall, and ending above the band's foot. On the runner's iPhone
 * 17 (1206 by 2622 pixels) the passing runs' banners are such a block, rows 152 to 499 over the
 * app and 152 to 529 on the Home Screen, against a band of rows 0 to 654 (DECISIONS). So the
 * app's own redraw below the band never counts, nor stops a banner counting; nor does a change
 * in the status bar or a row of icons, which never spans the width; nor a screen dimmed or
 * changed all over, by an alert or SpringBoard restarting, which reaches the band's foot.
 *
 * Each exits 0 once its condition holds, and 1 when <s> seconds pass first: a deadline that is
 * only a reporting limit, after which it says every read it made and when. `push` exits 1 when
 * no banner came, 4 when one came and hadn't gone, and 3 when `simctl push` itself failed.
 * Screenshots are PNGs as `simctl io screenshot` writes them (8-bit RGB or RGBA, not
 * interlaced), read here with node:zlib alone, as the ios job installs no packages.
 *
 * BANNER_CLOCK, for scripts/test/push.test.mjs only: a file holding the time in seconds, which
 * the test's stand-ins for simctl move on, read in place of the process's clock.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

/** The banner's band: the top quarter of the screen, rows 0 to 654 of the runner's 2,622. */
export const BAND = 0.25;

/**
 * A row changed across the width: changed in at least this share of its pixels. A banner's rows
 * are, edge to edge but for its margins (over 95% of the width); a row of four icons is about
 * 63%, a status bar's text and icons less.
 */
export const ACROSS = 0.8;

/**
 * A banner's least height, as a share of the screen's: 132 rows on the runner, where the passing
 * runs' banners changed 348 and 378 rows in a block.
 */
export const BLOCK = 0.05;

/** The time in seconds: BANNER_CLOCK's, or the process's own. */
export function now() {
  const clock = process.env.BANNER_CLOCK;
  return clock ? Number(readFileSync(clock, 'utf8')) : performance.now() / 1000;
}

/** Waits `seconds`, the poll between two reads of a file. */
export function pause(seconds) {
  const clock = process.env.BANNER_CLOCK;
  if (clock) {
    writeFileSync(clock, String(now() + seconds));
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

/** `seconds` as the step log shows it: "+3.27 s". */
export const stamp = (seconds) => `+${seconds.toFixed(2)} s`;

/**
 * A PNG's pixels: width, height and RGBA bytes, row by row. Only what `simctl io screenshot`
 * writes: 8 bits a channel, RGB (colour type 2) or RGBA (6), not interlaced; anything else
 * throws.
 */
export function decodePng(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, i) => bytes[i] === byte)) throw new Error('not a PNG');
  let offset = 8;
  let header;
  const data = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colour: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error('no IHDR');
  const { width, height, depth, colour, interlace } = header;
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
    throw new Error(`a PNG of bit depth ${depth}, colour type ${colour}, interlace ${interlace}`);
  }
  const channels = colour === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length !== height * (stride + 1)) throw new Error('the image data is the wrong size');
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    if (filter > 4) throw new Error(`row ${y} has filter ${filter}`);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= channels ? up[x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = (line[x] + predicted) & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: rows };
  const rgba = Buffer.alloc(width * height * 4, 0xff);
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    rgba[j] = rows[i];
    rgba[j + 1] = rows[i + 1];
    rgba[j + 2] = rows[i + 2];
  }
  return { width, height, data: rgba };
}

/**
 * How `sample` differs from `base` in its rows above `rows` (all of them by default): null when
 * every pixel there is the same; otherwise the rows and columns the changed pixels span, and how
 * many changed (-1 for a screen of another size, all of it changed).
 */
export function difference(base, sample, rows = sample.height) {
  if (base.width !== sample.width || base.height !== sample.height) {
    return { top: 0, bottom: sample.height - 1, left: 0, right: sample.width - 1, pixels: -1 };
  }
  let top = -1;
  let bottom = -1;
  let left = base.width;
  let right = -1;
  let pixels = 0;
  for (let y = 0; y < Math.min(rows, base.height); y++) {
    for (let x = 0; x < base.width; x++) {
      if (changed(base, sample, (y * base.width + x) * 4)) {
        pixels++;
        if (top < 0) top = y;
        bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (pixels === 0) return null;
  return { top, bottom, left, right, pixels };
}

/** Whether the pixel at byte `i` differs between two images of one size. */
function changed(base, sample, i) {
  return (
    base.data[i] !== sample.data[i] ||
    base.data[i + 1] !== sample.data[i + 1] ||
    base.data[i + 2] !== sample.data[i + 2] ||
    base.data[i + 3] !== sample.data[i + 3]
  );
}

/** What a difference from `against` ("the baseline", "the read before") says in the step log. */
export function describe(change, against) {
  if (!change) return `the same as ${against}`;
  if (change.pixels < 0) return `a screen of another size than ${against}`;
  const where = `rows ${change.top} to ${change.bottom}, columns ${change.left} to ${change.right}`;
  return `${change.pixels} pixels unlike ${against}, ${where}`;
}

/**
 * Whether `sample` shows a banner against `base` (the module's comment): `held`; the band's last
 * row (`foot`); the tallest block of rows in the band each changed across the width (`block`,
 * [top, bottom], or null), and the least height a banner takes (`least`, rows); how the band
 * differs (`inBand`, as `difference` says); and how many pixels differ below the band (`below`,
 * -1 for a screen of another size).
 */
export function banner(base, sample) {
  const foot = Math.floor(sample.height * BAND) - 1;
  const least = Math.ceil(sample.height * BLOCK);
  if (base.width !== sample.width || base.height !== sample.height) {
    return { held: false, foot, block: null, least, inBand: difference(base, sample), below: -1 };
  }
  let block = null;
  let start = -1;
  for (let y = 0; y <= foot + 1; y++) {
    let count = 0;
    if (y <= foot) {
      for (let x = 0; x < sample.width; x++) {
        if (changed(base, sample, (y * sample.width + x) * 4)) count++;
      }
    }
    const across = y <= foot && count >= ACROSS * sample.width;
    if (across && start < 0) start = y;
    if (!across && start >= 0) {
      if (!block || y - 1 - start > block[1] - block[0]) block = [start, y - 1];
      start = -1;
    }
  }
  let below = 0;
  for (let i = (foot + 1) * sample.width * 4; i < sample.data.length; i += 4) {
    if (changed(base, sample, i)) below++;
  }
  const held = block !== null && block[1] - block[0] + 1 >= least && block[1] < foot;
  return { held, foot, block, least, inBand: difference(base, sample, foot + 1), below };
}

/** What `banner`'s read says in the step log. */
export function sayBanner(read) {
  if (read.below < 0) return `no banner: ${describe(read.inBand, 'the baseline')}`;
  const rows = read.block && `rows ${read.block[0]} to ${read.block[1]}`;
  let said;
  if (read.held) {
    said = `a banner: ${rows} changed across the width, within the banner's band (rows 0 to ${read.foot})`;
  } else if (!read.inBand) {
    said = 'no banner: the band the same as the baseline';
  } else if (!read.block) {
    said = `no banner: nothing in the band changed across the width (${describe(read.inBand, 'the baseline')})`;
  } else if (read.block[1] >= read.foot) {
    said = `no banner: ${rows} changed across the width down to the band's foot, as a screen dimmed or redrawn all over is`;
  } else {
    const tall = read.block[1] - read.block[0] + 1;
    said = `no banner: ${rows} changed across the width, ${tall} rows, fewer than the ${read.least} a banner takes`;
  }
  return read.below > 0 ? `${said}; and ${read.below} pixels below the band` : said;
}

/** Runs `xcrun` with `args`, giving its status and output. */
function xcrun(args) {
  const result = spawnSync('xcrun', args, { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/**
 * Takes screenshots of the simulator `udid` one after another until `judge(image)` holds, for
 * up to `within` seconds after `since`, printing each read's number, when its screenshot began
 * and ended (from `since`) and what `judge` found; the screenshot it held for is kept in `keep`.
 * Whether it held; when it didn't, the last line lists when every read began.
 */
function sample(udid, { since, within, keep, judge, what }) {
  const work = mkdtempSync(join(tmpdir(), 'banner-'));
  const began = [];
  try {
    for (let n = 1; ; n++) {
      const file = join(work, `${n}.png`);
      const start = now() - since;
      const shot = xcrun(['simctl', 'io', udid, 'screenshot', file]);
      const end = now() - since;
      began.push(stamp(start));
      let verdict;
      if (shot.status !== 0 || !existsSync(file)) {
        verdict = { held: false, found: `no screenshot: ${shot.output}` };
      } else {
        try {
          verdict = judge(decodePng(readFileSync(file)));
        } catch (error) {
          verdict = { held: false, found: `the screenshot can't be read: ${error.message}` };
        }
      }
      console.log(`read ${n}, ${stamp(start)} to ${stamp(end)}: ${verdict.found}`);
      if (verdict.held) {
        if (keep) copyFileSync(file, keep);
        return true;
      }
      if (end >= within) {
        console.log(`${what} within ${within} s: ${n} reads, begun at ${began.join(', ')}`);
        return false;
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** `line`: the first line of `file` that starts with `prefix`, read four times a second. */
export function awaitLine(file, prefix, within) {
  const since = now();
  for (let reads = 1; ; reads++) {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const line = text.split('\n').find((candidate) => candidate.startsWith(prefix));
    if (line !== undefined) {
      console.log(`read ${reads}, ${stamp(now() - since)}: ${line}`);
      return line;
    }
    if (now() - since >= within) {
      const last = text.trim().split('\n').slice(-3).join(' | ') || 'nothing';
      console.log(`No line starting "${prefix}" within ${within} s, ${reads} reads; last: ${last}`);
      return null;
    }
    pause(0.25);
  }
}

/** `settle`: screenshots until two in a row are the same, the last kept in `out`. */
export function settle(udid, out, within) {
  let previous = null;
  return sample(udid, {
    since: now(),
    within,
    keep: out,
    what: 'No two screenshots in a row the same',
    judge: (image) => {
      const first = previous === null;
      const change = first ? null : difference(previous, image);
      previous = image;
      return {
        held: !first && change === null,
        found: first ? 'the first read' : describe(change, 'the read before'),
      };
    },
  });
}

/**
 * `push`: `simctl push`, then screenshots until one shows a banner against `baseline` (`banner`),
 * for up to `within` seconds after the push, kept in `out`; then, when `gone` is given,
 * screenshots until the banner's band is the same as `baseline`'s again, for up to `gone` seconds
 * after the push. "seen", when `gone` isn't given; "gone"; "unseen", no banner; "stayed", a banner
 * that hadn't gone; or "push" when `simctl push` failed.
 */
export function pushAndLook(udid, bundle, payload, baseline, out, within, gone) {
  const base = decodePng(readFileSync(baseline));
  const since = now();
  console.log(`${stamp(0)}: simctl push of ${payload}`);
  const pushed = xcrun(['simctl', 'push', udid, bundle, payload]);
  console.log(
    `${stamp(now() - since)}: simctl push ended, status ${pushed.status}: ${pushed.output}`,
  );
  if (pushed.status !== 0) return 'push';
  const seen = sample(udid, {
    since,
    within,
    keep: out,
    what: 'No banner',
    judge: (image) => {
      const read = banner(base, image);
      return { held: read.held, found: sayBanner(read) };
    },
  });
  if (!seen) return 'unseen';
  if (gone === undefined) return 'seen';
  console.log("The banner seen; screenshots until the banner's band is the baseline's again");
  const rows = Math.floor(base.height * BAND);
  const went = sample(udid, {
    since,
    within: gone,
    what: "The banner's band never came back to the baseline's",
    judge: (image) => {
      const change = difference(base, image, rows);
      return {
        held: change === null,
        found: `the banner's band ${describe(change, "the baseline's")}`,
      };
    },
  });
  return went ? 'gone' : 'stayed';
}

/** The command line: the subcommand, its operands, `--within <s>`, and `push`'s `--gone`. */
export function main(argv) {
  const options = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if (['--within', '--gone'].includes(argv[i])) options[argv[i].slice(2)] = argv[++i];
    else words.push(argv[i]);
  }
  const within = Number(options.within);
  const gone = options.gone === undefined ? undefined : Number(options.gone);
  const [command, ...operands] = words;
  const usage = () => {
    console.error(
      'usage: banner.mjs line <file> <prefix> | settle <udid> <out.png> | push <udid> <bundle id> ' +
        '<payload> <baseline.png> <out.png> [--gone <s>], each with --within <s>',
    );
    return 2;
  };
  if (!(within > 0)) return usage();
  if (command === 'line' && operands.length === 2) return awaitLine(...operands, within) ? 0 : 1;
  if (command === 'settle' && operands.length === 2) return settle(...operands, within) ? 0 : 1;
  if (command === 'push' && operands.length === 5 && (gone === undefined || gone > 0)) {
    const outcome = pushAndLook(...operands, within, gone);
    return { seen: 0, gone: 0, unseen: 1, push: 3, stayed: 4 }[outcome];
  }
  return usage();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
