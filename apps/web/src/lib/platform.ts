import type { Platform, RequestPlatform } from '@isithot/server';

/** Builds the server platform (env, deploy context, background work) for an Astro request. */
export function platformFrom(locals: App.Locals): Platform {
  const context = (locals as Partial<App.Locals>).netlify?.context;
  return {
    env: (name) => process.env[name],
    deployContext: context?.deploy?.context ?? (process.env.CONTEXT || undefined),
    waitUntil: context?.waitUntil ? (p) => context.waitUntil(p) : undefined,
  };
}

/** The same, plus the visitor's approximate location from Netlify's geo data. */
export function requestPlatformFrom(locals: App.Locals): RequestPlatform {
  const geo = (locals as Partial<App.Locals>).netlify?.context?.geo;
  return {
    ...platformFrom(locals),
    geo: geo
      ? {
          city: geo.city,
          country: geo.country?.code,
          region: geo.subdivision?.name,
          lat: geo.latitude,
          lon: geo.longitude,
        }
      : null,
  };
}

/** Marks which runtime answered, to make routing easy to check after a deploy. */
export function via(response: Response, name: string): Response {
  response.headers.set('x-isithot-via', name);
  return response;
}
