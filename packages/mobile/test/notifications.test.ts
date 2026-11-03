import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  hereKind,
  hereName,
  herePlace,
  replyZones,
  syncReply,
  testOutcome,
  type DeviceReply,
  type RegistrationBody,
  type SyncReply,
  type TestOutcome,
} from '@isithot/client';
import { DEVICE_FIXTURES, type DeviceFixture } from '../src/deviceFixtures';
import { DEVICE_FIXTURES_DIR } from '../src/generate';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

/** The devices fixtures as the app's Debug builds and IsItCore's tests read them, from disk. */
const onDisk = (name: string): DeviceFixture =>
  JSON.parse(read(`${DEVICE_FIXTURES_DIR}/${name}.json`)) as DeviceFixture;

describe('what the app reads for its notifications', () => {
  it("finds a city's country at the end of its slug, as Settings' UK places do", () => {
    const cities = JSON.parse(read('data/cities.json')) as { slug: string; country: string }[];
    expect(cities).toHaveLength(300);
    for (const { slug, country } of cities) {
      expect(slug.endsWith(`-${country.toLowerCase()}`), slug).toBe(true);
      expect(slug.slice(slug.lastIndexOf('-') + 1).toUpperCase(), slug).toBe(country);
    }
  });

  it("types no device token into DebugHooks.swift: the stand-in's is put-here-ip's", () => {
    const hooks = read('apps/ios/Apps/Snow/App/DebugHooks.swift');
    expect(hooks).not.toMatch(/[0-9a-f]{64}/i);
  });

  it('writes a file for each devices fixture, and no other', () => {
    expect(
      readdirSync(new URL(DEVICE_FIXTURES_DIR, root))
        .filter((f) => !f.startsWith('.'))
        .sort(),
    ).toEqual(DEVICE_FIXTURES.map((s) => `${s.name}.json`).sort());
  });

  it("means to the app what each fixture is for, through the client's rules", () => {
    const stored = (name: string): SyncReply => ({
      kind: 'stored',
      reply: JSON.parse(onDisk(name).text),
    });
    const failed: SyncReply = { kind: 'failed' };
    const sent: TestOutcome = { kind: 'sent', count: 1 };
    const outcomes: Record<string, SyncReply | TestOutcome> = {
      // 8.1's answer to its version 1 body, which 8.4's app never sends, and couldn't read.
      'put-leeds': failed,
      'put-twice': { kind: 'retry', afterSeconds: 50 },
      delete: { kind: 'forgotten' },
      'test-sent': sent,
      'test-dryrun': { kind: 'dryRun' },
      'test-limited': { kind: 'limited' },
      'test-quiet': { kind: 'quiet' },
      'test-gone': { kind: 'notRegistered' },
      'test-unregistered': { kind: 'notRegistered' },
      'test-down': failed,
      'rate-limited': { kind: 'retry', afterSeconds: 60 },
      // 8.4's sets.
      'put-here-ip': stored('put-here-ip'),
      'put-here-device': stored('put-here-device'),
      'put-here-refresh': stored('put-here-refresh'),
      'put-unlocated': {
        kind: 'placeRefused',
        message:
          "We couldn't tell where you are from your internet connection. Try again later, or use your location.",
      },
      // 8.4b's sets with saved places, a gone city page among them, and the cap on new places.
      'put-here-ip-durham': stored('put-here-ip-durham'),
      'put-here-ip-kathmandu': stored('put-here-ip-kathmandu'),
      'put-here-ip-durham-kathmandu': stored('put-here-ip-durham-kathmandu'),
      'put-refused': stored('put-refused'),
      'put-capped': { kind: 'retry', afterSeconds: 60 },
      'test-sent-two': { kind: 'sent', count: 2 },
    };
    expect(Object.keys(outcomes)).toEqual(DEVICE_FIXTURES.map((s) => s.name));
    for (const [name, outcome] of Object.entries(outcomes)) {
      const { _fixture, status, text, retryAfter } = onDisk(name);
      const means = _fixture.request.startsWith('POST ')
        ? testOutcome(status, text)
        : syncReply(status, text, retryAfter);
      expect(means, name).toEqual(outcome);
    }
    // Netlify's limiter answers a test the same way: a failure, with no words of its own.
    const limited = onDisk('rate-limited');
    expect(testOutcome(limited.status, limited.text)).toEqual(failed);
    // What the app keeps is the server's reply, whole.
    expect((outcomes['put-here-ip'] as { reply: unknown }).reply).toEqual(
      JSON.parse(onDisk('put-here-ip').text),
    );
    // A gone city page is kept in the reply's refused list, by its index in the body.
    expect((outcomes['put-refused'] as { reply: DeviceReply }).reply.refused).toEqual([
      { index: 0, code: 'not_found' },
    ]);
  });

  it("gives the router each saved place's zone, by its place, where you are first", () => {
    const reply = JSON.parse(onDisk('put-here-ip-durham-kathmandu').text) as DeviceReply;
    expect(replyZones(reply)).toEqual({
      'device:53.8,-1.55': 'Europe/London',
      'city:durham-gb': 'Europe/London',
      'search:27.7,85.3': 'Asia/Kathmandu',
    });
  });

  it("gives Settings' row, the card and the router what each set says of where you are", () => {
    const approximate = herePlace({ access: 'denied', fix: null, kept: null });
    /** The set as the app keeps it, and where you are as the app sent it. */
    const read = (name: string) => {
      const { _fixture, text } = onDisk(name);
      const sent = (_fixture.body as RegistrationBody).here;
      const here =
        sent.source === 'ip'
          ? approximate
          : herePlace({
              access: 'granted',
              fix: { kind: 'coords', source: 'device', lat: sent.lat, lon: sent.lon },
              kept: null,
            });
      return { here, reply: JSON.parse(text) as DeviceReply };
    };
    const rows = Object.fromEntries(
      ['put-here-ip', 'put-here-device', 'put-here-refresh'].map((name) => {
        const { here, reply } = read(name);
        return [
          name,
          [hereKind({ here, reply, refused: false }), hereName({ here, reply }), replyZones(reply)],
        ];
      }),
    );
    expect(rows).toEqual({
      'put-here-ip': ['ip', 'Leeds', { 'device:53.8,-1.55': 'Europe/London' }],
      'put-here-device': ['device', 'Leeds', { 'device:53.8,-1.55': 'Europe/London' }],
      'put-here-refresh': ['ip', 'Newcastle', { 'device:55,-1.6': 'Europe/London' }],
    });
    // Refused, Settings says "Not found yet" and the card names no town.
    expect(hereKind({ here: approximate, reply: null, refused: true })).toBe('unknown');
    expect(hereName({ here: approximate, reply: null })).toBeNull();
    // A reply about the phone's location names no town once the app sends approximate.
    const { reply } = read('put-here-device');
    expect(hereName({ here: approximate, reply })).toBeNull();
  });
});
