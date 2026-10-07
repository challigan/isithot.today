import { describe, expect, it } from 'vitest';
import { climateRange, isValidNormals, normalForDate, parseDate } from '../src/climate';

// Illustrative Newcastle-like normals, January first.
const UK = [7, 7.5, 9.5, 12, 15, 18, 19, 19, 17, 13.5, 10, 7.5];
// Southern hemisphere: warmest in January.
const SOUTH = [26, 26, 24, 21, 18, 15, 14, 15, 17, 20, 22, 24];

describe('isValidNormals', () => {
  it('requires 12 finite numbers', () => {
    expect(isValidNormals(UK)).toBe(true);
    expect(isValidNormals(UK.slice(1))).toBe(false);
    expect(isValidNormals([...UK.slice(1), Number.NaN])).toBe(false);
    expect(isValidNormals(null)).toBe(false);
  });
});

describe('climateRange', () => {
  it('finds the coldest and warmest months from the data', () => {
    expect(climateRange(UK)).toEqual({ coldest: 7, warmest: 19 });
    expect(climateRange(SOUTH)).toEqual({ coldest: 14, warmest: 26 });
  });
});

describe('normalForDate', () => {
  it('returns the monthly value on the 15th', () => {
    expect(normalForDate(UK, '2026-10-15')).toBe(13.5);
    expect(normalForDate(UK, '2026-07-15')).toBe(19);
  });

  it('interpolates forwards after the 15th', () => {
    // 15 Oct → 15 Nov is 31 days; 16 days in.
    expect(normalForDate(UK, '2026-10-31')).toBeCloseTo(13.5 + (10 - 13.5) * (16 / 31), 10);
  });

  it('interpolates backwards before the 15th', () => {
    // 15 Sep → 15 Oct is 30 days; 21 days in.
    expect(normalForDate(UK, '2026-10-06')).toBeCloseTo(17 + (13.5 - 17) * (21 / 30), 10);
  });

  it('wraps December to January in both directions', () => {
    // 15 Dec → 15 Jan is 31 days.
    expect(normalForDate(UK, '2026-12-31')).toBeCloseTo(7.5 + (7 - 7.5) * (16 / 31), 10);
    expect(normalForDate(UK, '2027-01-01')).toBeCloseTo(7.5 + (7 - 7.5) * (17 / 31), 10);
  });

  it('handles leap-year February', () => {
    // 15 Feb → 15 Mar 2028 is 29 days; 14 days in.
    expect(normalForDate(UK, '2028-02-29')).toBeCloseTo(7.5 + (9.5 - 7.5) * (14 / 29), 10);
  });
});

describe('parseDate', () => {
  it('parses YYYY-MM-DD as UTC midnight', () => {
    expect(parseDate('2026-10-06')).toBe(Date.UTC(2026, 9, 6));
  });

  it('rejects other formats', () => {
    expect(() => parseDate('06/10/2026')).toThrow('Invalid date');
  });
});
