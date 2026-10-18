/**
 * "Will it be windy this week?": today (the rest of it) and the six days after it. Four windy days
 * make a windy week, and so does a single day of gales or a storm; one to three windy days make
 * it partly windy.
 */
import { BLEND, WEEK, WIND, WIND_BANDS, type WindBand } from './config';
import { parseDate } from './climate';
import {
  WEEKDAYS,
  WIND_COPY,
  WIND_PHRASES,
  WIND_WEEK_ANSWERS,
  WIND_WEEK_VERDICTS,
  breezyDaysLine,
  calmWeekLine,
  monthName,
  whenDays,
  windDaysLine,
  windLabel,
  windNormalLine,
  windiestLine,
  windyWeekLine,
  type WindTop,
  type WindyBand,
} from './copy';
import { median } from './rain';
import { isFiniteNumber, mean } from './stats';
import { isWindy, toWindUnits, windRank, windText } from './wind';
import { windNormal, type WindDayComputation } from './windDay';
import { dayLabel, listDays } from './week';
import type { ApiWindWeek, WindUnit } from './types';

/** The wind "this week" view in whole km/h, before formatting. */
export interface WindWeekComputation {
  /** Today's date: the first day given, used for "today" in labels and verdicts. */
  today: string;
  /** The usable days, in order. */
  days: WindDayComputation[];
  /**
   * The week's 24-hour mean wind: the median of each model's own mean of its days' means, for
   * the models covering every day, km/h, or null with fewer than 3 such models.
   */
  mean: number | null;
  /** The mean of the days' normals, km/h, or null without them. */
  normal: number | null;
  /** Days judged windy or more, and days judged breezy. */
  windyDays: number;
  breezyDays: number;
  /** The day with the strongest gust (the earlier one on a tie), and the gust. */
  windiest: { date: string; gust: number };
}

/**
 * Today and the days after it. Days with too few models are left out, and without enough days
 * there is no answer.
 */
export function computeWindWeek(all: readonly WindDayComputation[]): WindWeekComputation | null {
  const days = all.filter((d) => d.models.length >= WEEK.minModels);
  const first = days[0];
  if (!first || days.length < WEEK.minDays) return null;

  // Each model's own 24-hour means, day by day, for the models covering every day.
  const full = first.models.flatMap((m) => {
    const means: number[] = [];
    for (const d of days) {
      const own = d.models.find((o) => o.id === m.id)?.dayMean;
      if (!isFiniteNumber(own)) return [];
      means.push(own);
    }
    return [mean(means)];
  });
  const normals = days.map((d) => d.normal);

  let windiest = { date: first.date, gust: first.gust };
  for (const d of days) if (d.gust > windiest.gust) windiest = { date: d.date, gust: d.gust };
  return {
    today: all[0]!.date,
    days,
    mean: full.length >= BLEND.minModels ? median(full) : null,
    normal: normals.every(isFiniteNumber) ? mean(normals) : null,
    windyDays: days.filter((d) => isWindy(d.band)).length,
    breezyDays: days.filter((d) => d.band === 'breezy').length,
    windiest,
  };
}

/** "today", "on Thu and Fri", "today and on Sat" (at most WIND.week.nameDays days). */
function when(dates: readonly string[], today: string): string {
  const named = dates.slice(0, WIND.week.nameDays);
  const others = named.filter((d) => d !== today);
  return whenDays(named[0] === today, others.length > 0 ? listDays(others, today) : null);
}

/**
 * The week's band, answer and verdict line, by the first rule that fits: four windy days, or any
 * gale or storm, is Yes (the strongest day's band); one to three windy days is Partly (windy);
 * breezy days are A bit; otherwise No.
 */
export function windWeekVerdict(week: WindWeekComputation): {
  band: WindBand;
  answer: string;
  verdict: string;
} {
  const { days, today } = week;
  const top = WIND_BANDS[Math.max(...days.map((d) => windRank(d.band)))]!;
  const windy = days.filter((d) => isWindy(d.band));
  // The strongest band and its days, when stronger than windy: "gales on Fri". Up to three days
  // are named; more (only in a windy week) are most of the week: "on most days", or "all week".
  const topDays = days.filter((d) => d.band === top).map((d) => d.date);
  const strongest: WindTop | null =
    windRank(top) > windRank('windy')
      ? {
          phrase: WIND_PHRASES[top as WindyBand],
          when:
            topDays.length <= WIND.week.nameDays
              ? when(topDays, today)
              : topDays.length === days.length
                ? WIND_COPY.allWeek
                : WIND_COPY.mostDays,
        }
      : null;
  const allTop = windy.every((d) => d.band === top);
  const windyWhen = () =>
    when(
      windy.map((d) => d.date),
      today,
    );
  if (week.windyDays >= WIND.week.windyFrom) {
    return { band: top, answer: WIND_WEEK_ANSWERS.yes, verdict: windyWeekLine(strongest) };
  }
  if (windRank(top) >= windRank('gale')) {
    return {
      band: top,
      answer: WIND_WEEK_ANSWERS.yes,
      verdict: windDaysLine(windyWhen(), strongest, allTop),
    };
  }
  if (week.windyDays > 0) {
    return {
      band: 'windy',
      answer: WIND_WEEK_ANSWERS.partly,
      verdict: windDaysLine(windyWhen(), strongest, allTop),
    };
  }
  if (week.breezyDays >= WIND.week.breezyFrom) {
    return { band: 'breezy', answer: WIND_WEEK_ANSWERS.bit, verdict: WIND_WEEK_VERDICTS.breezy };
  }
  if (week.breezyDays > 0) {
    const breezy = days.filter((d) => d.band === 'breezy').map((d) => d.date);
    return {
      band: 'breezy',
      answer: WIND_WEEK_ANSWERS.bit,
      verdict: breezyDaysLine(when(breezy, today)),
    };
  }
  return {
    band: 'calm',
    answer: WIND_WEEK_ANSWERS.no,
    verdict: days.every((d) => d.still) ? WIND_WEEK_VERDICTS.calm : WIND_WEEK_VERDICTS.light,
  };
}

const weekdayName = (date: string): string => WEEKDAYS[new Date(parseDate(date)).getUTCDay()]!;

export function formatWindWeek(week: WindWeekComputation, unit: WindUnit): ApiWindWeek {
  const shown = (kmh: number) => toWindUnits(kmh, unit);
  const text = (kmh: number) => windText(shown(kmh), unit);
  const { today, days, windiest } = week;
  const from = days[0]!.date;
  const to = days[days.length - 1]!.date;

  const parts: string[] = [];
  if (week.breezyDays + week.windyDays > 0) {
    const on = whenDays(
      windiest.date === today,
      windiest.date === today ? null : weekdayName(windiest.date),
    );
    parts.push(windiestLine(on, text(windiest.gust)));
  } else {
    parts.push(calmWeekLine(text(windiest.gust)));
  }
  if (week.mean !== null && week.normal !== null) {
    // A week across two months is compared with normals from both.
    const month = monthName(from) === monthName(to) ? monthName(from) : null;
    parts.push(windNormalLine(windNormal(week.mean, week.normal, WIND.normals.week), month));
  }

  const { band, answer, verdict } = windWeekVerdict(week);
  return {
    from,
    to,
    band,
    answer,
    verdict,
    detail: parts.join(' '),
    windyDays: week.windyDays,
    breezyDays: week.breezyDays,
    windiest: { date: windiest.date, gust: shown(windiest.gust) },
    mean: week.mean === null ? null : shown(week.mean),
    normal: week.normal === null ? null : shown(week.normal),
    days: days.map((d) => ({
      date: d.date,
      label: dayLabel(d.date, today),
      gust: shown(d.gust),
      mean: shown(d.mean),
      band: d.band,
      bandLabel: windLabel(d.band, d.still),
      still: d.still,
    })),
  };
}
