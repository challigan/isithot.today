/**
 * Sample days from the approved prototype, used only by the dev preview chips
 * (`?preview=1`) and visual tests. Never shown as real data.
 */
import {
  BANDS,
  MODELS,
  RAIN,
  RAIN_BANDS,
  SNOW,
  SNOW_BANDS,
  topicOfBand,
  type AnyBand,
  type Band,
  type RainBand,
  type SnowBand,
} from './config';
import { ATTRIBUTION } from './copy';
import { formatDay, type DayComputation, type DayData } from './compute';
import type { MonthlyNormals } from './climate';
import { formatNow, judgeSeries, type NowComputation } from './now';
import { rainUnit } from './rain';
import { computeRainDay, formatRainDay } from './rainDay';
import { computeRainNow, formatRainNow, judgeRainSeries, rainSeries } from './rainNow';
import { computeRainWeek, formatRainWeek } from './rainWeek';
import { snowUnit, snowWater } from './snow';
import { computeSnowDay, formatSnowDay, judgeSnowSeries, snowSeries } from './snowDay';
import { computeSnowNow, formatSnowNow } from './snowNow';
import { computeSnowWeek, formatSnowWeek } from './snowWeek';
import { formatWeek } from './week';
import { mean } from './stats';
import type { ApiRain, ApiSnow, TodayResponse } from './types';
import type { Units } from './units';

interface Sample {
  place: string;
  country: string;
  lat: number;
  lon: number;
  date: string;
  normal: number;
  feels: number;
  peakHour: number;
  temps: number[];
  /** The day's highest UV index and the hour it peaks: every UV level appears in one sample. */
  uv: { max: number; peakHour: number };
}

const SAMPLES: Record<Band, Sample> = {
  freezing: {
    place: 'Edinburgh',
    country: 'GB',
    lat: 55.95,
    lon: -3.2,
    date: '2027-01-15',
    normal: 6,
    feels: -6,
    peakHour: 13,
    temps: [-1, -2, -3, -2, -1, -5],
    uv: { max: 1, peakHour: 12 },
  },
  cold: {
    place: 'Newcastle',
    country: 'GB',
    lat: 54.95,
    lon: -1.6,
    date: '2026-10-15',
    normal: 13,
    feels: 6,
    peakHour: 14,
    temps: [9, 10, 8, 9, 9, 13],
    uv: { max: 2, peakHour: 13 },
  },
  mild: {
    place: 'London',
    country: 'GB',
    lat: 51.5,
    lon: -0.1,
    date: '2027-04-15',
    normal: 14,
    feels: 15,
    peakHour: 15,
    temps: [15, 16, 14, 15, 16, 15],
    uv: { max: 4, peakHour: 13 },
  },
  warm: {
    place: 'Manchester',
    country: 'GB',
    lat: 53.5,
    lon: -2.25,
    date: '2027-06-15',
    normal: 19,
    feels: 23,
    peakHour: 15,
    temps: [22, 23, 21, 22, 23, 19],
    uv: { max: 6, peakHour: 13 },
  },
  hot: {
    place: 'Bristol',
    country: 'GB',
    lat: 51.45,
    lon: -2.6,
    date: '2027-07-15',
    normal: 22,
    feels: 30,
    peakHour: 16,
    temps: [28, 29, 27, 28, 29, 28],
    uv: { max: 8, peakHour: 13 },
  },
  scorching: {
    place: 'Seville',
    country: 'ES',
    lat: 37.4,
    lon: -6,
    date: '2027-08-15',
    normal: 35,
    feels: 43,
    peakHour: 17,
    temps: [41, 42, 40, 41, 37, 41],
    uv: { max: 11, peakHour: 14 },
  },
};

export const PREVIEW_BANDS: readonly Band[] = BANDS;
export const PREVIEW_RAIN_BANDS: readonly RainBand[] = RAIN_BANDS;
export const PREVIEW_SNOW_BANDS: readonly SnowBand[] = SNOW_BANDS;
export { BAND_LABELS, RAIN_BAND_LABELS, SNOW_BAND_LABELS } from './copy';

function hotPreview(band: Band, units: Units): TodayResponse {
  const s = SAMPLES[band];
  const day: DayComputation = {
    date: s.date,
    blend: {
      // The prototype used a plain mean; keep it so previews match the approved design.
      high: mean(s.temps),
      feelsLike: s.feels,
      peakHour: s.peakHour,
      confidence: 'good',
      models: MODELS.slice(0, s.temps.length).map((m, i) => ({
        id: m.id,
        name: m.name,
        high: s.temps[i] as number,
      })),
    },
    verdict: { band, effective: s.feels, climateAdjusted: true },
    normalHigh: s.normal,
    uv: s.uv,
  };
  const timezone = s.country === 'ES' ? 'Europe/Madrid' : 'Europe/London';
  const verdict = { band, effective: s.feels, climateAdjusted: true };

  // Now: mid-morning on the sample day, warming towards the peak.
  const start = Date.parse(`${s.date}T00:00:00Z`);
  const series = Array.from({ length: 36 }, (_, h) => {
    const temperature = day.blend.high - Math.min(8, Math.abs((h % 24) - s.peakHour) * 1.2);
    // UV rises and falls over six hours either side of its peak.
    const fromPeak = ((h % 24) - s.uv.peakHour) / 6;
    return {
      time: start + h * 3_600_000,
      temperature: Math.round(temperature * 10) / 10,
      feelsLike: Math.round((temperature + s.feels - day.blend.high) * 10) / 10,
      uv: s.uv.max * Math.max(0, 1 - fromPeak * fromPeak),
    };
  });
  const judged = judgeSeries(series, null, units, 'UTC').map((p) => ({ ...p, band }));
  const now: NowComputation = {
    time: start + 10.5 * 3_600_000,
    date: s.date,
    temperature: judged[10]!.temperature,
    feelsLike: judged[10]!.feelsLike,
    band,
    uv: judged[10]!.uv!,
    series: judged.slice(10),
  };

  // This week: the sample day and six more like it.
  const offsets = [0, 1, -1, 2, 0, -2, 1];
  const days = offsets.map((o, i) => ({
    ...day,
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    blend: { ...day.blend, high: day.blend.high + o, feelsLike: s.feels + o },
  }));
  const week = formatWeek(
    {
      days,
      high: day.blend.high + mean(offsets),
      feelsLike: s.feels + mean(offsets),
      normalHigh: s.normal,
      verdict,
      hottest: days[3]!,
    },
    units,
  );

  return {
    location: {
      name: s.place,
      region: null,
      country: s.country,
      lat: s.lat,
      lon: s.lon,
      timezone,
      source: 'city',
    },
    units,
    days: [formatDay(day, units)],
    now: formatNow(now),
    week,
    updatedAt: `${s.date}T08:00:00Z`,
    attribution: [...ATTRIBUTION],
  };
}

// ---- Is it wet? -------------------------------------------------------------------

const HOUR = 3_600_000;

/**
 * Rain falling evenly from `from` to `to` (local hours, end exclusive), `mm` in all for a
 * typical model. `models` scales each model's share (0 for a dry model) and `shifts` moves each
 * model's timing by whole hours, so the forecasts disagree a little as real ones do.
 */
interface Spell {
  from: number;
  to: number;
  mm: number;
  models?: readonly number[];
  shifts?: readonly number[];
}

const FACTORS = [1, 1.25, 0.8, 1.1, 0.9, 1.3, 0.7, 1.05];
const SHIFTS = [0, 1, 0, -1, 0, 0, 1, 0];
const STEADY = [0, 0, 0, -1, 0, 0, 0, 0];
/** Two forecasts with a little rain: spots. */
const TWO = [1, 0, 0, 1.2, 0, 0, 0, 0];
/** Three forecasts with rain: showers. */
const THREE = [1, 0, 1.4, 0, 0, 0.8, 0, 0];

const spots = (from: number): Spell => ({ from, to: from + 2, mm: 0.4, models: TWO });
const showers = (from: number, mm = 3): Spell => ({ from, to: from + 4, mm, models: THREE });
const rain = (from: number, to: number, mm: number): Spell => ({ from, to, mm, shifts: STEADY });

/** Seven days of spells, today first; the preview's "now" is 10:30 on the first day. */
const RAIN_SAMPLES: Record<RainBand | 'snow', (readonly Spell[])[]> = {
  dry: [[], [], [], [], [{ from: 15, to: 17, mm: 0.3, models: [1, 0, 0, 0, 0, 0, 0, 0] }], [], []],
  spots: [
    [
      { from: 9, to: 12, mm: 0.36, models: [1, 0, 1, 0, 0, 1, 0, 0], shifts: STEADY },
      { from: 14, to: 16, mm: 0.3, models: [1, 0, 1, 0, 0, 1, 0, 0] },
    ],
    [spots(13)],
    [],
    [spots(7)],
    [],
    [],
    [spots(16)],
  ],
  showers: [
    [{ from: 10, to: 11, mm: 0.4, models: [1, 0, 1, 0, 0, 0, 0, 0] }, showers(13)],
    [spots(9)],
    [showers(15, 4)],
    [],
    [],
    [spots(12)],
    [],
  ],
  rain: [
    [rain(8, 17, 6)],
    [rain(5, 13, 5)],
    [showers(14)],
    [rain(12, 22, 8)],
    [rain(9, 15, 4)],
    [],
    [spots(10)],
  ],
  heavy: [
    [rain(9, 13, 14), rain(13, 20, 6)],
    [rain(10, 16, 5)],
    [rain(4, 12, 6)],
    [rain(11, 23, 12)],
    [showers(14)],
    [rain(6, 10, 3)],
    [],
  ],
  drenched: [
    [rain(9, 12, 27), rain(12, 18, 18)],
    [rain(3, 15, 15)],
    [rain(0, 24, 40)],
    [rain(10, 18, 7)],
    [rain(12, 16, 4)],
    [showers(13)],
    [rain(17, 23, 5)],
  ],
  // Freezing all week, so the rain falls as snow.
  snow: [[rain(8, 16, 6)], [], [spots(11)], [rain(10, 20, 5)], [], [], [spots(14)]],
};

// ---- Will it snow? ----------------------------------------------------------------

/** A spell of snow a few forecasts have, too light for more than flakes. */
const FLAKES: Spell = {
  from: 9,
  to: 12,
  mm: 0.36,
  models: [1, 0, 1, 0, 0, 1, 0, 0],
  shifts: STEADY,
};

/**
 * Seven days of spells for each snow band, shown at the freezing sample's temperatures (so it all
 * falls as snow) or, without snow, the warm sample's. Each band shows in all three views.
 */
const SNOW_SAMPLES: Record<SnowBand, (readonly Spell[])[]> = {
  nosnow: RAIN_SAMPLES.dry,
  flakes: [[FLAKES], [], [spots(13)], [], [], [spots(7)], []],
  maybesnow: [[showers(10, 2)], [spots(9)], [showers(15, 4)], [], [], [spots(12)], []],
  snow: [[rain(8, 16, 4)], [], [spots(11)], [rain(10, 20, 5)], [], [showers(14)], []],
  heavysnow: [
    [rain(9, 17, 12)],
    [rain(10, 16, 5)],
    [rain(4, 12, 6)],
    [rain(11, 23, 12)],
    [showers(14)],
    [rain(6, 10, 3)],
    [],
  ],
  deepsnow: RAIN_SAMPLES.drenched,
};

/** The hot sample shown with each snow band. */
const HOT_FOR_SNOW: Record<SnowBand, Band> = {
  nosnow: 'warm',
  flakes: 'freezing',
  maybesnow: 'freezing',
  snow: 'freezing',
  heavysnow: 'freezing',
  deepsnow: 'freezing',
};

/** Monthly normal rain, mm/day, January first. */
const RAIN_NORMALS: Record<string, MonthlyNormals> = {
  GB: [2.9, 2.3, 2.1, 1.8, 1.7, 1.8, 1.9, 2.1, 2.1, 2.8, 3, 3],
  ES: [2, 1.6, 1.3, 1.6, 0.9, 0.3, 0.1, 0.1, 0.8, 2.1, 2.6, 2.8],
};

/** Monthly normal snowfall, mm/day of water, January first. */
const SNOW_NORMALS: Record<string, MonthlyNormals> = {
  GB: [0.25, 0.25, 0.15, 0.05, 0, 0, 0, 0, 0, 0, 0.05, 0.15],
  ES: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

/** The rain sample shown with each hot band, and the hot sample shown with each rain band. */
const RAIN_FOR_HOT: Record<Band, RainBand | 'snow'> = {
  freezing: 'snow',
  cold: 'rain',
  mild: 'showers',
  warm: 'dry',
  hot: 'dry',
  scorching: 'dry',
};
const HOT_FOR_RAIN: Record<RainBand, Band> = {
  dry: 'warm',
  spots: 'mild',
  showers: 'mild',
  rain: 'cold',
  heavy: 'cold',
  drenched: 'cold',
};

/**
 * The sample's hourly rain for each model, as the providers would give it: snowfall (cm) in the
 * hours at or below the snow line, and each model's daily totals by the shared rule.
 */
function sampleDays(sample: (readonly Spell[])[], s: Sample): DayData[] {
  const start = Date.parse(`${s.date}T00:00:00Z`);
  const high = mean(s.temps);
  return sample.map((spells, d) => {
    const dayStart = start + d * 86_400_000;
    const hourly = Array.from({ length: 24 }, (_, h) => {
      // The same daily curve as the hot sample's "now" series.
      const temp = high - Math.min(8, Math.abs(h - s.peakHour) * 1.2);
      const rain = MODELS.map((_, m) => {
        let mm = 0;
        for (const sp of spells) {
          const shift = (sp.shifts ?? SHIFTS)[m]!;
          if (h >= sp.from + shift && h < sp.to + shift) {
            mm += (sp.mm * (sp.models ?? FACTORS)[m]!) / (sp.to - sp.from);
          }
        }
        return Math.round(mm * 100) / 100;
      });
      return {
        hour: h,
        time: dayStart + h * HOUR,
        temps: MODELS.map(() => temp),
        rain,
        snow: rain.map((mm) => (temp <= RAIN.snowAtOrBelowC ? mm * SNOW.cmPerMm : 0)),
      };
    });
    const water = hourly.map(snowWater);
    return {
      date: new Date(dayStart).toISOString().slice(0, 10),
      models: MODELS.map((m, i) => {
        const snow = water.reduce((a, w) => a + w[i]!, 0);
        return {
          id: m.id,
          name: m.name,
          high: null,
          feelsLike: null,
          rain: hourly.reduce((a, h) => a + h.rain[i]!, 0),
          snow,
          snowfall: snow * SNOW.cmPerMm,
          low: Math.min(...hourly.map((h) => h.temps[i]!)),
        };
      }),
      hourly,
    };
  });
}

/** The rain block, built from sample hourly data by the same code as real forecasts. */
function rainPreview(days: DayData[], s: Sample, units: Units): ApiRain {
  const now = Date.parse(`${s.date}T00:00:00Z`) + 10.5 * HOUR;
  const unit = rainUnit(units);
  const today = computeRainDay(days[0]!, { from: now })!;
  const later = days.slice(1).map((d) => computeRainDay(d)!);
  const series = judgeRainSeries(rainSeries(days), units, 'UTC');
  return {
    unit,
    days: [formatRainDay(today, units), formatRainDay(later[0]!, units)],
    now: formatRainNow(computeRainNow(series, now)!, unit),
    week: formatRainWeek(computeRainWeek([today, ...later], RAIN_NORMALS[s.country]!)!, units),
  };
}

/** The snow block, from the same sample days by the same code as real forecasts. */
function snowPreview(days: DayData[], s: Sample, units: Units): ApiSnow {
  const now = Date.parse(`${s.date}T00:00:00Z`) + 10.5 * HOUR;
  const unit = snowUnit(units);
  const normals = SNOW_NORMALS[s.country]!;
  const today = computeSnowDay(days[0]!, { from: now, normals })!;
  const later = days.slice(1).map((d) => computeSnowDay(d, { normals })!);
  const series = judgeSnowSeries(snowSeries(days), units, 'UTC');
  return {
    unit,
    days: [formatSnowDay(today, units), formatSnowDay(later[0]!, units)],
    now: formatSnowNow(computeSnowNow(series, now)!, unit),
    week: formatSnowWeek(computeSnowWeek([today, ...later])!, units),
  };
}

/**
 * A full sample answer for any band, with all three topics so the toggle works: a rain or snow
 * band comes with a hot sample that suits it (a dry day is warm, a snowy one freezing), and a hot
 * band with a week of rain that suits it. Rain and snow are judged on the same sample days.
 */
export function previewResponse(band: AnyBand, units: Units = 'c'): TodayResponse {
  const topic = topicOfBand(band);
  let hot: Band;
  let spells: (readonly Spell[])[];
  if (topic === 'wet') {
    hot = HOT_FOR_RAIN[band as RainBand];
    spells = RAIN_SAMPLES[band as RainBand];
  } else if (topic === 'snow') {
    hot = HOT_FOR_SNOW[band as SnowBand];
    spells = SNOW_SAMPLES[band as SnowBand];
  } else {
    hot = band as Band;
    spells = RAIN_SAMPLES[RAIN_FOR_HOT[hot]];
  }
  const s = SAMPLES[hot];
  const days = sampleDays(spells, s);
  return {
    ...hotPreview(hot, units),
    rain: rainPreview(days, s, units),
    snow: snowPreview(days, s, units),
  };
}
