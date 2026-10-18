import { describe, expect, it } from 'vitest';
import {
  BANDS,
  RAIN_BANDS,
  SNOW_BANDS,
  WIND_BANDS,
  paletteFor,
  type AnyBand,
  type Band,
  type WindBand,
} from '../src/config';
import { PREVIEW_WIND_BANDS, WIND_BAND_LABELS, previewResponse } from '../src/preview';

describe('previewResponse for wind', () => {
  it('lists the wind bands with labels and palettes', () => {
    expect(PREVIEW_WIND_BANDS).toEqual(WIND_BANDS);
    for (const band of PREVIEW_WIND_BANDS) {
      expect(WIND_BAND_LABELS[band]).toBeTruthy();
      expect(paletteFor(band).ink).toMatch(/^#/);
    }
  });

  it('shows every wind band in all three views, with hot and rain samples that suit it', () => {
    const hot: Record<WindBand, Band> = {
      calm: 'warm',
      breezy: 'mild',
      windy: 'cold',
      verywindy: 'cold',
      gale: 'cold',
      storm: 'cold',
    };
    for (const band of PREVIEW_WIND_BANDS) {
      const r = previewResponse(band);
      const wind = r.wind!;
      // Every sample is in the UK: mph by default.
      expect(wind.unit).toBe('mph');
      expect(wind.days.map((d) => d.partial)).toEqual([true, false]);
      expect(wind.days[0]!.band).toBe(band);
      expect(wind.days[0]!.models).toHaveLength(6);
      expect(wind.now!.band).toBe(band);
      expect(wind.now!.hours).toHaveLength(6);
      expect(wind.week!.band).toBe(band);
      expect(wind.week!.days).toHaveLength(7);
      expect(r.days[0]!.band).toBe(hot[band]);
      expect(r.rain!.days[0]!.from).toBe(wind.days[0]!.from);
    }
  });

  it('reads like a real forecast', () => {
    const say = (band: AnyBand) => {
      const wind = previewResponse(band).wind!;
      const d = wind.days[0]!;
      return [
        d.answer,
        d.verdict,
        d.detail,
        wind.now!.verdict,
        wind.now!.detail,
        wind.week!.verdict,
      ];
    };
    expect(say('calm')).toEqual([
      'No.',
      "It'll be calm.",
      'Light winds, gusts up to 7mph. Calmer than usual for June.',
      "It's calm.",
      'Wind 2mph, gusts 6mph right now. Light winds for the next 12 hours.',
      'Light winds all week.',
    ]);
    expect(say('windy')).toEqual([
      'Yes.',
      "It'll be windy.",
      'Gusts up to 35mph from the south-west, wind up to 17mph. Windiest around 2pm.',
      "It's windy.",
      'Wind 15mph from the south-west, gusts 32mph right now. Easing off by about 9pm.',
      'A windy week.',
    ]);
    expect(say('gale')).toEqual([
      'Yes.',
      'Gales.',
      'Gusts up to 58mph from the west, wind up to 32mph. Windiest around 2pm. Windier than usual for October.',
      'Gales.',
      'Wind 29mph from the west, gusts 53mph right now. Set to last the next 12 hours.',
      'Gales today and on Sun.',
    ]);
    const breezy = previewResponse('breezy').wind!;
    expect([breezy.days[0]!.answer, breezy.week!.answer, breezy.week!.verdict]).toEqual([
      'A bit.',
      'A bit.',
      'A breezy week.',
    ]);
    const storm = previewResponse('storm').wind!;
    expect(storm.week!.verdict).toBe('A windy week, storm-force winds today.');
    expect(storm.days[0]!.zone).toEqual({ from: 70, to: null });
    // Not every forecast agrees.
    expect(previewResponse('verywindy').wind!.days[0]!.agreementText).toBe(
      '4 of 6 forecasts say very windy',
    );
  });

  it('shows where the wind blows from, and the calm sample a variable direction', () => {
    const windy = previewResponse('windy').wind!;
    const sw = { degrees: 227, compass: 'SW', words: 'from the south-west' };
    expect(windy.now!.direction).toEqual(sw);
    expect(
      windy.now!.series.find((p) => p.time === Date.parse(windy.now!.hours[0]!.time))!.dir,
    ).toBe(windy.now!.hours[0]!.direction!.degrees);
    // It veers through the day: the last row has turned from the south-west to the west.
    expect(windy.now!.hours.map((h) => h.direction!.compass)).toEqual([
      'SW',
      'SW',
      'SW',
      'SW',
      'SW',
      'W',
    ]);
    expect(windy.days[0]!.direction).toEqual({
      degrees: 235,
      compass: 'SW',
      words: 'from the south-west',
    });
    // Each model's own, a little either side.
    expect(windy.days[0]!.models.map((m) => m.direction!.degrees)).toEqual([
      233, 241, 227, 245, 223, 237,
    ]);
    // Light air all day: no direction to name today, but tomorrow's light winds have one.
    const calm = previewResponse('calm').wind!;
    expect(calm.now!.direction).toBeNull();
    expect(calm.now!.hours.every((h) => h.direction === null)).toBe(true);
    expect(calm.days[0]!.direction).toBeNull();
    expect(calm.days[1]!.detail).toBe('Light winds from the west, gusts up to 16mph.');
    // The week has none.
    expect(calm.week!.days[0]).not.toHaveProperty('direction');
  });

  it('pairs every hot, rain and snow band with wind that suits it', () => {
    for (const band of [...BANDS, ...RAIN_BANDS, ...SNOW_BANDS]) {
      expect(previewResponse(band).wind!.days[0]!.band).toMatch(
        /^(calm|breezy|windy|verywindy|gale)$/,
      );
    }
    expect(previewResponse('warm').wind!.days[0]!.band).toBe('calm');
    expect(previewResponse('drenched').wind!.days[0]!.band).toBe('gale');
    expect(previewResponse('heavysnow').wind!.days[0]!.band).toBe('verywindy');
  });

  it('follows the wind units, apart from the temperature units', () => {
    const kmh = previewResponse('windy', 'c', 'kmh').wind!;
    expect(kmh.unit).toBe('kmh');
    expect(kmh.days[0]!.detail).toBe(
      'Gusts up to 56km/h from the south-west, wind up to 27km/h. Windiest around 2pm.',
    );
    expect(kmh.days[0]!.scale).toEqual({ min: 0, max: 100 });
    const f = previewResponse('windy', 'f');
    expect([f.units, f.wind!.unit]).toEqual(['f', 'mph']);
  });
});
