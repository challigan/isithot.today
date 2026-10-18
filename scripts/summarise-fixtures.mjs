#!/usr/bin/env node
/** Prints which models returned data in the recorded fixtures (used in CI logs). */
import { readFileSync } from 'node:fs';

const dir = new URL('../packages/providers/test/fixtures/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const r1 = (v) => Math.round(v * 10) / 10;

for (const place of ['newcastle', 'seville']) {
  const name = `open-meteo-forecast-${place}.json`;
  const f = read(name);
  const times = f.hourly?.time ?? [];
  const dates = [...new Set(times.map((t) => t.slice(0, 10)))];
  console.log(`${name}: timezone=${f.timezone} offset=${f.utc_offset_seconds} dates=${dates}`);
  for (const [key, values] of Object.entries(f.hourly ?? {})) {
    if (key === 'time') continue;
    // Each day's maximum and how many hours have a value.
    const days = dates.map((d) => {
      const v = values.filter((_, i) => times[i].startsWith(d) && values[i] !== null);
      return v.length ? `${Math.max(...v)}(${v.length}h)` : '-';
    });
    console.log(`  ${key}: ${days.join(' ')}`);
  }
  // Each model's rain (mm) and snowfall (cm) per day as the parser works them out: the value at
  // stamp t + 1 fell in the hour from t, and a day needs all 24 hours (the forecast's very last
  // hour excepted). Snowfall is before the parser's warm guard and its cap at the precipitation.
  for (const [what, prefix, unit] of [
    ['rain', 'precipitation', 'mm'],
    ['snow', 'snowfall', 'cm'],
  ]) {
    const keys = Object.keys(f.hourly ?? {}).filter((k) => k.startsWith(prefix));
    if (!keys.length) console.log(`  ${what}: no ${prefix} in this recording`);
    for (const d of keys.length ? dates : []) {
      const hours = times.flatMap((t, i) => (t.startsWith(d) ? [i] : []));
      const totals = keys
        .map((key) => hours.map((i) => f.hourly[key][i + 1] ?? (i === times.length - 1 ? 0 : null)))
        .filter((values) => values.length === 24 && values.every((v) => v !== null))
        .map((values) => values.reduce((a, b) => a + b, 0))
        .sort((a, b) => a - b);
      const show = (v) => (v === undefined ? '-' : `${Math.round(v * 10) / 10}${unit}`);
      const mid = totals.length / 2;
      const median =
        totals.length % 2 ? totals[Math.floor(mid)] : (totals[mid - 1] + totals[mid]) / 2;
      console.log(
        `  ${what} ${d}: ${totals.length}/${keys.length} models with a full day,` +
          ` min ${show(totals[0])} median ${show(totals.length ? median : undefined)} max ${show(totals.at(-1))}`,
      );
    }
  }
  // Wind as the parser lines it up: the mean wind at stamp t is the hour from t; the gust at
  // stamp t + 1 is the strongest of it. Checks that every model gives both for the first 48
  // hours, that no model's series is a copy of another's, and that gusts are at least the mean
  // wind (a check on the alignment and the units); and the same coverage for wind direction.
  const winds = Object.keys(f.hourly ?? {}).filter((k) => k.startsWith('wind_speed_10m'));
  if (!winds.length) console.log('  wind: no wind_speed_10m in this recording');
  const means = [];
  for (const key of winds) {
    const id = key.slice('wind_speed_10m'.length);
    const wind = f.hourly[key];
    const gust = f.hourly[`wind_gusts_10m${id}`] ?? [];
    const first = (series, from) => series.slice(from, from + 48).filter((v) => v !== null).length;
    let pairs = 0;
    let above = 0;
    for (let t = 0; t + 1 < times.length; t++) {
      if (wind[t] === null || gust[t + 1] === null || gust[t + 1] === undefined) continue;
      pairs++;
      if (gust[t + 1] >= wind[t]) above++;
    }
    const copies = winds
      .filter((other) => other !== key)
      .filter((other) => f.hourly[other].every((v, i) => v === wind[i]))
      .map((other) => other.slice('wind_speed_10m_'.length));
    // Where the wind blows from, at its stamp as the wind is: how many of the first 48 hours have
    // one, whether every value is in degrees, and whether it copies another model's.
    const dir = f.hourly[`wind_direction_10m${id}`];
    const sameDir = winds
      .map((other) => `wind_direction_10m${other.slice('wind_speed_10m'.length)}`)
      .filter((other) => dir && other !== `wind_direction_10m${id}` && f.hourly[other])
      .filter((other) => f.hourly[other].every((v, i) => v === dir[i]))
      .map((other) => other.slice('wind_direction_10m_'.length));
    const degrees = (dir ?? []).every((v) => v === null || (v >= 0 && v <= 360));
    console.log(
      `  wind${id}: ${first(wind, 0)}/48h of wind, ${first(gust, 1)}/48h of gusts,` +
        ` gust >= wind in ${pairs ? Math.round((100 * above) / pairs) : '-'}% of ${pairs} hours` +
        (copies.length ? `, same wind as ${copies.join(', ')}` : '') +
        (dir
          ? `, ${first(dir, 0)}/48h of direction${degrees ? '' : ' (NOT ALL IN DEGREES)'}` +
            (sameDir.length ? `, same direction as ${sameDir.join(', ')}` : '')
          : ', no direction'),
    );
    // Each model's 24-hour mean wind on the first two whole days, for the normals' calibration.
    for (const d of dates.slice(0, 2)) {
      const day = times.flatMap((t, i) => (t.startsWith(d) ? [wind[i]] : []));
      if (day.length === 24 && day.every((v) => v !== null)) {
        means.push({ date: d, mean: day.reduce((a, b) => a + b, 0) / 24 });
      }
    }
  }
  // The models' 24-hour mean wind against the climate cell's normal for the month (WS10M, m/s),
  // which decides WIND.normals.scale.
  const normals = read(`nasa-power-wind-${place}.json`).properties?.parameter?.WS10M;
  const month = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ][Number(dates[0]?.slice(5, 7)) - 1];
  if (means.length && normals?.[month] >= 0) {
    const forecast = median(means.map((m) => m.mean));
    const normal = normals[month] * 3.6;
    console.log(
      `  wind calibration: median 24-hour mean ${r1(forecast)}km/h over ${means.length} model-days` +
        ` against the ${month} normal ${r1(normal)}km/h (ratio ${Math.round((forecast / normal) * 100) / 100})`,
    );
  }
}
for (const place of ['newcastle', 'seville', 'london', 'singapore']) {
  for (const name of [
    `nasa-power-${place}.json`,
    `nasa-power-rain-${place}.json`,
    `nasa-power-snow-${place}.json`,
    `nasa-power-wind-${place}.json`,
  ]) {
    const nasa = read(name);
    console.log(
      `${name} ${JSON.stringify(nasa.geometry?.coordinates)}: ${JSON.stringify(nasa.properties?.parameter)}`,
    );
  }
}
const search = read('open-meteo-search-newcastle.json');
console.log(
  `search: ${search.results?.map((r) => `${r.name}/${r.country_code}/${r.id}`).join(', ')}`,
);

// Compact copies for the log, so they can be committed as test fixtures.
if (process.argv.includes('--print')) {
  const { readdirSync } = await import('node:fs');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    console.log(`FIXTURE ${name} ${JSON.stringify(read(name))}`);
  }
}
