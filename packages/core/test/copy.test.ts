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
  COPY,
  DEFAULT_DESCRIPTIONS,
  DEFAULT_TITLES,
  HERE_QUESTIONS,
  SNOW_ANSWERS,
  SNOW_BAND_LABELS,
  SNOW_DAY_VERDICTS,
  SNOW_NOW_VERDICTS,
  TOPIC_LABELS,
  UNITS_LABELS,
  UNIT_NAMES,
  clearingLine,
  coldestLine,
  flakesDaysLine,
  likelyFromLine,
  noLowerLine,
  possibleDaysLine,
  snowAgreementLine,
  snowAmountLine,
  snowDaysLine,
  snowFromLine,
  snowLabel,
  snowNormalLine,
  snowPageTitle,
  snowPossibleFromLine,
  snowRateLine,
  snowStripSummary,
  snowUpToLine,
  snowyWeekLine,
  cityDescription,
  cityTitle,
  clockTime,
  intro,
  placesIntro,
  updatedTime,
} from '../src/copy';
import {
  BANDS,
  MODELS,
  RAIN_BANDS,
  SITES,
  SNOW_BANDS,
  TITLE_MAX_LENGTH,
  TOPICS,
  type RainBand,
} from '../src/config';

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
    expect(title('heavy', 'most')).toBe(
      'Is it wet in Leeds today? Yes. Heavy snow | isitwet.today',
    );
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

describe('snow copy', () => {
  it('asks the snow questions, with "snowing" for now', () => {
    expect(question(null, 'today', 'snow')).toBe('Will it snow today?');
    expect(question('Oslo', 'today', 'snow')).toBe('Will it snow in Oslo today?');
    expect(question(null, 'today', 'snow', true)).toBe('Will it snow tomorrow?');
    expect(question('Oslo', 'today', 'snow', true)).toBe('Will it snow in Oslo tomorrow?');
    expect(question(null, 'now', 'snow')).toBe('Is it snowing right now?');
    expect(question('Oslo', 'now', 'snow', true)).toBe('Is it snowing in Oslo right now?');
    expect(question('Oslo', 'week', 'snow')).toBe('Will it snow in Oslo this week?');
    // A place name is used as it is.
    expect(question('$& $1', 'today', 'snow')).toBe('Will it snow in $& $1 today?');
    expect(HERE_QUESTIONS).toEqual({
      hot: 'Is it hot here?',
      wet: 'Is it wet here?',
      snow: 'Will it snow here?',
    });
  });

  it('has an answer, verdicts and labels for every snow band', () => {
    for (const band of SNOW_BANDS) {
      expect(SNOW_ANSWERS[band]).toMatch(/^(No|Maybe|Yes)\.$/);
      expect(SNOW_DAY_VERDICTS[band]).toMatch(/\.$/);
      expect(SNOW_NOW_VERDICTS[band]).toMatch(/\.$/);
      expect(SNOW_BAND_LABELS[band]).toBeTruthy();
    }
    expect(TOPIC_LABELS.snow).toBe('Snow');
    expect(SNOW_BAND_LABELS.nosnow).toBe('No snow');
    expect(snowLabel('heavysnow', null)).toBe('Heavy snow');
    expect(snowLabel('nosnow', 'warm')).toBe('Too warm');
    expect(snowLabel('nosnow', 'rain')).toBe('Rain');
    expect(snowLabel('nosnow', 'dry')).toBe('Dry');
  });

  it('labels the units for each topic', () => {
    expect(UNITS_LABELS).toEqual({
      hot: 'Temperature units',
      wet: 'Rain units',
      snow: 'Snow units',
    });
    expect(UNIT_NAMES.snow).toEqual({ c: 'cm', f: 'in' });
    expect(UNIT_NAMES.wet).toEqual({ c: 'mm', f: 'in' });
    expect(UNIT_NAMES.hot).toEqual({ c: '°C', f: '°F' });
    expect(COPY.nextHoursSnow).toBe('Chance of snow, next 12 hours');
    expect(DEFAULT_TITLES.snow).toBe('Will it snow today? | willitsnow.today');
    expect(DEFAULT_DESCRIPTIONS.snow).toMatch(/^Will it snow today where you are\?/);
  });

  it('titles snow city pages, with why for a day without snow', () => {
    expect(snowPageTitle({ city: 'Oslo', answer: 'Yes.', band: 'heavysnow', reason: null })).toBe(
      'Will it snow in Oslo today? Yes. Heavy snow | willitsnow.today',
    );
    expect(snowPageTitle({ city: 'London', answer: 'No.', band: 'nosnow', reason: 'warm' })).toBe(
      'Will it snow in London today? No. Too warm | willitsnow.today',
    );
    expect(snowPageTitle({ answer: 'Maybe.', band: 'maybesnow', reason: null })).toBe(
      'Will it snow today? Maybe. Snow possible | willitsnow.today',
    );
  });

  it('words amounts, ranges and dustings', () => {
    expect(snowAmountLine({ low: 2, high: 5 }, 'cm', true)).toBe('2 to 5cm still to come.');
    expect(snowAmountLine({ low: 3, high: 3 }, 'cm', false)).toBe('About 3cm of snow.');
    expect(snowAmountLine({ low: 1, high: 1.5 }, 'in', false)).toBe('1 to 1.5in of snow.');
    expect(snowAmountLine(null, 'cm', true)).toBe('A dusting still to come.');
    expect(snowAmountLine(null, 'in', false)).toBe('A dusting of snow.');
    expect(snowUpToLine('2cm', false)).toBe('Some forecasts say up to 2cm.');
    expect(snowUpToLine('2cm', true)).toBe('One forecast says up to 2cm.');
    expect(snowUpToLine(null, false)).toBe('Some forecasts say a dusting.');
    expect(snowUpToLine(null, true)).toBe('One forecast says a dusting.');
    expect(snowRateLine('Heavy snow now', '2cm')).toBe('Heavy snow now, about 2cm an hour.');
  });

  it('words the lowest temperature', () => {
    expect(noLowerLine(9, 'rest')).toBe('No lower than 9° for the rest of the day.');
    expect(noLowerLine(9, 'day')).toBe('No lower than 9° all day.');
    expect(noLowerLine(6, 'week')).toBe('No lower than 6° all week.');
    expect(coldestLine(-4)).toBe('Down to -4° at the coldest.');
  });

  it('says when snow comes and goes', () => {
    expect(snowFromLine(21)).toBe('Snow likely from about 9pm.');
    expect(snowPossibleFromLine(21)).toBe('Snow possible from about 9pm.');
    expect(likelyFromLine(21)).toBe('Likely from about 9pm.');
    expect(clearingLine(24)).toBe('Clearing by about midnight.');
  });

  it('describes agreement', () => {
    expect(snowAgreementLine(7, 8)).toBe('7 of 8 forecasts expect snow');
    expect(snowAgreementLine(1, 8)).toBe('1 of 8 forecasts expects snow');
    expect(snowStripSummary({ min: '0cm', max: '6cm', snowy: 7, total: 8 })).toBe(
      'Forecasts range from 0cm to 6cm; 7 of 8 expect snow.',
    );
    expect(snowStripSummary({ min: '0cm', max: '0cm', snowy: 0, total: 8 })).toBe(
      'All forecasts say 0cm; none expect snow.',
    );
    expect(snowStripSummary({ min: '0cm', max: '1cm', snowy: 1, total: 8 })).toBe(
      'Forecasts range from 0cm to 1cm; 1 of 8 expects snow.',
    );
  });

  it('words the week', () => {
    expect(snowyWeekLine(null)).toBe('A snowy week.');
    expect(snowyWeekLine('on Fri')).toBe('A snowy week, heaviest on Fri.');
    expect(snowDaysLine('on Thu and Fri', null, false)).toBe('Snow on Thu and Fri.');
    expect(snowDaysLine('on Thu and Fri', 'on Fri', false)).toBe(
      'Snow on Thu and Fri, heavy on Fri.',
    );
    expect(snowDaysLine('on Fri', 'on Fri', true)).toBe('Heavy snow on Fri.');
    expect(possibleDaysLine('on Sat')).toBe('Snow possible on Sat.');
    expect(flakesDaysLine('on Thu')).toBe('A few flakes on Thu, nothing more.');
  });

  it('compares with normal snow', () => {
    expect(snowNormalLine('rare', 'October')).toBe('Snow is rare here in October.');
    expect(snowNormalLine('rare', null)).toBe('Snow is rare here at this time of year.');
    expect(snowNormalLine('common', 'January')).toBe('Snow is common here in January.');
    expect(snowNormalLine('more', 'January')).toBe('More snow than usual for January.');
    expect(snowNormalLine('less', null)).toBe('Less snow than usual for the time of year.');
    expect(snowNormalLine('usual', 'January')).toBe('About usual for January.');
  });
});

describe('search titles and descriptions', () => {
  it('titles a city page with its question and what it offers, never the answer', () => {
    expect(cityTitle('Leeds', 'hot')).toBe(
      'Is it hot in Leeds today? Hour by hour from 8 forecasts | isithot.today',
    );
    expect(cityTitle('Leeds', 'wet')).toBe(
      'Is it wet in Leeds today? Rain hour by hour from 8 forecasts | isitwet.today',
    );
    expect(cityTitle('Leeds', 'snow')).toBe(
      'Will it snow in Leeds today? Hour by hour from 8 forecasts | willitsnow.today',
    );
    expect(MODELS).toHaveLength(8);
  });

  it('drops words after the question to keep a title short, never the question', () => {
    // 46 characters of question leave room for the short tail only.
    expect(cityTitle('Las Palmas de Gran Canaria', 'hot')).toBe(
      'Is it hot in Las Palmas de Gran Canaria today? From 8 forecasts | isithot.today',
    );
    expect(cityTitle('Las Palmas de Gran Canaria', 'snow')).toBe(
      'Will it snow in Las Palmas de Gran Canaria today? | willitsnow.today',
    );
    // Rain keeps its word as long as it can.
    expect(cityTitle('Middlesbrough', 'wet')).toBe(
      'Is it wet in Middlesbrough today? Hourly rain from 8 forecasts | isitwet.today',
    );
    expect(cityTitle('Newcastle under Lyme', 'wet')).toBe(
      'Is it wet in Newcastle under Lyme today? Rain from 8 forecasts | isitwet.today',
    );
    expect(cityTitle('Las Palmas de Gran Canaria', 'wet')).toBe(
      'Is it wet in Las Palmas de Gran Canaria today? | isitwet.today',
    );
    const long = 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch';
    expect(cityTitle(long, 'wet')).toBe(`Is it wet in ${long} today? | isitwet.today`);
    for (const topic of TOPICS) {
      for (const city of ['York', 'Newcastle under Lyme', 'Santa Cruz de Tenerife']) {
        const before = cityTitle(city, topic).slice(0, -` | ${SITES[topic].name}`.length);
        expect(before.length, `${topic} ${city}`).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
        expect(before).toContain(question(city, 'today', topic));
      }
    }
  });

  it('describes a city page without its answer', () => {
    expect(cityDescription('Leeds', 'hot')).toBe(
      'Will today feel hot in Leeds? One answer from 8 forecast models, judged against what is normal there, with the next 12 hours and the week ahead.',
    );
    expect(cityDescription('Leeds', 'wet')).toMatch(/^Will it rain in Leeds today\? .+ rain /);
    expect(cityDescription('Leeds', 'snow')).toMatch(/^Will it snow in Leeds today\? .+ snow /);
    // A "$" in a name is taken as it is.
    expect(cityDescription('$&', 'hot')).toMatch(/^Will today feel hot in \$&\?/);
  });

  it('introduces each site and its places page', () => {
    for (const topic of TOPICS) {
      expect(intro(topic).heading).toBe('One answer from 8 forecasts');
      expect(intro(topic).text).toMatch(new RegExp(`^${SITES[topic].name} answers one question: `));
      expect(intro(topic).text).toContain('8 forecast models');
      expect(placesIntro(topic)).toMatch(/^(Is it|Will it) \w+ today\? Choose a town or city: /);
    }
    expect(COPY.allPlaces).toBe('All places');
  });
});

describe('when the forecast was fetched', () => {
  it('reads a time of day to the minute', () => {
    expect(clockTime(15 + 5 / 60)).toBe('3:05pm');
    expect(clockTime(0)).toBe('12:00am');
    expect(clockTime(12.5)).toBe('12:30pm');
    expect(clockTime(23 + 59 / 60)).toBe('11:59pm');
  });

  it("gives the place's time with its zone where it has a name", () => {
    expect(updatedTime('2026-10-11T14:05:00Z', 'Europe/London', '2026-10-11')).toBe('3:05pm BST');
    expect(updatedTime('2026-01-11T09:40:00Z', 'Europe/London', '2026-01-11')).toBe('9:40am GMT');
    expect(updatedTime('2026-10-11T14:05:00Z', 'America/New_York', '2026-10-11')).toBe(
      '10:05am EDT',
    );
    // Only an offset: the time alone.
    expect(updatedTime('2026-10-11T14:05:00Z', 'Asia/Tokyo', '2026-10-11')).toBe('11:05pm');
  });

  it('says yesterday for a forecast fetched the evening before', () => {
    expect(updatedTime('2026-10-10T22:40:00Z', 'Europe/London', '2026-10-11')).toBe(
      'yesterday, 11:40pm BST',
    );
  });
});
