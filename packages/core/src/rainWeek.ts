/** "Is it wet this week?": today (the rest of it) and the six days after it. */
import { BLEND, RAIN, RAIN_BANDS, WEEK, type RainBand } from './config';
import { normalForDate, parseDate, type MonthlyNormals } from './climate';
import {
  RAIN_BAND_LABELS,
  RAIN_COPY,
  RAIN_WEEK_ANSWERS,
  RAIN_WEEK_VERDICTS,
  SNOW_LABEL,
  WEEKDAYS,
  monthName,
  mostlyDryLine,
  rainDaysLine,
  rainNormalLine,
  rainWeekLine,
  wetWeekLine,
  whenDays,
  type RainNormal,
} from './copy';
import { type Units } from './units';
import { dayLabel, listDays } from './week';
import type { ApiRainWeek } from './types';
import {
  rainUnit,
  toRainUnits,
  roundRain,
  rainText,
  atLeast,
  rank,
  isRain,
  median,
  snowy,
} from './rain';
import type { RainDayComputation } from './rainDay';

// ---- This week --------------------------------------------------------------------

/** The rain "this week" view in mm, before formatting. */
export interface RainWeekComputation {
  /** Today's date: the first day given, used for "today" in labels and verdicts. */
  today: string;
  /** The usable days, in order. */
  days: RainDayComputation[];
  /**
   * The median of each model's own total across the days (models covering every day), mm, or
   * null with fewer than 3 such models.
   */
  total: number | null;
  /** Normal rain over the same days (today scaled by the hours left), mm, or null. */
  normal: number | null;
  /** Days judged rain or wetter, and days judged showers. */
  rainDays: number;
  showerDays: number;
  /** The day with the largest consensus amount (the earlier one on a tie). */
  wettest: RainDayComputation;
}

/**
 * Today (the rest of it) and the days after it. Days with too few models are left out, and
 * without enough days there is no answer. `rainNormals` are monthly mean mm/day, January first.
 */
export function computeRainWeek(
  all: readonly RainDayComputation[],
  rainNormals: MonthlyNormals | null,
): RainWeekComputation | null {
  const days = all.filter((d) => d.models.length >= WEEK.minModels);
  const first = days[0];
  if (!first || days.length < WEEK.minDays) return null;

  const sums = first.models.flatMap((m) => {
    let sum = 0;
    for (const d of days) {
      const own = d.models.find((o) => o.id === m.id);
      if (!own) return [];
      sum += own.total;
    }
    return [sum];
  });

  let normal: number | null = null;
  if (rainNormals) {
    normal = 0;
    for (const d of days) {
      normal += normalForDate(rainNormals, d.date) * (d.partial ? d.hours / 24 : 1);
    }
  }

  let wettest = first;
  for (const d of days) if (d.amount > wettest.amount) wettest = d;
  return {
    today: all[0]!.date,
    days,
    total: sums.length >= BLEND.minModels ? median(sums) : null,
    normal,
    rainDays: days.filter((d) => isRain(d.band)).length,
    showerDays: days.filter((d) => d.band === 'showers').length,
    wettest,
  };
}

/** "today", "on Thu and Fri", "today and on Sat" (at most RAIN.week.nameDays days). */
function when(dates: readonly string[], today: string): string {
  const named = dates.slice(0, RAIN.week.nameDays);
  const others = named.filter((d) => d !== today);
  return whenDays(named[0] === today, others.length > 0 ? listDays(others, today) : null);
}

/** The week's band, answer and verdict line. */
export function rainWeekVerdict(week: RainWeekComputation): {
  band: RainBand;
  answer: string;
  verdict: string;
} {
  const { days, today } = week;
  const rainy = days.filter((d) => isRain(d.band));
  const heavy = rainy.filter((d) => rank(d.band) >= rank('heavy'));
  if (week.rainDays >= RAIN.week.wetFrom) {
    const band = RAIN_BANDS[Math.max(...rainy.map((d) => rank(d.band)))]!;
    const heaviest = heavy.length > 0 ? when([week.wettest.date], today) : null;
    return { band, answer: RAIN_WEEK_ANSWERS.yes, verdict: wetWeekLine(heaviest) };
  }
  if (week.rainDays > 0) {
    const dates = rainy.map((d) => d.date);
    const heavyWhen =
      heavy.length > 0
        ? when(
            heavy.map((d) => d.date),
            today,
          )
        : null;
    return {
      band: 'showers',
      answer: RAIN_WEEK_ANSWERS.partly,
      verdict: rainDaysLine(when(dates, today), heavyWhen, heavy.length === rainy.length),
    };
  }
  if (week.showerDays >= RAIN.week.unsettledFrom) {
    return {
      band: 'showers',
      answer: RAIN_WEEK_ANSWERS.maybe,
      verdict: RAIN_WEEK_VERDICTS.unsettled,
    };
  }
  if (week.showerDays > 0) {
    const dates = days.filter((d) => d.band === 'showers').map((d) => d.date);
    return {
      band: 'showers',
      answer: RAIN_WEEK_ANSWERS.maybe,
      verdict: mostlyDryLine(when(dates, today)),
    };
  }
  return days.some((d) => d.band === 'spots')
    ? { band: 'spots', answer: RAIN_WEEK_ANSWERS.no, verdict: RAIN_WEEK_VERDICTS.mostlyDry }
    : { band: 'dry', answer: RAIN_WEEK_ANSWERS.no, verdict: RAIN_WEEK_VERDICTS.dry };
}

/**
 * The week's rain against normal, in mm. Tiny amounts are never compared (a dry climate's
 * 0.3 mm is not "wetter than usual"); a week that is dry in a dry place says so.
 */
export function rainNormal(total: number, normal: number): RainNormal | null {
  const n = RAIN.normals;
  if (Math.max(total, normal) < n.compareFrom) {
    return total < n.usualDryBelow && normal < n.usualDryBelow ? 'dry' : null;
  }
  if (total >= n.wetterRatio * normal && total - normal >= n.minDifference) return 'wetter';
  if (total <= n.drierRatio * normal && normal - total >= n.minDifference) return 'drier';
  return 'normal';
}

const weekdayName = (date: string): string => WEEKDAYS[new Date(parseDate(date)).getUTCDay()]!;

export function formatRainWeek(week: RainWeekComputation, units: Units): ApiRainWeek {
  const unit = rainUnit(units);
  const shown = (mm: number) => roundRain(toRainUnits(mm, unit), unit);
  const text = (mm: number) => rainText(toRainUnits(mm, unit), unit);
  const { today, days } = week;
  const from = days[0]!.date;
  const to = days[days.length - 1]!.date;

  const parts: string[] = [];
  if (week.total === null) {
    parts.push(RAIN_COPY.noWeekTotal);
  } else {
    if (week.total < RAIN.day.wet) {
      parts.push(RAIN_COPY.barelyAnyRain);
    } else {
      const w = week.wettest;
      // A week whose rain falls on different days in different models has no day to single out.
      const most = atLeast(w.amount, RAIN.day.wet)
        ? {
            when: whenDays(w.date === today, w.date === today ? null : weekdayName(w.date)),
            amount: text(w.amount),
          }
        : null;
      parts.push(rainWeekLine(text(week.total), most));
    }
    const kind = week.normal === null ? null : rainNormal(week.total, week.normal);
    // A week across two months is compared with normals from both.
    const month = monthName(from) === monthName(to) ? monthName(from) : 'the time of year';
    if (kind) parts.push(rainNormalLine(kind, month));
  }

  const { band, answer, verdict } = rainWeekVerdict(week);
  return {
    from,
    to,
    band,
    answer,
    verdict,
    detail: parts.join(' '),
    total: week.total === null ? null : shown(week.total),
    normal: week.normal === null ? null : shown(week.normal),
    rainDays: week.rainDays,
    showerDays: week.showerDays,
    wettest: { date: week.wettest.date, amount: shown(week.wettest.amount) },
    days: days.map((d) => {
      const snow = snowy(d.band, d.snow === 'most');
      return {
        date: d.date,
        label: dayLabel(d.date, today),
        amount: shown(d.amount),
        band: d.band,
        bandLabel: snow ? SNOW_LABEL : RAIN_BAND_LABELS[d.band],
        snow,
      };
    }),
  };
}
