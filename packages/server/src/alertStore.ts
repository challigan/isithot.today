/**
 * The notifications' storage (iOS build spec, section 8.3): registrations, the once-a-day claims,
 * the registrations judged with nothing to send, the zones' done markers, the shared provider
 * token and the test sends' limit, all in the Netlify Blobs store `isithot-alerts`. Production
 * uses the one site-wide store; previews and branch deploys get a deploy-scoped store, chosen as
 * the cache's is (blobs.ts), so a preview's own code never reads or writes a real registration.
 * (The store is the site's, so code built from someone else's pull request could open it: SETUP
 * section 1 has Netlify require approval before it builds one.)
 *
 * **Failure rules.** Every call takes at most `ALERT_STORE_TIMEOUT_MS` and either resolves with
 * what the store confirmed or rejects with an `AlertStoreError`; nothing resolves with a guess.
 * `get` gives null only when the store said the key is absent, and `set` gives false only when
 * the store said the key exists. A call that times out may still land later. So a caller treats a
 * rejection as "unknown" and does only what is safe either way:
 * - a claim (`set` with `onlyIfNew`) that rejects is not a claim: nothing is sent, and the next run
 *   tries again (and finds the claim, if the write landed after all);
 * - a read that rejects is not "absent": skip the record, and don't delete it or mark its zone done;
 * - a listing that rejects is not empty: skip the zone, and don't mark it done;
 * - a delete that rejects leaves the key. A release that fails keeps its claim, so that push is not
 *   retried today (at most once, never twice); a registration that could not be deleted is tried
 *   again at its next refusal;
 * - nothing is deleted on the strength of a read that failed.
 * Since an `await` that rejects skips what follows it, the plain code is already safe; catch only
 * to count and carry on.
 *
 * **What `@netlify/blobs` 11.1.3 does** (read from its source):
 * - `getStore` and `getDeployStore` both take `consistency`. Set on the store, `strong` sends every
 *   get, list, set and delete through the uncached edge URL, and a strong call with no such URL
 *   throws `BlobsConsistencyError`.
 * - `setJSON(key, value, { onlyIfNew: true })` sends `if-none-match: *` and resolves
 *   `{ modified: false }` for a 412, but `{ modified: true }` for any other answer, an error after
 *   its retries included. So a conditional write is believed only with the etag a real write
 *   returns; without one, it is read back (`blobsAlertStore`).
 * - `list({ prefix, directories: true })` gathers every page and gives `blobs` (key and etag) and
 *   `directories` as full paths without a trailing slash: "reg/v1/Europe%2FLondon".
 * - `delete` resolves for 200, 204 and 404. The client retries 429s, 5xxs and network failures up
 *   to five times, 5 s apart, hence the timeout.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { getDeployStore, getStore, type Store } from '@netlify/blobs';

/** The Blobs store's name. */
export const ALERT_STORE = 'isithot-alerts';

/** How long any store call may take, ms: the same 1.5 s as the cache's reads (`SafeKV`). */
export const ALERT_STORE_TIMEOUT_MS = 1500;

export interface AlertListing {
  /** Keys under the prefix (with `directories`, only those not inside a further directory). */
  keys: string[];
  /** With `directories`: each directory under the prefix, as a full path without a trailing "/". */
  directories: string[];
}

/** The four calls the notifications need. Values are JSON. */
export interface AlertStore {
  /** A strongly consistent read: the value, or null when the store says there is none. */
  get<T>(key: string): Promise<T | null>;
  /**
   * Writes the value. With `onlyIfNew`, only when the key is absent: true when the store
   * confirmed the write, false when the key already existed.
   */
  set(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<boolean>;
  /** Every key starting with `prefix`, sorted, or with `directories` the keys and directories one level down. */
  list(prefix: string, options?: { directories?: boolean }): Promise<AlertListing>;
  /** Removes the key; removing one that is absent is fine. */
  delete(key: string): Promise<void>;
}

/**
 * Text fit for a public log: anything that looks like an id, a device token or a provider token
 * cut down to a prefix. Keys hold ids, never device tokens; this is a second guard.
 */
export function redact(text: string): string {
  return text
    .replace(/eyJ[\w-]*\.[\w-]*\.[\w-]*/g, '<jwt>')
    .replace(/[0-9a-f]{32,}/gi, (hex) => `${hex.slice(0, 8)}…`);
}

export class AlertStoreError extends Error {
  constructor(
    readonly op: 'get' | 'set' | 'list' | 'delete',
    key: string,
    cause: unknown,
  ) {
    super(redact(`alert store: ${op} ${key || '(all)'}: ${(cause as Error)?.message ?? cause}`));
    this.name = 'AlertStoreError';
  }
}

/**
 * Bounds every call of another store by `timeoutMs` and reports each failure once, through
 * `onError`, before rejecting with it (the failure rules above).
 */
export class SafeAlertStore implements AlertStore {
  constructor(
    private readonly inner: AlertStore,
    private readonly onError: (err: AlertStoreError) => void = () => {},
    private readonly timeoutMs = ALERT_STORE_TIMEOUT_MS,
  ) {}

  private async guard<T>(
    op: AlertStoreError['op'],
    key: string,
    call: () => Promise<T>,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${this.timeoutMs} ms`)),
        this.timeoutMs,
      );
    });
    try {
      // The race keeps a late failure of the call from going unhandled.
      return await Promise.race([call(), slow]);
    } catch (cause) {
      const err = new AlertStoreError(op, key, cause);
      this.onError(err);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  get<T>(key: string): Promise<T | null> {
    return this.guard('get', key, () => this.inner.get<T>(key));
  }

  set(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<boolean> {
    return this.guard('set', key, () => this.inner.set(key, value, options));
  }

  list(prefix: string, options?: { directories?: boolean }): Promise<AlertListing> {
    return this.guard('list', prefix, () => this.inner.list(prefix, options));
  }

  delete(key: string): Promise<void> {
    return this.guard('delete', key, () => this.inner.delete(key));
  }
}

/** The key rules Blobs checks on a write. */
function validateKey(key: string): void {
  if (key === '') throw new Error('Blob key must not be empty.');
  if (key.startsWith('/') || key.startsWith('%2F')) {
    throw new Error('Blob key must not start with forward slash (/).');
  }
  if (Buffer.byteLength(key) > 600) throw new Error('Blob key must be at most 600 bytes.');
}

/**
 * The Blobs semantics in memory, for tests and the dry run: JSON values (each read is a fresh
 * copy), atomic `onlyIfNew`, prefix matching, sorted listings, and directories at any depth.
 */
export class MemoryAlertStore implements AlertStore {
  private readonly entries = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const json = this.entries.get(key);
    return json === undefined ? null : (JSON.parse(json) as T);
  }

  async set(key: string, value: unknown, options: { onlyIfNew?: boolean } = {}): Promise<boolean> {
    validateKey(key);
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError(`${key}: the value is not JSON`);
    if (options.onlyIfNew && this.entries.has(key)) return false;
    this.entries.set(key, json);
    return true;
  }

  async list(prefix: string, options: { directories?: boolean } = {}): Promise<AlertListing> {
    const keys: string[] = [];
    const directories = new Set<string>();
    for (const key of this.keys()) {
      if (!key.startsWith(prefix)) continue;
      const slash = key.indexOf('/', prefix.length);
      if (options.directories && slash >= 0) directories.add(key.slice(0, slash));
      else keys.push(key);
    }
    return { keys, directories: [...directories] };
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  /** Every key, sorted. */
  keys(): string[] {
    return [...this.entries.keys()].sort();
  }
}

/** The parts of a Blobs store this uses. */
export type BlobsStoreLike = Pick<Store, 'get' | 'setJSON' | 'list' | 'delete'>;

/** A Blobs store as an `AlertStore`, without the timeout (`createBlobsAlertStore` adds it). */
export function blobsAlertStore(store: BlobsStoreLike): AlertStore {
  const read = async <T>(key: string): Promise<T | null> =>
    ((await store.get(key, { type: 'json' })) as T | null) ?? null;
  return {
    get: read,
    async set(key, value, { onlyIfNew = false } = {}) {
      if (!onlyIfNew) {
        await store.setJSON(key, value);
        return true;
      }
      const { modified, etag } = await store.setJSON(key, value, { onlyIfNew: true });
      if (!modified) return false;
      if (etag) return true;
      // Blobs calls any answer but 412 "modified", failures included: believe what reads back.
      const stored = await read<unknown>(key);
      if (stored === null) throw new Error('the write was not confirmed');
      return JSON.stringify(stored) === JSON.stringify(value);
    },
    async list(prefix, { directories = false } = {}) {
      const page = await store.list({ prefix, directories });
      return {
        keys: page.blobs.map((b) => b.key),
        directories: page.directories.map((d) => d.replace(/\/$/, '')),
      };
    },
    async delete(key) {
      await store.delete(key);
    },
  };
}

/**
 * The notifications' store: the site-wide one in production, a deploy-scoped one elsewhere, both
 * strongly consistent, every call bounded. Throws when there is no Blobs environment: unlike the
 * cache, it never falls back to memory, which would let two instances both send.
 */
export function createBlobsAlertStore(
  production: boolean,
  options: { onError?: (err: AlertStoreError) => void; timeoutMs?: number } = {},
): AlertStore {
  const settings = { name: ALERT_STORE, consistency: 'strong' as const };
  const store = production ? getStore(settings) : getDeployStore(settings);
  return new SafeAlertStore(blobsAlertStore(store), options.onError, options.timeoutMs);
}

// ---- Keys (section 8.3). Zones are encodeURIComponent'd, so each is one path segment. ----

const zone = (tz: string): string => encodeURIComponent(tz);

/** A registration's id: the first 32 hex characters of sha256(app + ':' + token). */
export function registrationId(app: string, token: string): string {
  return createHash('sha256').update(`${app}:${token}`).digest('hex').slice(0, 32);
}

/** What a log may say of an id: its first 8 characters. */
export function idPrefix(id: string): string {
  return `${id.slice(0, 8)}…`;
}

export const REG_PREFIX = 'reg/v1/';
export const IDS_PREFIX = 'ids/v1/';
export const SENT_PREFIX = 'sent/v1/';
export const JUDGED_PREFIX = 'judged/v1/';
export const DONE_PREFIX = 'done/v1/';
export const TEST_PREFIX = 'test/v1/';

/** One zone's registrations: `reg/v1/Europe%2FLondon/`. */
export function regZonePrefix(tz: string): string {
  return `${REG_PREFIX}${zone(tz)}/`;
}

/**
 * A registration, written by the devices handler only: `reg/v1/<tz>/<app>.<id>` for the free
 * place ("where you are"), `reg/v1/<tz>/<app>.<id>.<pid>` for a saved place (`placeId`). Each
 * place is in its own zone's directory, so windows, claims and done markers stay per zone.
 */
export function regKey(tz: string, app: string, id: string, pid?: string): string {
  return `${regZonePrefix(tz)}${app}.${id}${pid ? `.${pid}` : ''}`;
}

/** A registration key's parts, `pid` only for a saved place's, or null for any other key. */
export function parseRegKey(
  key: string,
): { tz: string; app: string; id: string; pid?: string } | null {
  const match = /^reg\/v1\/([^/]+)\/([a-z]+)\.([0-9a-f]{32})(?:\.([0-9a-f]{12}))?$/.exec(key);
  if (!match) return null;
  try {
    const parts = { tz: decodeURIComponent(match[1]!), app: match[2]!, id: match[3]! };
    return match[4] ? { ...parts, pid: match[4] } : parts;
  } catch {
    return null;
  }
}

/**
 * A saved place's pid: the first 12 hex characters of HMAC-SHA256 keyed with the device's salt
 * (`newSalt`, kept only in its ids entry) over the place's canonical query. Without the salt, no
 * pid in a key, a claim or a log can be matched to a place by hashing candidate places, so once
 * the ids entry is deleted nothing left behind names the place.
 */
export function placeId(salt: string, query: string): string {
  return createHmac('sha256', salt).update(query).digest('hex').slice(0, 12);
}

/** A device's salt for its pids: 16 random bytes, as hex. */
export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

/** The zone a directory of `list(REG_PREFIX, { directories: true })` stands for, or null. */
export function zoneOfDirectory(directory: string): string | null {
  const match = /^reg\/v1\/([^/]+)\/?$/.exec(directory);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/**
 * Where a device's registrations are: `ids/v1/<app>.<id>`, holding `{ tz }` (version 1) or the
 * set (version 2, with its salt): devices.ts's `DeviceIdsEntry`.
 */
export function idsKey(app: string, id: string): string {
  return `${IDS_PREFIX}${app}.${id}`;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Every registration key an ids entry names, version 1 or 2, each once: the free record's zone
 * (`tz`) and the zones it is leaving (`from`) as keys, then the `saved` and `leaving` keys that are
 * this device's. None for anything malformed.
 */
export function keysOf(entry: unknown, app: string, id: string): string[] {
  if (!entry || typeof entry !== 'object') return [];
  const e = entry as Record<string, unknown>;
  const zones = [...(typeof e.tz === 'string' ? [e.tz] : []), ...strings(e.from)];
  const mine = (key: string): boolean => {
    const reg = parseRegKey(key);
    return reg?.app === app && reg.id === id;
  };
  return [
    ...new Set([
      ...zones.map((tz) => regKey(tz, app, id)),
      ...[...strings(e.saved), ...strings(e.leaving)].filter(mine),
    ]),
  ];
}

/** One day's claims for a topic and kind: `sent/v1/<localDate>/<topic>.<kind>/`. */
export function sentPrefix(localDate: string, topic: string, kind: string): string {
  return `${SENT_PREFIX}${localDate}/${topic}.${kind}/`;
}

/** The once-a-day claim, written with `onlyIfNew` before sending: `{ at, apnsId }`. */
export function sentKey(
  localDate: string,
  topic: string,
  kind: string,
  app: string,
  id: string,
): string {
  return `${sentPrefix(localDate, topic, kind)}${app}.${id}`;
}

/** One day's judged registrations for a topic and kind: `judged/v1/<localDate>/<topic>.<kind>/`. */
export function judgedPrefix(localDate: string, topic: string, kind: string): string {
  return `${JUDGED_PREFIX}${localDate}/${topic}.${kind}/`;
}

/**
 * A registration finished with for the window without a claim, `{ at }`: judged with nothing to
 * send, or logged by a dry run. Written by a run that leaves the registration's zone unfinished,
 * so later runs skip it unread, as they skip a claimed one. Plain writes: every writer writes the
 * same thing.
 */
export function judgedKey(
  localDate: string,
  topic: string,
  kind: string,
  app: string,
  id: string,
): string {
  return `${judgedPrefix(localDate, topic, kind)}${app}.${id}`;
}

/** One day's done markers: `done/v1/<localDate>/`. */
export function donePrefix(localDate: string): string {
  return `${DONE_PREFIX}${localDate}/`;
}

/** A zone has finished a window for the day: `done/v1/<localDate>/<kind>/<tz>`, holding `{ at, count }`. */
export function doneKey(localDate: string, kind: string, tz: string): string {
  return `${donePrefix(localDate)}${kind}/${zone(tz)}`;
}

/** The shared provider token for an APNs environment: `apns/v1/jwt/<env>`, holding `{ jwt, iat }`. */
export function jwtKey(env: string): string {
  return `apns/v1/jwt/${env}`;
}

/**
 * A test send's claim: `test/v1/<id>/<yyyy-mm-ddThh>.<slot>` (the hour in UTC). One key per hour
 * would allow one send an hour, so each of the hour's sends claims its own slot.
 */
export function testKey(id: string, now: number, slot: number): string {
  return `${TEST_PREFIX}${id}/${new Date(now).toISOString().slice(0, 13)}.${slot}`;
}

/**
 * Claims one of this hour's `perHour` test sends for the id: true when one was free. Rejects when
 * the store fails, so a caller sends nothing then.
 */
export async function claimTestSend(
  store: AlertStore,
  id: string,
  now: number,
  perHour: number,
): Promise<boolean> {
  for (let slot = 1; slot <= perHour; slot++) {
    if (await store.set(testKey(id, now, slot), {}, { onlyIfNew: true })) return true;
  }
  return false;
}

/** What `forgetDevice` needs of a record, as it was read. */
export interface RegistrationStamp {
  id: string;
  app: string;
  tz: string;
  /** Absent for the free place ("where you are"); a saved place's pid, as its key has it. */
  slot?: string;
  updatedAt: string;
  seenAt?: string;
}

/** The record that set `forgetDevice` off, as it was read: where it is, and its stamp. */
export type SlotStamp = Pick<RegistrationStamp, 'tz' | 'slot' | 'updatedAt' | 'seenAt'>;

/** Deletes the record at `key` if it is as `stamp` was read; a missing record counts as gone. */
async function forgetIfUnchanged(
  store: AlertStore,
  key: string,
  stamp: SlotStamp,
): Promise<'gone' | 'changed' | 'failed'> {
  let current: Partial<SlotStamp> | null;
  try {
    current = await store.get<Partial<SlotStamp>>(key);
  } catch {
    return 'failed';
  }
  if (current === null) return 'gone';
  if (current.updatedAt !== stamp.updatedAt || current.seenAt !== stamp.seenAt) return 'changed';
  try {
    await store.delete(key);
  } catch {
    return 'failed';
  }
  return 'gone';
}

/**
 * Forgets a device's every place, starting from the record that set it off (`trigger`: one the
 * run found stale, or whose push Apple refused). A record goes only if its `updatedAt` and
 * `seenAt` are the trigger's, so whatever the app wrote since stays (a registration writes every
 * place with one stamp):
 * 1. read the ids key;
 * 2. the trigger's own record, by that rule; written since, or a store failure, and nothing else
 *    is touched;
 * 3. every other key the ids entry names, at once, by the same rule;
 * 4. the ids key last (and the salt in it), re-read, only if unchanged and all it names has gone,
 *    still, when read again after it (a registration may have written them back meanwhile).
 * A record the ids entry doesn't name (an orphan: a rollback, two registrations overlapping) is
 * thus forgotten alone, by its own stamp, and so is the trigger when the ids key can't be read.
 * - "deleted": the trigger's record is gone, whatever became of the others, so its zone can finish;
 * - "changed": it was written since it was read, so the device is kept;
 * - "failed": the store failed, so it is kept.
 */
export async function forgetDevice(
  store: AlertStore,
  app: string,
  id: string,
  trigger: SlotStamp,
): Promise<'deleted' | 'changed' | 'failed'> {
  const ids = idsKey(app, id);
  let entry: unknown;
  let entryRead = true;
  try {
    entry = await store.get<unknown>(ids);
  } catch {
    entryRead = false;
  }
  const own = regKey(trigger.tz, app, id, trigger.slot);
  const first = await forgetIfUnchanged(store, own, trigger);
  if (first !== 'gone') return first;
  if (!entryRead || entry === null) return 'deleted';
  const named = keysOf(entry, app, id);
  const outcomes = await Promise.all(
    named.map((key) => (key === own ? first : forgetIfUnchanged(store, key, trigger))),
  );
  if (outcomes.every((outcome) => outcome === 'gone')) {
    try {
      const again = await store.get<unknown>(ids);
      if (JSON.stringify(again) !== JSON.stringify(entry)) return 'deleted';
      const back = await Promise.all(named.map((key) => store.get<unknown>(key)));
      if (back.every((value) => value === null)) await store.delete(ids);
    } catch {
      // An ids key left behind names nothing; the device's next registration replaces it.
    }
  }
  return 'deleted';
}
