import type { ApiError, ErrorCode } from '@isithot/core';
import { CACHE } from '@isithot/core';

export interface HandlerResult<T> {
  status: number;
  body: T | ApiError;
  headers: Record<string, string>;
  /** How long the answer may be cached, seconds (for pages that embed it). */
  maxAge?: number;
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

/** Shared by every visitor: browsers and the Netlify CDN may cache it by full URL. */
export function publicCache(maxAge: number = CACHE.edgeMaxAge, cdnMaxAge: number = maxAge) {
  return {
    'Cache-Control': `public, max-age=${maxAge}`,
    'Netlify-CDN-Cache-Control': `public, durable, max-age=${cdnMaxAge}, stale-while-revalidate=${cdnMaxAge}`,
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
