import type { APIRoute } from 'astro';

/** Which commit this deploy was built from (Netlify sets COMMIT_REF). Used by CI smoke tests. */
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      commit: process.env.COMMIT_REF ?? 'local',
      context: process.env.CONTEXT ?? 'local',
      builtAt: new Date().toISOString(),
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  );
