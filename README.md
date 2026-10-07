# isithot.today and isitwet.today

Will today feel hot where I am? One answer (Yes / Almost / No) blended from several forecast
models, judged against what is normal for that place and time of year. And its sibling, **is it
wet?** (Yes / Partly / Maybe / No): how many of the same models expect rain, how much and when.
Both answer for right now, today and this week; a toggle switches between them, and each domain
opens on its own question.

- **Website**: Astro + TypeScript, vanilla client JS (about 16 KB gzipped). One deploy serves
  both domains; an edge function routes isitwet.today to the `/wet` pages.
- **API**: `/api/v1/today` and `/api/v1/search`, shared by the website now and the apps later.
- **Hosting**: Netlify (production from `main`, a deploy preview for every pull request).

**Start here:** [docs/SETUP.md](docs/SETUP.md) (accounts, keys and launch checklist) and
[docs/DECISIONS.md](docs/DECISIONS.md) (where the build differs from the spec, and what needs a
decision).

## Repository layout

```
apps/web             Astro site: pages, components, styles, client script, OG images
functions/api        Netlify Functions serving /api/v1/* (thin adapters)
netlify/             Edge function routing isitwet.today to the /wet pages
packages/core        Pure TS: blending, climate normals, verdict, copy, units. No I/O.
packages/providers   Open-Meteo forecast + geocoding and NASA POWER adapters
packages/server      API handlers, caching (memory + Netlify Blobs), location resolution
data/cities.json     The 300 city pages (150 UK, 150 worldwide), generated from GeoNames
data/places.json     Town list used to name a rounded device location (Open-Meteo has no reverse geocoding)
reference/           prototype.html, the approved design
e2e/                 Playwright tests, including a visual comparison with the prototype
scripts/             Data generation, fixture recording, smoke test, build helpers
```

`packages/core` holds every decision (blending, verdict bands, copy strings, colours) with no
network or framework code, so the native apps can reuse or mirror it exactly. All tunable
constants live in `packages/core/src/config.ts`.

## Getting started

Requires Node 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
cp .env.example apps/web/.env       # optional
pnpm dev                            # http://localhost:4321
```

`pnpm dev` calls the real Open-Meteo and NASA POWER APIs. To work offline, set
`DATA_SOURCE=synthetic` (made-up but realistic data in the real response formats).

Useful pages while developing:

- `/?preview=1` shows the prototype's "preview each kind of day" chips (`&band=hot` to pick one;
  a rain band such as `&band=drenched` opens on Wet).
- `/in/newcastle-upon-tyne-gb` is a server-rendered city page; `/wet` and
  `/wet/in/newcastle-upon-tyne-gb` are the isitwet.today versions.
- `/api/v1/today?lat=54.95&lon=-1.6&units=c` and `/api/v1/search?q=Leeds` are the API.

## Checks

```sh
pnpm lint             # ESLint
pnpm format:check     # Prettier
pnpm typecheck        # tsc + astro check
pnpm test:coverage    # Vitest; packages/core must stay at 100% branch coverage
pnpm test:e2e         # Playwright (phone + desktop), with synthetic data
pnpm build:netlify    # The exact production build Netlify runs
node scripts/smoke.mjs <url> --wet       # Smoke-test a deployed site (and its wet pages) against live data
pnpm test:e2e -g contrast                # Rendered text contrast, every band and view (WCAG AA)
```

GitHub Actions runs all of these on every push and pull request. A second workflow waits for
the Netlify deploy preview of each pull request and smoke-tests it against live data
(`scripts/smoke.mjs`); it also records fresh upstream responses as a downloadable artifact.

## API

`GET /api/v1/today` with one of `lat`+`lon`, `place` (a city slug), or nothing (approximate IP
location). Optional `units=c|f` (default: °F for US visitors, °C elsewhere). `lat`/`lon` requests
may also pass `name`, `region`, `country`, `geonameId` and `source=search`.

The answer covers three views: `days[0]` is today (with tomorrow in `days[1]`), `now` is the
blended forecast for the current minute with a day of judged hourly points (so clients can
keep it current between requests), and `week` averages today and the next six days.

`rain` answers "Is it wet?" for the same place: `rain.days[0]` is the rest of today from the
moment of the request (`from`; refetch an hour after it), `rain.days[1]` tomorrow, `rain.now`
the current hour with a day of judged hourly points (core `computeRainNow`/`formatRainNow`
keep it current), and `rain.week` today and the next six days. Amounts are in `rain.unit`:
millimetres with `units=c`, inches with `units=f`.

`GET /api/v1/search?q=` returns up to 8 places, with `slug` when the place has a city page.

Errors use `{ "error": { "code", "message" } }` with `bad_location` (400), `not_found` (404),
`rate_limited` (429) and `upstream_unavailable` (503). When upstream is down but a cached
forecast under 6 hours old exists, the API answers 200 with that result and `"stale": true`.

The response shape is in `packages/core/src/types.ts`. Never change a field's meaning; add
fields or create `/api/v2/`.

## Environment variables

Set these in Netlify under **Project configuration → Environment variables**. See
`.env.example`.

| Variable                                                                | Purpose                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `OPEN_METEO_API_KEY`                                                    | Open-Meteo Standard plan key. With it set, the paid `customer-*` hosts are used automatically. |
| `PUBLIC_ADS_ENABLED`                                                    | `true` turns the AdSense unit on. Default `false` (set in `netlify.toml`).                     |
| `PUBLIC_ADSENSE_CLIENT`                                                 | AdSense publisher ID (`ca-pub-…`). Also generates `/ads.txt`.                                  |
| `PUBLIC_ADSENSE_SLOT`                                                   | AdSense ad unit ID.                                                                            |
| `PUBLIC_CF_BEACON_TOKEN`                                                | Cloudflare Web Analytics token (cookieless page views).                                        |
| `OPEN_METEO_FORECAST_URL`, `OPEN_METEO_GEOCODING_URL`, `NASA_POWER_URL` | Optional host overrides.                                                                       |
| `DATA_SOURCE`                                                           | `synthetic` for offline development only. Never set in production.                             |
| `FALLBACK_PLACE`                                                        | City slug used when IP location is unknown (default `london-gb`).                              |

`PUBLIC_*` variables are read at build time, so redeploy after changing them.

## Data and licensing

- Forecasts: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). The free API is for
  non-commercial use only and bans ads: fine for testing with friends, but switch to the paid
  Standard plan before ads or a public launch.
- Climate normals: [NASA POWER](https://power.larc.nasa.gov/) climatology, `T2M + T2M_RANGE / 2`
  (the normal daily high; see `docs/DECISIONS.md`), and `PRECTOTCORR` (normal rainfall, for the
  week's "wetter than usual").
- Place names and coordinates: [GeoNames](https://www.geonames.org/) (CC BY 4.0), via the
  `all-the-cities` package. Regenerate with `pnpm cities`.
- BBC Weather, Met Office and AccuWeather appear only as outbound links. Never fetch from them.
