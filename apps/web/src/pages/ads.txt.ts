import type { APIRoute } from 'astro';

/** Generated from the AdSense publisher ID (PUBLIC_ADSENSE_CLIENT, e.g. "ca-pub-123…"). */
export const GET: APIRoute = () => {
  const client = import.meta.env.PUBLIC_ADSENSE_CLIENT?.trim();
  const publisher = client?.replace(/^ca-/, '');
  const body = publisher
    ? `google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`
    : '# Set PUBLIC_ADSENSE_CLIENT to publish the AdSense line here.\n';
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
