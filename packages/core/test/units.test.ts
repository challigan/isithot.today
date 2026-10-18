import { describe, expect, it } from 'vitest';
import {
  cToF,
  defaultUnitsForCountry,
  defaultWindUnitForCountry,
  deltaCToF,
  deltaToUnits,
  parseUnits,
  parseWindUnit,
  round1,
  roundTemp,
  toUnits,
} from '../src/units';

describe('units', () => {
  it('converts °C to °F', () => {
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBe(212);
    expect(cToF(-40)).toBe(-40);
    expect(toUnits(20, 'f')).toBe(68);
    expect(toUnits(20, 'c')).toBe(20);
  });

  it('converts differences without the offset', () => {
    expect(deltaCToF(5)).toBe(9);
    expect(deltaToUnits(-2, 'f')).toBeCloseTo(-3.6, 10);
    expect(deltaToUnits(-2, 'c')).toBe(-2);
  });

  it('rounds for display without -0', () => {
    expect(roundTemp(9.4)).toBe(9);
    expect(roundTemp(9.5)).toBe(10);
    expect(Object.is(roundTemp(-0.4), 0)).toBe(true);
    expect(roundTemp(-2.6)).toBe(-3);
    expect(round1(9.44)).toBe(9.4);
    expect(Object.is(round1(-0.04), 0)).toBe(true);
  });

  it('defaults to °F for the US and °C elsewhere', () => {
    expect(defaultUnitsForCountry('US')).toBe('f');
    expect(defaultUnitsForCountry('us')).toBe('f');
    expect(defaultUnitsForCountry('GB')).toBe('c');
    expect(defaultUnitsForCountry(null)).toBe('c');
    expect(defaultUnitsForCountry(undefined)).toBe('c');
  });

  it('parses the units query', () => {
    expect(parseUnits('c')).toBe('c');
    expect(parseUnits('f')).toBe('f');
    expect(parseUnits('F')).toBeNull();
    expect(parseUnits(null)).toBeNull();
  });

  it('defaults wind to mph where roads are signed in mph, and km/h elsewhere', () => {
    // The UK, its dependencies and territories, the US and its, and the Caribbean states.
    const mph = ['GB', 'gb', 'IM', 'JE', 'GG', 'VG', 'KY', 'FK', 'SH', 'TC', 'US', 'PR', 'GU'];
    for (const code of [...mph, 'VI', 'AS', 'MP', 'UM', 'AG', 'BS', 'BZ', 'DM', 'GD', 'KN', 'LC']) {
      expect(defaultWindUnitForCountry(code)).toBe('mph');
    }
    expect(defaultWindUnitForCountry('VC')).toBe('mph');
    // Neighbours that sign in km/h stay in km/h.
    for (const code of ['IE', 'FR', 'CA', 'AU', 'GI', 'BM', 'JM'])
      expect(defaultWindUnitForCountry(code)).toBe('kmh');
    expect(defaultWindUnitForCountry(null)).toBe('kmh');
    expect(defaultWindUnitForCountry(undefined)).toBe('kmh');
  });

  it('parses the wind units query', () => {
    expect(parseWindUnit('mph')).toBe('mph');
    expect(parseWindUnit('kmh')).toBe('kmh');
    expect(parseWindUnit('km/h')).toBeNull();
    expect(parseWindUnit('MPH')).toBeNull();
    expect(parseWindUnit(null)).toBeNull();
  });
});
