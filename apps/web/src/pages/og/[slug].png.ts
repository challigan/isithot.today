import type { APIRoute } from 'astro';
import { CACHE, question, type Topic, type TodayResponse } from '@isithot/core';
import { cdnCacheControl, cityBySlug, todayForCity } from '@isithot/server';
import { renderOg, type OgContent } from '../../lib/og';
import { platformFrom } from '../../lib/platform';

export const prerender = false;

/** "About 6mm still to come. Mostly between 2pm and 6pm." → "About 6mm still to come." */
const firstSentence = (text: string): string => text.split(/(?<=\.)\s+/)[0]!;

/** A city's answer to the site's question as an image; "default" is the site's own image. */
export const ogImage =
  (topic: Topic): APIRoute =>
  async ({ params, url, locals }) => {
    const slug = params.slug ?? '';
    let content: OgContent;
    let maxAge = CACHE.ogImage;
    /** Seconds until the image is out of date, when it has such a limit (see below). */
    let expiresIn: number | null = null;

    if (slug === 'default') {
      content = {
        topic,
        band: topic === 'wet' ? 'rain' : 'hot',
        question: question(null, 'today', topic),
        answer: 'Yes?',
        verdict: 'One answer from several forecasts.',
        detail: '',
      };
      maxAge = 24 * 60 * 60;
    } else {
      const city = cityBySlug(slug);
      if (!city) return new Response('Not found', { status: 404 });
      const result = await todayForCity(city.slug, platformFrom(locals));
      const body = result.status === 200 ? (result.body as TodayResponse) : undefined;
      const day = body?.days[0];
      const rainDay = body?.rain?.days[0];
      const asked = question(city.name, 'today', topic);
      if (topic === 'hot' && day) {
        content = {
          topic,
          band: day.band,
          question: asked,
          answer: day.answer,
          verdict: day.verdict,
          detail: `High of ${day.high}°, feels like ${day.feelsLike}°.`,
        };
      } else if (topic === 'wet' && rainDay) {
        // Today's rain is for the rest of the day from when it was worked out: like the city
        // page, never cached past the next hour, stale or not.
        maxAge = Math.min(maxAge, result.maxAge ?? maxAge);
        expiresIn = result.expiresIn ?? null;
        content = {
          topic,
          band: rainDay.band,
          question: asked,
          answer: rainDay.answer,
          verdict: rainDay.verdict,
          detail: firstSentence(rainDay.detail),
        };
      } else {
        content = {
          topic,
          band: topic === 'wet' ? 'spots' : 'mild',
          question: asked,
          answer: '…',
          verdict: '',
          detail: '',
        };
        maxAge = 60;
      }
    }

    const png = await renderOg(content, url.origin);
    return new Response(png as BodyInit, {
      headers: {
        'content-type': 'image/png',
        'Cache-Control': `public, max-age=${Math.min(maxAge, 600)}`,
        'Netlify-CDN-Cache-Control': cdnCacheControl(maxAge, expiresIn),
      },
    });
  };

export const GET = ogImage('hot');
