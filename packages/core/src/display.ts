/**
 * What each view shows, for both topics, as plain data: the server renders the page from it and
 * the browser updates the same nodes from it, so the two always paint the same thing. Every
 * string is already worded and every position already worked out (in % of its track); the web
 * app only turns this into markup and picks the icon for the band.
 */
import {
  BLEND,
  LOADING_PALETTE,
  paletteFor,
  type Band,
  type Palette,
  type RainBand,
  type Topic,
} from './config';
import { COPY, deg, question, type View } from './copy';
import type { ApiDay, ApiNow, ApiRainDay, ApiRainNow, RainUnit, TodayResponse } from './types';

/** Waiting for the first answer, showing one, or unable to get one. */
export type DisplayState = 'loading' | 'ready' | 'error';

export interface DisplayOptions {
  /** City pages ask about the city by name. */
  city?: string | null;
  /** "Now" worked out again for this minute (`formatNow`), in place of the response's. */
  now?: ApiNow | null;
  /** The same for rain (`formatRainNow`). */
  rainNow?: ApiRainNow | null;
}

interface DisplayBase {
  topic: Topic;
  state: DisplayState;
  /** The band shown, or null without an answer for this view. */
  band: Band | RainBand | null;
  palette: Palette;
  question: string;
  answer: string;
  verdict: string;
  detail: string;
  /** Ready, but this view has nothing to show: the answer says so and the rest is hidden. */
  empty: boolean;
  /** No answer yet (loading or error): the rest is placeholder text that holds the layout. */
  pending: boolean;
}

export interface StripDot {
  left: number;
  out: boolean;
  title: string;
}

export interface ModelItem {
  value: string;
  name: string;
  /** Outside the agreement band (hot), or not agreeing with the answer (wet). */
  out: boolean;
}

/** The Today view's models section. Positions are in % of the strip. */
export interface TodayModels {
  /** "6 of 8 forecasts agree within 2°" / "6 of 8 forecasts expect rain". */
  heading: string;
  /** The strip's accessible summary. */
  summary: string;
  /** The strip's end labels: "12°" / "0mm". */
  min: string;
  max: string;
  /** The highlighted zone: the agreement band (hot) or the wet amounts (wet). */
  zone: { left: number; width: number } | null;
  /** Where dots added later slide in from: the consensus. */
  origin: number;
  dots: StripDot[];
  items: ModelItem[];
  limited: string | null;
}

export interface TodayDisplay extends DisplayBase {
  view: 'today';
  models: TodayModels;
}

export interface NowItem {
  /** "13°" / "60%". */
  value: string;
  /** "3pm". */
  label: string;
  /** What a screen reader hears for the row instead, or null to read it as shown. */
  sr: string | null;
}

export interface NowDisplay extends DisplayBase {
  view: 'now';
  heading: string;
  items: NowItem[];
}

export interface WeekItem {
  /** "Today", "Thu". */
  label: string;
  /** "21°" / "4mm". */
  value: string;
  bandLabel: string;
  /** The dot's position on the week's track in %, or null for a placeholder row. */
  left: number | null;
}

export interface WeekDisplay extends DisplayBase {
  view: 'week';
  heading: string;
  items: WeekItem[];
}

export type ViewDisplay = TodayDisplay | NowDisplay | WeekDisplay;
export type DisplayFor<V extends View> = Extract<ViewDisplay, { view: V }>;

/** A view's answer lines, and what it shows below them. */
interface Parts<T> {
  shown: { band: Band | RainBand; answer: string; verdict: string; detail: string };
  parts: T;
}

const clamp = (v: number): number => Math.min(100, Math.max(0, v));

/** Positions on a track from `lo` to `hi`, in %. */
const track =
  (lo: number, hi: number) =>
  (v: number): number =>
    clamp(((v - lo) / (hi - lo || 1)) * 100);

const amountText = (amount: number, unit: RainUnit): string => `${amount}${unit}`;

/**
 * Text of a typical length that holds each view's layout while there is no answer yet. It is
 * never seen: the page hides it until the answer arrives.
 */
const PLACEHOLDERS: Record<
  Topic,
  {
    verdict: Record<View, string>;
    detail: Record<View, string>;
    agreement: string;
    scale: string;
    model: string;
    hour: string;
    day: string;
    bandLabel: string;
  }
> = {
  hot: {
    verdict: {
      today: "It's warm, not hot.",
      now: "It's warm, not hot.",
      week: 'A warm week, not hot.',
    },
    detail: {
      today: 'High of 00°, feels like 00°. Warmest around 0pm. 0° warmer than usual for September.',
      now: '00° right now, feels like 00°. Rising to 00° by 0pm.',
      week: 'Highs average 00°, feels like 00°. Hottest on Wednesday, 00°. 0° warmer than usual for September.',
    },
    agreement: '0 of 0 forecasts agree within 2°',
    scale: '0°',
    model: '00°',
    hour: '00°',
    day: '00°',
    bandLabel: 'Warm',
  },
  wet: {
    verdict: { today: 'Showers possible.', now: 'Showers around.', week: 'Rain on Thu and Fri.' },
    detail: {
      today: 'About 0mm of rain. Mostly between 0pm and 0pm.',
      now: 'Showers possible now. Rain likely from about 0pm.',
      week: 'About 00mm across the week, most on Friday (0mm). About normal for September.',
    },
    agreement: '0 of 0 forecasts expect rain',
    scale: '0mm',
    model: '0mm',
    hour: '00%',
    day: '0mm',
    bandLabel: 'Showers',
  },
};

const times = <T>(n: number, item: () => T): T[] => Array.from({ length: n }, item);

/** The agreement band around the consensus, and each model's high, on the day's scale. */
function hotModels(day: ApiDay): TodayModels {
  const pos = track(day.scale.min, day.scale.max);
  const left = pos(day.consensus.bandLow);
  const width = pos(day.consensus.bandHigh) - left;
  return {
    heading: day.agreementText,
    summary: day.stripSummary,
    min: deg(day.scale.min),
    max: deg(day.scale.max),
    zone: { left, width },
    origin: left + width / 2,
    dots: day.models.map((m) => ({
      left: pos(m.value),
      out: !m.agrees,
      title: `${m.name} ${deg(m.high)}`,
    })),
    items: day.models.map((m) => ({ value: deg(m.high), name: m.name, out: !m.agrees })),
    limited: day.limitedText,
  };
}

/** The wet zone (from the window's wet amount up), and each model's total, from none. */
function rainModels(day: ApiRainDay, unit: RainUnit): TodayModels {
  const pos = track(day.scale.min, day.scale.max);
  const left = pos(day.threshold);
  return {
    heading: day.agreementText,
    summary: day.stripSummary,
    min: amountText(day.scale.min, unit),
    max: amountText(day.scale.max, unit),
    zone: { left, width: Math.max(0, pos(day.scale.max) - left) },
    origin: pos(day.amount),
    dots: day.models.map((m) => ({
      left: pos(m.value),
      out: !m.agrees,
      title: `${m.name} ${amountText(m.amount, unit)}`,
    })),
    items: day.models.map((m) => ({
      value: amountText(m.amount, unit),
      name: m.name,
      out: !m.agrees,
    })),
    limited: day.limitedText,
  };
}

function todayParts(res: TodayResponse, topic: Topic): Parts<TodayModels> | null {
  if (topic === 'wet') {
    const rain = res.rain;
    const day = rain?.days[0];
    return rain && day ? { shown: day, parts: rainModels(day, rain.unit) } : null;
  }
  const day = res.days[0];
  return day ? { shown: day, parts: hotModels(day) } : null;
}

function nowParts(res: TodayResponse, topic: Topic, opts: DisplayOptions): Parts<NowItem[]> | null {
  if (topic === 'wet') {
    const now = opts.rainNow !== undefined ? opts.rainNow : res.rain?.now;
    return now
      ? {
          shown: now,
          parts: now.hours.map((h) => ({
            value: `${h.chance}%`,
            label: h.label,
            sr: `${h.chance}% chance at ${h.label}`,
          })),
        }
      : null;
  }
  const now = opts.now !== undefined ? opts.now : res.now;
  return now
    ? {
        shown: now,
        parts: now.hours.map((h) => ({ value: deg(h.temperature), label: h.label, sr: null })),
      }
    : null;
}

function weekParts(res: TodayResponse, topic: Topic): Parts<WeekItem[]> | null {
  if (topic === 'wet') {
    const rain = res.rain;
    const week = rain?.week;
    if (!rain || !week) return null;
    // From none to the wettest day.
    const pos = track(0, Math.max(...week.days.map((d) => d.amount)));
    return {
      shown: week,
      parts: week.days.map((d) => ({
        label: d.label,
        value: amountText(d.amount, rain.unit),
        bandLabel: d.bandLabel,
        left: pos(d.amount),
      })),
    };
  }
  const week = res.week;
  if (!week) return null;
  // A little wider than the week's highs, as the Today strip is.
  const highs = week.days.map((d) => d.high);
  const pos = track(
    Math.min(...highs) - BLEND.stripPadding,
    Math.max(...highs) + BLEND.stripPadding,
  );
  return {
    shown: week,
    parts: week.days.map((d) => ({
      label: d.label,
      value: deg(d.high),
      bandLabel: d.bandLabel,
      left: pos(d.high),
    })),
  };
}

/**
 * What one view shows for a topic. `res` is used only when `state` is ready; a view without
 * data (no rain in the response, no "now" for this minute, no week) is then `empty`. Pass "now"
 * worked out for the current minute in `opts`, as the response's may have sat in a cache.
 */
export function viewDisplay<V extends View>(
  res: TodayResponse | null,
  topic: Topic,
  view: V,
  state: DisplayState,
  opts: DisplayOptions = {},
): DisplayFor<V> {
  const live = state === 'ready' ? res : null;
  const pending = state !== 'ready';
  const ph = PLACEHOLDERS[topic];
  let p: Parts<TodayModels | NowItem[] | WeekItem[]> | null;
  let parts: Partial<ViewDisplay>;
  if (view === 'today') {
    const today = live && todayParts(live, topic);
    p = today;
    parts = {
      models: today?.parts ?? {
        heading: pending ? ph.agreement : '',
        summary: '',
        min: pending ? ph.scale : '',
        max: pending ? ph.scale : '',
        zone: null,
        origin: 0,
        dots: [],
        items: pending ? times(8, () => ({ value: ph.model, name: 'Model', out: false })) : [],
        limited: null,
      },
    };
  } else if (view === 'now') {
    const now = live && nowParts(live, topic, opts);
    p = now;
    parts = {
      heading: topic === 'wet' ? COPY.nextHoursRain : COPY.nextHours,
      items:
        now?.parts ?? (pending ? times(6, () => ({ value: ph.hour, label: '0pm', sr: null })) : []),
    };
  } else {
    const week = live && weekParts(live, topic);
    p = week;
    parts = {
      heading: COPY.nextDays,
      items:
        week?.parts ??
        (pending
          ? times(7, () => ({ label: 'Day', value: ph.day, bandLabel: ph.bandLabel, left: null }))
          : []),
    };
  }
  const shown = p?.shown ?? null;
  return {
    view,
    topic,
    state,
    band: shown?.band ?? null,
    palette: shown ? paletteFor(shown.band) : LOADING_PALETTE,
    question: question(opts.city ?? null, view, topic),
    answer:
      shown?.answer ??
      (state === 'error' ? COPY.unavailable : pending ? COPY.checking : COPY.notAvailable),
    verdict: shown?.verdict ?? (pending ? ph.verdict[view] : ''),
    detail: shown?.detail ?? (pending ? ph.detail[view] : ''),
    empty: !pending && !shown,
    pending,
    ...parts,
  } as DisplayFor<V>;
}
