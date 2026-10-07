export interface LocalDateTime {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  /** Time of day in hours, 0 ≤ hours < 24 (14:30 is 14.5). */
  hours: number;
}

/** One formatter per time zone (null for an unknown zone): building them is the slow part. */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timezone: string): Intl.DateTimeFormat | null {
  let formatter = formatters.get(timezone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      formatter = null;
    }
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** The local date and time of day in an IANA time zone. Falls back to UTC for unknown zones. */
export function localDateTime(timezone: string, now: Date = new Date()): LocalDateTime {
  const formatter = formatterFor(timezone);
  if (!formatter) {
    return {
      date: now.toISOString().slice(0, 10),
      hours: now.getUTCHours() + now.getUTCMinutes() / 60,
    };
  }
  const part = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${part.year}-${part.month}-${part.day}`,
    hours: Number(part.hour) + Number(part.minute) / 60,
  };
}

/** Today's calendar date (YYYY-MM-DD) in an IANA time zone. Falls back to UTC for unknown zones. */
export function localDate(timezone: string, now: Date = new Date()): string {
  return localDateTime(timezone, now).date;
}
