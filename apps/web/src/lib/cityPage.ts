/**
 * The request side of a city page, shared by isithot.today/in/<slug> and isitwet.today/in/<slug>:
 * the canonical address, the answer and the cache headers. CityPage.astro renders the result.
 */
import type { AstroGlobal } from 'astro';
import {
  CACHE,
  defaultUnitsForCountry,
  defaultView,
  showsTomorrow,
  sitePath,
  viewDisplay,
  type City,
  type DisplayState,
  type Palette,
  type TodayDisplay,
  type TodayResponse,
  type Topic,
  type Units,
  type View,
} from '@isithot/core';
import { cdnCacheControl, cityBySlug, todayForCity } from '@isithot/server';
import { platformFrom } from './platform';

export interface CityPageProps {
  /** The site the page belongs to. */
  topic: Topic;
  /** Null for an unknown slug (a 404). */
  city: City | null;
  units: Units;
  data: TodayResponse | null;
  state: DisplayState;
  /** Today's answer in the page's topic, for the description (always about today). */
  today: TodayDisplay;
  /** The view the page opens on: Today, or Now in the evening at the place. */
  start: View;
  /** The middle view answers for tomorrow (from 6pm at the place). */
  tomorrow: boolean;
  /** The colours of the view the page opens on. */
  palette: Palette;
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
    const today = viewDisplay(null, topic, 'today', state);
    return {
      topic,
      city,
      units,
      data: null,
      state,
      today,
      start: 'today',
      tomorrow: false,
      palette: today.palette,
    };
  }

  const result = await todayForCity(city.slug, platformFrom(Astro.locals), units);
  const data = result.status === 200 ? (result.body as TodayResponse) : null;
  const state: DisplayState = data?.days[0] ? 'ready' : 'error';
  const opts = { city: city.name };
  const today = viewDisplay(data, topic, 'today', state, opts);
  // From 6pm at the place the middle view shows tomorrow and the page opens on Now. The page is
  // never cached past the next hour (below), so one made at 5pm is not served after 6.
  const now = Date.now();
  const tomorrow = showsTomorrow(data, now);
  const start = defaultView(data, now);
  const palette = viewDisplay(data, topic, start, state, { ...opts, tomorrow }).palette;

  // Never past the next hour, stale or not: the page carries today's rain answer for the rest of
  // the day, and the evening's Tomorrow from 6pm.
  const cache = today.band ? Math.min(CACHE.cityPage, result.maxAge ?? CACHE.cityPage) : 60;
  Astro.response.headers.set('Cache-Control', `public, max-age=${Math.min(cache, 300)}`);
  Astro.response.headers.set(
    'Netlify-CDN-Cache-Control',
    cdnCacheControl(cache, result.expiresIn ?? null),
  );
  return { topic, city, units, data, state, today, start, tomorrow, palette };
}
