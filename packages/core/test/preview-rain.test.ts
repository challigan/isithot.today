import { describe, expect, it } from 'vitest';
import { RAIN_BANDS, paletteFor, type Band, type RainBand } from '../src/config';
import {
  PREVIEW_BANDS,
  PREVIEW_RAIN_BANDS,
  RAIN_BAND_LABELS,
  previewResponse,
} from '../src/preview';

describe('previewResponse for rain', () => {
  it('lists the rain bands with labels and palettes', () => {
    expect(PREVIEW_RAIN_BANDS).toEqual(RAIN_BANDS);
    for (const band of PREVIEW_RAIN_BANDS) {
      expect(RAIN_BAND_LABELS[band]).toBeTruthy();
      expect(paletteFor(band).ink).toMatch(/^#/);
    }
    expect(paletteFor('hot').g1).toBe('#cc3d17');
  });

  it('shows every rain band in all three views, with a hot sample that suits it', () => {
    const hot: Record<RainBand, Band> = {
      dry: 'warm',
      spots: 'mild',
      showers: 'mild',
      rain: 'cold',
      heavy: 'cold',
      drenched: 'cold',
    };
    for (const band of PREVIEW_RAIN_BANDS) {
      const r = previewResponse(band);
      const rain = r.rain!;
      expect(rain.unit).toBe('mm');
      expect(rain.days.map((d) => d.partial)).toEqual([true, false]);
      expect(rain.days[0]!.band).toBe(band);
      expect(rain.now!.band).toBe(band);
      expect(rain.now!.hours).toHaveLength(6);
      expect(rain.week!.band).toBe(band);
      expect(rain.week!.days).toHaveLength(7);
      expect(r.days[0]!.band).toBe(hot[band]);
    }
  });

  it('reads like a real forecast', () => {
    const say = (band: Band | RainBand) => {
      const rain = previewResponse(band).rain!;
      const d = rain.days[0]!;
      return [d.answer, d.verdict, d.detail, rain.now!.verdict, rain.week!.verdict];
    };
    expect(say('dry')).toEqual([
      'No.',
      "It'll be dry.",
      'Dry for the rest of the day.',
      "It's dry.",
      'A dry week.',
    ]);
    expect(say('showers')).toEqual([
      'Maybe.',
      'Showers possible.',
      'Some forecasts say up to 3mm. Mostly between 1pm and 5pm.',
      'Showers around.',
      'Mostly dry, but rain possible today and on Sat.',
    ]);
    expect(say('drenched')).toEqual([
      'Yes.',
      "You'll get drenched.",
      'About 34mm still to come. Easing off by about 6pm.',
      "It's torrential.",
      'A wet week, heaviest on Sat.',
    ]);
    // Freezing comes with snow.
    expect(say('freezing')).toEqual([
      'Yes.',
      "It'll snow.",
      'Likely to fall as snow. Easing off by about 4pm.',
      "It's snowing.",
      'Rain today and on Mon.',
    ]);
    expect(previewResponse('freezing').rain!.week!.days[0]!.bandLabel).toBe('Snow');
  });

  it('pairs each hot band with a rain sample', () => {
    const rain: Record<Band, RainBand> = {
      freezing: 'rain',
      cold: 'rain',
      mild: 'showers',
      warm: 'dry',
      hot: 'dry',
      scorching: 'dry',
    };
    for (const band of PREVIEW_BANDS) {
      const r = previewResponse(band);
      expect(r.days[0]!.band).toBe(band);
      expect(r.rain!.days[0]!.band).toBe(rain[band]);
    }
    // Seville in August is dry as usual.
    expect(previewResponse('scorching').rain!.week!.detail).toBe(
      'Barely any rain all week. Dry, as usual for August.',
    );
  });

  it('follows the units', () => {
    const rain = previewResponse('heavy', 'f').rain!;
    expect(rain.unit).toBe('in');
    expect(rain.days[0]!.detail).toBe('About 0.62in still to come. Easing off by about 8pm.');
    expect(rain.days[0]!.scale).toEqual({ min: 0, max: 1 });
  });
});
