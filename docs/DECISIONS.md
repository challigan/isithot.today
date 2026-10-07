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
- **Hourly apparent temperature is not requested.** Nothing uses it, and every variable counts
  against the Open-Meteo quota for each of the 8 models.
- **Normal daily highs come from NASA POWER's `T2M + T2M_RANGE / 2`, not `T2M_MAX`.**
  Checked against live responses: in the climatology endpoint `T2M_MAX` is the highest
  temperature of the period, and `T2M_MAX_AVG` is the average _hottest day_ of each month.
  Both put London's January normal at 11–12°C and its July normal at 29°C (the real normal
  daily highs are about 8°C and 24°C). The monthly mean temperature plus half the average daily
  range is the standard estimate of the mean daily high.
- **Climate cells follow NASA's grid.** NASA POWER serves MERRA-2 data on 0.5° × 0.625°
  cells. Rounding to 0.5° both ways put Newcastle in a cell that is mostly North Sea (January
  normal 10°C), so lookups snap to the real cell centres instead.
- **Reverse geocoding is offline.** Open-Meteo has no reverse geocoding, so a rounded device
  location is named from a bundled GeoNames list (towns over 5,000 people, or over 1,000 in the
  UK and Ireland). A city page within 6 km wins, because 0.05° rounding can move central
  Newcastle into Gateshead.
- **Search puts our city pages first.** Open-Meteo returns Newcastle, Australia for
  "Newcastle", but not Newcastle upon Tyne.

## API contract

The spec's shape is implemented exactly. Additive fields: `days[].month`, `agreementText`,
`limitedText`, `stripSummary`, `scale`, `models[].value` (one decimal, for the strip), and
top-level `nearby` (4 nearest city pages). `location` may include `slug` and `geonameId`.

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

- **Header controls sit on a soft pill.** The place name and °C/°F toggle sit on the bright
  top-right glow, so they get a translucent backing. This is the one visible change to the
  approved layout.
- **Needs a decision: Hot-band contrast.** Measured on rendered pages (background sampled
  behind each piece of text), white text on the Hot band falls below WCAG AA on phones:
  about 2.3:1 for the answer and 2.7:1 for the detail line, against targets of 3:1 and 4.5:1.
  The yellow glow sits behind the text, and `#e8571f` with white is only 3.6:1 even without
  it. Cold and Freezing detail text also dips below 4.5:1 where the glow reaches it on phones.
  The palette is unchanged because it is the approved design. A close option that clears 3:1
  for the answer:
  `hot: { g1: '#d4421a', g2: '#b3211b', g3: '#ffb44f' }`, with the glow at 55% strength
  fading by 44%. Clearing 4.5:1 for small text on Hot needs a darker orange still.
  `scripts/contrast-report.mjs` re-measures any palette change.
- **City list.** 150 UK places by population (London boroughs folded into London) plus a few
  added for coverage (Inverness, Fort William, Truro, Penzance, St Andrews and others). 150
  worldwide by population, capped at 8 per country, plus European capitals and popular holiday
  spots for UK visitors (Málaga, Tenerife, Palma, Faro, Dubai, Orlando and others). Edit the
  lists in `scripts/build-cities.mjs` and run `pnpm cities`. **Needs a decision**: the spec
  leaves the UK list open.

## Performance

Measured by the deploy-preview workflow (Lighthouse 12, mobile, simulated slow 4G) on
`deploy-preview-1`. SEO shows 66 there only because Netlify marks deploy previews `noindex`.

| Page            | Performance | Accessibility | LCP   | CLS   | Notes                       |
| --------------- | ----------- | ------------- | ----- | ----- | --------------------------- |
| `/`             | 97          | 100           | 1.7 s | 0.008 | answer fetched from the API |
| `/in/london-gb` | 100 (local) | 100           | 1.8 s | 0     | server-rendered, CDN-cached |

Site JS is about 8 KB gzipped (budget 25 KB). Cached API responses come back from the
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
  tomorrow in `days[1]`.
- NASA POWER terms for an ad-supported site.
- Tuning α and the band edges after real use (all in `packages/core/src/config.ts`).
- Remove-ads model. The `AdSlot` component takes an `adsDisabled` flag for it.
