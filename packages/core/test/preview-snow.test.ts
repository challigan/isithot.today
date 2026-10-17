import { describe, expect, it } from 'vitest';
import { SNOW_BANDS, paletteFor, type AnyBand, type Band, type SnowBand } from '../src/config';
import { PREVIEW_SNOW_BANDS, SNOW_BAND_LABELS, previewResponse } from '../src/preview';

describe('previewResponse for snow', () => {
  it('lists the snow bands with labels and palettes', () => {
    expect(PREVIEW_SNOW_BANDS).toEqual(SNOW_BANDS);
    for (const band of PREVIEW_SNOW_BANDS) {
      expect(SNOW_BAND_LABELS[band]).toBeTruthy();
      expect(paletteFor(band).ink).toMatch(/^#/);
    }
  });

  it('shows every snow band in all three views, with hot and rain samples that suit it', () => {
    const hot: Record<SnowBand, Band> = {
      nosnow: 'warm',
      flakes: 'freezing',
      maybesnow: 'freezing',
      snow: 'freezing',
      heavysnow: 'freezing',
      deepsnow: 'freezing',
    };
    for (const band of PREVIEW_SNOW_BANDS) {
      const r = previewResponse(band);
      const snow = r.snow!;
      expect(snow.unit).toBe('cm');
      expect(snow.days.map((d) => d.partial)).toEqual([true, false]);
      expect(snow.days[0]!.band).toBe(band);
      expect(snow.now!.band).toBe(band);
      expect(snow.now!.hours).toHaveLength(6);
      expect(snow.week!.band).toBe(band);
      expect(snow.week!.days).toHaveLength(7);
      expect(r.days[0]!.band).toBe(hot[band]);
      // The same weather for Wet, judged on the same days.
      expect(r.rain!.days[0]!.from).toBe(snow.days[0]!.from);
    }
  });

  it('reads like a real forecast', () => {
    const say = (band: AnyBand) => {
      const snow = previewResponse(band).snow!;
      const d = snow.days[0]!;
      return [d.answer, d.verdict, d.detail, snow.now!.verdict, snow.week!.verdict];
    };
    expect(say('nosnow')).toEqual([
      'No.',
      'Too warm for snow.',
      'No lower than 14° for the rest of the day. Snow is rare here in June.',
      'Too warm for snow.',
      'Too warm for snow all week.',
    ]);
    expect(say('maybesnow')).toEqual([
      'Maybe.',
      'It might snow.',
      'Some forecasts say up to 1cm. Mostly between 10am and 2pm.',
      'Snow showers around.',
      'Snow possible today and on Sun.',
    ]);
    expect(say('deepsnow')).toEqual([
      'Yes.',
      'Deep snow.',
      '20 to 30cm still to come. Easing off by about 6pm.',
      'Very heavy snow.',
      'A snowy week, heaviest on Sun.',
    ]);
    // Wet says snow on the same snowy day.
    const wet = previewResponse('snow').rain!;
    expect([wet.days[0]!.verdict, wet.now!.verdict]).toEqual(["It'll snow.", "It's snowing."]);
  });

  it('pairs every hot and rain band with snow that suits it', () => {
    expect(previewResponse('freezing').snow!.days[0]!.band).toBe('snow');
    for (const band of ['mild', 'warm', 'hot', 'scorching', 'dry', 'spots'] as const) {
      expect(previewResponse(band).snow!.days[0]!.band).toBe('nosnow');
    }
    const rain = previewResponse('rain').snow!.days[0]!;
    expect([rain.answer, rain.verdict]).toEqual(['No.', 'Rain, not snow.']);
  });

  it('follows the units', () => {
    const snow = previewResponse('heavysnow', 'f').snow!;
    expect(snow.unit).toBe('in');
    expect(snow.days[0]!.detail).toBe('2.5 to 4in still to come. Easing off by about 5pm.');
    expect(snow.days[0]!.scale).toEqual({ min: 0, max: 5 });
  });
});
