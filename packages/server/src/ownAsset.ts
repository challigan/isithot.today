/**
 * The site's own content-hashed build files (/_astro/…), fetched over HTTP from the deploy that
 * serves the function: the OG image renderer's fonts and resvg wasm (apps/web/src/lib/og.ts).
 */

/**
 * Tries in all, 1 s apart: at most 14 s of waiting. How long a spread lasts has not been
 * measured, so this is sized from the function's 30 s budget (DECISIONS "Hosting").
 */
export const OWN_ASSET_TRIES = 15;
export const OWN_ASSET_WAIT_MS = 1000;

export interface OwnAssetDeps {
  fetch: (url: URL) => Promise<Response>;
  /** setTimeout in production; tests pass one that returns at once. */
  wait: (ms: number) => Promise<void>;
  /** The function log in production: one line for each 404 that is tried again. */
  log: (line: string) => void;
}

/**
 * A new deploy reaches Netlify's servers one by one, so for some seconds after it goes live the
 * server asked may not have it yet and answers 404 (Netlify's own "Not Found - Request ID" page,
 * or the previous deploy's own 404 page). These files come from the very build that made the
 * function, so any 404 means that; a broken build still fails, after the last try. Every 404 is
 * tried again, OWN_ASSET_WAIT_MS apart, up to OWN_ASSET_TRIES tries in all, and logged, so the
 * function log shows how long a spread really lasts; any other status, or a fetch that fails,
 * throws at once.
 */
export async function ownAsset(
  path: string,
  origin: string,
  { fetch, wait, log }: OwnAssetDeps,
): Promise<ArrayBuffer> {
  const url = new URL(path, origin);
  for (let tries = 1; ; tries++) {
    const res = await fetch(url);
    if (res.ok) return res.arrayBuffer();
    if (res.status !== 404) throw new Error(`asset ${path}: ${res.status}`);
    if (tries === OWN_ASSET_TRIES) throw new Error(`asset ${path}: 404 after ${tries} tries`);
    log(
      `asset ${path}: 404 on try ${tries} of ${OWN_ASSET_TRIES}, trying again in ${OWN_ASSET_WAIT_MS} ms`,
    );
    await res.body?.cancel();
    await wait(OWN_ASSET_WAIT_MS);
  }
}
