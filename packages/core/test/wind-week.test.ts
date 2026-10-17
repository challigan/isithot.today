import { describe, expect, it } from 'vitest';
import { isStill, windBand } from '../src/wind';
import type { WindDayComputation } from '../src/windDay';
import { computeWindWeek, formatWindWeek, windWeekVerdict } from '../src/windWeek';

/** Thursday 15 October 2026 and the six days after it. */
const DATES = [
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
];

/**
 * One day judged at a mean wind and gust (km/h), with six models that agree on them, each with
 * its own 24-hour mean wind (`dayMean` plus its index).
 */
function judged(
  i: number,
  [mean, gust]: readonly [number, number],
  extra: Partial<WindDayComputation> = {},
  dayMean: number | null = 15,
): WindDayComputation {
  const band = windBand(mean, gust);
  return {
    date: DATES[i]!,
    from: Date.parse(`${DATES[i]}T07:00:00Z`),
    partial: i === 0,
    window: { from: i === 0 ? 10 : 7, to: 21 },
    models: Array.from({ length: 6 }, (_, k) => ({
      id: `m${k}`,
      name: `M${k}`,
      mean,
      gust,
      band,
      dayMean: dayMean === null ? null : dayMean + k,
    })),
    mean,
    gust,
    band,
    still: band === 'calm' && isStill(mean, gust),
    agree: 6,
    peakHour: null,
    dayMean,
    normal: null,
    ...extra,
  };
}

const CALM = [10, 20] as const;
const STILL = [3, 10] as const;
const BREEZY = [15, 40] as const;
const WINDY = [25, 55] as const;
const VERY = [30, 70] as const;
const GALE = [45, 90] as const;
const STORM = [60, 120] as const;

/** A week from the winds of each day, today first. */
const week = (...winds: (readonly [number, number])[]) =>
  computeWindWeek(winds.map((w, i) => judged(i, w)))!;

/** The answer and verdict for a week. */
const say = (...winds: (readonly [number, number])[]) => {
  const v = windWeekVerdict(week(...winds));
  return `${v.answer} ${v.verdict} (${v.band})`;
};

describe('computeWindWeek', () => {
  it('needs five days with enough models', () => {
    const days = DATES.map((_, i) => judged(i, CALM));
    expect(computeWindWeek(days.slice(0, 4))).toBeNull();
    expect(computeWindWeek([])).toBeNull();
    const thin = { ...days[2]!, models: days[2]!.models.slice(0, 2) };
    const five = computeWindWeek([...days.slice(0, 2), thin, ...days.slice(3, 6)])!;
    expect(five.days.map((d) => d.date)).toEqual([
      '2026-10-15',
      '2026-10-16',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
    ]);
    expect(computeWindWeek([...days.slice(0, 2), thin, ...days.slice(3, 5)])).toBeNull();
    // Today is the first day given, even when it is left out.
    const late = computeWindWeek([{ ...days[0]!, models: [] }, ...days.slice(1)])!;
    expect(late.today).toBe('2026-10-15');
    expect(late.days[0]!.date).toBe('2026-10-16');
  });

  it('counts the days, and finds the windiest (the earlier on a tie)', () => {
    const w = week(BREEZY, WINDY, CALM, GALE, BREEZY, GALE, VERY);
    expect([w.windyDays, w.breezyDays]).toEqual([4, 2]);
    expect(w.windiest).toEqual({ date: '2026-10-18', gust: 90 });
  });

  it('takes the median of each model’s own mean wind, for the models covering every day', () => {
    // Model k's mean is 15 + k every day: the median of 15 to 20.
    expect(week(CALM, CALM, CALM, CALM, CALM).mean).toBe(17.5);
    const days = DATES.map((_, i) => judged(i, CALM));
    days[3] = {
      ...days[3]!,
      models: days[3]!.models.map((m, k) => (k < 4 ? { ...m, dayMean: null } : m)),
    };
    // Only two models cover every day: no week mean.
    expect(computeWindWeek(days)!.mean).toBeNull();
    days[3] = { ...days[3]!, models: days[3]!.models.slice(3) };
    expect(computeWindWeek(days)!.mean).toBeNull();
  });

  it('compares with the mean of the days’ normals, only with every one', () => {
    const days = DATES.map((_, i) => judged(i, CALM, { normal: 10 + i }));
    expect(computeWindWeek(days)!.normal).toBe(13);
    days[4] = { ...days[4]!, normal: null };
    expect(computeWindWeek(days)!.normal).toBeNull();
  });
});

describe('windWeekVerdict', () => {
  it('is a windy week with four windy days, naming the strongest when stronger than windy', () => {
    expect(say(WINDY, WINDY, CALM, WINDY, BREEZY, WINDY, CALM)).toBe('Yes. A windy week. (windy)');
    expect(say(VERY, WINDY, CALM, VERY, BREEZY, WINDY, CALM)).toBe(
      'Yes. A windy week, very windy today and on Sun. (verywindy)',
    );
    expect(say(WINDY, WINDY, GALE, WINDY, BREEZY, WINDY, CALM)).toBe(
      'Yes. A windy week, gales on Sat. (gale)',
    );
    // At most three days are named; more are most days, or all of them.
    expect(say(STORM, STORM, STORM, STORM, STORM)).toBe(
      'Yes. A windy week, storm-force winds all week. (storm)',
    );
    expect(say(VERY, VERY, VERY, VERY, CALM, CALM, CALM)).toBe(
      'Yes. A windy week, very windy on most days. (verywindy)',
    );
    expect(say(VERY, WINDY, VERY, VERY, VERY, WINDY, CALM)).toBe(
      'Yes. A windy week, very windy on most days. (verywindy)',
    );
    expect(say(VERY, WINDY, VERY, CALM, VERY, CALM, CALM)).toBe(
      'Yes. A windy week, very windy today and on Sat and Mon. (verywindy)',
    );
  });

  it('is windy with a single day of gales or a storm', () => {
    expect(say(WINDY, CALM, GALE, CALM, CALM, CALM, CALM)).toBe(
      'Yes. Windy today and on Sat, gales on Sat. (gale)',
    );
    expect(say(CALM, CALM, STORM, CALM, CALM, GALE, CALM)).toBe(
      'Yes. Windy on Sat and Tue, storm-force winds on Sat. (storm)',
    );
    expect(say(CALM, CALM, CALM, STORM, CALM, CALM, CALM)).toBe(
      'Yes. Storm-force winds on Sun. (storm)',
    );
    expect(say(CALM, GALE, CALM, CALM, GALE, CALM, CALM)).toBe('Yes. Gales on Fri and Mon. (gale)');
  });

  it('is partly windy with one to three windy days', () => {
    expect(say(CALM, WINDY, WINDY, BREEZY, CALM, CALM, CALM)).toBe(
      'Partly. Windy on Fri and Sat. (windy)',
    );
    expect(say(CALM, WINDY, VERY, BREEZY, CALM, CALM, CALM)).toBe(
      'Partly. Windy on Fri and Sat, very windy on Sat. (windy)',
    );
    expect(say(CALM, CALM, CALM, VERY, CALM, CALM, CALM)).toBe(
      'Partly. Very windy on Sun. (windy)',
    );
  });

  it('is a bit breezy with breezy days and no windy one', () => {
    expect(say(BREEZY, BREEZY, CALM, BREEZY, BREEZY, CALM, CALM)).toBe(
      'A bit. A breezy week. (breezy)',
    );
    expect(say(CALM, CALM, CALM, CALM, BREEZY, BREEZY, CALM)).toBe(
      'A bit. Breezy on Mon and Tue. (breezy)',
    );
    expect(say(BREEZY, CALM, CALM, CALM, CALM, CALM, CALM)).toBe('A bit. Breezy today. (breezy)');
  });

  it('is not windy otherwise, and calm when every day is still', () => {
    expect(say(CALM, STILL, CALM, CALM, CALM, CALM, CALM)).toBe('No. Light winds all week. (calm)');
    expect(say(STILL, STILL, STILL, STILL, STILL)).toBe('No. A calm week. (calm)');
  });
});

describe('formatWindWeek', () => {
  it('names the windiest day and its gust, with the days in the wind unit', () => {
    const w = week(BREEZY, WINDY, CALM, GALE, BREEZY, STILL, VERY);
    expect(formatWindWeek(w, 'mph')).toEqual({
      from: '2026-10-15',
      to: '2026-10-21',
      band: 'gale',
      answer: 'Yes.',
      verdict: 'Windy on Fri, Sun and Wed, gales on Sun.',
      detail: 'Windiest on Sunday, gusts up to 56mph.',
      windyDays: 3,
      breezyDays: 2,
      windiest: { date: '2026-10-18', gust: 56 },
      mean: 11,
      normal: null,
      days: [
        {
          date: '2026-10-15',
          label: 'Today',
          gust: 25,
          mean: 9,
          band: 'breezy',
          bandLabel: 'Breezy',
          still: false,
        },
        {
          date: '2026-10-16',
          label: 'Fri',
          gust: 34,
          mean: 16,
          band: 'windy',
          bandLabel: 'Windy',
          still: false,
        },
        {
          date: '2026-10-17',
          label: 'Sat',
          gust: 12,
          mean: 6,
          band: 'calm',
          bandLabel: 'Light winds',
          still: false,
        },
        {
          date: '2026-10-18',
          label: 'Sun',
          gust: 56,
          mean: 28,
          band: 'gale',
          bandLabel: 'Gale',
          still: false,
        },
        {
          date: '2026-10-19',
          label: 'Mon',
          gust: 25,
          mean: 9,
          band: 'breezy',
          bandLabel: 'Breezy',
          still: false,
        },
        {
          date: '2026-10-20',
          label: 'Tue',
          gust: 6,
          mean: 2,
          band: 'calm',
          bandLabel: 'Calm',
          still: true,
        },
        {
          date: '2026-10-21',
          label: 'Wed',
          gust: 43,
          mean: 19,
          band: 'verywindy',
          bandLabel: 'Very windy',
          still: false,
        },
      ],
    });
    const today = formatWindWeek(week(GALE, WINDY, CALM, CALM, BREEZY), 'kmh');
    expect(today.detail).toBe('Windiest today, gusts up to 90km/h.');
  });

  it('says how light the gusts stay in a week without a breezy day', () => {
    const w = formatWindWeek(week(CALM, STILL, CALM, CALM, CALM), 'kmh');
    expect(w.detail).toBe('Gusts no stronger than 20km/h all week.');
  });

  it('compares the week with normal, for the time of year across two months', () => {
    const at = (normal: number, dates = DATES) =>
      formatWindWeek(
        computeWindWeek(
          dates.slice(0, 5).map((date, i) => ({ ...judged(i, BREEZY, { normal }), date })),
        )!,
        'kmh',
      );
    // The week's mean is 17.5km/h.
    expect(at(14).detail).toBe(
      'Windiest today, gusts up to 40km/h. Windier than usual for October.',
    );
    expect(at(17).detail).toBe('Windiest today, gusts up to 40km/h. About usual for October.');
    expect(at(24).detail).toBe(
      'Windiest today, gusts up to 40km/h. Calmer than usual for October.',
    );
    expect(at(24)).toMatchObject({ mean: 18, normal: 24 });
    const across = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];
    expect(at(14, across).detail).toBe(
      'Windiest today, gusts up to 40km/h. Windier than usual for the time of year.',
    );
    // Without a week mean there is nothing to compare.
    const none = computeWindWeek(DATES.map((_, i) => judged(i, CALM, { normal: 10 }, null)))!;
    expect(formatWindWeek(none, 'kmh')).toMatchObject({
      detail: 'Gusts no stronger than 20km/h all week.',
      mean: null,
      normal: 10,
    });
  });
});
