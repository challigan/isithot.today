import { isFiniteNumber } from './stats';

/** Twelve monthly normal daily highs, January first, °C. */
export type MonthlyNormals = readonly number[];

export interface ClimateRange {
  /** Normal high of the coldest month, °C. */
  coldest: number;
  /** Normal high of the warmest month, °C. */
  warmest: number;
}

export function isValidNormals(monthly: unknown): monthly is MonthlyNormals {
  return Array.isArray(monthly) && monthly.length === 12 && monthly.every(isFiniteNumber);
}

/** Coldest and warmest months come from the data, so hemispheres need no special case. */
export function climateRange(monthly: MonthlyNormals): ClimateRange {
  return { coldest: Math.min(...monthly), warmest: Math.max(...monthly) };
}

/** Parses a local calendar date (YYYY-MM-DD) into its UTC-midnight timestamp. */
export function parseDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function midMonth(year: number, month: number): number {
  // Date.UTC rolls month -1 and 12 into the neighbouring years.
  return Date.UTC(year, month, 15);
}

/**
 * The normal high for a date: linear interpolation between mid-month (15th) values,
 * wrapping December to January.
 */
export function normalForDate(monthly: MonthlyNormals, date: string): number {
  const t = parseDate(date);
  const d = new Date(t);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();

  let fromMonth: number;
  let start: number;
  let end: number;
  if (d.getUTCDate() >= 15) {
    fromMonth = month;
    start = midMonth(year, month);
    end = midMonth(year, month + 1);
  } else {
    fromMonth = month - 1;
    start = midMonth(year, month - 1);
    end = midMonth(year, month);
  }
  const a = monthly[(fromMonth + 12) % 12] as number;
  const b = monthly[(fromMonth + 13) % 12] as number;
  return a + ((b - a) * (t - start)) / (end - start);
}
