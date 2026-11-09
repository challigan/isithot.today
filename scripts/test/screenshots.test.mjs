import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SCREENS, SIZE, collect, pngSize } from '../../apps/ios/ci/screenshots.mjs';

const SCRIPT = new URL('../../apps/ios/ci/screenshots.mjs', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'screenshots-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// A PNG's signature and IHDR, which is all pngSize reads, without pixels: encoding a whole
// 1320 × 2868 image takes seconds, seven of them more than a test's 5 on a busy runner.
function png(width, height) {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

// A folder as `xcresulttool export attachments` writes it: files named by UUID, their names in
// manifest.json, with xcresulttool's `_<n>_<UUID>` after each.
function attachments(name, screens) {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });
  const manifest = screens.map(([label, width, height], i) => {
    const file = `F${i}.png`;
    writeFileSync(join(folder, file), png(width, height));
    return {
      testIdentifier: `Tests/test${i}()`,
      attachments: [
        {
          exportedFileName: file,
          suggestedHumanReadableName: `${label}_0_0E700465-8A38-4B8B-9D1B-0AD466F6938${i}.png`,
        },
      ],
    };
  });
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest));
  return folder;
}

describe('screenshots.mjs', () => {
  it('copies every screen in the App Store order, at 1320 × 2868', () => {
    const folder = attachments(
      'all',
      [...SCREENS].reverse().map((s) => [s, SIZE.width, SIZE.height]),
    );
    const out = join(root, 'all-out');
    const { ok, lines } = collect(folder, out);
    expect(ok).toBe(true);
    expect(readdirSync(out).sort()).toEqual(
      SCREENS.map((s, i) => `${String(i + 1).padStart(2, '0')}-${s}.png`),
    );
    expect(pngSize(join(out, '01-app-aberdeen-snow.png'))).toEqual(SIZE);
    expect(lines[0]).toBe('- 01-app-aberdeen-snow.png: 1320 × 2868');
  });

  it('fails on a missing screen or the 6.3-inch size, and still copies the rest', () => {
    const screens = SCREENS.slice(1).map((s) => [s, SIZE.width, SIZE.height]);
    screens[0] = [SCREENS[1], 1206, 2622];
    const folder = attachments('some', screens);
    const out = join(root, 'some-out');
    const { ok, lines } = collect(folder, out);
    expect(ok).toBe(false);
    expect(lines[0]).toBe(
      '- 01-app-aberdeen-snow.png: missing (no attachment named app-aberdeen-snow)',
    );
    expect(lines[1]).toBe('- 02-app-aberdeen-snow-week.png: 1206 × 2622, not 1320 × 2868');
    expect(existsSync(join(out, '03-app-aberdeen-snow-now.png'))).toBe(true);
  });

  it('exits 1 from the command line when anything is wrong', () => {
    const folder = attachments('none', []);
    let status = 0;
    try {
      execFileSync('node', [SCRIPT, folder, join(root, 'none-out')], { stdio: 'pipe' });
    } catch (error) {
      status = error.status;
    }
    expect(status).toBe(1);
  });
});
