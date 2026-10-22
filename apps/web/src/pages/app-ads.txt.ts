import type { APIRoute } from 'astro';

/**
 * The apps' ads.txt, which AdMob reads from the developer website each app's store listing gives,
 * generated from the AdMob publisher ID (PUBLIC_ADMOB_PUBLISHER_ID, e.g. "pub-123…"). The edge
 * function leaves it alone, so all four domains serve this one file and each app can list its own.
 */
export const GET: APIRoute = () => {
  const id = import.meta.env.PUBLIC_ADMOB_PUBLISHER_ID?.trim();
  // The publisher ID, also when given in its app ID form ("ca-app-pub-123…").
  const publisher = id?.replace(/^ca-(app-)?/, '').replace(/~.*$/, '');
  const body = publisher
    ? `google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`
    : '# Set PUBLIC_ADMOB_PUBLISHER_ID to publish the AdMob line here.\n';
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
