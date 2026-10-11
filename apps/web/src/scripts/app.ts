/**
 * The whole client: answers from approximate IP location first, quietly upgrades to device
 * location when permission is already granted, and handles search, units, the Hot | Wet | Snow
 * toggle and caching. Vanilla TypeScript; keep it small (the budget is 25 KB gzipped for all site
 * JS).
 */
import {
  CACHE,
  COPY,
  GRID,
  LOADING_PALETTE,
  SEARCH,
  SITES,
  UNITS_LABELS,
  UNIT_NAMES,
  VIEWS,
  computeNow,
  computeRainNow,
  computeSnowNow,
  defaultView,
  formatNow,
  formatRainNow,
  formatSnowNow,
  hostTopic,
  isSiteHost,
  outboundLinks,
  parseTopic,
  question,
  roundToGrid,
  showsTomorrow,
  sitePath,
  topicOfBand,
  viewDisplay,
  viewLabel,
  type AnyBand,
  type ApiError,
  type ApiNow,
  type ApiRainNow,
  type ApiSnowNow,
  type DisplayFor,
  type NowDisplay,
  type Palette,
  type SearchResponse,
  type SearchResult,
  type TodayDisplay,
  type TodayModels,
  type TodayResponse,
  type Topic,
  type Units,
  type UvDisplay,
  type View,
  type ViewDisplay,
  type WeekDisplay,
} from '@isithot/core';
// Types only: the preview module itself loads on demand, and only with ?preview=1.
import type * as PreviewKit from '@isithot/core/preview';
import { CITY_TITLES, HOURLY, TOPIC_DAYS, lastKey } from '../lib/topics';
import { glyphFor, hoursHtml, listHtml, pct, uvHtml, weekHtml } from '../lib/view';
import { wireViews, type ViewsController } from './views';

declare global {
  interface Window {
    /** Started by an inline script in the page head; see pages/index.astro. */
    __isithotPrefetch?: { url: string; response: Promise<Response> };
  }
}

// ---- Types and storage ------------------------------------------------------

type Target =
  | { kind: 'ip' }
  | { kind: 'city'; slug: string; name?: string }
  | {
      kind: 'coords';
      source: 'device' | 'search';
      lat: number;
      lon: number;
      name?: string | undefined;
      region?: string | null | undefined;
      country?: string | null | undefined;
      geonameId?: number | undefined;
      /** A searched place's height, whole metres, when the search knew it. */
      elevation?: number | undefined;
    };

/**
 * The place and units, shared by every question (°C goes with millimetres and centimetres, °F
 * with inches). Each domain keeps its own storage, so a link or move to another one carries the
 * place and units in the address, and the page there stores them (`siteLink`, `start`). Each
 * site's last answer, for the instant repaint, is under `lastKey` (HomePage.astro reads the same
 * keys).
 */
const KEYS = {
  place: 'isithot:place',
  units: 'isithot:units',
} as const;

const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private mode or storage full: remembering is a nicety.
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};

// ---- DOM ----------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const app = $('app')!;
const mode = app.dataset.mode === 'city' ? 'city' : 'home';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const preview = params.get('preview') === '1';
/** The page's own question (its site's), which it opens on and goes back to. */
const pageTopic: Topic = parseTopic(app.dataset.topic);
/** The question on screen: the Hot | Wet | Snow toggle changes it. */
let topic: Topic = pageTopic;

let units: Units = 'c';
let view: View = 'today';
/**
 * The middle view answers for tomorrow (from 6pm at the place, core `showsTomorrow`). Read from
 * the page first: a city page or a restored snapshot may already show it.
 */
let tomorrow = $('view-today')?.hasAttribute('data-tomorrow') ?? false;
let views: ViewsController | null = null;
let target: Target = { kind: 'ip' };
let current: TodayResponse | null = null;
/** The Now view as last shown, worked out for the current minute (each topic's). */
let nowShown: ApiNow | null = null;
let rainNowShown: ApiRainNow | null = null;
let snowNowShown: ApiSnowNow | null = null;
/** When the current answer arrived (client clock), for refreshing after a long absence. */
let loadedAt = 0;
let requestSeq = 0;

/** Refresh the answer when the page comes back after this long. */
const REFRESH_AFTER_MS = 30 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function setState(state: 'loading' | 'ready' | 'error'): void {
  app.dataset.state = state;
  const retry = $('retry');
  if (retry) retry.hidden = state !== 'error';
}

function applyPalette(p: Palette): void {
  const s = document.documentElement.style;
  s.setProperty('--g1', p.g1);
  s.setProperty('--g2', p.g2);
  s.setProperty('--g3', p.g3);
  s.setProperty('--ink', p.ink);
  s.setProperty('--pill', p.pill);
  s.setProperty('--glow', p.glow);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.g1);
}

/** What a view shows for an answer (core `viewDisplay`), with "now" for this minute. */
function shown<V extends View>(res: TodayResponse, v: V): DisplayFor<V> {
  return viewDisplay(res, topic, v, 'ready', {
    city: mode === 'city' ? res.location.name : null,
    tomorrow,
    now: nowShown,
    rainNow: rainNowShown,
    snowNow: snowNowShown,
  });
}

/**
 * Whether the middle view shows tomorrow, worked out for this minute at the place, with its tab
 * labelled to match. Returns true when that changed. The preview always shows today.
 */
function updateSlot(res: TodayResponse | null): boolean {
  const next = !preview && showsTomorrow(res, Date.now());
  const changed = next !== tomorrow;
  tomorrow = next;
  setText('tab-today', viewLabel('today', next));
  $('view-today')?.toggleAttribute('data-tomorrow', next);
  return changed;
}

/**
 * Once the place is known, open on its view for the time of day (Now in the evening), unless
 * the visitor has already moved. Only the first time: a refetch or the minute tick never moves
 * anyone (at 6pm an open Today simply becomes Tomorrow in place).
 */
let started = false;
function openOnDefault(res: TodayResponse): void {
  if (started || preview) return;
  started = true;
  const next = defaultView(res, Date.now());
  if (!views || views.moved() || views.active() === next) return;
  view = next; // So the page takes its colours without the quick switch between views.
  views.go(next, { instant: true });
}

/** The city a city page asks about, with or without an answer. */
function cityName(): string | null {
  if (mode !== 'city') return null;
  return current?.location.name ?? $('place')?.textContent?.trim() ?? null;
}

/**
 * The page takes the colours of the view on screen. Switching views is quicker than the slow
 * fade used when an answer arrives, and the text colour flips halfway through, so text never
 * fades through a mid-tone on a mid-tone.
 */
function applyViewPalette(switching = false): void {
  const root = document.documentElement;
  if (switching) {
    root.dataset.switching = '';
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => delete root.dataset.switching, 450);
  }
  applyPalette(current ? shown(current, view).palette : LOADING_PALETTE);
}
let switchTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Screen readers hear the answer of the view they move to (once it settles), or after a switch
 * between Hot, Wet and Snow, the new question and its answer.
 */
let announceTimer: ReturnType<typeof setTimeout> | undefined;
function announce(v: View, lead: 'view' | 'question' = 'view'): void {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const panel = $(`view-${v}`);
    const live = $('view-live');
    if (!panel || !live) return;
    const text = (sel: string): string => panel.querySelector(sel)?.textContent?.trim() ?? '';
    // Placeholder and out-of-date text stays in the page while hidden: never read it out.
    const shown =
      app.dataset.state === 'ready' &&
      !panel.hasAttribute('data-empty') &&
      !panel.hasAttribute('data-pending');
    const first = lead === 'question' ? text('.question') : `${viewLabel(v, tomorrow)}:`;
    live.textContent = `${first} ${text('.answer')} ${shown ? text('.verdict') : ''}`.trim();
  }, 400);
}

/**
 * Today's answer is a live region of its own, for an answer arriving. A topic switch rewrites it
 * and is announced once instead, so it is quiet until the switch has been rendered.
 */
let hushTimer: ReturnType<typeof setTimeout> | undefined;
function hushLive(): void {
  const live = $('live');
  if (!live) return;
  live.setAttribute('aria-live', 'off');
  clearTimeout(hushTimer);
  hushTimer = setTimeout(() => live.setAttribute('aria-live', 'polite'), 300);
}

function setText(id: string, text: string): void {
  const el = $(id);
  if (el && el.textContent !== text) el.textContent = text;
}

function popAnswer(): void {
  const el = $('answer');
  if (!el || reduceMotion) return;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

/** Each view's nodes: Today's ids are bare ("answer"), the others' prefixed ("now-answer"). */
const viewId = (v: View, name: string): string => (v === 'today' ? name : `${v}-${name}`);

/** What every view has: its band, icon, question and answer lines. */
function renderPanel(d: ViewDisplay): void {
  const panel = $(`view-${d.view}`);
  if (panel) {
    // A restored snapshot hides an out-of-date "now" until it has been worked out again.
    panel.removeAttribute('data-pending');
    panel.dataset.band = d.band ?? '';
    panel.toggleAttribute('data-empty', d.empty);
  }
  // Only a new band redraws the icon, so its animation does not restart every minute.
  const glyph = $(viewId(d.view, 'glyph'));
  const band = d.band ?? '';
  if (glyph && glyph.dataset.glyph !== band) {
    glyph.innerHTML = glyphFor(d.band);
    glyph.dataset.glyph = band;
  }
  for (const key of ['question', 'answer', 'verdict', 'detail'] as const) {
    setText(viewId(d.view, key), d[key]);
  }
  // "Maybe.", "Partly.", "Almost." are sized to fit; "Yes." and "No." keep the full size.
  $(viewId(d.view, 'answer'))?.toggleAttribute('data-long', d.answer.length > 4);
}

/** The models strip moves to its new positions rather than being redrawn. */
function renderStrip(m: TodayModels): void {
  const strip = $('strip');
  if (!strip) return;
  let zone = strip.querySelector<HTMLElement>('.band');
  if (m.zone) {
    if (!zone) {
      zone = document.createElement('div');
      zone.className = 'band';
      strip.prepend(zone);
    }
    zone.style.left = pct(m.zone.left);
    zone.style.width = pct(m.zone.width);
  } else {
    zone?.remove();
  }
  const dots = Array.from(strip.querySelectorAll<HTMLElement>('.dot'));
  while (dots.length < m.dots.length) {
    const dot = document.createElement('div');
    dot.className = 'dot';
    // Start new dots at the consensus so they slide into place.
    dot.style.left = pct(m.origin);
    strip.append(dot);
    dots.push(dot);
  }
  while (dots.length > m.dots.length) dots.pop()!.remove();
  // Let freshly added dots get a starting position before moving them.
  requestAnimationFrame(() => {
    m.dots.forEach((d, i) => {
      const dot = dots[i]!;
      dot.style.left = pct(d.left);
      dot.classList.toggle('out', d.out);
      dot.title = d.title;
    });
  });
}

function renderLinks(res: TodayResponse): void {
  outboundLinks(res.location).forEach((link, i) => {
    const a = $<HTMLAnchorElement>(`out-${i}`);
    if (a) a.href = link.url;
  });
  const nearby = $('nearby');
  const holder = $('nearby-links');
  if (!nearby || !holder) return;
  const list = res.nearby ?? [];
  holder.replaceChildren(
    ...list.flatMap((c, i) => {
      const a = document.createElement('a');
      // To the city's page on the site of the question on screen.
      a.href = siteLink(topic, `/in/${c.slug}`);
      a.textContent = c.name;
      return i < list.length - 1 ? [a, document.createTextNode(', ')] : [a];
    }),
  );
  nearby.hidden = list.length === 0;
}

/** One units setting serves every topic: °C | °F for Hot, mm | in for Wet, cm | in for Snow. */
function renderUnits(): void {
  document.querySelector('.units')?.setAttribute('aria-label', UNITS_LABELS[topic]);
  document.querySelectorAll<HTMLButtonElement>('[data-units]').forEach((b) => {
    const u: Units = b.dataset.units === 'f' ? 'f' : 'c';
    b.setAttribute('aria-pressed', String(u === units));
    if (b.textContent?.trim() !== UNIT_NAMES[topic][u]) b.textContent = UNIT_NAMES[topic][u];
  });
}

/**
 * The tab title answers the question on screen, about today whichever view is showing. City
 * titles are the topic's own (as on its site's city pages); the home page's names the site of
 * the question on screen, as the header does.
 */
function titleFor(res: TodayResponse | null): string {
  const city = cityName();
  const site = SITES[topic].name;
  const day = res && TOPIC_DAYS[topic](res)?.[0];
  if (res && day) {
    return (city && CITY_TITLES[topic](city, res)) || `${day.answer} ${day.verdict} | ${site}`;
  }
  return `${question(city, 'today', topic)} | ${site}`;
}

/**
 * Today's answer to the question on screen (even while the middle view shows tomorrow), to tell
 * whether a new response changes it.
 */
const todayAnswer = (res: TodayResponse | null): string | undefined =>
  res ? TOPIC_DAYS[topic](res)?.[0]?.answer : undefined;

function render(res: TodayResponse, animate: boolean): void {
  if (!res.days[0]) return renderError();
  const changed =
    todayAnswer(current) !== todayAnswer(res) || current?.location.name !== res.location.name;
  current = res;
  units = res.units;
  setState('ready');
  updateSlot(res);
  openOnDefault(res);
  renderNow(res);
  applyViewPalette();
  setText('place', res.location.name);
  renderToday(shown(res, 'today'), animate && changed);
  const stale = $('stale');
  if (stale) stale.hidden = !res.stale;
  renderWeek(shown(res, 'week'));
  renderLinks(res);
  renderUnits();
  renderBrand();
  document.title = titleFor(res);
}

/**
 * The header's site name and link follow the question on screen: on isithot.today with Wet
 * showing it reads isitwet.today and goes there. So does the tab's icon: on the real sites each
 * domain serves its own icons at the root, and elsewhere each site's are under its prefix (/wet,
 * /snow).
 */
function renderBrand(): void {
  const brand = $<HTMLAnchorElement>('brand');
  const [name, tld] = SITES[topic].name.split('.');
  if (brand?.firstChild) {
    brand.firstChild.nodeValue = name!;
    const span = brand.querySelector('span');
    if (span) span.textContent = `.${tld}`;
    const href = siteLink(topic, '/');
    if (brand.getAttribute('href') !== href) brand.setAttribute('href', href);
  }
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((link) => {
    link.dataset.own ??= link.getAttribute('href') ?? '';
    const file = link.dataset.own.split('/').pop()!;
    const href =
      topic === pageTopic ? link.dataset.own : sitePath(topic, `/${file}`, location.hostname);
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  });
}

/** Show another question: the same views, re-rendered in place in that topic. */
function setTopic(next: Topic, opts: { announce?: boolean } = {}): void {
  if (next === topic) return;
  topic = next;
  $('main')?.setAttribute('data-topic', topic);
  hushLive();
  document.querySelectorAll<HTMLButtonElement>('#topic [data-topic]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.topic === topic));
  });
  if (current) render(current, false);
  else renderPending(app.dataset.state === 'error' ? 'error' : 'loading');
  renderUnits();
  applyViewPalette(true);
  if (preview) renderChips();
  if (opts.announce) announce(view, 'question');
}

/**
 * The Now view for this minute. The answer carries a day of blended hourly forecast, so "now"
 * is worked out again here rather than trusting a response that may have sat in a cache.
 */
function nowFor(res: TodayResponse): ApiNow | null {
  if (!res.now || preview) return res.now ?? null;
  const fresh = computeNow(res.now.series, Date.now());
  return fresh ? formatNow(fresh) : null;
}

/** The same for rain: the hour containing this minute, from the hourly series. */
function rainNowFor(res: TodayResponse): ApiRainNow | null {
  const rain = res.rain;
  if (!rain?.now || preview) return rain?.now ?? null;
  const fresh = computeRainNow(rain.now.series, Date.now());
  return fresh ? formatRainNow(fresh, rain.unit) : null;
}

/** And for snow. */
function snowNowFor(res: TodayResponse): ApiSnowNow | null {
  const snow = res.snow;
  if (!snow?.now || preview) return snow?.now ?? null;
  const fresh = computeSnowNow(snow.now.series, Date.now());
  return fresh ? formatSnowNow(fresh, snow.unit) : null;
}

/**
 * When today's rain and snow answers go out of date. Both cover the rest of the day from when
 * they were worked out (the same moment), counting that hour by the minutes left, so they hold
 * until the next forecast hour.
 */
function hourUntil(res: TodayResponse): number | null {
  const from = res.rain?.days[0]?.from;
  if (!from) return null;
  const at = Date.parse(from);
  return (
    res.rain?.now?.series.find((p) => p.time > at)?.time ?? Math.floor(at / HOUR) * HOUR + HOUR
  );
}

/** When today's answer goes out of date: the place's midnight (the next day's first hour). */
function dayUntil(res: TodayResponse): number | null {
  const date = res.days[0]?.date ?? '';
  return res.now?.series.find((p) => p.date > date)?.time ?? null;
}

type Stale = 'day' | 'hour';

/**
 * A clock running fast makes the answer look out of date before the server has a newer one:
 * past the hour today's rain and snow hold for, or past the place's midnight. When a fresh answer
 * is out of date already, it is good until the server reaches that moment: at the latest, as long
 * from now as the server had left when working it out. So a fast clock costs at most one extra
 * request per server hour, and one at midnight.
 */
const holds: Partial<Record<Stale, { until: number; at: number }>> = {};

function hold(res: TodayResponse): void {
  // `made`: when the server worked that part of the answer out.
  const set = (reason: Stale, until: number | null, made = ''): void => {
    const from = Date.parse(made);
    if (until !== null && Date.now() >= until && from < until) {
      holds[reason] = { until, at: Date.now() + until - from };
    }
  };
  set('day', dayUntil(res), res.now?.time);
  set('hour', hourUntil(res), res.rain?.days[0]?.from);
}

/** Whether the clock has passed `until` for `reason` (or the hold on it). */
function past(reason: Stale, until: number): boolean {
  const held = holds[reason];
  return Date.now() >= (held?.until === until ? held.at : until);
}

/**
 * Whether the answer is out of date: past local midnight (today's answer is yesterday's) or
 * past the end of the hourly series it carries ("day"), or past the hour today's rain and snow
 * answers hold for ("hour"). A clock running far behind is not a reason, and one running fast
 * waits for the server (`hold`).
 */
function outOfDate(res: TodayResponse): Stale | null {
  if (preview) return null;
  if (res.now) {
    const series = res.now.series;
    const now = computeNow(series, Date.now());
    const old = now
      ? now.date > (res.days[0]?.date ?? '')
      : Date.now() > (series.at(-1)?.time ?? Infinity);
    const midnight = dayUntil(res);
    if (old && (midnight === null || past('day', midnight))) return 'day';
  }
  const until = hourUntil(res);
  return until !== null && past('hour', until) ? 'hour' : null;
}

/**
 * The Today view: answer lines, then the models strip and list. The answer pops before the
 * strip is touched, so new dots still slide in from the consensus.
 */
function renderToday(d: TodayDisplay, pop: boolean): void {
  renderPanel(d);
  if (pop) popAnswer();
  renderUv(d.view, d.uv);
  const m = d.models;
  setText('agree', m.heading);
  setText('strip-summary', m.summary);
  setText('smin', m.min);
  setText('smax', m.max);
  const list = $('list');
  if (list) list.innerHTML = listHtml(m);
  const limited = $('limited');
  if (limited) limited.hidden = !m.limited;
  renderStrip(m);
}

/** The Now view, worked out again for this minute. Without data for it, it says so instead. */
function renderNow(res: TodayResponse): void {
  nowShown = nowFor(res);
  rainNowShown = rainNowFor(res);
  snowNowShown = snowNowFor(res);
  renderHours(shown(res, 'now'));
}

function renderHours(d: NowDisplay): void {
  renderPanel(d);
  renderUv(d.view, d.uv);
  setText('now-h', d.heading);
  const hours = $('now-hours');
  if (hours) hours.innerHTML = hoursHtml(d.items);
}

/** Today's and Now's UV line (components/UvLine.astro), hidden without one. */
function renderUv(v: View, uv: UvDisplay | null): void {
  const el = $(viewId(v, 'uv'));
  if (el) el.hidden = !uv;
  const line = $(viewId(v, 'uv-line'));
  if (line) line.innerHTML = uvHtml(uv);
}

/** The This week view. */
function renderWeek(d: WeekDisplay): void {
  renderPanel(d);
  setText('week-h', d.heading);
  const days = $('week-days');
  if (days) days.innerHTML = weekHtml(d.items);
}

/**
 * Loading and error states show the same message in every view, asking the question on screen;
 * the rest is placeholder text that stays hidden.
 */
function renderPending(state: 'loading' | 'error'): void {
  // Without an answer there is no place, so no local time: the middle view is Today.
  updateSlot(null);
  const opts = { city: cityName() };
  renderToday(viewDisplay(null, topic, 'today', state, opts), false);
  renderHours(viewDisplay(null, topic, 'now', state, opts));
  renderWeek(viewDisplay(null, topic, 'week', state, opts));
  renderBrand();
  document.title = titleFor(null);
}

function renderLoading(): void {
  if (current) return; // Keep showing the previous answer while refreshing.
  setState('loading');
  applyPalette(LOADING_PALETTE);
  renderPending('loading');
}

function renderError(): void {
  if (current) return; // A stale answer beats an error.
  setState('error');
  applyPalette(LOADING_PALETTE);
  renderPending('error');
}

function setNote(kind: 'none' | 'exact' | 'approximate'): void {
  const note = $('place-note');
  if (!note) return;
  note.replaceChildren();
  note.hidden = kind === 'none';
  if (kind === 'exact') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'linkish';
    b.textContent = COPY.useExactLocation;
    b.addEventListener('click', () => void useDeviceLocation(true));
    note.append(b);
  } else if (kind === 'approximate') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'linkish';
    b.textContent = COPY.change;
    b.addEventListener('click', openSearch);
    note.append(`${COPY.approximate} `, b);
  }
}

// ---- Data ---------------------------------------------------------------------

function targetKey(t: Target): string {
  if (t.kind === 'ip') return 'ip';
  if (t.kind === 'city') return `city:${t.slug}`;
  return `${t.source}:${t.lat},${t.lon}`;
}

function apiUrl(t: Target, u: Units | null): string {
  const p = new URLSearchParams();
  if (t.kind === 'city') p.set('place', t.slug);
  if (t.kind === 'coords') {
    p.set('lat', String(t.lat));
    p.set('lon', String(t.lon));
    if (t.name) p.set('name', t.name);
    if (t.region) p.set('region', t.region);
    if (t.country) p.set('country', t.country);
    if (t.geonameId) p.set('geonameId', String(t.geonameId));
    // The forecast is then for the place's own height (only a searched place has one).
    if (t.elevation !== undefined) p.set('elevation', String(t.elevation));
    p.set('source', t.source);
  }
  if (u) p.set('units', u);
  const qs = p.toString();
  return `/api/v1/today${qs ? `?${qs}` : ''}`;
}

function saveLast(res: TodayResponse): void {
  // Each site's snapshot answers its own question, which the page opens on.
  if (mode !== 'home' || preview || topic !== pageTopic) return;
  const main = $('main');
  if (!main || shown(res, 'today').empty) return;
  // The snapshot reopens on one view alone, as the server sends the page for the time of day:
  // Today, or in the evening Now (with the middle tab reading Tomorrow).
  const start: View = tomorrow ? 'now' : 'today';
  const copy = main.cloneNode(true) as HTMLElement;
  copy.querySelectorAll<HTMLElement>('.view').forEach((panel) => {
    const open = panel.dataset.view === start;
    panel.toggleAttribute('inert', !open);
    panel.toggleAttribute('hidden', !open);
    // Today's answer is the real h1; another start view's answer takes its place.
    const answer = panel.querySelector('.answer');
    if (open && start !== 'today') answer?.setAttribute('aria-level', '1');
    else answer?.removeAttribute('aria-level');
  });
  copy.querySelector<HTMLElement>('#views')?.removeAttribute('style');
  const tabs = copy.querySelector<HTMLElement>('#tabs');
  tabs?.removeAttribute('data-dragging');
  tabs?.setAttribute('style', `--pos:${VIEWS.indexOf(start)}`);
  copy.querySelectorAll<HTMLElement>('[role=tab]').forEach((tab) => {
    const open = tab.dataset.view === start;
    tab.setAttribute('aria-selected', String(open));
    tab.tabIndex = open ? 0 : -1;
  });
  copy.querySelectorAll<HTMLElement>('#topic [data-topic]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.topic === pageTopic));
  });
  copy.querySelector('#live')?.setAttribute('aria-live', 'polite');
  storage.set(lastKey(pageTopic), {
    v: CACHE.snapshotVersion,
    savedAt: Date.now(),
    // Today's rain and snow are for the rest of the day from when they were worked out: not past
    // the hour.
    until: HOURLY[pageTopic] ? (hourUntil(res) ?? undefined) : undefined,
    key: targetKey(target),
    // The inline restore script paints this only for the same slot on the same day at the place.
    tz: res.location.timezone,
    slot: tomorrow ? 'tomorrow' : 'today',
    date: res.days[0]!.date,
    palette: shown(res, start).palette,
    html: copy.innerHTML,
    data: res,
    place: res.location.name,
    title: document.title,
  });
}

async function load(
  t: Target,
  opts: { animate?: boolean; quiet?: boolean; fresh?: boolean } = {},
): Promise<boolean> {
  const seq = ++requestSeq;
  if (!opts.quiet) renderLoading();
  const preferred = storage.get<Units>(KEYS.units);
  const url = apiUrl(t, preferred ?? (t.kind === 'ip' ? null : units));
  // An out-of-date answer (past midnight, or past the hour today's rain and snow hold for) may
  // still be in the browser and CDN caches: ask past them, with a new address each hour.
  const freshUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / HOUR)}`;
  const early = window.__isithotPrefetch?.url === url ? window.__isithotPrefetch : undefined;
  window.__isithotPrefetch = undefined;
  const get = async (r: Promise<Response>) => {
    const res = await r;
    const body = (await res.json()) as TodayResponse | ApiError;
    if (!res.ok || 'error' in body)
      throw new Error('error' in body ? body.error.code : String(res.status));
    return body;
  };
  const ask = (u: string) => get(fetch(u, { headers: { accept: 'application/json' } }));
  try {
    // The page's own early request answers a fresh load too, unless it is out of date as well
    // (a saved answer from an earlier hour usually is not: the request is new).
    let body = await (early ? get(early.response) : ask(opts.fresh ? freshUrl : url));
    if (early && opts.fresh && outOfDate(body)) body = await ask(freshUrl);
    if (seq !== requestSeq) return false; // A newer request won.
    if (opts.fresh) hold(body);
    target = t;
    loadedAt = Date.now();
    render(body, opts.animate ?? true);
    // Wait a frame so the strip has its final positions before snapshotting.
    requestAnimationFrame(() => requestAnimationFrame(() => saveLast(body)));
    return true;
  } catch {
    if (seq === requestSeq && !opts.quiet) renderError();
    return false;
  }
}

// ---- Location -----------------------------------------------------------------

function rememberPlace(t: Target): void {
  if (t.kind === 'ip') storage.remove(KEYS.place);
  else storage.set(KEYS.place, t);
}

/** Whether a link for `t` goes to another domain (only on the real sites). */
const crosses = (t: Topic): boolean =>
  isSiteHost(location.hostname) && hostTopic(location.hostname) !== t;

/**
 * A link to `path` on the site of `t`. Another domain has storage of its own, so a link there
 * carries the units chosen here, which the page there stores.
 */
function siteLink(t: Topic, path: string): string {
  const href = sitePath(t, path, location.hostname);
  const chosen = storage.get<Units>(KEYS.units);
  if (!chosen || !crosses(t)) return href;
  const url = new URL(href);
  url.searchParams.set('units', chosen);
  return url.href;
}

/** Take parameters out of the address once the page has what they carried. */
function dropParams(...names: string[]): void {
  const url = new URL(location.href);
  for (const name of names) url.searchParams.delete(name);
  if (url.href !== location.href) history.replaceState(history.state, '', url.href);
}

function position(prompt: boolean): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          // Rounded to the 0.05° grid before it leaves the browser.
          lat: roundToGrid(p.coords.latitude, GRID.forecast),
          lon: roundToGrid(p.coords.longitude, GRID.forecast),
        }),
      reject,
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: prompt ? 20000 : 10000 },
    );
  });
}

async function permissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}

async function useDeviceLocation(prompted: boolean): Promise<void> {
  if (prompted) setText('place', COPY.locating);
  try {
    const p = await position(prompted);
    const t: Target = { kind: 'coords', source: 'device', ...p };
    rememberPlace(t);
    setNote('none');
    if (mode === 'home') {
      if (location.search)
        history.replaceState(null, '', sitePath(pageTopic, '/', location.hostname));
      await load(t, { quiet: !!current });
    } else {
      // Home, on the site of the question on screen. Another domain has neither this storage
      // nor the permission, so the place goes in the address.
      const query = new URLSearchParams({
        lat: String(p.lat),
        lon: String(p.lon),
        source: 'device',
      });
      location.href = siteLink(topic, crosses(topic) ? `/?${query}` : '/');
    }
  } catch {
    if (current) setText('place', current.location.name);
    if (prompted) {
      // Denied or failed: stay on the approximate location.
      setNote('approximate');
      if (target.kind !== 'ip' && mode === 'home') {
        rememberPlace({ kind: 'ip' });
        await load({ kind: 'ip' }, { quiet: !!current });
      }
    }
  }
}

/** After the first answer: upgrade to device location only if it was already granted. */
async function upgradeLocation(): Promise<void> {
  if (mode !== 'home' || target.kind === 'city') return;
  if (target.kind === 'coords' && target.source === 'search') return;
  const state = await permissionState();
  if (state === 'granted') await useDeviceLocation(false);
  else if (state === 'denied') setNote(target.kind === 'ip' ? 'approximate' : 'none');
  else if ('geolocation' in navigator) setNote(target.kind === 'ip' ? 'exact' : 'none');
}

// ---- Search -------------------------------------------------------------------

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchAbort: AbortController | null = null;
let lastResults: SearchResult[] = [];
/** Set when a choice leaves the page, so closing the picker does not move focus. */
let leaving = false;

function openSearch(): void {
  const dialog = $<HTMLDialogElement>('search');
  const input = $<HTMLInputElement>('search-input');
  if (!dialog || !input) return;
  if (!dialog.open) dialog.showModal();
  input.focus();
  input.select();
}

/** The results section of the picker ("Use my location" has a section of its own above it). */
function showResults(items: Node[]): void {
  $('search-results')?.replaceChildren(...items);
  const body = $('search-body');
  if (body) body.scrollTop = 0;
}

function statusItem(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'status';
  li.textContent = text;
  return li;
}

function resultItem(r: SearchResult): HTMLLIElement {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  const name = document.createElement('span');
  name.textContent = r.name;
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = [r.region, r.countryName ?? r.country].filter(Boolean).join(', ');
  b.append(name, sub);
  b.addEventListener('click', () => choose(r));
  li.append(b);
  return li;
}

async function runSearch(q: string): Promise<void> {
  searchAbort?.abort();
  searchAbort = new AbortController();
  try {
    const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`, {
      signal: searchAbort.signal,
    });
    const body = (await res.json()) as SearchResponse | ApiError;
    if ('error' in body) throw new Error(body.error.code);
    lastResults = body.results;
    showResults(
      body.results.length ? body.results.map(resultItem) : [statusItem(COPY.searchNoResults)],
    );
  } catch (err) {
    if ((err as Error).name !== 'AbortError') showResults([statusItem(COPY.unavailable)]);
  }
}

function onSearchInput(): void {
  const q = $<HTMLInputElement>('search-input')?.value.trim() ?? '';
  clearTimeout(searchTimer);
  lastResults = [];
  if (q.length < SEARCH.minChars) {
    showResults(q.length ? [statusItem(COPY.searchTooShort)] : []);
    return;
  }
  searchTimer = setTimeout(() => void runSearch(q), SEARCH.debounceMs);
}

function choose(r: SearchResult): void {
  // To a city's own page, or from a city page to the home page.
  leaving = !!r.slug || mode !== 'home';
  $<HTMLDialogElement>('search')?.close();
  if (r.slug) {
    rememberPlace({ kind: 'city', slug: r.slug, name: r.name });
    // The city's page on the site of the question on screen.
    location.href = siteLink(topic, `/in/${r.slug}`);
    return;
  }
  const t: Target = {
    kind: 'coords',
    source: 'search',
    lat: roundToGrid(r.lat, GRID.forecast),
    lon: roundToGrid(r.lon, GRID.forecast),
    name: r.name,
    region: r.region,
    country: r.country,
    geonameId: r.geonameId,
    elevation: r.elevation,
  };
  rememberPlace(t);
  setNote('none');
  // The address carries the height too, so a reload or a shared link has the same forecast.
  const query = new URLSearchParams({ lat: String(t.lat), lon: String(t.lon), name: r.name });
  if (r.elevation !== undefined) query.set('elevation', String(r.elevation));
  const path = `/?${query}`;
  if (mode === 'home') {
    history.pushState(null, '', sitePath(pageTopic, path, location.hostname));
    void load(t);
  } else {
    location.href = siteLink(topic, path);
  }
}

/**
 * The picker fills the screen on phones and is a centred card from 640px up. It closes with its
 * Close button, Escape (or the back gesture), a choice, or "Use my location", and from 640px up
 * also with a click on the backdrop around the card: on phones there is no backdrop to click, and
 * a tap that only dismisses the keyboard must never close it.
 */
function wireSearch(): void {
  const dialog = $<HTMLDialogElement>('search');
  $('place-btn')?.addEventListener('click', openSearch);
  $('search-input')?.addEventListener('input', onSearchInput);
  $('use-location')?.addEventListener('click', () => {
    dialog?.close();
    void useDeviceLocation(true);
  });
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog && matchMedia('(min-width: 640px)').matches) dialog.close();
  });
  // Enter (Search on a phone's keyboard) chooses the first result. The search form must not
  // close the dialog itself (method=dialog); Close is in a form of its own and needs no script.
  $('search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (lastResults[0]) choose(lastResults[0]);
  });
  // Back to the place button: a tapped button is not focused on iOS, so the browser's own return
  // would land on the page.
  dialog?.addEventListener('close', () => {
    if (!leaving) $('place-btn')?.focus({ preventScroll: true });
  });
}

// ---- Units and topic -----------------------------------------------------------

function wireUnits(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-units]').forEach((b) => {
    b.addEventListener('click', () => {
      const next = b.dataset.units === 'f' ? 'f' : 'c';
      storage.set(KEYS.units, next);
      if (next === units) return;
      units = next;
      renderUnits();
      if (preview) void showPreview();
      else void load(target, { quiet: true, animate: false });
    });
  });
}

/** Hot | Wet | Snow: the answer already carries all three, so switching never asks the server. */
function wireTopic(): void {
  $('topic')?.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-topic]');
    if (b) setTopic(parseTopic(b.dataset.topic), { announce: true });
  });
}

// ---- Preview (dev only, ?preview=1) --------------------------------------------

let previewBand: AnyBand = 'cold';
let previewKit: typeof PreviewKit | null = null;

async function showPreview(): Promise<void> {
  previewKit ??= await import('@isithot/core/preview');
  render(previewKit.previewResponse(previewBand, units), true);
  renderChips();
}

/** One chip per band of the question on screen; the pressed one is the band Today shows. */
function renderChips(): void {
  const holder = $('preview');
  if (!holder || !previewKit) return;
  const kit = previewKit;
  let chips = holder.querySelector<HTMLElement>('.chips');
  if (!chips) {
    holder.hidden = false;
    const label = document.createElement('p');
    label.className = 'preview-label';
    label.textContent = `${COPY.previewLabel} (${COPY.previewNote.toLowerCase()})`;
    chips = document.createElement('div');
    chips.className = 'chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', COPY.previewLabel);
    holder.append(label, chips);
  }
  if (chips.dataset.bands !== topic) {
    chips.dataset.bands = topic;
    const labels: Record<AnyBand, string> = {
      ...kit.BAND_LABELS,
      ...kit.RAIN_BAND_LABELS,
      ...kit.SNOW_BAND_LABELS,
    };
    const bands: Record<Topic, readonly AnyBand[]> = {
      hot: kit.PREVIEW_BANDS,
      wet: kit.PREVIEW_RAIN_BANDS,
      snow: kit.PREVIEW_SNOW_BANDS,
    };
    chips.replaceChildren(
      ...bands[topic].map((band) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.band = band;
        b.textContent = labels[band];
        b.addEventListener('click', () => {
          previewBand = band;
          void showPreview();
        });
        return b;
      }),
    );
  }
  const band = current && shown(current, 'today').band;
  chips.querySelectorAll<HTMLButtonElement>('[data-band]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.band === band));
  });
}

// ---- Keeping "now" current ------------------------------------------------------

/** When an out-of-date answer last triggered a fetch: at most one every few minutes. */
let lastRefetch = 0;

function refreshNow(): void {
  if (!current) return;
  const old = outOfDate(current);
  if (old && Date.now() - lastRefetch > 5 * 60 * 1000) {
    lastRefetch = Date.now();
    void load(target, { quiet: true, animate: false, fresh: true });
    // Past midnight "now" belongs to the new day's answer; rain's and snow's hours are still good.
    if (old === 'day') return;
  }
  renderNow(current);
  // At 6pm the middle view turns to tomorrow where it is, whichever view is on screen.
  const turned = updateSlot(current);
  if (turned) renderToday(shown(current, 'today'), false);
  if (view === 'now' || (turned && view === 'today')) applyViewPalette();
}

/** Work out "now" again every minute, and fetch afresh after a long time away. */
function wireRefresh(): void {
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshNow();
  }, 60 * 1000);
  let hiddenAt = 0;
  const wake = (): void => {
    if (document.visibilityState !== 'visible') {
      hiddenAt = Date.now();
      return;
    }
    // Back after a long time away: start again on the page's own question, on its view for the
    // time of day (Today, or Now in the evening).
    if (hiddenAt && Date.now() - hiddenAt > REFRESH_AFTER_MS) {
      views?.go(defaultView(preview ? null : current, Date.now()), { instant: true });
      setTopic(pageTopic);
    }
    if (preview || !current) return;
    if (Date.now() - loadedAt > REFRESH_AFTER_MS) {
      lastRefetch = Date.now();
      void load(target, { quiet: true, animate: false, fresh: !!outOfDate(current) });
    } else refreshNow();
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) wake();
  });
}

// ---- Start --------------------------------------------------------------------

/**
 * The place in the address (a shared or chosen place, or a device location carried over from
 * the other domain with source=device), else the remembered one, else approximate IP location.
 */
function initialTarget(): Target {
  const q = new URLSearchParams(location.search);
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  if (q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)) {
    const source = q.get('source') === 'device' ? 'device' : 'search';
    // Only a searched place has a height (the server checks it).
    const height = source === 'search' ? q.get('elevation') : null;
    return {
      kind: 'coords',
      source,
      lat: roundToGrid(lat, GRID.forecast),
      lon: roundToGrid(lon, GRID.forecast),
      name: q.get('name') ?? undefined,
      elevation: height && Number.isFinite(+height) ? +height : undefined,
    };
  }
  return storage.get<Target>(KEYS.place) ?? { kind: 'ip' };
}

function initialCity(): TodayResponse | null {
  try {
    return JSON.parse($('initial')?.textContent ?? 'null') as TodayResponse | null;
  } catch {
    return null;
  }
}

export function start(): void {
  // Units chosen on the other domain arrive in the address (`siteLink`): keep them here too.
  const carried = params.get('units');
  if (carried === 'c' || carried === 'f') storage.set(KEYS.units, carried);
  dropParams('units');
  units = storage.get<Units>(KEYS.units) ?? units;
  views = wireViews({
    onShow: (next) => {
      const switching = next !== view;
      view = next;
      applyViewPalette(switching);
    },
    onSettle: announce,
  });
  // The page may open on Now (in the evening at the place): views.ts reads it from the markup.
  view = views?.active() ?? view;
  wireSearch();
  wireUnits();
  wireTopic();
  wireRefresh();
  $('retry')?.addEventListener('click', () => void load(target));
  window.addEventListener('popstate', () => {
    if (mode === 'home') void load(initialTarget());
  });

  if (preview) {
    // A band opens on its topic with that sample: a hot band on Hot, a rain band on Wet…
    const band = params.get('band') ?? '';
    const bandTopic = topicOfBand(band);
    if (bandTopic) {
      previewBand = band as AnyBand;
      setTopic(bandTopic);
    }
    void showPreview();
    return;
  }

  if (mode === 'city') {
    const slug = app.dataset.slug ?? '';
    target = { kind: 'city', slug };
    const data = initialCity();
    if (data) {
      current = data;
      loadedAt = Date.now();
      units = data.units;
      // The page may have waited in the CDN cache: show "now" for this minute, and the middle
      // view's day for it (the page may have been made before 6pm), opening on its view.
      refreshNow();
      openOnDefault(data);
      const preferred = storage.get<Units>(KEYS.units);
      renderUnits();
      if (preferred && preferred !== data.units) void load(target, { quiet: true, animate: false });
    } else {
      void load(target);
    }
    return;
  }

  const t = initialTarget();
  target = t;
  if (t.kind === 'coords' && params.has('lat')) {
    // A place in the address is the one to remember on this domain (it may have come from the
    // other one). A device location has no place in a shareable address.
    rememberPlace(t);
    if (t.source === 'device') dropParams('lat', 'lon', 'source');
  }
  const restored = app.dataset.restored === '1';
  const cached = storage.get<{ key: string; savedAt: number; data?: TodayResponse }>(
    lastKey(pageTopic),
  );
  const fresh =
    restored &&
    cached &&
    cached.key === targetKey(t) &&
    Date.now() - cached.savedAt < CACHE.localAnswerMaxAgeMs;
  if (fresh && cached.data) {
    // The instant paint is up to three hours old: bring "now" up to date while refreshing.
    current = cached.data;
    loadedAt = cached.savedAt;
  }
  if (!fresh && restored) {
    // The instant paint was for a different place; start clean.
    app.dataset.restored = '';
    setState('loading');
  }
  // An out-of-date paint (past midnight, or rain and snow past their hour) asks past the caches.
  const old = current && outOfDate(current);
  if (current && old !== 'day') {
    renderNow(current);
    // The paint is for this slot of the day (HomePage.astro checks), so this changes nothing
    // unless 6pm passed in between.
    if (updateSlot(current)) renderToday(shown(current, 'today'), false);
    openOnDefault(current);
  }
  if (old) lastRefetch = Date.now();
  void load(t, { quiet: !!fresh, animate: !fresh, fresh: !!old }).then(() => upgradeLocation());
}
