/** Today's calendar date (YYYY-MM-DD) in an IANA time zone. Falls back to UTC for unknown zones. */
export function localDate(timezone: string, now: Date = new Date()): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
  const part = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${part.year}-${part.month}-${part.day}`;
}
