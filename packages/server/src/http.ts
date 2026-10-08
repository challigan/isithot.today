import type { ApiError, ErrorCode } from '@isithot/core';
import { CACHE } from '@isithot/core';

export interface HandlerResult<T> {
  status: number;
  body: T | ApiError;
  headers: Record<string, string>;
  /** How long the answer may be cached, seconds (for pages that embed it). */
  maxAge?: number;
  /**
   * Seconds until the answer is out of date (the next forecast hour, as today's rain answer is
   * for the rest of the day from the request), when it has such a limit. No cache may serve it
   * longer, stale or not: pass it to `cdnCacheControl`.
   */
  expiresIn?: number;
}

export const ERROR_STATUS: Record<ErrorCode, number> = {
  bad_location: 400,
  not_found: 404,
  rate_limited: 429,
  upstream_unavailable: 503,
};

export const NO_STORE = {
  'Cache-Control': 'no-store',
  'Netlify-CDN-Cache-Control': 'no-store',
};

export function errorResult(code: ErrorCode, message: string): HandlerResult<never> {
  return {
    status: ERROR_STATUS[code],
    body: { error: { code, message } },
    headers: { ...NO_STORE },
  };
}

/**
 * How long the CDN may serve an answer after its max-age while it fetches a new one: as long
 * again, but never past `expiresIn` seconds from now, so max-age + stale-while-revalidate stays
 * within it (none when the max-age already reaches it).
 */
export function staleWhileRevalidate(maxAge: number, expiresIn: number | null = null): number {
  return expiresIn === null ? maxAge : Math.max(0, Math.min(maxAge, expiresIn - maxAge));
}

/** The Netlify CDN's cache header for a shared answer (`expiresIn` as in HandlerResult). */
export function cdnCacheControl(maxAge: number, expiresIn: number | null = null): string {
  return `public, durable, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate(maxAge, expiresIn)}`;
}

/** Shared by every visitor: browsers and the Netlify CDN may cache it by full URL. */
export function publicCache(
  maxAge: number = CACHE.edgeMaxAge,
  cdnMaxAge: number = maxAge,
  expiresIn: number | null = null,
) {
  return {
    'Cache-Control': `public, max-age=${maxAge}`,
    'Netlify-CDN-Cache-Control': cdnCacheControl(cdnMaxAge, expiresIn),
    'Netlify-Vary': 'query',
  };
}

/** Depends on who is asking (IP location or country default units): browser cache only. */
export function privateCache(maxAge: number) {
  return {
    'Cache-Control': `private, max-age=${maxAge}`,
    'Netlify-CDN-Cache-Control': 'no-store',
  };
}

export function toResponse<T>(result: HandlerResult<T>): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...result.headers,
    },
  });
}
