/**
 * Sample days from the approved prototype, used only by the dev preview chips
 * (`?preview=1`) and visual tests. Never shown as real data.
 */
import { BANDS, MODELS, type Band } from './config';
import { COPY } from './copy';
import { formatDay, type DayComputation } from './compute';
import { mean } from './stats';
import type { TodayResponse } from './types';
import type { Units } from './units';

interface Sample {
  place: string;
  country: string;
  lat: number;
  lon: number;
  date: string;
  normal: number;
  feels: number;
  peakHour: number;
  temps: number[];
}

const SAMPLES: Record<Band, Sample> = {
  freezing: {
    place: 'Edinburgh',
    country: 'GB',
    lat: 55.95,
    lon: -3.2,
    date: '2027-01-15',
    normal: 6,
    feels: -6,
    peakHour: 13,
    temps: [-1, -2, -3, -2, -1, -5],
  },
  cold: {
    place: 'Newcastle',
    country: 'GB',
    lat: 54.95,
    lon: -1.6,
    date: '2026-10-15',
    normal: 13,
    feels: 6,
    peakHour: 14,
    temps: [9, 10, 8, 9, 9, 13],
  },
  mild: {
    place: 'London',
    country: 'GB',
    lat: 51.5,
    lon: -0.1,
    date: '2027-04-15',
    normal: 14,
    feels: 15,
    peakHour: 15,
    temps: [15, 16, 14, 15, 16, 15],
  },
  warm: {
    place: 'Manchester',
    country: 'GB',
    lat: 53.5,
    lon: -2.25,
    date: '2027-06-15',
    normal: 19,
    feels: 23,
    peakHour: 15,
    temps: [22, 23, 21, 22, 23, 19],
  },
  hot: {
    place: 'Bristol',
    country: 'GB',
    lat: 51.45,
    lon: -2.6,
    date: '2027-07-15',
    normal: 22,
    feels: 30,
    peakHour: 16,
    temps: [28, 29, 27, 28, 29, 28],
  },
  scorching: {
    place: 'Seville',
    country: 'ES',
    lat: 37.4,
    lon: -6,
    date: '2027-08-15',
    normal: 35,
    feels: 43,
    peakHour: 17,
    temps: [41, 42, 40, 41, 37, 41],
  },
};

export const PREVIEW_BANDS: readonly Band[] = BANDS;
export { BAND_LABELS } from './copy';

export function previewResponse(band: Band, units: Units = 'c'): TodayResponse {
  const s = SAMPLES[band];
  const day: DayComputation = {
    date: s.date,
    blend: {
      // The prototype used a plain mean; keep it so previews match the approved design.
      high: mean(s.temps),
      feelsLike: s.feels,
      peakHour: s.peakHour,
      confidence: 'good',
      models: MODELS.slice(0, s.temps.length).map((m, i) => ({
        id: m.id,
        name: m.name,
        high: s.temps[i] as number,
      })),
    },
    verdict: { band, effective: s.feels, climateAdjusted: true },
    normalHigh: s.normal,
  };
  return {
    location: {
      name: s.place,
      region: null,
      country: s.country,
      lat: s.lat,
      lon: s.lon,
      timezone: s.country === 'ES' ? 'Europe/Madrid' : 'Europe/London',
      source: 'city',
    },
    units,
    days: [formatDay(day, units)],
    updatedAt: `${s.date}T08:00:00Z`,
    attribution: [COPY.forecastCredit, COPY.climateCredit],
  };
}
