import type { APIRoute } from 'astro';
import { CACHE, question, type Topic, type TodayResponse } from '@isithot/core';
import { cdnCacheControl, cityBySlug, todayForCity } from '@isithot/server';
import { renderOg, type OgContent } from '../../lib/og';
import { platformFrom } from '../../lib/platform';
import { HOURLY, LOOKS, TOPIC_DAYS, type TopicDay } from '../../lib/topics';

export const prerender = false;

/** "About 6mm still to come. Mostly between 2pm and 6pm." → "About 6mm still to come." */
const firstSentence = (text: string): string => text.split(/(?<=\.)\s+/)[0]!;

/** The line under the verdict: hot's high, and the first sentence of rain's or snow's detail. */
const DETAILS: Record<Topic, (res: TodayResponse, day: TopicDay) => string> = {
  hot: ({ days: [day] }) => `High of ${day!.high}°, feels like ${day!.feelsLike}°.`,
  wet: (_, day) => firstSentence(day.detail),
  snow: (_, day) => firstSentence(day.detail),
};

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
        band: LOOKS[topic].og,
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
      const day = body && TOPIC_DAYS[topic](body)?.[0];
      const asked = question(city.name, 'today', topic);
      if (body && day) {
        if (HOURLY[topic]) {
          // Today's rain and snow are for the rest of the day from when they were worked out:
          // like the city page, never cached past the next hour, stale or not.
          maxAge = Math.min(maxAge, result.maxAge ?? maxAge);
          expiresIn = result.expiresIn ?? null;
        }
        content = {
          topic,
          band: day.band,
          question: asked,
          answer: day.answer,
          verdict: day.verdict,
          detail: DETAILS[topic](body, day),
        };
      } else {
        content = {
          topic,
          band: LOOKS[topic].ogPending,
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
