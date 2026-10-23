# isithot.today, isitwet.today, willitsnow.today and isitwindy.today

Will today feel hot where I am? One answer (Yes / Almost / No) blended from six forecast models,
judged against what is normal for that place and time of year. And its siblings, **is it wet?**
(Yes / Partly / Maybe / No): how many of the same models expect rain, how much and when; **will
it snow?** (Yes / Maybe / No), the same for snow; and **is it windy?** (Yes / A bit / No): how
strong the wind and gusts get, and when. All four answer for right now, today and this week
(from 6pm at the place, tomorrow instead of today); a Hot | Wet | Snow | Wind toggle switches
between them, and each domain opens on its own question.

- **Website**: Astro + TypeScript, vanilla client JS (about 24 KB gzipped). One deploy serves
  all four domains; an edge function routes isitwet.today to the `/wet` pages, willitsnow.today
  to the `/snow` pages and isitwindy.today to the `/wind` pages.
- **API**: `/api/v1/today` and `/api/v1/search`, shared by the website now and the apps later.
- **Hosting**: Netlify (production from `main`, a deploy preview for every pull request).

**Start here:** [docs/SETUP.md](docs/SETUP.md) (accounts, keys and launch checklist) and
[docs/DECISIONS.md](docs/DECISIONS.md) (where the build differs from the spec, and what needs a
decision).

## Repository layout

```
apps/web             Astro site: pages, components, styles, client script, OG images
apps/ios             The iPhone app, will it snow? (SwiftUI, XcodeGen); see apps/ios/README.md
functions/api        Netlify Functions serving /api/v1/* (thin adapters)
netlify/             Edge function routing isitwet.today, willitsnow.today and isitwindy.today
packages/core        Pure TS: blending, climate normals, verdict, copy, units. No I/O.
packages/client      Pure TS client rules (queries, freshness, the hour picker, widgets, notifications). No DOM, no I/O.
packages/providers   Open-Meteo forecast + geocoding and NASA POWER adapters
packages/server      API handlers, caching (memory + Netlify Blobs), location resolution
packages/mobile      Generators for the native apps: Swift keys and fixtures from the real server (pnpm mobile:generate)
data/cities.json     The 300 city pages (150 UK, 150 worldwide), generated from GeoNames
data/places.json     Town list used to name a rounded device location (Open-Meteo has no reverse geocoding)
reference/           prototype.html, the approved design
e2e/                 Playwright tests, including a visual comparison with the prototype
scripts/             Data generation, fixture recording, smoke test, build helpers
```

`packages/core` holds every decision (blending, verdict bands, copy strings, colours) with no
network or framework code, so the native apps can reuse or mirror it exactly. All tunable
constants live in `packages/core/src/config.ts`. `packages/client` holds what a client decides
for itself: the query it sends, how long an answer holds, which hour ahead to show, what a
widget plans and when to register for notifications. The website's script imports it, and the
apps port it (`docs/DECISIONS.md`, "The client package").

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
  Snow, a wind band such as `&band=gale` on Wind).
- `/in/newcastle-upon-tyne-gb` is a server-rendered city page; `/wet` and
  `/wet/in/newcastle-upon-tyne-gb` are the isitwet.today versions, `/snow` and
  `/snow/in/newcastle-upon-tyne-gb` the willitsnow.today ones, `/wind` and
  `/wind/in/newcastle-upon-tyne-gb` the isitwindy.today ones. Pages follow the time at the
  place: a city where it is past 6pm opens on Now, with Tomorrow in the middle tab. With
  `DATA_SOURCE=synthetic`, `/snow/in/reykjavik-is` has snow in any month, and
  `/wind/in/reykjavik-is` a storm.
- `/api/v1/today?lat=54.95&lon=-1.6&units=c` and `/api/v1/search?q=Leeds` are the API.

## Checks

```sh
pnpm lint             # ESLint
pnpm format:check     # Prettier
pnpm typecheck        # tsc + astro check
pnpm test:coverage    # Vitest; packages/core and packages/client must stay at 100% coverage
pnpm mobile:check     # The files packages/mobile generates for apps/ios are current (pnpm mobile:generate writes them)
pnpm test:e2e         # Playwright (phone + desktop), with synthetic data
pnpm build:netlify    # The exact production build Netlify runs
swift test --package-path apps/ios/Packages/IsItCore  # The app's Swift models (Swift 6.3; CI runs it in swift:6.3.3-noble)
node scripts/smoke.mjs <url> --wet --snow --wind  # Smoke-test a deploy (and its /wet, /snow and /wind pages) against live data
node scripts/smoke.mjs <url> --wet-site <url> --snow-site <url> --wind-site <url>  # Production: the other sites on their own domains
pnpm test:e2e -g contrast                # Rendered text contrast, every band and view (WCAG AA)
E2E_IP_HOUR=20 pnpm test:e2e             # Home pages as if it were 8pm at the approximate place
E2E_CLOCK=19:30 pnpm test:e2e            # The whole suite as if it were 7:30pm in London
```

GitHub Actions runs the checks and the e2e suite on every push and pull request. A second
workflow waits for the Netlify deploy preview of each pull request and smoke-tests it against
live data (`scripts/smoke.mjs`); it also records fresh upstream responses as a downloadable
artifact.
`ios.yml` checks the iPhone app when it, or anything it is built or generated from, changes: on
Linux, the generated files are current, the Swift lints clean and IsItCore passes its tests; on
macOS, the app and its widget build and their tests run on the iPhone 17 simulator, and the
screens are tiled into a contact sheet. [apps/ios/README.md](apps/ios/README.md) has the details.

The e2e server makes synthetic forecasts on the real clock, and pages change at 6pm at the place
(Tomorrow in the middle tab), so the suite must pass at any time of day. CI runs it at whatever
time it is; the last two lines check the evening on demand, worth running after changing the e2e
tests (`e2e/helpers.ts` explains how a test pins the time of day it relies on).

## API

`GET /api/v1/today` with one of `lat`+`lon`, `place` (a city slug), or nothing (approximate IP
location). Optional `units=c|f` (default: °F for US visitors, °C elsewhere) and
`windUnits=mph|kmh` (see `wind` below). `lat`/`lon` requests may also pass `name`, `region`, `country`, `geonameId` and `source=search`, and with
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

`wind` answers "Is it windy?" in the same shape again (`wind.days`, `wind.now` with core
`computeWindNow`/`formatWindNow`, `wind.week`), worked out at the same moment: each day's
strongest gust and mean wind, when it peaks, and each model's own band. Speeds are whole numbers
in `wind.unit`, `mph` or `kmh`, a setting of its own: `windUnits` when given, else the place's
country's when `units` is given (mph in the UK, the US and other places that sign roads in mph,
km/h elsewhere), else the visitor's.
Absent when the forecast has no wind (responses cached before it).

Where the wind blows from (wind only): `wind.days[i].direction`, `wind.now.direction` and each
`wind.now.hours[i].direction` are `{ degrees, compass, words }`, e.g.
`{ "degrees": 225, "compass": "SW", "words": "from the south-west" }` (meteorological degrees,
0 to 359: where the wind comes from), or `null` when it is variable (too light, or the forecasts
point too many ways). A day's is at its windiest hour (`peak`), else across its hours; each
`wind.days[i].models[j].direction` is that model's own. Each `wind.now.series` point has `dir`,
its hour's degrees or `null`, so clients can keep "now" current. Each is absent when the
forecast has no direction for it (responses cached before it, and the days of `wind.week`).

Every answer also carries what an app needs to draw it without working anything out (the
website works the same out itself, with the same core functions):

- `updated`: `updatedAt` at the place, `{ "date": "2026-10-19", "clock": "3:05pm BST" }` (core
  `updatedParts`). The "Updated" line is `clock`, or "yesterday, " and `clock` when `date` is
  before the answer's date (core `updatedTime`).
- `links`: the links out to the big forecast sites for the place, `[{ name, url }]` for BBC
  Weather, the Met Office and AccuWeather (core `outboundLinks`). Links only; never fetched.
- `snow.days[i].bandLabel`: the day's label as the week's rows have it ("Heavy snow", "Snow
  possible", or why there is none: "Too warm", "Rain", "Dry").
- Each row of `snow.week.days` has its day's `chance` (the share of models expecting snow, 0–1,
  two decimals), `snowy` and `total` (how many of the models with data for the day) and
  `reason`, as `snow.days` has them; each row of `rain.week.days` has `chance`, `wet` and
  `total`.

`ahead=snow` is the apps' one opt-in; the website never sends it. The answer then has
`snow.ahead`, the next six forecast hours after the one containing the request (`AHEAD.hours`;
fewer near the end of the forecast), each `{ time, now, today, week }` as the server answers at
that hour's first instant, from the same forecast:

- `time` is the hour's start. Forecast hours are local hours, so in +5:30 and +5:45 zones it is
  :30 or :15 past the UTC hour.
- `now` is that hour's Now view, without `series`. Snow's Now depends only on the hour containing
  the moment, so it is the website's Now for the whole hour, but for `time`.
- `today` is the rest of that hour's local day (after the place's midnight, the new date's). It
  is not minute-exact: the server weights the current hour by the minutes left and scales its
  thresholds to the hours left, so its own Today, asked later in the same hour, can differ a
  little either way, most in the last hour or two before midnight.
- `week` is the week view on the same basis (its first row is `today`), or null.

Unknown topics and repeats in `ahead` are ignored, so `ahead=snow,wet` is `ahead=snow`.

Caching is the same for app requests as for the website's. Answers for a city or coordinates
with explicit `units` are shared by the Netlify CDN, keyed by the full address (so clients round
coordinates to the 0.05° grid first, as the website does); answers for the IP location, or
without `units`, are cached by the browser only. No cache keeps an answer past the next forecast
hour (only max-age's one-minute floor can run into it), so `t=<UTC hour>` is needed only after a
clock running fast, as the website uses it. App requests carry `ahead`, so they never share the
website's CDN entries; the app and its widgets share theirs with each other, and everyone shares
the forecast cache (per grid cell and height). Each endpoint allows 60 requests a minute per IP
on each domain (`RATE_LIMIT`), then answers 429 `rate_limited` with `Retry-After: 60`. The API
sends no CORS headers, so other websites' pages cannot read it (DECISIONS, "API contract").

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
| `PUBLIC_ADMOB_PUBLISHER_ID`                                             | The apps' AdMob publisher ID (`pub-…`). Generates `/app-ads.txt` on all four domains.          |
| `PUBLIC_CF_BEACON_TOKEN`                                                | Cloudflare Web Analytics token (cookieless page views).                                        |
| `OPEN_METEO_FORECAST_URL`, `OPEN_METEO_GEOCODING_URL`, `NASA_POWER_URL` | Optional host overrides.                                                                       |
| `DATA_SOURCE`                                                           | `synthetic` for offline development only. Never set in production.                             |
| `FALLBACK_PLACE`                                                        | City slug used when IP location is unknown (default `london-gb`).                              |

`PUBLIC_*` variables are read at build time, so redeploy after changing them.

## Search engines

Each site has its own sitemap and `robots.txt`, a places page (`/places`: the UK by nation,
then the world by country) and structured data (WebSite on home pages, BreadcrumbList on the
places page and city pages). Titles and descriptions never carry the live answer, which would
go out of date in search results; share cards do. Home pages never render an answer on the
server (Googlebot would index its own US location), and their loading placeholder is marked
`data-nosnippet`. willitsnow.today keeps pages for places where it never snows out of search
(`SNOWLESS` in `config.ts`); the other sites, isitwindy.today included, list every city. The
reasons are in [docs/DECISIONS.md](docs/DECISIONS.md) ("Search engines"), and Search Console and
Bing setup in [docs/SETUP.md](docs/SETUP.md) (section 7).

## Data and licensing

- Forecasts: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0; the Met Office's UKMO data is
  CC BY-SA 4.0). The free API is for non-commercial use only and bans ads: fine for testing with
  friends, but switch to the paid Standard plan before ads or a public launch. The credits
  every page and the API carry are `ATTRIBUTION` in `packages/core/src/copy.ts` (see
  `docs/DECISIONS.md`, "Credits and licences").
- Climate normals: [NASA POWER](https://power.larc.nasa.gov/) climatology (CC BY 4.0, no
  restrictions on use; NASA asks to be cited), `T2M + T2M_RANGE / 2`
  (the normal daily high; see `docs/DECISIONS.md`), `PRECTOTCORR` (normal rainfall, for the
  week's "wetter than usual"), `PRECSNOLAND` (normal snowfall, for "Snow is rare here in
  October." and the week's "more snow than usual") and `WS10M` (normal wind speed at 10 m, for
  "Windier than usual for October."; held back until it is calibrated, see `docs/DECISIONS.md`).
- Place names and coordinates: [GeoNames](https://www.geonames.org/) (CC BY 4.0), via the
  `all-the-cities` package. Regenerate with `pnpm cities`, then add the cities' heights from a
  GeoNames dump with `node scripts/city-heights.mjs <cities1000.txt>`.
- BBC Weather, Met Office and AccuWeather appear only as outbound links. Never fetch from them.
