/**
 * The notifications' run, every 15 minutes (iOS build spec, section 8.6): which places are in a
 * window, whose notifications are due, what their forecasts say, and the pushes. It takes no input
 * but the clock, so any trigger can start it; the scheduled function `alerts-run` does
 * (`alertsRun`, below).
 *
 * Each run, from one moment:
 * 1. lists the zones that hold a registration;
 * 2. keeps those in a window at the place (core's `alertWindows`) with no done marker for it today;
 * 3. lists today's claims for those windows, then each zone's registrations, and strong-reads
 *    each one not already notified, deleting any not seen for `ALERTS.staleAfterDays` and skipping
 *    any whose switch for this window is off;
 * 4. groups the rest by place and units, and asks `getToday` once per group (`climateWaitMs` 0),
 *    starting no group after the budget or the forecast-fetch cap;
 * 5. decides with core's `snowAlert` (ALERTS_FORCE_IDS: the test copy when it says no);
 * 6. claims and sends through `sendAlerts`, which acts on Apple's answers;
 * 7. marks done each zone whose every registration is finished with;
 * 8. in the 03:00 UTC hour, deletes `sent/`, `done/` and `test/` keys more than 2 days old.
 *
 * What it logs is fit for a public log: id prefixes, zones and counts, never a device token, a
 * provider token, a full id, a place query or coordinates.
 */
import {
  ALERTS,
  alertWindows,
  collapseId,
  expiresAt,
  snowAlert,
  testAlert,
  type AlertContent,
  type AlertKind,
  type ApiError,
  type TodayResponse,
  type Topic,
  type TopicAlertPrefs,
  type Units,
} from '@isithot/core';
import {
  DONE_PREFIX,
  REG_PREFIX,
  SENT_PREFIX,
  TEST_PREFIX,
  createBlobsAlertStore,
  doneKey,
  donePrefix,
  forgetRegistration,
  idPrefix,
  parseRegKey,
  redact,
  regZonePrefix,
  sentKey,
  sentPrefix,
  zoneOfDirectory,
  type AlertStore,
} from './alertStore';
import {
  APNS_ORIGINS,
  alertPush,
  apnsKey,
  apnsSender,
  apnsSmoke,
  deliveryFinished,
  sendAlerts,
  type AlertPush,
  type ApnsEnv,
  type ApnsKey,
  type ApnsSender,
  type Delivery,
  type DeliveryOutcome,
  type PushRecord,
} from './apns';
import type { EnvGetter } from './config';
import { createDeps, type ServerDeps } from './deps';
import { getToday } from './today';

/** A registration as the devices handler writes it (section 8.2), as far as the run reads it. */
export interface AlertRecord extends PushRecord {
  v: 1;
  platform: string;
  units: Units;
  /** Each topic's switches; the snow app sends only `snow`. */
  alerts: Partial<Record<Topic, TopicAlertPrefs>>;
  createdAt?: string;
}

export interface RunAlertsOptions {
  /** `getToday`'s dependencies. The run uses them with its own moment and no wait for normals. */
  deps: ServerDeps;
  store: AlertStore;
  /** Opens one APNs environment's HTTP/2 session (`apnsSender(APNS_ORIGINS[env])`, or a fake). */
  sender: (env: ApnsEnv) => ApnsSender;
  /** Each environment's key (`apnsKey`); pushes for an environment without one are deferred. */
  keys: Partial<Record<ApnsEnv, ApnsKey>>;
  /** The run's one moment, ms; `deps.now()` when absent. */
  now?: number;
  /** No group (or record read) starts after this long, ms, by `clock`; pushes get `PUSH_GRACE_MS` more. */
  budgetMs: number;
  /** Log each notification instead of sending it: no claim, no provider token, no push. */
  dryRun: boolean;
  /**
   * Id prefixes (ALERTS_FORCE_IDS, lowercase hex): each of those registrations gets one
   * notification per window per day whatever the band, the real one when the rule sends one and
   * the test copy otherwise. Their switches still apply.
   */
  forceIds?: readonly string[];
  /** Forecast fetches allowed; `ALERTS.maxForecastFetchesPerRun`, paid with OPEN_METEO_API_KEY. */
  maxFetches?: number;
  /** Each line worth logging as the run goes; the summary is `runSummary(result)`. */
  log?: (line: string) => void;
  /** The budget's clock, ms (`Date.now`); tests make time pass with it. */
  clock?: () => number;
}

/** A notification the run decided on, and what became of it. */
export interface RunNotification {
  app: string;
  id: string;
  tz: string;
  kind: AlertKind;
  units: Units;
  /** The local date it is about: tomorrow's in the evening, today's in the morning. */
  date: string;
  name: string;
  title: string;
  body: string;
  forced: boolean;
  outcome: DeliveryOutcome;
}

export interface RunAlertsResult {
  dryRun: boolean;
  /** Zones in a window with no done marker for it today. */
  zones: number;
  /** Due registrations read (those already notified today are skipped unread). */
  records: number;
  /** Forecast groups judged (place and units). */
  groups: number;
  /** Forecasts fetched from Open-Meteo; every other group came from the cache. */
  fetches: number;
  maxFetches: number;
  /** Pushes Apple took. */
  sent: number;
  /** A dry run's notifications, logged instead of sent. */
  logged: number;
  /** Registrations deleted: not seen for 90 days, or refused by Apple. */
  deleted: number;
  /** Lines logged as errors. */
  errors: number;
  /** Notifications for ALERTS_FORCE_IDS. */
  forced: number;
  /** Zones marked done. */
  done: number;
  /** Why the run left work for the next one, if it did: its budget or the fetch cap. */
  stopped: 'budget' | 'fetches' | null;
  /** Old keys deleted by the cleanup, or null when none ran. */
  cleaned: number | null;
  notifications: RunNotification[];
  /** How long the run took by its clock, ms. */
  ms: number;
}

/** Pushes may start this long after the budget, so a judged group's notifications still go. */
export const PUSH_GRACE_MS = 4_000;

/** How long the run waits for Apple's answer to a push, ms: well inside the function's 30 s. */
export const APNS_RUN_TIMEOUT_MS = 4_000;

const DAY = 86_400_000;
/** Record reads (and zone listings) at once: strong reads are cheap, but not free. */
const READ_CONCURRENCY = 25;
/** Old keys deleted at once by the cleanup. */
const CLEANUP_CONCURRENCY = 10;
/** The cleanup runs in this UTC hour, once a day (its marker), on keys over 2 days old. */
const CLEANUP_HOUR = 3;
const KEEP_DAYS = 2;
/** A forced test notification sits below any real one in the summary. */
const FORCED_RELEVANCE = 0.3;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[0-9a-f]{64,200}$/i;

/** The cleanup's once-a-day marker: `done/v1/<utc date>/cleanup`, so it goes with its day. */
export function cleanupKey(utcDate: string): string {
  return `${donePrefix(utcDate)}cleanup`;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Text fit for a public log: ids cut to a prefix, no provider token (`redact`), and no
 * coordinates, whether a cache key's cell ("53.80,-1.55") or a query's lat, lon or key.
 */
function scrub(text: string): string {
  return redact(text)
    .replace(/-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/g, '<cell>')
    .replace(/\b(lat|lon|latitude|longitude|apikey)=[^&\s]*/gi, '$1=…');
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Runs `task` over `items`, `width` at a time. */
async function pool<T>(
  items: readonly T[],
  width: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) await task(items[next++]!);
    }),
  );
}

/** The store, with each failed call reported once (the failure rules in alertStore.ts still hold). */
function watched(store: AlertStore, onError: (err: unknown) => void): AlertStore {
  const watch = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (err) {
      onError(err);
      throw err;
    }
  };
  return {
    get: <T>(key: string) => watch(() => store.get<T>(key)),
    set: (key, value, options) => watch(() => store.set(key, value, options)),
    list: (prefix, options) => watch(() => store.list(prefix, options)),
    delete: (key) => watch(() => store.delete(key)),
  };
}

/** A stored registration, checked, with its zone, app and id from its key; null if unusable. */
function readRecord(
  value: unknown,
  at: { tz: string; app: string; id: string },
): AlertRecord | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Partial<AlertRecord>;
  if (typeof r.token !== 'string' || !TOKEN.test(r.token)) return null;
  if (r.env !== 'sandbox' && r.env !== 'production') return null;
  if (typeof r.query !== 'string' || r.query === '') return null;
  if (r.units !== 'c' && r.units !== 'f') return null;
  if (typeof r.updatedAt !== 'string' || !Number.isFinite(Date.parse(r.updatedAt))) return null;
  if (!r.alerts || typeof r.alerts !== 'object') return null;
  return { ...(r as AlertRecord), name: typeof r.name === 'string' ? r.name : '', ...at };
}

/** A due zone and window, and whether everything due in it was finished with. */
interface Zone {
  tz: string;
  kind: AlertKind;
  /** The local date at the place. */
  date: string;
  /** Registrations listed in the zone. */
  count: number;
  unfinished: boolean;
}

interface Entry {
  zone: Zone;
  record: AlertRecord;
  prefs: TopicAlertPrefs;
  forced: boolean;
}

interface Group {
  params: URLSearchParams;
  entries: Entry[];
}

/** One notification's push, and what the run decided for it. */
interface Pending {
  entry: Entry;
  alert: AlertContent;
  delivery: Delivery;
}

const who = (record: Pick<AlertRecord, 'app' | 'id'>): string =>
  `${record.app}.${idPrefix(record.id)}`;

/**
 * One run. Never rejects for a store, forecast or APNs failure: each is logged once, counted,
 * and left for the next run where that is safe (the failure rules in alertStore.ts).
 */
export async function runAlerts(options: RunAlertsOptions): Promise<RunAlertsResult> {
  const { deps, sender, keys, dryRun } = options;
  const clock = options.clock ?? Date.now;
  const started = clock();
  const deadline = started + options.budgetMs;
  const pushDeadline = deadline + PUSH_GRACE_MS;
  // 1. One moment for the whole run.
  const now = options.now ?? deps.now().getTime();
  const at = new Date(now);
  const forceIds = (options.forceIds ?? []).map((p) => p.toLowerCase());
  const maxFetches =
    options.maxFetches ??
    ALERTS.maxForecastFetchesPerRun[deps.config.openMeteo.apiKey ? 'paid' : 'free'];

  const result: RunAlertsResult = {
    dryRun,
    zones: 0,
    records: 0,
    groups: 0,
    fetches: 0,
    maxFetches,
    sent: 0,
    logged: 0,
    deleted: 0,
    errors: 0,
    forced: 0,
    done: 0,
    stopped: null,
    cleaned: null,
    notifications: [],
    ms: 0,
  };
  const say = (line: string): void => {
    const safe = scrub(line);
    // The run's own errors and the sender's ("alerts: error: …").
    if (/^alerts(-run)?: error:/.test(safe)) result.errors++;
    options.log?.(safe);
  };
  const store = watched(options.store, (err) => say(`alerts-run: error: ${errorText(err)}`));
  const budgetLeft = (): boolean => {
    if (clock() < deadline) return true;
    result.stopped ??= 'budget';
    return false;
  };

  const fetched = new Set<string>();
  const forecastUrl = deps.config.openMeteo.forecastUrl;
  const runDeps: ServerDeps = {
    ...deps,
    now: () => new Date(now),
    // The normals only word a day without snow, which never sends.
    climateWaitMs: 0,
    // Each distinct forecast request is a fetch (a hedged second request is the same one).
    fetch: (input, init) => {
      if (input.startsWith(forecastUrl)) fetched.add(input);
      return deps.fetch(input, init);
    },
    log: (message) => say(`alerts-run: ${message}`),
  };

  const zones: Zone[] = [];
  const entries: Entry[] = [];

  /** Steps 2 to 4: the due zones, and their due registrations. */
  const gather = async (): Promise<void> => {
    // 2. Every zone with a registration.
    let directories: string[];
    try {
      ({ directories } = await store.list(REG_PREFIX, { directories: true }));
    } catch {
      return;
    }
    // 3. Those in a window, with no done marker for it today (one listing per local date).
    const open: Zone[] = [];
    for (const tz of directories.map(zoneOfDirectory)) {
      if (tz === null) continue;
      const { kind, date } = alertWindows(tz, at);
      if (kind) open.push({ tz, kind, date, count: 0, unfinished: false });
    }
    const doneByDate = new Map<string, Set<string> | null>();
    await Promise.all(
      [...new Set(open.map((z) => z.date))].map(async (date) => {
        try {
          doneByDate.set(date, new Set((await store.list(donePrefix(date))).keys));
        } catch {
          doneByDate.set(date, null);
        }
      }),
    );
    for (const zone of open) {
      const done = doneByDate.get(zone.date);
      if (done?.has(doneKey(zone.date, zone.kind, zone.tz))) continue;
      // A failed listing is not "not done": the zone is left alone this run.
      if (!done) zone.unfinished = true;
      zones.push(zone);
    }
    result.zones = zones.length;

    // 4. Today's claims for each window, so registrations already notified are not read again.
    const sentByWindow = new Map<string, Set<string> | null>();
    const windowOf = (z: Zone): string => sentPrefix(z.date, 'snow', z.kind);
    await Promise.all(
      [...new Set(zones.filter((z) => !z.unfinished).map(windowOf))].map(async (prefix) => {
        try {
          sentByWindow.set(prefix, new Set((await store.list(prefix)).keys));
        } catch {
          sentByWindow.set(prefix, null);
        }
      }),
    );

    // Each zone's registrations, then a strong read of each one due.
    const reads: { zone: Zone; key: string; reg: { tz: string; app: string; id: string } }[] = [];
    await pool(
      zones.filter((z) => !z.unfinished),
      READ_CONCURRENCY,
      async (zone) => {
        const sent = sentByWindow.get(windowOf(zone));
        if (!sent) {
          zone.unfinished = true;
          return;
        }
        let keys: string[];
        try {
          ({ keys } = await store.list(regZonePrefix(zone.tz)));
        } catch {
          zone.unfinished = true;
          return;
        }
        zone.count = keys.length;
        for (const key of keys) {
          const reg = parseRegKey(key);
          if (!reg) continue;
          if (sent.has(sentKey(zone.date, 'snow', zone.kind, reg.app, reg.id))) continue;
          reads.push({ zone, key, reg });
        }
      },
    );
    // A failed read leaves its zone unfinished, but the zone's other registrations still go.
    await pool(reads, READ_CONCURRENCY, async ({ zone, key, reg }) => {
      if (!budgetLeft()) {
        zone.unfinished = true;
        return;
      }
      let value: unknown;
      try {
        value = await store.get(key);
      } catch {
        zone.unfinished = true;
        return;
      }
      // Deleted since the listing.
      if (value === null) return;
      result.records++;
      const record = readRecord(value, reg);
      if (!record) {
        say(`alerts-run: error: ${who(reg)} in ${reg.tz} is not a registration the run can read`);
        return;
      }
      const seen = Date.parse(record.seenAt ?? '') || Date.parse(record.updatedAt);
      if (now - seen > ALERTS.staleAfterDays * DAY) {
        const forgot = await forgetRegistration(store, record);
        if (forgot === 'deleted') {
          result.deleted++;
          say(`alerts-run: deleted ${who(record)} (not seen for ${ALERTS.staleAfterDays} days)`);
        } else {
          // Refreshed since it was read, or the store failed: the next run reads it again.
          zone.unfinished = true;
        }
        return;
      }
      const prefs = record.alerts.snow;
      if (prefs?.[zone.kind] !== true) return;
      entries.push({
        zone,
        record,
        prefs,
        forced: forceIds.some((p) => record.id.startsWith(p)),
      });
    });
  };

  const pending: Pending[] = [];

  /** Step 5: the notification for one registration from its place's answer, if one is due. */
  const decide = (entry: Entry, body: TodayResponse): void => {
    const { zone, record, prefs, forced } = entry;
    const real = body.snow ? snowAlert(body.snow, zone.kind, prefs, record.name) : null;
    const alert: AlertContent | null =
      real ??
      (forced
        ? {
            ...testAlert(record.name),
            band: 'nosnow',
            relevance: FORCED_RELEVANCE,
            date: zone.kind === 'evening' ? addDays(zone.date, 1) : zone.date,
          }
        : null);
    if (!alert) return;
    if (forced) result.forced++;
    let push: AlertPush;
    try {
      push = alertPush({
        record,
        alert,
        topic: 'snow',
        kind: zone.kind,
        date: alert.date,
        collapseId: collapseId('snow', zone.kind, alert.date),
        expiration: expiresAt(zone.tz, zone.kind, zone.date),
        priority: ALERTS.apnsPriority[zone.kind],
      });
    } catch (err) {
      // A push that cannot go is a bug to fix, not one to retry every 15 minutes.
      say(`alerts-run: error: no push for ${who(record)}: ${errorText(err)}`);
      return;
    }
    const claimKey = sentKey(zone.date, 'snow', zone.kind, record.app, record.id);
    pending.push({ entry, alert, delivery: { record, claimKey, push } });
  };

  /** Steps 4 and 5: each group's answer, once, then each of its registrations decided. */
  const judge = async (): Promise<void> => {
    const groups = new Map<string, Group>();
    for (const entry of entries) {
      const { query, units } = entry.record;
      const key = `${query}&units=${units}`;
      let group = groups.get(key);
      if (!group) {
        const params = new URLSearchParams(query);
        params.set('units', units);
        group = { params, entries: [] };
        groups.set(key, group);
      }
      group.entries.push(entry);
    }
    const list = [...groups.values()];
    const leave = (group: Group): void => {
      for (const e of group.entries) e.zone.unfinished = true;
    };
    const one = async (group: Group): Promise<void> => {
      result.groups++;
      const first = group.entries[0]!.record;
      const named = `${who(first)}${group.entries.length > 1 ? ` and ${group.entries.length - 1} more` : ''}`;
      let answer: Awaited<ReturnType<typeof getToday>>;
      try {
        answer = await getToday(group.params, null, runDeps);
      } catch (err) {
        say(`alerts-run: error: no forecast for ${named}: ${errorText(err)}`);
        leave(group);
        return;
      }
      if (answer.status !== 200) {
        const { error } = answer.body as ApiError & { error: { detail?: string } };
        // A place that no longer exists stays that way; a forecast that failed may not.
        const retry = answer.status >= 500;
        say(
          `alerts-run: error: no forecast for ${named}: ${answer.status} ${error.code}` +
            `${error.detail ? ` (${error.detail})` : ''}${retry ? '' : ', so none today'}`,
        );
        if (retry) leave(group);
        return;
      }
      for (const entry of group.entries) decide(entry, answer.body as TodayResponse);
    };
    let next = 0;
    let running = 0;
    await Promise.all(
      Array.from({ length: ALERTS.fetchConcurrency }, async () => {
        while (next < list.length) {
          if (!budgetLeft()) return;
          // Counting each running group as a fetch keeps the run at or under the cap.
          if (fetched.size + running >= maxFetches) {
            result.stopped ??= 'fetches';
            return;
          }
          const group = list[next++]!;
          running++;
          try {
            await one(group);
          } finally {
            running--;
          }
        }
      }),
    );
    // Groups not started are left, with their zones, for the next run.
    for (const group of list.slice(next)) leave(group);
  };

  /** Step 6: claims, pushes and Apple's answers. */
  const send = async (): Promise<void> => {
    if (pending.length === 0) return;
    const { results } = await sendAlerts({
      store,
      deliveries: pending.map((p) => p.delivery),
      keys,
      now,
      apnsConcurrency: ALERTS.apnsConcurrency,
      quiet: ALERTS.quiet,
      log: say,
      connect: sender,
      dryRun,
      deadline: pushDeadline,
      clock,
    });
    results.forEach(({ outcome }, i) => {
      const { entry, alert } = pending[i]!;
      if (!deliveryFinished(outcome)) entry.zone.unfinished = true;
      if (outcome === 'sent') result.sent++;
      if (outcome === 'logged') result.logged++;
      if (outcome === 'deleted') result.deleted++;
      const { record, zone } = entry;
      result.notifications.push({
        app: record.app,
        id: record.id,
        tz: zone.tz,
        kind: zone.kind,
        units: record.units,
        date: alert.date,
        name: record.name,
        title: alert.title,
        body: alert.body,
        forced: entry.forced,
        outcome,
      });
    });
  };

  /** Step 7: each zone whose every due registration is finished with, marked done for the day. */
  const markDone = async (): Promise<void> => {
    await pool(
      zones.filter((z) => !z.unfinished),
      READ_CONCURRENCY,
      async (zone) => {
        try {
          await store.set(doneKey(zone.date, zone.kind, zone.tz), {
            at: at.toISOString(),
            count: zone.count,
          });
          result.done++;
        } catch {
          // The next run finds nothing left to send and tries the marker again.
        }
      },
    );
  };

  /**
   * Step 8: once a day, in the 03:00 UTC hour, the `sent/`, `done/` and `test/` keys more than
   * 2 days old. Its marker is claimed first, so one run cleans; a cleanup cut short or failed
   * releases it, so the next run in the hour carries on.
   */
  const clean = async (): Promise<void> => {
    if (at.getUTCHours() !== CLEANUP_HOUR) return;
    const today = at.toISOString().slice(0, 10);
    const marker = cleanupKey(today);
    try {
      if (!(await store.set(marker, { at: at.toISOString() }, { onlyIfNew: true }))) return;
    } catch {
      return;
    }
    const cutoff = addDays(today, -KEEP_DAYS);
    const old: string[] = [];
    let complete = true;
    try {
      for (const prefix of [SENT_PREFIX, DONE_PREFIX]) {
        const { directories } = await store.list(prefix, { directories: true });
        for (const dir of directories) {
          const date = dir.slice(prefix.length);
          if (DATE.test(date) && date < cutoff) old.push(...(await store.list(`${dir}/`)).keys);
        }
      }
      // test/v1/<id>/<yyyy-mm-ddThh>.<slot>
      for (const key of (await store.list(TEST_PREFIX)).keys) {
        const date = key.slice(key.lastIndexOf('/') + 1, key.lastIndexOf('/') + 11);
        if (DATE.test(date) && date < cutoff) old.push(key);
      }
    } catch {
      complete = false;
    }
    let deleted = 0;
    await pool(old, CLEANUP_CONCURRENCY, async (key) => {
      if (clock() >= pushDeadline) {
        complete = false;
        return;
      }
      try {
        await store.delete(key);
        deleted++;
      } catch {
        complete = false;
      }
    });
    result.cleaned = deleted;
    if (!complete) {
      try {
        await store.delete(marker);
      } catch {
        // Tomorrow's cleanup takes what is left.
      }
    }
  };

  await gather();
  await judge();
  await send();
  await markDone();
  await clean();
  result.fetches = fetched.size;
  result.ms = clock() - started;
  return result;
}

/** The run's one line: zones, records, groups, fetches, sent, deleted and errors, then notes. */
export function runSummary(r: RunAlertsResult): string {
  const counts = [
    `zones ${r.zones}`,
    `records ${r.records}`,
    `groups ${r.groups}`,
    `fetches ${r.fetches}`,
    `sent ${r.sent}`,
    `deleted ${r.deleted}`,
    `errors ${r.errors}`,
  ];
  const notes: string[] = [];
  if (r.dryRun) notes.push(`dry run, ${r.logged} logged`);
  if (r.forced) notes.push(`${r.forced} forced`);
  const left = r.zones - r.done;
  if (left > 0) {
    const why =
      r.stopped === 'budget'
        ? ' (out of time)'
        : r.stopped === 'fetches'
          ? ` (fetch cap ${r.maxFetches})`
          : '';
    notes.push(`${left} ${left === 1 ? 'zone' : 'zones'} left for the next run${why}`);
  }
  if (r.cleaned !== null) notes.push(`cleanup deleted ${r.cleaned} old keys`);
  notes.push(`${r.ms} ms`);
  return `alerts-run: ${counts.join(', ')}; ${notes.join('; ')}`;
}

/**
 * Whether notifications are only logged, not sent (ALERTS_DRY_RUN, section 8.6). One rule for the
 * run and the test endpoint: nothing is sent unless ALERTS_DRY_RUN is `false` (trimmed, any case),
 * so unset is dry everywhere. The run also sends only in production, whatever the setting; a test
 * send follows the setting in every context, so a deploy preview with it `false` can check the
 * whole path to Apple with a made-up device, and nothing a preview's run reads ever reaches a phone.
 */
export function alertsDryRun(
  env: EnvGetter,
  deployContext: string | undefined,
  sender: 'run' | 'test',
): boolean {
  if (env('ALERTS_DRY_RUN')?.trim().toLowerCase() !== 'false') return true;
  return sender === 'run' && deployContext !== 'production';
}

/** ALERTS_FORCE_IDS: comma-separated id prefixes, 8 to 32 hex characters each. */
export function forceIdsFrom(setting: string | undefined): { ids: string[]; ignored: number } {
  const entries = (setting ?? '').split(/[\s,]+/).filter(Boolean);
  const ids = entries.map((e) => e.toLowerCase()).filter((e) => /^[0-9a-f]{8,32}$/.test(e));
  return { ids, ignored: entries.length - ids.length };
}

export interface AlertsRunInput {
  env: EnvGetter;
  /** Netlify deploy context: "production", "deploy-preview", "branch-deploy" or "dev". */
  deployContext: string | undefined;
  now: number;
  /** Where every push goes instead of Apple, the smoke's and the run's; tests point it at a fake. */
  origin?: string;
  /** Each line the run logs as it goes (deletions, errors, a dry run's notifications). */
  log?: (line: string) => void;
  /** Keeps the forecast cache's writes alive after the run returns. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Tests: the store and the forecasts in place of Netlify's, and the budget's clock. */
  store?: AlertStore;
  deps?: ServerDeps;
  clock?: () => number;
}

/**
 * The scheduled function's run, every 15 minutes: the switches (section 8.6), then `runAlerts`.
 * Returns its one line. Off unless ALERTS_ENABLED is true; a dry run everywhere but production,
 * and in production until ALERTS_DRY_RUN is false (`alertsDryRun`). On a deploy preview,
 * ALERTS_SMOKE=1 makes the run only send the smoke push (the probe's check that a function reaches
 * Apple); production never smokes, whatever the setting.
 */
export async function alertsRun(input: AlertsRunInput): Promise<string> {
  const { env, deployContext, now } = input;
  const log = input.log ?? ((line: string) => console.log(line));
  const production = deployContext === 'production';
  const where = deployContext ?? 'unknown context';
  const smoke = production ? undefined : env('ALERTS_SMOKE')?.trim();
  if (smoke === '1') {
    const result = await apnsSmoke(env, { now, ...(input.origin ? { origin: input.origin } : {}) });
    return `alerts-run: smoke ${result.ok ? 'passed' : 'failed'}: ${result.line}`;
  }
  // Says why, so a run that does nothing shows what it saw.
  const enabled = env('ALERTS_ENABLED')?.trim();
  if (enabled?.toLowerCase() !== 'true') {
    const why = [`ALERTS_ENABLED ${enabled ? 'is not true' : 'unset'}`];
    if (!production) why.push(`ALERTS_SMOKE ${smoke ? 'is not 1' : 'unset'}`);
    return `alerts-run: disabled (${where}, ${why.join(', ')})`;
  }

  let errors = 0;
  const fault = (line: string): void => {
    errors++;
    log(scrub(line));
  };
  try {
    const dryRun = alertsDryRun(env, deployContext, 'run');
    if (dryRun && !alertsDryRun(env, deployContext, 'test')) {
      log(`alerts-run: ALERTS_DRY_RUN is ignored on ${where}: only production sends`);
    }
    let store: AlertStore;
    try {
      store = input.store ?? createBlobsAlertStore(production);
    } catch (err) {
      return `alerts-run: error: no alert store (${scrub(errorText(err))})`;
    }
    const keys: Partial<Record<ApnsEnv, ApnsKey>> = {};
    for (const which of ['sandbox', 'production'] as const) {
      try {
        const key = apnsKey(env, which);
        if (!('missing' in key)) keys[which] = key;
      } catch (err) {
        // The message never quotes the setting.
        fault(`alerts-run: error: the ${which} key: ${errorText(err)}`);
      }
    }
    const force = forceIdsFrom(env('ALERTS_FORCE_IDS'));
    if (force.ignored) {
      fault(
        `alerts-run: error: ALERTS_FORCE_IDS: ignored ${force.ignored} ` +
          `${force.ignored === 1 ? 'entry' : 'entries'} that ${force.ignored === 1 ? 'is' : 'are'} not 8 to 32 hex characters`,
      );
    }
    const deps =
      input.deps ??
      createDeps({
        env,
        deployContext,
        waitUntil: input.waitUntil,
        log: (message) => log(scrub(`alerts-run: ${message}`)),
      });
    const result = await runAlerts({
      deps,
      store,
      sender: (which) => apnsSender(input.origin ?? APNS_ORIGINS[which], APNS_RUN_TIMEOUT_MS),
      keys,
      now,
      budgetMs: ALERTS.runBudgetMs,
      dryRun,
      forceIds: force.ids,
      log,
      ...(input.clock ? { clock: input.clock } : {}),
    });
    return runSummary({ ...result, errors: result.errors + errors });
  } catch (err) {
    return `alerts-run: error: ${scrub(errorText(err))}`;
  }
}
