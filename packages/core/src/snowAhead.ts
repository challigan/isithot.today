/**
 * "Will it snow?" for the next few forecast hours (`ahead=snow`, the apps only), so an app can
 * keep Now, Today and the week current between requests without judging or wording anything.
 * Server only, from the judged series and the days the response itself is worked out from.
 */
import type { MonthlyNormals } from './climate';
import type { DayData } from './compute';
import { snowUnit } from './snow';
import { computeSnowDay, formatSnowDay, type SnowDayComputation } from './snowDay';
import { computeSnowNow, formatSnowNow } from './snowNow';
import { computeSnowWeek, formatSnowWeek } from './snowWeek';
import type { Units } from './units';
import type { ApiSnowAhead, ApiSnowPoint } from './types';

/**
 * The Now, Today and week views for each of the next `hours` forecast hours after the one
 * containing `from`, each as the server answers at that hour's first instant, from the same
 * forecast (DECISIONS "API contract"). `days` are the forecast's days from the request's local
 * date, as the response's own answers use them. Today is not minute-exact: computeSnowDay
 * weights the current hour by the minutes left. An hour without an answer for its day is left
 * out, as the response would have no snow answer then.
 */
export function snowAhead(
  judged: readonly ApiSnowPoint[],
  days: readonly DayData[],
  from: number,
  hours: number,
  units: Units,
  normals: MonthlyNormals | null,
): ApiSnowAhead[] {
  const unit = snowUnit(units);
  // Later days are whole days, the same at any hour: each is worked out once.
  const whole = days.map((d) => computeSnowDay(d, { normals }));
  return (
    judged
      // The hour containing `from` is the response's own.
      .filter((p) => p.time > from)
      .slice(0, hours)
      .flatMap((p) => {
        const i = days.findIndex((d) => d.date === p.date);
        const today = i >= 0 ? computeSnowDay(days[i]!, { from: p.time, normals }) : null;
        if (!today) return [];
        // The series holds the hour itself, so Now always has an answer.
        const now = computeSnowNow(judged, p.time)!;
        const later = whole.slice(i + 1).filter((d): d is SnowDayComputation => d !== null);
        const week = computeSnowWeek([today, ...later]);
        const { series: _series, ...brief } = formatSnowNow(now, unit);
        return [
          {
            time: new Date(p.time).toISOString(),
            now: brief,
            today: formatSnowDay(today, units),
            week: week ? formatSnowWeek(week, units) : null,
          },
        ];
      })
  );
}
