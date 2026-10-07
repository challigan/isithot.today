import { BANDS, WEEK, type Band } from './config';
import { climateRange, parseDate, type MonthlyNormals } from './climate';
import {
  ANSWERS,
  BAND_LABELS,
  COPY,
  WEEKDAYS,
  WEEK_VERDICTS,
  anomalyLine,
  monthName,
} from './copy';
import type { DayComputation } from './compute';
import { mean } from './stats';
import { deltaToUnits, roundTemp, toUnits, type Units } from './units';
import { verdict, type Verdict } from './verdict';
import type { ApiWeek } from './types';

/** The "this week" view in °C at full precision, before formatting. */
export interface WeekComputation {
  /** The days averaged, today first. */
  days: DayComputation[];
  /** Mean of the blended daily highs, °C. */
  high: number;
  /** Mean of the blended feels-like highs, °C. */
  feelsLike: number;
  /** Mean normal high over the same dates, °C, or null without climate normals. */
  normalHigh: number | null;
  verdict: Verdict;
  /** The day with the highest blended high (the earlier one on a tie). */
  hottest: DayComputation;
}

/**
 * Averages the daily highs for today and the days after it, then judges the average with the
 * same verdict as a single day. Days with too few models are left out (models drop away
 * towards the end of the week), and without enough days there is no answer.
 */
export function computeWeek(
  all: readonly DayComputation[],
  normals: MonthlyNormals | null,
): WeekComputation | null {
  const days = all.filter((d) => d.blend.models.length >= WEEK.minModels);
  const first = days[0];
  if (!first || days.length < WEEK.minDays) return null;
  const high = mean(days.map((d) => d.blend.high));
  const feelsLike = mean(days.map((d) => d.blend.feelsLike));
  const dayNormals = days.map((d) => d.normalHigh);
  const normalHigh =
    normals && dayNormals.every((n): n is number => n !== null) ? mean(dayNormals) : null;
  let hottest = first;
  for (const d of days) if (d.blend.high > hottest.blend.high) hottest = d;
  return {
    days,
    high,
    feelsLike,
    normalHigh,
    verdict: verdict(feelsLike, normals ? climateRange(normals) : null),
    hottest,
  };
}

const weekday = (date: string): string => WEEKDAYS[new Date(parseDate(date)).getUTCDay()]!;

/** "Thu", or "Today" for the first day. */
export function dayLabel(date: string, today: string): string {
  return date === today ? COPY.today : weekday(date).slice(0, 3);
}

/** "Hottest on Thursday, 28°." / "Hottest today, 28°." */
export function hottestLine(date: string, today: string, high: number): string {
  return date === today ? `Hottest today, ${high}°.` : `Hottest on ${weekday(date)}, ${high}°.`;
}

/** "Thu", "Thu and Fri", "Thu, Fri and Sat". */
export function listDays(dates: readonly string[], today: string): string {
  const names = dates.map((d) => dayLabel(d, today));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]!;
}

const isHot = (band: Band): boolean => BANDS.indexOf(band) >= BANDS.indexOf('hot');

/**
 * The verdict line. An average can hide a short hot spell, so a week that is not hot overall
 * names its hot days: "A mild week, but hot on Thu and Fri."
 */
export function weekVerdict(week: WeekComputation): string {
  const band = week.verdict.band;
  const today = week.days[0]!.date;
  const hot = week.days.filter((d) => isHot(d.verdict.band)).map((d) => d.date);
  if (isHot(band) || hot.length === 0) return WEEK_VERDICTS[band];
  const others = hot.filter((d) => d !== today);
  const when: string[] = [];
  if (hot[0] === today) when.push('today');
  if (others.length > 0) when.push(`on ${listDays(others, today)}`);
  return `A ${BAND_LABELS[band].toLowerCase()} week, but hot ${when.join(' and ')}.`;
}

export function formatWeek(week: WeekComputation, units: Units): ApiWeek {
  const today = week.days[0]!.date;
  const to = week.days[week.days.length - 1]!.date;
  const shown = week.days.map((d) => roundTemp(toUnits(d.blend.high, units)));
  const min = Math.min(...shown);
  const max = Math.max(...shown);
  const high = roundTemp(toUnits(week.high, units));
  const feelsLike = roundTemp(toUnits(week.feelsLike, units));
  const hottestHigh = roundTemp(toUnits(week.hottest.blend.high, units));

  let normalHigh: number | null = null;
  let anomaly: number | null = null;
  let anomalyText: string | null = null;
  if (week.normalHigh !== null) {
    normalHigh = roundTemp(toUnits(week.normalHigh, units));
    const diff = week.high - week.normalHigh;
    anomaly = roundTemp(deltaToUnits(diff, units));
    // A week across two months is compared with normals from both.
    const month = monthName(today) === monthName(to) ? monthName(today) : 'the time of year';
    anomalyText = anomalyLine(anomaly, Math.abs(roundTemp(diff)) <= 1, month);
  }

  const parts = [
    min === max ? `Highs around ${high}°.` : `Highs of ${min}–${max}°, averaging ${high}°.`,
    hottestLine(week.hottest.date, today, hottestHigh),
  ];
  if (anomalyText) parts.push(anomalyText);

  const band = week.verdict.band;
  return {
    from: today,
    to,
    band,
    answer: ANSWERS[band],
    verdict: weekVerdict(week),
    high,
    highs: { min, max },
    feelsLike,
    normalHigh,
    anomaly,
    detail: parts.join(' '),
    hottest: { date: week.hottest.date, high: hottestHigh },
    days: week.days.map((d, i) => ({
      date: d.date,
      label: dayLabel(d.date, today),
      high: shown[i]!,
      band: d.verdict.band,
      bandLabel: BAND_LABELS[d.verdict.band],
    })),
  };
}
