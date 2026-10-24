import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MAX_ROWS,
  SLOWEST,
  attachmentLabel,
  auditCalls,
  buildSummary,
  cell,
  failures,
  readAuditTimes,
  readJson,
  sourceLocation,
  testSummary,
  timingSummary,
} from '../../apps/ios/ci/xcresult-summary.mjs';

const SCRIPT = new URL('../../apps/ios/ci/xcresult-summary.mjs', import.meta.url).pathname;
const ROOT = 'file:///Users/runner/work/isithot.today/isithot.today';

// Shaped as `xcrun xcresulttool get build-results` writes it (Xcode 16 and later).
const BUILD = {
  actionTitle: 'Build WillItSnow',
  status: 'failed',
  errorCount: 1,
  warningCount: 1,
  errors: [
    {
      issueType: 'Swift Compiler Error',
      message: "cannot find 'Store' in scope",
      targetName: 'WillItSnow',
      sourceURL: `${ROOT}/apps/ios/Apps/Snow/App/AppModel.swift#EndingColumnNumber=9&EndingLineNumber=16&StartingColumnNumber=4&StartingLineNumber=16&Timestamp=783000000`,
    },
  ],
  warnings: [{ issueType: 'Warning', message: 'a | b\nsecond line', targetName: 'IsItAds' }],
};

// Shaped as `get test-results summary` and `get test-results tests` write them.
const SUMMARY = {
  result: 'Failed',
  totalTestCount: 7,
  passedTests: 6,
  failedTests: 1,
  skippedTests: 0,
  testFailures: [
    {
      testName: 'testTheAppGroupOpens()',
      testIdentifierString: 'AppGroupTests/testTheAppGroupOpens()',
      failureText: 'XCTUnwrap failed',
      targetName: 'WillItSnowTests',
    },
  ],
};
const TESTS = {
  testNodes: [
    {
      name: 'Unit',
      nodeType: 'Test Plan',
      result: 'Failed',
      children: [
        {
          name: 'WillItSnowTests',
          nodeType: 'Unit test bundle',
          children: [
            {
              name: 'AppGroupTests',
              nodeType: 'Test Suite',
              children: [
                {
                  name: 'testTheAppGroupOpens()',
                  nodeIdentifier: 'AppGroupTests/testTheAppGroupOpens()',
                  nodeType: 'Test Case',
                  result: 'Failed',
                  children: [
                    {
                      name: 'AppGroupTests.swift:24: XCTUnwrap failed: expected non-nil value of type "URL" - No App Group container',
                      nodeType: 'Failure Message',
                      result: 'Failed',
                    },
                    { name: 'Run on iPhone 17', nodeType: 'Device' },
                  ],
                },
                { name: 'testTheAppNamesItsAppGroup()', nodeType: 'Test Case', result: 'Passed' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('cell', () => {
  it('escapes pipes and keeps line breaks inside the cell', () => {
    expect(cell(' a | b\nc\r\nd ')).toBe('a \\| b<br>c<br>d');
    expect(cell(undefined)).toBe('');
  });
});

describe('sourceLocation', () => {
  it('gives the path from apps/ios and the line, counting from 1', () => {
    expect(sourceLocation(BUILD.errors[0].sourceURL)).toBe(
      'apps/ios/Apps/Snow/App/AppModel.swift:17',
    );
  });

  it('keeps a path outside apps/ios whole, and leaves out a line it lacks', () => {
    expect(sourceLocation('file:///tmp/Some%20File.swift')).toBe('/tmp/Some File.swift');
    expect(sourceLocation('file:///tmp/a.swift#StartingLineNumber=x')).toBe('/tmp/a.swift');
    expect(sourceLocation('')).toBeNull();
    expect(sourceLocation(undefined)).toBeNull();
  });
});

describe('buildSummary', () => {
  it('counts, then lists errors before warnings with where they are', () => {
    expect(buildSummary(BUILD)).toBe(
      [
        '### Build: failed, 1 error, 1 warning',
        '',
        '| | Where | Target | Message |',
        '|---|---|---|---|',
        "| error | apps/ios/Apps/Snow/App/AppModel.swift:17 | WillItSnow | cannot find 'Store' in scope |",
        '| warning |  | IsItAds | a \\| b<br>second line |',
        '',
      ].join('\n'),
    );
  });

  it('says so when the build is clean, or has no results', () => {
    expect(buildSummary({ status: 'succeeded', errors: [], warnings: [] })).toBe(
      '### Build: succeeded, 0 errors, 0 warnings\n',
    );
    expect(buildSummary({ errors: [{ message: 'x' }] })).toMatch(
      /^### Build: failed, 1 error, 0 warnings/,
    );
    expect(buildSummary({})).toBe('### Build: unknown, 0 errors, 0 warnings\n');
    expect(buildSummary(null)).toBe('### Build: no build results (see the log)\n');
  });

  it(`shows at most ${MAX_ROWS} rows and counts the rest`, () => {
    const errors = Array.from({ length: MAX_ROWS + 3 }, (_, i) => ({ message: `e${i}` }));
    const lines = buildSummary({ status: 'failed', errors }).trimEnd().split('\n');
    expect(lines.at(-1)).toBe('| | | …and 3 more |');
    expect(lines).toHaveLength(4 + MAX_ROWS + 1);
  });
});

describe('failures', () => {
  it('finds each failure with its test, file and line', () => {
    expect(failures(TESTS)).toEqual([
      {
        test: 'AppGroupTests/testTheAppGroupOpens()',
        where: 'AppGroupTests.swift:24',
        message: 'XCTUnwrap failed: expected non-nil value of type "URL" - No App Group container',
      },
    ]);
  });

  it('keeps a failure without a place, and names a test without an identifier by its name', () => {
    const tests = {
      testNodes: [
        {
          nodeType: 'Test Case',
          name: 'testX()',
          children: [{ nodeType: 'Failure Message', name: 'crashed' }, null],
        },
      ],
    };
    expect(failures(tests)).toEqual([{ test: 'testX()', where: '', message: 'crashed' }]);
    expect(failures(null)).toEqual([]);
    expect(failures({ testNodes: [{ nodeType: 'Failure Message' }] })).toEqual([
      { test: '', where: '', message: '' },
    ]);
  });
});

describe('testSummary', () => {
  it('counts, then lists each failure from the test tree', () => {
    expect(testSummary('Unit', SUMMARY, TESTS)).toBe(
      [
        '### Unit: Failed, 7 tests: 6 passed, 1 failed, 0 skipped',
        '',
        '| Test | Where | Failure |',
        '|---|---|---|',
        '| AppGroupTests/testTheAppGroupOpens() | AppGroupTests.swift:24 | XCTUnwrap failed: expected non-nil value of type "URL" - No App Group container |',
        '',
      ].join('\n'),
    );
  });

  it('falls back to the summary’s failures without the tree', () => {
    expect(testSummary('Unit', SUMMARY, null)).toContain(
      '| AppGroupTests/testTheAppGroupOpens() |  | XCTUnwrap failed |',
    );
    expect(
      testSummary('Unit', { ...SUMMARY, testFailures: [{ testName: 't()' }, {}] }, null),
    ).toContain('| t() |  |  |\n|  |  |  |');
  });

  it('flags skipped tests, which the spec never allows', () => {
    const summary = {
      result: 'Passed',
      totalTestCount: 2,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 1,
    };
    expect(testSummary('UI', summary, { testNodes: [] })).toBe(
      '### UI: Passed, 2 tests: 1 passed, 0 failed, 1 skipped\n\n' +
        'Tests were skipped. The spec never allows that (section 0.2).\n',
    );
  });

  it('says what it doesn’t know', () => {
    expect(testSummary('UI', {}, null)).toBe(
      '### UI: unknown, ? tests: ? passed, ? failed, ? skipped\n',
    );
    expect(testSummary('UI', null, null)).toBe('### UI: no test results (see the log)\n');
  });
});

// Shaped as UITests/ScreenAudit.swift's `AuditTimes.text` writes it: the columns, then a line a
// call, tab-separated.
const IN_PLACE = 'contrast, elementDetection, hitRegion, sufficientElementDescription, trait';
const HOME_TIMES = [
  'seconds\tplace\tkinds\tissues\tnote',
  `3.4\tnow page, screenful 1\t${IN_PLACE}\t0\t`,
  '3.9\tnow page, screenful 1\tdynamicType, textClipped\t0\t',
  `6.9\tnow page, screenful 6\t${IN_PLACE}\t2\ttimed out (-56) after 17.2 s; ran again`,
].join('\n');
const SHEET_TIMES = [
  'seconds\tplace\tkinds\tissues\tnote',
  `16.9\tSettings\t${IN_PLACE}\t0\ttimed out (-56) after 17.0 s; ran again, timed out (-56) after 16.9 s`,
].join('\n');

describe('auditCalls', () => {
  it('reads each line after the columns', () => {
    expect(auditCalls(HOME_TIMES)).toEqual([
      { seconds: 3.4, place: 'now page, screenful 1', kinds: IN_PLACE, issues: 0, note: '' },
      {
        seconds: 3.9,
        place: 'now page, screenful 1',
        kinds: 'dynamicType, textClipped',
        issues: 0,
        note: '',
      },
      {
        seconds: 6.9,
        place: 'now page, screenful 6',
        kinds: IN_PLACE,
        issues: 2,
        note: 'timed out (-56) after 17.2 s; ran again',
      },
    ]);
  });

  it('skips what isn’t a call, and keeps a count it can’t read as none', () => {
    expect(auditCalls('')).toEqual([]);
    expect(auditCalls(undefined)).toEqual([]);
    expect(auditCalls('x\ty\tz\n7\tonly a place\n')).toEqual([]);
    expect(auditCalls('2\tSettings\tcontrast\r\n')).toEqual([
      { seconds: 2, place: 'Settings', kinds: 'contrast', issues: null, note: '' },
    ]);
  });
});

describe('attachmentLabel', () => {
  it('drops the extension and the suffix xcresulttool adds', () => {
    expect(attachmentLabel('audit-settings-times_0_6F1C2D3E-1234-4ABC-9DEF-0123456789AB.txt')).toBe(
      'audit-settings-times',
    );
    expect(attachmentLabel('home-leeds-dry-2-ax3-audit-times.txt')).toBe(
      'home-leeds-dry-2-ax3-audit-times',
    );
  });
});

describe('timingSummary', () => {
  const calls = [
    ...auditCalls(HOME_TIMES).map((c) => ({
      test: 'HomeAuditTests/testAberdeenSnowAtAX3()',
      ...c,
    })),
    ...auditCalls(SHEET_TIMES).map((c) => ({
      test: 'SettingsTests/testUnitsChangeAsksInTheNewUnits()',
      ...c,
    })),
  ];

  it('lists the slowest calls, each that timed out, and what the timeouts say of the deadline', () => {
    expect(timingSummary(calls)).toBe(
      [
        '### Audit times: 4 calls in 2 tests, the slowest 16.9 s',
        '',
        'Timed out (-56, "Audit failed to complete in time") after 17.2 s, 17.0 s, 16.9 s: ' +
          "about XCTest's deadline for a call.",
        '',
        '| Seconds | Test | Where | Kinds | Issues | Note |',
        '|---|---|---|---|---|---|',
        `| 16.9 | SettingsTests/testUnitsChangeAsksInTheNewUnits() | Settings | ${IN_PLACE} | 0 | timed out (-56) after 17.0 s; ran again, timed out (-56) after 16.9 s |`,
        `| 6.9 | HomeAuditTests/testAberdeenSnowAtAX3() | now page, screenful 6 | ${IN_PLACE} | 2 | timed out (-56) after 17.2 s; ran again |`,
        '| 3.9 | HomeAuditTests/testAberdeenSnowAtAX3() | now page, screenful 1 | dynamicType, textClipped | 0 |  |',
        `| 3.4 | HomeAuditTests/testAberdeenSnowAtAX3() | now page, screenful 1 | ${IN_PLACE} | 0 |  |`,
        '',
      ].join('\n'),
    );
  });

  it(`shows the ${SLOWEST} slowest, and every call with a note however fast`, () => {
    const many = Array.from({ length: SLOWEST + 5 }, (_, i) => ({
      test: 't',
      seconds: 20 - i,
      place: `screenful ${i + 1}`,
      kinds: 'contrast',
      issues: 0,
      note: '',
    }));
    many.push({
      test: 't',
      seconds: 0.5,
      place: 'quick',
      kinds: 'trait',
      issues: null,
      note: 'failed: x',
    });
    const lines = timingSummary(many).trimEnd().split('\n');
    expect(lines[0]).toBe(`### Audit times: ${SLOWEST + 6} calls in 1 test, the slowest 20.0 s`);
    expect(lines).toHaveLength(4 + SLOWEST + 1);
    expect(lines.at(-1)).toBe('| 0.5 | t | quick | trait |  | failed: x |');
    expect(lines.some((l) => l.includes('Timed out'))).toBe(false);
  });

  it('says when there is nothing to read', () => {
    expect(timingSummary([])).toBe('### Audit times: none attached\n');
    expect(timingSummary(null)).toBe('### Audit times: no attachments manifest (see the log)\n');
    expect(
      timingSummary([{ test: 't', seconds: 1, place: 'p', kinds: 'k', issues: 1, note: '' }]),
    ).toBe(
      [
        '### Audit times: 1 call in 1 test, the slowest 1.0 s',
        '',
        '| Seconds | Test | Where | Kinds | Issues | Note |',
        '|---|---|---|---|---|---|',
        '| 1.0 | t | p | k | 1 |  |',
        '',
      ].join('\n'),
    );
  });
});

describe('the command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xcresult-summary-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => {
    const path = join(dir, name);
    writeFileSync(path, value);
    return path;
  };
  const run = (args) =>
    execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' });

  it('reads the files xcresulttool wrote', () => {
    expect(run(['build', write('b.json', JSON.stringify(BUILD))])).toBe(buildSummary(BUILD));
    expect(
      run([
        'tests',
        'Unit',
        write('s.json', JSON.stringify(SUMMARY)),
        write('t.json', JSON.stringify(TESTS)),
      ]),
    ).toBe(testSummary('Unit', SUMMARY, TESTS));
  });

  it('treats a missing, empty or broken file as no results', () => {
    expect(readJson(join(dir, 'missing.json'))).toBeNull();
    expect(readJson(write('empty.json', '  \n'))).toBeNull();
    expect(readJson(write('broken.json', '{'))).toBeNull();
    expect(run(['build', join(dir, 'missing.json')])).toBe(
      '### Build: no build results (see the log)\n',
    );
  });

  it('reads the audit times an export of attachments holds, by its manifest', () => {
    const folder = join(dir, 'attachments');
    mkdirSync(folder);
    writeFileSync(join(folder, 'A.txt'), HOME_TIMES);
    writeFileSync(join(folder, 'B.txt'), SHEET_TIMES);
    writeFileSync(join(folder, 'C.txt'), 'seconds\tplace\n99\tnot\ttimes\t0\t');
    const uuid = '6F1C2D3E-1234-4ABC-9DEF-0123456789AB';
    writeFileSync(
      join(folder, 'manifest.json'),
      JSON.stringify([
        {
          testIdentifier: 'HomeAuditTests/testAberdeenSnowAtAX3()',
          attachments: [
            {
              exportedFileName: 'A.txt',
              suggestedHumanReadableName: `home-aberdeen-snow-2-ax3-audit-times_0_${uuid}.txt`,
            },
            // The tree, not times; a file that isn't there; one with no names.
            {
              exportedFileName: 'C.txt',
              suggestedHumanReadableName: `audit-settings-tree_0_${uuid}.txt`,
            },
            { exportedFileName: 'gone.txt', suggestedHumanReadableName: 'audit-gone-times.txt' },
            {},
          ],
        },
        {
          testIdentifier: 'SettingsTests/testUnitsChangeAsksInTheNewUnits()',
          attachments: [
            { exportedFileName: 'B.txt', suggestedHumanReadableName: 'audit-settings-times.txt' },
          ],
        },
        { attachments: [{ exportedFileName: 'B.txt' }] },
        null,
      ]),
    );
    const calls = readAuditTimes(folder);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual({
      test: 'HomeAuditTests/testAberdeenSnowAtAX3()',
      ...auditCalls(HOME_TIMES)[0],
    });
    expect(run(['timings', folder])).toBe(timingSummary(calls));
    // A test with no identifier keeps its calls.
    writeFileSync(
      join(folder, 'manifest.json'),
      JSON.stringify([
        {
          attachments: [
            { exportedFileName: 'B.txt', suggestedHumanReadableName: 'audit-x-times.txt' },
          ],
        },
      ]),
    );
    expect(readAuditTimes(folder)?.[0]?.test).toBe('');
    expect(readAuditTimes(join(dir, 'nowhere'))).toBeNull();
    expect(run(['timings', join(dir, 'nowhere')])).toBe(
      '### Audit times: no attachments manifest (see the log)\n',
    );
  });

  it('explains its arguments', () => {
    let status = 0;
    try {
      run(['tests', 'Unit']);
    } catch (error) {
      status = error.status;
    }
    expect(status).toBe(2);
  });
});
