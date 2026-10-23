import { describe, expect, it } from 'vitest';
import {
  dayUntil,
  hold,
  hourUntil,
  nextRefreshAt,
  outOfDate,
  usableUntil,
  type Holds,
} from '../src/freshness';
import { HOUR, MINUTE, STALE, answer } from './fixtures';

const LONDON = 'Europe/London';
const KOLKATA = 'Asia/Kolkata';
const at = (s: string): number => Date.parse(s);

describe('hourUntil', () => {
  it('is the next forecast hour after today’s rain was worked out', () => {
    expect(hourUntil(answer({ tz: LONDON, at: at('2026-12-01T15:20:00Z') }))).toBe(
      at('2026-12-01T16:00:00Z'),
    );
    // Forecast hours are the place's: half past the UTC hour in India.
    expect(hourUntil(answer({ tz: KOLKATA, at: at('2026-12-01T09:50:00Z') }))).toBe(
      at('2026-12-01T10:30:00Z'),
    );
  });

  it('falls back to the next UTC hour without a series, and to snow without rain', () => {
    const res = answer({ tz: KOLKATA, at: at('2026-12-01T09:50:00Z') });
    expect(hourUntil({ ...res, rain: { ...res.rain!, now: undefined } })).toBe(
      at('2026-12-01T10:00:00Z'),
    );
    expect(hourUntil({ ...res, rain: undefined })).toBe(at('2026-12-01T10:30:00Z'));
    expect(hourUntil({ ...res, rain: undefined, snow: undefined })).toBeNull();
    expect(hourUntil({ ...res, rain: { ...res.rain!, days: [] } })).toBeNull();
  });
});

describe('dayUntil', () => {
  it('is midnight at the place', () => {
    expect(dayUntil(answer({ tz: LONDON, at: at('2026-12-01T15:20:00Z') }))).toBe(
      at('2026-12-02T00:00:00Z'),
    );
    expect(dayUntil(answer({ tz: KOLKATA, at: at('2026-12-01T09:50:00Z') }))).toBe(
      at('2026-12-01T18:30:00Z'),
    );
  });

  it('is null without hours that reach it', () => {
    const res = answer({ tz: LONDON, at: at('2026-12-01T15:20:00Z') });
    expect(dayUntil({ ...res, now: undefined })).toBeNull();
    expect(dayUntil({ ...res, now: { ...res.now!, series: res.now!.series.slice(0, 5) } })).toBe(
      null,
    );
    expect(dayUntil({ ...res, days: [] })).toBe(res.now!.series[0]!.time);
  });
});

describe('hold and outOfDate', () => {
  const made = at('2026-12-01T15:20:00Z');
  const res = answer({ tz: LONDON, at: made });

  it('keeps an answer for its hour and its day', () => {
    expect(outOfDate(res, made, {})).toBeNull();
    expect(outOfDate(res, at('2026-12-01T15:59:59.999Z'), {})).toBeNull();
    expect(outOfDate(res, at('2026-12-01T16:00:00Z'), {})).toBe('hour');
    expect(outOfDate(res, at('2026-12-01T23:59:00Z'), {})).toBe('hour');
    expect(outOfDate(res, at('2026-12-02T00:00:00Z'), {})).toBe('day');
  });

  it('never calls an answer out of date because the clock runs behind', () => {
    expect(outOfDate(res, made - 2 * HOUR, {})).toBeNull();
    expect(outOfDate(res, made - 30 * MINUTE, {})).toBeNull();
  });

  it('is a day out of date past the end of its hours, even without a midnight in them', () => {
    // Hours from 14:00 to 16:00: the last one holds until 17:00.
    const short = { ...res, now: { ...res.now!, series: res.now!.series.slice(0, 3) } };
    expect(outOfDate(short, at('2026-12-01T16:59:00Z'), {})).toBe('hour');
    expect(outOfDate(short, at('2026-12-01T17:00:00Z'), {})).toBe('day');
  });

  it('takes an answer without today, or without hours, as the series says', () => {
    // Without today there is no date to keep: the day is over by the first hour.
    expect(outOfDate({ ...res, days: [] }, made, {})).toBe('day');
    const empty = { ...res, now: { ...res.now!, series: [] } };
    expect(outOfDate(empty, made, {})).toBeNull();
    expect(outOfDate(empty, at('2026-12-02T01:00:00Z'), {})).toBe('hour');
  });

  it('judges by the hour alone without a hot Now, and never without rain or snow', () => {
    const later = at('2026-12-02T01:00:00Z');
    expect(outOfDate({ ...res, now: undefined }, later, {})).toBe('hour');
    expect(outOfDate({ ...res, rain: undefined, snow: undefined }, made + HOUR, {})).toBeNull();
    expect(outOfDate({ ...res, rain: undefined, snow: undefined }, later, {})).toBe('day');
  });

  it('holds a fresh answer from a fast clock for as long as the server had left', () => {
    // Worked out 30 s before the hour on the server; the phone is 5 minutes fast.
    const fresh = answer({ tz: LONDON, at: at('2026-12-01T15:59:30Z') });
    const phone = at('2026-12-01T16:05:00Z');
    expect(outOfDate(fresh, phone, {})).toBe('hour');
    const holds = hold({}, fresh, phone);
    expect(holds).toEqual({ hour: { until: at('2026-12-01T16:00:00Z'), at: phone + 30_000 } });
    expect(outOfDate(fresh, phone + 29_999, holds)).toBeNull();
    expect(outOfDate(fresh, phone + 30_000, holds)).toBe('hour');
    // A hold is for that hour only: the next answer's hour is not held.
    const next = answer({ tz: LONDON, at: at('2026-12-01T16:59:30Z') });
    expect(outOfDate(next, at('2026-12-01T17:01:00Z'), holds)).toBe('hour');
  });

  it('holds the day the same way, past the place’s midnight', () => {
    const fresh = answer({ tz: LONDON, at: at('2026-12-01T23:59:00Z') });
    const phone = at('2026-12-02T00:03:00Z');
    expect(outOfDate(fresh, phone, {})).toBe('day');
    const holds = hold({}, fresh, phone);
    const until = at('2026-12-02T00:00:00Z');
    expect(holds).toEqual({
      day: { until, at: phone + MINUTE },
      hour: { until, at: phone + MINUTE },
    });
    expect(outOfDate(fresh, phone + 30_000, holds)).toBeNull();
    expect(outOfDate(fresh, phone + MINUTE, holds)).toBe('day');
  });

  it('holds nothing for an answer still good, and keeps the holds it has', () => {
    const held: Holds = { day: { until: 1, at: 2 } };
    const next = hold(held, res, made + MINUTE);
    expect(next).toEqual(held);
    expect(next).not.toBe(held);
    expect(held).toEqual({ day: { until: 1, at: 2 } });
  });

  it('holds only what has gone out of date, by when it was worked out', () => {
    // A phone 70 minutes fast: the hour is held for the 40 minutes the server had left.
    const phone = at('2026-12-01T16:30:00Z');
    expect(hold({}, res, phone)).toEqual({
      hour: { until: at('2026-12-01T16:00:00Z'), at: phone + 40 * MINUTE },
    });
    // Without the moment it was worked out, there is nothing to hold it by.
    const undated = { ...res, now: { ...res.now!, time: '' } };
    expect(hold({}, undated, at('2026-12-02T00:01:00Z'))).not.toHaveProperty('day');
  });
});

describe('usableUntil', () => {
  const made = at('2026-12-01T15:20:00Z');

  it('ends with the last hour ahead, or the server’s stale limit if sooner', () => {
    expect(usableUntil(answer({ tz: LONDON, at: made }))).toBe(made + STALE);
    expect(usableUntil(answer({ tz: LONDON, at: made, ahead: 2 }))).toBe(
      at('2026-12-01T18:00:00Z'),
    );
    expect(usableUntil(answer({ tz: LONDON, at: made, updatedAt: made - 5 * HOUR }))).toBe(
      made + HOUR,
    );
  });

  it('ends with the answer’s hour without hours ahead, as the website asks', () => {
    const res = answer({ tz: LONDON, at: made, ahead: 0 });
    expect(usableUntil(res)).toBe(at('2026-12-01T16:00:00Z'));
    expect(usableUntil({ ...res, rain: undefined, snow: undefined })).toBe(made + STALE);
  });
});

describe('nextRefreshAt', () => {
  it('is the next forecast hour after now, plus the jitter given', () => {
    const res = answer({ tz: LONDON, at: at('2026-12-01T15:20:00Z') });
    expect(nextRefreshAt(res, at('2026-12-01T15:20:00Z'), 0)).toBe(at('2026-12-01T16:00:00Z'));
    expect(nextRefreshAt(res, at('2026-12-01T16:00:00Z'), 90_000)).toBe(at('2026-12-01T17:01:30Z'));
    const kolkata = answer({ tz: KOLKATA, at: at('2026-12-01T09:50:00Z') });
    expect(nextRefreshAt(kolkata, at('2026-12-01T10:29:00Z'), 1)).toBe(
      at('2026-12-01T10:30:00Z') + 1,
    );
    expect(nextRefreshAt({ ...kolkata, rain: undefined }, at('2026-12-01T10:30:00Z'), 0)).toBe(
      at('2026-12-01T11:30:00Z'),
    );
  });

  it('falls back to the next UTC hour beyond the series, or without one', () => {
    const res = answer({ tz: KOLKATA, at: at('2026-12-01T09:50:00Z') });
    expect(nextRefreshAt(res, at('2026-12-03T09:50:00Z'), 0)).toBe(at('2026-12-03T10:00:00Z'));
    expect(
      nextRefreshAt({ ...res, rain: undefined, snow: undefined }, at('2026-12-01T09:50:00Z'), 0),
    ).toBe(at('2026-12-01T10:00:00Z'));
  });
});
