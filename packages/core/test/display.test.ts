import { describe, expect, it } from 'vitest';
import {
  BANDS,
  LOADING_PALETTE,
  PALETTES,
  RAIN_BANDS,
  RAIN_PALETTES,
  type Band,
  type RainBand,
} from '../src/config';
import { ANSWERS, BAND_LABELS, COPY, VERDICTS, VIEWS, WEEK_VERDICTS } from '../src/copy';
import { viewDisplay, type DisplayState } from '../src/display';
import type {
  ApiDay,
  ApiNow,
  ApiRain,
  ApiRainDay,
  ApiRainNow,
  ApiRainWeek,
  ApiWeek,
  RainUnit,
  TodayResponse,
} from '../src/types';

// ---- Fixtures --------------------------------------------------------------------

const hotDay = (band: Band, extra: Partial<ApiDay> = {}): ApiDay => ({
  date: '2026-10-15',
  band,
  answer: ANSWERS[band],
  verdict: VERDICTS[band],
  high: 16,
  feelsLike: 15,
  peakTime: '1pm',
  normalHigh: 16,
  anomaly: 0,
  detail: 'High of 16°, feels like 15°. Warmest around 1pm. About normal for October.',
  consensus: { value: 16, agree: 2, total: 4, bandLow: 14, bandHigh: 18, confidence: 'good' },
  models: [
    { id: 'a', name: 'ECMWF', high: 19, value: 19.2, agrees: false },
    { id: 'b', name: 'ICON', high: 15, value: 15.4, agrees: true },
    { id: 'c', name: 'UKMO', high: 16, value: 16, agrees: true },
    // Beyond the scale on both sides: the dots stop at the ends.
    { id: 'd', name: 'JMA', high: 9, value: 8.6, agrees: false },
    { id: 'e', name: 'GEM', high: 24, value: 24.1, agrees: false },
  ],
  month: 'October',
  agreementText: '2 of 5 forecasts agree within 2°',
  limitedText: null,
  stripSummary: 'Forecasts range from 9° to 24°; 2 of 5 agree near 16°.',
  scale: { min: 11, max: 22 },
  ...extra,
});

const hotNow = (band: Band): ApiNow => ({
  time: '2026-10-15T12:20:00.000Z',
  band,
  answer: ANSWERS[band],
  verdict: VERDICTS[band],
  temperature: 14,
  feelsLike: 13,
  detail: '14° now, feels like 13°. Rising to 16° around 3pm.',
  hours: [
    { time: '2026-10-15T13:00:00.000Z', label: '2pm', temperature: 15 },
    { time: '2026-10-15T15:00:00.000Z', label: '4pm', temperature: -2 },
  ],
  series: [],
});

const hotWeek = (band: Band, highs = [20, 14, 26]): ApiWeek => ({
  from: '2026-10-15',
  to: '2026-10-21',
  band,
  answer: ANSWERS[band],
  verdict: WEEK_VERDICTS[band],
  high: 20,
  highs: { min: Math.min(...highs), max: Math.max(...highs) },
  feelsLike: 19,
  normalHigh: 16,
  anomaly: 4,
  detail: 'Highs average 20°, feels like 19°. Hottest on Saturday, 26°.',
  hottest: { date: '2026-10-17', high: 26 },
  days: highs.map((high, i) => ({
    date: `2026-10-${15 + i}`,
    label: ['Today', 'Fri', 'Sat'][i]!,
    high,
    band,
    bandLabel: BAND_LABELS[band],
  })),
});

const RAIN_ANSWER: Record<RainBand, string> = {
  dry: 'No.',
  spots: 'No.',
  showers: 'Maybe.',
  rain: 'Yes.',
  heavy: 'Yes.',
  drenched: 'Yes.',
};

const rainDay = (band: RainBand, extra: Partial<ApiRainDay> = {}): ApiRainDay => ({
  date: '2026-10-15',
  from: '2026-10-15T12:20:00.000Z',
  partial: true,
  band,
  answer: RAIN_ANSWER[band],
  verdict: `Verdict for ${band}.`,
  detail: 'About 6mm still to come. Mostly between 2pm and 6pm.',
  amount: 6,
  chance: 0.67,
  wet: 2,
  total: 3,
  confidence: 'good',
  threshold: 1,
  snow: 'none',
  likely: { from: 14, to: 18 },
  scale: { min: 0, max: 15 },
  models: [
    { id: 'a', name: 'ECMWF', amount: 6, value: 6.2, expectsRain: true, agrees: true },
    { id: 'b', name: 'GFS', amount: 0.4, value: 0.43, expectsRain: false, agrees: false },
    // Past the end of the scale: the dot stops there.
    { id: 'c', name: 'ICON', amount: 18, value: 18.1, expectsRain: true, agrees: true },
  ],
  month: 'October',
  agreementText: '2 of 3 forecasts expect rain',
  limitedText: null,
  stripSummary: 'Forecasts range from 0.4mm to 18mm; 2 of 3 expect rain.',
  ...extra,
});

const rainNow = (band: RainBand): ApiRainNow => ({
  time: '2026-10-15T12:20:00.000Z',
  band,
  answer: RAIN_ANSWER[band],
  verdict: `Now verdict for ${band}.`,
  detail: 'Light rain now. Easing off by about 3pm.',
  amount: 0.3,
  chance: 0.75,
  snow: false,
  hours: [
    { time: '2026-10-15T13:00:00.000Z', label: '2pm', chance: 60 },
    { time: '2026-10-15T15:00:00.000Z', label: '4pm', chance: 0 },
  ],
  series: [],
});

const rainWeek = (band: RainBand, amounts = [4, 0, 12.5]): ApiRainWeek => ({
  from: '2026-10-15',
  to: '2026-10-21',
  band,
  answer: RAIN_ANSWER[band],
  verdict: `Week verdict for ${band}.`,
  detail: 'About 18mm across the week, most on Saturday (12.5mm).',
  total: 18,
  normal: 14,
  rainDays: 2,
  showerDays: 0,
  wettest: { date: '2026-10-17', amount: 12.5 },
  days: amounts.map((amount, i) => ({
    date: `2026-10-${15 + i}`,
    label: ['Today', 'Fri', 'Sat'][i]!,
    amount,
    band,
    bandLabel: `Label ${band}`,
    snow: false,
  })),
});

const rainOf = (band: RainBand, unit: RainUnit = 'mm', extra: Partial<ApiRain> = {}): ApiRain => ({
  unit,
  days: [rainDay(band)],
  now: rainNow(band),
  week: rainWeek(band),
  ...extra,
});

const response = (extra: Partial<TodayResponse> = {}): TodayResponse => ({
  location: {
    name: 'London',
    region: 'England',
    country: 'GB',
    lat: 51.5,
    lon: -0.1,
    timezone: 'Europe/London',
    source: 'city',
  },
  units: 'c',
  days: [hotDay('mild')],
  updatedAt: '2026-10-15T12:20:00.000Z',
  attribution: [],
  now: hotNow('mild'),
  week: hotWeek('mild'),
  rain: rainOf('showers'),
  ...extra,
});

/** Positions as the strips worked them out before the display model (lib/view.ts). */
const at = (v: number, lo: number, hi: number) =>
  Math.min(100, Math.max(0, ((v - lo) / (hi - lo || 1)) * 100));

// ---- Hot ---------------------------------------------------------------------------

describe('viewDisplay: hot', () => {
  it.each(BANDS.flatMap((band) => VIEWS.map((view) => [band, view] as const)))(
    'shows %s for %s in its colours',
    (band, view) => {
      const res = response({ days: [hotDay(band)], now: hotNow(band), week: hotWeek(band) });
      const source = { today: res.days[0]!, now: res.now!, week: res.week! }[view];
      const d = viewDisplay(res, 'hot', view, 'ready');
      expect(d).toMatchObject({
        view,
        topic: 'hot',
        state: 'ready',
        band,
        answer: ANSWERS[band],
        verdict: view === 'week' ? WEEK_VERDICTS[band] : VERDICTS[band],
        detail: source.detail,
        empty: false,
        pending: false,
      });
      expect(d.palette).toBe(PALETTES[band]);
    },
  );

  it('asks about the place on city pages and anywhere on the home page', () => {
    const res = response();
    expect(viewDisplay(res, 'hot', 'today', 'ready').question).toBe('Is it hot today?');
    expect(viewDisplay(res, 'hot', 'now', 'ready', { city: 'London' }).question).toBe(
      'Is it hot in London right now?',
    );
    expect(viewDisplay(null, 'hot', 'week', 'loading', { city: 'Leeds' }).question).toBe(
      'Is it hot in Leeds this week?',
    );
  });

  it('lays out the Today strip as the page always has', () => {
    const day = hotDay('warm');
    const d = viewDisplay(response({ days: [day] }), 'hot', 'today', 'ready');
    expect(d.detail).toBe(day.detail);
    const left = at(14, 11, 22);
    const width = at(18, 11, 22) - left;
    expect(d.models).toEqual({
      heading: '2 of 5 forecasts agree within 2°',
      summary: day.stripSummary,
      min: '11°',
      max: '22°',
      zone: { left, width },
      origin: left + width / 2,
      dots: [
        { left: at(19.2, 11, 22), out: true, title: 'ECMWF 19°' },
        { left: at(15.4, 11, 22), out: false, title: 'ICON 15°' },
        { left: at(16, 11, 22), out: false, title: 'UKMO 16°' },
        { left: 0, out: true, title: 'JMA 9°' },
        { left: 100, out: true, title: 'GEM 24°' },
      ],
      items: [
        { value: '19°', name: 'ECMWF', out: true },
        { value: '15°', name: 'ICON', out: false },
        { value: '16°', name: 'UKMO', out: false },
        { value: '9°', name: 'JMA', out: true },
        { value: '24°', name: 'GEM', out: true },
      ],
      limited: null,
    });
    expect(d.models.zone!.left).toBeCloseTo(27.273, 3);
    expect(d.models.zone!.width).toBeCloseTo(36.364, 3);
  });

  it('says when the forecast data is limited, and copes with a flat scale', () => {
    const day = hotDay('cold', {
      limitedText: COPY.limited,
      scale: { min: 15, max: 15 },
      models: [{ id: 'a', name: 'ECMWF', high: 15, value: 15, agrees: true }],
    });
    const m = viewDisplay(response({ days: [day] }), 'hot', 'today', 'ready').models;
    expect(m.limited).toBe(COPY.limited);
    expect(m.zone).toEqual({ left: 0, width: 100 });
    expect(m.dots).toEqual([{ left: 0, out: false, title: 'ECMWF 15°' }]);
  });

  it('lists the next hours from the response, or from "now" for this minute', () => {
    const res = response();
    const d = viewDisplay(res, 'hot', 'now', 'ready');
    expect(d.heading).toBe(COPY.nextHours);
    expect(d.detail).toBe(res.now!.detail);
    expect(d.items).toEqual([
      { value: '15°', label: '2pm', sr: null },
      { value: '-2°', label: '4pm', sr: null },
    ]);
    const fresh = { ...hotNow('hot'), hours: [] };
    const later = viewDisplay(res, 'hot', 'now', 'ready', { now: fresh });
    expect(later).toMatchObject({ band: 'hot', items: [] });
    // Nothing for this minute: the response's "now" is out of date, so it is not shown.
    const none = viewDisplay(res, 'hot', 'now', 'ready', { now: null });
    expect(none).toMatchObject({ band: null, empty: true, answer: COPY.notAvailable });
  });

  it('places each day of the week on a scale a little wider than its highs', () => {
    const week = hotWeek('warm');
    const d = viewDisplay(response({ week }), 'hot', 'week', 'ready');
    expect(d.heading).toBe(COPY.nextDays);
    expect(d.detail).toBe(week.detail);
    expect(d.items).toEqual([
      { label: 'Today', value: '20°', bandLabel: 'Warm', left: 50 },
      { label: 'Fri', value: '14°', bandLabel: 'Warm', left: at(14, 11, 29) },
      { label: 'Sat', value: '26°', bandLabel: 'Warm', left: at(26, 11, 29) },
    ]);
  });

  it('says a view is not available when the answer has nothing for it', () => {
    const res = response({ days: [], now: undefined, week: undefined });
    for (const view of VIEWS) {
      const d = viewDisplay(res, 'hot', view, 'ready');
      expect(d).toMatchObject({
        band: null,
        answer: COPY.notAvailable,
        verdict: '',
        detail: '',
        empty: true,
        pending: false,
      });
      expect(d.palette).toBe(LOADING_PALETTE);
    }
    expect(viewDisplay(res, 'hot', 'now', 'ready').items).toEqual([]);
    expect(viewDisplay(res, 'hot', 'week', 'ready').items).toEqual([]);
    expect(viewDisplay(null, 'hot', 'today', 'ready').models).toEqual({
      heading: '',
      summary: '',
      min: '',
      max: '',
      zone: null,
      origin: 0,
      dots: [],
      items: [],
      limited: null,
    });
  });

  it.each<[DisplayState, string]>([
    ['loading', COPY.checking],
    ['error', COPY.unavailable],
  ])('holds the layout with placeholders while %s', (state, answer) => {
    // A response is ignored until the state is ready.
    const res = response();
    const today = viewDisplay(res, 'hot', 'today', state);
    expect(today).toMatchObject({
      band: null,
      answer,
      verdict: "It's warm, not hot.",
      detail:
        'High of 00°, feels like 00°. Warmest around 0pm. 0° warmer than usual for September.',
      empty: false,
      pending: true,
    });
    expect(today.palette).toBe(LOADING_PALETTE);
    expect(today.models).toEqual({
      heading: '0 of 0 forecasts agree within 2°',
      summary: '',
      min: '0°',
      max: '0°',
      zone: null,
      origin: 0,
      dots: [],
      items: Array.from({ length: 8 }, () => ({ value: '00°', name: 'Model', out: false })),
      limited: null,
    });
    const now = viewDisplay(res, 'hot', 'now', state);
    expect(now).toMatchObject({
      answer,
      verdict: "It's warm, not hot.",
      detail: '00° right now, feels like 00°. Rising to 00° by 0pm.',
      heading: COPY.nextHours,
    });
    expect(now.items).toEqual(
      Array.from({ length: 6 }, () => ({ value: '00°', label: '0pm', sr: null })),
    );
    const week = viewDisplay(res, 'hot', 'week', state);
    expect(week).toMatchObject({
      answer,
      verdict: 'A warm week, not hot.',
      detail:
        'Highs average 00°, feels like 00°. Hottest on Wednesday, 00°. 0° warmer than usual for September.',
    });
    expect(week.items).toEqual(
      Array.from({ length: 7 }, () => ({
        label: 'Day',
        value: '00°',
        bandLabel: 'Warm',
        left: null,
      })),
    );
    // Each call gets its own rows.
    expect(viewDisplay(null, 'hot', 'today', state).models.items[0]).not.toBe(
      today.models.items[0],
    );
  });
});

// ---- Wet ---------------------------------------------------------------------------

describe('viewDisplay: wet', () => {
  it.each(RAIN_BANDS.flatMap((band) => VIEWS.map((view) => [band, view] as const)))(
    'shows %s for %s in its colours',
    (band, view) => {
      const rain = rainOf(band);
      const source = { today: rain.days[0]!, now: rain.now!, week: rain.week! }[view];
      const d = viewDisplay(response({ rain }), 'wet', view, 'ready');
      expect(d).toMatchObject({
        view,
        topic: 'wet',
        state: 'ready',
        band,
        answer: RAIN_ANSWER[band],
        verdict: source.verdict,
        detail: source.detail,
        empty: false,
        pending: false,
      });
      expect(d.palette).toBe(RAIN_PALETTES[band]);
    },
  );

  it('asks whether it is wet', () => {
    const res = response();
    expect(viewDisplay(res, 'wet', 'today', 'ready').question).toBe('Is it wet today?');
    expect(viewDisplay(res, 'wet', 'now', 'ready', { city: 'Leeds' }).question).toBe(
      'Is it wet in Leeds right now?',
    );
  });

  it('highlights the wet amounts on the Today strip, from none', () => {
    const day = rainDay('rain');
    const d = viewDisplay(response({ rain: rainOf('rain') }), 'wet', 'today', 'ready');
    expect(d.detail).toBe(day.detail);
    const left = at(1, 0, 15);
    expect(d.models).toEqual({
      heading: '2 of 3 forecasts expect rain',
      summary: day.stripSummary,
      min: '0mm',
      max: '15mm',
      zone: { left, width: 100 - left },
      origin: at(6, 0, 15),
      dots: [
        { left: at(6.2, 0, 15), out: false, title: 'ECMWF 6mm' },
        { left: at(0.43, 0, 15), out: true, title: 'GFS 0.4mm' },
        { left: 100, out: false, title: 'ICON 18mm' },
      ],
      items: [
        { value: '6mm', name: 'ECMWF', out: false },
        { value: '0.4mm', name: 'GFS', out: true },
        { value: '18mm', name: 'ICON', out: false },
      ],
      limited: null,
    });
  });

  it('writes amounts in inches with °F, and says when the data is limited', () => {
    const day = rainDay('heavy', {
      threshold: 0.04,
      scale: { min: 0, max: 0.5 },
      amount: 0.12,
      limitedText: COPY.limited,
      models: [{ id: 'a', name: 'GFS', amount: 1.2, value: 1.18, expectsRain: true, agrees: true }],
    });
    const rain = rainOf('heavy', 'in', { days: [day], week: rainWeek('heavy', [0.12, 1.2]) });
    const res = response({ units: 'f', rain });
    const today = viewDisplay(res, 'wet', 'today', 'ready').models;
    expect(today).toMatchObject({
      min: '0in',
      max: '0.5in',
      origin: 24,
      dots: [{ left: 100, out: false, title: 'GFS 1.2in' }],
      items: [{ value: '1.2in', name: 'GFS', out: false }],
      limited: COPY.limited,
    });
    expect(today.zone!.left).toBeCloseTo(8, 9);
    expect(today.zone!.width).toBeCloseTo(92, 9);
    expect(viewDisplay(res, 'wet', 'week', 'ready').items.map((i) => i.value)).toEqual([
      '0.12in',
      '1.2in',
    ]);
  });

  it('never gives the wet zone a negative width', () => {
    const day = rainDay('dry', { scale: { min: 0, max: 0 }, models: [] });
    const res = response({ rain: rainOf('dry', 'mm', { days: [day] }) });
    expect(viewDisplay(res, 'wet', 'today', 'ready').models.zone).toEqual({ left: 100, width: 0 });
  });

  it('gives the chance of rain for the next hours, with words for screen readers', () => {
    const res = response();
    const d = viewDisplay(res, 'wet', 'now', 'ready');
    expect(d.heading).toBe(COPY.nextHoursRain);
    expect(d.detail).toBe(res.rain!.now!.detail);
    expect(d.items).toEqual([
      { value: '60%', label: '2pm', sr: '60% chance at 2pm' },
      { value: '0%', label: '4pm', sr: '0% chance at 4pm' },
    ]);
    // "Now" worked out again for this minute takes the place of the response's.
    const fresh = { ...rainNow('drenched'), hours: [] };
    expect(viewDisplay(res, 'wet', 'now', 'ready', { rainNow: fresh })).toMatchObject({
      band: 'drenched',
      items: [],
    });
    expect(viewDisplay(res, 'wet', 'now', 'ready', { rainNow: null })).toMatchObject({
      band: null,
      empty: true,
    });
    // The hot "now" is no use for rain.
    expect(viewDisplay(res, 'wet', 'now', 'ready', { now: null }).band).toBe('showers');
  });

  it('places each day of the week from none to the wettest', () => {
    const res = response({ rain: rainOf('rain') });
    expect(viewDisplay(res, 'wet', 'week', 'ready')).toMatchObject({
      heading: COPY.nextDays,
      detail: res.rain!.week!.detail,
      items: [
        { label: 'Today', value: '4mm', bandLabel: 'Label rain', left: 32 },
        { label: 'Fri', value: '0mm', bandLabel: 'Label rain', left: 0 },
        { label: 'Sat', value: '12.5mm', bandLabel: 'Label rain', left: 100 },
      ],
    });
    const dry = response({ rain: rainOf('dry', 'mm', { week: rainWeek('dry', [0, 0, 0]) }) });
    expect(viewDisplay(dry, 'wet', 'week', 'ready').items.map((i) => i.left)).toEqual([0, 0, 0]);
  });

  it('says every view is not available when the answer has no rain', () => {
    const noRain = response({ rain: undefined });
    const noDays = response({ rain: { unit: 'mm', days: [] } });
    for (const res of [noRain, noDays]) {
      for (const view of VIEWS) {
        expect(viewDisplay(res, 'wet', view, 'ready')).toMatchObject({
          band: null,
          palette: LOADING_PALETTE,
          answer: COPY.notAvailable,
          verdict: '',
          detail: '',
          empty: true,
        });
      }
      expect(viewDisplay(res, 'wet', 'today', 'ready').models.items).toEqual([]);
    }
    // Today without "now" or a week.
    const today = response({ rain: rainOf('rain', 'mm', { now: undefined, week: undefined }) });
    expect(viewDisplay(today, 'wet', 'today', 'ready').empty).toBe(false);
    expect(viewDisplay(today, 'wet', 'now', 'ready').empty).toBe(true);
    expect(viewDisplay(today, 'wet', 'week', 'ready').empty).toBe(true);
  });

  it.each<[DisplayState, string]>([
    ['loading', COPY.checking],
    ['error', COPY.unavailable],
  ])('holds the layout with placeholders while %s', (state, answer) => {
    const today = viewDisplay(null, 'wet', 'today', state);
    expect(today).toMatchObject({ band: null, answer, pending: true, empty: false });
    expect(today.verdict.length).toBeGreaterThan(0);
    expect(today.detail.length).toBeGreaterThan(0);
    expect(today.models).toMatchObject({ heading: '0 of 0 forecasts expect rain', min: '0mm' });
    expect(today.models.items).toHaveLength(8);
    const now = viewDisplay(null, 'wet', 'now', state);
    expect(now).toMatchObject({ answer, heading: COPY.nextHoursRain });
    expect(now.items).toEqual(
      Array.from({ length: 6 }, () => ({ value: '00%', label: '0pm', sr: null })),
    );
    const week = viewDisplay(null, 'wet', 'week', state);
    expect(week.answer).toBe(answer);
    expect(week.items).toHaveLength(7);
    expect(week.items[0]).toEqual({ label: 'Day', value: '0mm', bandLabel: 'Showers', left: null });
  });
});
