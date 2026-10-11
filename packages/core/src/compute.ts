import { BLEND } from './config';
import { agreement, blend, type Blend, type HourTemps, type ModelDay } from './blend';
import { climateRange, normalForDate, type MonthlyNormals } from './climate';
import {
  ANSWERS,
  COPY,
  TOMORROW_VERDICTS,
  VERDICTS,
  agreementLine,
  anomalyLine,
  detailLine,
  formatHour,
  monthName,
  stripSummary,
} from './copy';
import { verdict, type Verdict } from './verdict';
import { deltaToUnits, round1, roundTemp, toUnits, type Units } from './units';
import { dayUv, formatUvDay, type UvDay } from './uv';
import type { ApiDay } from './types';

/** Everything the providers return for one local day. */
export interface DayData {
  date: string;
  models: ModelDay[];
  hourly: HourTemps[];
}

/** One day's result in °C at full precision, before formatting. */
export interface DayComputation {
  date: string;
  blend: Blend;
  verdict: Verdict;
  /** Normal high for the date, °C, or null without climate normals. */
  normalHigh: number | null;
  /** The day's UV index, when the forecast has one for the day. */
  uv?: UvDay;
}

export function computeDay(day: DayData, normals: MonthlyNormals | null): DayComputation | null {
  const b = blend(day.models, day.hourly);
  if (!b) return null;
  const climate = normals ? climateRange(normals) : null;
  const uv = dayUv(day.hourly);
  return {
    date: day.date,
    blend: b,
    verdict: verdict(b.feelsLike, climate),
    normalHigh: normals ? normalForDate(normals, day.date) : null,
    ...(uv ? { uv } : {}),
  };
}

export function agreementTolerance(units: Units): number {
  return units === 'f' ? BLEND.agreeWithinF : BLEND.agreeWithinC;
}

/**
 * The API response formatter: converts to display units at the edge and builds every copy
 * string from copy.ts. `tomorrow` words the verdict for tomorrow ("It'll be hot."); every other
 * string reads the same for either day.
 */
export function formatDay(day: DayComputation, units: Units, tomorrow = false): ApiDay {
  const b = day.blend;
  const tolerance = agreementTolerance(units);
  const consensus = toUnits(b.high, units);
  const values = b.models.map((m) => toUnits(m.high, units));
  const agreed = agreement(values, consensus, tolerance);

  const high = roundTemp(consensus);
  const feelsLike = roundTemp(toUnits(b.feelsLike, units));
  const peakTime = b.peakHour === null ? null : formatHour(b.peakHour);
  const month = monthName(day.date);

  let normalHigh: number | null = null;
  let anomaly: number | null = null;
  let anomalyText: string | null = null;
  if (day.normalHigh !== null) {
    normalHigh = roundTemp(toUnits(day.normalHigh, units));
    const diff = b.high - day.normalHigh;
    anomaly = roundTemp(deltaToUnits(diff, units));
    anomalyText = anomalyLine(anomaly, Math.abs(roundTemp(diff)) <= 1, month);
  }

  const shown = values.map(roundTemp);
  const min = Math.min(...shown);
  const max = Math.max(...shown);

  const out: ApiDay = {
    date: day.date,
    band: day.verdict.band,
    answer: ANSWERS[day.verdict.band],
    verdict: (tomorrow ? TOMORROW_VERDICTS : VERDICTS)[day.verdict.band],
    high,
    feelsLike,
    peakTime,
    normalHigh,
    anomaly,
    detail: detailLine({ high, feelsLike, peakTime, anomalyText }),
    consensus: {
      value: round1(consensus),
      agree: agreed.count,
      total: b.models.length,
      bandLow: round1(consensus - tolerance),
      bandHigh: round1(consensus + tolerance),
      confidence: b.confidence,
    },
    models: b.models.map((m, i) => ({
      id: m.id,
      name: m.name,
      high: shown[i] as number,
      value: round1(values[i] as number),
      agrees: agreed.agrees[i] as boolean,
    })),
    month,
    agreementText: agreementLine(agreed.count, b.models.length, tolerance),
    limitedText: b.confidence === 'limited' ? COPY.limited : null,
    stripSummary: stripSummary({
      min,
      max,
      agree: agreed.count,
      total: b.models.length,
      consensus: high,
    }),
    scale: { min: min - BLEND.stripPadding, max: max + BLEND.stripPadding },
  };
  if (day.uv) out.uv = formatUvDay(day.uv);
  return out;
}
