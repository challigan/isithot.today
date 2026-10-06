import { COPY, ERROR_MESSAGES, type TodayResponse } from '@isithot/core';
import { createDeps, type Platform } from './deps';
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

/** GET /api/v1/today */
export async function handleToday(request: Request, platform: RequestPlatform): Promise<Response> {
  try {
    const deps = createDeps(platform);
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

/** Today's answer for a city page, rendered on the server. */
export async function todayForCity(
  slug: string,
  platform: Platform,
  units: 'c' | 'f' = 'c',
): Promise<HandlerResult<TodayResponse>> {
  try {
    const deps = createDeps(platform);
    return await getToday(new URLSearchParams({ place: slug, units }), null, deps);
  } catch (err) {
    console.log(`[isithot] city ${slug} failed: ${String(err)}`);
    return errorResult('upstream_unavailable', COPY.unavailable);
  }
}
