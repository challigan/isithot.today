/**
 * "Is it snowing right now?": the hour containing a moment, from the judged series the server
 * sends (snowSeries in snowDay.ts). The server and the browser both run computeSnowNow and
 * formatSnowNow, on the same numbers.
 */
import { SNOW } from './config';
import {
  RAIN_COPY,
  SNOW_ANSWERS,
  SNOW_COPY,
  SNOW_NONE_NOW_VERDICTS,
  SNOW_NOW_PHRASES,
  SNOW_NOW_VERDICTS,
  clearingLine,
  easingLine,
  formatHour,
  likelyFromLine,
  snowFromLine,
  snowPossibleFromLine,
  snowRateLine,
} from './copy';
import { HOUR } from './rain';
import { computeRainNow, rainRows, type RainNowComputation } from './rainNow';
import { isSnow, roundSnow, snowRank, snowText } from './snow';
import type { ApiSnowNow, ApiSnowPoint, SnowUnit } from './types';

/** The snow "now" view, before formatting. */
export type SnowNowComputation = RainNowComputation<ApiSnowPoint>;

/**
 * The hour containing a moment, from the judged series, or null when the series does not cover
 * it (picked as for rain).
 */
export function computeSnowNow(
  series: readonly ApiSnowPoint[],
  time: number,
): SnowNowComputation | null {
  return computeRainNow(series, time);
}

/** "Light snow now.", "Heavy snow now, about 2cm an hour."… */
function nowPhrase(p: ApiSnowPoint, unit: SnowUnit): string {
  if (p.band === 'nosnow') return p.reason === 'rain' ? SNOW_COPY.rainNow : SNOW_NOW_PHRASES.nosnow;
  if (!isSnow(p.band)) return SNOW_NOW_PHRASES[p.band];
  if (p.band === 'snow' && p.light) return SNOW_COPY.lightSnowNow;
  return snowRateLine(SNOW_NOW_PHRASES[p.band], snowText(p.amount, unit));
}

/**
 * What the next 12 hours bring: when snow under way now eases off, or when snow is likely to
 * start (rain's trend, in snow). While snow is only possible now, the line does not say "snow"
 * again: "Likely from about 9pm." / "Clearing by about 9pm.".
 */
export function snowTrendLine(now: SnowNowComputation): string {
  const start = now.current.time;
  const ahead = now.series.filter((p) => p.time > start && p.time <= start + 12 * HOUR);
  const easing = ahead.find((p) => snowRank(p.band) <= snowRank('flakes'));
  if (isSnow(now.current.band)) return easing ? easingLine(easing.hour) : RAIN_COPY.setToLast;
  const snow = ahead.find((p) => isSnow(p.band));
  if (now.current.band === 'maybesnow') {
    if (snow) return likelyFromLine(snow.hour);
    return easing ? clearingLine(easing.hour) : RAIN_COPY.showersNext12;
  }
  if (snow) return snowFromLine(snow.hour);
  // The first hour with snow possible, or the first row with a fair chance, whichever is first.
  const possible = ahead.find((p) => p.band === 'maybesnow');
  const row = rainRows(now).find((p) => p.chance2h >= SNOW.maybeFrom);
  const first = row && !(possible && possible.time < row.time) ? row : possible;
  return first ? snowPossibleFromLine(first.hour) : SNOW_COPY.noSnowNext12;
}

export function formatSnowNow(now: SnowNowComputation, unit: SnowUnit): ApiSnowNow {
  const p = now.current;
  const verdict =
    p.reason && p.reason !== 'dry' ? SNOW_NONE_NOW_VERDICTS[p.reason] : SNOW_NOW_VERDICTS[p.band];
  return {
    time: new Date(now.time).toISOString(),
    band: p.band,
    answer: SNOW_ANSWERS[p.band],
    verdict,
    detail: `${nowPhrase(p, unit)} ${snowTrendLine(now)}`,
    amount: roundSnow(p.amount, unit),
    chance: p.chance,
    hours: rainRows(now).map((q) => ({
      time: new Date(q.time).toISOString(),
      label: formatHour(q.hour),
      chance: Math.round(q.chance2h * 10) * 10,
    })),
    series: now.series.map((q) => ({ ...q })),
  };
}
