/**
 * "Will it snow this week?": today (the rest of it) and the six days after it. One day of snow
 * makes the week a Yes, as the question asks, unlike rain's week.
 */
import { BLEND, SNOW, SNOW_BANDS, WEEK, type SnowBand } from './config';
import { parseDate } from './climate';
import {
  RAIN_COPY,
  SNOW_ANSWERS,
  SNOW_COPY,
  SNOW_WEEK_VERDICTS,
  WEEKDAYS,
  flakesDaysLine,
  monthName,
  possibleDaysLine,
  rainWeekLine,
  snowDaysLine,
  snowLabel,
  snowNormalLine,
  snowyWeekLine,
  whenDays,
  type SnowNormal,
} from './copy';
import { atLeast, median } from './rain';
import { isSnow, roundSnow, snowRank, snowUnit, toSnowUnits } from './snow';
import { lowLine, textDepth, type SnowDayComputation } from './snowDay';
import { isFiniteNumber } from './stats';
import type { Units } from './units';
import { dayLabel, listDays } from './week';
import type { ApiSnowWeek } from './types';

/** The snow "this week" view in cm, before formatting. */
export interface SnowWeekComputation {
  /** Today's date: the first day given, used for "today" in labels and verdicts. */
  today: string;
  /** The usable days, in order. */
  days: SnowDayComputation[];
  /** The median of each model's own total across the days, as for rain, cm, or null. */
  total: number | null;
  /** Normal snowfall over the same days (today scaled by the hours left), cm, or null. */
  normal: number | null;
  /** The days covered, today counting the part of it left. */
  span: number;
  /** Days judged snow or more, and days judged snow possible. */
  snowDays: number;
  maybeDays: number;
  /** The snowiest day and its amount, cm, by the same models as `total`, as rain's wettest. */
  snowiest: { date: string; amount: number };
}

/**
 * Today and the days after it, judged with their own normals (computeSnowDay's `normals`). Days
 * with too few models are left out, and without enough days there is no answer.
 */
export function computeSnowWeek(all: readonly SnowDayComputation[]): SnowWeekComputation | null {
  const days = all.filter((d) => d.models.length >= WEEK.minModels);
  const first = days[0];
  if (!first || days.length < WEEK.minDays) return null;

  // Each model's own amounts, day by day, for the models covering every day.
  const full = first.models.flatMap((m) => {
    const amounts: number[] = [];
    for (const d of days) {
      const own = d.models.find((o) => o.id === m.id);
      if (!own) return [];
      amounts.push(own.total);
    }
    return [amounts];
  });
  const total =
    full.length >= BLEND.minModels ? median(full.map((a) => a.reduce((x, y) => x + y, 0))) : null;

  const weight = (d: SnowDayComputation) => (d.partial ? d.hours / 24 : 1);
  const normals = days.map((d) => d.normal);
  const normal = normals.every(isFiniteNumber)
    ? days.reduce((sum, d, i) => sum + normals[i]! * weight(d), 0)
    : null;

  let snowiest = { date: first.date, amount: Number.NEGATIVE_INFINITY };
  days.forEach((d, i) => {
    const amount = total === null ? d.amount : median(full.map((a) => a[i]!));
    if (amount > snowiest.amount) snowiest = { date: d.date, amount };
  });
  return {
    today: all[0]!.date,
    days,
    total,
    normal,
    span: days.reduce((sum, d) => sum + weight(d), 0),
    snowDays: days.filter((d) => isSnow(d.band)).length,
    maybeDays: days.filter((d) => d.band === 'maybesnow').length,
    snowiest,
  };
}

/** "today", "on Thu and Fri", "today and on Sat" (at most SNOW.week.nameDays days). */
function when(dates: readonly string[], today: string): string {
  const named = dates.slice(0, SNOW.week.nameDays);
  const others = named.filter((d) => d !== today);
  return whenDays(named[0] === today, others.length > 0 ? listDays(others, today) : null);
}

/**
 * The week's band, answer and verdict line: Yes with any day of snow (the snowiest day's band),
 * Maybe with a day where snow is possible, else No.
 */
export function snowWeekVerdict(week: SnowWeekComputation): {
  band: SnowBand;
  answer: string;
  verdict: string;
} {
  const { days, today } = week;
  const snowy = days.filter((d) => isSnow(d.band));
  if (snowy.length > 0) {
    const band = SNOW_BANDS[Math.max(...snowy.map((d) => snowRank(d.band)))]!;
    const heavy = snowy.filter((d) => snowRank(d.band) >= snowRank('heavysnow'));
    if (snowy.length >= SNOW.week.snowyFrom) {
      // The heaviest of the heavy days (the earlier one on a tie), never a lighter snowy day.
      const heaviest = heavy.reduce<SnowDayComputation | null>(
        (a, d) => (a && a.amount >= d.amount ? a : d),
        null,
      );
      return {
        band,
        answer: SNOW_ANSWERS[band],
        verdict: snowyWeekLine(heaviest && when([heaviest.date], today)),
      };
    }
    const heavyWhen =
      heavy.length > 0
        ? when(
            heavy.map((d) => d.date),
            today,
          )
        : null;
    return {
      band,
      answer: SNOW_ANSWERS[band],
      verdict: snowDaysLine(
        when(
          snowy.map((d) => d.date),
          today,
        ),
        heavyWhen,
        heavy.length === snowy.length,
      ),
    };
  }
  const maybe = days.filter((d) => d.band === 'maybesnow').map((d) => d.date);
  if (maybe.length > 0) {
    return {
      band: 'maybesnow',
      answer: SNOW_ANSWERS.maybesnow,
      verdict:
        maybe.length >= SNOW.week.possibleMostFrom
          ? SNOW_WEEK_VERDICTS.possibleMost
          : possibleDaysLine(when(maybe, today)),
    };
  }
  const flakes = days.filter((d) => d.band === 'flakes').map((d) => d.date);
  if (flakes.length > 0) {
    return {
      band: 'flakes',
      answer: SNOW_ANSWERS.flakes,
      verdict: flakesDaysLine(when(flakes, today)),
    };
  }
  return {
    band: 'nosnow',
    answer: SNOW_ANSWERS.nosnow,
    verdict: days.every((d) => d.reason === 'warm')
      ? SNOW_WEEK_VERDICTS.warm
      : SNOW_WEEK_VERDICTS.none,
  };
}

/**
 * The week's snow against normal, in cm, as rain's: tiny amounts are never compared, and a week
 * without snow in a month where snow is rare says so. `span` is the days the normal covers.
 */
export function snowNormal(total: number, normal: number, span: number): SnowNormal | null {
  const n = SNOW.normals;
  if (Math.max(total, normal) < n.compareFrom) {
    return normal < n.rareBelow * span ? 'rare' : null;
  }
  if (total >= n.moreRatio * normal && total - normal >= n.minDifference) return 'more';
  if (total <= n.lessRatio * normal && normal - total >= n.minDifference) return 'less';
  return 'usual';
}

const weekdayName = (date: string): string => WEEKDAYS[new Date(parseDate(date)).getUTCDay()]!;

export function formatSnowWeek(week: SnowWeekComputation, units: Units): ApiSnowWeek {
  const unit = snowUnit(units);
  const shown = (cm: number) => roundSnow(toSnowUnits(cm, unit), unit);
  // Sentences use depths in words; at least SNOW.dustingBelow, so never "a dusting" here.
  const text = (cm: number) => `${textDepth(cm, unit)}${unit}`;
  const { today, days } = week;
  const from = days[0]!.date;
  const to = days[days.length - 1]!.date;

  const parts: string[] = [];
  if (week.total === null) {
    parts.push(RAIN_COPY.noWeekTotal);
  } else {
    if (atLeast(week.total, SNOW.dustingBelow)) {
      const s = week.snowiest;
      // A week whose snow falls on different days in different models has no day to single out.
      const most = atLeast(s.amount, SNOW.day.snow)
        ? {
            when: whenDays(s.date === today, s.date === today ? null : weekdayName(s.date)),
            amount: text(s.amount),
          }
        : null;
      parts.push(rainWeekLine(text(week.total), most));
    } else {
      // A week without a flake says how cold it gets instead.
      const lows = days.map((d) => d.low).filter(isFiniteNumber);
      const none = days.every((d) => d.band === 'nosnow') && lows.length > 0;
      parts.push(none ? lowLine(Math.min(...lows), units, 'week') : SNOW_COPY.barelyAny);
    }
    const kind = week.normal === null ? null : snowNormal(week.total, week.normal, week.span);
    // A week across two months is compared with normals from both.
    const month = monthName(from) === monthName(to) ? monthName(from) : null;
    if (kind) parts.push(snowNormalLine(kind, month));
  }

  const { band, answer, verdict } = snowWeekVerdict(week);
  return {
    from,
    to,
    band,
    answer,
    verdict,
    detail: parts.join(' '),
    total: week.total === null ? null : shown(week.total),
    normal: week.normal === null ? null : shown(week.normal),
    snowDays: week.snowDays,
    maybeDays: week.maybeDays,
    snowiest: { date: week.snowiest.date, amount: shown(week.snowiest.amount) },
    days: days.map((d) => ({
      date: d.date,
      label: dayLabel(d.date, today),
      amount: shown(d.amount),
      band: d.band,
      bandLabel: snowLabel(d.band, d.reason),
    })),
  };
}
