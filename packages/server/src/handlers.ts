import { COPY, ERROR_MESSAGES, type TodayResponse, type WindUnit } from '@isithot/core';
import { createDeps, type Platform, type ServerDeps } from './deps';
import { errorResult, toResponse, type HandlerResult } from './http';
import { getSearch } from './search';
import { getToday, type VisitorGeo } from './today';

export interface RequestPlatform extends Platform {
  geo?: VisitorGeo | null;
}

function failed(what: string, err: unknown): Response {
  console.log(
    `[isithot] ${what} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  return toResponse(errorResult('upstream_unavailable', COPY.unavailable));
}

/**
 * GET /api/v1/today. Every platform takes the default `makeDeps`; the native apps' fixtures
 * (packages/mobile) pass one that fixes the clock, so they are this handler's own answers.
 */
export async function handleToday(
  request: Request,
  platform: RequestPlatform,
  makeDeps: (platform: Platform) => ServerDeps = createDeps,
): Promise<Response> {
  try {
    const deps = makeDeps(platform);
    const params = new URL(request.url).searchParams;
    return toResponse(await getToday(params, platform.geo ?? null, deps));
  } catch (err) {
    return failed('today', err);
  }
}

/** GET /api/v1/search?q= */
export async function handleSearch(request: Request, platform: Platform): Promise<Response> {
  try {
    const deps = createDeps(platform);
    return toResponse(await getSearch(new URL(request.url).searchParams, deps));
  } catch (err) {
    return failed('search', err);
  }
}

/** Target of the platform rate limiter's rewrite. */
export function handleRateLimited(): Response {
  const result = errorResult('rate_limited', ERROR_MESSAGES.rate_limited);
  return toResponse({ ...result, headers: { ...result.headers, 'Retry-After': '60' } });
}

/**
 * Today's answer for a city page, rendered on the server. Wind speeds are in `windUnit`, by
 * default the city's country's (mph for London, km/h for Paris).
 */
export async function todayForCity(
  slug: string,
  platform: Platform,
  units: 'c' | 'f' = 'c',
  windUnit?: WindUnit,
): Promise<HandlerResult<TodayResponse>> {
  try {
    const deps = createDeps(platform);
    const params = new URLSearchParams({ place: slug, units });
    if (windUnit) params.set('windUnits', windUnit);
    return await getToday(params, null, deps);
  } catch (err) {
    console.log(`[isithot] city ${slug} failed: ${String(err)}`);
    return errorResult('upstream_unavailable', COPY.unavailable);
  }
}
