/**
 * The place picker's search box: what a search asks for, and how a result is described. Moved
 * from the website's `app.ts` (`onSearchInput`, `resultItem`), so the apps word and decide the
 * same.
 *
 * Swift: `IsItLogic/PlaceSearch.swift`, checked against the golden vectors in `search.json`.
 */
import { SEARCH, type SearchResult } from '@isithot/core';

/**
 * What the search box holds: nothing to search for (the box is empty, or only spaces), too few
 * letters ("Type at least 2 letters."), or a search for `q`, the text without the spaces around
 * it. Letters are counted as JavaScript counts a string's length, in UTF-16 code units, as the
 * server counts them.
 */
export type SearchInput = { kind: 'empty' } | { kind: 'tooShort' } | { kind: 'search'; q: string };

/** What a search box holding `text` asks for. */
export function searchInput(text: string): SearchInput {
  const q = text.trim();
  if (q.length >= SEARCH.minChars) return { kind: 'search', q };
  return q.length ? { kind: 'tooShort' } : { kind: 'empty' };
}

/** The line under a result's name: its region and country, "England, United Kingdom". */
export function resultDetail(r: SearchResult): string {
  return [r.region, r.countryName ?? r.country].filter(Boolean).join(', ');
}
