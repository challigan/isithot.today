/**
 * The website's answers stay as they were: the app additions (S1 to S3 on every answer, and
 * `snow.ahead` only when asked for) are the only differences. See contract.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  outboundLinks,
  snowLabel,
  updatedParts,
  type ApiError,
  type TodayResponse,
} from '@isithot/core';
import { CONTRACT_REQUESTS, contractResponse, withoutAdditions } from './contract';

interface Snapshot {
  now: string;
  responses: {
    name: string;
    query: string;
    status: number;
    headers: Record<string, string>;
    body?: unknown;
    sameBodyAs?: string;
  }[];
}

const snapshot = JSON.parse(
  readFileSync(new URL('./fixtures/contract.json', import.meta.url), 'utf8'),
) as Snapshot;

/** The snapshot's answer to the request named `name`, its body written out. */
function before(name: string) {
  const r = snapshot.responses.find((s) => s.name === name)!;
  const body = r.sameBodyAs
    ? snapshot.responses.find((s) => s.name === r.sameBodyAs)!.body
    : r.body;
  return { status: r.status, headers: r.headers, body };
}

/** The documented top-level keys (README "API"); `stale` only on a stale answer. */
const TOP_KEYS = [
  'attribution',
  'days',
  'links',
  'location',
  'nearby',
  'now',
  'rain',
  'snow',
  'units',
  'updated',
  'updatedAt',
  'week',
  'wind',
];
/** The documented `snow` keys: no `ahead` without the opt-in. */
const SNOW_KEYS = ['days', 'now', 'unit', 'week'];

const keys = (o: object) => Object.keys(o).sort();
const ok = (body: TodayResponse | ApiError) => body as TodayResponse;

describe('the contract with the website', () => {
  it('snapshots every kind of request the website makes', () => {
    expect(snapshot.responses.map((r) => [r.name, r.query])).toEqual(
      CONTRACT_REQUESTS.map((r) => [r.name, r.query]),
    );
  });

  it.each(CONTRACT_REQUESTS)('$name: has the documented keys', async ({ query, geo }) => {
    const body = ok((await contractResponse(query, geo)).body);
    expect(keys(body)).toEqual(TOP_KEYS);
    expect(keys(body.snow!)).toEqual(SNOW_KEYS);
  });

  it.each(CONTRACT_REQUESTS)(
    '$name: keeps every other field, and its status and headers, as they were',
    async ({ name, query, geo }) => {
      const r = await contractResponse(query, geo);
      expect({ ...r, body: withoutAdditions(r.body) }).toEqual(before(name));
    },
  );

  it.each(CONTRACT_REQUESTS)('$name: adds the documented fields', async ({ query, geo }) => {
    const body = ok((await contractResponse(query, geo)).body);
    // What the website works out for itself from `updatedAt` and `location`.
    expect(body.updated).toEqual(updatedParts(body.updatedAt, body.location.timezone));
    expect(body.links).toEqual(outboundLinks(body.location));
    expect(body.links.map((l) => l.name)).toEqual(['BBC Weather', 'Met Office', 'AccuWeather']);
    const snow = body.snow!;
    for (const d of snow.days) expect(d.bandLabel).toBe(snowLabel(d.band, d.reason));
    // A week row is its day's answer: today and tomorrow are the days in full.
    const shared = <T extends object>(d: T, fields: readonly (keyof T)[]) =>
      Object.fromEntries(fields.map((f) => [f, d[f]]));
    const snowFields = ['date', 'band', 'chance', 'snowy', 'total', 'reason', 'bandLabel'] as const;
    expect(snow.week!.days.slice(0, 2).map((d) => shared(d, snowFields))).toEqual(
      snow.days.map((d) => shared(d, snowFields)),
    );
    const rain = body.rain!;
    const rainFields = ['date', 'band', 'chance', 'wet', 'total'] as const;
    expect(rain.week!.days.slice(0, 2).map((d) => shared(d, rainFields))).toEqual(
      rain.days.map((d) => shared(d, rainFields)),
    );
    for (const d of snow.week!.days) {
      expect(d.chance).toBe(Math.round((d.snowy / d.total) * 100) / 100);
    }
    for (const d of rain.week!.days) {
      expect(d.chance).toBe(Math.round((d.wet / d.total) * 100) / 100);
    }
  });
});
