import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = new URL('../check-archive.sh', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'check-archive-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const APP_GROUP = 'group.today.willitsnow.app';
const DEMO_APP = 'ca-app-pub-3940256099942544~1458002511';
// Google's demo adaptive banner, which serves the page-end banner's inline size too.
const DEMO_BANNER = 'ca-app-pub-3940256099942544/2435281174';
const DEMO_INTERSTITIAL = 'ca-app-pub-3940256099942544/4411468910';
// Made up, shaped as Carl's will be.
const CARL_APP = 'ca-app-pub-1234567890123456~1234567890';
const CARL_BANNER = 'ca-app-pub-1234567890123456/0987654321';
const CARL_PAGE_BANNER = 'ca-app-pub-1234567890123456/1122334455';
const CARL_INTERSTITIAL = 'ca-app-pub-1234567890123456/5566778899';
// A real build's Info.plist keys, and the repository variables they come from.
const REAL = {
  GADApplicationIdentifier: CARL_APP,
  IsItBannerUnitID: CARL_BANNER,
  IsItPageBannerUnitID: CARL_PAGE_BANNER,
  IsItInterstitialUnitID: CARL_INTERSTITIAL,
};
const REAL_ENV = {
  ADMOB_APP_ID: CARL_APP,
  ADMOB_BANNER_ID: CARL_BANNER,
  ADMOB_PAGE_BANNER_ID: CARL_PAGE_BANNER,
  ADMOB_INTERSTITIAL_ID: CARL_INTERSTITIAL,
};
// Each ad unit's Info.plist key, its repository variable, and Carl's unit.
const UNITS = [
  ['IsItBannerUnitID', 'ADMOB_BANNER_ID', CARL_BANNER],
  ['IsItPageBannerUnitID', 'ADMOB_PAGE_BANNER_ID', CARL_PAGE_BANNER],
  ['IsItInterstitialUnitID', 'ADMOB_INTERSTITIAL_ID', CARL_INTERSTITIAL],
];
const GOOGLE_SKADNETWORK = 'cstr6suwn9.skadnetwork';
const HOOKS = [
  '-uitest',
  '-fixture',
  '-apiOrigin',
  '-route',
  '-umpGeography',
  '-openURLs',
  'URLProtocolStub',
  '127.0.0.1',
];

// --- Stand-ins for the macOS tools -----------------------------------------------------------

/** Writes `files` (path → text or bytes) under `dir`, making the folders. */
function tree(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === undefined) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const bin = tree(join(root, 'bin'), {
  // `plutil -convert xml1 -o - <file>`: the fake plists are XML already, as plutil writes it.
  plutil: `#!/usr/bin/env bash
[ "$#" -eq 5 ] && [ "$1 $2 $3 $4" = "-convert xml1 -o -" ] || { echo "fake plutil: $*" >&2; exit 64; }
head -n 1 "$5" | grep -q '^<?xml' || { echo "$5: not a plist" >&2; exit 1; }
cat "$5"
`,
  // `codesign -d --entitlements - --xml <bundle>`: the bundle's fake-entitlements.plist, the dump.
  codesign: `#!/usr/bin/env bash
[ "$#" -eq 5 ] && [ "$1 $2 $3 $4" = "-d --entitlements - --xml" ] || { echo "fake codesign: $*" >&2; exit 64; }
[ -f "$5/fake-entitlements.plist" ] || { echo "$5: code object is not signed at all" >&2; exit 1; }
cat "$5/fake-entitlements.plist"
`,
});
chmodSync(join(bin, 'plutil'), 0o755);
chmodSync(join(bin, 'codesign'), 0o755);

/** A plist in the XML plutil writes: one element a line, a tab for each level. */
function plist(value) {
  const element = (v, depth) => {
    const tab = '\t'.repeat(depth);
    if (typeof v === 'boolean') return `${tab}<${v}/>`;
    if (typeof v === 'number') return `${tab}<integer>${v}</integer>`;
    if (typeof v === 'string') return `${tab}<string>${v}</string>`;
    if (Array.isArray(v)) {
      if (!v.length) return `${tab}<array/>`;
      return [`${tab}<array>`, ...v.map((x) => element(x, depth + 1)), `${tab}</array>`].join('\n');
    }
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!keys.length) return `${tab}<dict/>`;
    const entries = keys.flatMap((k) => [`${tab}\t<key>${k}</key>`, element(v[k], depth + 1)]);
    return [`${tab}<dict>`, ...entries, `${tab}</dict>`].join('\n');
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    element(value, 0),
    '</plist>',
    '',
  ].join('\n');
}

/** A fake binary: some instructions, then each string NUL-terminated, then `words` as code. */
function binary(strings = [], words = []) {
  const code = Buffer.alloc((4 + words.length) * 4);
  [0xd503201f, 0xd65f03c0, 0xa9bf7bfd, 0x910003fd, ...words].forEach((w, i) =>
    code.writeUInt32LE(w >>> 0, i * 4),
  );
  return Buffer.concat([code, Buffer.from(`\0${strings.join('\0')}\0`)]);
}

// "-uitest" as LLVM builds it for arm64 (scripts/test/swift-small-strings.test.mjs).
const UITEST_CODE = [0xd28ea5b3, 0xf2ae8d33, 0xf2ce6cb3, 0xf2e00e93];
// The same for LLVM's generic CPU: its MOVKs come 3, 6 and 9 instructions after the MOVZ.
const UITEST_SPREAD = [
  0xd28ea5b5, 0xf9400817, 0xaa0003f4, 0xf2ae8d35, 0x9100a016, 0x52800033, 0xf2ce6cb5, 0x910006f8,
  0xd2fce019, 0xf2e00e95,
];
// From LLVM's code for a switch over "-forceEEA" and "-unlocked": the first builds its second
// word ("A", 0xE9), and the second word of -unlocked is that plus 0x23 (add x1, x21, #0x23),
// which the reader can't follow, so it reads "-unlockeA".
const UNLOCKED_DERIVED = [
  0xd2800835, // mov  x21, #0x41
  0xf2fd2015, // movk x21, #0xe900, lsl #48
  0xd28cc5a0, // mov  x0, #0x662d           "-forceEE"
  0xf2ae4de0, // movk x0, #0x726f, lsl #16
  0xf2ccac60, // movk x0, #0x6563, lsl #32
  0xf2e8a8a0, // movk x0, #0x4545, lsl #48
  0xd28ea5a0, // mov  x0, #0x752d           "-unlocke"
  0xf2ad8dc0, // movk x0, #0x6c6e, lsl #16
  0xf2cc6de0, // movk x0, #0x636f, lsl #32
  0xf2ecad60, // movk x0, #0x656b, lsl #48
  0x91008ea1, // add  x1, x21, #0x23
];
// "-fixture" (8 bytes) just after URLProtocolStub's second word, so the reader reads
// "-fixturecolStub".
const FIXTURE_AFTER_STUB = [
  0xd28dec61, 0xf2aa6d81, 0xf2ceae81, 0xf2fdec41, 0xd28cc5b3, 0xf2af0d33, 0xf2ceae93, 0xf2ecae53,
];
// "-now", built in a 32-bit register: mov w8, #0x6e2d; movk w8, #0x776f, lsl #16.
const NOW_CODE = [0x528dc5a8, 0x72aeede8];
// "-network" (8 bytes), built in x19: mov x19, #0x6e2d; then movk "et", "wo" and "rk".
const NETWORK_CODE = [0xd28dc5b3, 0xf2ae8cb3, 0xf2cdeef3, 0xf2ed6e53];
// "-location" (9 bytes): its first 8, "-locatio", built in x19 as "-network" is above.
const LOCATION_CODE = [0xd28d85b3, 0xf2ac6df3, 0xf2ce8c33, 0xf2eded33];
// "-route" (6 bytes), as LLVM builds it in x6 (scripts/test/swift-small-strings.test.mjs).
const ROUTE_CODE = [0xd28e45a6, 0xf2aeade6, 0xf2ccae86];

const PRIVACY = plist({ NSPrivacyTracking: false, NSPrivacyCollectedDataTypes: [] });

function appInfo(over = {}) {
  return plist({
    CFBundleExecutable: 'WillItSnow',
    CFBundleIdentifier: 'today.willitsnow.app',
    CFBundleShortVersionString: '1.0',
    CFBundleVersion: '101',
    GADApplicationIdentifier: DEMO_APP,
    ITSAppUsesNonExemptEncryption: false,
    IsItBannerUnitID: DEMO_BANNER,
    IsItInterstitialUnitID: DEMO_INTERSTITIAL,
    IsItPageBannerUnitID: DEMO_BANNER,
    SKAdNetworkItems: [
      { SKAdNetworkIdentifier: GOOGLE_SKADNETWORK },
      { SKAdNetworkIdentifier: '4fzdc2evr5.skadnetwork' },
    ],
    // As actool adds it for the AppIcon set.
    CFBundleIcons: {
      CFBundlePrimaryIcon: { CFBundleIconFiles: ['AppIcon60x60'], CFBundleIconName: 'AppIcon' },
    },
    UIAppFonts: ['BricolageAnswer.ttf'],
    UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: false },
    ...over,
  });
}

function widgetInfo(over = {}) {
  return plist({
    CFBundleExecutable: 'WillItSnowWidgets',
    CFBundleIdentifier: 'today.willitsnow.app.widgets',
    CFBundleShortVersionString: '1.0',
    CFBundleVersion: '101',
    NSExtension: { NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' },
    UIAppFonts: ['BricolageAnswer.ttf'],
    ...over,
  });
}

let count = 0;
const fresh = (name) => join(root, `${name}-${++count}`);

/**
 * A fake Release archive that passes every check, with `files` (paths under the app) added,
 * replaced, or removed when undefined... removal is by `omit`.
 */
function archive({ files = {}, omit = [] } = {}) {
  const dir = fresh('WillItSnow.xcarchive');
  const app = 'Products/Applications/WillItSnow.app';
  const all = {
    'Info.plist': appInfo(),
    'PrivacyInfo.xcprivacy': PRIVACY,
    'Assets.car': 'compiled asset catalogue',
    'BricolageAnswer.ttf': 'font',
    WillItSnow: binary(['will it snow?', 'today.willitsnow.app']),
    'PlugIns/WillItSnowWidgets.appex/Info.plist': widgetInfo(),
    'PlugIns/WillItSnowWidgets.appex/PrivacyInfo.xcprivacy': PRIVACY,
    'PlugIns/WillItSnowWidgets.appex/BricolageAnswer.ttf': 'font',
    'PlugIns/WillItSnowWidgets.appex/WillItSnowWidgets': binary([
      '/usr/lib/swift/libswiftWidgetKit.dylib',
    ]),
    ...files,
  };
  for (const path of omit) delete all[path];
  tree(join(dir, app), all);
  return dir;
}

const APP_ENTITLEMENTS = {
  'application-identifier': 'MZPGUCY33H.today.willitsnow.app',
  'aps-environment': 'production',
  'com.apple.security.application-groups': [APP_GROUP],
  'get-task-allow': false,
};
const WIDGET_ENTITLEMENTS = {
  'application-identifier': 'MZPGUCY33H.today.willitsnow.app.widgets',
  'com.apple.security.application-groups': [APP_GROUP],
  'get-task-allow': false,
};

/** A fake exported app's Payload, signed with these entitlements (null: not signed). */
function payload({ app = APP_ENTITLEMENTS, widget = WIDGET_ENTITLEMENTS, noWidget = false } = {}) {
  const dir = fresh('export');
  const base = 'Payload/WillItSnow.app';
  tree(dir, {
    [`${base}/Info.plist`]: appInfo(),
    [`${base}/WillItSnow`]: binary(),
    [`${base}/fake-entitlements.plist`]: app ? plist(app) : undefined,
    ...(noWidget
      ? {}
      : {
          [`${base}/PlugIns/WillItSnowWidgets.appex/WillItSnowWidgets`]: binary(),
          [`${base}/PlugIns/WillItSnowWidgets.appex/fake-entitlements.plist`]: widget
            ? plist(widget)
            : undefined,
        }),
  });
  return dir;
}

/** Runs the script; its status, log, error annotations and step summary. */
function run(args, env = {}) {
  const summary = fresh('summary.md');
  const result = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PLUTIL: join(bin, 'plutil'),
      CODESIGN: join(bin, 'codesign'),
      GITHUB_STEP_SUMMARY: summary,
      BUILD_NUMBER: '',
      ADMOB_APP_ID: '',
      ADMOB_BANNER_ID: '',
      ADMOB_PAGE_BANNER_ID: '',
      ADMOB_INTERSTITIAL_ID: '',
      ...env,
    },
  });
  const errors = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('::error::'))
    .map((line) => line.replace('::error::check-archive.sh: ', ''));
  return {
    status: result.status,
    out: result.stdout,
    err: result.stderr,
    errors,
    summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
  };
}

const check = (dir, ads = 'test', env = {}) => run([dir, ads], env);
const WIDGET = 'PlugIns/WillItSnowWidgets.appex';

// --- The archive -----------------------------------------------------------------------------

describe('an archive that passes', () => {
  it('passes a test build, and says what it checked', () => {
    const result = check(archive(), 'test', { BUILD_NUMBER: '101' });
    expect(result.errors).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.summary).toBe(
      [
        '### Archive checks: passed',
        '',
        '- WillItSnow 1.0 (101)',
        `- ads test: Google's demo units (${DEMO_APP})`,
        "- checked: privacy manifests, the icon, the answer font, 15 debug hooks in both binaries, the ad units and SKAdNetworkItems, the widget's links, versions, encryption and fixtures",
        '',
      ].join('\n'),
    );
    expect(result.out).toContain('### Archive checks: passed');
  });

  it("passes a real build with Carl's IDs", () => {
    const dir = archive({ files: { 'Info.plist': appInfo(REAL) } });
    const result = check(dir, 'real', REAL_ENV);
    expect(result.errors).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.summary).toContain(`- ads real: ${CARL_APP}`);
  });

  it("passes with Google's SKAdNetwork identifier anywhere in SKAdNetworkItems", () => {
    const items = [
      { SKAdNetworkIdentifier: '4fzdc2evr5.skadnetwork' },
      { SKAdNetworkIdentifier: GOOGLE_SKADNETWORK },
    ];
    const dir = archive({ files: { 'Info.plist': appInfo({ SKAdNetworkItems: items }) } });
    expect(check(dir).errors).toEqual([]);
  });

  it('passes with "-now" and the like inside ordinary text', () => {
    const dir = archive({
      files: {
        WillItSnow: binary([
          'right-now',
          'the-clock-noads',
          'unlocked-resetStore',
          'ad-network',
          'use-location',
        ]),
      },
    });
    expect(check(dir).errors).toEqual([]);
  });

  it('passes with "-route" followed by a letter, as in OpenSSL\'s name in Google\'s SDK', () => {
    const dir = archive({
      files: {
        WillItSnow: binary(['sbgp-routerIdentifier', 'X509v3 sbgp-routerIdentifier', '-routeX']),
      },
    });
    expect(check(dir).errors).toEqual([]);
  });

  it("notes, without failing, when the app binary itself names Google's demo publisher", () => {
    const dir = archive({ files: { WillItSnow: binary([`GADTest ${DEMO_APP}`]) } });
    const result = check(dir);
    expect(result.status).toBe(0);
    expect(result.out).toContain(
      "::notice::check-archive.sh: the app binary itself contains Google's demo publisher ID; with ads real this archive would fail",
    );
    expect(result.summary).toContain(
      "- note: the app binary itself contains Google's demo publisher ID",
    );
  });
});

describe('an archive that fails', () => {
  it('fails when either bundle lacks its privacy manifest, or it is not a plist', () => {
    expect(check(archive({ omit: ['PrivacyInfo.xcprivacy'] })).errors).toEqual([
      'WillItSnow.app has no PrivacyInfo.xcprivacy',
    ]);
    expect(check(archive({ omit: [`${WIDGET}/PrivacyInfo.xcprivacy`] })).errors).toEqual([
      'WillItSnowWidgets.appex has no PrivacyInfo.xcprivacy',
    ]);
    const broken = archive({ files: { [`${WIDGET}/PrivacyInfo.xcprivacy`]: 'not a plist' } });
    expect(check(broken).errors).toEqual([
      "WillItSnowWidgets.appex's PrivacyInfo.xcprivacy isn't a plist",
    ]);
  });

  it.each([
    [
      'dynamically (its path in the load commands)',
      '@rpath/GoogleMobileAds.framework/GoogleMobileAds',
    ],
    ['statically (its classes)', 'GADMobileAds'],
    ["with Google's consent SDK", '@rpath/UserMessagingPlatform.framework/UserMessagingPlatform'],
  ])('fails when the widget links Google Mobile Ads %s', (_how, text) => {
    const dir = archive({ files: { [`${WIDGET}/WillItSnowWidgets`]: binary([text]) } });
    const result = check(dir);
    expect(result.errors).toEqual(['the widget links Google Mobile Ads']);
    expect(result.status).toBe(1);
  });

  it('fails when the app has no icon: no Assets.car, or no AppIcon in its Info.plist', () => {
    const noIcon =
      'the app has no icon: no Assets.car, or no CFBundleIconName AppIcon in its Info.plist';
    expect(check(archive({ omit: ['Assets.car'] })).errors).toEqual([noIcon]);
    expect(
      check(archive({ files: { 'Info.plist': appInfo({ CFBundleIcons: undefined }) } })).errors,
    ).toEqual([noIcon]);
    const other = { CFBundlePrimaryIcon: { CFBundleIconName: 'Icon' } };
    expect(
      check(archive({ files: { 'Info.plist': appInfo({ CFBundleIcons: other }) } })).errors,
    ).toEqual([noIcon]);
  });

  it('fails when either bundle lacks the answer font, or UIAppFonts leaves it out', () => {
    expect(check(archive({ omit: ['BricolageAnswer.ttf'] })).errors).toEqual([
      'WillItSnow.app has no BricolageAnswer.ttf',
    ]);
    expect(check(archive({ omit: [`${WIDGET}/BricolageAnswer.ttf`] })).errors).toEqual([
      'WillItSnowWidgets.appex has no BricolageAnswer.ttf',
    ]);
    expect(
      check(archive({ files: { 'Info.plist': appInfo({ UIAppFonts: undefined }) } })).errors,
    ).toEqual(["WillItSnow.app's UIAppFonts doesn't name BricolageAnswer.ttf"]);
    expect(
      check(
        archive({ files: { [`${WIDGET}/Info.plist`]: widgetInfo({ UIAppFonts: ['Other.ttf'] }) } }),
      ).errors,
    ).toEqual(["WillItSnowWidgets.appex's UIAppFonts doesn't name BricolageAnswer.ttf"]);
  });

  it.each(['CLLocationManager', 'CoreLocationService'])(
    "fails when the widget links the app's location code (%s)",
    (text) => {
      const dir = archive({ files: { [`${WIDGET}/WillItSnowWidgets`]: binary([text]) } });
      expect(check(dir).errors).toEqual(["the widget links the app's location code"]);
    },
  );

  it("passes with the location code in the app's binary", () => {
    const dir = archive({ files: { WillItSnow: binary(['CLLocationManager']) } });
    expect(check(dir).errors).toEqual([]);
  });

  it('fails when the widget embeds the Google Mobile Ads framework', () => {
    const dir = archive({
      files: { [`${WIDGET}/Frameworks/GoogleMobileAds.framework/GoogleMobileAds`]: binary() },
    });
    expect(check(dir).errors).toEqual(['the widget links Google Mobile Ads']);
  });

  it.each(HOOKS)('fails when the app binary contains the debug hook %s', (hook) => {
    const dir = archive({
      files: { WillItSnow: binary(['will it snow?', `launch ${hook} value`]) },
    });
    expect(check(dir).errors).toEqual([
      `the app binary contains the debug hook ${hook}: launch ${hook} value`,
    ]);
  });

  it.each(['-route', '-route https://x', 'launch -route=willitsnow://x'])(
    'fails on the debug hook -route where no letter follows it: %j',
    (text) => {
      const dir = archive({ files: { WillItSnow: binary(['sbgp-routerIdentifier', text]) } });
      expect(check(dir).errors).toEqual([`the app binary contains the debug hook -route: ${text}`]);
    },
  );

  it('fails when the widget binary contains a debug hook', () => {
    const dir = archive({
      files: { [`${WIDGET}/WillItSnowWidgets`]: binary(['http://127.0.0.1:8080']) },
    });
    expect(check(dir).errors).toEqual([
      'the widget binary contains the debug hook 127.0.0.1: http://127.0.0.1:8080',
    ]);
  });

  it('fails on a hook the optimiser built in instructions, which strings(1) misses', () => {
    const app = archive({ files: { WillItSnow: binary(['will it snow?'], UITEST_CODE) } });
    expect(check(app).errors).toEqual([
      'the app binary builds the debug hook -uitest as a short Swift literal',
    ]);
    const spread = archive({ files: { WillItSnow: binary(['will it snow?'], UITEST_SPREAD) } });
    expect(check(spread).errors).toEqual([
      'the app binary builds the debug hook -uitest as a short Swift literal',
    ]);
    const widget = archive({ files: { [`${WIDGET}/WillItSnowWidgets`]: binary([], NOW_CODE) } });
    expect(check(widget).errors).toEqual([
      'the widget binary builds the debug hook -now as a short Swift literal',
    ]);
    const route = archive({ files: { WillItSnow: binary(['will it snow?'], ROUTE_CODE) } });
    expect(check(route).errors).toEqual([
      'the app binary builds the debug hook -route as a short Swift literal',
    ]);
  });

  it("fails on a hook of 8 bytes or more joined to another string's second word", () => {
    const unlocked = archive({ files: { WillItSnow: binary([], UNLOCKED_DERIVED) } });
    expect(check(unlocked).errors).toEqual([
      'the app binary builds the debug hook -unlocked as a short Swift literal',
    ]);
    const fixture = archive({ files: { WillItSnow: binary([], FIXTURE_AFTER_STUB) } });
    expect(check(fixture).errors).toEqual([
      'the app binary builds the debug hook -fixture as a short Swift literal',
    ]);
    const network = archive({ files: { WillItSnow: binary([], NETWORK_CODE) } });
    expect(check(network).errors).toEqual([
      'the app binary builds the debug hook -network as a short Swift literal',
    ]);
    const location = archive({ files: { WillItSnow: binary([], LOCATION_CODE) } });
    expect(check(location).errors).toEqual([
      'the app binary builds the debug hook -location as a short Swift literal',
    ]);
  });

  it("fails a real build that names Google's demo publisher, in the binary or the Info.plist", () => {
    const inBinary = archive({
      files: { 'Info.plist': appInfo(REAL), WillItSnow: binary([`unit ${DEMO_BANNER}`]) },
    });
    expect(check(inBinary, 'real').errors).toEqual([
      `with ads real, the app binary contains Google's demo publisher 3940256099942544: unit ${DEMO_BANNER}`,
    ]);
    const inInfo = archive({
      files: { 'Info.plist': appInfo({ ...REAL, IsItBannerUnitID: DEMO_BANNER }) },
    });
    expect(check(inInfo, 'real', { ADMOB_BANNER_ID: CARL_BANNER }).errors).toEqual([
      "with ads real, the app's Info.plist contains Google's demo publisher 3940256099942544",
      `with ads real, IsItBannerUnitID is ${DEMO_BANNER}, not ADMOB_BANNER_ID`,
    ]);
    const interstitial = archive({
      files: { 'Info.plist': appInfo({ ...REAL, IsItInterstitialUnitID: DEMO_INTERSTITIAL }) },
    });
    expect(check(interstitial, 'real', REAL_ENV).errors).toEqual([
      "with ads real, the app's Info.plist contains Google's demo publisher 3940256099942544",
      `with ads real, IsItInterstitialUnitID is ${DEMO_INTERSTITIAL}, not ADMOB_INTERSTITIAL_ID`,
    ]);
  });

  it('fails a real build whose ad units are missing, malformed or not the variables', () => {
    const empty = archive({
      files: {
        'Info.plist': appInfo({
          GADApplicationIdentifier: '',
          IsItBannerUnitID: undefined,
          IsItPageBannerUnitID: undefined,
          IsItInterstitialUnitID: undefined,
        }),
      },
    });
    expect(check(empty, 'real').errors).toEqual([
      'with ads real, GADApplicationIdentifier is missing, not an AdMob app ID',
      'with ads real, IsItBannerUnitID is missing, not an AdMob ad unit',
      'with ads real, IsItPageBannerUnitID is missing, not an AdMob ad unit',
      'with ads real, IsItInterstitialUnitID is missing, not an AdMob ad unit',
    ]);
    const other = archive({ files: { 'Info.plist': appInfo(REAL) } });
    expect(
      check(other, 'real', { ADMOB_APP_ID: 'ca-app-pub-1234567890123456~1111111111' }).errors,
    ).toEqual([`with ads real, GADApplicationIdentifier is ${CARL_APP}, not ADMOB_APP_ID`]);
  });

  it.each(UNITS)('fails a real build whose %s is malformed or not %s', (key, variable) => {
    const malformed = archive({ files: { 'Info.plist': appInfo({ ...REAL, [key]: CARL_APP }) } });
    expect(check(malformed, 'real', REAL_ENV).errors).toEqual([
      `with ads real, ${key} is ${CARL_APP}, not an AdMob ad unit`,
    ]);
    const unit = 'ca-app-pub-1234567890123456/1111111111';
    const other = archive({ files: { 'Info.plist': appInfo({ ...REAL, [key]: unit }) } });
    expect(check(other, 'real', REAL_ENV).errors).toEqual([
      `with ads real, ${key} is ${unit}, not ${variable}`,
    ]);
    // Without the variable, any AdMob unit will do, as with the app ID.
    expect(check(other, 'real', { ...REAL_ENV, [variable]: '' }).errors).toEqual([]);
  });

  it("fails unless SKAdNetworkItems holds Google's SKAdNetwork identifier, test or real", () => {
    const message = `the app's Info.plist has no SKAdNetworkItems holding Google's ${GOOGLE_SKADNETWORK}`;
    const none = archive({ files: { 'Info.plist': appInfo({ SKAdNetworkItems: undefined }) } });
    expect(check(none).errors).toEqual([message]);
    const others = archive({
      files: {
        'Info.plist': appInfo({
          SKAdNetworkItems: [{ SKAdNetworkIdentifier: '4fzdc2evr5.skadnetwork' }],
        }),
      },
    });
    expect(check(others).errors).toEqual([message]);
    // A bare string isn't an item: each item is a dictionary holding SKAdNetworkIdentifier.
    const bare = archive({
      files: { 'Info.plist': appInfo({ SKAdNetworkItems: [GOOGLE_SKADNETWORK] }) },
    });
    expect(check(bare).errors).toEqual([message]);
    const real = archive({
      files: { 'Info.plist': appInfo({ ...REAL, SKAdNetworkItems: [] }) },
    });
    expect(check(real, 'real', REAL_ENV).errors).toEqual([message]);
  });

  it("fails a test build that contains Carl's publisher ID", () => {
    const dir = archive({ files: { WillItSnow: binary(['house ad 1234567890123456']) } });
    expect(check(dir, 'test', { ADMOB_APP_ID: CARL_APP }).errors).toEqual([
      "with ads test, the app contains Carl's publisher ID (ADMOB_APP_ID's)",
    ]);
  });

  it('fails a test build that names any publisher but Google demo one, or other units', () => {
    const dir = archive({ files: { 'Info.plist': appInfo({ IsItBannerUnitID: CARL_BANNER }) } });
    expect(check(dir, 'test').errors).toEqual([
      `with ads test, IsItBannerUnitID is ${CARL_BANNER}, not a Google demo unit`,
      "with ads test, the app names the AdMob publisher pub-1234567890123456, not only Google's demo one",
    ]);
    const missing = archive({
      files: { 'Info.plist': appInfo({ GADApplicationIdentifier: undefined }) },
    });
    expect(check(missing, 'test').errors).toEqual([
      'with ads test, GADApplicationIdentifier is missing, not a Google demo app ID',
    ]);
  });

  it.each(UNITS)('fails a test build whose %s is not a Google demo unit', (key, _, unit) => {
    const carl = archive({ files: { 'Info.plist': appInfo({ [key]: unit }) } });
    expect(check(carl, 'test').errors).toEqual([
      `with ads test, ${key} is ${unit}, not a Google demo unit`,
      "with ads test, the app names the AdMob publisher pub-1234567890123456, not only Google's demo one",
    ]);
    const missing = archive({ files: { 'Info.plist': appInfo({ [key]: undefined }) } });
    expect(check(missing, 'test').errors).toEqual([
      `with ads test, ${key} is missing, not a Google demo unit`,
    ]);
  });

  it('fails when the app and widget differ in build or version, or the build is not BUILD_NUMBER', () => {
    const build = archive({
      files: { [`${WIDGET}/Info.plist`]: widgetInfo({ CFBundleVersion: '100' }) },
    });
    expect(check(build).errors).toEqual(["the widget's CFBundleVersion is 100, the app's 101"]);
    const version = archive({
      files: { [`${WIDGET}/Info.plist`]: widgetInfo({ CFBundleShortVersionString: '1.1' }) },
    });
    expect(check(version).errors).toEqual([
      "the widget's CFBundleShortVersionString is 1.1, the app's 1.0",
    ]);
    expect(check(archive(), 'test', { BUILD_NUMBER: '102' }).errors).toEqual([
      "the app's CFBundleVersion is 101, not 102 (BUILD_NUMBER)",
    ]);
    const none = archive({
      files: {
        'Info.plist': appInfo({ CFBundleVersion: undefined }),
        [`${WIDGET}/Info.plist`]: widgetInfo({ CFBundleVersion: undefined }),
      },
    });
    expect(check(none).errors).toEqual(['the app has no CFBundleVersion']);
  });

  it('fails unless ITSAppUsesNonExemptEncryption is false', () => {
    const missing = archive({
      files: { 'Info.plist': appInfo({ ITSAppUsesNonExemptEncryption: undefined }) },
    });
    expect(check(missing).errors).toEqual([
      "the app's ITSAppUsesNonExemptEncryption is missing, not false",
    ]);
    const yes = archive({
      files: { 'Info.plist': appInfo({ ITSAppUsesNonExemptEncryption: true }) },
    });
    expect(check(yes).errors).toEqual([
      "the app's ITSAppUsesNonExemptEncryption is true, not false",
    ]);
  });

  it('fails when the fixtures are bundled, as a folder or loose', () => {
    const folder = archive({ files: { 'Fixtures/aberdeen-snow.json': '{"_fixture":{}}' } });
    expect(check(folder).errors).toEqual(['the app bundles the fixtures']);
    const loose = archive({ files: { 'leeds-dry.json': '{\n  "_fixture": {}\n}' } });
    expect(check(loose).errors).toEqual(['the app bundles the fixtures']);
  });

  it('fails when there is no widget, app, Info.plist or executable', () => {
    const noWidget = archive({
      omit: [
        `${WIDGET}/Info.plist`,
        `${WIDGET}/PrivacyInfo.xcprivacy`,
        `${WIDGET}/BricolageAnswer.ttf`,
        `${WIDGET}/WillItSnowWidgets`,
      ],
    });
    expect(check(noWidget).errors).toEqual([
      "the widget extension WillItSnowWidgets.appex isn't embedded in the app",
    ]);
    const empty = fresh('Empty.xcarchive');
    mkdirSync(empty);
    expect(check(empty).errors).toEqual([`no WillItSnow.app in ${empty}/Products/Applications`]);
    expect(check(archive({ omit: ['Info.plist'] })).errors).toEqual([
      'WillItSnow.app has no Info.plist that plutil can read',
    ]);
    expect(check(archive({ omit: ['WillItSnow'] })).errors).toEqual([
      'WillItSnow.app has no executable WillItSnow',
    ]);
  });

  it('reports every failure, and counts them in the summary', () => {
    const dir = archive({
      omit: ['PrivacyInfo.xcprivacy'],
      files: {
        'Info.plist': appInfo({ ITSAppUsesNonExemptEncryption: true }),
        WillItSnow: binary(['-fixture: the app has no Fixtures/']),
      },
    });
    const result = check(dir);
    expect(result.status).toBe(1);
    expect(result.errors).toHaveLength(3);
    expect(result.summary).toMatch(
      /^### Archive checks: 3 failed\n\n- WillItSnow.app has no PrivacyInfo/,
    );
  });
});

// --- The exported app ------------------------------------------------------------------------

describe('an exported app (--ipa)', () => {
  it('passes, from the Payload folder or the .ipa itself', () => {
    const dir = payload();
    const result = run(['--ipa', dir]);
    expect(result.errors).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.summary).toBe(
      [
        '### Signed app checks: passed',
        '',
        `- checked: the app pushes in production; both have ${APP_GROUP}; the widget doesn't push; neither is debuggable`,
        '',
      ].join('\n'),
    );
    const ipa = join(root, 'WillItSnow.ipa');
    execFileSync('zip', ['-q', '-r', ipa, 'Payload'], { cwd: dir });
    expect(run(['--ipa', ipa]).errors).toEqual([]);
  });

  it('fails unless the app has aps-environment production', () => {
    const development = payload({ app: { ...APP_ENTITLEMENTS, 'aps-environment': 'development' } });
    expect(run(['--ipa', development]).errors).toEqual([
      "the app's aps-environment is development, not production",
    ]);
    const none = payload({ app: { ...APP_ENTITLEMENTS, 'aps-environment': undefined } });
    expect(run(['--ipa', none]).errors).toEqual([
      "the app's aps-environment is missing, not production",
    ]);
  });

  it('fails unless both have the App Group', () => {
    const app = payload({
      app: { ...APP_ENTITLEMENTS, 'com.apple.security.application-groups': [] },
    });
    expect(run(['--ipa', app]).errors).toEqual([`the app lacks the App Group ${APP_GROUP}`]);
    const widget = payload({
      widget: {
        ...WIDGET_ENTITLEMENTS,
        'com.apple.security.application-groups': ['group.today.other'],
      },
    });
    expect(run(['--ipa', widget]).errors).toEqual([`the widget lacks the App Group ${APP_GROUP}`]);
    const keychain = payload({
      widget: {
        ...WIDGET_ENTITLEMENTS,
        'com.apple.security.application-groups': undefined,
        'keychain-access-groups': [APP_GROUP],
      },
    });
    expect(run(['--ipa', keychain]).errors).toEqual([
      `the widget lacks the App Group ${APP_GROUP}`,
    ]);
  });

  it('fails when the widget has aps-environment', () => {
    const dir = payload({ widget: { ...WIDGET_ENTITLEMENTS, 'aps-environment': 'production' } });
    expect(run(['--ipa', dir]).errors).toEqual([
      'the widget has aps-environment (production); only the app gets notifications',
    ]);
  });

  it('fails when either is debuggable or unsigned', () => {
    const debuggable = payload({ app: { ...APP_ENTITLEMENTS, 'get-task-allow': true } });
    expect(run(['--ipa', debuggable]).errors).toEqual([
      'WillItSnow.app is signed debuggable (get-task-allow)',
    ]);
    expect(run(['--ipa', payload({ app: null })]).errors).toEqual([
      "WillItSnow.app isn't signed, or has no entitlements",
    ]);
    expect(run(['--ipa', payload({ widget: null })]).errors).toEqual([
      "WillItSnowWidgets.appex isn't signed, or has no entitlements",
    ]);
  });

  it('fails when the widget, the app or the .ipa is not there', () => {
    expect(run(['--ipa', payload({ noWidget: true })]).errors).toEqual([
      "the widget extension WillItSnowWidgets.appex isn't embedded in the app",
    ]);
    const empty = fresh('export');
    mkdirSync(empty);
    expect(run(['--ipa', empty]).errors).toEqual([`no Payload/WillItSnow.app in ${empty}`]);
    const notZip = join(root, 'not.ipa');
    writeFileSync(notZip, 'not a zip');
    const result = run(['--ipa', notZip]);
    expect(result.errors).toEqual([`${notZip} isn't an .ipa that unzip can open`]);
    expect(result.status).toBe(1);
  });
});

describe('usage', () => {
  it.each([[[]], [['only-one']], [['a.xcarchive', 'demo']], [['--ipa']], [['--ipa', 'a', 'b']]])(
    'exits 2 for %j',
    (args) => {
      const result = run(args);
      expect(result.status).toBe(2);
      expect(result.err).toContain('usage: check-archive.sh');
    },
  );
});

describe('plist_get', () => {
  const xml = join(root, 'read.plist');
  writeFileSync(
    xml,
    plist({
      'aps-environment': 'production',
      CFBundleVersion: '101',
      Count: 3,
      Yes: true,
      No: false,
      Empty: '',
      'com.apple.security.application-groups': ['group.a', 'group.b'],
      None: [],
      Nested: { CFBundleShortVersionString: '9.9' },
    }),
  );
  /** The function itself, from the sourced script: its output and status. */
  const get = (key) => {
    const result = spawnSync(
      'bash',
      ['-c', 'source "$1"; plist_get "$2" <"$3"', 'bash', SCRIPT, key, xml],
      {
        encoding: 'utf8',
      },
    );
    return [result.stdout, result.status];
  };

  it('reads strings, numbers, booleans and arrays of strings at the top level', () => {
    expect(get('aps-environment')).toEqual(['production\n', 0]);
    expect(get('CFBundleVersion')).toEqual(['101\n', 0]);
    expect(get('Count')).toEqual(['3\n', 0]);
    expect(get('Yes')).toEqual(['true\n', 0]);
    expect(get('No')).toEqual(['false\n', 0]);
    expect(get('Empty')).toEqual(['\n', 0]);
    expect(get('com.apple.security.application-groups')).toEqual(['group.a\ngroup.b\n', 0]);
    expect(get('None')).toEqual(['', 0]);
  });

  it('fails for a key it lacks, or one only inside a dictionary', () => {
    expect(get('Missing')).toEqual(['', 1]);
    expect(get('CFBundleShortVersionString')).toEqual(['', 1]);
  });
});

describe('plist_get_each', () => {
  const xml = join(root, 'each.plist');
  writeFileSync(
    xml,
    plist({
      Items: [
        { Id: 'a.skadnetwork', Other: 'x' },
        { Other: 'y' },
        { Other: 'z', Id: 'b.skadnetwork' },
        'c.skadnetwork',
      ],
      None: [],
      Plain: 'Id',
      Nested: { Inner: [{ Id: 'd.skadnetwork' }] },
    }),
  );
  /** The function itself, from the sourced script: its output and status. */
  const each = (array, key) => {
    const result = spawnSync(
      'bash',
      ['-c', 'source "$1"; plist_get_each "$2" "$3" <"$4"', 'bash', SCRIPT, array, key, xml],
      { encoding: 'utf8' },
    );
    return [result.stdout, result.status];
  };

  it('reads the key from each dictionary of a top-level array, in order, and nothing else', () => {
    expect(each('Items', 'Id')).toEqual(['a.skadnetwork\nb.skadnetwork\n', 0]);
    expect(each('Items', 'Other')).toEqual(['x\ny\nz\n', 0]);
    expect(each('None', 'Id')).toEqual(['', 0]);
    // Not arrays.
    expect(each('Plain', 'Id')).toEqual(['', 0]);
    expect(each('Nested', 'Id')).toEqual(['', 0]);
  });

  it('fails for a key it lacks, or one only inside a dictionary', () => {
    expect(each('Missing', 'Id')).toEqual(['', 1]);
    expect(each('Inner', 'Id')).toEqual(['', 1]);
  });
});
