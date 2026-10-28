import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SNOW_GLYPHS } from '../../../apps/web/src/lib/snowGlyphs';
import {
  FIXTURES,
  SEARCH_FIXTURES,
  fixtureJson,
  makeFixture,
  makeSearchFixture,
  type Fixture,
} from '../src/fixtures';
import { SURFACES_PATH, brandColoursSwift, surfacesJson } from '../src/brandColours';
import { appCopySwift } from '../src/exportAppCopy';
import { CONFIGS_GENERATED_DIR, configCopy } from '../src/exportConfigCopy';
import { constantsSwift } from '../src/exportConstants';
import { coreCopySwift } from '../src/exportCoreCopy';
import { creditsSwift } from '../src/exportCredits';
import { STOREKIT_DIR, storeKitJson } from '../src/exportStoreKit';
import {
  BRAND_FONTS,
  BRAND_FONTS_PATH,
  BRAND_FONTS_SOURCE,
  FONTS_DIR,
  brandFontsSwift,
  fontPath,
} from '../src/exportFont';
import {
  GLYPHS_DIR,
  GLYPHS_FALLBACK_DIR,
  SNOW_KIT_GENERATED_DIR,
  glyphFiles,
} from '../src/exportGlyphs';
import {
  HOME_SCREENS_PATH,
  UI_TESTS_GENERATED_DIR,
  homeScreensJson,
} from '../src/exportHomeScreens';
import { ASSETS_DIR, iconFiles } from '../src/exportIcon';
import { keysSwift } from '../src/exportKeys';
import { palettesSwift } from '../src/exportPalettes';
import { questionsSwift } from '../src/exportQuestions';
import {
  FIXTURES_DIR,
  MODEL_GENERATED_DIR,
  OWNED_DIRS,
  SEARCH_FIXTURES_DIR,
  VECTORS_DIR,
  drift,
  generatedFiles,
  sameContents,
  type GeneratedFile,
} from '../src/generate';
import { generatedHeader } from '../src/swift';
import { vectorFiles, vectorJson } from '../src/vectors';

const sources = {
  glyphs: SNOW_GLYPHS,
  favicon: readFileSync(
    new URL('../../../apps/web/public/snow/favicon.svg', import.meta.url),
    'utf8',
  ),
};

/** A text file's contents: every file but the PNGs and the font is text. */
const text = (f: GeneratedFile): string => {
  if (typeof f.contents !== 'string') throw new Error(`${f.path} is not text`);
  return f.contents;
};

describe('generatedFiles', () => {
  // Every PNG is rendered here once for every test: a few seconds, more beside the whole suite.
  let files: GeneratedFile[];
  let assets: GeneratedFile[];
  beforeAll(async () => {
    files = await generatedFiles(sources);
    assets = [...glyphFiles(sources.glyphs), ...iconFiles(sources.favicon)];
  }, 120_000);

  it("writes IsItModel's Swift, Snow.storekit, each fixture and vector file, the UI tests' screens, the glyph catalogues and the app icon", async () => {
    const model = 'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated';
    const resources = 'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources';
    const vectors = [
      ...['grid', 'target', 'query', 'placeTime', 'tomorrow', 'freshness', 'hours'],
      ...['questions', 'strip', 'widget', 'alerts', 'links', 'recent', 'page', 'search'],
      'saved',
    ];
    const resourcePaths = [
      ...FIXTURES.map((s) => `${resources}/Fixtures/${s.name}.json`),
      ...SEARCH_FIXTURES.map((s) => `${resources}/Fixtures/Search/${s.name}.json`),
      ...vectors.map((name) => `${resources}/Vectors/${name}.json`),
    ];
    expect(files.map((f) => f.path)).toEqual([
      `${model}/CoreCopy.swift`,
      `${model}/Questions.swift`,
      `${model}/AppCopy.swift`,
      `${model}/Constants.swift`,
      `${model}/AppCredits.swift`,
      `${model}/Keys.swift`,
      `${model}/BrandFonts.swift`,
      `${model}/Palettes.swift`,
      `${model}/BrandColours.swift`,
      'apps/ios/Configs/Generated/Copy.xcconfig',
      'apps/ios/Apps/Snow/StoreKit/Snow.storekit',
      ...resourcePaths,
      HOME_SCREENS_PATH,
      SURFACES_PATH,
      ...assets.map((f) => f.path),
    ]);
    expect(files.slice(0, 11).map((f) => f.contents)).toEqual([
      coreCopySwift(),
      questionsSwift(),
      appCopySwift(),
      constantsSwift(),
      creditsSwift(),
      keysSwift(),
      brandFontsSwift(),
      palettesSwift(),
      brandColoursSwift(),
      configCopy(),
      storeKitJson(),
    ]);
    expect(files[12]!.contents).toBe(fixtureJson(await makeFixture(FIXTURES[1]!)));
    const search = files.find((f) => f.path.endsWith('/Fixtures/Search/search-leeds.json'))!;
    expect(search.contents).toBe(fixtureJson(await makeSearchFixture(SEARCH_FIXTURES[0]!)));
    expect(SEARCH_FIXTURES_DIR).toBe(`${FIXTURES_DIR}/Search`);
    const first = 11 + resourcePaths.length + 2;
    for (const [i, f] of assets.entries()) {
      expect(sameContents(files[first + i]!.contents, f.contents)).toBe(true);
    }
    expect(OWNED_DIRS).toEqual([
      FIXTURES_DIR,
      VECTORS_DIR,
      MODEL_GENERATED_DIR,
      GLYPHS_DIR,
      GLYPHS_FALLBACK_DIR,
      SNOW_KIT_GENERATED_DIR,
      ASSETS_DIR,
      FONTS_DIR,
      CONFIGS_GENERATED_DIR,
      STOREKIT_DIR,
      UI_TESTS_GENERATED_DIR,
    ]);
  });

  it('works the vectors out from the fixtures exactly as their files have them', () => {
    const fixtures = new Map<string, Fixture>(
      FIXTURES.map((s) => [
        s.name,
        JSON.parse(text(files.find((f) => f.path === `${FIXTURES_DIR}/${s.name}.json`)!)),
      ]),
    );
    const vectors = vectorFiles(fixtures);
    for (const { name, vectors: file } of vectors) {
      expect(files.find((f) => f.path === `${VECTORS_DIR}/${name}.json`)!.contents).toBe(
        vectorJson(file),
      );
    }
    // The UI tests' screens, from the same page.json.
    const page = vectors.find((v) => v.name === 'page')!.vectors;
    expect(files.find((f) => f.path === HOME_SCREENS_PATH)!.contents).toBe(
      homeScreensJson(fixtures, page),
    );
    // And the surfaces their contrast proof reads, beside them.
    expect(files.find((f) => f.path === SURFACES_PATH)!.contents).toBe(surfacesJson());
  });

  it('starts every Swift file with the header that names its source', () => {
    for (const f of files) {
      if (!f.path.endsWith('.swift')) continue;
      expect(text(f).split('\n')[0], f.path).toMatch(
        /^\/\/ Generated by pnpm mobile:generate from \S.*\. Do not edit\.$/,
      );
      expect(text(f).endsWith('}\n'), f.path).toBe(true);
    }
  });

  it('puts every file it writes in a folder it owns, so a stale one is found', () => {
    const paths = [...files.map((f) => f.path), ...BRAND_FONTS.map((f) => fontPath(f.name))];
    for (const path of paths) {
      expect(OWNED_DIRS.some((dir) => path.startsWith(`${dir}/`))).toBe(true);
    }
  });
});

describe('brandFontsSwift', () => {
  const swift = brandFontsSwift();

  it('goes into IsItModel, where the widget reaches it too, with the header first', () => {
    expect(BRAND_FONTS_PATH).toBe(
      'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/BrandFonts.swift',
    );
    expect(swift.split('\n')[0]).toBe(generatedHeader(BRAND_FONTS_SOURCE));
    expect(swift.split('\n').filter((l) => l.startsWith('import '))).toEqual([]);
  });

  it('names every font by its PostScript name, the text faces first, and its file', () => {
    expect(swift).toContain('public enum BrandFont: String, CaseIterable, Sendable {\n');
    expect([...swift.matchAll(/^ {2}case (\w+) = "([^"]+)"$/gm)].map((m) => [m[1], m[2]])).toEqual([
      ['textRegular', 'BricolageText-Regular'],
      ['textMedium', 'BricolageText-Medium'],
      ['textSemiBold', 'BricolageText-SemiBold'],
      ['answer', 'BricolageAnswer'],
    ]);
    expect(swift).toContain('  public var file: String { rawValue + ".ttf" }\n');
  });

  it('is the same every time, within 100 columns', () => {
    expect(brandFontsSwift()).toBe(swift);
    for (const line of swift.split('\n')) expect(line.length).toBeLessThanOrEqual(100);
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
