import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AscError, credentials, getAll, keyPem, report, token } from '../asc.mjs';

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
