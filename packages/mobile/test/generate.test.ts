import { describe, expect, it } from 'vitest';
import { FIXTURES, fixtureJson, makeFixture } from '../src/fixtures';
import { keysSwift } from '../src/exportKeys';
import {
  FIXTURES_DIR,
  MODEL_GENERATED_DIR,
  OWNED_DIRS,
  drift,
  generatedFiles,
} from '../src/generate';

describe('generatedFiles', () => {
  it('writes Keys.swift into IsItModel and each fixture into the test resources', async () => {
    const files = await generatedFiles();
    expect(files.map((f) => f.path)).toEqual([
      'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/Keys.swift',
      'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures/aberdeen-snow.json',
      'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures/leeds-dry.json',
    ]);
    expect(files[0]!.contents).toBe(keysSwift());
    expect(files[2]!.contents).toBe(fixtureJson(await makeFixture(FIXTURES[1]!)));
    expect(OWNED_DIRS).toEqual([FIXTURES_DIR, MODEL_GENERATED_DIR]);
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
