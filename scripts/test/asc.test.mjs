import { execFileSync } from 'node:child_process';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AscError,
  credentials,
  getAll,
  keyFolder,
  keyPem,
  report,
  request,
  token,
  writeFastlaneKey,
  writeKey,
} from '../asc.mjs';

// A throwaway P-256 key, as App Store Connect's .p8 files are.
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const BODY = PEM.split('\n').slice(1, -2).join('');
const CREDS = { keyId: 'ABC123DEFG', issuerId: '57246542-96fe-1a63-e053-0824d011072a', p8: PEM };

const parts = (jwt) => jwt.split('.');
const json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('keyPem', () => {
  it('takes the file as it is', () => {
    expect(keyPem(PEM)).toBe(PEM);
  });

  it('takes the text however pasting left its line breaks', () => {
    const begin = '-----BEGIN PRIVATE KEY-----';
    const end = '-----END PRIVATE KEY-----';
    expect(keyPem(PEM.replace(/\n/g, '\r\n'))).toBe(PEM);
    expect(keyPem(`${begin} ${BODY} ${end}`)).toBe(PEM);
    expect(keyPem(`  \n${begin}${BODY.slice(0, 30)}\n \n${BODY.slice(30)}${end}\n\n`)).toBe(PEM);
  });

  it('takes the file in base64', () => {
    expect(keyPem(Buffer.from(PEM).toString('base64'))).toBe(PEM);
  });

  it('says what it wants for anything else', () => {
    expect(() => keyPem('not a key')).toThrow(/paste the file's text/);
    expect(() => keyPem('-----END PRIVATE KEY----- -----BEGIN PRIVATE KEY-----')).toThrow(
      /not a \.p8 key/,
    );
  });
});

describe('credentials', () => {
  it('reads the three settings, trimmed', () => {
    const env = { ASC_KEY_ID: ' ABC123DEFG\n', ASC_ISSUER_ID: 'issuer ', ASC_KEY_P8: PEM };
    expect(credentials(env)).toEqual({ keyId: 'ABC123DEFG', issuerId: 'issuer', p8: PEM });
  });

  it('names the ones missing', () => {
    expect(() => credentials({ ASC_KEY_ID: 'x', ASC_KEY_P8: ' ' })).toThrow(
      'Missing ASC_ISSUER_ID, ASC_KEY_P8: run this job in the testflight environment.',
    );
  });
});

describe('token', () => {
  it("is a team key's ES256 token for App Store Connect, signed by the key", () => {
    const now = Date.UTC(2026, 9, 22, 23, 0, 0);
    const [header, payload, signature] = parts(token(CREDS, now));
    expect(json(header)).toEqual({ alg: 'ES256', kid: 'ABC123DEFG', typ: 'JWT' });
    expect(json(payload)).toEqual({
      iss: CREDS.issuerId,
      iat: now / 1000,
      exp: now / 1000 + 15 * 60,
      aud: 'appstoreconnect-v1',
    });
    // 64 bytes of raw r and s, which a JWT verifier checks against the key's public half.
    const raw = Buffer.from(signature, 'base64url');
    expect(raw).toHaveLength(64);
    const ok = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' },
      raw,
    );
    expect(ok).toBe(true);
  });

  it('signs the same with the key pasted any way', () => {
    const pasted = {
      ...CREDS,
      p8: `-----BEGIN PRIVATE KEY----- ${BODY} -----END PRIVATE KEY-----`,
    };
    const [header, payload, signature] = parts(token(pasted, 0, 20));
    expect(json(payload).exp).toBe(20 * 60);
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });
});

describe('getAll', () => {
  /** A fake API answering each URL in turn from `pages`, recording what was asked. */
  const fake = (pages) => {
    const asked = [];
    const fetchImpl = async (url, init) => {
      asked.push({ url, init });
      const page = pages[asked.length - 1];
      return { ok: page.status === 200, status: page.status, json: async () => page.body };
    };
    return { asked, fetchImpl };
  };

  it('follows every page, with a fresh token on each', async () => {
    const { asked, fetchImpl } = fake([
      { status: 200, body: { data: [{ id: '1' }], links: { next: 'https://n/2' } } },
      { status: 200, body: { data: [{ id: '2' }, { id: '3' }], links: {} } },
    ]);
    const items = await getAll('/v1/apps?limit=1', CREDS, fetchImpl);
    expect(items.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(asked.map((a) => a.url)).toEqual([
      'https://api.appstoreconnect.apple.com/v1/apps?limit=1',
      'https://n/2',
    ]);
    expect(asked[0].init.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('takes a page without data as empty', async () => {
    const { fetchImpl } = fake([{ status: 200, body: {} }]);
    expect(await getAll('/v1/bundleIds', CREDS, fetchImpl)).toEqual([]);
  });

  it("fails with the status and Apple's reasons", async () => {
    const { fetchImpl } = fake([
      {
        status: 401,
        body: {
          errors: [
            {
              title: 'Authentication credentials are missing or invalid.',
              detail: 'Provide a properly configured and signed bearer token.',
            },
          ],
        },
      },
    ]);
    const err = await getAll('/v1/apps', CREDS, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(AscError);
    expect(err.status).toBe(401);
    expect(err.message).toBe(
      'App Store Connect answered 401: Authentication credentials are missing or invalid.: Provide a properly configured and signed bearer token.',
    );
  });

  it('fails with the status alone when the answer is not JSON', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    const err = await getAll('/v1/apps', CREDS, fetchImpl).catch((e) => e);
    expect(err.message).toBe('App Store Connect answered 503');
  });
});

describe('report', () => {
  const app = (name, bundleId) => ({ attributes: { name, bundleId } });
  const id = (identifier, name) => ({ attributes: { identifier, name, platform: 'IOS' } });

  it("counts everything but names only this project's apps and app IDs", () => {
    const apps = [
      app('Something else', 'com.example.other'),
      app('willitsnow.today', 'today.willitsnow.app'),
    ];
    const ids = [
      id('com.example.other', 'Other'),
      id('com.example.sideloaded.ABCDE12345', 'Sideloaded'),
      id('today.willitsnow.app', 'willitsnow'),
      id('today.willitsnow.app.widgets', 'willitsnow widgets'),
    ];
    const text = report(apps, ids).join('\n');
    expect(report(apps, ids)).toEqual([
      'The key works. Apps on the account: 2.',
      "This project's (today.*): 1, and 1 other, not named here.",
      '  willitsnow.today (today.willitsnow.app)',
      'Registered app IDs: 4.',
      "This project's (today.*): 2, and 2 others, not named here.",
      '  today.willitsnow.app (IOS, "willitsnow")',
      '  today.willitsnow.app.widgets (IOS, "willitsnow widgets")',
    ]);
    expect(text).not.toMatch(/example|Something else|Sideloaded/);
  });

  it('says so when there is nothing of this project yet', () => {
    expect(report([app('Other', 'com.example.other')], [])).toEqual([
      'The key works. Apps on the account: 1.',
      "This project's (today.*): 0, and 1 other, not named here.",
      'Registered app IDs: 0.',
      "This project's (today.*): 0.",
    ]);
  });
});

describe('writeKey', () => {
  const home = mkdtempSync(join(tmpdir(), 'asc-home-'));
  afterAll(() => rmSync(home, { recursive: true, force: true }));
  const mode = (path) => statSync(path).mode & 0o777;

  it('writes AuthKey_<ID>.p8 as the PEM, mode 600, in a folder only its owner can open', () => {
    const pasted = { ...CREDS, p8: Buffer.from(PEM).toString('base64') };
    const path = writeKey(pasted, home);
    expect(path).toBe(join(home, '.appstoreconnect', 'private_keys', 'AuthKey_ABC123DEFG.p8'));
    expect(keyFolder(home)).toBe(join(home, '.appstoreconnect', 'private_keys'));
    expect(readFileSync(path, 'utf8')).toBe(PEM);
    expect(mode(path)).toBe(0o600);
    expect(mode(keyFolder(home))).toBe(0o700);
  });

  it('makes an existing file mode 600 too', () => {
    const path = join(keyFolder(home), 'AuthKey_ABC123DEFG.p8');
    writeFileSync(path, 'old', { mode: 0o644 });
    writeKey(CREDS, home);
    expect(readFileSync(path, 'utf8')).toBe(PEM);
    expect(mode(path)).toBe(0o600);
  });

  it('refuses a key ID that is not one, so the file name is always AuthKey_<ID>.p8', () => {
    for (const keyId of ['../../etc/x', 'abc123defg', 'ABC123', '']) {
      expect(() => writeKey({ ...CREDS, keyId }, home)).toThrow(/ASC_KEY_ID is not a key ID/);
    }
  });

  it("refuses a value with the key's shape that isn't a usable key, without repeating it", () => {
    const shaped =
      '-----BEGIN PRIVATE KEY-----\nTm90IGEga2V5IGF0IGFsbA==\n-----END PRIVATE KEY-----';
    let message = '';
    try {
      writeKey({ ...CREDS, p8: shaped }, home);
    } catch (err) {
      message = err.message;
    }
    expect(message).toBe(
      "ASC_KEY_P8 looks like a .p8 key but isn't a usable one: paste the file again.",
    );
    expect(message).not.toContain('Tm90');
  });

  it("writes fastlane's key file: the IDs and the PEM, mode 600", () => {
    const path = join(home, 'fastlane.json');
    writeFastlaneKey(
      { ...CREDS, p8: `-----BEGIN PRIVATE KEY----- ${BODY} -----END PRIVATE KEY-----` },
      path,
    );
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      key_id: 'ABC123DEFG',
      issuer_id: CREDS.issuerId,
      key: PEM,
      in_house: false,
    });
    expect(mode(path)).toBe(0o600);
  });

  it('is what asc-key.mjs runs, saying nothing of the key', () => {
    const script = new URL('../asc-key.mjs', import.meta.url).pathname;
    const otherHome = join(home, 'other');
    mkdirSync(otherHome);
    const env = {
      ...process.env,
      HOME: otherHome,
      ASC_KEY_ID: CREDS.keyId,
      ASC_ISSUER_ID: CREDS.issuerId,
      ASC_KEY_P8: PEM,
    };
    const out = execFileSync('node', [script], { env, encoding: 'utf8' });
    expect(out).toBe(
      'Wrote the App Store Connect key to ~/.appstoreconnect/private_keys (mode 600).\n',
    );
    expect(readFileSync(join(keyFolder(otherHome), 'AuthKey_ABC123DEFG.p8'), 'utf8')).toBe(PEM);
    const fastlane = join(otherHome, 'fastlane.json');
    execFileSync('node', [script, '--fastlane', fastlane], { env, encoding: 'utf8' });
    expect(JSON.parse(readFileSync(fastlane, 'utf8')).key).toBe(PEM);
    let failed;
    try {
      execFileSync('node', [script], { env: { ...env, ASC_KEY_P8: 'nonsense' }, stdio: 'pipe' });
    } catch (err) {
      failed = err;
    }
    expect(failed.status).toBe(1);
    expect(failed.stderr.toString()).toMatch(
      /^::error::asc-key\.mjs: ASC_KEY_P8 is not a \.p8 key/,
    );
    expect(failed.stderr.toString()).not.toContain('nonsense');
  });
});

describe('request', () => {
  it('sends JSON with a token, and returns the JSON answer', async () => {
    const asked = [];
    const fetchImpl = async (url, init) => {
      asked.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ data: { id: 'x' } }) };
    };
    const body = { data: { type: 'betaBuildLocalizations' } };
    expect(await request('POST', '/v1/betaBuildLocalizations', CREDS, body, fetchImpl)).toEqual({
      data: { id: 'x' },
    });
    expect(asked[0].url).toBe('https://api.appstoreconnect.apple.com/v1/betaBuildLocalizations');
    expect(asked[0].init.method).toBe('POST');
    expect(asked[0].init.headers['content-type']).toBe('application/json');
    expect(asked[0].init.headers.authorization).toMatch(/^Bearer /);
    expect(JSON.parse(asked[0].init.body)).toEqual(body);
  });

  it('returns null for an answer with no body, and sends none when given none', async () => {
    let sent;
    const fetchImpl = async (_url, init) => {
      sent = init.body;
      return { ok: true, status: 204, json: async () => ({}) };
    };
    expect(await request('DELETE', '/v1/x/1', CREDS, undefined, fetchImpl)).toBeNull();
    expect(sent).toBeUndefined();
  });

  it("fails with the status and Apple's reasons, or the status alone", async () => {
    const conflict = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ errors: [{ title: 'Conflict', detail: 'The build is processing.' }] }),
    });
    const err = await request('PATCH', '/v1/x/1', CREDS, {}, conflict).catch((e) => e);
    expect(err).toBeInstanceOf(AscError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('App Store Connect answered 409: Conflict: The build is processing.');
    const html = async () => ({ ok: false, status: 502, json: async () => JSON.parse('<') });
    expect((await request('GET', '/v1/x', CREDS, undefined, html).catch((e) => e)).message).toBe(
      'App Store Connect answered 502',
    );
  });
});
