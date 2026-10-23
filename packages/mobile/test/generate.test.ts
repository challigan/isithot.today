import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SNOW_GLYPHS } from '../../../apps/web/src/lib/snowGlyphs';
import { FIXTURES, fixtureJson, makeFixture } from '../src/fixtures';
import { FONTS_DIR, FONT_PATH } from '../src/exportFont';
import {
  GLYPHS_DIR,
  GLYPHS_FALLBACK_DIR,
  SNOW_KIT_GENERATED_DIR,
  glyphFiles,
} from '../src/exportGlyphs';
import { ASSETS_DIR, iconFiles } from '../src/exportIcon';
import { keysSwift } from '../src/exportKeys';
import {
  FIXTURES_DIR,
  MODEL_GENERATED_DIR,
  OWNED_DIRS,
  drift,
  generatedFiles,
  sameContents,
  type GeneratedFile,
} from '../src/generate';

const sources = {
  glyphs: SNOW_GLYPHS,
  favicon: readFileSync(
    new URL('../../../apps/web/public/snow/favicon.svg', import.meta.url),
    'utf8',
  ),
};

describe('generatedFiles', () => {
  // Every PNG is rendered here once for both tests: a few seconds, more beside the whole suite.
  let files: GeneratedFile[];
  let assets: GeneratedFile[];
  beforeAll(async () => {
    files = await generatedFiles(sources);
    assets = [...glyphFiles(sources.glyphs), ...iconFiles(sources.favicon)];
  }, 120_000);

  it('writes Keys.swift, each fixture, the glyph catalogues and the app icon', async () => {
    expect(files.map((f) => f.path)).toEqual([
      'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/Keys.swift',
      'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures/aberdeen-snow.json',
      'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures/leeds-dry.json',
      ...assets.map((f) => f.path),
    ]);
    expect(files[0]!.contents).toBe(keysSwift());
    expect(files[2]!.contents).toBe(fixtureJson(await makeFixture(FIXTURES[1]!)));
    for (const [i, f] of assets.entries()) {
      expect(sameContents(files[3 + i]!.contents, f.contents)).toBe(true);
    }
    expect(OWNED_DIRS).toEqual([
      FIXTURES_DIR,
      MODEL_GENERATED_DIR,
      GLYPHS_DIR,
      GLYPHS_FALLBACK_DIR,
      SNOW_KIT_GENERATED_DIR,
      ASSETS_DIR,
      FONTS_DIR,
    ]);
  });

  it('puts every file it writes in a folder it owns, so a stale one is found', () => {
    const paths = [...files.map((f) => f.path), FONT_PATH];
    for (const path of paths) {
      expect(OWNED_DIRS.some((dir) => path.startsWith(`${dir}/`))).toBe(true);
    }
  });
});

describe('sameContents', () => {
  it('compares text as its UTF-8 bytes, and bytes as they are', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(sameContents('A’\n', Buffer.from('A’\n', 'utf8'))).toBe(true);
    expect(sameContents(png, Buffer.from(png))).toBe(true);
    expect(sameContents(png, new Uint8Array([0x89, 0x50, 0x4e]))).toBe(false);
    expect(sameContents('A\n', 'A')).toBe(false);
  });
});

describe('drift', () => {
  const a = { path: 'x/a.json', contents: 'A\n' };
  const b = { path: 'x/b.json', contents: 'B\n' };

  it('is empty when every file is as generated', () => {
    expect(
      drift(
        [a, b],
        new Map([
          [a.path, 'A\n'],
          [b.path, 'B\n'],
        ]),
      ),
    ).toEqual([]);
  });

  it('lists missing, changed and stale files, by path', () => {
    const onDisk = new Map([
      ['x/old.json', '{}\n'],
      [b.path, 'B, edited by hand\n'],
      ['x/0-old.json', '{}\n'],
    ]);
    expect(drift([b, a], onDisk)).toEqual([
      { path: 'x/0-old.json', problem: 'stale' },
      { path: 'x/a.json', problem: 'missing' },
      { path: 'x/b.json', problem: 'changed' },
      { path: 'x/old.json', problem: 'stale' },
    ]);
  });

  it('counts a lost final newline as a change', () => {
    expect(drift([a], new Map([[a.path, 'A']]))).toEqual([{ path: a.path, problem: 'changed' }]);
  });

  it('compares binary files by their bytes, and text read as bytes', () => {
    const png = { path: 'x/icon.png', contents: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]) };
    const same = new Map<string, Uint8Array>([
      [png.path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0])],
      [a.path, Buffer.from('A\n')],
    ]);
    expect(drift([png, a], same)).toEqual([]);
    const edited = new Map([[png.path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1])]]);
    expect(drift([png], edited)).toEqual([{ path: png.path, problem: 'changed' }]);
  });
});
