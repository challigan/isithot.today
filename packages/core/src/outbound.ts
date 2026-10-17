import type { WindBand } from './config';
import { COPY } from './copy';
import { geohash } from './geo';
import { windRank } from './wind';

export interface OutboundLink {
  name: string;
  url: string;
}

export interface OutboundPlace {
  name: string;
  lat: number;
  lon: number;
  /** GeoNames ID. BBC Weather location pages use GeoNames IDs. */
  geonameId?: number | null;
}

/**
 * Links out to the big forecast sites, deep-linked to the place where each site allows it.
 * We never fetch from these sites; they are links only.
 */
export function outboundLinks(place: OutboundPlace | null): OutboundLink[] {
  if (!place) {
    return [
      { name: 'BBC Weather', url: 'https://www.bbc.co.uk/weather' },
      { name: 'Met Office', url: 'https://www.metoffice.gov.uk/weather/forecast' },
      { name: 'AccuWeather', url: 'https://www.accuweather.com' },
    ];
  }
  const query = encodeURIComponent(place.name);
  return [
    {
      name: 'BBC Weather',
      url: place.geonameId
        ? `https://www.bbc.co.uk/weather/${place.geonameId}`
        : `https://www.bbc.co.uk/weather/search?s=${query}`,
    },
    {
      name: 'Met Office',
      url: `https://www.metoffice.gov.uk/weather/forecast/${geohash(place.lat, place.lon, 9)}`,
    },
    {
      name: 'AccuWeather',
      url: `https://www.accuweather.com/en/search-locations?query=${query}`,
    },
  ];
}

/** The Met Office's official warnings for the UK (a link, never a warning of ours). */
export const MET_OFFICE_WARNINGS =
  'https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings';

/**
 * A plain link to the official warnings under a gale or storm answer for a UK place, or null.
 * The site never words a warning itself; other countries have services of their own, so none.
 */
export function warningsLink(
  country: string | null | undefined,
  band: WindBand | null | undefined,
): OutboundLink | null {
  if (country?.toUpperCase() !== 'GB' || !band || windRank(band) < windRank('gale')) return null;
  return { name: COPY.metOfficeWarnings, url: MET_OFFICE_WARNINGS };
}
