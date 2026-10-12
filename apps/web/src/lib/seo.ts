/**
 * Structured data for search engines (schema.org JSON-LD), on each site's own domain: the site's
 * name on its home page (Google's site names need one per domain), and where a page sits in the
 * site on the places page and city pages. No FAQ or how-to markup: Google no longer shows either.
 */
import { COPY, SITES, question, type Topic } from '@isithot/core';

/** The home page's WebSite: the site's name, its address and the question it answers. */
export function websiteLd(topic: Topic): object {
  const site = SITES[topic];
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    alternateName: question(null, 'today', topic),
    url: `${site.url}/`,
    inLanguage: 'en-GB',
  };
}

/** Site > Places, then a city's page when given: the places page's and city pages' trail. */
export function breadcrumbLd(topic: Topic, city?: { name: string; slug: string }): object {
  const site = SITES[topic];
  const trail = [
    { name: site.name, item: `${site.url}/` },
    { name: COPY.places, item: `${site.url}/places` },
    ...(city ? [{ name: city.name, item: `${site.url}/in/${city.slug}` }] : []),
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({ '@type': 'ListItem', position: i + 1, ...step })),
  };
}
