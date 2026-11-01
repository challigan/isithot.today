import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { syncReply, testOutcome, type SyncReply, type TestOutcome } from '@isithot/client';
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

  it("types no device token into DebugHooks.swift: the stand-in's is put-leeds's", () => {
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
    const outcomes: Record<string, SyncReply | TestOutcome> = {
      'put-leeds': stored('put-leeds'),
      'put-durham': stored('put-durham'),
      'put-device': stored('put-device'),
      'put-kathmandu': stored('put-kathmandu'),
      'put-bad-place': { kind: 'placeRefused', message: 'There is no page for that place.' },
      'put-twice': { kind: 'retry', afterSeconds: 50 },
      delete: { kind: 'forgotten' },
      'test-sent': 'sent',
      'test-dryrun': 'dryRun',
      'test-limited': 'limited',
      'test-quiet': 'quiet',
      'test-gone': 'notRegistered',
      'test-unregistered': 'notRegistered',
      'test-down': 'failed',
      'rate-limited': { kind: 'retry', afterSeconds: 60 },
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
    expect(testOutcome(limited.status, limited.text)).toBe('failed');
    // What the app keeps is the server's reply, whole.
    expect((outcomes['put-leeds'] as { reply: unknown }).reply).toEqual(
      JSON.parse(onDisk('put-leeds').text),
    );
  });
});
