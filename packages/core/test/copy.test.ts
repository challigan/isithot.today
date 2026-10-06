import { describe, expect, it } from 'vitest';
import {
  ANSWERS,
  VERDICTS,
  BAND_LABELS,
  agreementLine,
  anomalyLine,
  deg,
  detailLine,
  formatHour,
  monthName,
  pageTitle,
  question,
  stripSummary,
} from '../src/copy';
import { BANDS } from '../src/config';

describe('copy', () => {
  it('has an answer, verdict and label for every band', () => {
    for (const band of BANDS) {
      expect(ANSWERS[band]).toMatch(/\.$/);
      expect(VERDICTS[band]).toMatch(/^It's /);
      expect(BAND_LABELS[band]).toBeTruthy();
    }
    expect(ANSWERS.warm).toBe('Almost.');
    expect(VERDICTS.warm).toBe("It's warm, not hot.");
  });

  it('asks the question with and without a city', () => {
    expect(question()).toBe('Is it hot today?');
    expect(question(null)).toBe('Is it hot today?');
    expect(question('Newcastle')).toBe('Is it hot in Newcastle today?');
  });

  it('formats hours as 12-hour clock', () => {
    expect(formatHour(0)).toBe('12am');
    expect(formatHour(9)).toBe('9am');
    expect(formatHour(12)).toBe('12pm');
    expect(formatHour(14)).toBe('2pm');
    expect(formatHour(23)).toBe('11pm');
    expect(formatHour(-1)).toBe('11pm');
    expect(formatHour(24)).toBe('12am');
  });

  it('names months', () => {
    expect(monthName('2026-10-06')).toBe('October');
    expect(monthName('2026-01-31')).toBe('January');
    expect(monthName('2026-13-01')).toBe('');
  });

  it('describes the anomaly', () => {
    expect(anomalyLine(1, true, 'October')).toBe('About normal for October.');
    expect(anomalyLine(-4, false, 'October')).toBe('4° colder than usual for October.');
    expect(anomalyLine(6, false, 'July')).toBe('6° warmer than usual for July.');
  });

  it('builds the detail line, skipping missing parts', () => {
    expect(
      detailLine({
        high: 9,
        feelsLike: 6,
        peakTime: '2pm',
        anomalyText: '4° colder than usual for October.',
      }),
    ).toBe('High of 9°, feels like 6°. Warmest around 2pm. 4° colder than usual for October.');
    expect(detailLine({ high: 9, feelsLike: 6, peakTime: null, anomalyText: null })).toBe(
      'High of 9°, feels like 6°.',
    );
  });

  it('builds the agreement heading and strip summary', () => {
    expect(agreementLine(5, 6, 2)).toBe('5 of 6 forecasts agree within 2°');
    expect(stripSummary({ min: 8, max: 13, agree: 5, total: 6, consensus: 9 })).toBe(
      'Forecasts range from 8° to 13°; 5 of 6 agree near 9°.',
    );
    expect(stripSummary({ min: 8, max: 8, agree: 3, total: 3, consensus: 8 })).toBe(
      'All forecasts say 8°; 3 of 3 agree near 8°.',
    );
  });

  it('builds page titles', () => {
    expect(pageTitle({ city: 'Newcastle', answer: 'No.', high: 9 })).toBe(
      'Is it hot in Newcastle today? No. 9° | isithot.today',
    );
    expect(pageTitle({ answer: 'Yes.', high: 30 })).toBe(
      'Is it hot today? Yes. 30° | isithot.today',
    );
    expect(deg(5)).toBe('5°');
  });
});
