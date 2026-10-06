import { describe, expect, it } from 'vitest';
import { agreementTolerance, computeDay, formatDay, type DayData } from '../src/compute';
import { previewResponse, PREVIEW_BANDS } from '../src/preview';

const NORMALS = [7, 7.5, 9.5, 12, 15, 18, 19, 19, 17, 13.5, 10, 7.5];

const day = (highs: Array<number | null>, feels?: Array<number | null>): DayData => ({
  date: '2026-10-15',
  models: highs.map((high, i) => ({
    id: `m${i}`,
    name: `M${i}`,
    high,
    feelsLike: feels ? (feels[i] ?? null) : high === null ? null : high - 3,
  })),
  hourly: [
    { hour: 13, temps: [8, 9] },
    { hour: 14, temps: [9, 10] },
  ],
});

describe('computeDay', () => {
  it('returns null without data', () => {
    expect(computeDay(day([null, null]), NORMALS)).toBeNull();
  });

  it('computes in °C with normals', () => {
    const c = computeDay(day([9, 10, 8, 9, 9, 13]), NORMALS)!;
    expect(c.blend.high).toBeCloseTo(9.25, 10);
    expect(c.blend.feelsLike).toBeCloseTo(6.25, 10);
    expect(c.blend.peakHour).toBe(14);
    expect(c.normalHigh).toBe(13.5);
    expect(c.verdict.band).toBe('cold');
    expect(c.verdict.climateAdjusted).toBe(true);
  });

  it('works without normals', () => {
    const c = computeDay(day([9, 10, 8]), null)!;
    expect(c.normalHigh).toBeNull();
    expect(c.verdict.climateAdjusted).toBe(false);
  });
});

describe('formatDay', () => {
  it('formats the contract in °C', () => {
    const d = formatDay(computeDay(day([9, 10, 8, 9, 9, 13]), NORMALS)!, 'c');
    expect(d).toMatchObject({
      date: '2026-10-15',
      band: 'cold',
      answer: 'No.',
      verdict: "It's cold.",
      high: 9,
      feelsLike: 6,
      peakTime: '2pm',
      normalHigh: 14,
      anomaly: -4,
      month: 'October',
      detail: 'High of 9°, feels like 6°. Warmest around 2pm. 4° colder than usual for October.',
      agreementText: '5 of 6 forecasts agree within 2°',
      limitedText: null,
      stripSummary: 'Forecasts range from 8° to 13°; 5 of 6 agree near 9°.',
      scale: { min: 5, max: 16 },
      consensus: {
        value: 9.3,
        agree: 5,
        total: 6,
        bandLow: 7.3,
        bandHigh: 11.3,
        confidence: 'good',
      },
    });
    expect(d.models[5]).toEqual({ id: 'm5', name: 'M5', high: 13, value: 13, agrees: false });
  });

  it('converts to °F at the edge and widens the tolerance to 4°', () => {
    const d = formatDay(computeDay(day([9, 10, 8, 9, 9, 13]), NORMALS)!, 'f');
    expect(d.high).toBe(49);
    expect(d.feelsLike).toBe(43);
    expect(d.normalHigh).toBe(56);
    expect(d.anomaly).toBe(-8);
    expect(d.detail).toContain('8° colder than usual for October.');
    expect(d.consensus.bandLow).toBeCloseTo(44.7, 10);
    expect(d.agreementText).toBe('5 of 6 forecasts agree within 4°');
    expect(agreementTolerance('f')).toBe(4);
    expect(agreementTolerance('c')).toBe(2);
  });

  it('says about normal within ±1°', () => {
    const d = formatDay(computeDay(day([13, 14, 14]), NORMALS)!, 'c');
    expect(d.detail).toContain('About normal for October.');
  });

  it('hides the anomaly without normals and flags limited data', () => {
    const d = formatDay(computeDay(day([9, null, 11]), null)!, 'c');
    expect(d.normalHigh).toBeNull();
    expect(d.anomaly).toBeNull();
    expect(d.detail).toBe('High of 10°, feels like 7°. Warmest around 2pm.');
    expect(d.consensus.confidence).toBe('limited');
    expect(d.limitedText).toBe('Limited forecast data');
  });

  it('omits the peak time without hourly data', () => {
    const data = { ...day([9, 10, 11]), hourly: [] };
    expect(formatDay(computeDay(data, null)!, 'c').peakTime).toBeNull();
  });
});

describe('previewResponse', () => {
  it('reproduces the prototype for every band', () => {
    const expected = {
      freezing: [
        'No.',
        "It's freezing.",
        'High of -2°, feels like -6°. Warmest around 1pm. 8° colder than usual for January.',
      ],
      cold: [
        'No.',
        "It's cold.",
        'High of 10°, feels like 6°. Warmest around 2pm. 3° colder than usual for October.',
      ],
      mild: [
        'No.',
        "It's mild.",
        'High of 15°, feels like 15°. Warmest around 3pm. About normal for April.',
      ],
      warm: [
        'Almost.',
        "It's warm, not hot.",
        'High of 22°, feels like 23°. Warmest around 3pm. 3° warmer than usual for June.',
      ],
      hot: [
        'Yes.',
        "It's hot.",
        'High of 28°, feels like 30°. Warmest around 4pm. 6° warmer than usual for July.',
      ],
      scorching: [
        'Yes.',
        "It's scorching.",
        'High of 40°, feels like 43°. Warmest around 5pm. 5° warmer than usual for August.',
      ],
    } as const;
    for (const band of PREVIEW_BANDS) {
      const r = previewResponse(band);
      const d = r.days[0]!;
      expect([d.answer, d.verdict, d.detail]).toEqual(expected[band]);
      expect(d.models).toHaveLength(6);
    }
    expect(previewResponse('cold').days[0]!.agreementText).toBe('5 of 6 forecasts agree within 2°');
    expect(previewResponse('scorching').location.timezone).toBe('Europe/Madrid');
    expect(previewResponse('hot', 'f').units).toBe('f');
  });
});
