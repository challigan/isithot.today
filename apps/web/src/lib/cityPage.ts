/**
 * The request side of a city page, shared by isithot.today/in/<slug> and isitwet.today/in/<slug>:
 * the canonical address, the answer and the cache headers. CityPage.astro renders the result.
 */
import type { AstroGlobal } from 'astro';
import {
  CACHE,
  defaultUnitsForCountry,
  sitePath,
  viewDisplay,
  type City,
  type DisplayState,
  type TodayDisplay,
  type TodayResponse,
  type Topic,
  type Units,
} from '@isithot/core';
import { cityBySlug, todayForCity } from '@isithot/server';
import { platformFrom } from './platform';

export interface CityPageProps {
  /** The site the page belongs to. */
  topic: Topic;
  /** Null for an unknown slug (a 404). */
  city: City | null;
  units: Units;
  data: TodayResponse | null;
  state: DisplayState;
  /** The Today view in the page's topic, which also gives the page its colours. */
  today: TodayDisplay;
}

/** The page's props, or a redirect to the slug's canonical spelling. */
export async function loadCityPage(
  Astro: AstroGlobal,
  topic: Topic,
): Promise<CityPageProps | Response> {
  const slug = (Astro.params.slug ?? '').toLowerCase();
  const city = cityBySlug(slug) ?? null;
  // Wet pages sit under /wet only where they are served from there (deploy previews, a local
  // server); on isitwet.today the same page is at /in/<slug>.
  if (city && city.slug !== Astro.params.slug) {
    return Astro.redirect(sitePath(topic, `/in/${city.slug}`, Astro.url.hostname), 301);
  }
  const units = defaultUnitsForCountry(city?.country);
  if (!city) {
    Astro.response.status = 404;
    Astro.response.headers.set('Cache-Control', 'public, max-age=300');
    const state = 'error';
    return {
      topic,
      city,
      units,
      data: null,
      state,
      today: viewDisplay(null, topic, 'today', state),
    };
  }

  const result = await todayForCity(city.slug, platformFrom(Astro.locals), units);
  const data = result.status === 200 ? (result.body as TodayResponse) : null;
  const state: DisplayState = data?.days[0] ? 'ready' : 'error';
  const today = viewDisplay(data, topic, 'today', state, { city: city.name });

  // Never past the next hour: the page carries today's rain answer for the rest of the day.
  const cache = today.band ? Math.min(CACHE.cityPage, result.maxAge ?? CACHE.cityPage) : 60;
  Astro.response.headers.set('Cache-Control', `public, max-age=${Math.min(cache, 300)}`);
  Astro.response.headers.set(
    'Netlify-CDN-Cache-Control',
    `public, durable, max-age=${cache}, stale-while-revalidate=${cache}`,
  );
  return { topic, city, units, data, state, today };
}
