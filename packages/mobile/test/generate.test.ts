import { describe, expect, it } from 'vitest';
import { FIXTURES, fixtureJson, makeFixture, type Fixture } from '../src/fixtures';
import { keysSwift } from '../src/exportKeys';
import {
  FIXTURES_DIR,
  MODEL_GENERATED_DIR,
  OWNED_DIRS,
  VECTORS_DIR,
  drift,
  generatedFiles,
} from '../src/generate';
import { vectorFiles, vectorJson } from '../src/vectors';

describe('generatedFiles', () => {
  it('writes Keys.swift into IsItModel, and each fixture and vector file into the test resources', async () => {
    const files = await generatedFiles();
    const resources = 'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources';
    const vectors = [
      ...['grid', 'target', 'query', 'placeTime', 'tomorrow', 'freshness', 'hours'],
      ...['questions', 'strip', 'widget', 'alerts', 'links', 'recent'],
    ];
    expect(files.map((f) => f.path)).toEqual([
      'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/Keys.swift',
      ...FIXTURES.map((s) => `${resources}/Fixtures/${s.name}.json`),
      ...vectors.map((name) => `${resources}/Vectors/${name}.json`),
    ]);
    expect(files[0]!.contents).toBe(keysSwift());
    expect(files[2]!.contents).toBe(fixtureJson(await makeFixture(FIXTURES[1]!)));
    expect(OWNED_DIRS).toEqual([FIXTURES_DIR, VECTORS_DIR, MODEL_GENERATED_DIR]);
  });

  it('works the vectors out from the fixtures exactly as their files have them', async () => {
    const files = await generatedFiles();
    const fixtures = new Map<string, Fixture>(
      FIXTURES.map((s) => [
        s.name,
        JSON.parse(files.find((f) => f.path === `${FIXTURES_DIR}/${s.name}.json`)!.contents),
      ]),
    );
    for (const { name, vectors } of vectorFiles(fixtures)) {
      expect(files.find((f) => f.path === `${VECTORS_DIR}/${name}.json`)!.contents).toBe(
        vectorJson(vectors),
      );
    }
  });

  it('puts every file it writes in a folder it owns, so a stale one is found', async () => {
    for (const f of await generatedFiles()) {
      expect(OWNED_DIRS.some((dir) => f.path.startsWith(`${dir}/`))).toBe(true);
    }
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
});
