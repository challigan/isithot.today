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
  RAIN_ANSWERS,
  RAIN_BAND_LABELS,
  RAIN_NOW_PHRASES,
  RAIN_NOW_VERDICTS,
  RAIN_VERDICTS,
  aroundLine,
  betweenLine,
  easingLine,
  endHour,
  mostlyDryLine,
  rainAgreementLine,
  rainAmountLine,
  rainDaysLine,
  rainFromLine,
  rainNormalLine,
  rainStripSummary,
  rainWeekLine,
  showersFromLine,
  upToLine,
  wetWeekLine,
  whenDays,
} from '../src/copy';
import { BANDS, RAIN_BANDS } from '../src/config';

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

describe('rain copy', () => {
  it('has an answer, verdicts and a label for every rain band', () => {
    for (const band of RAIN_BANDS) {
      expect(RAIN_ANSWERS[band]).toMatch(/^(No|Maybe|Yes)\.$/);
      expect(RAIN_VERDICTS[band]).toMatch(/\.$/);
      expect(RAIN_NOW_VERDICTS[band]).toMatch(/\.$/);
      expect(RAIN_NOW_PHRASES[band]).toMatch(/now\.$/);
      expect(RAIN_BAND_LABELS[band]).toBeTruthy();
    }
    expect([RAIN_ANSWERS.dry, RAIN_VERDICTS.dry]).toEqual(['No.', "It'll be dry."]);
    expect([RAIN_ANSWERS.drenched, RAIN_VERDICTS.drenched]).toEqual([
      'Yes.',
      "You'll get drenched.",
    ]);
    expect(RAIN_BAND_LABELS.drenched).toBe('Washout');
  });

  it('reads 0 and 24 as midnight at the end of a span', () => {
    expect(endHour(24)).toBe('midnight');
    expect(endHour(0)).toBe('midnight');
    expect(endHour(15)).toBe('3pm');
    expect(easingLine(24)).toBe('Easing off by about midnight.');
    expect(betweenLine(18, 24)).toBe('Mostly between 6pm and midnight.');
    expect(aroundLine(0)).toBe('Most likely around 12am.');
    expect(rainFromLine(18)).toBe('Rain likely from about 6pm.');
    expect(showersFromLine(9)).toBe('Showers possible from about 9am.');
  });

  it('names days', () => {
    expect(whenDays(true, null)).toBe('today');
    expect(whenDays(false, 'Thu and Fri')).toBe('on Thu and Fri');
    expect(whenDays(true, 'Sat')).toBe('today and on Sat');
    expect(mostlyDryLine('on Thu')).toBe('Mostly dry, but rain possible on Thu.');
    expect(wetWeekLine(null)).toBe('A wet week.');
    expect(wetWeekLine('today')).toBe('A wet week, heaviest today.');
    expect(rainDaysLine('on Thu and Fri', null, false)).toBe('Rain on Thu and Fri.');
    expect(rainDaysLine('on Thu and Fri', 'on Fri', false)).toBe(
      'Rain on Thu and Fri, heavy on Fri.',
    );
    expect(rainDaysLine('on Fri', 'on Fri', true)).toBe('Heavy rain on Fri.');
  });

  it('describes amounts and agreement', () => {
    expect(upToLine('4mm', false)).toBe('Some forecasts say up to 4mm.');
    expect(upToLine('4mm', true)).toBe('One forecast says up to 4mm.');
    expect(rainAmountLine('6mm', true)).toBe('About 6mm still to come.');
    expect(rainAmountLine('0.2in', false)).toBe('About 0.2in of rain.');
    expect(rainAgreementLine(6, 8)).toBe('6 of 8 forecasts expect rain');
    expect(rainAgreementLine(1, 8)).toBe('1 of 8 forecasts expects rain');
    expect(rainStripSummary({ min: '0mm', max: '12mm', wet: 6, total: 8 })).toBe(
      'Forecasts range from 0mm to 12mm; 6 of 8 expect rain.',
    );
    expect(rainStripSummary({ min: '0mm', max: '0mm', wet: 0, total: 8 })).toBe(
      'All forecasts say 0mm; none expect rain.',
    );
    expect(rainStripSummary({ min: '0mm', max: '2mm', wet: 1, total: 8 })).toBe(
      'Forecasts range from 0mm to 2mm; 1 of 8 expects rain.',
    );
    expect(rainWeekLine('18mm', { when: 'on Friday', amount: '12mm' })).toBe(
      'About 18mm across the week, most on Friday (12mm).',
    );
    expect(rainWeekLine('3mm', null)).toBe('About 3mm across the week.');
  });

  it('compares with normal rain', () => {
    expect(rainNormalLine('dry', 'July')).toBe('Dry, as usual for July.');
    expect(rainNormalLine('wetter', 'October')).toBe('Wetter than usual for October.');
    expect(rainNormalLine('drier', 'October')).toBe('Drier than usual for October.');
    expect(rainNormalLine('normal', 'the time of year')).toBe('About normal for the time of year.');
  });
});
