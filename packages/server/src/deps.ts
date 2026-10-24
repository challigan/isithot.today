import type { FetchLike } from '@isithot/providers';
import { createSyntheticFetch } from '@isithot/providers';
import { MemoryKV, SafeKV, TieredKV, type KV } from './cache';
import { createBlobsKV } from './blobs';
import { CITIES } from './cities';
import { resolveServerConfig, type EnvGetter, type ServerConfig } from './config';

export interface ServerDeps {
  config: ServerConfig;
  cache: KV;
  fetch: FetchLike;
  now: () => Date;
  /** Keeps background work (filling the climate cache) alive after the response is sent. */
  waitUntil: (promise: Promise<unknown>) => void;
  log: (message: string) => void;
  /** How long to wait for NASA POWER before answering without normals, ms. */
  climateWaitMs?: number;
  /** Forecast request timing, ms (FORECAST_TIMING unless a test shortens it). */
  forecastTiming?: { timeoutMs: number; hedgeAfterMs: number };
}

/** What the hosting platform provides for a request. */
export interface Platform {
  env: EnvGetter;
  /** Netlify deploy context: "production", "deploy-preview", "branch-deploy" or "dev". */
  deployContext?: string | undefined;
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
  /** Where messages go; "[isithot] …" on the console unless a caller (the alert run) words its own. */
  log?: ((message: string) => void) | undefined;
}

// Per-instance memory cache; survives between requests on a warm function.
const memory = new MemoryKV(2000);
let shared: KV | null | undefined;

function sharedCache(production: boolean, log: (m: string) => void): KV | null {
  if (shared !== undefined) return shared;
  try {
    shared = new SafeKV(createBlobsKV(production), (err) => log(`blobs: ${String(err)}`));
  } catch (err) {
    // No Blobs environment (local development or tests): memory only.
    log(`blobs unavailable, using memory cache: ${String(err)}`);
    shared = null;
  }
  return shared;
}

export function createDeps(platform: Platform): ServerDeps {
  const config = resolveServerConfig(platform.env);
  const log = platform.log ?? ((message: string): void => console.log(`[isithot] ${message}`));
  const far =
    config.dataSource === 'live' ? sharedCache(platform.deployContext === 'production', log) : null;
  const fetcher: FetchLike =
    config.dataSource === 'synthetic'
      ? createSyntheticFetch(CITIES)
      : (url, init) => fetch(url, init);
  return {
    config,
    cache: far ? new TieredKV(memory, far) : memory,
    fetch: fetcher,
    now: () => new Date(),
    waitUntil: platform.waitUntil ?? ((p) => void p.catch(() => {})),
    log,
  };
}
