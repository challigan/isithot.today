import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_LENGTH, clip, setWhatToTest } from '../asc-notes.mjs';

const SCRIPT = new URL('../asc-notes.mjs', import.meta.url).pathname;
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const CREDS = { keyId: 'ABC123DEFG', issuerId: 'issuer', p8: PEM };
const API = 'https://api.appstoreconnect.apple.com';

/**
 * A fake App Store Connect: the app, the build once `appearsAfter` lookups have missed it, its
 * localisations, and `refusals` 409s to the first writes. Records each request.
 */
function connect({
  appearsAfter = 0,
  localisations = [],
  refusals = 0,
  apps,
  state = 'PROCESSING',
} = {}) {
  const asked = [];
  let lookups = 0;
  const answer = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetchImpl = async (url, init) => {
    const method = init.method ?? 'GET';
    asked.push({ method, url: url.replace(API, ''), body: init.body && JSON.parse(init.body) });
    if (url.startsWith(`${API}/v1/apps?`)) {
      return answer(200, {
        data: apps ?? [{ id: 'app1', attributes: { bundleId: 'today.willitsnow.app' } }],
      });
    }
    if (url.startsWith(`${API}/v1/builds?`)) {
      lookups += 1;
      const found = lookups > appearsAfter;
      return answer(200, {
        data: found
          ? [{ id: 'build1', attributes: { version: '123', processingState: state } }]
          : [],
      });
    }
    if (url.startsWith(`${API}/v1/builds/build1/betaBuildLocalizations`)) {
      return answer(200, { data: localisations });
    }
    if (method !== 'GET' && refusals > 0) {
      refusals -= 1;
      return answer(409, { errors: [{ title: 'Conflict', detail: 'Still processing.' }] });
    }
    return answer(method === 'POST' ? 201 : 200, { data: {} });
  };
  return { asked, fetchImpl };
}

/** A clock that only sleeping moves on. */
function clock() {
  let t = 0;
  const slept = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
  };
}

const writes = (asked) => asked.filter((a) => a.method !== 'GET');

describe('setWhatToTest', () => {
  it('waits for the build, then adds its English (UK) What to test', async () => {
    const { asked, fetchImpl } = connect({ appearsAfter: 2 });
    const time = clock();
    const result = await setWhatToTest(
      { creds: CREDS, version: '123', notes: 'Try the widget.' },
      { fetchImpl, ...time },
    );
    expect(result).toEqual({ state: 'PROCESSING', action: 'created' });
    expect(time.slept).toEqual([30_000, 30_000]);
    expect(asked[0].url).toBe(
      '/v1/apps?filter[bundleId]=today.willitsnow.app&fields[apps]=bundleId',
    );
    expect(asked[1].url).toBe(
      '/v1/builds?filter[app]=app1&filter[version]=123&fields[builds]=version,processingState&limit=1',
    );
    expect(writes(asked)).toEqual([
      {
        method: 'POST',
        url: '/v1/betaBuildLocalizations',
        body: {
          data: {
            type: 'betaBuildLocalizations',
            attributes: { locale: 'en-GB', whatsNew: 'Try the widget.' },
            relationships: { build: { data: { type: 'builds', id: 'build1' } } },
          },
        },
      },
    ]);
  });

  it('updates the English (UK) localisation when the build already has one', async () => {
    const { asked, fetchImpl } = connect({
      localisations: [
        { id: 'us', attributes: { locale: 'en-US', whatsNew: null } },
        { id: 'gb', attributes: { locale: 'en-GB', whatsNew: null } },
      ],
      state: 'VALID',
    });
    const result = await setWhatToTest(
      { creds: CREDS, version: '123', notes: 'Notes' },
      { fetchImpl, ...clock() },
    );
    expect(result).toEqual({ state: 'VALID', action: 'updated' });
    expect(writes(asked)).toEqual([
      {
        method: 'PATCH',
        url: '/v1/betaBuildLocalizations/gb',
        body: {
          data: { type: 'betaBuildLocalizations', id: 'gb', attributes: { whatsNew: 'Notes' } },
        },
      },
    ]);
  });

  it('tries again while App Store Connect refuses the change', async () => {
    const { asked, fetchImpl } = connect({ refusals: 2 });
    const time = clock();
    const result = await setWhatToTest(
      { creds: CREDS, version: '123', notes: 'Notes' },
      { fetchImpl, ...time },
    );
    expect(result.action).toBe('created');
    expect(writes(asked)).toHaveLength(3);
    expect(time.slept).toHaveLength(2);
  });

  it('gives up when the build never appears, or is still refused, when the time is up', async () => {
    const missing = connect({ appearsAfter: 1000 });
    const time = clock();
    const err = await setWhatToTest(
      { creds: CREDS, version: '123', notes: 'Notes' },
      { fetchImpl: missing.fetchImpl, ...time, waitMs: 5 * 60_000 },
    ).catch((e) => e);
    expect(err.message).toBe("build 123 wasn't in App Store Connect after 5 minutes");
    expect(time.slept).toHaveLength(10);

    const refused = connect({ refusals: 1000 });
    const later = await setWhatToTest(
      { creds: CREDS, version: '123', notes: 'Notes' },
      { fetchImpl: refused.fetchImpl, ...clock(), waitMs: 60_000 },
    ).catch((e) => e);
    expect(later.message).toBe('App Store Connect answered 409: Conflict: Still processing.');
  });

  it('fails at once on any other error, and when there is no app record', async () => {
    const forbidden = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ errors: [{ title: 'Forbidden', detail: 'No access.' }] }),
    });
    const err = await setWhatToTest(
      { creds: CREDS, version: '123', notes: 'Notes' },
      { fetchImpl: forbidden, ...clock() },
    ).catch((e) => e);
    expect(err.status).toBe(403);

    const { fetchImpl } = connect({
      apps: [{ id: 'other', attributes: { bundleId: 'today.willitsnow.app.widgets' } }],
    });
    const none = await setWhatToTest(
      { creds: CREDS, version: '123', notes: 'Notes' },
      { fetchImpl, ...clock() },
    ).catch((e) => e);
    expect(none.message).toBe('App Store Connect has no app record for today.willitsnow.app');
  });
});

describe('clip', () => {
  it("trims the notes, and cuts them to App Store Connect's limit", () => {
    expect(clip('  Try the widget.\n')).toEqual({ text: 'Try the widget.', cut: false });
    expect(clip('x'.repeat(MAX_LENGTH))).toEqual({ text: 'x'.repeat(MAX_LENGTH), cut: false });
    expect(clip('x'.repeat(MAX_LENGTH + 1))).toEqual({ text: 'x'.repeat(MAX_LENGTH), cut: true });
  });
});

describe('the command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asc-notes-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (env) => {
    const summary = join(dir, `summary-${Math.random()}.md`);
    const result = spawnSync('node', [SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_STEP_SUMMARY: summary,
        ...env,
      },
    });
    let text = '';
    try {
      text = readFileSync(summary, 'utf8');
    } catch {
      // no summary written
    }
    return { status: result.status, out: result.stdout, summary: text };
  };

  it('leaves What to test alone when there are no notes', () => {
    const result = run({ NOTES: '  ', BUILD_NUMBER: '123' });
    expect(result.status).toBe(0);
    expect(result.summary).toBe('### What to test: no notes given, so left as it is\n\n');
  });

  it('warns, without failing, when it cannot set them', () => {
    const missingKey = run({ NOTES: 'Try the widget.', BUILD_NUMBER: '123' });
    expect(missingKey.status).toBe(0);
    expect(missingKey.out).toContain(
      "::warning::asc-notes.mjs: What to test isn't set: Missing ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8",
    );
    expect(missingKey.summary).toContain(
      'Type it in App Store Connect: TestFlight, build 123, Test Details.',
    );
    const noBuild = run({
      NOTES: 'Try the widget.',
      ASC_KEY_ID: CREDS.keyId,
      ASC_ISSUER_ID: CREDS.issuerId,
      ASC_KEY_P8: PEM,
    });
    expect(noBuild.status).toBe(0);
    expect(noBuild.summary).toMatch(/^### What to test: not set \(BUILD_NUMBER is missing\)/);
    expect(noBuild.summary).toContain('build ?, Test Details');
  });
});
