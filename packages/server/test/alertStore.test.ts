import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ALERT_STORE_TIMEOUT_MS,
  AlertStoreError,
  MemoryAlertStore,
  REG_PREFIX,
  SafeAlertStore,
  blobsAlertStore,
  claimTestSend,
  createBlobsAlertStore,
  doneKey,
  donePrefix,
  forgetRegistration,
  idPrefix,
  idsKey,
  jwtKey,
  parseRegKey,
  redact,
  regKey,
  regZonePrefix,
  registrationId,
  sentKey,
  sentPrefix,
  testKey,
  zoneOfDirectory,
  type AlertStore,
  type BlobsStoreLike,
} from '../src';

const TOKEN = 'ab'.repeat(32);
const ID = '815fd83640110117669cc8280c00f201';
const NOW = Date.UTC(2026, 11, 1, 18, 5, 0);

describe('keys', () => {
  it('the id is the first 32 hex characters of sha256(app:token)', () => {
    expect(registrationId('snow', TOKEN)).toBe(ID);
    expect(registrationId('wind', TOKEN)).toBe('df91a5423cbba087351f1504e13a9720');
    expect(idPrefix(ID)).toBe('815fd836…');
  });

  it('builds every key in the storage table, each zone one path segment', () => {
    expect(regKey('Europe/London', 'snow', ID)).toBe(`reg/v1/Europe%2FLondon/snow.${ID}`);
    expect(regKey('America/Argentina/Buenos_Aires', 'snow', ID)).toBe(
      `reg/v1/America%2FArgentina%2FBuenos_Aires/snow.${ID}`,
    );
    expect(regZonePrefix('Asia/Kolkata')).toBe('reg/v1/Asia%2FKolkata/');
    expect(idsKey('snow', ID)).toBe(`ids/v1/snow.${ID}`);
    expect(sentKey('2026-12-01', 'snow', 'evening', 'snow', ID)).toBe(
      `sent/v1/2026-12-01/snow.evening/snow.${ID}`,
    );
    expect(sentPrefix('2026-12-01', 'snow', 'morning')).toBe('sent/v1/2026-12-01/snow.morning/');
    expect(doneKey('2026-12-01', 'evening', 'Europe/London')).toBe(
      'done/v1/2026-12-01/evening/Europe%2FLondon',
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
    expect(zoneOfDirectory('reg/v1/Europe%2FLondon')).toBe('Europe/London');
    expect(zoneOfDirectory('reg/v1/Europe%2FLondon/')).toBe('Europe/London');
    expect(zoneOfDirectory('reg/v1/%E0%A4%A')).toBeNull();
    expect(zoneOfDirectory('sent/v1/2026-12-01')).toBeNull();
  });

  it('redacts ids, device tokens and provider tokens for the log', () => {
    expect(redact(`reg/v1/Europe%2FLondon/snow.${ID}`)).toBe(
      'reg/v1/Europe%2FLondon/snow.815fd836…',
    );
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
        'reg/v1/America%2FArgentina%2FBuenos_Aires',
        'reg/v1/Asia%2FKolkata',
        'reg/v1/Europe%2FLondon',
      ],
    });
    expect(await store.list(regZonePrefix('Europe/London'), { directories: true })).toEqual({
      keys: ['reg/v1/Europe%2FLondon/snow.a1', 'reg/v1/Europe%2FLondon/snow.b1'],
      directories: [],
    });
    // The top level, and a prefix that stops inside a segment.
    expect(await store.list('', { directories: true })).toEqual({
      keys: [],
      directories: ['ids', 'reg'],
    });
    expect((await store.list('reg/v1/E', { directories: true })).directories).toEqual([
      'reg/v1/Europe%2FLondon',
    ]);
    expect((await store.list('reg/v1', { directories: true })).directories).toEqual(['reg/v1']);
    // Without directories: every key under the prefix.
    expect((await store.list('reg/v1/')).keys).toHaveLength(5);
    expect(await store.list('done/')).toEqual({ keys: [], directories: [] });
    expect(store.keys()).toEqual([...keys].sort());
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
      'alert store: get reg/v1/Europe%2FLondon/snow.815fd836…: Netlify Blobs has generated an internal error for abababab…',
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
      'reg/v1/Europe%2FLondon',
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

  it('keeps Blobs semantics: onlyIfNew, %2F zones as one directory, prefixes, deletes', async () => {
    context({ deployID: 'deploy2' });
    const store = createBlobsAlertStore(false);
    const claim = sentKey('2026-12-01', 'snow', 'evening', 'snow', ID);
    expect(await store.set(claim, { at: 'one' }, { onlyIfNew: true })).toBe(true);
    expect(await store.set(claim, { at: 'two' }, { onlyIfNew: true })).toBe(false);
    expect(await store.get(claim)).toEqual({ at: 'one' });

    await store.set(regKey('America/Argentina/Buenos_Aires', 'snow', 'a1'), {});
    await store.set(regKey('Asia/Kolkata', 'snow', 'b1'), {});
    await store.set(regKey('Asia/Kolkata', 'snow', 'b2'), {});
    const zones = await store.list(REG_PREFIX, { directories: true });
    expect(zones.keys).toEqual([]);
    expect(zones.directories.sort()).toEqual([
      'reg/v1/America%2FArgentina%2FBuenos_Aires',
      'reg/v1/Asia%2FKolkata',
    ]);
    expect(zones.directories.map(zoneOfDirectory)).toEqual([
      'America/Argentina/Buenos_Aires',
      'Asia/Kolkata',
    ]);
    const kolkata = await store.list(regZonePrefix('Asia/Kolkata'));
    expect(kolkata.keys.sort()).toEqual([
      'reg/v1/Asia%2FKolkata/snow.b1',
      'reg/v1/Asia%2FKolkata/snow.b2',
    ]);
    expect(kolkata.keys.map((key) => parseRegKey(key)?.tz)).toEqual([
      'Asia/Kolkata',
      'Asia/Kolkata',
    ]);
    await store.delete(regKey('Asia/Kolkata', 'snow', 'b1'));
    await store.delete(regKey('Asia/Kolkata', 'snow', 'b1'));
    expect((await store.list(regZonePrefix('Asia/Kolkata'))).keys).toEqual([
      'reg/v1/Asia%2FKolkata/snow.b2',
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

describe('forgetRegistration', () => {
  const record = {
    id: ID,
    app: 'snow',
    tz: 'Europe/London',
    updatedAt: '2026-11-20T19:02:11.000Z',
    seenAt: '2026-11-28T08:00:00.000Z',
  };
  const seed = async (store: AlertStore, stored = record, where = record.tz) => {
    await store.set(regKey(stored.tz, stored.app, stored.id), stored);
    await store.set(idsKey(stored.app, stored.id), { tz: where });
  };

  it('deletes the record and its ids key when the record is as it was read', async () => {
    const store = new MemoryAlertStore();
    await seed(store);
    expect(await forgetRegistration(store, record)).toBe('deleted');
    expect(store.keys()).toEqual([]);
    // Already gone counts as deleted.
    expect(await forgetRegistration(store, record)).toBe('deleted');
  });

  it('keeps a record written or refreshed since it was read', async () => {
    const store = new MemoryAlertStore();
    await seed(store, { ...record, updatedAt: '2026-12-01T18:04:00.000Z' });
    expect(await forgetRegistration(store, record)).toBe('changed');
    await seed(store, { ...record, seenAt: '2026-12-01T18:04:00.000Z' });
    expect(await forgetRegistration(store, record)).toBe('changed');
    expect(store.keys()).toHaveLength(2);
  });

  it('leaves an ids key that points at another zone (the device moved)', async () => {
    const store = new MemoryAlertStore();
    await seed(store, record, 'Asia/Kolkata');
    expect(await forgetRegistration(store, record)).toBe('deleted');
    expect(store.keys()).toEqual([idsKey('snow', ID)]);
  });

  it('deletes nothing it is unsure of when the store fails', async () => {
    const inner = new MemoryAlertStore();
    await seed(inner);
    const failOn = (op: string, prefix: string): AlertStore =>
      new SafeAlertStore(
        {
          get: (key) =>
            op === 'get' && key.startsWith(prefix)
              ? Promise.reject(new Error('down'))
              : inner.get(key),
          set: (key, value, options) => inner.set(key, value, options),
          list: (prefix, options) => inner.list(prefix, options),
          delete: (key) =>
            op === 'delete' && key.startsWith(prefix)
              ? Promise.reject(new Error('down'))
              : inner.delete(key),
        },
        () => {},
      );
    expect(await forgetRegistration(failOn('get', 'reg/'), record)).toBe('failed');
    expect(await forgetRegistration(failOn('delete', 'reg/'), record)).toBe('failed');
    expect(inner.keys()).toHaveLength(2);
    // The record goes; an ids key that cannot be checked stays, pointing at nothing.
    expect(await forgetRegistration(failOn('get', 'ids/'), record)).toBe('deleted');
    expect(inner.keys()).toEqual([idsKey('snow', ID)]);
  });
});
