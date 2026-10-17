import { WIND } from '@isithot/core';
import { NASA_POWER_URL, OPEN_METEO_CUSTOMER, OPEN_METEO_FREE } from '@isithot/providers';

export type DataSource = 'live' | 'synthetic';

export interface ServerConfig {
  openMeteo: {
    forecastUrl: string;
    geocodingUrl: string;
    apiKey: string | undefined;
  };
  nasaPowerUrl: string;
  dataSource: DataSource;
  /** City slug used when the visitor's approximate location is unknown. */
  fallbackPlace: string;
  /** Compare wind with its normals ("Windier than usual"): WIND.normals.compare. */
  compareWind: boolean;
}

export type EnvGetter = (name: string) => string | undefined;

/**
 * Reads configuration from environment variables. With OPEN_METEO_API_KEY set and no URL
 * overrides, the paid customer hosts are used automatically.
 */
export function resolveServerConfig(env: EnvGetter): ServerConfig {
  const apiKey = env('OPEN_METEO_API_KEY')?.trim() || undefined;
  const hosts = apiKey ? OPEN_METEO_CUSTOMER : OPEN_METEO_FREE;
  return {
    openMeteo: {
      forecastUrl: env('OPEN_METEO_FORECAST_URL')?.trim() || hosts.forecastUrl,
      geocodingUrl: env('OPEN_METEO_GEOCODING_URL')?.trim() || hosts.geocodingUrl,
      apiKey,
    },
    nasaPowerUrl: env('NASA_POWER_URL')?.trim() || NASA_POWER_URL,
    dataSource: env('DATA_SOURCE')?.trim() === 'synthetic' ? 'synthetic' : 'live',
    fallbackPlace: env('FALLBACK_PLACE')?.trim() || 'london-gb',
    compareWind: WIND.normals.compare,
  };
}
