/**
 * What a widget shows (iOS build spec, sections 11.1 and 11.3) as plain values: the TypeScript
 * reference for IsItLogic's `WidgetFace`, which the golden vectors in `widgetFace.json` hold the
 * Swift to, as `page.ts` is for `HomePage`. A face is one entry of client `widgetEntries`'s plan,
 * worded for every family at once: the small family and the medium's left half, the medium's
 * right half (Now and the week's rows), and the three Lock Screen families; and what VoiceOver
 * reads for each, one sentence a tap target.
 *
 * The face words nothing of its own. Its words are core's (`viewLabel`, `WEEKDAYS`,
 * `COPY.notAvailable`, `snowAgreementLine`) and the server's (the answer, the verdict, the band
 * labels), set in appCopy.ts's templates; its links are client `routeLink`'s; and the week's rows
 * read as the app's week page reads them (`spokenWeekDay`). Each rule is a small function of its
 * own, so the Swift mirrors it line for line.
 */
import {
  COPY,
  WEEKDAYS,
  parseDate,
  snowAgreementLine,
  viewLabel,
  type ApiSnowDay,
  type SnowBand,
  type SnowUnit,
} from '@isithot/core';
import { routeLink, type WidgetDay, type WidgetEntry } from '@isithot/client';
import { APP_COPY } from './appCopy';
import { fill, spokenWeekDay } from './page';

/** Models expecting snow, of those with data: the dots and the gauge. */
export interface WidgetAgreement {
  snowy: number;
  total: number;
}

/** A day on the medium's right half, after the middle day. */
export interface WidgetWeekRow {
  /** The server's label: "Fri", or "Today" for the week's first day. */
  label: string;
  band: SnowBand;
  bandLabel: string;
  /** Null when the day has no counts, or none of the models has data for it: no dots. */
  agreement: WidgetAgreement | null;
  /**
   * As the app's week page reads the row: "Friday, 8cm, heavy snow, 6 of 6 forecasts expect
   * snow".
   */
  spoken: string;
}

/** What one widget entry shows in every family (spec 11.1 and 11.3), as plain values. */
export interface WidgetFace {
  state: 'ok' | 'locked' | 'stale';
  /**
   * Where a tap goes (`widgetURL`): view/today for an answer and the stale state, the upgrade
   * when locked.
   */
  link: string;
  /**
   * The palette and the glyph: the middle day's band; nosnow when locked, stale or without a
   * day.
   */
  band: SnowBand;
  /** An answer's place, the caption; '' otherwise. */
  place: string;
  /** "Today" or "Tomorrow" (core `viewLabel('today', tomorrow)`); '' when locked or stale. */
  slot: string;
  /** The middle day's answer, "Yes."; '' without one. */
  answer: string;
  /**
   * "Heavy snow · 5cm", or the reason, "Too warm"; COPY.notAvailable without a day; '' when
   * locked or stale.
   */
  detail: string;
  /** Models expecting snow of those with data, for the dots and the gauge; null without data. */
  agreement: WidgetAgreement | null;
  /** "5 of 6 forecasts", the rectangular family's third line; '' without data. */
  agreementShort: string;
  /** "Tomorrow · Yes.", the rectangular family's first line; the slot alone without an answer. */
  slotAnswer: string;
  /** "Tomorrow: Heavy snow" (inline); the message when locked or stale. */
  inline: string;
  /** `widgetLocked` or `widgetStale`; '' with an answer. */
  message: string;
  /** VoiceOver: the small family and the medium's left half. */
  spoken: string;
  /** VoiceOver: the rectangular family (the same without the place). */
  spokenShort: string;
  /** VoiceOver: the circular family. */
  spokenGauge: string;
  /** The medium's right half: Now ("Now", "No. Too warm for snow."), or null without it. */
  now: { label: string; text: string; spoken: string } | null;
  /** The medium's right half: up to 4 days after the middle day. */
  week: WidgetWeekRow[];
  /** The right half's link, view/week; '' when locked or stale. */
  weekLink: string;
}

/** A link the face taps through to, which `routeLink` always has for a view or the upgrade. */
const link = (route: Parameters<typeof routeLink>[0]): string => routeLink(route)!;

/**
 * The locked or the stale face: its message in every family and to VoiceOver, the nosnow
 * palette, and nothing of an answer. Locked taps through to the upgrade, stale to Today.
 */
function messageFace(state: 'locked' | 'stale'): WidgetFace {
  const message = state === 'locked' ? APP_COPY.widgetLocked : APP_COPY.widgetStale;
  return {
    state,
    link: link(state === 'locked' ? { kind: 'upgrade' } : { kind: 'view', view: 'today' }),
    band: 'nosnow',
    place: '',
    slot: '',
    answer: '',
    detail: '',
    agreement: null,
    agreementShort: '',
    slotAnswer: '',
    inline: message,
    message,
    spoken: message,
    spokenShort: message,
    spokenGauge: message,
    now: null,
    week: [],
    weekLink: '',
  };
}

/**
 * The middle day's detail, shown with `template` ("Heavy snow · 5cm") or spoken ("Heavy snow,
 * 5cm"): the band and the amount when it snows, else the band label alone, which for a day
 * without snow is the reason ("Too warm").
 */
function dayDetail(day: ApiSnowDay, unit: SnowUnit, template: string): string {
  return day.reason === null && day.amount > 0
    ? fill(template, { band: day.bandLabel, amount: `${day.amount}${unit}` })
    : day.bandLabel;
}

/** The day's agreement when any model has data for it: the dots and the gauge. */
function dayAgreement(day: ApiSnowDay): WidgetAgreement | null {
  return day.total > 0 ? { snowy: day.snowy, total: day.total } : null;
}

/** A row's agreement when both counts are numbers and any model has data for the day. */
function rowAgreement(d: WidgetDay): WidgetAgreement | null {
  const counted = typeof d.snowy === 'number' && typeof d.total === 'number';
  return counted && d.total > 0 ? { snowy: d.snowy, total: d.total } : null;
}

/**
 * A row as the app's week page reads it: its name is the server's "Today" for the week's first
 * day (reached only without a middle day), and otherwise the weekday in full, from the date.
 */
function weekRow(d: WidgetDay, unit: SnowUnit): WidgetWeekRow {
  const name =
    d.label === viewLabel('today') ? d.label : WEEKDAYS[new Date(parseDate(d.date)).getUTCDay()]!;
  return {
    label: d.label,
    band: d.band,
    bandLabel: d.bandLabel,
    agreement: rowAgreement(d),
    spoken: spokenWeekDay({
      name,
      amount: `${d.amount}${unit}`,
      bandLabel: d.bandLabel,
      snowy: d.snowy,
      total: d.total,
    }),
  };
}

/**
 * Now on the medium's right half: "No. Too warm for snow.", read as "Now: No. Too warm for
 * snow.".
 */
function nowLine(now: NonNullable<WidgetEntry['now']>): NonNullable<WidgetFace['now']> {
  const label = viewLabel('now');
  const text = fill(APP_COPY.widgetNow, { answer: now.answer, verdict: now.verdict });
  return { label, text, spoken: fill(APP_COPY.widgetSlotLine, { slot: label, text }) };
}

/**
 * The face of `entry`, its amounts in `unit` (the answer's `snow.unit`). Locked and stale say
 * their message; an answer shows the middle day, or says it is not available when the answer has
 * no such day (no tomorrow from 6pm), with Now and the week's rows wherever the answer has them.
 */
export function widgetFace(entry: WidgetEntry, unit: SnowUnit): WidgetFace {
  if (entry.state !== 'ok') return messageFace(entry.state);
  const { day } = entry;
  const place = entry.placeName;
  const slot = viewLabel('today', entry.slot === 'tomorrow');
  const answer = day ? day.answer : '';
  const agreement = day ? dayAgreement(day) : null;
  const phrase = agreement && snowAgreementLine(agreement.snowy, agreement.total);
  // What VoiceOver says for the answer, which is never silent.
  const said = answer || COPY.notAvailable;
  const slotLine = fill(APP_COPY.widgetSlotLine, { slot, text: said });
  const heading = place ? fill(APP_COPY.widgetHeading, { place, slot, answer: said }) : slotLine;
  const sentence = (first: string): string => {
    if (!day) return first;
    const detail = dayDetail(day, unit, APP_COPY.widgetBandAmountSpoken);
    return phrase
      ? fill(APP_COPY.widgetSentence, { heading: first, detail, agreement: phrase })
      : fill(APP_COPY.widgetSentenceShort, { heading: first, detail });
  };
  return {
    state: 'ok',
    link: link({ kind: 'view', view: 'today' }),
    band: entry.palette,
    place,
    slot,
    answer,
    detail: day ? dayDetail(day, unit, APP_COPY.widgetBandAmount) : COPY.notAvailable,
    agreement,
    agreementShort: agreement
      ? fill(APP_COPY.agreementShort, {
          snowy: String(agreement.snowy),
          total: String(agreement.total),
        })
      : '',
    slotAnswer: answer ? fill(APP_COPY.widgetSlotAnswer, { slot, answer }) : slot,
    inline: fill(APP_COPY.widgetSlotLine, { slot, text: day ? day.bandLabel : COPY.notAvailable }),
    message: '',
    spoken: sentence(heading),
    spokenShort: sentence(slotLine),
    spokenGauge: phrase ? fill(APP_COPY.widgetGauge, { slot, agreement: phrase }) : slotLine,
    now: entry.now && nowLine(entry.now),
    week: entry.week.map((d) => weekRow(d, unit)),
    weekLink: link({ kind: 'view', view: 'week' }),
  };
}
