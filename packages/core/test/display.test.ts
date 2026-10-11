import { describe, expect, it } from 'vitest';
import {
  BANDS,
  LOADING_PALETTE,
  PALETTES,
  RAIN_BANDS,
  RAIN_PALETTES,
  SNOW_BANDS,
  SNOW_PALETTES,
  type Band,
  type RainBand,
  type SnowBand,
} from '../src/config';
import {
  ANSWERS,
  BAND_LABELS,
  COPY,
  SNOW_ANSWERS,
  VERDICTS,
  VIEWS,
  WEEK_VERDICTS,
} from '../src/copy';
import { defaultView, showsTomorrow, viewDisplay, type DisplayState } from '../src/display';
import type {
  ApiDay,
  ApiNow,
  ApiRain,
  ApiRainDay,
  ApiRainNow,
  ApiRainWeek,
  ApiSnow,
  ApiSnowDay,
  ApiSnowNow,
  ApiSnowWeek,
  ApiWeek,
  RainUnit,
  SnowUnit,
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

  it('gives Today and Now a UV line with words for screen readers, and none at UV 0', () => {
    const uvDay = hotDay('hot', { uv: { max: 7, level: 'high', peak: '1pm' } });
    const uvNow = { ...hotNow('hot'), uv: { value: 5, level: 'medium' as const } };
    const res = response({ days: [uvDay], now: uvNow });
    expect(viewDisplay(res, 'hot', 'today', 'ready').uv).toEqual({
      level: 'high',
      text: 'UV 7 · High, highest around 1pm',
      sr: 'UV index 7, high, highest around 1pm',
    });
    expect(viewDisplay(res, 'hot', 'now', 'ready').uv).toEqual({
      level: 'medium',
      text: 'UV 5 · Medium now',
      sr: 'UV index 5, medium',
    });
    // Nothing to say at night or on a polar winter's day, nor without UV data.
    const dark = response({
      days: [hotDay('cold', { uv: { max: 0, level: 'low', peak: null } })],
      now: { ...hotNow('cold'), uv: { value: 0, level: 'low' } },
    });
    expect(viewDisplay(dark, 'hot', 'today', 'ready').uv).toBeNull();
    expect(viewDisplay(dark, 'hot', 'now', 'ready').uv).toBeNull();
    expect(viewDisplay(response(), 'hot', 'today', 'ready').uv).toBeNull();
    expect(viewDisplay(response(), 'hot', 'now', 'ready').uv).toBeNull();
    // Now for this minute brings its own UV.
    const fresh = { ...hotNow('hot'), uv: { value: 9, level: 'veryhigh' as const } };
    expect(viewDisplay(res, 'hot', 'now', 'ready', { now: fresh }).uv!.text).toBe(
      'UV 9 · Very high now',
    );
    // Tomorrow's line is tomorrow's.
    const tomorrow = hotDay('hot', { uv: { max: 11, level: 'extreme', peak: '12pm' } });
    expect(
      viewDisplay(response({ days: [uvDay, tomorrow] }), 'hot', 'today', 'ready', {
        tomorrow: true,
      }).uv!.text,
    ).toBe('UV 11 · Extreme, highest around 12pm');
  });

  it('shows UV on the hot views only, and holds its place on Today while loading', () => {
    const res = response({
      days: [hotDay('hot', { uv: { max: 7, level: 'high', peak: '1pm' } })],
      now: { ...hotNow('hot'), uv: { value: 5, level: 'medium' } },
      snow: snowOf('snow'),
    });
    for (const topic of ['wet', 'snow'] as const) {
      expect(viewDisplay(res, topic, 'today', 'ready').uv).toBeNull();
      expect(viewDisplay(res, topic, 'now', 'ready').uv).toBeNull();
      expect(viewDisplay(null, topic, 'today', 'loading').uv).toBeNull();
    }
    expect(viewDisplay(null, 'hot', 'today', 'loading').uv).toMatchObject({ level: 'medium' });
    // Now opens at night as often as by day, so it holds no place.
    expect(viewDisplay(null, 'hot', 'now', 'loading').uv).toBeNull();
    expect(viewDisplay(null, 'hot', 'today', 'error').uv).toMatchObject({ level: 'medium' });
    expect(viewDisplay(res, 'hot', 'week', 'ready')).not.toHaveProperty('uv');
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

// ---- Snow --------------------------------------------------------------------------

const snowDay = (band: SnowBand, extra: Partial<ApiSnowDay> = {}): ApiSnowDay => ({
  date: '2026-10-15',
  from: '2026-10-15T12:20:00.000Z',
  partial: true,
  band,
  answer: SNOW_ANSWERS[band],
  verdict: `Verdict for ${band}.`,
  detail: '2 to 5cm still to come. Mostly between 2pm and 6pm.',
  reason: null,
  amount: 3,
  chance: 0.67,
  snowy: 2,
  total: 3,
  confidence: 'good',
  threshold: 0.5,
  likely: { from: 14, to: 18 },
  scale: { min: 0, max: 10 },
  models: [
    { id: 'a', name: 'ECMWF', amount: 3, value: 3.2, expectsSnow: true, agrees: true },
    { id: 'b', name: 'GFS', amount: 0.3, value: 0.34, expectsSnow: false, agrees: false },
    { id: 'c', name: 'ICON', amount: 12, value: 12.1, expectsSnow: true, agrees: true },
  ],
  month: 'October',
  agreementText: '2 of 3 forecasts expect snow',
  limitedText: null,
  stripSummary: 'Forecasts range from 0.3cm to 12cm; 2 of 3 expect snow.',
  ...extra,
});

const snowNow = (band: SnowBand): ApiSnowNow => ({
  time: '2026-10-15T12:20:00.000Z',
  band,
  answer: SNOW_ANSWERS[band],
  verdict: `Now verdict for ${band}.`,
  detail: 'Light snow now. Easing off by about 3pm.',
  amount: 0.1,
  chance: 0.75,
  hours: [
    { time: '2026-10-15T13:00:00.000Z', label: '2pm', chance: 60 },
    { time: '2026-10-15T15:00:00.000Z', label: '4pm', chance: 0 },
  ],
  series: [],
});

const snowWeek = (band: SnowBand, amounts = [4, 0, 8]): ApiSnowWeek => ({
  from: '2026-10-15',
  to: '2026-10-21',
  band,
  answer: SNOW_ANSWERS[band],
  verdict: `Week verdict for ${band}.`,
  detail: 'About 12cm across the week, most on Saturday (8cm).',
  total: 12,
  normal: 1,
  snowDays: 2,
  maybeDays: 0,
  snowiest: { date: '2026-10-17', amount: 8 },
  days: amounts.map((amount, i) => ({
    date: `2026-10-${15 + i}`,
    label: ['Today', 'Fri', 'Sat'][i]!,
    amount,
    band,
    bandLabel: `Label ${band}`,
  })),
});

const snowOf = (band: SnowBand, unit: SnowUnit = 'cm', extra: Partial<ApiSnow> = {}): ApiSnow => ({
  unit,
  days: [snowDay(band)],
  now: snowNow(band),
  week: snowWeek(band),
  ...extra,
});

describe('viewDisplay: snow', () => {
  it.each(SNOW_BANDS.flatMap((band) => VIEWS.map((view) => [band, view] as const)))(
    'shows %s for %s in its colours',
    (band, view) => {
      const snow = snowOf(band);
      const source = { today: snow.days[0]!, now: snow.now!, week: snow.week! }[view];
      const d = viewDisplay(response({ snow }), 'snow', view, 'ready');
      expect(d).toMatchObject({
        view,
        topic: 'snow',
        state: 'ready',
        band,
        answer: SNOW_ANSWERS[band],
        verdict: source.verdict,
        detail: source.detail,
        empty: false,
        pending: false,
      });
      expect(d.palette).toBe(SNOW_PALETTES[band]);
    },
  );

  it('asks whether it will snow, and whether it is snowing', () => {
    const res = response({ snow: snowOf('snow') });
    expect(viewDisplay(res, 'snow', 'today', 'ready').question).toBe('Will it snow today?');
    expect(viewDisplay(res, 'snow', 'now', 'ready', { city: 'Oslo' }).question).toBe(
      'Is it snowing in Oslo right now?',
    );
    expect(viewDisplay(res, 'snow', 'week', 'ready').question).toBe('Will it snow this week?');
  });

  it('highlights the snowy amounts on the Today strip, in cm or inches', () => {
    const day = snowDay('snow');
    const d = viewDisplay(response({ snow: snowOf('snow') }), 'snow', 'today', 'ready');
    const left = at(0.5, 0, 10);
    expect(d.models).toEqual({
      heading: '2 of 3 forecasts expect snow',
      summary: day.stripSummary,
      min: '0cm',
      max: '10cm',
      zone: { left, width: 100 - left },
      origin: at(3, 0, 10),
      dots: [
        { left: at(3.2, 0, 10), out: false, title: 'ECMWF 3cm' },
        { left: at(0.34, 0, 10), out: true, title: 'GFS 0.3cm' },
        { left: 100, out: false, title: 'ICON 12cm' },
      ],
      items: [
        { value: '3cm', name: 'ECMWF', out: false },
        { value: '0.3cm', name: 'GFS', out: true },
        { value: '12cm', name: 'ICON', out: false },
      ],
      limited: null,
    });
    const inches = response({ units: 'f', snow: snowOf('snow', 'in') });
    expect(viewDisplay(inches, 'snow', 'today', 'ready').models.max).toBe('10in');
    expect(viewDisplay(inches, 'snow', 'week', 'ready').items.map((i) => i.value)).toEqual([
      '4in',
      '0in',
      '8in',
    ]);
  });

  it('gives the chance of snow for the next hours, or "now" for this minute', () => {
    const res = response({ snow: snowOf('maybesnow') });
    const d = viewDisplay(res, 'snow', 'now', 'ready');
    expect(d.heading).toBe(COPY.nextHoursSnow);
    expect(d.items).toEqual([
      { value: '60%', label: '2pm', sr: '60% chance at 2pm' },
      { value: '0%', label: '4pm', sr: '0% chance at 4pm' },
    ]);
    const fresh = { ...snowNow('deepsnow'), hours: [] };
    expect(viewDisplay(res, 'snow', 'now', 'ready', { snowNow: fresh })).toMatchObject({
      band: 'deepsnow',
      items: [],
    });
    expect(viewDisplay(res, 'snow', 'now', 'ready', { snowNow: null })).toMatchObject({
      band: null,
      empty: true,
    });
    // Rain's "now" is no use for snow.
    expect(viewDisplay(res, 'snow', 'now', 'ready', { rainNow: null }).band).toBe('maybesnow');
  });

  it('places each day of the week from none to the snowiest', () => {
    const res = response({ snow: snowOf('heavysnow') });
    expect(viewDisplay(res, 'snow', 'week', 'ready')).toMatchObject({
      heading: COPY.nextDays,
      items: [
        { label: 'Today', value: '4cm', bandLabel: 'Label heavysnow', left: 50 },
        { label: 'Fri', value: '0cm', bandLabel: 'Label heavysnow', left: 0 },
        { label: 'Sat', value: '8cm', bandLabel: 'Label heavysnow', left: 100 },
      ],
    });
  });

  it('answers the middle view from tomorrow after 6pm', () => {
    const tomorrow = snowDay('deepsnow', { date: '2026-10-16', partial: false });
    const res = response({ snow: snowOf('snow', 'cm', { days: [snowDay('snow'), tomorrow] }) });
    expect(viewDisplay(res, 'snow', 'today', 'ready', { tomorrow: true })).toMatchObject({
      question: 'Will it snow tomorrow?',
      band: 'deepsnow',
    });
  });

  it('says every view is not available when the answer has no snow', () => {
    for (const view of VIEWS) {
      expect(viewDisplay(response(), 'snow', view, 'ready')).toMatchObject({
        band: null,
        answer: COPY.notAvailable,
        empty: true,
      });
    }
  });

  it('holds the layout with placeholders while loading', () => {
    const today = viewDisplay(null, 'snow', 'today', 'loading');
    expect(today.models).toMatchObject({ heading: '0 of 0 forecasts expect snow', min: '0cm' });
    expect(viewDisplay(null, 'snow', 'now', 'loading').heading).toBe(COPY.nextHoursSnow);
    expect(viewDisplay(null, 'snow', 'week', 'loading').items[0]).toEqual({
      label: 'Day',
      value: '0cm',
      bandLabel: 'Snow possible',
      left: null,
    });
    expect(viewDisplay(null, 'snow', 'week', 'loading').verdict).toBe('Snow on Thu and Fri.');
  });
});

// ---- Tomorrow --------------------------------------------------------------------------

describe('Tomorrow after 6pm', () => {
  /** London on 15 October 2026 is on BST (UTC+1). */
  const london = (hhmm: string) => Date.parse(`2026-10-15T${hhmm}:00+01:00`);
  const tomorrowHot = hotDay('hot', {
    date: '2026-10-16',
    verdict: "It'll be hot.",
    detail: 'High of 27°, feels like 28°. Warmest around 3pm. 11° warmer than usual for October.',
  });
  const tomorrowRain = rainDay('heavy', {
    date: '2026-10-16',
    partial: false,
    detail: 'About 14mm of rain. Mostly between 6am and 2pm.',
  });
  const evening = response({
    days: [hotDay('mild'), tomorrowHot],
    rain: rainOf('showers', 'mm', { days: [rainDay('showers'), tomorrowRain] }),
  });

  it('shows tomorrow from 6pm to midnight, local time at the place', () => {
    expect(showsTomorrow(evening, london('17:59'))).toBe(false);
    expect(showsTomorrow(evening, london('18:00'))).toBe(true);
    expect(showsTomorrow(evening, london('23:59'))).toBe(true);
    // Midnight: the response is for yesterday until the refetch brings the new day.
    expect(showsTomorrow(evening, london('00:00') + 24 * 3_600_000)).toBe(false);
    expect(showsTomorrow(evening, london('00:30'))).toBe(false);
    // The place's own clock: 6pm in London is 1pm in New York.
    const newYork = { ...evening, location: { ...evening.location, timezone: 'America/New_York' } };
    expect(showsTomorrow(newYork, london('18:30'))).toBe(false);
    expect(showsTomorrow(newYork, london('23:30'))).toBe(true);
  });

  it('never shows an empty Tomorrow', () => {
    expect(showsTomorrow(response(), london('20:00'))).toBe(false);
    expect(showsTomorrow(null, london('20:00'))).toBe(false);
    expect(defaultView(response(), london('20:00'))).toBe('today');
  });

  it('opens on Now while the middle view shows tomorrow, else on Today', () => {
    expect(defaultView(evening, london('09:00'))).toBe('today');
    expect(defaultView(evening, london('18:00'))).toBe('now');
    expect(defaultView(null, london('18:00'))).toBe('today');
  });

  it('answers the middle view from tomorrow, for either topic', () => {
    const hot = viewDisplay(evening, 'hot', 'today', 'ready', { city: 'London', tomorrow: true });
    expect(hot).toMatchObject({
      question: 'Will it be hot in London tomorrow?',
      band: 'hot',
      answer: 'Yes.',
      verdict: "It'll be hot.",
      detail: tomorrowHot.detail,
      palette: PALETTES.hot,
    });
    const wet = viewDisplay(evening, 'wet', 'today', 'ready', { tomorrow: true });
    expect(wet).toMatchObject({
      question: 'Will it be wet tomorrow?',
      band: 'heavy',
      answer: 'Yes.',
      detail: tomorrowRain.detail,
      palette: RAIN_PALETTES.heavy,
    });
    // Other views are unchanged.
    expect(viewDisplay(evening, 'wet', 'now', 'ready', { tomorrow: true }).question).toBe(
      'Is it wet right now?',
    );
    expect(viewDisplay(evening, 'hot', 'today', 'ready').verdict).toBe(VERDICTS.mild);
  });

  it('says tomorrow is not available when only the rain for it is missing', () => {
    const noRain = response({ days: [hotDay('mild'), tomorrowHot] });
    expect(viewDisplay(noRain, 'wet', 'today', 'ready', { tomorrow: true })).toMatchObject({
      question: 'Will it be wet tomorrow?',
      answer: COPY.notAvailable,
      empty: true,
    });
  });

  it('asks about tomorrow while it waits', () => {
    for (const topic of ['hot', 'wet'] as const) {
      const d = viewDisplay(null, topic, 'today', 'loading', { tomorrow: true });
      expect(d).toMatchObject({
        question: `Will it be ${topic} tomorrow?`,
        answer: COPY.checking,
        pending: true,
      });
    }
  });
});
