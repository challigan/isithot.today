/**
 * "Is it windy right now?": the hour containing a moment, from the judged series the server sends
 * (windSeries in windDay.ts). The server and the browser both run computeWindNow and
 * formatWindNow, on the same numbers. Wind is judged by the hour, as rain is, so nothing is
 * interpolated; nor is its direction, which the server has already judged for each hour.
 */
import {
  RAIN_COPY,
  STILL_VERDICTS,
  WIND_ANSWERS,
  WIND_COPY,
  WIND_NOW_VERDICTS,
  breezierFromLine,
  easingLine,
  formatHour,
  lighterFromLine,
  windNowLine,
  windyFromLine,
  type WindyBand,
} from './copy';
import { HOUR } from './rain';
import { computeRainNow, rainRows, type RainNowComputation } from './rainNow';
import { directionField, directionWords, isWindy, windRank, windText } from './wind';
import type { ApiWindNow, ApiWindPoint, WindUnit } from './types';

/** The wind "now" view, before formatting. */
export type WindNowComputation = RainNowComputation<ApiWindPoint>;

/**
 * The hour containing a moment, from the judged series, or null when the series does not cover
 * it (picked as for rain).
 */
export function computeWindNow(
  series: readonly ApiWindPoint[],
  time: number,
): WindNowComputation | null {
  return computeRainNow(series, time);
}

/**
 * What the next 12 hours bring: when wind that is windy or more now eases to breezy or less;
 * otherwise when it turns windy (by that hour's band), and failing that, when a breezy hour turns
 * light or a calm one breezy.
 */
export function windTrendLine(now: WindNowComputation): string {
  const start = now.current.time;
  const ahead = now.series.filter((p) => p.time > start && p.time <= start + 12 * HOUR);
  if (isWindy(now.current.band)) {
    const easing = ahead.find((p) => windRank(p.band) <= windRank('breezy'));
    return easing ? easingLine(easing.hour) : RAIN_COPY.setToLast;
  }
  const windy = ahead.find((p) => isWindy(p.band));
  if (windy) return windyFromLine(windy.band as WindyBand, windy.hour);
  if (now.current.band === 'breezy') {
    const light = ahead.find((p) => p.band === 'calm');
    return light ? lighterFromLine(light.hour) : WIND_COPY.breezyNext12;
  }
  const breezy = ahead.find((p) => p.band === 'breezy');
  return breezy ? breezierFromLine(breezy.hour) : WIND_COPY.lightNext12;
}

export function formatWindNow(now: WindNowComputation, unit: WindUnit): ApiWindNow {
  const p = now.current;
  return {
    time: new Date(now.time).toISOString(),
    band: p.band,
    answer: WIND_ANSWERS[p.band],
    verdict: p.still ? STILL_VERDICTS.now : WIND_NOW_VERDICTS[p.band],
    detail: `${windNowLine(windText(p.mean, unit), windText(p.gust, unit), directionWords(p.dir))} ${windTrendLine(now)}`,
    mean: p.mean,
    gust: p.gust,
    still: p.still,
    ...directionField(p.dir),
    // Each row's direction is its first hour's: wind direction is for a moment, not a span.
    hours: rainRows(now).map((q) => ({
      time: new Date(q.time).toISOString(),
      label: formatHour(q.hour),
      gust: q.gust2h,
      ...directionField(q.dir),
    })),
    series: now.series.map((q) => ({ ...q })),
  };
}
