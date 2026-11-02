/**
 * The OG image renderer's fetch of the site's own hashed build files (/_astro/…), which waits out
 * a new deploy that has not reached every Netlify server yet (DECISIONS "Hosting").
 */
import { describe, expect, it } from 'vitest';
import { OWN_ASSET_TRIES, OWN_ASSET_WAIT_MS, ownAsset } from '../src';

const ORIGIN = 'https://deploy-preview-48--isithotapp.netlify.app';
const WASM = '/_astro/index_bg.Blvrv-U2.wasm';
const BYTES = [0, 97, 115, 109];
/**
 * Netlify's own page from a server that has no site for the address yet, in the shape the smoke
 * test matches; the Request ID is made up (PR #48's run kept only the OG route's status).
 */
const NETLIFY_NOT_FOUND = 'Not Found - Request ID: 01AAAAAAAAAAAAAAAAAAAAAAAA';
/** The site's own 404 page, from a server still on the previous deploy of the same address. */
const SITE_NOT_FOUND = '<!doctype html><title>Page not found | isithot.today</title>';

/**
 * A fetch that answers with `answers` in turn (the last one again once they run out), a wait that
 * returns at once and a log; all three note what they were asked in `seen`, in order.
 */
function fake(...answers: [status: number, body?: string][]) {
  const seen: string[] = [];
  let calls = 0;
  const fetch = async (url: URL): Promise<Response> => {
    seen.push(`fetch ${url.href}`);
    const [status, body] = answers[Math.min(calls++, answers.length - 1)]!;
    return new Response(status === 200 ? new Uint8Array(BYTES) : (body ?? ''), { status });
  };
  const wait = async (ms: number): Promise<void> => {
    seen.push(`wait ${ms}`);
  };
  const log = (line: string): void => {
    seen.push(`log ${line}`);
  };
  const waited = () =>
    seen.filter((s) => s.startsWith('wait ')).map((s) => Number(s.slice('wait '.length)));
  const fetched = () => seen.filter((s) => s.startsWith('fetch ')).length;
  const logged = () => seen.filter((s) => s.startsWith('log ')).map((s) => s.slice('log '.length));
  return { deps: { fetch, wait, log }, seen, waited, fetched, logged };
}

describe('ownAsset', () => {
  it('returns the body after one wait when a 404 is followed by a 200', async () => {
    const { deps, seen } = fake([404, NETLIFY_NOT_FOUND], [200]);
    const body = await ownAsset(WASM, ORIGIN, deps);
    expect([...new Uint8Array(body)]).toEqual(BYTES);
    expect(seen).toEqual([
      `fetch ${ORIGIN}${WASM}`,
      `log asset ${WASM}: 404 on try 1 of ${OWN_ASSET_TRIES}, trying again in ${OWN_ASSET_WAIT_MS} ms`,
      `wait ${OWN_ASSET_WAIT_MS}`,
      `fetch ${ORIGIN}${WASM}`,
    ]);
  });

  it('logs each 404 it tries again, so the function log shows how long a spread lasts', async () => {
    const { deps, logged } = fake([404, NETLIFY_NOT_FOUND], [404, SITE_NOT_FOUND], [200]);
    await ownAsset(WASM, ORIGIN, deps);
    expect(logged()).toEqual([
      `asset ${WASM}: 404 on try 1 of ${OWN_ASSET_TRIES}, trying again in ${OWN_ASSET_WAIT_MS} ms`,
      `asset ${WASM}: 404 on try 2 of ${OWN_ASSET_TRIES}, trying again in ${OWN_ASSET_WAIT_MS} ms`,
    ]);
  });

  it('logs nothing when the first try answers', async () => {
    const { deps, logged } = fake([200]);
    await ownAsset(WASM, ORIGIN, deps);
    expect(logged()).toEqual([]);
  });

  it("waits out the previous deploy's own 404 page as well as Netlify's", async () => {
    const { deps, waited } = fake([404, NETLIFY_NOT_FOUND], [404, SITE_NOT_FOUND], [200]);
    const body = await ownAsset(WASM, ORIGIN, deps);
    expect([...new Uint8Array(body)]).toEqual(BYTES);
    expect(waited()).toHaveLength(2);
  });

  it('throws naming the asset and the status once 404s run past the limit', async () => {
    const { deps, fetched, logged } = fake([404, NETLIFY_NOT_FOUND]);
    await expect(ownAsset(WASM, ORIGIN, deps)).rejects.toThrow(
      new Error(`asset ${WASM}: 404 after ${OWN_ASSET_TRIES} tries`),
    );
    expect(fetched()).toBe(OWN_ASSET_TRIES);
    // The last 404 is in the error, not in a line saying it will be tried again.
    expect(logged()).toHaveLength(OWN_ASSET_TRIES - 1);
  });

  it('throws at once, with no wait, on a status other than 404', async () => {
    const { deps, seen } = fake([500, 'Internal Server Error'], [200]);
    await expect(ownAsset(WASM, ORIGIN, deps)).rejects.toThrow(new Error(`asset ${WASM}: 500`));
    expect(seen).toEqual([`fetch ${ORIGIN}${WASM}`]);
  });

  it('throws at once, with no wait, when the fetch itself fails', async () => {
    const { deps, seen } = fake([200]);
    const dropped = new TypeError('fetch failed');
    const fetch = async (url: URL): Promise<Response> => {
      seen.push(`fetch ${url.href}`);
      throw dropped;
    };
    await expect(ownAsset(WASM, ORIGIN, { ...deps, fetch })).rejects.toBe(dropped);
    expect(seen).toEqual([`fetch ${ORIGIN}${WASM}`]);
  });

  it('waits between tries only, longer than the smoke test would and inside 30 s', async () => {
    const { deps, seen, waited } = fake([404, NETLIFY_NOT_FOUND]);
    await expect(ownAsset(WASM, ORIGIN, deps)).rejects.toThrow(/: 404 /);
    // fetch, log, wait, fetch, …, fetch: never a wait after the last try.
    expect(seen.at(-1)).toMatch(/^fetch /);
    expect(waited()).toHaveLength(OWN_ASSET_TRIES - 1);
    const total = waited().reduce((sum, ms) => sum + ms, 0);
    // On PR #48's preview all seven OG checks failed, over about 6 s, and the run ended with the
    // 404s still going, so how long a spread lasts is not known (DECISIONS "Hosting"). At least
    // the 12 s the smoke test waits for a page still on Netlify's "Not Found" (6 more tries, 2 s
    // apart).
    expect(total).toBeGreaterThanOrEqual(12_000);
    // Netlify stops a function after 30 s, and the OG route may already have spent about 7.5 s
    // on the forecast (DECISIONS "Data"): this leaves 7.5 s for the tries themselves (tens of ms
    // each on PR #48), a cold start and the render.
    expect(total).toBeLessThanOrEqual(15_000);
  });
});
