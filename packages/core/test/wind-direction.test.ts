import { describe, expect, it } from 'vitest';
import { COMPASS_POINTS, WIND } from '../src/config';
import type { HourTemps } from '../src/blend';
import {
  compassPoint,
  directionField,
  directionWords,
  wholeDegrees,
  windDirection,
} from '../src/wind';
import { directionOver, hourWinds, meanDirection } from '../src/windDirection';

/** Winds of one speed from each direction. */
const from = (speed: number, ...directions: number[]) =>
  directions.map((d) => ({ speed, from: d }));

/** An hour with each model's wind speed and direction. */
const hour = (wind: (number | null)[], dir?: (number | null)[]): HourTemps => ({
  hour: 12,
  time: 0,
  temps: wind.map(() => 10),
  wind,
  ...(dir ? { dir } : {}),
});

describe('meanDirection', () => {
  it('averages directions as vectors, never as numbers', () => {
    // 350° and 10° are both nearly north: their mean is north, not south.
    expect(meanDirection(from(20, 350, 10))).toBe(0);
    expect(meanDirection(from(20, 340, 10))).toBe(355);
    expect(meanDirection(from(20, 200, 250))).toBe(225);
    // Six models close together.
    expect(meanDirection(from(30, 220, 228, 215, 233, 224, 230))).toBe(225);
  });

  it('counts a strong wind for more than a light one', () => {
    // East at 30 and south at 10: much nearer east than the plain mean of the angles (135°).
    expect(meanDirection([...from(30, 90), ...from(10, 180)])).toBe(108);
    // A calm model's direction barely counts.
    expect(meanDirection([...from(25, 270, 270), ...from(0.5, 90)])).toBe(270);
  });

  it('is variable when the winds point too many ways', () => {
    // Opposite directions cancel out.
    expect(meanDirection(from(20, 90, 270))).toBeNull();
    expect(meanDirection(from(20, 0, 120, 240))).toBeNull();
    // The resultant against the sum of the speeds decides: two winds 100° apart agree to
    // cos(50°) = 0.64, 110° apart to cos(55°) = 0.57.
    expect(WIND.direction.agreement).toBe(0.6);
    expect(meanDirection(from(20, 0, 100))).toBe(50);
    expect(meanDirection(from(20, 0, 110))).toBeNull();
  });

  it('is variable in light air, by the median speed', () => {
    expect(WIND.direction.fromMean).toBe(8);
    expect(meanDirection(from(8, 180, 190))).toBe(185);
    expect(meanDirection(from(7.9, 180, 190))).toBeNull();
    // Two strong models of six do not lend still air their direction, though the six average
    // 12 km/h: the median decides, as it does the wind shown.
    expect(meanDirection([...from(3, 270, 270, 270, 270), ...from(30, 270, 270)])).toBeNull();
    expect(meanDirection([...from(4, 180, 180), ...from(16, 180)])).toBeNull();
    // The median at the line, or a light model or two under it, still names it.
    expect(meanDirection([...from(3, 270, 270), ...from(8, 270, 270), ...from(30, 270)])).toBe(270);
    expect(meanDirection([...from(7, 180, 180), ...from(9, 180, 180)])).toBe(180);
    expect(meanDirection([...from(3, 180), ...from(12, 180, 180)])).toBe(180);
    expect(meanDirection(from(0, 180))).toBeNull();
    expect(meanDirection([])).toBeNull();
  });
});

describe('degrees and compass points', () => {
  it('keeps whole degrees from 0 to 359', () => {
    expect([359.6, -0.4, 360, -90, 725, 22.5].map(wholeDegrees)).toEqual([0, 0, 0, 270, 5, 23]);
  });

  it('names the nearest of eight points, from whole degrees', () => {
    expect(COMPASS_POINTS).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
    const name = (d: number) => compassPoint(d);
    expect([0, 22, 22.4, 22.5, 23, 45, 67, 67.5, 90].map(name)).toEqual([
      'N',
      'N',
      'N',
      'NE',
      'NE',
      'NE',
      'NE',
      'E',
      'E',
    ]);
    expect([112, 113, 157, 158, 202, 203, 225, 247, 248].map(name)).toEqual([
      'E',
      'SE',
      'SE',
      'S',
      'S',
      'SW',
      'SW',
      'SW',
      'W',
    ]);
    expect([292, 293, 337, 337.5, 338, 359, 360, -10].map(name)).toEqual([
      'W',
      'NW',
      'NW',
      'N',
      'N',
      'N',
      'N',
      'N',
    ]);
  });

  it('gives the API its degrees, point and words', () => {
    expect(windDirection(225)).toEqual({
      degrees: 225,
      compass: 'SW',
      words: 'from the south-west',
    });
    expect(windDirection(359.7)).toEqual({ degrees: 0, compass: 'N', words: 'from the north' });
    expect(COMPASS_POINTS.map((_, i) => windDirection(i * 45).words)).toEqual([
      'from the north',
      'from the north-east',
      'from the east',
      'from the south-east',
      'from the south',
      'from the south-west',
      'from the west',
      'from the north-west',
    ]);
  });

  it('adds the field only when there is a direction to judge', () => {
    expect(directionField(undefined)).toEqual({});
    expect(directionField(null)).toEqual({ direction: null });
    expect(directionField(90)).toEqual({
      direction: { degrees: 90, compass: 'E', words: 'from the east' },
    });
    expect(directionWords(270)).toBe('from the west');
    expect(directionWords(null)).toBeNull();
    expect(directionWords(undefined)).toBeNull();
  });
});

describe('directions over hours', () => {
  it('takes the models with a speed and a direction, or one model', () => {
    const h = hour([20, null, 30, 10], [200, 210, null, 220]);
    expect(hourWinds(h)).toEqual([
      { speed: 20, from: 200 },
      { speed: 10, from: 220 },
    ]);
    expect(hourWinds(h, 3)).toEqual([{ speed: 10, from: 220 }]);
    expect(hourWinds(h, 1)).toEqual([]);
    // Recorded without directions.
    expect(hourWinds(hour([20, 30]))).toEqual([]);
  });

  it('judges every model over every hour together, or none without directions', () => {
    const hours = [hour([20, 20], [80, 100]), hour([20, 20], [90, 90])];
    expect(directionOver(hours)).toBe(90);
    expect(directionOver(hours, 0)).toBe(85);
    // A front passing: west, then east.
    expect(directionOver([hour([20], [270]), hour([20], [90])])).toBeNull();
    expect(directionOver([hour([20, 20])])).toBeUndefined();
    expect(directionOver([])).toBeUndefined();
  });
});
