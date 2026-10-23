import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
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
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

// apps/ios/ci/upload.sh, run from a copy of the parts of the repo it uses, with stand-ins for
// Apple's tools and fastlane that do what each test asks and note how they were called.
const repo = new URL('../../', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'upload-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

for (const path of [
  'apps/ios/ci/upload.sh',
  'apps/ios/ci/ExportOptions.plist',
  'scripts/asc.mjs',
  'scripts/asc-key.mjs',
]) {
  mkdirSync(join(root, path, '..'), { recursive: true });
  copyFileSync(join(repo, path), join(root, path));
}
const SCRIPT = join(root, 'apps/ios/ci/upload.sh');
const build = join(root, 'apps/ios/build');
const home = join(root, 'home');
const keys = join(home, '.appstoreconnect/private_keys');
const calls = join(root, 'calls.log');

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

// Each stand-in answers as FAKE_<NAME> says: ok, fail (a transport error) or refuse (App Store
// Connect's validation error).
const bin = join(root, 'bin');
mkdirSync(bin);
const fake = (name, body) => {
  writeFileSync(join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >>"${calls}"\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};
const answer = (variable) => `case "\${${variable}:-ok}" in
  ok) echo "UPLOAD SUCCEEDED" ;;
  fail) echo "Error: The network connection was lost."; exit 1 ;;
  refuse) echo "*** Error: Validation failed (409) Missing required icon file. ITMS-90022"; exit 1 ;;
esac`;
fake('xcrun', answer('FAKE_ALTOOL'));
fake('xcodebuild', answer('FAKE_XCODEBUILD'));
fake('plutil', 'exit 0');
fake('gem', 'exit "${FAKE_GEM:-0}"');
fake(
  'fastlane',
  `json="$(sed -n 's/.*--api_key_path \\([^ ]*\\).*/\\1/p' <<<"$*")"
[ -f "$json" ] && echo "key file mode $(stat -c %a "$json" 2>/dev/null || stat -f %Lp "$json")" >>"${calls}"
${answer('FAKE_FASTLANE')}`,
);

function run(env = {}) {
  rmSync(calls, { force: true });
  const summary = join(root, 'summary.md');
  rmSync(summary, { force: true });
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      ASC_KEY_ID: 'ABC123DEFG',
      ASC_ISSUER_ID: 'issuer',
      ASC_KEY_P8: PEM,
      GITHUB_STEP_SUMMARY: summary,
      ...env,
    },
  });
  return {
    status: result.status,
    out: result.stdout,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [],
    summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
  };
}
const tools = (calls) => calls.map((c) => c.split(' ')[0]);

beforeEach(() => {
  mkdirSync(join(build, 'export'), { recursive: true });
  writeFileSync(join(build, 'export/WillItSnow.ipa'), 'ipa');
  mkdirSync(keys, { recursive: true });
  writeFileSync(join(keys, 'AuthKey_ABC123DEFG.p8'), PEM);
});

describe('upload.sh', () => {
  it('uploads with altool when that works, and tries nothing else', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.calls).toEqual([
      'xcrun altool --upload-app -f ' +
        `${build}/export/WillItSnow.ipa -t ios --apiKey ABC123DEFG --apiIssuer issuer`,
    ]);
    expect(result.summary).toBe(
      '### Upload: sent to App Store Connect with altool; TestFlight lists it once it has processed\n',
    );
  });

  it('exports again with destination upload when altool fails', () => {
    const result = run({ FAKE_ALTOOL: 'fail' });
    expect(result.status).toBe(0);
    expect(tools(result.calls)).toEqual(['xcrun', 'plutil', 'xcodebuild']);
    expect(result.calls[1]).toBe(
      `plutil -replace destination -string upload ${build}/ExportOptions-upload.plist`,
    );
    expect(result.calls[2]).toContain('-exportArchive');
    expect(result.calls[2]).toContain(`-authenticationKeyPath ${keys}/AuthKey_ABC123DEFG.p8`);
    expect(result.out).toContain(
      '::warning::upload.sh: the upload with altool failed; trying the next way',
    );
    expect(result.summary).toContain('with xcodebuild');
  });

  it('uses fastlane last, with its key file only while it runs', () => {
    const result = run({ FAKE_ALTOOL: 'fail', FAKE_XCODEBUILD: 'fail' });
    expect(result.status).toBe(0);
    expect(tools(result.calls)).toEqual([
      'xcrun',
      'plutil',
      'xcodebuild',
      'gem',
      'fastlane',
      'key',
    ]);
    expect(result.calls[3]).toBe('gem install fastlane -v 2.241.1 --no-document');
    expect(result.calls[4]).toMatch(
      /^fastlane _2\.241\.1_ pilot upload --ipa \S+WillItSnow\.ipa --api_key_path \S+fastlane\.json/,
    );
    expect(result.calls[5]).toBe('key file mode 600');
    expect(existsSync(join(keys, 'fastlane.json'))).toBe(false);
    expect(result.summary).toContain('with fastlane');
  });

  it('stops when App Store Connect refuses the build, and quotes why', () => {
    const result = run({ FAKE_ALTOOL: 'refuse' });
    expect(result.status).toBe(1);
    expect(tools(result.calls)).toEqual(['xcrun']);
    expect(result.summary).toBe(
      [
        '### Upload: App Store Connect refused the build',
        '',
        '```',
        '*** Error: Validation failed (409) Missing required icon file. ITMS-90022',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('fails, saying so, when every way fails', () => {
    const result = run({ FAKE_ALTOOL: 'fail', FAKE_XCODEBUILD: 'fail', FAKE_FASTLANE: 'fail' });
    expect(result.status).toBe(1);
    expect(result.summary).toMatch(
      /^### Upload: failed with altool, xcodebuild and fastlane \(see the log\); upload from Xcode instead\n/,
    );
    expect(existsSync(join(keys, 'fastlane.json'))).toBe(false);
    const noGem = run({ FAKE_ALTOOL: 'fail', FAKE_XCODEBUILD: 'fail', FAKE_GEM: '1' });
    expect(noGem.status).toBe(1);
    expect(tools(noGem.calls)).toEqual(['xcrun', 'plutil', 'xcodebuild', 'gem']);
  });

  it('needs the key, its IDs and the .ipa', () => {
    expect(run({ ASC_ISSUER_ID: '' }).status).toBe(2);
    rmSync(join(keys, 'AuthKey_ABC123DEFG.p8'));
    const noKey = run();
    expect(noKey.status).toBe(2);
    expect(noKey.out).toContain('::error::upload.sh: no AuthKey_ABC123DEFG.p8');
    expect(noKey.calls).toEqual([]);
  });
});
