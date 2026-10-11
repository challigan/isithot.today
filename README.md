# isithot.today, isitwet.today and willitsnow.today

Will today feel hot where I am? One answer (Yes / Almost / No) blended from several forecast
models, judged against what is normal for that place and time of year. And its siblings, **is
it wet?** (Yes / Partly / Maybe / No): how many of the same models expect rain, how much and
when; and **will it snow?** (Yes / Maybe / No), the same for snow. All three answer for right
now, today and this week (from 6pm at the place, tomorrow instead of today); a Hot | Wet | Snow
toggle switches between them, and each domain opens on its own question.

- **Website**: Astro + TypeScript, vanilla client JS (about 20 KB gzipped). One deploy serves
  all three domains; an edge function routes isitwet.today to the `/wet` pages and
  willitsnow.today to the `/snow` pages.
- **API**: `/api/v1/today` and `/api/v1/search`, shared by the website now and the apps later.
- **Hosting**: Netlify (production from `main`, a deploy preview for every pull request).

**Start here:** [docs/SETUP.md](docs/SETUP.md) (accounts, keys and launch checklist) and
[docs/DECISIONS.md](docs/DECISIONS.md) (where the build differs from the spec, and what needs a
decision).

## Repository layout

```
apps/web             Astro site: pages, components, styles, client script, OG images
functions/api        Netlify Functions serving /api/v1/* (thin adapters)
netlify/             Edge function routing isitwet.today and willitsnow.today to their pages
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
  a rain band such as `&band=drenched` opens on Wet, a snow band such as `&band=deepsnow` on
  Snow).
- `/in/newcastle-upon-tyne-gb` is a server-rendered city page; `/wet` and
  `/wet/in/newcastle-upon-tyne-gb` are the isitwet.today versions, `/snow` and
  `/snow/in/newcastle-upon-tyne-gb` the willitsnow.today ones. Pages follow the time at the
  place: a city where it is past 6pm opens on Now, with Tomorrow in the middle tab. With
  `DATA_SOURCE=synthetic`, `/snow/in/reykjavik-is` has snow in any month.
- `/api/v1/today?lat=54.95&lon=-1.6&units=c` and `/api/v1/search?q=Leeds` are the API.

## Checks

```sh
pnpm lint             # ESLint
pnpm format:check     # Prettier
pnpm typecheck        # tsc + astro check
pnpm test:coverage    # Vitest; packages/core must stay at 100% branch coverage
pnpm test:e2e         # Playwright (phone + desktop), with synthetic data
pnpm build:netlify    # The exact production build Netlify runs
node scripts/smoke.mjs <url> --wet --snow  # Smoke-test a deploy (and its /wet and /snow pages) against live data
node scripts/smoke.mjs <url> --wet-site <url> --snow-site <url>  # Production: the other sites on their own domains
pnpm test:e2e -g contrast                # Rendered text contrast, every band and view (WCAG AA)
E2E_IP_HOUR=20 pnpm test:e2e             # Home pages as if it were 8pm at the approximate place
E2E_CLOCK=19:30 pnpm test:e2e            # The whole suite as if it were 7:30pm in London
```

GitHub Actions runs the checks and the e2e suite on every push and pull request. A second
workflow waits for the Netlify deploy preview of each pull request and smoke-tests it against
live data (`scripts/smoke.mjs`); it also records fresh upstream responses as a downloadable
artifact.

The e2e server makes synthetic forecasts on the real clock, and pages change at 6pm at the place
(Tomorrow in the middle tab), so the suite must pass at any time of day. CI runs it at whatever
time it is; the last two lines check the evening on demand, worth running after changing the e2e
tests (`e2e/helpers.ts` explains how a test pins the time of day it relies on).

## API

`GET /api/v1/today` with one of `lat`+`lon`, `place` (a city slug), or nothing (approximate IP
location). Optional `units=c|f` (default: °F for US visitors, °C elsewhere). `lat`/`lon` requests
may also pass `name`, `region`, `country`, `geonameId` and `source=search`, and with
`source=search` the place's `elevation` (whole metres, from the search result): the forecast is
then for that height (to the nearest 50 m), and `location.elevation` echoes it. City pages are
forecast for the city's height when `data/cities.json` has it.

The answer covers three views: `days[0]` is today (with tomorrow in `days[1]`, its verdict in
the future tense), `now` is the blended forecast for the current minute with a day of judged
hourly points (so clients can keep it current between requests), and `week` averages today and
the next six days. From 6pm at the place (`location.timezone`) the website's middle view shows
`days[1]` (core `showsTomorrow`).

The UV index (hot only): `days[i].uv` is `{ max, level, peak }`, the day's highest hourly index
(whole number), its level (`low`, `medium`, `high`, `veryhigh`, `extreme`) and the hour it
starts ("1pm"); `now.uv` is `{ value, level }` for the current hour, and each `now.series` point
has its hour's `uv`. Each is absent when the forecast has no UV index for it.

`rain` answers "Is it wet?" for the same place: `rain.days[0]` is the rest of today from the
moment of the request (`from`; refetch an hour after it), `rain.days[1]` tomorrow, `rain.now`
the current hour with a day of judged hourly points, each with a `light` flag (core
`computeRainNow`/`formatRainNow` keep it current), and `rain.week` today and the next six days.
Amounts are in `rain.unit`: millimetres with `units=c`, inches with `units=f`.

`snow` answers "Will it snow?" in the same shape as `rain` (`snow.days`, `snow.now` with core
`computeSnowNow`/`formatSnowNow`, `snow.week`), worked out at the same moment. A day without
snow says why in `reason` (`warm`, `rain` or `dry`). Amounts are fresh snowfall in `snow.unit`:
centimetres with `units=c`, inches with `units=f`.

`GET /api/v1/search?q=` returns up to 8 places, with `slug` when the place has a city page and
`elevation` (whole metres) when its height is known.

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
  (the normal daily high; see `docs/DECISIONS.md`), `PRECTOTCORR` (normal rainfall, for the
  week's "wetter than usual") and `PRECSNOLAND` (normal snowfall, for "Snow is rare here in
  October." and the week's "more snow than usual").
- Place names and coordinates: [GeoNames](https://www.geonames.org/) (CC BY 4.0), via the
  `all-the-cities` package. Regenerate with `pnpm cities`, then add the cities' heights from a
  GeoNames dump with `node scripts/city-heights.mjs <cities1000.txt>`.
- BBC Weather, Met Office and AccuWeather appear only as outbound links. Never fetch from them.
