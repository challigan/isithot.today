import { describe, expect, it } from 'vitest';
import { clockTime, localDateTime, updatedTime, viewLabel, zoneAbbreviation } from '@isithot/core';
import { middleDay, pickHour, updatedLine } from '../src/hours';
import { HOUR, MINUTE, answer } from './fixtures';

const LONDON = 'Europe/London';
const at = (s: string): number => Date.parse(s);

describe('pickHour', () => {
  // Answered at 3:20pm on a winter's day in London, with hours ahead from 4pm to 9pm.
  const made = at('2026-12-01T15:20:00Z');
  const res = answer({ tz: LONDON, at: made });
  const snow = res.snow!;
  const ahead = snow.ahead!;

  it('keeps the answer’s own until the first hour ahead', () => {
    const own = {
      start: null,
      end: at('2026-12-01T16:00:00Z'),
      now: snow.now,
      today: snow.days[0],
      week: snow.week,
      source: 'response',
    };
    expect(pickHour(res, made)).toEqual(own);
    expect(pickHour(res, at('2026-12-01T15:59:59.999Z'))).toEqual(own);
    // A clock running behind the server's: still the answer's own.
    expect(pickHour(res, made - 2 * HOUR)).toEqual(own);
  });

  it('takes each hour ahead from its start to the next one’s', () => {
    for (const [i, entry] of ahead.entries()) {
      const start = at(entry.time);
      const picked = { start, now: entry.now, today: entry.today, week: entry.week };
      expect(pickHour(res, start)).toMatchObject({ ...picked, source: 'ahead' });
      // The last one ends early, with the forecast (below).
      if (i < ahead.length - 1) {
        expect(pickHour(res, start + HOUR - 1)).toMatchObject({ ...picked, end: start + HOUR });
      }
    }
  });

  it('stops at the server’s stale limit, or at the end of the last hour ahead', () => {
    // Fetched at 3:20pm, the forecast is too old to show from 9:20pm: the 9pm hour ends there.
    expect(pickHour(res, at('2026-12-01T21:00:00Z'))!.end).toBe(at('2026-12-01T21:20:00Z'));
    expect(pickHour(res, at('2026-12-01T21:19:59Z'))!.today).toBe(ahead[5]!.today);
    expect(pickHour(res, at('2026-12-01T21:20:00Z'))).toBeNull();
    // Fewer hours ahead near the end of the forecast: the last one ends after its hour.
    const two = answer({ tz: LONDON, at: made, ahead: 2 });
    expect(pickHour(two, at('2026-12-01T17:59:00Z'))).toMatchObject({
      start: at('2026-12-01T17:00:00Z'),
      end: at('2026-12-01T18:00:00Z'),
    });
    expect(pickHour(two, at('2026-12-01T18:00:00Z'))).toBeNull();
    // A forecast already 5½ hours old when answered: half an hour left.
    const old = answer({ tz: LONDON, at: made, updatedAt: made - 5.5 * HOUR });
    expect(pickHour(old, made)!.end).toBe(made + 30 * MINUTE);
    expect(pickHour(old, made + 30 * MINUTE)).toBeNull();
  });

  it('keeps an answer without hours ahead, as the website asks, for its hour', () => {
    const own = answer({ tz: LONDON, at: made, ahead: 0 });
    expect(pickHour(own, at('2026-12-01T15:59:00Z'))).toMatchObject({
      source: 'response',
      end: at('2026-12-01T16:00:00Z'),
    });
    expect(pickHour(own, at('2026-12-01T16:00:00Z'))).toBeNull();
  });

  it('starts hours ahead at the place’s own hour, after midnight on the new date', () => {
    const kolkata = answer({ tz: 'Asia/Kolkata', at: at('2026-12-01T09:50:00Z') });
    expect(pickHour(kolkata, at('2026-12-01T10:29:00Z'))!.source).toBe('response');
    expect(pickHour(kolkata, at('2026-12-01T10:30:00Z'))!.start).toBe(at('2026-12-01T10:30:00Z'));
    const evening = answer({ tz: LONDON, at: at('2026-12-01T22:20:00Z') });
    expect(pickHour(evening, at('2026-12-02T00:10:00Z'))!.today!.date).toBe('2026-12-02');
  });

  it('has nothing without snow, and says so for each part it lacks', () => {
    expect(pickHour({ ...res, snow: undefined }, made)).toBeNull();
    const bare = { ...res, snow: { ...snow, now: undefined, week: undefined, days: [] } };
    expect(pickHour(bare, made)).toMatchObject({ now: null, today: null, week: null });
  });
});

describe('middleDay', () => {
  const res = answer({ tz: LONDON, at: at('2026-12-01T17:05:00Z') });
  const snow = res.snow!;

  it('is today’s until 6pm at the place, then tomorrow’s until midnight', () => {
    const before = at('2026-12-01T17:59:00Z');
    expect(middleDay(res, pickHour(res, before)!, before)).toEqual({
      slot: 'today',
      day: snow.days[0],
    });
    for (const t of [at('2026-12-01T18:00:00Z'), at('2026-12-01T22:59:00Z')]) {
      const middle = middleDay(res, pickHour(res, t)!, t);
      expect(middle).toEqual({ slot: 'tomorrow', day: snow.days[1] });
      expect(viewLabel('today', middle.slot === 'tomorrow')).toBe('Tomorrow');
    }
  });

  it('is the new date’s today after midnight', () => {
    const evening = answer({ tz: LONDON, at: at('2026-12-01T22:20:00Z') });
    const t = at('2026-12-02T00:10:00Z');
    const picked = pickHour(evening, t)!;
    expect(middleDay(evening, picked, t)).toEqual({ slot: 'today', day: picked.today });
    expect(picked.today!.date).toBe('2026-12-02');
  });

  it('never shows an empty Tomorrow, and has no day without one', () => {
    const t = at('2026-12-01T18:30:00Z');
    const picked = pickHour(res, t)!;
    expect(middleDay({ ...res, days: res.days.slice(0, 1) }, picked, t).slot).toBe('today');
    const noSnow = { ...res, snow: { ...snow, days: snow.days.slice(0, 1) } };
    expect(middleDay(noSnow, picked, t)).toEqual({ slot: 'tomorrow', day: null });
    expect(middleDay({ ...res, snow: undefined }, picked, t)).toEqual({
      slot: 'tomorrow',
      day: null,
    });
  });
});

describe('updatedLine', () => {
  it('words the time as core updatedTime does', () => {
    const cases: [string, string, string][] = [
      ['Europe/London', '2026-12-01T15:05:00Z', '2026-12-01'],
      ['Europe/London', '2026-07-01T15:05:00Z', '2026-07-01'],
      ['Europe/London', '2026-12-01T23:40:00Z', '2026-12-02'],
      ['Europe/London', '2026-10-25T00:30:00Z', '2026-10-25'],
      ['Europe/London', '2026-10-25T01:30:00Z', '2026-10-25'],
      ['America/New_York', '2026-12-02T04:40:00Z', '2026-12-02'],
      ['Asia/Kolkata', '2026-12-01T16:05:00Z', '2026-12-01'],
      ['Asia/Kathmandu', '2026-12-01T18:14:00Z', '2026-12-02'],
      ['Pacific/Kiritimati', '2026-12-01T09:59:00Z', '2026-12-01'],
      ['Not/AZone', '2026-12-01T15:05:00Z', '2026-12-01'],
    ];
    for (const [tz, iso, today] of cases) {
      const when = new Date(iso);
      const local = localDateTime(tz, when);
      const zone = zoneAbbreviation(tz, when);
      const clock = zone ? `${clockTime(local.hours)} ${zone}` : clockTime(local.hours);
      expect(updatedLine({ date: local.date, clock }, today), `${tz} ${iso}`).toBe(
        updatedTime(iso, tz, today),
      );
    }
  });

  it('says yesterday only for an earlier date', () => {
    expect(updatedLine({ date: '2026-12-01', clock: '11:40pm GMT' }, '2026-12-02')).toBe(
      'yesterday, 11:40pm GMT',
    );
    expect(updatedLine({ date: '2026-12-02', clock: '9:05am GMT' }, '2026-12-02')).toBe(
      '9:05am GMT',
    );
  });
});
