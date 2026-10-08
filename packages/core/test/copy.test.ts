import { describe, expect, it } from 'vitest';
import {
  ANSWERS,
  TOMORROW_LABEL,
  TOMORROW_VERDICTS,
  VERDICTS,
  VIEWS,
  VIEW_LABELS,
  dryFromLine,
  viewLabel,
  BAND_LABELS,
  agreementLine,
  anomalyLine,
  deg,
  detailLine,
  formatHour,
  monthName,
  pageTitle,
  wetPageTitle,
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
import { BANDS, RAIN_BANDS, type RainBand } from '../src/config';

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

  it('words verdicts for tomorrow in the future tense', () => {
    for (const band of BANDS) {
      expect(TOMORROW_VERDICTS[band]).toBe(VERDICTS[band].replace("It's", "It'll be"));
    }
    expect(TOMORROW_VERDICTS.warm).toBe("It'll be warm, not hot.");
  });

  it('labels the middle view Tomorrow while it shows tomorrow', () => {
    expect(VIEWS.map((v) => viewLabel(v))).toEqual(['Now', 'Today', 'This week']);
    expect(VIEWS.map((v) => viewLabel(v, true))).toEqual(['Now', TOMORROW_LABEL, 'This week']);
    expect(TOMORROW_LABEL).toBe('Tomorrow');
    expect(viewLabel('week', false)).toBe(VIEW_LABELS.week);
  });

  it('asks the question with and without a city', () => {
    expect(question()).toBe('Is it hot today?');
    expect(question(null)).toBe('Is it hot today?');
    expect(question('Newcastle')).toBe('Is it hot in Newcastle today?');
  });

  it('asks about tomorrow for the middle view only', () => {
    expect(question(null, 'today', 'hot', true)).toBe('Will it be hot tomorrow?');
    expect(question('Leeds', 'today', 'hot', true)).toBe('Will it be hot in Leeds tomorrow?');
    expect(question(null, 'today', 'wet', true)).toBe('Will it be wet tomorrow?');
    expect(question('Leeds', 'today', 'wet', true)).toBe('Will it be wet in Leeds tomorrow?');
    expect(question('Leeds', 'now', 'wet', true)).toBe('Is it wet in Leeds right now?');
    expect(question(null, 'week', 'hot', true)).toBe('Is it hot this week?');
    expect(question('Leeds', 'today', 'wet', false)).toBe('Is it wet in Leeds today?');
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
    expect(wetPageTitle({ city: 'Leeds', answer: 'Yes.', band: 'heavy', snow: 'none' })).toBe(
      'Is it wet in Leeds today? Yes. Heavy rain | isitwet.today',
    );
    expect(wetPageTitle({ answer: 'No.', band: 'dry', snow: 'none' })).toBe(
      'Is it wet today? No. Dry | isitwet.today',
    );
  });

  it('titles a day that mostly falls as snow as snow, as its verdict does', () => {
    const title = (band: RainBand, snow: 'none' | 'some' | 'most') =>
      wetPageTitle({ city: 'Leeds', answer: RAIN_ANSWERS[band], band, snow });
    expect(title('rain', 'most')).toBe('Is it wet in Leeds today? Yes. Snow | isitwet.today');
    expect(title('heavy', 'most')).toBe('Is it wet in Leeds today? Yes. Heavy snow | isitwet.today');
    expect(title('drenched', 'most')).toBe(
      'Is it wet in Leeds today? Yes. Heavy snow | isitwet.today',
    );
    // Some snow, or showers and drier, keep the rain labels.
    expect(title('rain', 'some')).toBe('Is it wet in Leeds today? Yes. Rain | isitwet.today');
    expect(title('showers', 'most')).toBe(
      'Is it wet in Leeds today? Maybe. Showers | isitwet.today',
    );
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
    expect(dryFromLine(13)).toBe('Dry from about 1pm.');
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
