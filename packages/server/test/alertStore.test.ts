import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ALERT_STORE_TIMEOUT_MS,
  AlertStoreError,
  DEVICE_APPS,
  MemoryAlertStore,
  REG_PREFIX,
  SafeAlertStore,
  blobsAlertStore,
  claimTestSend,
  createBlobsAlertStore,
  doneKey,
  donePrefix,
  forgetDevice,
  forgetIdsLeft,
  idPrefix,
  isOldRegKey,
  idsKey,
  jwtKey,
  keysOf,
  newSalt,
  oldRegKey,
  parseRegKey,
  placeId,
  redact,
  regKey,
  regZonePrefix,
  registrationId,
  sentKey,
  sentPrefix,
  testKey,
  withOldForms,
  zoneOfDirectory,
  zoneSegment,
  type AlertStore,
  type BlobsStoreLike,
  type DeviceIdsEntry,
} from '../src';

const TOKEN = 'ab'.repeat(32);
const ID = '815fd83640110117669cc8280c00f201';
/** A saved place's pid: 12 hex characters. */
const PID = '1a2b3c4d5e6f';
const NOW = Date.UTC(2026, 11, 1, 18, 5, 0);

describe('keys', () => {
  it('the id is the first 32 hex characters of sha256(app:token)', () => {
    expect(registrationId('snow', TOKEN)).toBe(ID);
    expect(registrationId('wind', TOKEN)).toBe('df91a5423cbba087351f1504e13a9720');
    expect(idPrefix(ID)).toBe('815fd836…');
  });

  it('builds every key in the storage table, each zone one path segment', () => {
    expect(regKey('Europe/London', 'snow', ID)).toBe(`reg/v1/Europe~London/snow.${ID}`);
    expect(regKey('America/Argentina/Buenos_Aires', 'snow', ID)).toBe(
      `reg/v1/America~Argentina~Buenos_Aires/snow.${ID}`,
    );
    expect(regZonePrefix('Asia/Kolkata')).toBe('reg/v1/Asia~Kolkata/');
    expect(regZonePrefix('UTC')).toBe('reg/v1/UTC/');
    expect(idsKey('snow', ID)).toBe(`ids/v1/snow.${ID}`);
    expect(sentKey('2026-12-01', 'snow', 'evening', 'snow', ID)).toBe(
      `sent/v1/2026-12-01/snow.evening/snow.${ID}`,
    );
    expect(sentPrefix('2026-12-01', 'snow', 'morning')).toBe('sent/v1/2026-12-01/snow.morning/');
    expect(doneKey('2026-12-01', 'evening', 'Europe/London')).toBe(
      'done/v1/2026-12-01/evening/Europe~London',
    );
    expect(donePrefix('2026-12-01')).toBe('done/v1/2026-12-01/');
    expect(jwtKey('production')).toBe('apns/v1/jwt/production');
    expect(testKey(ID, NOW, 2)).toBe(`test/v1/${ID}/2026-12-01T18.2`);
  });

  it('reads a registration key and a zone directory back', () => {
    expect(parseRegKey(regKey('America/Argentina/Buenos_Aires', 'snow', ID))).toEqual({
      tz: 'America/Argentina/Buenos_Aires',
      app: 'snow',
      id: ID,
    });
    expect(parseRegKey(`ids/v1/snow.${ID}`)).toBeNull();
    expect(parseRegKey(`reg/v1/%E0%A4%A/snow.${ID}`)).toBeNull();
    expect(zoneOfDirectory('reg/v1/Europe~London')).toBe('Europe/London');
    expect(zoneOfDirectory('reg/v1/Europe~London/')).toBe('Europe/London');
    expect(zoneOfDirectory('reg/v1/UTC')).toBe('UTC');
    expect(zoneOfDirectory('reg/v1/%E0%A4%A')).toBeNull();
    expect(zoneOfDirectory('sent/v1/2026-12-01')).toBeNull();
  });

  it('writes a zone in characters no URL changes, and reads every zone back', () => {
    expect(zoneSegment('Etc/GMT+5')).toBe('Etc~GMT.2B5');
    expect(zoneSegment('+05:30')).toBe('.2B05.3A30');
    expect(zoneSegment('a.b~c%d')).toBe('a.2Eb.7Ec.25d');
    expect(zoneSegment('Zürich')).toBe('Z.C3.BCrich');
    for (const tz of [...Intl.supportedValuesOf('timeZone'), 'Etc/GMT+5', '+05:30', 'UTC']) {
      expect(zoneSegment(tz), tz).toMatch(/^[A-Za-z0-9_.~-]+$/);
      expect(encodeURIComponent(zoneSegment(tz)), tz).toBe(zoneSegment(tz));
      expect(zoneOfDirectory(regZonePrefix(tz)), tz).toBe(tz);
      expect(parseRegKey(regKey(tz, 'snow', ID, PID))?.tz, tz).toBe(tz);
    }
    expect(parseRegKey(`reg/v1/Z.C3.BCrich/snow.${ID}`)?.tz).toBe('Zürich');
  });

  it('reads the keys from before, as an ids entry holds them and as Netlify lists them', () => {
    const old: Record<string, { tz: string; pid?: string }> = {
      // As an ids entry's `saved` holds them, and as Netlify's local server lists them.
      [`reg/v1/Europe%2FLondon/snow.${ID}.${PID}`]: { tz: 'Europe/London', pid: PID },
      [`reg/v1/Etc%2FGMT%2B5/snow.${ID}`]: { tz: 'Etc/GMT+5' },
      // As Netlify's service keeps and lists them: the zone decoded, one segment a part.
      [`reg/v1/Europe/London/snow.${ID}`]: { tz: 'Europe/London' },
      [`reg/v1/America/Argentina/Buenos_Aires/snow.${ID}.${PID}`]: {
        tz: 'America/Argentina/Buenos_Aires',
        pid: PID,
      },
      [`reg/v1/Etc/GMT+5/snow.${ID}`]: { tz: 'Etc/GMT+5' },
      [`reg/v1/+05:30/snow.${ID}`]: { tz: '+05:30' },
    };
    for (const [key, { tz, pid }] of Object.entries(old)) {
      expect(parseRegKey(key), key).toEqual({ tz, app: 'snow', id: ID, ...(pid ? { pid } : {}) });
      expect(isOldRegKey(key), key).toBe(true);
    }
    expect(isOldRegKey(regKey('Europe/London', 'snow', ID, PID))).toBe(false);
    expect(isOldRegKey(regKey('UTC', 'snow', ID))).toBe(false);
    expect(isOldRegKey(`reg/v1/UTC/snow.${ID}`)).toBe(false);
    expect(isOldRegKey(`ids/v1/snow.${ID}`)).toBe(false);
    expect(parseRegKey(`reg/v1/Europe//snow.${ID}`)).toBeNull();
    expect(parseRegKey(`reg/v1//London/snow.${ID}`)).toBeNull();
    // A directory of the keys from before is no zone, so never read as one: an unknown zone's
    // windows would be UTC's.
    expect(zoneOfDirectory('reg/v1/Europe')).toBeNull();
    expect(zoneOfDirectory('reg/v1/America')).toBeNull();
    expect(zoneOfDirectory('reg/v1/Europe%2FLondon')).toBeNull();
    expect(zoneOfDirectory('reg/v1/Nowhere~Special')).toBeNull();
  });

  it("builds a saved place's key, its pid after the id, and reads it back", () => {
    expect(regKey('Europe/London', 'snow', ID, PID)).toBe(`reg/v1/Europe~London/snow.${ID}.${PID}`);
    expect(regKey('Europe/London', 'snow', ID, undefined)).toBe(
      regKey('Europe/London', 'snow', ID),
    );
    expect(parseRegKey(regKey('America/Argentina/Buenos_Aires', 'snow', ID, PID))).toEqual({
      tz: 'America/Argentina/Buenos_Aires',
      app: 'snow',
      id: ID,
      pid: PID,
    });
    // The free place's key reads as it always has, with no pid at all.
    expect(Object.keys(parseRegKey(regKey('Europe/London', 'snow', ID))!)).toEqual([
      'tz',
      'app',
      'id',
    ]);
  });

  it('refuses a key whose id is not 32 hex characters or whose pid is not 12', () => {
    const london = 'reg/v1/Europe~London/snow.';
    for (const tail of [
      `${ID}.${PID}0`,
      `${ID}.${PID.slice(0, 8)}`,
      `${ID}.${PID.toUpperCase()}`,
      `${ID}.`,
      `${ID}.${PID}.${PID}`,
      `${ID}x`,
      ID.slice(1),
      `${ID}0`,
      `${ID.slice(1)}.${PID}`,
      ID.toUpperCase(),
    ]) {
      expect(parseRegKey(`${london}${tail}`), tail).toBeNull();
    }
    expect(parseRegKey(`${london}${ID}`)).not.toBeNull();
  });

  it("keeps the longest zone's saved key, for any app, inside Blobs' 600 bytes", async () => {
    const zones = Intl.supportedValuesOf('timeZone');
    expect(zones.length).toBeGreaterThan(300);
    const keys = zones.flatMap((tz) =>
      DEVICE_APPS.map((app) => regKey(tz, app, 'f'.repeat(32), 'f'.repeat(12))),
    );
    const longest = keys.reduce((a, b) => (Buffer.byteLength(b) > Buffer.byteLength(a) ? b : a));
    expect(Buffer.byteLength(longest)).toBeLessThan(600);
    expect(await new MemoryAlertStore().set(longest, {})).toBe(true);
    expect(parseRegKey(longest)).not.toBeNull();
  });

  it('redacts ids, device tokens and provider tokens for the log', () => {
    expect(redact(`reg/v1/Europe~London/snow.${ID}`)).toBe('reg/v1/Europe~London/snow.815fd836…');
    expect(redact(`device ${TOKEN}`)).toBe('device abababab…');
    expect(redact('token eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJUIn0.c2ln here')).toBe('token <jwt> here');
  });
});

describe('MemoryAlertStore', () => {
  it('keeps JSON values, each read a fresh copy', async () => {
    const store = new MemoryAlertStore();
    const value = { tz: 'Europe/London', when: new Date(NOW), list: [1] };
    expect(await store.set('ids/v1/snow.x', value)).toBe(true);
    value.list.push(2);
    const read = await store.get<{ tz: string; when: string; list: number[] }>('ids/v1/snow.x');
    expect(read).toEqual({ tz: 'Europe/London', when: '2026-12-01T18:05:00.000Z', list: [1] });
    read!.list.push(3);
    expect(await store.get('ids/v1/snow.x')).toEqual({
      tz: 'Europe/London',
      when: '2026-12-01T18:05:00.000Z',
      list: [1],
    });
    expect(await store.get('ids/v1/missing')).toBeNull();
    await expect(store.set('k', undefined)).rejects.toThrow(TypeError);
  });

  it('checks keys as Blobs does', async () => {
    const store = new MemoryAlertStore();
    await expect(store.set('', {})).rejects.toThrow(/empty/);
    await expect(store.set('/reg', {})).rejects.toThrow(/forward slash/);
    await expect(store.set('%2Freg', {})).rejects.toThrow(/forward slash/);
    await expect(store.set('k'.repeat(601), {})).rejects.toThrow(/600 bytes/);
  });

  it('writes with onlyIfNew only when the key is absent', async () => {
    const store = new MemoryAlertStore();
    expect(await store.set('sent/a', { at: 1 }, { onlyIfNew: true })).toBe(true);
    expect(await store.set('sent/a', { at: 2 }, { onlyIfNew: true })).toBe(false);
    expect(await store.get('sent/a')).toEqual({ at: 1 });
    expect(await store.set('sent/a', { at: 3 })).toBe(true);
    expect(await store.get('sent/a')).toEqual({ at: 3 });
  });

  it('lets one of two racing claims win, and only one', async () => {
    const store = new MemoryAlertStore();
    const claims = await Promise.all(
      ['first', 'second'].map((who) => store.set('sent/v1/x', { who }, { onlyIfNew: true })),
    );
    expect(claims).toEqual([true, false]);
    expect(await store.get('sent/v1/x')).toEqual({ who: 'first' });

    const safe = new SafeAlertStore(store);
    const many = await Promise.all(
      Array.from({ length: 10 }, (_, i) => safe.set('sent/v1/y', { i }, { onlyIfNew: true })),
    );
    expect(many.filter(Boolean)).toHaveLength(1);
  });

  it('lists by prefix, sorted, and directories at any depth', async () => {
    const store = new MemoryAlertStore();
    const keys = [
      regKey('Europe/London', 'snow', 'b1'),
      regKey('Europe/London', 'snow', 'a1'),
      regKey('Asia/Kolkata', 'snow', 'c1'),
      regKey('America/Argentina/Buenos_Aires', 'snow', 'd1'),
      idsKey('snow', 'a1'),
      'reg/v1/stray',
    ];
    for (const key of keys) await store.set(key, {});

    expect(await store.list('reg/v1/', { directories: true })).toEqual({
      keys: ['reg/v1/stray'],
      directories: [
        'reg/v1/America~Argentina~Buenos_Aires',
        'reg/v1/Asia~Kolkata',
        'reg/v1/Europe~London',
      ],
    });
    expect(await store.list(regZonePrefix('Europe/London'), { directories: true })).toEqual({
      keys: ['reg/v1/Europe~London/snow.a1', 'reg/v1/Europe~London/snow.b1'],
      directories: [],
    });
    // The top level, and a prefix that stops inside a segment.
    expect(await store.list('', { directories: true })).toEqual({
      keys: [],
      directories: ['ids', 'reg'],
    });
    expect((await store.list('reg/v1/E', { directories: true })).directories).toEqual([
      'reg/v1/Europe~London',
    ]);
    expect((await store.list('reg/v1', { directories: true })).directories).toEqual(['reg/v1']);
    // Without directories: every key under the prefix.
    expect((await store.list('reg/v1/')).keys).toHaveLength(5);
    expect(await store.list('done/')).toEqual({ keys: [], directories: [] });
    expect(store.keys()).toEqual([...keys].sort());
  });

  it("decodes a key's path as Netlify's service does, but not a listing's prefix", async () => {
    // The keys before decision "Zone keys Netlify can't split": three segments, not two.
    const store = new MemoryAlertStore();
    await store.set(`reg/v1/Europe%2FLondon/snow.${ID}`, { at: 1 });
    expect(store.keys()).toEqual([`reg/v1/Europe/London/snow.${ID}`]);
    expect(await store.get(`reg/v1/Europe%2FLondon/snow.${ID}`)).toEqual({ at: 1 });
    expect(await store.get(`reg/v1/Europe/London/snow.${ID}`)).toEqual({ at: 1 });
    expect(await store.list('reg/v1/', { directories: true })).toEqual({
      keys: [],
      directories: ['reg/v1/Europe'],
    });
    expect(await store.list('reg/v1/Europe%2FLondon/')).toEqual({ keys: [], directories: [] });
    expect(await store.set(`reg/v1/Europe/London/snow.${ID}`, { at: 2 }, { onlyIfNew: true })).toBe(
      false,
    );
    await store.delete(`reg/v1/Europe%2FLondon/snow.${ID}`);
    expect(store.keys()).toEqual([]);
    // Today's keys hold no escape, so they are kept as they are written.
    await store.set(regKey('Etc/GMT+5', 'snow', ID, PID), {});
    expect(store.keys()).toEqual([regKey('Etc/GMT+5', 'snow', ID, PID)]);
    await expect(store.set('reg/v1/%E0%A4%A/x', {})).rejects.toThrow(/valid path/);
  });

  it('deletes, and deleting what is absent is fine', async () => {
    const store = new MemoryAlertStore();
    await store.set('a', 1);
    await store.delete('a');
    await store.delete('a');
    expect(await store.get('a')).toBeNull();
    expect(store.keys()).toEqual([]);
  });
});

/** A store whose every call waits for `release` (never, by default). */
function stalled(release: Promise<never> = new Promise<never>(() => {})): AlertStore {
  return {
    get: () => release,
    set: () => release,
    list: () => release,
    delete: () => release,
  };
}

describe('SafeAlertStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes answers through', async () => {
    const inner = new MemoryAlertStore();
    const safe = new SafeAlertStore(inner);
    expect(await safe.set('a/b', { x: 1 })).toBe(true);
    expect(await safe.set('a/b', { x: 2 }, { onlyIfNew: true })).toBe(false);
    expect(await safe.get('a/b')).toEqual({ x: 1 });
    expect(await safe.list('a/', { directories: true })).toEqual({
      keys: ['a/b'],
      directories: [],
    });
    await safe.delete('a/b');
    expect(await safe.get('a/b')).toBeNull();
  });

  it('gives every call 1.5 s, then rejects: never a guess', async () => {
    vi.useFakeTimers();
    expect(ALERT_STORE_TIMEOUT_MS).toBe(1500);
    const errors: AlertStoreError[] = [];
    const safe = new SafeAlertStore(stalled(), (err) => errors.push(err));
    const calls = [
      safe.get('reg/v1/x'),
      safe.set('sent/v1/x', {}, { onlyIfNew: true }),
      safe.list('reg/v1/', { directories: true }),
      safe.delete('sent/v1/x'),
    ];
    const settled = calls.map((call) => {
      const state = { done: false };
      call.then(
        () => (state.done = true),
        () => (state.done = true),
      );
      return state;
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(settled.map((s) => s.done)).toEqual([false, false, false, false]);
    await vi.advanceTimersByTimeAsync(1);
    for (const call of calls) await expect(call).rejects.toThrow(AlertStoreError);
    // A claim that timed out is not a claim; a read that timed out is not "absent".
    await expect(calls[0]).rejects.toThrow('alert store: get reg/v1/x: timed out after 1500 ms');
    await expect(calls[1]).rejects.toThrow(/^alert store: set sent\/v1\/x: timed out/);
    expect(errors.map((e) => e.op)).toEqual(['get', 'set', 'list', 'delete']);
  });

  it('reports a failure once, redacted, and rejects with it', async () => {
    const errors: string[] = [];
    const failing: AlertStore = {
      get: async () => {
        throw new Error(`Netlify Blobs has generated an internal error for ${TOKEN}`);
      },
      set: async () => {
        throw new Error('503 status code');
      },
      list: () => Promise.reject('not an Error'),
      delete: async () => {},
    };
    const safe = new SafeAlertStore(failing, (err) => errors.push(err.message), 50);
    const key = regKey('Europe/London', 'snow', ID);
    await expect(safe.get(key)).rejects.toThrow(AlertStoreError);
    await expect(
      safe.set(sentKey('2026-12-01', 'snow', 'evening', 'snow', ID), {}),
    ).rejects.toThrow(
      'alert store: set sent/v1/2026-12-01/snow.evening/snow.815fd836…: 503 status code',
    );
    await expect(safe.list('')).rejects.toThrow('alert store: list (all): not an Error');
    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe(
      'alert store: get reg/v1/Europe~London/snow.815fd836…: Netlify Blobs has generated an internal error for abababab…',
    );
    for (const line of errors) {
      expect(line).not.toContain(ID);
      expect(line).not.toContain(TOKEN);
    }
  });

  it('leaves no unhandled rejection when a call fails after its timeout', async () => {
    const late = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('too late')), 30),
    );
    // No onError: the default ignores it.
    const safe = new SafeAlertStore(stalled(late), undefined, 5);
    await expect(safe.get('k')).rejects.toThrow(/timed out after 5 ms/);
    // Vitest fails the run on an unhandled rejection; wait past the late one.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});

describe('blobsAlertStore', () => {
  /** A Blobs store stand-in that answers a conditional write as asked. */
  function fakeBlobs(write: { modified: boolean; etag?: string }, stored: unknown): BlobsStoreLike {
    return {
      get: vi.fn(async () => stored),
      setJSON: vi.fn(async () => write),
      list: vi.fn(async () => ({ blobs: [{ key: 'a/b', etag: '"1"' }], directories: ['a/c/'] })),
      delete: vi.fn(async () => {}),
    } as unknown as BlobsStoreLike;
  }

  it('believes a conditional write only with an etag, or when its value reads back', async () => {
    expect(
      await blobsAlertStore(fakeBlobs({ modified: true, etag: '"e"' }, null)).set('k', 1, {
        onlyIfNew: true,
      }),
    ).toBe(true);
    expect(
      await blobsAlertStore(fakeBlobs({ modified: false }, 1)).set('k', 1, { onlyIfNew: true }),
    ).toBe(false);
    // Blobs says "modified" with no etag for an error answer: read back.
    const ours = { at: 'now', apnsId: 'mine' };
    expect(
      await blobsAlertStore(fakeBlobs({ modified: true }, { ...ours })).set('k', ours, {
        onlyIfNew: true,
      }),
    ).toBe(true);
    expect(
      await blobsAlertStore(fakeBlobs({ modified: true }, { at: 'now', apnsId: 'theirs' })).set(
        'k',
        ours,
        { onlyIfNew: true },
      ),
    ).toBe(false);
    await expect(
      blobsAlertStore(fakeBlobs({ modified: true }, null)).set('k', ours, { onlyIfNew: true }),
    ).rejects.toThrow('the write was not confirmed');
  });

  it('writes plainly, lists without trailing slashes, reads absent as null and deletes', async () => {
    const blobs = fakeBlobs({ modified: true, etag: '"e"' }, undefined);
    const store = blobsAlertStore(blobs);
    expect(await store.set('k', { v: 1 })).toBe(true);
    expect(blobs.setJSON).toHaveBeenCalledWith('k', { v: 1 });
    expect(await store.list('a/', { directories: true })).toEqual({
      keys: ['a/b'],
      directories: ['a/c'],
    });
    expect(blobs.list).toHaveBeenCalledWith({ prefix: 'a/', directories: true });
    expect(await store.get('k')).toBeNull();
    expect(blobs.get).toHaveBeenCalledWith('k', { type: 'json' });
    await store.delete('k');
    expect(blobs.delete).toHaveBeenCalledWith('k');
  });
});

describe("createBlobsAlertStore, against Netlify's local Blobs server", () => {
  let server: BlobsServer;
  let origin: string;
  let directory: string;
  const requests: string[] = [];
  const context = (over: Record<string, string> = {}) =>
    setEnvironmentContext({
      siteID: 'site1',
      token: 'local-test-token',
      deployID: 'deploy1',
      primaryRegion: 'us-east-2',
      edgeURL: origin,
      uncachedEdgeURL: origin,
      ...over,
    });

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'alerts-blobs-'));
    server = new BlobsServer({
      directory,
      token: 'local-test-token',
      onRequest: ({ url }) => requests.push(url),
    });
    origin = `http://localhost:${(await server.start()).port}`;
  });

  afterAll(async () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  });

  afterEach(() => {
    requests.length = 0;
  });

  it('uses the site-wide store in production and a deploy store elsewhere', async () => {
    context();
    await createBlobsAlertStore(true).set('ids/v1/snow.p', { tz: 'Europe/London' });
    expect(requests).toEqual([
      expect.stringMatching(/^\/site1\/site:isithot-alerts\/ids\/v1\/snow\.p/),
    ]);
    requests.length = 0;
    const preview = createBlobsAlertStore(false);
    await preview.set('ids/v1/snow.q', { tz: 'Asia/Kolkata' });
    expect(requests).toEqual([
      expect.stringMatching(
        /^\/region:us-east-2\/site1\/deploy:deploy1:isithot-alerts\/ids\/v1\/snow\.q/,
      ),
    ]);
    // The two never see each other's keys.
    expect(await preview.get('ids/v1/snow.p')).toBeNull();
    expect(await createBlobsAlertStore(true).get('ids/v1/snow.q')).toBeNull();
    expect(await preview.get('ids/v1/snow.q')).toEqual({ tz: 'Asia/Kolkata' });
  });

  it('sends every call to the uncached edge (strong consistency)', async () => {
    // A dead cached edge: any call that went there would fail.
    context({ edgeURL: 'http://127.0.0.1:9' });
    const store = createBlobsAlertStore(false, { timeoutMs: 1000 });
    const key = regKey('Europe/London', 'snow', ID);
    expect(await store.set(key, { id: ID })).toBe(true);
    expect(await store.get(key)).toEqual({ id: ID });
    expect((await store.list(REG_PREFIX, { directories: true })).directories).toContain(
      'reg/v1/Europe~London',
    );
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    // Without an uncached edge, a strong call refuses rather than read a cached copy.
    context({ uncachedEdgeURL: '' });
    const errors: string[] = [];
    const cachedOnly = createBlobsAlertStore(false, { onError: (e) => errors.push(e.message) });
    await expect(cachedOnly.get(key)).rejects.toThrow(/strong consistency/);
    expect(errors).toHaveLength(1);
  });

  it('keeps Blobs semantics: onlyIfNew, a zone as one directory, prefixes, deletes', async () => {
    context({ deployID: 'deploy2' });
    const store = createBlobsAlertStore(false);
    const claim = sentKey('2026-12-01', 'snow', 'evening', 'snow', ID);
    expect(await store.set(claim, { at: 'one' }, { onlyIfNew: true })).toBe(true);
    expect(await store.set(claim, { at: 'two' }, { onlyIfNew: true })).toBe(false);
    expect(await store.get(claim)).toEqual({ at: 'one' });

    // Ids as registrationId makes them (parseRegKey reads no other kind).
    const [a1, b1, b2] = ['a1', 'b1', 'b2'].map((t) => registrationId('snow', t.repeat(32)));
    await store.set(regKey('America/Argentina/Buenos_Aires', 'snow', a1!), {});
    await store.set(regKey('Asia/Kolkata', 'snow', b1!), {});
    await store.set(regKey('Asia/Kolkata', 'snow', b2!), {});
    const zones = await store.list(REG_PREFIX, { directories: true });
    expect(zones.keys).toEqual([]);
    expect(zones.directories.sort()).toEqual([
      'reg/v1/America~Argentina~Buenos_Aires',
      'reg/v1/Asia~Kolkata',
    ]);
    expect(zones.directories.map(zoneOfDirectory)).toEqual([
      'America/Argentina/Buenos_Aires',
      'Asia/Kolkata',
    ]);
    const kolkata = await store.list(regZonePrefix('Asia/Kolkata'));
    expect(kolkata.keys.sort()).toEqual(
      [`reg/v1/Asia~Kolkata/snow.${b1}`, `reg/v1/Asia~Kolkata/snow.${b2}`].sort(),
    );
    expect(kolkata.keys.map((key) => parseRegKey(key)?.tz)).toEqual([
      'Asia/Kolkata',
      'Asia/Kolkata',
    ]);
    await store.delete(regKey('Asia/Kolkata', 'snow', b1!));
    await store.delete(regKey('Asia/Kolkata', 'snow', b1!));
    expect((await store.list(regZonePrefix('Asia/Kolkata'))).keys).toEqual([
      `reg/v1/Asia~Kolkata/snow.${b2}`,
    ]);
  });

  it('throws at once with no Blobs environment, rather than fall back to memory', () => {
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    expect(() => createBlobsAlertStore(true)).toThrow(/not been configured to use Netlify Blobs/);
    expect(() => createBlobsAlertStore(false)).toThrow(/not been configured to use Netlify Blobs/);
  });
});

describe('claimTestSend', () => {
  it('allows perHour sends an hour per id, each claiming its own slot', async () => {
    const store = new MemoryAlertStore();
    const claims = [];
    for (let i = 0; i < 4; i++) claims.push(await claimTestSend(store, ID, NOW, 3));
    expect(claims).toEqual([true, true, true, false]);
    expect(store.keys()).toEqual([1, 2, 3].map((slot) => testKey(ID, NOW, slot)));
    // The next hour, and another id, start again.
    expect(await claimTestSend(store, ID, NOW + 60 * 60 * 1000, 3)).toBe(true);
    expect(await claimTestSend(store, 'other', NOW, 3)).toBe(true);
  });

  it('rejects when the store fails, so nothing is sent', async () => {
    const safe = new SafeAlertStore(stalled(), () => {}, 5);
    await expect(claimTestSend(safe, ID, NOW, 3)).rejects.toThrow(AlertStoreError);
  });
});

describe('placeId and newSalt', () => {
  const SALT = '00112233445566778899aabbccddeeff';

  it('makes a new salt of 16 random bytes, as hex, each time', () => {
    const salts = Array.from({ length: 20 }, () => newSalt());
    for (const salt of salts) expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(salts).size).toBe(20);
  });

  it('is the first 12 hex of HMAC-SHA256(salt, query): stable for one salt, another for another', () => {
    // Worked out apart from this code (Python's hmac), so the derivation cannot drift.
    expect(placeId(SALT, 'place=durham-gb')).toBe('883bf8d96e0f');
    expect(placeId(SALT, 'lat=27.7&lon=85.3&source=search')).toBe('d8f3500a2355');
    expect(placeId('ffeeddccbbaa99887766554433221100', 'place=durham-gb')).toBe('e44664db5684');
    expect(placeId(SALT, 'place=durham-gb')).toBe(placeId(SALT, 'place=durham-gb'));
    const salt = newSalt();
    expect(placeId(salt, 'place=durham-gb')).not.toBe(placeId(newSalt(), 'place=durham-gb'));
    expect(placeId(salt, 'place=durham-gb')).not.toBe(placeId(salt, 'place=leeds-gb'));
  });

  it("makes a pid a saved place's key carries and gives back", () => {
    const pid = placeId(newSalt(), 'place=durham-gb');
    expect(pid).toMatch(/^[0-9a-f]{12}$/);
    expect(parseRegKey(regKey('Europe/London', 'snow', ID, pid))?.pid).toBe(pid);
    // A log keeps a pid whole (it is under 32 hex) and still cuts the id short.
    expect(redact(regKey('Europe/London', 'snow', ID, pid))).toBe(
      `reg/v1/Europe~London/snow.815fd836….${pid}`,
    );
  });
});

describe('keysOf', () => {
  const OTHER = registrationId('snow', 'cd'.repeat(32));
  const london = regKey('Europe/London', 'snow', ID);
  const durham = regKey('Europe/London', 'snow', ID, PID);
  const kathmandu = regKey('Asia/Kathmandu', 'snow', ID, '6f5e4d3c2b1a');

  it("names a v1 entry's zone, and the zones it is leaving, as keys", () => {
    expect(keysOf({ tz: 'Europe/London' } satisfies DeviceIdsEntry, 'snow', ID)).toEqual([london]);
    expect(
      keysOf({ tz: 'Europe/London', from: ['Asia/Kolkata'] } satisfies DeviceIdsEntry, 'snow', ID),
    ).toEqual([london, regKey('Asia/Kolkata', 'snow', ID)]);
  });

  it("names a v2 entry's free record, then its saved and leaving keys, each once", () => {
    const entry: DeviceIdsEntry = {
      v: 2,
      tz: 'Europe/London',
      from: ['Asia/Kolkata'],
      saved: [durham, kathmandu],
      leaving: [kathmandu, regKey('America/Denver', 'snow', ID, 'aaaaaaaaaaaa')],
      salt: newSalt(),
      updatedAt: '2026-11-20T19:02:11.000Z',
    };
    expect(keysOf(entry, 'snow', ID)).toEqual([
      london,
      regKey('Asia/Kolkata', 'snow', ID),
      durham,
      kathmandu,
      regKey('America/Denver', 'snow', ID, 'aaaaaaaaaaaa'),
    ]);
    // No free place: only the saved ones.
    expect(keysOf({ v: 2, saved: [durham], salt: newSalt() }, 'snow', ID)).toEqual([durham]);
  });

  it("names only this device's registration keys, and nothing for anything malformed", () => {
    expect(
      keysOf(
        {
          v: 2,
          saved: [
            durham,
            regKey('Europe/London', 'snow', OTHER, PID),
            regKey('Europe/London', 'wind', ID, PID),
            idsKey('snow', ID),
            7,
          ],
          leaving: 'not a list',
          salt: newSalt(),
        },
        'snow',
        ID,
      ),
    ).toEqual([durham]);
    for (const entry of [null, undefined, 'Europe/London', 7, [], { tz: 7 }, { saved: {} }]) {
      expect(keysOf(entry, 'snow', ID)).toEqual([]);
    }
    expect(keysOf({ tz: 'Europe/London', from: [7, 'Asia/Kolkata'] }, 'snow', ID)).toEqual([
      london,
      regKey('Asia/Kolkata', 'snow', ID),
    ]);
  });

  it('names a key an entry holds in the form from before as regKey writes it now', () => {
    const entry: DeviceIdsEntry = {
      v: 2,
      tz: 'Europe/London',
      saved: [`reg/v1/Europe%2FLondon/snow.${ID}.${PID}`, durham],
      leaving: [`reg/v1/Asia%2FKathmandu/snow.${ID}.6f5e4d3c2b1a`],
      salt: newSalt(),
    };
    expect(keysOf(entry, 'snow', ID)).toEqual([london, durham, kathmandu]);
  });
});

describe('forgetDevice', () => {
  /** The stamp every record of one registration shares. */
  const STAMP = { updatedAt: '2026-08-20T19:02:11.000Z', seenAt: '2026-08-28T08:00:00.000Z' };
  /** A later registration's. */
  const LATER = { updatedAt: '2026-12-01T18:04:00.000Z', seenAt: '2026-12-01T18:04:00.000Z' };
  const here = { tz: 'Europe/London', ...STAMP };
  const durham = { tz: 'Europe/London', slot: PID, ...STAMP };
  const kathmandu = { tz: 'Asia/Kathmandu', slot: '6f5e4d3c2b1a', ...STAMP };
  type Slot = { tz: string; slot?: string; updatedAt: string; seenAt?: string };
  const keyOf = (s: Slot, id = ID): string => regKey(s.tz, 'snow', id, s.slot);
  const record = (s: Slot, id = ID) => ({ v: 1, id, app: 'snow', ...s });
  const entry = (slots: Slot[], salt = '00112233445566778899aabbccddeeff'): DeviceIdsEntry => ({
    v: 2,
    tz: 'Europe/London',
    saved: slots.filter((s) => s.slot).map((s) => keyOf(s)),
    salt,
    updatedAt: STAMP.updatedAt,
  });
  /** A set of three places (free, Durham, Kathmandu), all from one registration. */
  async function seedSet(store: AlertStore): Promise<void> {
    for (const s of [here, durham, kathmandu]) await store.set(keyOf(s), record(s));
    await store.set(idsKey('snow', ID), entry([here, durham, kathmandu]));
  }

  it('deletes a set: every record its ids entry names, then the entry and its salt', async () => {
    for (const trigger of [here, durham, kathmandu]) {
      const store = new MemoryAlertStore();
      await seedSet(store);
      expect(await forgetDevice(store, 'snow', ID, trigger)).toBe('deleted');
      expect(store.keys()).toEqual([]);
      // Already gone counts as deleted.
      expect(await forgetDevice(store, 'snow', ID, trigger)).toBe('deleted');
    }
  });

  it('deletes a v1 entry and its one record (an 8.1 registration)', async () => {
    const store = new MemoryAlertStore();
    await store.set(keyOf(here), record(here));
    await store.set(idsKey('snow', ID), { tz: 'Europe/London' } satisfies DeviceIdsEntry);
    expect(await forgetDevice(store, 'snow', ID, here)).toBe('deleted');
    expect(store.keys()).toEqual([]);
  });

  it('keeps every record when the one that set it off was written or refreshed since', async () => {
    for (const since of [
      { updatedAt: LATER.updatedAt },
      { seenAt: LATER.seenAt },
      { updatedAt: LATER.updatedAt, seenAt: LATER.seenAt },
    ]) {
      const store = new MemoryAlertStore();
      await seedSet(store);
      await store.set(keyOf(durham), record({ ...durham, ...since }));
      const before = store.keys();
      expect(await forgetDevice(store, 'snow', ID, durham)).toBe('changed');
      expect(store.keys()).toEqual(before);
    }
  });

  it('deletes a stale orphan saved record alone, by its own stamp', async () => {
    // No ids entry at all (two PUTs of one token overlapping, or a DELETE under a rollback).
    const alone = new MemoryAlertStore();
    await alone.set(keyOf(durham), record(durham));
    expect(await forgetDevice(alone, 'snow', ID, durham)).toBe('deleted');
    expect(alone.keys()).toEqual([]);

    // An entry that doesn't name it, for records written since: they and the entry stay.
    const store = new MemoryAlertStore();
    const fresh = [here, kathmandu].map((s) => ({ ...s, ...LATER }));
    for (const s of fresh) await store.set(keyOf(s), record(s));
    await store.set(idsKey('snow', ID), entry(fresh));
    await store.set(keyOf(durham), record(durham));
    expect(await forgetDevice(store, 'snow', ID, durham)).toBe('deleted');
    expect(store.keys()).toEqual([idsKey('snow', ID), keyOf(kathmandu), keyOf(here)].sort());
  });

  it("still loses a v2 entry's saved records at 90 days once main's code rewrote it as { tz }", async () => {
    // Rolled back: main's PUT re-stamped the free record and wrote { tz }, naming it alone.
    const store = new MemoryAlertStore();
    await store.set(keyOf(here), record({ ...here, ...LATER }));
    await store.set(idsKey('snow', ID), { tz: 'Europe/London' } satisfies DeviceIdsEntry);
    for (const s of [durham, kathmandu]) await store.set(keyOf(s), record(s));
    // Rolled forward, each orphan goes when the run finds it stale, and only it.
    expect(await forgetDevice(store, 'snow', ID, durham)).toBe('deleted');
    expect(store.keys()).toEqual([idsKey('snow', ID), keyOf(kathmandu), keyOf(here)].sort());
    expect(await forgetDevice(store, 'snow', ID, kathmandu)).toBe('deleted');
    expect(store.keys()).toEqual([idsKey('snow', ID), keyOf(here)].sort());
  });

  it('keeps the new records of a PUT landing between the ids read and the deletes', async () => {
    const inner = new MemoryAlertStore();
    await seedSet(inner);
    let landed = false;
    // The PUT: every place re-stamped, then the entry naming them, as a v2 PUT writes them.
    const put = async () => {
      landed = true;
      for (const s of [here, durham, kathmandu])
        await inner.set(keyOf(s), record({ ...s, ...LATER }));
      await inner.set(idsKey('snow', ID), { ...entry([here, durham, kathmandu]), ...LATER });
    };
    const store: AlertStore = {
      get: async (key) => {
        const value = await inner.get(key);
        if (key === idsKey('snow', ID) && !landed) await put();
        return value as never;
      },
      set: (key, value, options) => inner.set(key, value, options),
      list: (prefix, options) => inner.list(prefix, options),
      delete: (key) => inner.delete(key),
    };
    expect(await forgetDevice(store, 'snow', ID, durham)).toBe('changed');
    expect(landed).toBe(true);
    expect(inner.keys()).toHaveLength(4);
    for (const s of [here, durham, kathmandu]) {
      expect(await inner.get(keyOf(s))).toMatchObject(LATER);
    }
  });

  it('keeps the other records of a PUT landing after the trigger went, and the entry it wrote', async () => {
    const inner = new MemoryAlertStore();
    await seedSet(inner);
    let landed = false;
    const store: AlertStore = {
      get: (key) => inner.get(key),
      set: (key, value, options) => inner.set(key, value, options),
      list: (prefix, options) => inner.list(prefix, options),
      delete: async (key) => {
        await inner.delete(key);
        if (key === keyOf(here) && !landed) {
          landed = true;
          for (const s of [here, durham, kathmandu]) {
            await inner.set(keyOf(s), record({ ...s, ...LATER }));
          }
          await inner.set(idsKey('snow', ID), { ...entry([here, durham, kathmandu]), ...LATER });
        }
      },
    };
    expect(await forgetDevice(store, 'snow', ID, here)).toBe('deleted');
    expect(landed).toBe(true);
    expect(inner.keys()).toHaveLength(4);
    for (const s of [durham, kathmandu]) {
      expect(await inner.get(keyOf(s))).toMatchObject(LATER);
    }
  });

  it('keeps an ids entry rewritten since it was read, though everything it named has gone', async () => {
    const inner = new MemoryAlertStore();
    await seedSet(inner);
    const next = { ...entry([here]), leaving: [keyOf(durham), keyOf(kathmandu)] };
    const store: AlertStore = {
      get: (key) => inner.get(key),
      set: (key, value, options) => inner.set(key, value, options),
      list: (prefix, options) => inner.list(prefix, options),
      delete: async (key) => {
        await inner.delete(key);
        // A PUT's removals-first entry, written just as the last record goes.
        if (key === keyOf(kathmandu)) await inner.set(idsKey('snow', ID), next);
      },
    };
    expect(await forgetDevice(store, 'snow', ID, here)).toBe('deleted');
    expect(inner.keys()).toEqual([idsKey('snow', ID)]);
    expect(await inner.get(idsKey('snow', ID))).toEqual(next);
  });

  it('keeps the ids entry when a record it names was written again after the deletes', async () => {
    // A PUT that wrote its records after they were deleted here, and an entry the same as before
    // (one cut short keeps the previous updatedAt), just before the entry is read again.
    const inner = new MemoryAlertStore();
    await seedSet(inner);
    let reads = 0;
    const store: AlertStore = {
      get: async (key) => {
        if (key === idsKey('snow', ID) && ++reads === 2) {
          for (const s of [here, durham]) await inner.set(keyOf(s), record({ ...s, ...LATER }));
          await inner.set(idsKey('snow', ID), entry([here, durham, kathmandu]));
        }
        return inner.get(key);
      },
      set: (key, value, options) => inner.set(key, value, options),
      list: (prefix, options) => inner.list(prefix, options),
      delete: (key) => inner.delete(key),
    };
    expect(await forgetDevice(store, 'snow', ID, here)).toBe('deleted');
    expect(reads).toBe(2);
    expect(inner.keys()).toEqual([idsKey('snow', ID), keyOf(durham), keyOf(here)].sort());
  });

  it("keeps a moved device's newer record, and the entry naming it", async () => {
    const store = new MemoryAlertStore();
    const moved = { tz: 'Asia/Kolkata', ...LATER };
    await store.set(keyOf(here), record(here));
    await store.set(keyOf(moved), record(moved));
    await store.set(idsKey('snow', ID), { tz: 'Asia/Kolkata' } satisfies DeviceIdsEntry);
    expect(await forgetDevice(store, 'snow', ID, here)).toBe('deleted');
    expect(store.keys()).toEqual([idsKey('snow', ID), keyOf(moved)]);
  });

  it("goes on with the rest of the set when the trigger's record has already gone", async () => {
    const store = new MemoryAlertStore();
    await seedSet(store);
    await store.delete(keyOf(kathmandu));
    expect(await forgetDevice(store, 'snow', ID, kathmandu)).toBe('deleted');
    expect(store.keys()).toEqual([]);
  });

  it("never touches another device's records, even one its entry wrongly names", async () => {
    const OTHER = registrationId('snow', 'cd'.repeat(32));
    const store = new MemoryAlertStore();
    await seedSet(store);
    const theirs = [keyOf(here, OTHER), keyOf(durham, OTHER)];
    for (const key of theirs) await store.set(key, { ...STAMP });
    await store.set(idsKey('snow', OTHER), { tz: 'Europe/London' });
    await store.set(idsKey('snow', ID), {
      ...entry([here, durham, kathmandu]),
      leaving: [theirs[1]],
    });
    expect(await forgetDevice(store, 'snow', ID, here)).toBe('deleted');
    expect(store.keys()).toEqual([idsKey('snow', OTHER), ...theirs].sort());
  });

  it('deletes nothing it is unsure of when the store fails', async () => {
    const failOn = (inner: AlertStore, op: 'get' | 'delete', key: string): AlertStore =>
      new SafeAlertStore(
        {
          get: (k) =>
            op === 'get' && k === key ? Promise.reject(new Error('down')) : inner.get(k),
          set: (k, value, options) => inner.set(k, value, options),
          list: (prefix, options) => inner.list(prefix, options),
          delete: (k) =>
            op === 'delete' && k === key ? Promise.reject(new Error('down')) : inner.delete(k),
        },
        () => {},
      );
    const seeded = async (): Promise<MemoryAlertStore> => {
      const inner = new MemoryAlertStore();
      await seedSet(inner);
      return inner;
    };
    const all = [idsKey('snow', ID), keyOf(here), keyOf(durham), keyOf(kathmandu)].sort();

    // The trigger's own record can't be read or deleted: nothing goes.
    for (const op of ['get', 'delete'] as const) {
      const inner = await seeded();
      expect(await forgetDevice(failOn(inner, op, keyOf(durham)), 'snow', ID, durham)).toBe(
        'failed',
      );
      expect(inner.keys()).toEqual(all);
    }
    // Another record can't be read or deleted: it stays, and so does the entry naming it.
    for (const op of ['get', 'delete'] as const) {
      const inner = await seeded();
      expect(await forgetDevice(failOn(inner, op, keyOf(kathmandu)), 'snow', ID, durham)).toBe(
        'deleted',
      );
      expect(inner.keys()).toEqual([idsKey('snow', ID), keyOf(kathmandu)].sort());
    }
    // The entry can't be read: the trigger is forgotten alone, by its own stamp.
    {
      const inner = await seeded();
      expect(await forgetDevice(failOn(inner, 'get', idsKey('snow', ID)), 'snow', ID, durham)).toBe(
        'deleted',
      );
      expect(inner.keys()).toEqual(all.filter((k) => k !== keyOf(durham)));
    }
    // The entry can't be deleted: it stays, naming nothing, for the daily cleanup (`forgetIdsLeft`).
    {
      const inner = await seeded();
      expect(
        await forgetDevice(failOn(inner, 'delete', idsKey('snow', ID)), 'snow', ID, durham),
      ).toBe('deleted');
      expect(inner.keys()).toEqual([idsKey('snow', ID)]);
    }
  });
});

describe('forgetIdsLeft', () => {
  const ids = idsKey('snow', ID);
  const london = regKey('Europe/London', 'snow', ID);
  const durham = regKey('Europe/London', 'snow', ID, PID);
  const kolkata = regKey('Asia/Kolkata', 'snow', ID);
  const salt = '00112233445566778899aabbccddeeff';
  const set: DeviceIdsEntry = { v: 2, tz: 'Europe/London', saved: [durham], salt };
  const record = { v: 1, id: ID, app: 'snow', updatedAt: '2026-12-01T18:04:00.000Z' };

  it('deletes an ids entry naming no record that is there, and nothing else', async () => {
    const theirs = idsKey('snow', registrationId('snow', 'cd'.repeat(32)));
    // A set, an 8.1 entry, a salt alone (a first registration cut short), a malformed one.
    for (const entry of [set, { tz: 'Europe/London' }, { v: 2, saved: [], salt }, { zone: 'x' }]) {
      const store = new MemoryAlertStore();
      await store.set(ids, entry);
      await store.set(theirs, { tz: 'Asia/Kolkata' });
      expect(await forgetIdsLeft(store, 'snow', ID)).toBe(true);
      expect(store.keys()).toEqual([theirs]);
    }
    expect(await forgetIdsLeft(new MemoryAlertStore(), 'snow', ID)).toBe(false);
  });

  it('keeps one naming any record that is there', async () => {
    for (const key of [london, durham]) {
      const store = new MemoryAlertStore();
      await store.set(ids, set);
      await store.set(key, record);
      expect(await forgetIdsLeft(store, 'snow', ID)).toBe(false);
      expect(store.keys()).toEqual([ids, key].sort());
    }
  });

  it('keeps an entry a registration writes to while it is read', async () => {
    // An 8.1 registration in the zone its entry names writes only the record; one moving to
    // another zone writes the entry first, then the record (devices.ts `saveRegistration`).
    const again = async (inner: AlertStore) => void (await inner.set(london, record));
    const moved = async (inner: AlertStore) => {
      await inner.set(ids, { tz: 'Asia/Kolkata', from: ['Europe/London'] });
      await inner.set(kolkata, { ...record, tz: 'Asia/Kolkata' });
      await inner.set(ids, { tz: 'Asia/Kolkata' });
    };
    // The reads, in order: the entry, its record, the entry again, the record again.
    for (const [put, at, kept] of [
      [again, 2, [ids, london]],
      [again, 3, [ids, london]],
      [moved, 2, [ids, kolkata]],
      [moved, 3, [ids, kolkata]],
    ] as const) {
      const inner = new MemoryAlertStore();
      await inner.set(ids, { tz: 'Europe/London' });
      let gets = 0;
      const store: AlertStore = {
        get: async (key) => {
          if (++gets === at) await put(inner);
          return inner.get(key);
        },
        set: (key, value, options) => inner.set(key, value, options),
        list: (prefix, options) => inner.list(prefix, options),
        delete: (key) => inner.delete(key),
      };
      expect(await forgetIdsLeft(store, 'snow', ID), `${put.name} at read ${at}`).toBe(false);
      expect(gets).toBeGreaterThanOrEqual(at);
      expect(inner.keys()).toEqual([...kept].sort());
    }
  });

  it('deletes nothing when a read fails', async () => {
    for (const failing of [ids, london]) {
      const inner = new MemoryAlertStore();
      await inner.set(ids, { tz: 'Europe/London' });
      const store = new SafeAlertStore({
        get: (key) => (key === failing ? Promise.reject(new Error('down')) : inner.get(key)),
        set: (key, value, options) => inner.set(key, value, options),
        list: (prefix, options) => inner.list(prefix, options),
        delete: (key) => inner.delete(key),
      });
      await expect(forgetIdsLeft(store, 'snow', ID)).rejects.toThrow(AlertStoreError);
      expect(inner.keys()).toEqual([ids]);
    }
  });

  it('rejects when the delete fails, so the entry is not counted as gone', async () => {
    const inner = new MemoryAlertStore();
    await inner.set(ids, set);
    const store = new SafeAlertStore({
      get: (key) => inner.get(key),
      set: (key, value, options) => inner.set(key, value, options),
      list: (prefix, options) => inner.list(prefix, options),
      delete: () => Promise.reject(new Error('down')),
    });
    await expect(forgetIdsLeft(store, 'snow', ID)).rejects.toThrow(AlertStoreError);
    expect(inner.keys()).toEqual([ids]);
  });
});

describe('the keys from before zoneSegment', () => {
  const OLD = `reg/v1/Europe%2FLondon/snow.${ID}`;
  const NEW = regKey('Europe/London', 'snow', ID);
  const record = (stamp: string, name = 'Leeds') => ({ name, updatedAt: stamp, seenAt: stamp });

  it('names the key a record was written by before, where it differs', () => {
    expect(oldRegKey(NEW)).toBe(OLD);
    expect(oldRegKey(regKey('Etc/GMT+5', 'snow', ID, PID))).toBe(
      `reg/v1/Etc%2FGMT%2B5/snow.${ID}.${PID}`,
    );
    // As Netlify lists it: the same record, by the string it was written by.
    expect(oldRegKey(`reg/v1/Europe/London/snow.${ID}`)).toBe(OLD);
    expect(oldRegKey(regKey('UTC', 'snow', ID))).toBeNull();
    expect(oldRegKey(idsKey('snow', ID))).toBeNull();
    expect(withOldForms([NEW, regKey('UTC', 'snow', ID)])).toEqual([
      NEW,
      OLD,
      regKey('UTC', 'snow', ID),
    ]);
  });

  it('forgets a stale phone in either form, and keeps one rewritten since at its new key', async () => {
    const stale = { tz: 'Europe/London', ...record('2026-08-01T08:00:00.000Z') };
    const kathmandu = regKey('Asia/Kathmandu', 'snow', ID, PID);
    const entry = {
      v: 2,
      tz: 'Europe/London',
      saved: [`reg/v1/Asia%2FKathmandu/snow.${ID}.${PID}`],
      salt: newSalt(),
    };
    // Both places still under old keys: all of it goes, the entry last.
    const store = new MemoryAlertStore();
    await store.set(OLD, stale);
    await store.set(oldRegKey(kathmandu)!, { ...stale, tz: 'Asia/Kathmandu' });
    await store.set(idsKey('snow', ID), entry);
    expect(await forgetDevice(store, 'snow', ID, stale)).toBe('deleted');
    expect(store.keys()).toEqual([]);
    // Rewritten at its new key since (the phone called in): the old copy goes, the phone stays.
    const moved = new MemoryAlertStore();
    await moved.set(OLD, stale);
    await moved.set(NEW, { ...stale, ...record('2026-11-09T08:00:00.000Z') });
    await moved.set(idsKey('snow', ID), { tz: 'Europe/London' });
    expect(await forgetDevice(moved, 'snow', ID, stale)).toBe('changed');
    expect(moved.keys()).toEqual([idsKey('snow', ID), NEW]);
  });

  it('keeps an ids entry naming a record still under its old key', async () => {
    const store = new MemoryAlertStore();
    await store.set(OLD, record('2026-11-01T08:00:00.000Z'));
    await store.set(idsKey('snow', ID), { tz: 'Europe/London' });
    expect(await forgetIdsLeft(store, 'snow', ID)).toBe(false);
    expect(store.keys()).toEqual([idsKey('snow', ID), `reg/v1/Europe/London/snow.${ID}`]);
  });
});
