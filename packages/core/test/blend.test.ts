import { describe, expect, it } from 'vitest';
import { agreement, blend, peakHour, type ModelDay } from '../src/blend';
import { trimmedMean, mean, isFiniteNumber } from '../src/stats';

const model = (id: string, high: number | null, feelsLike: number | null = high): ModelDay => ({
  id,
  name: id.toUpperCase(),
  high,
  feelsLike,
});

describe('stats', () => {
  it('trims the single highest and lowest from 5 or more values', () => {
    expect(trimmedMean([1, 2, 3, 4, 100], 5)).toBe(3);
    expect(trimmedMean([10, 0, 5, 5, 5, 5], 5)).toBe(5);
  });

  it('uses a plain mean below the trim threshold', () => {
    expect(trimmedMean([1, 2, 3, 10], 5)).toBe(4);
    expect(mean([2])).toBe(2);
  });

  it('recognises finite numbers only', () => {
    expect(isFiniteNumber(1)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber('3')).toBe(false);
  });
});

describe('blend', () => {
  it('returns null when no model has data', () => {
    expect(blend([model('a', null), model('b', null)])).toBeNull();
    expect(blend([])).toBeNull();
  });

  it('drops null models and uses a trimmed mean with 5 or more', () => {
    const b = blend([
      model('a', 9),
      model('b', 10),
      model('c', 8),
      model('d', 9),
      model('e', 9),
      model('f', 13),
      model('g', null),
    ]);
    expect(b).not.toBeNull();
    expect(b!.high).toBeCloseTo(9.25, 10);
    expect(b!.models.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(b!.confidence).toBe('good');
  });

  it('uses a plain mean with 3 or 4 models', () => {
    const b = blend([model('a', 10), model('b', 11), model('c', 15)]);
    expect(b!.high).toBe(12);
    expect(b!.confidence).toBe('good');
  });

  it('flags limited confidence below 3 models', () => {
    const b = blend([model('a', 10), model('b', 12), model('c', null)]);
    expect(b!.high).toBe(11);
    expect(b!.confidence).toBe('limited');
  });

  it('blends feels-like independently, falling back to the high when absent', () => {
    const b = blend([model('a', 10, 7), model('b', 12, null), model('c', 14, 9)]);
    expect(b!.feelsLike).toBe(8);
    const none = blend([model('a', 10, null), model('b', 12, null), model('c', 14, null)]);
    expect(none!.feelsLike).toBe(12);
  });

  it('finds the peak hour from the mean across models', () => {
    const b = blend(
      [model('a', 10), model('b', 11), model('c', 12)],
      [
        { hour: 13, temps: [10, 11, 12] },
        { hour: 14, temps: [11, 12, null] },
        { hour: 15, temps: [9, 9, 9] },
      ],
    );
    expect(b!.peakHour).toBe(14);
  });
});

describe('peakHour', () => {
  it('returns null without usable hourly data', () => {
    expect(peakHour([])).toBeNull();
    expect(peakHour([{ hour: 3, temps: [null, null] }])).toBeNull();
  });

  it('prefers the earlier hour on a tie', () => {
    expect(
      peakHour([
        { hour: 12, temps: [20] },
        { hour: 16, temps: [20] },
      ]),
    ).toBe(12);
  });
});

describe('agreement', () => {
  it('counts values within the tolerance, inclusive', () => {
    const a = agreement([9, 10, 8, 9, 9, 13, 11], 9, 2);
    expect(a.agrees).toEqual([true, true, true, true, true, false, true]);
    expect(a.count).toBe(6);
  });

  it('works in °F with a 4° tolerance', () => {
    expect(agreement([48, 52.1, 44], 48, 4).count).toBe(2);
  });
});
