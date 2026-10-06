import { describe, expect, it } from 'vitest';
import { applyGuards, bandFor, effectiveTemperature, verdict } from '../src/verdict';
import type { Band } from '../src/config';

describe('verdict: required spec cases', () => {
  const cases: Array<[string, number, number, number, number, Band]> = [
    ['Newcastle summer day', 7, 19, 24, 25.4, 'hot'],
    ['Newcastle pleasant day', 7, 19, 20, 21.1, 'warm'],
    ['Newcastle October', 7, 19, 9, 9.2, 'cold'],
    ['London spring', 8, 23, 15, 14.3, 'mild'],
    ['Seville August, normal', 16, 36, 28, 21.7, 'warm'],
    ['Seville heatwave', 16, 36, 41, 32.8, 'scorching'],
    ['Singapore humid day', 30, 32, 38, 29.5, 'hot'],
    ['Edinburgh January', 7, 19, -6, -7.1, 'freezing'],
    ['Cool-climate guard', 0, 10, 17, 23.9, 'warm'],
  ];

  it.each(cases)('%s', (_name, coldest, warmest, feels, expectedE, expectedBand) => {
    const result = verdict(feels, { coldest, warmest });
    expect(Math.round(result.effective * 10) / 10).toBe(expectedE);
    expect(result.band).toBe(expectedBand);
    expect(result.climateAdjusted).toBe(true);
  });

  it('the cool-climate case bands as hot before the guard caps it', () => {
    expect(bandFor(effectiveTemperature(17, { coldest: 0, warmest: 10 }))).toBe('hot');
  });
});

describe('effectiveTemperature', () => {
  it('uses the raw feels-like high when normals are unavailable (α = 0)', () => {
    expect(effectiveTemperature(21.3, null)).toBe(21.3);
    expect(verdict(21.3, null)).toEqual({ band: 'warm', effective: 21.3, climateAdjusted: false });
  });

  it('floors the local range at 8°C', () => {
    // Range of 2 is floored to 8: Tref = 7 + (38 - 30) * 14 / 8 = 21.
    expect(effectiveTemperature(38, { coldest: 30, warmest: 32 })).toBeCloseTo(29.5, 10);
  });
});

describe('bandFor edges', () => {
  it.each([
    [-10, 'freezing'],
    [0, 'freezing'],
    [0.01, 'cold'],
    [10, 'cold'],
    [10.01, 'mild'],
    [17, 'mild'],
    [17.01, 'warm'],
    [23, 'warm'],
    [23.01, 'hot'],
    [31, 'hot'],
    [31.01, 'scorching'],
  ] as const)('E = %s is %s', (e, band) => {
    expect(bandFor(e)).toBe(band);
  });
});

describe('applyGuards', () => {
  it('caps at warm when F is below 18', () => {
    expect(applyGuards('scorching', 17.9)).toBe('warm');
    expect(applyGuards('hot', 17)).toBe('warm');
    expect(applyGuards('mild', 17)).toBe('mild');
  });

  it('floors at mild when F is above 25', () => {
    expect(applyGuards('freezing', 25.1)).toBe('mild');
    expect(applyGuards('cold', 26)).toBe('mild');
    expect(applyGuards('cold', 25)).toBe('cold');
  });

  it('never goes warmer than cold when F is 0 or below', () => {
    expect(applyGuards('mild', 0)).toBe('cold');
    expect(applyGuards('freezing', -3)).toBe('freezing');
  });

  it('is at least hot from 35 and scorching from 40', () => {
    expect(applyGuards('warm', 35)).toBe('hot');
    expect(applyGuards('scorching', 36)).toBe('scorching');
    expect(applyGuards('hot', 40)).toBe('scorching');
    expect(applyGuards('mild', 34.9)).toBe('mild');
  });
});
