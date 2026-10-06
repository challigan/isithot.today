import { FAHRENHEIT_COUNTRIES } from './config';

export type Units = 'c' | 'f';

export function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

/** Converts a temperature difference (not a temperature) from °C to °F. */
export function deltaCToF(delta: number): number {
  return (delta * 9) / 5;
}

/** Converts a °C temperature into the display units, at full precision. */
export function toUnits(c: number, units: Units): number {
  return units === 'f' ? cToF(c) : c;
}

/** Converts a °C difference into the display units, at full precision. */
export function deltaToUnits(delta: number, units: Units): number {
  return units === 'f' ? deltaCToF(delta) : delta;
}

/** Rounds for display, never returning -0. */
export function roundTemp(value: number): number {
  const r = Math.round(value);
  return r === 0 ? 0 : r;
}

/** Rounds to one decimal place, never returning -0. */
export function round1(value: number): number {
  const r = Math.round(value * 10) / 10;
  return r === 0 ? 0 : r;
}

export function defaultUnitsForCountry(countryCode: string | null | undefined): Units {
  return countryCode && FAHRENHEIT_COUNTRIES.includes(countryCode.toUpperCase()) ? 'f' : 'c';
}

export function parseUnits(value: string | null | undefined): Units | null {
  if (value === 'c' || value === 'f') return value;
  return null;
}
