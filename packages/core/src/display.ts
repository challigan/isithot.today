/**
 * What each view shows, for every topic, as plain data: the server renders the page from it and
 * the browser updates the same nodes from it, so the two always paint the same thing. Every
 * string is already worded and every position already worked out (in % of its track); the web
 * app only turns this into markup and picks the icon for the band.
 */
import {
  BLEND,
  LOADING_PALETTE,
  TOMORROW_FROM_HOUR,
  paletteFor,
  type AnyBand,
  type Palette,
  type Topic,
  type UvLevel,
} from './config';
import { COPY, deg, question, uvDayLine, uvNowLine, uvSpoken, type View } from './copy';
import { localDateTime } from './dates';
import type {
  ApiDay,
  ApiNow,
  ApiRain,
  ApiRainDay,
  ApiRainNow,
  ApiSnow,
  ApiSnowNow,
  TodayResponse,
} from './types';

/** Waiting for the first answer, showing one, or unable to get one. */
export type DisplayState = 'loading' | 'ready' | 'error';

export interface DisplayOptions {
  /** City pages ask about the city by name. */
  city?: string | null;
  /**
   * The middle view shows tomorrow (`showsTomorrow`): `days[1]`, `rain.days[1]` and
   * `snow.days[1]`.
   */
  tomorrow?: boolean;
  /** "Now" worked out again for this minute (`formatNow`), in place of the response's. */
  now?: ApiNow | null;
  /** The same for rain (`formatRainNow`). */
  rainNow?: ApiRainNow | null;
  /** The same for snow (`formatSnowNow`). */
  snowNow?: ApiSnowNow | null;
}

interface DisplayBase {
  topic: Topic;
  state: DisplayState;
  /** The band shown, or null without an answer for this view. */
  band: AnyBand | null;
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
  /** Outside the agreement band (hot), or not agreeing with the answer (wet and snow). */
  out: boolean;
}

/** The Today view's models section. Positions are in % of the strip. */
export interface TodayModels {
  /** "6 of 8 forecasts agree within 2°" / "6 of 8 forecasts expect rain" (or snow). */
  heading: string;
  /** The strip's accessible summary. */
  summary: string;
  /** The strip's end labels: "12°" / "0mm" / "0cm". */
  min: string;
  max: string;
  /** The highlighted zone: the agreement band (hot) or the wet or snowy amounts. */
  zone: { left: number; width: number } | null;
  /** Where dots added later slide in from: the consensus. */
  origin: number;
  dots: StripDot[];
  items: ModelItem[];
  limited: string | null;
}

/**
 * The hot Today (or Tomorrow) and Now views' UV line. Absent (null) for wet and snow, without UV
 * data, and when the UV index is 0 (at night, or a polar winter's day), so it never says "UV 0".
 */
export interface UvDisplay {
  level: UvLevel;
  /** "UV 7 · High, highest around 1pm" / "UV 5 · Medium now". */
  text: string;
  /** What a screen reader hears instead: "UV index 7, high, highest around 1pm". */
  sr: string;
}

export interface TodayDisplay extends DisplayBase {
  view: 'today';
  models: TodayModels;
  uv: UvDisplay | null;
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
  uv: UvDisplay | null;
}

export interface WeekItem {
  /** "Today", "Thu". */
  label: string;
  /** "21°" / "4mm" / "4cm". */
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

/** A view's answer lines, what it shows below them, and on the hot views the UV line. */
interface Parts<T> {
  shown: { band: AnyBand; answer: string; verdict: string; detail: string };
  parts: T;
  uv?: UvDisplay | null;
}

/**
 * The wet and snow answers share their shape (a strip of amounts for a day, chances for Now,
 * amounts for the week), so one path draws both. A topic's block in the response, and its "now"
 * worked out for this minute.
 */
type Precip = ApiRain | ApiSnow;
const PRECIP: Record<Exclude<Topic, 'hot'>, (res: TodayResponse) => Precip | undefined> = {
  wet: (res) => res.rain,
  snow: (res) => res.snow,
};
const PRECIP_NOW: Record<
  Exclude<Topic, 'hot'>,
  (opts: DisplayOptions) => ApiRainNow | ApiSnowNow | null | undefined
> = {
  wet: (opts) => opts.rainNow,
  snow: (opts) => opts.snowNow,
};

/** The Now view's list heading for each topic. */
const NOW_HEADINGS: Record<Topic, string> = {
  hot: COPY.nextHours,
  wet: COPY.nextHoursRain,
  snow: COPY.nextHoursSnow,
};

const clamp = (v: number): number => Math.min(100, Math.max(0, v));

/** Positions on a track from `lo` to `hi`, in %. */
const track =
  (lo: number, hi: number) =>
  (v: number): number =>
    clamp(((v - lo) / (hi - lo || 1)) * 100);

const amountText = (amount: number, unit: string): string => `${amount}${unit}`;

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
    /** Today's UV line (hot only: the other topics have none). */
    uv: UvDisplay | null;
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
    uv: { level: 'medium', text: 'UV 0 · Medium, highest around 0pm', sr: '' },
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
    uv: null,
  },
  snow: {
    verdict: { today: 'It might snow.', now: 'Snow showers around.', week: 'Snow on Thu and Fri.' },
    detail: {
      today: 'About 0cm of snow. Mostly between 0pm and 0pm.',
      now: 'Snow possible now. Snow likely from about 0pm.',
      week: 'About 00cm across the week, most on Friday (0cm). About usual for September.',
    },
    agreement: '0 of 0 forecasts expect snow',
    scale: '0cm',
    model: '0cm',
    hour: '00%',
    day: '0cm',
    bandLabel: 'Snow possible',
    uv: null,
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

/** What a wet or snow day's strip needs (ApiSnowDay has the same fields as ApiRainDay). */
type StripDay = Pick<
  ApiRainDay,
  'scale' | 'threshold' | 'amount' | 'agreementText' | 'stripSummary' | 'limitedText'
> & { models: readonly { name: string; amount: number; value: number; agrees: boolean }[] };

/** The wet or snowy zone (from the window's amount up), and each model's total, from none. */
function precipModels(day: StripDay, unit: string): TodayModels {
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

/** Today, or tomorrow (index 1) in the evening. */
function todayParts(res: TodayResponse, topic: Topic, index: number): Parts<TodayModels> | null {
  if (topic !== 'hot') {
    const block = PRECIP[topic](res);
    const day = block?.days[index];
    return block && day ? { shown: day, parts: precipModels(day, block.unit) } : null;
  }
  const day = res.days[index];
  if (!day) return null;
  const uv = day.uv;
  return {
    shown: day,
    parts: hotModels(day),
    uv:
      uv && uv.max > 0
        ? {
            level: uv.level,
            text: uvDayLine(uv.max, uv.level, uv.peak),
            sr: uvSpoken(uv.max, uv.level, uv.peak),
          }
        : null,
  };
}

function nowParts(res: TodayResponse, topic: Topic, opts: DisplayOptions): Parts<NowItem[]> | null {
  if (topic !== 'hot') {
    const fresh = PRECIP_NOW[topic](opts);
    const now = fresh !== undefined ? fresh : PRECIP[topic](res)?.now;
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
  if (!now) return null;
  const uv = now.uv;
  return {
    shown: now,
    parts: now.hours.map((h) => ({ value: deg(h.temperature), label: h.label, sr: null })),
    uv:
      uv && uv.value > 0
        ? {
            level: uv.level,
            text: uvNowLine(uv.value, uv.level),
            sr: uvSpoken(uv.value, uv.level),
          }
        : null,
  };
}

function weekParts(res: TodayResponse, topic: Topic): Parts<WeekItem[]> | null {
  if (topic !== 'hot') {
    const block = PRECIP[topic](res);
    const week = block?.week;
    if (!block || !week) return null;
    // From none to the wettest (or snowiest) day.
    const pos = track(0, Math.max(...week.days.map((d) => d.amount)));
    return {
      shown: week,
      parts: week.days.map((d) => ({
        label: d.label,
        value: amountText(d.amount, block.unit),
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
 * data (no rain or snow in the response, no "now" for this minute, no week) is then `empty`.
 * Pass "now" worked out for the current minute in `opts`, as the response's may have sat in a
 * cache, and `tomorrow` in the evening for the middle view.
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
    const today = live && todayParts(live, topic, opts.tomorrow ? 1 : 0);
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
      uv: today ? (today.uv ?? null) : pending ? ph.uv : null,
    };
  } else if (view === 'now') {
    const now = live && nowParts(live, topic, opts);
    p = now;
    parts = {
      heading: NOW_HEADINGS[topic],
      items:
        now?.parts ?? (pending ? times(6, () => ({ value: ph.hour, label: '0pm', sr: null })) : []),
      // No placeholder: at night, when the page opens on Now, there is no UV line to hold.
      uv: now?.uv ?? null,
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
    question: question(opts.city ?? null, view, topic, opts.tomorrow),
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

/**
 * Whether the middle view answers for tomorrow: from TOMORROW_FROM_HOUR to midnight, local time
 * at the place, when the response is for the place's today and has tomorrow (`days[1]`).
 */
export function showsTomorrow(res: TodayResponse | null, nowMs: number): boolean {
  if (!res?.days[1]) return false;
  const local = localDateTime(res.location.timezone, new Date(nowMs));
  return local.hours >= TOMORROW_FROM_HOUR && local.date === res.days[0]!.date;
}

/** The view a page opens on: Now while the middle view shows tomorrow, else Today. */
export function defaultView(res: TodayResponse | null, nowMs: number): View {
  return showsTomorrow(res, nowMs) ? 'now' : 'today';
}
