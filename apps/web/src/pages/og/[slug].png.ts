import type { APIRoute } from 'astro';
import { CACHE, COPY, DEFAULT_DESCRIPTION, question, type TodayResponse } from '@isithot/core';
import { cityBySlug, todayForCity } from '@isithot/server';
import { renderOg, type OgContent } from '../../lib/og';
import { platformFrom } from '../../lib/platform';

export const prerender = false;

export const GET: APIRoute = async ({ params, url, locals }) => {
  const slug = params.slug ?? '';
  let content: OgContent;
  let maxAge = CACHE.ogImage;

  if (slug === 'default') {
    content = {
      band: 'hot',
      question: COPY.question,
      answer: 'Yes?',
      verdict: 'One answer from several forecasts.',
      detail: DEFAULT_DESCRIPTION.split('. ')[1] ?? '',
    };
    maxAge = 24 * 60 * 60;
  } else {
    const city = cityBySlug(slug);
    if (!city) return new Response('Not found', { status: 404 });
    const result = await todayForCity(city.slug, platformFrom(locals));
    const day = result.status === 200 ? (result.body as TodayResponse).days[0] : undefined;
    if (day) {
      content = {
        band: day.band,
        question: question(city.name),
        answer: day.answer,
        verdict: day.verdict,
        detail: `High of ${day.high}°, feels like ${day.feelsLike}°.`,
      };
    } else {
      content = {
        band: 'mild',
        question: question(city.name),
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
      'Netlify-CDN-Cache-Control': `public, durable, max-age=${maxAge}, stale-while-revalidate=${maxAge}`,
    },
  });
};
