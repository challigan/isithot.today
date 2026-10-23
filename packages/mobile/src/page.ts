/**
 * The app's forecast page as plain values (iOS build spec, section 10.2): the TypeScript reference
 * for IsItLogic's `HomePage`, which the golden vectors in `page.json` hold the Swift to. The page
 * words nothing of its own. What a view shows of the answer is core `viewDisplay`'s, as the
 * website shows it, for the answer client `pickHour` picks at the moment (the middle view's day
 * from client `middleDay`); the footer's lines are the website's (Views.astro), from the answer's
 * `updated` (client `updatedLine`) and `stale`; and the rest is appCopy.ts's.
 *
 * Pure: the moment is given (`now`, epoch ms), and so is how the last request went (`phase`).
 */
import {
  COPY,
  localDateTime,
  question,
  showsTomorrow,
  viewDisplay,
  viewLabel,
  type ApiSnow,
  type ApiSnowDay,
  type ApiSnowNow,
  type ApiSnowWeek,
  type SnowBand,
  type TodayResponse,
  type View,
  type ViewDisplay,
} from '@isithot/core';
import { middleDay, pickHour, updatedLine, type PickedHour } from '@isithot/client';
import { APP_COPY } from './appCopy';

/**
 * How the last request went, as the app's model keeps it (spec 9.4): asking, answered, failed,
 * or failed for want of a connection.
 */
export type PagePhase = 'loading' | 'ready' | 'error' | 'offline';

/**
 * What the page shows: an answer; "Checking…" while the first is on its way; the error, with
 * Retry, when there is none (offline, that there is no recent forecast); "Not available right
 * now." when the answer has no block for the view; or, past `usableUntil`, that there is no recent
 * forecast.
 */
export type PageState = 'ready' | 'loading' | 'error' | 'notAvailable' | 'noRecent';

export interface PageInput {
  view: View;
  /** The moment, epoch ms. */
  now: number;
  phase: PagePhase;
  /** The place as the top bar names it; without one, the answer's (`location.name`). */
  placeName?: string | null;
}

/** A row of the model list under the strip: "ECMWF · 2cm", dimmed when the model disagrees. */
export interface ModelLine {
  text: string;
  out: boolean;
}

export interface HomePage {
  view: View;
  state: PageState;
  /** The middle view answers for tomorrow (core `showsTomorrow`). */
  tomorrow: boolean;
  /** The view's label in the switcher: "Now", "Today" or "Tomorrow", "This week". */
  label: string;
  /** The band shown, or null without an answer (the page is then on `nosnow`'s palette). */
  band: SnowBand | null;
  question: string;
  /** The answer word ("Yes."), or what the state says in its place. */
  answer: string;
  /** The question and answer as VoiceOver reads them, with the place. */
  heading: string;
  verdict: string | null;
  detail: string | null;
  /** The answer's own object the page shows: the day, the Now or the week. */
  shown: ApiSnowDay | ApiSnowNow | Omit<ApiSnowNow, 'series'> | ApiSnowWeek | null;
  /** Today's or tomorrow's agreement heading, strip summary, limited line and model list. */
  day: { heading: string; summary: string; limited: string | null; lines: ModelLine[] } | null;
  /** "Retry", in the error state. */
  retry: string | null;
  /** The footer's lines, with an answer: when it was fetched, and the stale or offline line. */
  footer: { updated: string | null; notice: string | null } | null;
}

/** What the page says in the answer's place, without one to show. */
const NO_ANSWER: Record<Exclude<PageState, 'ready'>, string> = {
  loading: COPY.checking,
  error: COPY.unavailable,
  notAvailable: COPY.notAvailable,
  noRecent: APP_COPY.staleApp,
};

/** An appCopy.ts template with its slots filled, as the generated Swift functions fill them. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([^{}]*)\}/g, (slot, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for ${slot}`);
    return value;
  });
}

/** What the website shows of `view` for the answer picked: core `viewDisplay`, as Views.astro. */
function shownView(
  res: TodayResponse,
  snow: ApiSnow,
  picked: PickedHour,
  view: View,
  now: number,
): { display: ViewDisplay; shown: HomePage['shown'] } {
  if (view === 'now') {
    // As the website's Now, worked out for the minute: here, the hour's answer.
    const snowNow = picked.now as ApiSnowNow | null;
    return { display: viewDisplay(res, 'snow', 'now', 'ready', { snowNow }), shown: picked.now };
  }
  if (view === 'week') {
    const week = { ...snow, week: picked.week ?? undefined };
    return {
      display: viewDisplay({ ...res, snow: week }, 'snow', 'week', 'ready'),
      shown: picked.week,
    };
  }
  const { slot, day } = middleDay(res, picked, now);
  const tomorrow = slot === 'tomorrow';
  // The answer as the server sent it at the hour picked: that hour's today in place of its own.
  const days = tomorrow ? snow.days : picked.today ? [picked.today, ...snow.days.slice(1)] : [];
  return {
    display: viewDisplay({ ...res, snow: { ...snow, days } }, 'snow', 'today', 'ready', {
      tomorrow,
    }),
    shown: day,
  };
}

/**
 * The page for `view` at `o.now`, from the answer the app has (or null before the first). The
 * question asks without the place, as on the website's home page; VoiceOver hears it with the
 * place (`heading`).
 */
export function homePage(res: TodayResponse | null, o: PageInput): HomePage {
  const tomorrow = showsTomorrow(res, o.now);
  const picked = res?.snow ? pickHour(res, o.now) : null;
  const seen = res?.snow && picked ? shownView(res, res.snow, picked, o.view, o.now) : null;
  const state: PageState = !res
    ? o.phase === 'error' || o.phase === 'offline'
      ? 'error'
      : 'loading'
    : !res.snow
      ? 'notAvailable'
      : !seen
        ? 'noRecent'
        : seen.display.empty
          ? 'notAvailable'
          : 'ready';
  const ready = state === 'ready' ? seen!.display : null;
  // The same question `viewDisplay` asks, with or without an answer to show.
  const ask = question(null, o.view, 'snow', tomorrow);
  // With no answer at all for want of a connection, the forecasts aren't what is unavailable: as
  // past `usableUntil`, there is no recent forecast, and a connection brings one (Retry stays).
  const answer = ready
    ? ready.answer
    : state === 'error' && o.phase === 'offline'
      ? APP_COPY.staleApp
      : NO_ANSWER[state as Exclude<PageState, 'ready'>];
  const place = o.placeName ?? res?.location.name ?? '';
  const models = ready?.view === 'today' ? ready.models : null;
  const when = res?.updated
    ? updatedLine(res.updated, localDateTime(res.location.timezone, new Date(o.now)).date)
    : null;
  const notice =
    state === 'noRecent'
      ? null
      : o.phase === 'offline'
        ? when && fill(APP_COPY.offline, { time: when })
        : res?.stale
          ? COPY.stale
          : null;
  return {
    view: o.view,
    state,
    tomorrow,
    label: viewLabel(o.view, tomorrow),
    band: (ready?.band as SnowBand | null | undefined) ?? null,
    question: ask,
    answer,
    heading: place
      ? fill(APP_COPY.headingLabel, { place, question: ask, answer })
      : `${ask} ${answer}`,
    verdict: ready?.verdict ?? null,
    detail: ready?.detail ?? null,
    shown: ready ? seen!.shown : null,
    day: models && {
      heading: models.heading,
      summary: models.summary,
      limited: models.limited,
      lines: models.items.map((m) => ({
        text: fill(APP_COPY.modelLine, { name: m.name, value: m.value }),
        out: m.out,
      })),
    },
    retry: state === 'error' ? COPY.retry : null,
    footer: res && { updated: when && `${COPY.updated} ${when}`, notice },
  };
}
