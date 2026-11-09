#!/usr/bin/env node
/**
 * The App Store's screenshots, from a UI test run's attachments (ios-screenshots.yml): each screen
 * the tests attached under one of `SCREENS`' names, copied in that order to the output folder as
 * `<n>-<name>.png`, and checked to be the App Store's 6.9-inch size, 1320 by 2868 pixels, which an
 * iPhone 17 Pro Max simulator takes. Writes what it found to standard output; exits 1 when a
 * screen is missing or the wrong size, after copying the rest, so a run still gives what it has.
 *
 *   node apps/ios/ci/screenshots.mjs <attachments folder> <output folder>
 */
import { copyFileSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachmentFile } from './xcresult-summary.mjs';

/** The screens, in the App Store's order: the name each test attaches it under. */
export const SCREENS = [
  'app-aberdeen-snow', // Today: snow, how much and when (FixtureLaunchTests)
  'app-aberdeen-snow-week', // This week (FixtureLaunchTests.testSwitcherAndSwipe)
  'app-aberdeen-snow-now', // Now (the same test)
  'app-durham-tomorrow', // Tomorrow, after 6pm (FixtureLaunchTests)
  'app-picker-bell-on', // Saved places with a bell on (NotificationsTests.testSavedPlacesPaid)
  'app-notifications-on', // Notifications in Settings (NotificationsTests)
  'app-upgrade', // The one-off purchase (UpgradeTests)
];

/** The App Store's 6.9-inch iPhone screenshot, portrait. */
export const SIZE = { width: 1320, height: 2868 };

/** A PNG's width and height from its header, or null when it isn't a PNG. */
export function pngSize(path) {
  const header = Buffer.alloc(24);
  const fd = openSync(path, 'r');
  try {
    if (readSync(fd, header, 0, 24, 0) < 24) return null;
  } finally {
    closeSync(fd);
  }
  if (header.toString('latin1', 1, 4) !== 'PNG' || header.toString('latin1', 12, 16) !== 'IHDR') {
    return null;
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** Copies each screen found, in order; returns a line for each and whether all were right. */
export function collect(folder, out) {
  mkdirSync(out, { recursive: true });
  const lines = [];
  let ok = true;
  SCREENS.forEach((name, i) => {
    const file = attachmentFile(folder, name);
    const target = `${String(i + 1).padStart(2, '0')}-${name}.png`;
    if (!file) {
      ok = false;
      lines.push(`- ${target}: missing (no attachment named ${name})`);
      return;
    }
    const size = pngSize(file);
    copyFileSync(file, join(out, target));
    if (!size || size.width !== SIZE.width || size.height !== SIZE.height) {
      ok = false;
      const got = size ? `${size.width} × ${size.height}` : 'not a PNG';
      lines.push(`- ${target}: ${got}, not ${SIZE.width} × ${SIZE.height}`);
      return;
    }
    lines.push(`- ${target}: ${size.width} × ${size.height}`);
  });
  return { ok, lines };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [folder, out] = process.argv.slice(2);
  if (!folder || !out) {
    console.error('usage: screenshots.mjs <attachments folder> <output folder>');
    process.exit(2);
  }
  const { ok, lines } = collect(folder, out);
  process.stdout.write(`### App Store screenshots\n\n${lines.join('\n')}\n`);
  if (!ok) process.exitCode = 1;
}
