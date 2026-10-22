import { describe, expect, it } from 'vitest';
import { AHEAD, CACHE, SNOW } from '../src/config';
import type { HourTemps } from '../src/blend';
import type { DayData } from '../src/compute';
import { snowAhead } from '../src/snowAhead';
import { computeSnowDay, formatSnowDay, judgeSnowSeries, snowSeries } from '../src/snowDay';
import { computeSnowNow, formatSnowNow } from '../src/snowNow';
import type { ApiSnowDay } from '../src/types';

const HOUR = 3_600_000;
const MODELS = 6;
// Friday 15 January 2027 to Thursday 21 January, in UTC.
const DATES = ['15', '16', '17', '18', '19', '20', '21'].map((d) => `2027-01-${d}`);
const at = (date: string, hours: number) => Date.parse(`${date}T00:00:00Z`) + hours * HOUR;
const iso = (time: number) => new Date(time).toISOString();

type PerModel = (hour: number, model: number) => number | null;

/**
 * A day in UTC at -3°, with each model's snow in each hour (cm; null for no data) and its daily
 * totals as the providers work them out.
 */
function day(date: string, cm: PerModel = () => 0): DayData {
  const hourly: HourTemps[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    time: at(date, hour),
    temps: Array.from({ length: MODELS }, () => -3),
    rain: Array.from({ length: MODELS }, (_, i) => {
      const v = cm(hour, i);
      return v === null ? null : v / SNOW.cmPerMm;
    }),
  }));
  return {
    date,
    models: Array.from({ length: MODELS }, (_, i) => {
      const water = hourly.every((h) => h.rain![i] !== null)
        ? hourly.reduce((a, h) => a + h.rain![i]!, 0)
        : null;
      return {
        id: `m${i}`,
        name: `M${i}`,
        high: null,
        feelsLike: null,
        rain: water,
        snow: water,
        snowfall: water === null ? null : water * SNOW.cmPerMm,
        low: -3,
      };
    }),
    hourly,
  };
}

/** Snow in the given hours of the day, `cm` an hour for every model. */
const during =
  (hours: readonly number[], cm: number): PerModel =>
  (h) =>
    hours.includes(h) ? cm : 0;

/** A week: snow on the first day from noon to 4pm, then dry days. */
const WEEK = DATES.map((date, i) => day(date, i === 0 ? during([12, 13, 14, 15], 0.5) : undefined));

const judged = (days: readonly DayData[]) => judgeSnowSeries(snowSeries(days), 'c', 'UTC');
const ahead = (days: readonly DayData[], from: number, hours: number = AHEAD.hours) =>
  snowAhead(judged(days), days, from, hours, 'c', null);

/** The rest of the day the server answers at `time`. */
const liveToday = (d: DayData, time: number) =>
  formatSnowDay(computeSnowDay(d, { from: time })!, 'c');

describe('snowAhead', () => {
  it('stops where a forecast goes stale, as the apps do', () => {
    expect(AHEAD.hours * 3600).toBe(CACHE.forecastStale);
  });

  it('answers each of the next hours as the server does at its start', () => {
    const from = at(DATES[0]!, 9.5);
    const entries = ahead(WEEK, from);
    expect(entries.map((e) => e.time)).toEqual(
      [10, 11, 12, 13, 14, 15].map((h) => iso(at(DATES[0]!, h))),
    );
    const series = judged(WEEK);
    for (const e of entries) {
      const time = Date.parse(e.time);
      // Now as the website works it out at any moment of the hour, without the series.
      const { series: _series, ...now } = formatSnowNow(computeSnowNow(series, time)!, 'cm');
      expect(e.now).toEqual(now);
      expect(e.now).not.toHaveProperty('series');
      expect(e.today).toEqual(liveToday(WEEK[0]!, time));
      expect(e.today).toMatchObject({ date: DATES[0], from: e.time, partial: true });
      // The week starts with that answer.
      expect(e.week).toMatchObject({ from: DATES[0], to: DATES[6] });
      expect(e.week!.days[0]).toMatchObject({
        date: DATES[0],
        label: 'Today',
        band: e.today.band,
        chance: e.today.chance,
        snowy: e.today.snowy,
        total: e.today.total,
      });
    }
    // Snowing from noon, so Today says Yes from the first entry, and Now from noon.
    expect(entries.map((e) => [e.now.band, e.today.answer, e.week!.answer])).toEqual([
      ['nosnow', 'Yes.', 'Yes.'],
      ['nosnow', 'Yes.', 'Yes.'],
      ['snow', 'Yes.', 'Yes.'],
      ['snow', 'Yes.', 'Yes.'],
      ['snow', 'Yes.', 'Yes.'],
      ['snow', 'Yes.', 'Yes.'],
    ]);
  });

  it('leaves the hour containing the moment to the response, even at its first instant', () => {
    expect(ahead(WEEK, at(DATES[0]!, 10))[0]!.time).toBe(iso(at(DATES[0]!, 11)));
    expect(ahead(WEEK, at(DATES[0]!, 10) - 1)[0]!.time).toBe(iso(at(DATES[0]!, 10)));
  });

  it('has fewer entries near the end of the hours', () => {
    expect(ahead(WEEK, at(DATES[6]!, 20.5)).map((e) => e.time)).toEqual(
      [21, 22, 23].map((h) => iso(at(DATES[6]!, h))),
    );
    expect(ahead(WEEK, at(DATES[0]!, 9.5), 2)).toHaveLength(2);
  });

  it("answers for the new date's day and week after the place's midnight", () => {
    const entries = ahead(WEEK, at(DATES[0]!, 21.25));
    expect(entries.map((e) => [e.time, e.today.date, e.week!.from, e.week!.days.length])).toEqual([
      [iso(at(DATES[0]!, 22)), DATES[0], DATES[0], 7],
      [iso(at(DATES[0]!, 23)), DATES[0], DATES[0], 7],
      [iso(at(DATES[1]!, 0)), DATES[1], DATES[1], 6],
      [iso(at(DATES[1]!, 1)), DATES[1], DATES[1], 6],
      [iso(at(DATES[1]!, 2)), DATES[1], DATES[1], 6],
      [iso(at(DATES[1]!, 3)), DATES[1], DATES[1], 6],
    ]);
    const first = entries[2]!;
    expect(first.today).toEqual(liveToday(WEEK[1]!, at(DATES[1]!, 0)));
    expect(first.today).toMatchObject({ partial: true, from: first.time });
    expect(first.week!.days[0]).toMatchObject({ date: DATES[1], label: 'Today' });
  });

  it('leaves out an hour with no answer for its day, as the response would have none', () => {
    // The 10pm hour has one model, the 11pm hour another: none covers the rest of the day at
    // 10pm, so the server would have no snow answer then.
    const patchy = day(DATES[0]!, (h, i) => (h < 22 || (h === 22 ? i === 0 : i === 1) ? 0 : null));
    const days = [patchy, ...WEEK.slice(1)];
    expect(ahead(days, at(DATES[0]!, 21.5)).map((e) => e.time)).toEqual(
      [23, 24, 25, 26, 27].map((h) => iso(at(DATES[0]!, h))),
    );
    // Nor for an hour on a day it is not given.
    expect(
      snowAhead(judged(WEEK), WEEK.slice(0, 1), at(DATES[0]!, 21.5), 6, 'c', null),
    ).toHaveLength(2);
  });

  it('has no week without enough days', () => {
    const entries = ahead(WEEK.slice(0, 3), at(DATES[0]!, 9.5));
    expect(entries).toHaveLength(6);
    expect(entries.every((e) => e.week === null)).toBe(true);
  });

  it('gives depths in inches with °F', () => {
    const [entry] = snowAhead(judged(WEEK), WEEK, at(DATES[0]!, 11.5), 1, 'f', null);
    expect(entry!.now.band).toBe('snow');
    expect(entry!.today).toEqual(
      formatSnowDay(computeSnowDay(WEEK[0]!, { from: at(DATES[0]!, 12) })!, 'f'),
    );
    // The week's 2cm.
    expect(entry!.week).toMatchObject({ total: 0.8, snowiest: { date: DATES[0], amount: 0.8 } });
  });

  describe('late in the evening, beside the answer the server gives later in the hour', () => {
    /**
     * At each moment, the entry an app shows (the last one starting by then, from a request at
     * 9:30pm) and the server's own rest of the day, which weights the current hour by the
     * minutes left: band, answer, models expecting snow and the window's threshold.
     */
    function evening(today: DayData) {
      const days = [today, ...WEEK.slice(1)];
      const entries = ahead(days, at(DATES[0]!, 21.5));
      const brief = (d: ApiSnowDay) => [d.band, d.answer, `${d.snowy}/${d.total}`, d.threshold];
      return ['22:00', '22:30', '23:00', '23:30', '23:59'].map((hhmm) => {
        const time = Date.parse(`${DATES[0]}T${hhmm}:00Z`);
        const shown = entries.filter((e) => Date.parse(e.time) <= time).at(-1)!;
        return {
          at: hhmm,
          entry: shown.time.slice(11, 16),
          ahead: brief(shown.today),
          live: brief(liveToday(today, time)),
        };
      });
    }

    it('can be snowier later in the hour, as the window and its thresholds shrink', () => {
      // Two forecasts with 0.16cm in the last hour: short of the 0.2cm of a two-hour window, but
      // over the threshold of the hour and a half left at 10:30pm.
      const late = day(DATES[0]!, (h, i) => (h === 23 && i < 2 ? 0.16 : 0));
      expect(evening(late)).toEqual([
        {
          at: '22:00',
          entry: '22:00',
          ahead: ['flakes', 'No.', '0/6', 0.2],
          live: ['flakes', 'No.', '0/6', 0.2],
        },
        {
          at: '22:30',
          entry: '22:00',
          ahead: ['flakes', 'No.', '0/6', 0.2],
          live: ['maybesnow', 'Maybe.', '2/6', 0.15],
        },
        {
          at: '23:00',
          entry: '23:00',
          ahead: ['maybesnow', 'Maybe.', '2/6', 0.1],
          live: ['maybesnow', 'Maybe.', '2/6', 0.1],
        },
        // Snow is possible in the last hour, so it counts in full: no difference.
        {
          at: '23:30',
          entry: '23:00',
          ahead: ['maybesnow', 'Maybe.', '2/6', 0.1],
          live: ['maybesnow', 'Maybe.', '2/6', 0.1],
        },
        {
          at: '23:59',
          entry: '23:00',
          ahead: ['maybesnow', 'Maybe.', '2/6', 0.1],
          live: ['maybesnow', 'Maybe.', '2/6', 0.1],
        },
      ]);
    });

    it('can be less snowy later in the last hour, as its minutes run out', () => {
      // A few flakes in the last hour, from two forecasts: fewer of them are left by 11:30pm.
      const late = day(DATES[0]!, (h, i) => (h === 23 && i < 2 ? 0.09 : 0));
      expect(evening(late)).toEqual([
        {
          at: '22:00',
          entry: '22:00',
          ahead: ['nosnow', 'No.', '0/6', 0.2],
          live: ['nosnow', 'No.', '0/6', 0.2],
        },
        {
          at: '22:30',
          entry: '22:00',
          ahead: ['nosnow', 'No.', '0/6', 0.2],
          live: ['nosnow', 'No.', '0/6', 0.15],
        },
        {
          at: '23:00',
          entry: '23:00',
          ahead: ['flakes', 'No.', '0/6', 0.1],
          live: ['flakes', 'No.', '0/6', 0.1],
        },
        {
          at: '23:30',
          entry: '23:00',
          ahead: ['flakes', 'No.', '0/6', 0.1],
          live: ['nosnow', 'No.', '0/6', 0.1],
        },
        {
          at: '23:59',
          entry: '23:00',
          ahead: ['flakes', 'No.', '0/6', 0.1],
          live: ['nosnow', 'No.', '0/6', 0.1],
        },
      ]);
    });
  });
});
