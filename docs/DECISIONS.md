# Decisions and deviations from the build spec

What changed from the spec while building v1, and why. Items marked **Needs a decision** are
for Carl.

## Hosting: Netlify instead of Cloudflare

The spec assumed Cloudflare Pages. The project is on Netlify, so each piece maps across:

| Spec (Cloudflare)          | Built (Netlify)                                                          |
| -------------------------- | ------------------------------------------------------------------------ |
| Pages Functions `/api/*`   | Netlify Functions in `functions/api` (`/api/v1/today`, `/api/v1/search`) |
| KV                         | Netlify Blobs, behind a per-instance memory cache                        |
| Cache API / edge cache     | Netlify CDN via `Netlify-CDN-Cache-Control` (durable cache, 10 min)      |
| `request.cf` geo           | `context.geo` (city, country, coordinates)                               |
| Per-IP rate limit (custom) | Netlify code-based rate limiting rule on each function (60/min per IP)   |
| Cloudflare Web Analytics   | Still Cloudflare Web Analytics: it works on any host                     |
| `.dev.vars.example`        | `.env.example`                                                           |

City pages and OG images are server-rendered by Astro's Netlify adapter. The API is also
mounted as Astro routes (same handlers), so `pnpm dev` works without the Netlify CLI. In
production, responses carry `x-isithot-via: function` when the dedicated function answered.

## Data

- **Model IDs.** The current Open-Meteo docs list `ncep_gfs_seamless`, `dwd_icon_seamless`
  and `cmc_gem_seamless` where the spec had `gfs_seamless`, `icon_seamless` and
  `gem_seamless`. The live API returned data for all 8 models with the new IDs (verified on the
  deploy preview). The old IDs are kept as aliases when parsing.
- **One hourly request, with daily highs worked out from it.** The request asks only for hourly
  `temperature_2m` and `apparent_temperature` for 7 days. Each model's daily high (and
  feels-like high) is the maximum of its 24 local hours, which is how Open-Meteo builds its own
  daily maximum: the recorded responses match it exactly for all 8 models. The free API charges
  by variables × models, so this costs 1.6 calls per fetch, against 2.4 for the original
  request. A model's day counts only if it has every hour from 10am to 6pm, so a forecast that
  ends mid-morning cannot pass off a morning reading as the day's high.
- **Forecasts stay fresh for an hour** (was 30 minutes). The global models update every 6
  hours, and "now" is worked out from the hourly forecast at request time (and again in the
  browser), so the longer cache costs no accuracy and halves calls to Open-Meteo. A forecast
  fetched on an earlier local day is refetched, so the week always has 7 days.
- **Needs a decision: MET Norway counts ECMWF twice outside Scandinavia.** Open-Meteo's
  `metno_seamless` is MET Nordic over Norway, Sweden, Finland and Denmark, and ECMWF's 9 km
  model everywhere else (and after 2.5 days everywhere). For UK visitors it is close to a
  second copy of ECMWF, so "8 forecasts agree" overstates the independent forecasts by one.
  Options: keep it (simple, as the spec lists it), drop it outside the Nordics, or label it.
- **Normal daily highs come from NASA POWER's `T2M + T2M_RANGE / 2`, not `T2M_MAX`.**
  Checked against live responses: in the climatology endpoint `T2M_MAX` is the highest
  temperature of the period, and `T2M_MAX_AVG` is the average _hottest day_ of each month.
  Both put London's January normal at 11–12°C and its July normal at 29°C. The monthly mean
  temperature plus half the average daily range is the standard estimate of the mean daily
  high. Against published 1991–2020 normals it runs about 1–2°C cool:

  | Normal daily high, °C | NASA estimate | Published normal |
  | --------------------- | ------------- | ---------------- |
  | London, Jan / Jul     | 6.8 / 22.6    | 8.4 / 23.9       |
  | Seville, Jan / Aug    | 14.3 / 37.1   | 16.6 / 36.2      |
  | Newcastle, Jan / Jul  | 5.3 / 18.5    | 7.6 / 20.4       |
  | Singapore, Jan / Apr  | 28.1 / 30.2   | 30.6 / 32.0      |

  That is inside the spec's "a degree or two", but it tilts the "warmer than usual" line
  warm. **Needs a decision**: accept it, add a +1°C calibration (one constant), or later
  precompute normals from a station-based dataset.

- **Climate cells follow NASA's grid.** NASA POWER serves MERRA-2 data on 0.5° × 0.625°
  cells. Rounding to 0.5° both ways put Newcastle in a cell that is mostly North Sea (January
  normal 10°C), so lookups snap to the real cell centres instead.
- **Reverse geocoding is offline.** Open-Meteo has no reverse geocoding, so a rounded device
  location is named from a bundled GeoNames list (towns over 5,000 people, or over 1,000 in the
  UK and Ireland). A city page within 6 km wins, because 0.05° rounding can move central
  Newcastle into Gateshead.
- **Search puts our city pages first.** Open-Meteo returns Newcastle, Australia for
  "Newcastle", but not Newcastle upon Tyne.

## Now and This week

Carl asked for two more views either side of Today, on one page that always opens on Today:
a tab bar at the top on every screen, and swiping on phones.

- **Now** is the blended hourly forecast interpolated to the current minute, judged with the
  same verdict as a day's high, so "hot" means the same thing in every view (at night it
  usually says No). The detail line gives the temperature and where it goes next ("Rising to
  24° around 3pm"); the list shows the next 12 hours in 2-hour steps, so a morning visitor
  sees the afternoon.
- **This week** averages the daily highs for today and the next six days, as asked, and judges
  the average. An average can hide a short hot spell, so a week that is not hot overall names
  its hot days ("A mild week, but hot on Thu and Fri"), and each day is labelled with its band
  (Hot, Warm, Mild…). Days where fewer than 3 models reach that far are left out; without 5
  usable days there is no week answer. Today's row is Today's own answer.
- **"Now" stays current.** The API sends a day of judged hourly points with the answer, and
  the browser works "now" out again every minute and whenever the page comes back into view,
  so a cached response or a tab left open never shows an old temperature as current. The
  browser only interpolates: each point carries the band the server judged, so the apps never
  need a copy of the verdict rules. After half an hour away the page fetches afresh and
  returns to Today.
- **How the views work.** Native CSS scroll snapping in a horizontal scroller (no gesture
  library): swipe on touch screens, sideways trackpad swipes on desktops, the tabs and arrow
  keys everywhere. Pages arrive with only Today in the scroller, so the first paint is the
  approved design; Now and This week join on first use, and the scroller then takes the
  height of the view on screen, never less than Today's (so the links and ad space below stay
  put). The page sits at the top of the screen rather than centred in it: the views differ in
  height, and centred content would move up and down, tab bar included, on every switch. The page colours follow the view on screen, switching about
  two thirds of the way through a swipe with a quicker fade than an arriving answer. ARIA
  tabs pattern throughout; inactive views are `inert`, and screen readers hear the answer of
  the view they move to.
- **One request still.** `now` and `week` arrive with Today's answer, so switching views never
  waits on the network.

## Is it wet? (isitwet.today)

Carl asked for the same experience for rain, with a toggle on the page, answers from "No, dry"
to "Yes, drenched", and later bought isitwet.today so the domain decides which question loads.

- **Data.** The one forecast request gains hourly `precipitation`, so both questions come from
  the same cached forecast and switching never waits on the network. It costs 2.4 calls per
  fetch on the free tier (8 models × 3 variables), up from 1.6. Open-Meteo labels each hour's
  precipitation with the end of the hour it fell in; the parser moves it to the hour's start,
  so "rain from 2pm" means the 2pm–3pm hour. A model's day counts only with every hour (the
  forecast's very last hour excepted), so models that stop part-way through the week drop out,
  as they do for highs. Checked on live recordings: all 8 models have whole-day totals for the
  first four days, 7 after that (Météo-France stops).
- **Judging.** Each model's rain over a window is a vote: the share of models with at least the
  window's "wet" amount is the chance, and the median total is the amount. 60% or more of the
  models gives Yes (Rain, Heavy rain from 10 mm, Washout from 25 mm), 25% or more gives Maybe
  (Showers), and fewer gives No (Mostly dry when a quarter of the models have spots, else Dry).
  The day's wet amount is 1 mm (the Met Office's "wet day"); an hour's is 0.2 mm. Hourly heavy
  and drenched are 3 and 8 mm/h rather than the textbook 4 and 10 because several models are
  3- or 6-hourly upstream and Open-Meteo spreads their totals evenly. All in
  `packages/core/src/config.ts` (`RAIN`).
- **Today is the rest of the day.** "Is it wet today?" at 5pm is about what is still to come,
  not this morning's rain, so Today judges from the moment of the request to midnight, with
  the thresholds scaled to the hours left (so late in the evening Today and Now cannot
  disagree). Tomorrow and the week's later days are whole days. Because the answer changes on
  the hour, no cache keeps it past the next hour (the API, city pages and the browser all
  refresh then).
- **Now** is the current hour from a day of judged hourly points sent with the answer (the
  browser picks the hour again every minute, like the hot Now). The list shows the chance of
  rain for the next 12 hours in 2-hour blocks: the share of models with rain in each block.
- **This week** answers the literal question without saying Yes every week: Yes for a wet week
  (rain on 4 or more days), **Partly** for 1–3 rain days ("Rain on Thu and Fri."), Maybe for
  showery weeks, No otherwise. The week's total is the median of each model's own total (models
  disagree about which day it rains, so adding up daily medians would undercount), and it is
  compared with NASA POWER's normal rainfall only where both are large enough to mean anything
  (a dry climate's 0.3 mm is never "wetter than usual").
- **Snow.** Rain falling at or below 1 °C (blended temperature) counts as snow: "It'll snow.",
  "Likely to fall as snow." No extra variables are requested.
- **The toggle** sits above the tab bar (the header is full on phones). It switches all three
  views in place and keeps the view on screen; the units setting is shared (°C goes with mm,
  °F with inches). Each page opens on its own site's question, and so does a return after half
  an hour away.
- **Two domains, one deploy.** An edge function (the only way to route by host in front of
  Astro's catch-all server function) serves isitwet.today from `/wet` versions of every page,
  each with its own title, canonical URL, OG image, sitemap, icons and brand, rendered on the
  server in its own topic (no flash of the hot answer). isithot.today/wet redirects to
  isitwet.today. Place links follow the question on screen, so choosing a city while Wet is
  showing on isithot.today goes to isitwet.today. Each domain keeps its own saved place and
  units (browsers keep storage per domain).
- **Rain normals** come from their own NASA POWER request (`PRECTOTCORR`) and cache entry, so a
  problem with them can never affect the hot answer.
- **Hot changes.** The toggle adds about 2.75rem above the tab bar; model names are at full
  opacity (with the page a little longer, Cold's model list sits on a lighter part of the
  gradient); the units buttons are a little narrower so "mm" fits.
- **Needs a decision: MET Norway matters more for rain.** Outside the Nordics it is close to a
  second copy of ECMWF (see Data above), and for rain each model is a plain wet/dry vote, so
  ECMWF effectively votes twice: 2 of 8 is enough for Maybe. Dropping MET Norway outside the
  Nordics would make it 2 of 7.
- **Needs a decision: rain thresholds** (1 mm a day, 60% and 25% of models) after real use.
- OG images are drawn in °C and mm for every city, as before, so a US city's image shows mm
  while its page shows inches.

## API contract

The spec's shape is implemented exactly. Additive fields: `days[].month`, `agreementText`,
`limitedText`, `stripSummary`, `scale`, `models[].value` (one decimal, for the strip),
top-level `nearby` (4 nearest city pages), `now` and `week` (the two new views; shapes in
`packages/core/src/types.ts`), and `rain` (Is it wet?, with its own `days`, `now` and
`week`). `location` may include `slug` and `geonameId`. `days` holds today and tomorrow (never
more than two); the rest of the week is summarised in `week`.

- **Stale fallback.** If upstream fails and a cached forecast under 6 hours old exists, the
  API answers **200** with that result and `"stale": true` (cached for 60 seconds). Only
  without a usable cache does it return `503 upstream_unavailable`. A 503 carrying data tends
  to be treated as a failure by generic HTTP clients, which the apps would rather avoid.
- **Units default.** °F for US visitors (and US territories plus the few other countries that
  use °F day to day; the list is in `config.ts`). City pages render in the city's country's
  default, and the visitor's own °C/°F choice then applies in the browser.
- **CDN caching.** Responses that depend on the visitor (no coordinates, or no explicit
  `units`) are browser-cache only, so the CDN never serves one visitor's location or units to
  another. The website always sends explicit units after the first answer.

## Design

- **Header controls and the tab bar sit on a pill.** They sit on the bright top-right glow, so
  they get a backing in each band's `pill` colour (the gradient colour with the most contrast
  against the text) at 85%.
- **Every text meets WCAG 2.2 AA in every band and view** (Carl's go-ahead, October 2026).
  `e2e/contrast.spec.ts` measures it on rendered pages for all six bands, all three views, on
  phone and desktop, and fails CI below 4.5:1 (3:1 for large text). What changed from the
  approved prototype (`reference/prototype.html` is updated to match):
  - Hot is darker: `#cc3d17` to `#a51c17`, with a deeper glow (`#ff9a4a`). The old `#e8571f`
    is only 3.6:1 against white before the glow is added.
  - The glow strength is set per band: Freezing 60%, Cold 45%, Hot 40%, Scorching 70%, Mild
    and Warm unchanged at 85% (their dark text is fine on it).
  - The question is no longer faded, and small secondary text (model names, agreement line,
    scale, credit) is faded less.
  - Models outside the agreement band show a lighter figure instead of faded text, and the
    search sheet sits on the band's `pill` colour.
  - With text enlarged to 200% on a 360px phone nothing is cut off: the header controls
    wrap, the tab labels shrink to fit, and the week rows drop their dot track.
  - The gradient and glow moved to a fixed layer: iOS Safari ignores
    `background-attachment: fixed` and stretched the glow over the whole page, so iPhones
    looked worse than the measurements.
- **City list.** 150 UK places by population (London boroughs folded into London) plus a few
  added for coverage (Inverness, Fort William, Truro, Penzance, St Andrews and others). 150
  worldwide by population, capped at 8 per country, plus European capitals and popular holiday
  spots for UK visitors (Málaga, Tenerife, Palma, Faro, Dubai, Orlando and others). Edit the
  lists in `scripts/build-cities.mjs` and run `pnpm cities`. **Needs a decision**: the spec
  leaves the UK list open.

## Performance

Measured by the deploy-preview workflow (Lighthouse 12, mobile, simulated slow 4G), with
Netlify's review toolbar left out (it is added to deploy previews only, and its long task
alone pushed the simulated home LCP past 5 s). SEO shows 66 on previews only because Netlify
marks them `noindex`; the live site scores 100.

| Page            | Performance | Accessibility | Best practices | LCP   | CLS   |
| --------------- | ----------- | ------------- | -------------- | ----- | ----- |
| `/`             | 100         | 100           | 100            | 1.1 s | 0.004 |
| `/in/london-gb` | 100         | 100           | 100            | 1.5 s | 0     |

The workflow also measures https://isithot.today on every run, for comparison.

Site JS is about 16 KB gzipped (budget 25 KB, checked in CI by `scripts/js-budget.mjs`; it
was 8 KB before Now and This week, and 12 KB before Is it wet?). The rain day and week judging
runs only on the server; the browser carries the code that keeps rain's "now" current. Cached API responses come back from the
Netlify CDN in 10–40 ms. LCP sits just above the 1.5 s target under Lighthouse's simulated
Moto G on slow 4G. Things that got it there:

- A 7.6 KB static cut of Bricolage at the answer's weight is inlined in the page, so the
  answer word paints in its final font straight away. The full variable font (77 KB) loads
  for everything else.
- Fallback fonts are sized to Bricolage's widths (Arial, Roboto, DejaVu), line height is
  explicit, and the detail line has a fixed width, so the font swap does not move text.
- The home page starts its API request from an inline script in `<head>`, before the main
  script has loaded.

Possible next step if LCP needs to drop further: render the home page's answer on the server
from the visitor's approximate location.

## Open decisions carried over from the spec

- Evening behaviour after 8pm (keep today, or switch to "Tomorrow?"). The API already returns
  tomorrow in `days[1]`, and the Now view now covers the evening.
- NASA POWER terms for an ad-supported site.
- Tuning α and the band edges after real use (all in `packages/core/src/config.ts`).
- Remove-ads model. The `AdSlot` component takes an `adsDisabled` flag for it.
