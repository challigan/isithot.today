import { describe, expect, it } from 'vitest';
import { localDateTime, showsTomorrow } from '@isithot/core';
import { usableUntil } from '../src/freshness';
import { pickHour } from '../src/hours';
import type { AppResponse } from '../src/types';
import { widgetEntries, type WidgetEntry } from '../src/widget';
import { HOUR, MINUTE, STALE, answer, hourStart, snowDay } from './fixtures';

const at = (s: string): number => Date.parse(s);

/**
 * A widget planning from an answer fetched five minutes into the place's hour (or `fetched`
 * before `now`), as the app would have saved it.
 */
function plan(
  tz: string,
  now: number,
  o: { fetched?: number; ahead?: number; updatedAt?: number } = {},
) {
  const made = o.fetched ?? hourStart(tz, now) + 5 * MINUTE;
  const res = answer({ tz, at: made, ahead: o.ahead, updatedAt: o.updatedAt });
  return { res, made, ...widgetEntries(res, { fetchedAt: made, now, unlocked: true }) };
}

/** What every plan holds to, whatever the place and the time. */
function expectSound(res: AppResponse, now: number, entries: WidgetEntry[]): void {
  const until = usableUntil(res);
  const stale = entries.at(-1)!;
  expect(stale).toMatchObject({ date: until, state: 'stale', day: null, palette: 'nosnow' });
  const ok = entries.slice(0, -1);
  expect(ok[0]!.date).toBe(now);
  // One entry at each hour ahead after now, and nothing at or past the end.
  expect(ok.slice(1).map((e) => e.date)).toEqual(
    res.snow!.ahead!.map((a) => at(a.time)).filter((t) => t > now && t < until),
  );
  for (const e of ok) {
    const tomorrow = showsTomorrow(res, e.date);
    const day = tomorrow ? res.snow!.days[1]! : pickHour(res, e.date)!.today!;
    expect(e).toMatchObject({ state: 'ok', slot: tomorrow ? 'tomorrow' : 'today', day });
    expect(e.palette).toBe(day.band);
    // Up to four days, from the day after the middle one.
    expect(e.week.length).toBeLessThanOrEqual(4);
    expect(e.week.length).toBeGreaterThan(0);
    expect(e.week[0]!.date > day.date).toBe(true);
  }
}

/** Each entry's local time and slot, to read the plan as the place sees it. */
const readable = (tz: string, entries: WidgetEntry[]) =>
  entries.map((e) => {
    const local = localDateTime(tz, new Date(e.date));
    const h = Math.floor(local.hours);
    const m = Math.round((local.hours - h) * 60);
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return `${local.date} ${time} ${e.state === 'ok' ? e.slot : e.state}`;
  });

describe('widgetEntries: an ordinary day in London', () => {
  const LONDON = 'Europe/London';

  it('turns Today into Tomorrow at 6pm', () => {
    const now = at('2026-12-01T17:59:00Z');
    const { res, entries, reloadAt, made } = plan(LONDON, now);
    expect(readable(LONDON, entries)).toEqual([
      '2026-12-01 17:59 today',
      '2026-12-01 18:00 tomorrow',
      '2026-12-01 19:00 tomorrow',
      '2026-12-01 20:00 tomorrow',
      '2026-12-01 21:00 tomorrow',
      '2026-12-01 22:00 tomorrow',
      '2026-12-01 23:00 tomorrow',
      // Fetched at 5:05pm: too old to show from 11:05pm.
      '2026-12-01 23:05 stale',
    ]);
    expectSound(res, now, entries);
    expect(reloadAt).toBe(made + 4 * HOUR);
    const snow = res.snow!;
    expect(entries[0]).toEqual({
      date: now,
      state: 'ok',
      placeName: 'London',
      slot: 'today',
      day: snow.days[0],
      now: { answer: snow.now!.answer, verdict: snow.now!.verdict, band: snow.now!.band },
      week: snow.week!.days.slice(1, 5).map(({ chance: _c, reason: _r, ...d }) => d),
      palette: 'nosnow',
    });
    // From 6pm the list starts the day after tomorrow.
    expect(entries[1]!.week.map((d) => d.date)).toEqual([
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ]);
    expect(entries[1]!.now).toEqual({
      answer: snow.ahead![0]!.now.answer,
      verdict: snow.ahead![0]!.now.verdict,
      band: snow.ahead![0]!.now.band,
    });
  });

  it('opens at 6pm on Tomorrow', () => {
    const now = at('2026-12-01T18:00:00Z');
    const { res, entries } = plan(LONDON, now);
    expect(entries[0]).toMatchObject({ slot: 'tomorrow', day: res.snow!.days[1] });
    expectSound(res, now, entries);
  });

  it('turns Tomorrow back into Today at midnight, on the new date', () => {
    const now = at('2026-12-01T23:30:00Z');
    const { res, entries } = plan(LONDON, now);
    expect(readable(LONDON, entries)).toEqual([
      '2026-12-01 23:30 tomorrow',
      '2026-12-02 00:00 today',
      '2026-12-02 01:00 today',
      '2026-12-02 02:00 today',
      '2026-12-02 03:00 today',
      '2026-12-02 04:00 today',
      '2026-12-02 05:00 today',
      '2026-12-02 05:05 stale',
    ]);
    expect(entries[1]!.day).toBe(res.snow!.ahead![0]!.today);
    expect(entries[1]!.day!.date).toBe('2026-12-02');
    expect(entries[1]!.week[0]!.date).toBe('2026-12-03');
    expectSound(res, now, entries);
  });

  it('starts after midnight on the new date’s answer', () => {
    const now = at('2026-12-02T00:30:00Z');
    const { res, entries } = plan(LONDON, now);
    expect(entries[0]).toMatchObject({ slot: 'today', day: res.snow!.days[0] });
    expect(entries[0]!.day!.date).toBe('2026-12-02');
    expectSound(res, now, entries);
  });

  it('wears the middle day’s band', () => {
    const now = at('2026-12-01T17:59:00Z');
    const made = at('2026-12-01T17:05:00Z');
    const res = answer({ tz: LONDON, at: made });
    res.snow!.days[1] = snowDay('2026-12-02', at('2026-12-02T00:00:00Z'), false, 'heavysnow');
    res.snow!.days[0]!.band = 'flakes';
    const { entries } = widgetEntries(res, { fetchedAt: made, now, unlocked: true });
    expect(entries.map((e) => e.palette)).toEqual([
      'flakes',
      ...Array(6).fill('heavysnow'),
      'nosnow',
    ]);
  });
});

describe('widgetEntries: the clocks change', () => {
  const LONDON = 'Europe/London';

  it('plans each real hour on the autumn change, 25 October 2026', () => {
    // 1:30am happens twice: 00:30 and 01:30 UTC.
    for (const now of [
      at('2026-10-25T00:30:00+01:00'),
      at('2026-10-25T01:30:00+01:00'),
      at('2026-10-25T01:30:00Z'),
    ]) {
      const { res, entries } = plan(LONDON, now);
      expectSound(res, now, entries);
      expect(entries.slice(1, -1).every((e, i) => e.date === entries[1]!.date + i * HOUR)).toBe(
        true,
      );
    }
    const { entries } = plan(LONDON, at('2026-10-25T00:30:00+01:00'));
    expect(readable(LONDON, entries)).toEqual([
      '2026-10-25 00:30 today',
      '2026-10-25 01:00 today',
      '2026-10-25 01:00 today',
      '2026-10-25 02:00 today',
      '2026-10-25 03:00 today',
      '2026-10-25 04:00 today',
      '2026-10-25 05:00 today',
      // Fetched at 00:05 BST, six hours before 05:05 GMT.
      '2026-10-25 05:05 stale',
    ]);
    for (const [time, slot] of [
      ['2026-10-25T17:59:00Z', 'today'],
      ['2026-10-25T18:00:00Z', 'tomorrow'],
    ] as const) {
      const { res, entries: later } = plan(LONDON, at(time));
      expectSound(res, at(time), later);
      expect(later[0]!.slot).toBe(slot);
    }
  });

  it('skips the missing hour on the spring change, 28 March 2027', () => {
    const { res, entries } = plan(LONDON, at('2027-03-28T00:30:00Z'));
    expectSound(res, at('2027-03-28T00:30:00Z'), entries);
    expect(readable(LONDON, entries).slice(0, 3)).toEqual([
      '2027-03-28 00:30 today',
      '2027-03-28 02:00 today',
      '2027-03-28 03:00 today',
    ]);
    // 1:30am does not exist there that night; 01:30 UTC is 2:30am.
    for (const time of ['2027-03-28T01:30:00Z', '2027-03-28T17:59:00+01:00']) {
      const later = plan(LONDON, at(time));
      expectSound(later.res, at(time), later.entries);
      expect(later.entries[0]!.slot).toBe('today');
    }
    const six = plan(LONDON, at('2027-03-28T18:00:00+01:00'));
    expectSound(six.res, at('2027-03-28T18:00:00+01:00'), six.entries);
    expect(six.entries[0]!.slot).toBe('tomorrow');
  });
});

describe('widgetEntries: zones off the hour, and the date line', () => {
  it('turns at 6pm in Kathmandu (+5:45), Adelaide (+10:30) and Kiritimati (+14)', () => {
    for (const [tz, six] of [
      ['Asia/Kathmandu', '2026-12-01T12:15:00Z'],
      ['Australia/Adelaide', '2026-12-01T07:30:00Z'],
      ['Pacific/Kiritimati', '2026-12-01T04:00:00Z'],
    ] as const) {
      const before = plan(tz, at(six) - MINUTE);
      expectSound(before.res, at(six) - MINUTE, before.entries);
      expect(readable(tz, before.entries).slice(0, 2), tz).toEqual([
        '2026-12-01 17:59 today',
        '2026-12-01 18:00 tomorrow',
      ]);
      const after = plan(tz, at(six));
      expectSound(after.res, at(six), after.entries);
      expect(after.entries[0]!.slot, tz).toBe('tomorrow');
    }
  });

  it('starts the new date after midnight in Kiritimati', () => {
    const now = at('2026-12-01T10:30:00Z');
    const { res, entries } = plan('Pacific/Kiritimati', now);
    expectSound(res, now, entries);
    expect(readable('Pacific/Kiritimati', entries)[0]).toBe('2026-12-02 00:30 today');
  });
});

describe('widgetEntries: when the answer runs out', () => {
  const LONDON = 'Europe/London';
  const now = at('2026-12-01T15:20:00Z');

  it('plans the stale state at the server’s stale limit for an older forecast', () => {
    const updatedAt = now - 4 * HOUR;
    const { res, entries } = plan(LONDON, now, { fetched: now, updatedAt });
    expectSound(res, now, entries);
    expect(entries.at(-1)!.date).toBe(updatedAt + STALE);
    expect(entries.at(-2)!.date).toBe(at('2026-12-01T17:00:00Z'));
  });

  it('plans it at the end of the answer’s hour without hours ahead, as the website asks', () => {
    const { res, entries } = plan(LONDON, now, { fetched: now, ahead: 0 });
    expect(entries.map((e) => [e.date, e.state])).toEqual([
      [now, 'ok'],
      [at('2026-12-01T16:00:00Z'), 'stale'],
    ]);
    expect(entries[0]!.day).toBe(res.snow!.days[0]);
  });

  it('plans it when the last hour ahead ends first', () => {
    const { res, entries, reloadAt } = plan(LONDON, now, { fetched: now, ahead: 2 });
    expectSound(res, now, entries);
    expect(entries.map((e) => e.date)).toEqual([
      now,
      at('2026-12-01T16:00:00Z'),
      at('2026-12-01T17:00:00Z'),
      at('2026-12-01T18:00:00Z'),
    ]);
    expect(reloadAt).toBe(at('2026-12-01T18:00:00Z'));
  });

  it('shows the stale state at once for a forecast too old, and tries again in an hour', () => {
    const res = answer({ tz: LONDON, at: now - 7 * HOUR });
    expect(widgetEntries(res, { fetchedAt: now - 7 * HOUR, now, unlocked: true })).toEqual({
      entries: [
        {
          date: now,
          state: 'stale',
          placeName: 'London',
          slot: 'today',
          day: null,
          now: null,
          week: [],
          palette: 'nosnow',
        },
      ],
      reloadAt: now + HOUR,
    });
  });

  it('tries again in an hour with no answer at all, or one fetched too long ago', () => {
    expect(widgetEntries(null, { fetchedAt: 0, now, unlocked: true })).toMatchObject({
      entries: [{ date: now, state: 'stale', placeName: '' }],
      reloadAt: now + HOUR,
    });
    expect(
      widgetEntries(null, { fetchedAt: 0, now, unlocked: true, placeName: 'Leeds' }).entries[0],
    ).toMatchObject({ placeName: 'Leeds' });
    // Fetched 4 hours ago and still usable for a while: due a refetch now, so one is tried.
    const res = answer({ tz: LONDON, at: now - 4 * HOUR + MINUTE });
    const planned = widgetEntries(res, { fetchedAt: now - 4 * HOUR, now, unlocked: true });
    expect(planned.entries[0]!.state).toBe('ok');
    expect(planned.reloadAt).toBe(now + HOUR);
  });
});

describe('widgetEntries: locked, and what an answer may lack', () => {
  const now = at('2026-12-01T18:30:00Z');
  const made = at('2026-12-01T18:05:00Z');
  const res = answer({ tz: 'Europe/London', at: made, name: 'Durham' });

  it('is one locked entry, never reloaded, until the widgets are bought', () => {
    expect(widgetEntries(res, { fetchedAt: made, now, unlocked: false })).toEqual({
      entries: [
        {
          date: now,
          state: 'locked',
          placeName: 'Durham',
          slot: 'today',
          day: null,
          now: null,
          week: [],
          palette: 'nosnow',
        },
      ],
      reloadAt: 'never',
    });
    expect(
      widgetEntries(null, { fetchedAt: made, now, unlocked: false, placeName: 'My location' })
        .entries[0]!.placeName,
    ).toBe('My location');
  });

  it('names the place as the app does, and leaves out what the answer lacks', () => {
    const snow = res.snow!;
    const bare: AppResponse = {
      ...res,
      snow: { ...snow, now: undefined, week: undefined, days: snow.days.slice(0, 1), ahead: [] },
    };
    const { entries } = widgetEntries(bare, {
      fetchedAt: made,
      now,
      unlocked: true,
      placeName: 'Home',
    });
    expect(entries[0]).toEqual({
      date: now,
      state: 'ok',
      placeName: 'Home',
      slot: 'tomorrow',
      day: null,
      now: null,
      week: [],
      palette: 'nosnow',
    });
    // Without its middle day, the list starts with the first day there is.
    const noTomorrow: AppResponse = { ...res, snow: { ...snow, days: snow.days.slice(0, 1) } };
    const first = widgetEntries(noTomorrow, { fetchedAt: made, now, unlocked: true }).entries[0]!;
    expect(first.week.map((d) => d.date)).toEqual(snow.week!.days.slice(0, 4).map((d) => d.date));
  });
});
