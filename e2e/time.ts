/**
 * Clock arithmetic for the e2e run, without Playwright, so playwright.config.ts can use it too.
 * The server's clock is the real one unless E2E_CLOCK moved it (playwright.config.ts).
 */

export const LONDON = 'Europe/London';

/** How far E2E_CLOCK moved the e2e server's clock (0 normally). */
export const CLOCK_SHIFT = Number(process.env.E2E_CLOCK_SHIFT_MS || 0);

/** The e2e server's clock. */
export const serverNow = (): number => Date.now() + CLOCK_SHIFT;

export interface LocalTime {
  /** YYYY-MM-DD at the place. */
  date: string;
  hour: number;
  minute: number;
}

/** The date and time at an IANA zone at a moment (default: now on the server's clock). */
export function localTime(tz: string, ms = serverNow()): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Minutes since midnight for "HH:MM". */
export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

/** The moment the clock at `tz` reads `hhmm` on `date` (default: the place's date now). */
export function atLocal(tz: string, hhmm: string, date = localTime(tz).date): number {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes(hhmm) * 60_000;
  let ms = wall;
  // Two corrections settle the zone's offset, also on a day it changes.
  for (let i = 0; i < 2; i++) {
    const at = localTime(tz, ms);
    ms += wall - (Date.parse(`${at.date}T00:00:00Z`) + (at.hour * 60 + at.minute) * 60_000);
  }
  return ms;
}
