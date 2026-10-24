import { describe, expect, it } from 'vitest';
import { SEARCH, type SearchResult } from '@isithot/core';
import { resultDetail, searchInput } from '../src/search';

describe('searchInput', () => {
  it('asks for nothing with an empty box, or only spaces', () => {
    expect(searchInput('')).toEqual({ kind: 'empty' });
    expect(searchInput('   ')).toEqual({ kind: 'empty' });
    expect(searchInput('\t\n ﻿ ')).toEqual({ kind: 'empty' });
  });

  it(`says to type more under ${SEARCH.minChars} letters`, () => {
    expect(SEARCH.minChars).toBe(2);
    expect(searchInput('L')).toEqual({ kind: 'tooShort' });
    expect(searchInput('  L  ')).toEqual({ kind: 'tooShort' });
  });

  it('searches for the text without the spaces around it', () => {
    expect(searchInput('Le')).toEqual({ kind: 'search', q: 'Le' });
    expect(searchInput('  Leeds ')).toEqual({ kind: 'search', q: 'Leeds' });
    // Spaces inside stay: the server folds them.
    expect(searchInput(' Newcastle  upon Tyne ')).toEqual({
      kind: 'search',
      q: 'Newcastle  upon Tyne',
    });
  });

  it("counts letters as JavaScript does, in UTF-16 code units, and trims JavaScript's spaces", () => {
    // One character, two code units: enough, as the server counts it.
    expect(searchInput('𝔸')).toEqual({ kind: 'search', q: '𝔸' });
    // U+0085 isn't white space to JavaScript, so it stays, and counts.
    expect(searchInput('L\u0085')).toEqual({ kind: 'search', q: 'L\u0085' });
  });
});

describe('resultDetail', () => {
  const leeds: SearchResult = {
    name: 'Leeds',
    region: 'England',
    country: 'GB',
    countryName: 'United Kingdom',
    lat: 53.79648,
    lon: -1.54785,
    slug: 'leeds-gb',
  };

  it("is the region and the country's name", () => {
    expect(resultDetail(leeds)).toBe('England, United Kingdom');
  });

  it("falls back to the country's code, and leaves out what is missing or empty", () => {
    expect(resultDetail({ ...leeds, countryName: null })).toBe('England, GB');
    expect(resultDetail({ ...leeds, region: null })).toBe('United Kingdom');
    expect(resultDetail({ ...leeds, region: '' })).toBe('United Kingdom');
    expect(resultDetail({ ...leeds, region: null, countryName: null, country: null })).toBe('');
    // An empty country name is kept over the code, and then left out.
    expect(resultDetail({ ...leeds, countryName: '' })).toBe('England');
  });
});
