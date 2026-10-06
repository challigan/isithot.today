import { geohash } from './geo';

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
