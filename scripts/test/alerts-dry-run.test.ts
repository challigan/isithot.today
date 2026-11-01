import { describe, expect, it } from 'vitest';
import { dryRunLines } from '../alerts-dry-run';

describe('alerts-dry-run', () => {
  it("prints section 8.5's Durham example at 2026-10-18T18:05:00Z, in °C and °F", async () => {
    const lines = await dryRunLines(new Date('2026-10-18T18:05:00Z'));
    expect(lines).toEqual([
      'Dry run at 2026-10-18T18:05:00.000Z on synthetic forecasts: 300 places, each in °C and °F, every switch on, and 2 of them saved on a phone in Tokyo.',
      'alerts-run: zones 3, records 380, groups 378, fetches 189, sent 0, deleted 0, errors 0; dry run, 8 logged; 2 silent; 0 ms',
      '',
      'Durham, evening, °C',
      '  Snow likely in Durham tomorrow',
      '  1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.',
      'Durham, evening, °F',
      '  Snow likely in Durham tomorrow',
      '  About 0.5in of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.',
      'Kendal, evening, °C',
      '  Snow possible in Kendal tomorrow',
      '  Some forecasts say up to 1cm. Mostly between 4am and 6am. 3 of 6 forecasts expect snow.',
      // 03:05 in Tokyo.
      'Kendal, evening, °C, saved place a7b11c0537e9, silent',
      '  Snow possible in Kendal tomorrow',
      '  Some forecasts say up to 1cm. Mostly between 4am and 6am. 3 of 6 forecasts expect snow.',
      'Kendal, evening, °F',
      '  Snow possible in Kendal tomorrow',
      '  Some forecasts say up to 0.5in. Mostly between 4am and 6am. 3 of 6 forecasts expect snow.',
      'Shrewsbury, evening, °C',
      '  Snow possible in Shrewsbury tomorrow',
      '  Some forecasts say up to 1cm. Mostly between 3am and 6am. 3 of 6 forecasts expect snow.',
      'Shrewsbury, evening, °C, saved place 3cd3eb6cc4d8, silent',
      '  Snow possible in Shrewsbury tomorrow',
      '  Some forecasts say up to 1cm. Mostly between 3am and 6am. 3 of 6 forecasts expect snow.',
      'Shrewsbury, evening, °F',
      '  Snow possible in Shrewsbury tomorrow',
      '  Some forecasts say up to 0.5in. Mostly between 3am and 6am. 3 of 6 forecasts expect snow.',
      '8 notifications.',
    ]);
  }, 60_000);

  it('prints a line for each saved place at 2026-12-02T18:05:00Z, each silent at 03:05 in Tokyo', async () => {
    const lines = await dryRunLines(new Date('2026-12-02T18:05:00Z'));
    expect(lines[1]).toBe(
      'alerts-run: zones 3, records 380, groups 378, fetches 189, sent 0, deleted 0, errors 0; dry run, 90 logged; 2 silent; 0 ms',
    );
    const kendal = lines.indexOf('Kendal, evening, °C, saved place a7b11c0537e9, silent');
    const shrewsbury = lines.indexOf('Shrewsbury, evening, °C, saved place 3cd3eb6cc4d8, silent');
    expect(lines.slice(kendal - 3, kendal + 3)).toEqual([
      'Kendal, evening, °C',
      '  Snow likely in Kendal tomorrow',
      '  3 to 4cm of snow. Mostly between 3pm and 9pm. 6 of 6 forecasts expect snow.',
      'Kendal, evening, °C, saved place a7b11c0537e9, silent',
      '  Snow likely in Kendal tomorrow',
      '  3 to 4cm of snow. Mostly between 3pm and 9pm. 6 of 6 forecasts expect snow.',
    ]);
    expect(lines.slice(shrewsbury, shrewsbury + 3)).toEqual([
      'Shrewsbury, evening, °C, saved place 3cd3eb6cc4d8, silent',
      '  Heavy snow likely in Shrewsbury tomorrow',
      '  5 to 7cm of snow. Mostly between 1am and 10pm. 6 of 6 forecasts expect snow.',
    ]);
    expect(lines.filter((l) => l.includes('saved place'))).toHaveLength(2);
    expect(lines.at(-1)).toBe('90 notifications.');
  }, 60_000);

  it('prints the morning\'s words, among them "Snowing in Leeds now"', async () => {
    const lines = await dryRunLines(new Date('2026-11-24T07:05:00Z'));
    const leeds = lines.indexOf('Leeds, morning, °C');
    expect(lines.slice(leeds, leeds + 3)).toEqual([
      'Leeds, morning, °C',
      '  Snowing in Leeds now',
      '  About 1cm still to come. Easing off by about 9am. 6 of 6 forecasts expect snow.',
    ]);
    expect(lines.at(-1)).toBe('10 notifications.');
  }, 60_000);

  it('prints none when the places in a window have no snow', async () => {
    // 12:05 UTC: evening at UTC+6 and +7 (Dhaka, Bangkok), morning at UTC-4 and -5 (Caracas,
    // New York), and no snow at any of them.
    const lines = await dryRunLines(new Date('2026-12-01T12:05:00Z'));
    expect(lines).toEqual([
      'Dry run at 2026-12-01T12:05:00.000Z on synthetic forecasts: 300 places, each in °C and °F, every switch on, and 2 of them saved on a phone in Tokyo.',
      'alerts-run: zones 4, records 46, groups 46, fetches 23, sent 0, deleted 0, errors 0; dry run, 0 logged; 0 ms',
      '0 notifications.',
    ]);
  }, 60_000);
});
