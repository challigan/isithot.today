/**
 * The whole client: answers from approximate IP location first, quietly upgrades to device
 * location when permission is already granted, and handles search, units and caching.
 * Vanilla TypeScript; keep it small (the budget is 25 KB gzipped for all site JS).
 */
import {
  CACHE,
  COPY,
  GRID,
  LOADING_PALETTE,
  PALETTES,
  SEARCH,
  SITE_NAME,
  outboundLinks,
  pageTitle,
  question,
  roundToGrid,
  type ApiDay,
  type ApiError,
  type Band,
  type Palette,
  type SearchResponse,
  type SearchResult,
  type TodayResponse,
  type Units,
} from '@isithot/core';
import { GLYPHS, listHtml, pct, stripLayout } from '../lib/view';

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
    };

const KEYS = {
  place: 'isithot:place',
  units: 'isithot:units',
  last: 'isithot:last',
} as const;
const CACHE_VERSION = 2;

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

let units: Units = 'c';
let target: Target = { kind: 'ip' };
let current: TodayResponse | null = null;
let requestSeq = 0;

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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.g1);
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

function renderStrip(day: ApiDay): void {
  const strip = $('strip');
  if (!strip) return;
  const layout = stripLayout(day);
  let band = strip.querySelector<HTMLElement>('.band');
  if (!band) {
    band = document.createElement('div');
    band.className = 'band';
    strip.prepend(band);
  }
  band.style.left = pct(layout.band.left);
  band.style.width = pct(layout.band.width);
  const dots = Array.from(strip.querySelectorAll<HTMLElement>('.dot'));
  while (dots.length < layout.dots.length) {
    const dot = document.createElement('div');
    dot.className = 'dot';
    // Start new dots at the consensus so they slide into place.
    dot.style.left = pct(layout.band.left + layout.band.width / 2);
    strip.append(dot);
    dots.push(dot);
  }
  while (dots.length > layout.dots.length) dots.pop()!.remove();
  // Let freshly added dots get a starting position before moving them.
  requestAnimationFrame(() => {
    layout.dots.forEach((d, i) => {
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
      a.href = `/in/${c.slug}`;
      a.textContent = c.name;
      return i < list.length - 1 ? [a, document.createTextNode(', ')] : [a];
    }),
  );
  nearby.hidden = list.length === 0;
}

function renderUnits(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-units]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.units === units));
  });
}

function render(res: TodayResponse, animate: boolean): void {
  const day = res.days[0];
  if (!day) return renderError();
  const changed =
    current?.days[0]?.answer !== day.answer || current?.location.name !== res.location.name;
  current = res;
  units = res.units;
  setState('ready');
  applyPalette(PALETTES[day.band]);
  const glyph = $('glyph');
  if (glyph) glyph.innerHTML = GLYPHS[day.band];
  setText('place', res.location.name);
  setText('question', mode === 'city' ? question(res.location.name) : COPY.question);
  setText('answer', day.answer);
  if (animate && changed) popAnswer();
  setText('verdict', day.verdict);
  setText('detail', day.detail);
  setText('agree', day.agreementText);
  setText('strip-summary', day.stripSummary);
  setText('smin', `${day.scale.min}°`);
  setText('smax', `${day.scale.max}°`);
  const list = $('list');
  if (list) list.innerHTML = listHtml(day);
  const limited = $('limited');
  if (limited) limited.hidden = !day.limitedText;
  const stale = $('stale');
  if (stale) stale.hidden = !res.stale;
  renderStrip(day);
  renderLinks(res);
  renderUnits();
  document.title =
    mode === 'city'
      ? pageTitle({ city: res.location.name, answer: day.answer, high: day.high })
      : `${day.answer} ${day.verdict} | ${SITE_NAME}`;
}

function renderLoading(): void {
  if (current) return; // Keep showing the previous answer while refreshing.
  setState('loading');
  applyPalette(LOADING_PALETTE);
  setText('answer', COPY.checking);
}

function renderError(): void {
  if (current) return; // A stale answer beats an error.
  setState('error');
  applyPalette(LOADING_PALETTE);
  const glyph = $('glyph');
  if (glyph) glyph.innerHTML = '';
  setText('answer', COPY.unavailable);
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
    p.set('source', t.source);
  }
  if (u) p.set('units', u);
  const qs = p.toString();
  return `/api/v1/today${qs ? `?${qs}` : ''}`;
}

function saveLast(res: TodayResponse): void {
  if (mode !== 'home' || preview) return;
  const main = $('main');
  const day = res.days[0];
  if (!main || !day) return;
  storage.set(KEYS.last, {
    v: CACHE_VERSION,
    savedAt: Date.now(),
    key: targetKey(target),
    palette: PALETTES[day.band],
    html: main.innerHTML,
    place: res.location.name,
    title: document.title,
  });
}

async function load(
  t: Target,
  opts: { animate?: boolean; quiet?: boolean } = {},
): Promise<boolean> {
  const seq = ++requestSeq;
  if (!opts.quiet) renderLoading();
  const preferred = storage.get<Units>(KEYS.units);
  try {
    const res = await fetch(apiUrl(t, preferred ?? (t.kind === 'ip' ? null : units)), {
      headers: { accept: 'application/json' },
    });
    const body = (await res.json()) as TodayResponse | ApiError;
    if (seq !== requestSeq) return false; // A newer request won.
    if (!res.ok || 'error' in body)
      throw new Error('error' in body ? body.error.code : String(res.status));
    target = t;
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
      if (location.search) history.replaceState(null, '', '/');
      await load(t, { quiet: !!current });
    } else {
      location.href = '/';
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

function openSearch(): void {
  const dialog = $<HTMLDialogElement>('search');
  const input = $<HTMLInputElement>('search-input');
  if (!dialog || !input) return;
  if (!dialog.open) dialog.showModal();
  input.focus();
  input.select();
}

function resultsList(): HTMLElement | null {
  return $('search-results');
}

function showResults(items: Node[]): void {
  const list = resultsList();
  const first = list?.firstElementChild; // The "Use my location" row stays.
  if (!list || !first) return;
  list.replaceChildren(first, ...items);
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
  $<HTMLDialogElement>('search')?.close();
  if (r.slug) {
    rememberPlace({ kind: 'city', slug: r.slug, name: r.name });
    location.href = `/in/${r.slug}`;
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
  };
  rememberPlace(t);
  setNote('none');
  const url = `/?${new URLSearchParams({ lat: String(t.lat), lon: String(t.lon), name: r.name })}`;
  if (mode === 'home') {
    history.pushState(null, '', url);
    void load(t);
  } else {
    location.href = url;
  }
}

function wireSearch(): void {
  $('place-btn')?.addEventListener('click', openSearch);
  $('search-input')?.addEventListener('input', onSearchInput);
  $('use-location')?.addEventListener('click', () => {
    $<HTMLDialogElement>('search')?.close();
    void useDeviceLocation(true);
  });
  const dialog = $<HTMLDialogElement>('search');
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // Backdrop click.
  });
  dialog?.querySelector('form')?.addEventListener('submit', (e) => {
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === 'close') return;
    e.preventDefault();
    if (lastResults[0]) choose(lastResults[0]);
  });
}

// ---- Units --------------------------------------------------------------------

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

// ---- Preview (dev only, ?preview=1) --------------------------------------------

let previewBand: Band = 'cold';

async function showPreview(): Promise<void> {
  const { previewResponse, PREVIEW_BANDS, BAND_LABELS } = await import('@isithot/core/preview');
  const holder = $('preview');
  if (holder && holder.hidden) {
    holder.hidden = false;
    const label = document.createElement('p');
    label.className = 'preview-label';
    label.textContent = `${COPY.previewLabel} (${COPY.previewNote.toLowerCase()})`;
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', COPY.previewLabel);
    for (const band of PREVIEW_BANDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.band = band;
      b.textContent = BAND_LABELS[band];
      b.addEventListener('click', () => {
        previewBand = band;
        void showPreview();
      });
      chips.append(b);
    }
    holder.append(label, chips);
  }
  holder?.querySelectorAll<HTMLButtonElement>('[data-band]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.band === previewBand));
  });
  render(previewResponse(previewBand, units), true);
}

// ---- Start --------------------------------------------------------------------

function initialTarget(): Target {
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (params.has('lat') && params.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)) {
    return {
      kind: 'coords',
      source: 'search',
      lat: roundToGrid(lat, GRID.forecast),
      lon: roundToGrid(lon, GRID.forecast),
      name: params.get('name') ?? undefined,
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
  units = storage.get<Units>(KEYS.units) ?? units;
  wireSearch();
  wireUnits();
  $('retry')?.addEventListener('click', () => void load(target));
  window.addEventListener('popstate', () => {
    if (mode === 'home') void load(initialTarget());
  });

  if (preview) {
    const band = params.get('band');
    if (band && band in PALETTES) previewBand = band as Band;
    void showPreview();
    return;
  }

  if (mode === 'city') {
    const slug = app.dataset.slug ?? '';
    target = { kind: 'city', slug };
    const data = initialCity();
    if (data) {
      current = data;
      const preferred = storage.get<Units>(KEYS.units);
      units = data.units;
      renderUnits();
      if (preferred && preferred !== data.units) void load(target, { quiet: true, animate: false });
    } else {
      void load(target);
    }
    return;
  }

  const t = initialTarget();
  target = t;
  const restored = app.dataset.restored === '1';
  const cached = storage.get<{ key: string; savedAt: number }>(KEYS.last);
  const fresh =
    restored &&
    cached &&
    cached.key === targetKey(t) &&
    Date.now() - cached.savedAt < CACHE.localAnswerMaxAgeMs;
  if (!fresh && restored) {
    // The instant paint was for a different place; start clean.
    app.dataset.restored = '';
    setState('loading');
  }
  void load(t, { quiet: !!fresh, animate: !fresh }).then(() => upgradeLocation());
}
