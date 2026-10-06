import {
  CACHE,
  ERROR_MESSAGES,
  SEARCH,
  type SearchResponse,
  type SearchResult,
} from '@isithot/core';
import { searchPlaces } from '@isithot/providers';
import { cityForPlace } from './cities';
import type { ServerDeps } from './deps';
import { errorResult, publicCache, type HandlerResult } from './http';

interface SearchEntry {
  fetchedAt: number;
  results: SearchResult[];
}

export async function getSearch(
  params: URLSearchParams,
  deps: ServerDeps,
): Promise<HandlerResult<SearchResponse>> {
  const query = (params.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (query.length < SEARCH.minChars) {
    return { status: 200, body: { results: [] }, headers: publicCache() };
  }

  const key = `search/v1/${encodeURIComponent(query.toLowerCase())}`;
  const now = deps.now().getTime();
  const entry = await deps.cache.get<SearchEntry>(key);
  const headers = publicCache(CACHE.edgeMaxAge, 24 * 60 * 60);
  if (entry && now - entry.fetchedAt < CACHE.search * 1000) {
    return { status: 200, body: { results: entry.results }, headers };
  }

  try {
    const places = await searchPlaces({ ...deps.config.openMeteo, fetch: deps.fetch }, query, 10);
    const results: SearchResult[] = places.slice(0, SEARCH.maxResults).map((p) => {
      const result: SearchResult = {
        name: p.name,
        region: p.admin1,
        country: p.countryCode,
        countryName: p.country,
        lat: p.lat,
        lon: p.lon,
      };
      if (p.geonameId) result.geonameId = p.geonameId;
      const city = cityForPlace({ ...p, country: p.countryCode });
      if (city) result.slug = city.slug;
      return result;
    });
    deps.waitUntil(deps.cache.set<SearchEntry>(key, { fetchedAt: now, results }));
    return { status: 200, body: { results }, headers };
  } catch (err) {
    deps.log(`search unavailable for "${query}": ${String(err)}`);
    if (entry) return { status: 200, body: { results: entry.results }, headers: publicCache(60) };
    return errorResult('upstream_unavailable', ERROR_MESSAGES.upstream_unavailable);
  }
}
