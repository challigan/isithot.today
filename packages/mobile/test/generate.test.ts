import { describe, expect, it } from 'vitest';
import { FIXTURES, fixtureJson, makeFixture } from '../src/fixtures';
import { FIXTURES_DIR, OWNED_DIRS, drift, generatedFiles } from '../src/generate';

describe('generatedFiles', () => {
  it('writes each fixture into the Swift package’s test resources', async () => {
    const files = await generatedFiles();
    expect(files.map((f) => f.path)).toEqual([
      'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures/aberdeen-snow.json',
      'apps/ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures/leeds-dry.json',
    ]);
    expect(files[1]!.contents).toBe(fixtureJson(await makeFixture(FIXTURES[1]!)));
    expect(OWNED_DIRS).toEqual([FIXTURES_DIR]);
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
