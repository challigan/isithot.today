import { describe, expect, it } from 'vitest';
import {
  ALERT_KINDS,
  SNOW_ALERT_RULE,
  SNOW_RELEVANCE,
  alertWindows,
  collapseId,
  expiresAt,
  inQuietHours,
  snowAlert,
  testAlert,
  type AlertKind,
  type TopicAlertPrefs,
} from '../src/alerts';
import { ALERTS, SNOW, SNOW_BANDS, TOPICS, type SnowBand } from '../src/config';
import { ALERT_COPY, COPY, alertBody, alertText, alertWhere } from '../src/copy';
import { localDateTime } from '../src/dates';
import type { HourTemps } from '../src/blend';
import type { DayData } from '../src/compute';
import { isSnow, snowUnit } from '../src/snow';
import { computeSnowDay, formatSnowDay, judgeSnowSeries, snowSeries } from '../src/snowDay';
import { computeSnowNow, formatSnowNow } from '../src/snowNow';
import type { Units } from '../src/units';
import type { ApiSnow, TodayResponse } from '../src/types';

const HOUR = 3_600_000;
const TODAY = '2026-12-01';
const TOMORROW = '2026-12-02';
/** A morning run's moment: 07:05 at the place (the test days are in UTC). */
const MORNING = Date.parse(`${TODAY}T07:05:00Z`);

/**
 * A day in UTC, at -3° throughout, where model i's snow (`totals[i]` cm) falls evenly over
 * `hours`, with each model's daily totals as the providers work them out.
 */
function snowDay(date: string, totals: readonly number[], hours: readonly number[]): DayData {
  const start = Date.parse(`${date}T00:00:00Z`);
  const hourly: HourTemps[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    time: start + hour * HOUR,
    temps: totals.map(() => -3),
    rain: totals.map((t) => (hours.includes(hour) ? t / hours.length / SNOW.cmPerMm : 0)),
  }));
  return {
    date,
    models: totals.map((t, i) => ({
      id: `m${i}`,
      name: `M${i}`,
      high: null,
      feelsLike: null,
      rain: t / SNOW.cmPerMm,
      snow: t / SNOW.cmPerMm,
      snowfall: t,
      low: -3,
    })),
    hourly,
  };
}

/** Each model's snow, cm, for a day of each band (six models, as the server has). */
const TOTALS: Record<SnowBand, readonly number[]> = {
  nosnow: [0, 0, 0, 0, 0, 0],
  flakes: [0, 0, 0, 0, 0.2, 0.3],
  maybesnow: [0, 0, 0, 0, 0.8, 1.2],
  snow: [0.2, 1, 1.2, 1.5, 2, 2.4],
  heavysnow: [3, 5, 6, 7, 8, 10],
  deepsnow: [12, 15, 16, 18, 20, 25],
};

/**
 * The snow answers as the server gives them at 07:05 on TODAY: the rest of today from then (snow
 * in `todayHours`), tomorrow's whole day (snow in `tomorrowHours`), and Now.
 */
function answers(o: {
  today: readonly number[];
  tomorrow: readonly number[];
  todayHours?: readonly number[];
  tomorrowHours?: readonly number[];
  units?: Units;
}): ApiSnow {
  const units = o.units ?? 'c';
  const today = snowDay(TODAY, o.today, o.todayHours ?? [10, 11, 12, 13, 14, 15]);
  const tomorrow = snowDay(TOMORROW, o.tomorrow, o.tomorrowHours ?? [2, 3, 4, 5]);
  const series = judgeSnowSeries(snowSeries([today, tomorrow]), units, 'UTC');
  return {
    unit: snowUnit(units),
    days: [
      formatSnowDay(computeSnowDay(today, { from: MORNING })!, units),
      formatSnowDay(computeSnowDay(tomorrow)!, units),
    ],
    now: formatSnowNow(computeSnowNow(series, MORNING)!, snowUnit(units)),
  };
}

/** The same day of `band` today and tomorrow. */
const both = (band: SnowBand, units: Units = 'c'): ApiSnow =>
  answers({ today: TOTALS[band], tomorrow: TOTALS[band], units });

const ON: TopicAlertPrefs = { evening: true, morning: true, possible: true };
const PREFS: TopicAlertPrefs[] = [false, true].flatMap((evening) =>
  [false, true].flatMap((morning) =>
    [false, true].map((possible) => ({ evening, morning, possible })),
  ),
);

/** Every title for Durham, written out. */
const TITLES: Record<AlertKind, Record<'maybesnow' | 'snow' | 'heavysnow' | 'deepsnow', string>> = {
  evening: {
    maybesnow: 'Snow possible in Durham tomorrow',
    snow: 'Snow likely in Durham tomorrow',
    heavysnow: 'Heavy snow likely in Durham tomorrow',
    deepsnow: 'Deep snow likely in Durham tomorrow',
  },
  morning: {
    maybesnow: 'Snow possible in Durham today',
    snow: 'Snow likely in Durham today',
    heavysnow: 'Heavy snow likely in Durham today',
    deepsnow: 'Deep snow likely in Durham today',
  },
};

describe('snowAlert', () => {
  it('has a day of every band to judge', () => {
    for (const band of SNOW_BANDS) {
      expect(both(band).days.map((d) => d.band)).toEqual([band, band]);
      expect(both(band).now!.band).toBe('nosnow');
    }
  });

  it('sends snow or more always, snow possible only when asked, and nothing else', () => {
    for (const band of SNOW_BANDS) {
      const snow = both(band);
      for (const kind of ALERT_KINDS) {
        for (const prefs of PREFS) {
          const alert = snowAlert(snow, kind, prefs, 'Durham');
          const due = prefs[kind] && (isSnow(band) || (band === 'maybesnow' && prefs.possible));
          if (!due) {
            expect(alert, `${band} ${kind} ${JSON.stringify(prefs)}`).toBeNull();
            continue;
          }
          const day = snow.days[kind === 'evening' ? 1 : 0]!;
          expect(alert).toEqual({
            title: TITLES[kind][band as keyof (typeof TITLES)[AlertKind]],
            body: `${day.detail} ${day.agreementText}.`,
            band,
            relevance: SNOW_RELEVANCE[band as keyof typeof SNOW_RELEVANCE],
            date: kind === 'evening' ? TOMORROW : TODAY,
          });
        }
      }
    }
  });

  it('never sends for no snow or a few flakes, whatever the switches', () => {
    for (const band of ['nosnow', 'flakes'] as const) {
      for (const kind of ALERT_KINDS) expect(snowAlert(both(band), kind, ON, 'Durham')).toBeNull();
    }
  });

  it('reads tomorrow in the evening and the rest of today in the morning', () => {
    const snow = answers({ today: TOTALS.nosnow, tomorrow: TOTALS.heavysnow });
    expect(snowAlert(snow, 'evening', ON, 'Durham')!.title).toBe(
      'Heavy snow likely in Durham tomorrow',
    );
    expect(snowAlert(snow, 'morning', ON, 'Durham')).toBeNull();
    const later = answers({ today: TOTALS.deepsnow, tomorrow: TOTALS.nosnow });
    expect(snowAlert(later, 'evening', ON, 'Durham')).toBeNull();
    expect(snowAlert(later, 'morning', ON, 'Durham')!.title).toBe(
      'Deep snow likely in Durham today',
    );
  });

  it('words the Durham example exactly', () => {
    const snow = answers({ today: TOTALS.nosnow, tomorrow: TOTALS.snow });
    expect(
      snowAlert(snow, 'evening', { evening: true, morning: false, possible: false }, 'Durham'),
    ).toEqual({
      title: 'Snow likely in Durham tomorrow',
      body: '1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.',
      band: 'snow',
      relevance: 0.6,
      date: TOMORROW,
    });
  });

  it('writes amounts in the units the answer carries', () => {
    const snow = answers({ today: TOTALS.nosnow, tomorrow: TOTALS.snow, units: 'f' });
    expect(snowAlert(snow, 'evening', ON, 'Durham')!.body).toBe(
      '0.5 to 1in of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.',
    );
    const heavy = answers({ today: TOTALS.heavysnow, tomorrow: TOTALS.nosnow, units: 'f' });
    expect(snowAlert(heavy, 'morning', ON, 'Durham')!.body).toBe(
      '2 to 3in still to come. Mostly between 10am and 4pm. 6 of 6 forecasts expect snow.',
    );
  });

  it('says how much is still to come in the morning', () => {
    const snow = answers({ today: TOTALS.snow, tomorrow: TOTALS.nosnow });
    expect(snowAlert(snow, 'morning', ON, 'Durham')).toEqual({
      title: 'Snow likely in Durham today',
      body: '1 to 2cm still to come. Mostly between 10am and 4pm. 5 of 6 forecasts expect snow.',
      band: 'snow',
      relevance: 0.6,
      date: TODAY,
    });
  });

  it('words snow possible as the day does', () => {
    const snow = answers({ today: TOTALS.nosnow, tomorrow: TOTALS.maybesnow });
    expect(snowAlert(snow, 'evening', ON, 'Shrewsbury')).toEqual({
      title: 'Snow possible in Shrewsbury tomorrow',
      body: 'Some forecasts say up to 1cm. Most likely around 2am. 2 of 6 forecasts expect snow.',
      band: 'maybesnow',
      relevance: 0.3,
      date: TOMORROW,
    });
  });

  it('says it is snowing now in the morning, while it is', () => {
    const snow = answers({ today: TOTALS.snow, tomorrow: TOTALS.snow, todayHours: [7, 8, 9, 10] });
    expect(snow.now!.band).toBe('snow');
    expect(snowAlert(snow, 'morning', ON, 'Durham')).toEqual({
      title: 'Snowing in Durham now',
      body: '1 to 2cm still to come. Easing off by about 11am. 6 of 6 forecasts expect snow.',
      band: 'snow',
      relevance: 0.6,
      date: TODAY,
    });
    expect(snowAlert(snow, 'morning', ON, null)!.title).toBe('Snowing near you now');
    // The evening is about tomorrow, whatever it is doing now.
    expect(snowAlert(snow, 'evening', ON, 'Durham')!.title).toBe('Snow likely in Durham tomorrow');
  });

  it('says snowing now only from snow, and keeps the title without Now', () => {
    const day = both('heavysnow');
    for (const band of SNOW_BANDS) {
      const snow: ApiSnow = { ...day, now: { ...day.now!, band } };
      expect(snowAlert(snow, 'morning', ON, 'Durham')!.title).toBe(
        isSnow(band) ? 'Snowing in Durham now' : 'Heavy snow likely in Durham today',
      );
    }
    const { now: _, ...withoutNow } = day;
    expect(snowAlert(withoutNow, 'morning', ON, 'Durham')!.title).toBe(
      'Heavy snow likely in Durham today',
    );
  });

  it('ranks deep snow first and snow possible last', () => {
    expect(SNOW_RELEVANCE).toEqual({ deepsnow: 1, heavysnow: 0.8, snow: 0.6, maybesnow: 0.3 });
    expect(snowAlert(both('deepsnow'), 'evening', ON, 'Durham')!.relevance).toBe(1);
    expect(snowAlert(both('heavysnow'), 'evening', ON, 'Durham')!.relevance).toBe(0.8);
  });

  it('reads "near you" for a place without a town name', () => {
    const snow = both('snow');
    for (const name of [null, '', COPY.yourLocation]) {
      expect(snowAlert(snow, 'evening', ON, name)!.title).toBe('Snow likely near you tomorrow');
      expect(snowAlert(snow, 'morning', ON, name)!.title).toBe('Snow likely near you today');
    }
    expect(snowAlert(both('maybesnow'), 'evening', ON, null)!.title).toBe(
      'Snow possible near you tomorrow',
    );
    expect(snowAlert(both('deepsnow'), 'morning', ON, null)!.title).toBe(
      'Deep snow likely near you today',
    );
  });

  it('sends nothing for a day the answer does not have', () => {
    const snow = both('snow');
    expect(snowAlert({ ...snow, days: snow.days.slice(0, 1) }, 'evening', ON, 'Durham')).toBeNull();
    expect(snowAlert({ ...snow, days: [] }, 'morning', ON, 'Durham')).toBeNull();
  });

  it('counts the forecasts there were, when there are few', () => {
    const snow = answers({ today: [0, 0], tomorrow: [1, 2] });
    expect(snowAlert(snow, 'evening', ON, 'Durham')!.body).toBe(
      'About 2cm of snow. Mostly between 2am and 6am. 2 of 2 forecasts expect snow.',
    );
  });

  it("is snow's rule for the run", () => {
    const snow = both('snow');
    expect(SNOW_ALERT_RULE.topic).toBe('snow');
    expect(SNOW_ALERT_RULE.decide).toBe(snowAlert);
    expect(SNOW_ALERT_RULE.pick({ snow } as TodayResponse)).toBe(snow);
    expect(SNOW_ALERT_RULE.pick({} as TodayResponse)).toBeUndefined();
  });
});

describe('notification copy', () => {
  it('has every title', () => {
    expect(alertText(ALERT_COPY.titles.evening.snow, 'Leeds')).toBe(
      'Snow likely in Leeds tomorrow',
    );
    expect(alertText(ALERT_COPY.titles.evening.heavysnow, 'Leeds')).toBe(
      'Heavy snow likely in Leeds tomorrow',
    );
    expect(alertText(ALERT_COPY.titles.evening.deepsnow, 'Leeds')).toBe(
      'Deep snow likely in Leeds tomorrow',
    );
    expect(alertText(ALERT_COPY.titles.evening.maybesnow, 'Leeds')).toBe(
      'Snow possible in Leeds tomorrow',
    );
    expect(alertText(ALERT_COPY.titles.morning.snow, 'Leeds')).toBe('Snow likely in Leeds today');
    expect(alertText(ALERT_COPY.titles.morning.heavysnow, 'Leeds')).toBe(
      'Heavy snow likely in Leeds today',
    );
    expect(alertText(ALERT_COPY.titles.morning.deepsnow, 'Leeds')).toBe(
      'Deep snow likely in Leeds today',
    );
    expect(alertText(ALERT_COPY.titles.morning.maybesnow, 'Leeds')).toBe(
      'Snow possible in Leeds today',
    );
    expect(alertText(ALERT_COPY.snowingNow, 'Leeds')).toBe('Snowing in Leeds now');
  });

  it('has the test notification', () => {
    expect(testAlert('Leeds')).toEqual({
      title: 'Test notification',
      body: "Notifications are working. We'll tell you when snow is likely in Leeds.",
    });
    expect(testAlert(null)).toEqual({
      title: 'Test notification',
      body: "Notifications are working. We'll tell you when snow is likely near you.",
    });
    expect(testAlert(COPY.yourLocation).body).toBe(
      "Notifications are working. We'll tell you when snow is likely near you.",
    );
  });

  it('builds the body from the detail and the agreement', () => {
    expect(alertBody('About 3cm still to come.', '5 of 6 forecasts expect snow')).toBe(
      'About 3cm still to come. 5 of 6 forecasts expect snow.',
    );
  });

  it('names the place as it is written, "$" and all', () => {
    expect(alertWhere('Leeds')).toBe('in Leeds');
    expect(alertWhere(null)).toBe('near you');
    expect(alertWhere(COPY.yourLocation)).toBe('near you');
    expect(alertText(ALERT_COPY.snowingNow, 'A$&B $1')).toBe('Snowing in A$&B $1 now');
  });
});

describe('every notification', () => {
  /** Every string in a nested copy object. */
  const strings = (o: unknown): string[] =>
    typeof o === 'string' ? [o] : Object.values(o as object).flatMap(strings);

  /** Days of every band, with snow at different times, so every kind of detail is worded. */
  const PATTERNS: readonly (readonly number[])[] = [
    [2, 3, 4, 5],
    [7],
    [7, 8, 9, 10],
    [16, 17, 18, 19, 20, 21, 22, 23],
    Array.from({ length: 24 }, (_, h) => h),
    [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 23],
    [9, 21],
  ];

  function everything(): { title: string; body: string; name: string | null }[] {
    const out: { title: string; body: string; name: string | null }[] = [];
    for (const band of SNOW_BANDS) {
      for (const hours of PATTERNS) {
        for (const units of ['c', 'f'] as const) {
          const snow = answers({
            today: TOTALS[band],
            tomorrow: TOTALS[band],
            todayHours: hours,
            tomorrowHours: hours,
            units,
          });
          for (const kind of ALERT_KINDS) {
            for (const prefs of PREFS) {
              for (const name of ['Durham', 'Bishop Auckland', null, COPY.yourLocation]) {
                const alert = snowAlert(snow, kind, prefs, name);
                if (alert) out.push({ title: alert.title, body: alert.body, name });
              }
            }
          }
        }
      }
    }
    for (const name of ['Durham', null]) out.push({ ...testAlert(name), name });
    return out;
  }

  const all = everything();

  it('covers a good spread of what can be sent', () => {
    expect(new Set(all.map((a) => a.title)).size).toBeGreaterThanOrEqual(20);
    expect(new Set(all.map((a) => a.body)).size).toBeGreaterThanOrEqual(30);
  });

  it('never says warning, danger or alert, in any case or inside another word', () => {
    const banned = /warning|danger|alert/i;
    for (const text of strings(ALERT_COPY)) expect(text).not.toMatch(banned);
    for (const { title, body } of all) {
      expect(title).not.toMatch(banned);
      expect(body).not.toMatch(banned);
    }
    expect('Alerts').toMatch(banned);
    expect('a WARNING').toMatch(banned);
    expect('endangered').toMatch(banned);
  });

  it('names no other weather type, app or website', () => {
    const others =
      /\b(rain|rainy|wet|showers?|wind|windy|breezy|gusts?|gales?|storms?|hot|heat|warm|sun|sunny|uv)\b|isithot|isitwet|isitwindy|willitsnow|\.today|https?:|www\.|\bapps?\b|website/i;
    for (const text of strings(ALERT_COPY)) expect(text).not.toMatch(others);
    for (const { title, body } of all) {
      expect(title).not.toMatch(others);
      expect(body).not.toMatch(others);
    }
  });

  it('is in sentence case, about snow, with full stops on the body only', () => {
    for (const { title, body, name } of all) {
      const rest = name && name !== COPY.yourLocation ? title.replace(name, '') : title;
      expect(rest).toMatch(/^[A-Z][^A-Z]*$/);
      if (title !== ALERT_COPY.test.title) expect(title).toMatch(/snow/i);
      expect(title).not.toMatch(/\.$/);
      expect(body).toMatch(/^[A-Z0-9].*\.$/);
      expect(body).not.toMatch(/ {2}|\.\.| \./);
    }
  });
});

/** The moment a local time happens where the clocks are `offset` minutes ahead of UTC. */
const instant = (date: string, time: string, offset: number): Date =>
  new Date(Date.parse(`${date}T${time}:00Z`) - offset * 60_000);

const EDGES: readonly [string, AlertKind | null][] = [
  ['06:59', null],
  ['07:00', 'morning'],
  ['08:59', 'morning'],
  ['09:00', null],
  ['17:59', null],
  ['18:00', 'evening'],
  ['19:59', 'evening'],
  ['20:00', null],
];

/** Zones, local dates and their offsets from UTC that day, minutes, around clock changes. */
const DAYS: readonly [string, string, number][] = [
  // UK clocks go back at 02:00 BST on 25 October 2026 and forward at 01:00 GMT on 28 March 2027.
  ['Europe/London', '2026-10-24', 60],
  ['Europe/London', '2026-10-25', 0],
  ['Europe/London', '2026-10-26', 0],
  ['Europe/London', '2027-03-27', 0],
  ['Europe/London', '2027-03-28', 60],
  ['Asia/Kolkata', '2026-10-25', 330],
  ['Asia/Kolkata', '2027-03-28', 330],
  ['Asia/Kathmandu', '2026-10-25', 345],
  ['Asia/Kathmandu', '2027-03-28', 345],
  // Adelaide's clocks go forward on 4 October 2026 and back on 4 April 2027, in the night.
  ['Australia/Adelaide', '2026-10-03', 570],
  ['Australia/Adelaide', '2026-10-04', 630],
  ['Australia/Adelaide', '2026-10-25', 630],
  ['Australia/Adelaide', '2027-03-28', 630],
  ['Australia/Adelaide', '2027-04-04', 570],
  ['Pacific/Kiritimati', '2026-10-25', 840],
  ['Pacific/Kiritimati', '2027-03-28', 840],
  ['Pacific/Pago_Pago', '2026-10-25', -660],
  ['Pacific/Pago_Pago', '2027-03-28', -660],
];

describe('alertWindows', () => {
  it('opens each window on the hour at the place and closes it on the hour', () => {
    for (const [tz, date, offset] of DAYS) {
      for (const [time, kind] of EDGES) {
        const at = instant(date, time, offset);
        const hours = Number(time.slice(0, 2)) + Number(time.slice(3)) / 60;
        expect(alertWindows(tz, at), `${tz} ${date} ${time}`).toEqual({ date, hours, kind });
      }
    }
  });

  it("gives the place's own date, a day either side of UTC's", () => {
    // 07:00 on 25 October at Kiritimati (UTC+14) is still the 24th in UTC.
    expect(alertWindows('Pacific/Kiritimati', new Date('2026-10-24T17:00:00Z'))).toEqual({
      date: '2026-10-25',
      hours: 7,
      kind: 'morning',
    });
    // 19:00 on 25 October at Pago Pago (UTC-11) is already the 26th in UTC.
    expect(alertWindows('Pacific/Pago_Pago', new Date('2026-10-26T06:00:00Z'))).toEqual({
      date: '2026-10-25',
      hours: 19,
      kind: 'evening',
    });
  });

  it('is in no window through the hour the clocks go back', () => {
    // 01:30 BST, then 01:30 GMT an hour later.
    for (const iso of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
      expect(alertWindows('Europe/London', new Date(iso))).toEqual({
        date: '2026-10-25',
        hours: 1.5,
        kind: null,
      });
    }
  });

  it('reads an unknown zone as UTC', () => {
    expect(alertWindows('Not/A_Zone', new Date('2026-12-01T18:05:00Z'))).toEqual({
      date: '2026-12-01',
      hours: 18 + 5 / 60,
      kind: 'evening',
    });
    expect(alertWindows('Not/A_Zone', new Date('2026-12-01T09:00:00Z')).kind).toBeNull();
  });
});

describe('quiet hours', () => {
  it('runs from 21:00 to 06:59 at the place, across clock changes', () => {
    const cases: [string, string, boolean][] = [
      // 20:59 and 21:00 BST, the night before the clocks go back.
      ['Europe/London', '2026-10-24T19:59:00Z', false],
      ['Europe/London', '2026-10-24T20:00:00Z', true],
      // 01:30 BST and 01:30 GMT, then 06:59 and 07:00 GMT.
      ['Europe/London', '2026-10-25T00:30:00Z', true],
      ['Europe/London', '2026-10-25T01:30:00Z', true],
      ['Europe/London', '2026-10-25T06:59:00Z', true],
      ['Europe/London', '2026-10-25T07:00:00Z', false],
      ['Europe/London', '2026-10-25T20:59:00Z', false],
      ['Europe/London', '2026-10-25T21:00:00Z', true],
      // 20:59 and 21:00 GMT, then 06:59 and 07:00 BST once the clocks have gone forward.
      ['Europe/London', '2027-03-27T20:59:00Z', false],
      ['Europe/London', '2027-03-27T21:00:00Z', true],
      ['Europe/London', '2027-03-28T05:59:00Z', true],
      ['Europe/London', '2027-03-28T06:00:00Z', false],
      // 20:59 and 21:00, 06:59 and 07:00 in Kathmandu (UTC+5:45).
      ['Asia/Kathmandu', '2026-10-25T15:14:00Z', false],
      ['Asia/Kathmandu', '2026-10-25T15:15:00Z', true],
      ['Asia/Kathmandu', '2026-10-25T01:14:00Z', true],
      ['Asia/Kathmandu', '2026-10-25T01:15:00Z', false],
      ['Not/A_Zone', '2026-12-01T21:00:00Z', true],
      ['Not/A_Zone', '2026-12-01T07:00:00Z', false],
    ];
    for (const [tz, iso, quiet] of cases) expect(inQuietHours(tz, new Date(iso)), iso).toBe(quiet);
  });

  // The sender's own checks (packages/server), from when it had a helper of its own.
  it('is quiet from 21:00 to 06:59 in London in winter and in summer', () => {
    const cases: [string, boolean][] = [
      // Winter (GMT).
      ['2026-12-01T20:59:59Z', false],
      ['2026-12-01T21:00:00Z', true],
      ['2026-12-02T06:59:00Z', true],
      ['2026-12-02T07:00:00Z', false],
      // Summer (BST): 21:00 is 20:00 UTC, and 07:00 is 06:00 UTC.
      ['2026-07-01T19:59:00Z', false],
      ['2026-07-01T20:00:00Z', true],
      ['2026-07-01T06:00:00Z', false],
    ];
    for (const [iso, quiet] of cases) {
      expect(inQuietHours('Europe/London', new Date(iso)), iso).toBe(quiet);
    }
  });

  it('follows quarter-hour zones and both sides of the date line', () => {
    const cases: [string, string, boolean][] = [
      // Kathmandu is UTC+5:45: 21:00 there is 15:15 UTC.
      ['Asia/Kathmandu', '2026-12-01T15:14:00Z', false],
      ['Asia/Kathmandu', '2026-12-01T15:15:00Z', true],
      // Kiritimati is UTC+14 (07:00 is 17:00 UTC the day before), Pago Pago UTC-11.
      ['Pacific/Kiritimati', '2026-12-01T16:59:00Z', true],
      ['Pacific/Kiritimati', '2026-12-01T17:00:00Z', false],
      ['Pacific/Pago_Pago', '2026-12-02T07:59:00Z', false],
      ['Pacific/Pago_Pago', '2026-12-02T08:00:00Z', true],
    ];
    for (const [tz, iso, quiet] of cases) expect(inQuietHours(tz, new Date(iso)), iso).toBe(quiet);
  });

  it('reads an unknown zone as UTC, as the windows do', () => {
    // So the run and the sender agree: in a window by UTC's clock, and quiet by it too.
    const evening = new Date('2026-12-01T18:05:00Z');
    expect(alertWindows('Mars/Olympus_Mons', evening).kind).toBe('evening');
    expect(inQuietHours('Mars/Olympus_Mons', evening)).toBe(false);
    expect(inQuietHours('Mars/Olympus_Mons', new Date('2026-12-01T22:00:00Z'))).toBe(true);
    expect(inQuietHours('Mars/Olympus_Mons', new Date('2026-12-01T12:00:00Z'))).toBe(false);
  });

  it('takes other hours, including ones that do not cross midnight', () => {
    const at = (iso: string) => new Date(iso);
    expect(inQuietHours('UTC', at('2026-12-01T00:59:00Z'), { from: 1, to: 5 })).toBe(false);
    expect(inQuietHours('UTC', at('2026-12-01T02:00:00Z'), { from: 1, to: 5 })).toBe(true);
    expect(inQuietHours('UTC', at('2026-12-01T05:00:00Z'), { from: 1, to: 5 })).toBe(false);
    // The default is ALERTS.quiet.
    expect(inQuietHours('UTC', at('2026-12-01T22:00:00Z'), ALERTS.quiet)).toBe(true);
    expect(inQuietHours('UTC', at('2026-12-01T22:00:00Z'), { from: 1, to: 5 })).toBe(false);
  });

  it('never falls in a window', () => {
    for (const [tz, date] of DAYS) {
      const start = Date.parse(`${date}T00:00:00Z`) - 14 * HOUR;
      for (let t = start; t < start + 52 * HOUR; t += 60_000) {
        const at = new Date(t);
        if (alertWindows(tz, at).kind)
          expect(inQuietHours(tz, at), `${tz} ${at.toISOString()}`).toBe(false);
      }
    }
  });
});

describe('expiresAt', () => {
  it('is 21:00 at the place for the evening and 11:00 for the morning, in Unix seconds', () => {
    const cases: [string, AlertKind, string, string][] = [
      ['Europe/London', 'evening', '2026-10-24', '2026-10-24T20:00:00Z'],
      ['Europe/London', 'morning', '2026-10-25', '2026-10-25T11:00:00Z'],
      ['Europe/London', 'evening', '2026-10-25', '2026-10-25T21:00:00Z'],
      ['Europe/London', 'morning', '2027-03-27', '2027-03-27T11:00:00Z'],
      ['Europe/London', 'morning', '2027-03-28', '2027-03-28T10:00:00Z'],
      ['Europe/London', 'evening', '2027-03-28', '2027-03-28T20:00:00Z'],
      ['Asia/Kolkata', 'morning', '2026-10-25', '2026-10-25T05:30:00Z'],
      ['Asia/Kolkata', 'evening', '2026-10-25', '2026-10-25T15:30:00Z'],
      ['Asia/Kathmandu', 'morning', '2027-03-28', '2027-03-28T05:15:00Z'],
      ['Asia/Kathmandu', 'evening', '2027-03-28', '2027-03-28T15:15:00Z'],
      ['Australia/Adelaide', 'morning', '2026-10-03', '2026-10-03T01:30:00Z'],
      ['Australia/Adelaide', 'morning', '2026-10-04', '2026-10-04T00:30:00Z'],
      ['Australia/Adelaide', 'evening', '2026-10-04', '2026-10-04T10:30:00Z'],
      ['Australia/Adelaide', 'evening', '2027-04-03', '2027-04-03T10:30:00Z'],
      ['Australia/Adelaide', 'evening', '2027-04-04', '2027-04-04T11:30:00Z'],
      ['Pacific/Kiritimati', 'morning', '2026-10-25', '2026-10-24T21:00:00Z'],
      ['Pacific/Kiritimati', 'evening', '2026-10-25', '2026-10-25T07:00:00Z'],
      ['Pacific/Pago_Pago', 'morning', '2026-10-25', '2026-10-25T22:00:00Z'],
      ['Pacific/Pago_Pago', 'evening', '2026-10-25', '2026-10-26T08:00:00Z'],
      ['Not/A_Zone', 'evening', '2026-12-01', '2026-12-01T21:00:00Z'],
      ['Not/A_Zone', 'morning', '2026-12-01', '2026-12-01T11:00:00Z'],
    ];
    for (const [tz, kind, date, iso] of cases) {
      expect(expiresAt(tz, kind, date), `${tz} ${kind} ${date}`).toBe(Date.parse(iso) / 1000);
    }
  });

  it('allows for the clocks changing between its guess and the answer', () => {
    // Adak (UTC-10, -9 in summer) springs forward at 02:00 on 14 March 2027, an hour after the
    // guess (11:00 UTC) and before the answer: 11:00 HDT is 20:00 UTC, not 21:00.
    expect(expiresAt('America/Adak', 'morning', '2027-03-14')).toBe(
      Date.parse('2027-03-14T20:00:00Z') / 1000,
    );
    expect(expiresAt('America/Adak', 'morning', '2026-11-01')).toBe(
      Date.parse('2026-11-01T21:00:00Z') / 1000,
    );
  });

  it('is after the window it ends and never later than the quiet hours start', () => {
    for (const [tz, date, offset] of DAYS) {
      for (const kind of ALERT_KINDS) {
        const end = instant(date, `${ALERTS.windows[kind].to}:00`.padStart(5, '0'), offset);
        const expiry = expiresAt(tz, kind, date) * 1000;
        expect(expiry).toBeGreaterThan(end.getTime());
        expect(localDateTime(tz, new Date(expiry))).toEqual({
          date,
          hours: ALERTS.windows[kind].expireAt,
        });
      }
      expect(localDateTime(tz, new Date(expiresAt(tz, 'evening', date) * 1000)).hours).toBe(
        ALERTS.quiet.from,
      );
    }
  });
});

describe('collapseId', () => {
  it('names the topic, the kind and the day it is about', () => {
    expect(collapseId('snow', 'evening', '2026-12-02')).toBe('snow-evening-2026-12-02');
    expect(collapseId('snow', 'morning', '2026-12-02')).toBe('snow-morning-2026-12-02');
    // Apple allows 64 bytes.
    for (const topic of TOPICS) {
      for (const kind of ALERT_KINDS) {
        expect(
          new TextEncoder().encode(collapseId(topic, kind, '2026-12-02')).length,
        ).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe('ALERTS', () => {
  it('is as the spec sets it', () => {
    expect(ALERTS).toEqual({
      windows: {
        evening: { from: 18, to: 20, expireAt: 21 },
        morning: { from: 7, to: 9, expireAt: 11 },
      },
      quiet: { from: 21, to: 7 },
      runBudgetMs: 20_000,
      syncBudgetMs: 7_000,
      maxForecastFetchesPerRun: { free: 60, paid: 300 },
      fetchConcurrency: 4,
      apnsConcurrency: 20,
      staleAfterDays: 90,
      heartbeatDays: 7,
      apnsPriority: { evening: 5, morning: 10 },
      testPerHour: 3,
    });
  });

  it('keeps every window out of the quiet hours, with time to deliver before they start', () => {
    for (const kind of ALERT_KINDS) {
      const w = ALERTS.windows[kind];
      expect(w.from).toBeLessThan(w.to);
      expect(w.to).toBeLessThan(w.expireAt);
      expect(w.expireAt).toBeLessThanOrEqual(ALERTS.quiet.from);
      expect(w.from).toBeGreaterThanOrEqual(ALERTS.quiet.to);
    }
  });
});
