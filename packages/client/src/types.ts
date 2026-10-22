/**
 * The parts of a `/api/v1/today` answer the apps read that core's types do not carry yet: each
 * snow week day's agreement, and the hours ahead the apps ask for with `ahead=snow` (iOS build
 * spec, sections 5.2 and 5.3). Typed here as specified until the server sends them and
 * `packages/core/src/types.ts` has them; these then give way to core's own.
 */
import type {
  ApiSnow,
  ApiSnowDay,
  ApiSnowNow,
  ApiSnowWeek,
  ApiSnowWeekDay,
  SnowReason,
  TodayResponse,
} from '@isithot/core';

export interface SnowWeekDay extends ApiSnowWeekDay {
  /** The share of models expecting snow, 0–1, two decimals (as `ApiSnowDay.chance`). */
  chance: number;
  /** Models expecting snow, and models with data for the day. */
  snowy: number;
  total: number;
  /** Why a day without snow has none, as on `ApiSnowDay`. */
  reason: SnowReason | null;
}

export interface SnowWeek extends ApiSnowWeek {
  days: SnowWeekDay[];
}

/** One forecast hour ahead, answered as the server answers at its first instant. */
export interface SnowAhead {
  /** The hour's start, ISO 8601 UTC (:30 or :15 past the UTC hour where the zone is). */
  time: string;
  /** The Now view for the hour. */
  now: Omit<ApiSnowNow, 'series'>;
  /** The rest of that hour's local day: after midnight at the place, the new date's. */
  today: ApiSnowDay;
  week: SnowWeek | null;
}

export interface AppSnow extends ApiSnow {
  week?: SnowWeek;
  /**
   * The forecast hours after the one the answer was worked out in, in order. Present only when
   * asked for (`ahead=snow`); fewer near the end of the forecast.
   */
  ahead?: SnowAhead[];
}

/** A today answer as the apps read it. */
export interface AppResponse extends TodayResponse {
  snow?: AppSnow;
}
