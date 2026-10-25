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
- **A slow forecast gets a second request after 2 seconds, inside the same 6-second budget.**
  The deploy-preview smoke test failed twice on 8 October (06:34 and 21:34 UTC) with 503s after
  6.2 s: the forecast request had timed out at 6 s. Open-Meteo itself was failing at the time,
  not the route from Netlify. In the same jobs the fixture recorder's identical request from the
  GitHub runner hung for 32 s and then 49 s, and got HTTP 200 with the plain text
  `Unexpected error while streaming data: timeoutReached` (Open-Meteo's servers read model data
  from their own storage with a 30-second deadline and, once the 200 has gone out, write any
  error into the body). Each episode lasted one to two minutes (in the morning one, a city page
  fetched seconds after the last failure answered in 2 s). Normal answers take 0.2–1.5 s. Previews meet this more than production
  because every new preview starts with an empty cache (a deploy-scoped Blobs store), so its
  first requests always go to Open-Meteo.
  - The budget: Netlify stops a synchronous function after 30 s (10 s on older accounts). That
    covers the API functions and Astro's SSR function (city pages and OG images); none
    overrides it. The forecast keeps its 6 s, so a stale answer or a 503 comes no later than
    before. The cache read before it now counts as a miss after 1.5 s (the Netlify Blobs
    client retries a failed read up to five times, 5 s apart), so an answer takes at most
    about 7.5 s, inside even the old limit. NASA POWER runs alongside and is waited for 2 s.
  - Within it, if the first request has not answered after 2 s, or fails sooner with anything
    but a 4xx, an identical second request starts and the first success wins (the other is
    cancelled). A 4xx (bad request, bad key, rate limited) is not retried, with one exception:
    Open-Meteo's free API answers 429 "Too many concurrent requests" when too many requests
    from one address are in flight, which Netlify's shared function addresses can hit (seen on
    the #6 preview). That clears in moments, so it gets one more try after 1 s. A paid
    Open-Meteo key would avoid sharing those limits (see SETUP.md). The 6 s now covers
    reading the body too: before, a server that sent its headers and then stalled held the
    function until it gave up (32 s in the simulation below). The second request costs another
    fetch's calls (2.4 then, 3.2 since Will it snow?), only when the first is slow or broken.
  - Simulated with a fake fetch (old code, then new): one stuck request then normal ones, 503
    at 6.0 s, now 200 at 2.35 s; Open-Meteo's text error after 1 s then normal, 503 at 1.0 s,
    now 200 at 1.35 s; headers at once and the body stalled for 32 s, 503 at 32 s, now 200 at
    2.35 s; every request stalled, 503 at 6.0 s either way.
  - Not chosen: a longer timeout (Open-Meteo's stalls run 30 s or more, so waiting longer only
    delays the stale answer or the 503); two parallel requests of 4 models (the same quota, but
    both halves read the same storage, so a stall would usually hit both, and half a forecast
    would need rules for partial answers, a new cache version and re-recorded fixtures);
    answering from a stale copy sooner (faster, but no fewer 503s).
  - What it cannot fix: an Open-Meteo outage longer than 6 s with nothing usable cached (a new
    preview, or a place nobody has asked about for 6 hours) still answers 503. It now says why,
    so it can be told apart from a fault of ours: the function log reads
    `forecast unavailable for forecast/v3/54.95,-1.60 after 6002ms: open-meteo: timed out after 6000ms (2 attempts); no usable cached copy, answering 503`
    (or `answering with the copy from <time>`), a slow success logs
    `forecast for … took 2030ms`, the 503 body carries the reason in `error.detail` (timeout,
    `HTTP <status>` with Open-Meteo's reason, a network error and its cause, or the start of a
    body that is not JSON, with any API key masked), and `scripts/smoke.mjs` prints it.
- **Closed: MET Norway counted ECMWF twice outside Scandinavia.** Open-Meteo's
  `metno_seamless` is MET Nordic over Norway, Sweden, Finland and Denmark, and ECMWF's 9 km
  model everywhere else (and after 2.5 days everywhere). For UK visitors it was close to a
  second copy of ECMWF, so "8 forecasts agree" overstated the independent forecasts by one.
  Carl dropped it with the wind topic (see "Six models").
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

Carl asked for two more views either side of Today, on one page that opens on Today (on Now in
the evening since round 2: see "Tomorrow after 6pm"), with a tab bar at the top on every screen
and swiping on phones.

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
  returns to the view it opens on (Today, or Now in the evening).
- **How the views work.** Native CSS scroll snapping in a horizontal scroller (no gesture
  library): swipe on touch screens, sideways trackpad swipes on desktops, the tabs and arrow
  keys everywhere. Pages arrive with only the start view in the scroller (Today, or Now in the
  evening), so the first paint is the approved design; the other views join on first use, and
  the scroller then takes the height of the view on screen, never less than Today's (so the
  links and ad space below stay put). The page sits at the top of the screen rather than
  centred in it: the views differ in height, and centred content would move up and down, tab
  bar included, on every switch. The page colours follow the view on screen, switching about
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
  the thresholds scaled to the hours left (never less than one hour's). While the current hour
  is wet (Now says Maybe or Yes), Today counts that hour in full and follows the same rule as
  Now, so the two never contradict each other (see "Fixes after the round 2 review").
  Tomorrow and the week's later days are whole days. Because the answer changes on the hour,
  no cache keeps it past the next hour, stale copies included (the API, city pages, the wet
  OG image and the browser all refresh then).
- **Now** is the current hour from a day of judged hourly points sent with the answer (the
  browser picks the hour again every minute, like the hot Now). The list shows the chance of
  rain for the next 12 hours in 2-hour blocks: the share of models with rain in each block.
- **This week** answers the literal question without saying Yes every week: Yes for a wet week
  (rain on 4 or more days), **Partly** for 1–3 rain days ("Rain on Thu and Fri."), Maybe for
  showery weeks, No otherwise. The week's total is the median of each model's own total (models
  disagree about which day it rains, so adding up daily medians would undercount), and it is
  compared with NASA POWER's normal rainfall only where both are large enough to mean anything
  (a dry climate's 0.3 mm is never "wetter than usual").
- **Snow.** Rain falling at or below 1 °C (blended temperature) counted as snow: "It'll snow.",
  "Likely to fall as snow." Since Will it snow?, the share that falls as snow comes from the rule
  both topics share (below), and 1 °C is only the fallback for a model without snowfall.
- **The toggle** sits above the tab bar from 640px up, and at the bottom of the screen on
  phones (round 2, below). It switches all three views in place and keeps the view on screen;
  the units setting is shared (°C goes with mm, °F with inches). The header's site name, the
  home page's tab title and the tab icon follow it. Each page opens on its own site's question,
  and so does a return after half an hour away.
- **Two domains, one deploy.** An edge function (the only way to route by host in front of
  Astro's catch-all server function) serves isitwet.today from `/wet` versions of every page,
  each with its own title, canonical URL, OG image, sitemap, icons and brand, rendered on the
  server in its own topic (no flash of the hot answer). isithot.today/wet redirects to
  isitwet.today. Place links follow the question on screen, so choosing a city while Wet is
  showing on isithot.today goes to isitwet.today. Each domain keeps its own storage (and its
  own location permission), so links that cross domains carry the chosen units in the address,
  "Use my location" and searched places carry the place too, and the page there stores them
  (F8 in round 2, below).
- **Rain normals** come from their own NASA POWER request (`PRECTOTCORR`) and cache entry, so a
  problem with them can never affect the hot answer.
- **Hot changes.** From 640px up the toggle adds about 2.75rem above the tab bar; model names
  are at full opacity (with the page a little longer, Cold's model list sits on a lighter part
  of the gradient); the units buttons are a little narrower so "mm" fits.
- **Closed: MET Norway mattered more for rain.** Outside the Nordics it was close to a second
  copy of ECMWF (see Data above), and for rain each model is a plain wet/dry vote, so ECMWF
  effectively voted twice. It is gone (see "Six models"): Maybe is now 2 of 6 independent
  forecasts.
- **Needs a decision: rain thresholds** (1 mm a day, 60% and 25% of models) after real use.
- OG images are drawn in °C and mm for every city, as before, so a US city's image shows mm
  while its page shows inches.

## Tomorrow after 6pm

Carl asked for the evening to look ahead: before 6pm the page opens on Today; from 6pm the
middle tab reads Tomorrow with tomorrow's forecast and the page opens on Now; after midnight it
is Today again. This settles the spec's open question about the evening.

- **Local time at the place**, not the visitor's. Core's `showsTomorrow` compares the hour in
  the answer's time zone with `TOMORROW_FROM_HOUR` (18, in `config.ts`). It also needs the
  answer to be for the place's current date and to include tomorrow (`days[1]`); otherwise the
  middle tab stays Today, so there is never an empty Tomorrow. `defaultView` gives Now while it
  holds, else Today.
- **Only the middle slot changes.** The view ids stay `now | today | week`; the tab label, the
  question ("Will it be hot in Leeds tomorrow?") and the content change (hot `days[1]`, wet
  `rain.days[1]`, a whole day). Today's answer stays the page's only `h1` in the markup; when
  the page opens on Now, Now's answer takes the heading level, as it does when a visitor
  switches.
- **Nobody is moved.** The page opens on its view for the time of day once the place is known,
  unless the visitor has already changed view. After that, refetches and the minute tick only
  relabel: at 6pm an open Today becomes Tomorrow where it is, and at midnight Tomorrow becomes
  Today again with the usual midnight refetch. A return after half an hour away goes to the
  view for the time (Now in the evening). The preview (`?preview=1`) always shows Today.
- **City pages** are rendered on the server in the evening state (Now open, Tomorrow in the
  middle, Now's colours). Their cache ends at the next hour (F7 below), so a page made at 5pm
  is not served after 6. If the browser's clock still disagrees with the page (one made at
  5:59, say), the browser corrects the label and content, and the start view if the visitor
  has not moved.
- **Titles stay about today.** The home and city tab titles, the city `<title>`, description
  and OG image keep asking today's question: it is the search-facing question, and titles did
  not change per view before either.
- **The saved answer** (the home page's instant paint) is saved as the page opens for its slot:
  Today alone, or in the evening Now alone with the middle tab reading Tomorrow. It records the
  place's time zone, the slot and the date it is for, and the inline restore script paints it
  only while the place's date and slot still match. So a snapshot from 5pm never paints at 7pm.
  Older snapshots are skipped (`CACHE.snapshotVersion` went from 4 to 5).
- **Wording.** Tomorrow's hot verdict is in the future tense ("It'll be hot."), set by the
  server in `days[1]`; every other string on a hot day already read correctly for tomorrow.
  Rain's `days[1]` was already a whole-day, future-tense answer; a sweep of every synthetic
  city found none of its lines saying "still to come", "rest of the day" or "Easing off".

## Brand, toggle and place picker (round 2)

- **The brand follows the toggle.** The header's site name and link show the site of the
  question on screen: on isithot.today with Wet showing it reads isitwet.today and links there
  (on previews and locally, to `/wet`). The home page's tab title names that site too, and so
  do the tab icons (on the real domains each serves its own icons at the root; elsewhere the wet
  ones are under `/wet`). The manifest and apple-touch-icon stay the page's own. The server
  still renders the page's own site, the snapshot is only saved while the page's own question
  is on screen, and the half-hour return switches back, so a restored page never shows the
  wrong brand.
- **The toggle is at the bottom on phones.** Below 640px it floats at the bottom centre of the
  screen, in thumb reach, above the home indicator, on a solid pill (the band's `pill` colour,
  a hairline and a shadow). Its text measures 7.6:1 or more in all 12 bands. The page has room
  under the footer so nothing ends up behind the pill, and the tab bar moves up under the
  header. It is still first in `<main>`, so the reading and focus order is the question, then
  the period; there is one control, and it does not hide on scroll. At 320px with text at 200%
  it fits without sideways scrolling. From 640px up it sits above the tab bar as before.
- **The place picker is full screen on phones.** This fixes the keyboard bug Carl reported. The
  picker was a sheet at the bottom of the screen. On iOS the keyboard covers the page rather
  than shrinking it, so the sheet sat behind the keyboard and most of what showed was the
  dimmed backdrop; the tap that hid the keyboard landed on the backdrop, which closed the
  picker (the typed text stayed, as the picker was only closed). Android Chrome covered it the
  same way. Now, below 640px, the picker fills the screen: a header row with Close, the search
  box under it (at the top, where a keyboard can never cover it), then the results, which
  scroll on their own with room at the bottom to lift the last result above the keyboard.
  There is no backdrop to tap: only Close, Escape or the back gesture, a choice, or "Use my
  location" close it. The viewport asks Android to resize the page for the keyboard
  (`interactive-widget=resizes-content`). The page behind does not scroll, Enter (Search on
  the keyboard) picks the first result, reopening shows the last search with its text selected
  (typing replaces it), focus returns to the place button, and Close is at least 44 × 44 px on
  touch screens. From 640px up it stays a centred card that a click outside closes. Checked in
  emulated phones, including a keyboard-sized resize; not yet on a real iPhone or Android
  phone.
- **Room for saved places.** The picker's body is in sections ("Use my location", then the
  results), so a saved list can go between them later. Nothing is built for it on the web; the
  iPhone app has one (see "Saved places (the iPhone app)").

## Fixes after the round 2 review

**Rain wording.** A sweep over every synthetic city (3 dates, every hour at :07 and :52, both
units: 86,400 answers) and the two live recordings (1,128) counted each problem before and
after:

| Problem                                                                 | Before | After |
| ----------------------------------------------------------------------- | ------ | ----- |
| Week: "most on Saturday (7mm)" above the week's total of 6mm (F1)       | 76     | 0     |
| Day's last minutes: "All forecasts say 0mm; 2 of 8 expect rain" (F2)    | 60     | 0     |
| Day's last minutes: "Some forecasts say up to 0mm" (F2)                 | 29     | 0     |
| Now: "Dry for the next 12 hours" above a 30% row (F3)                   | 2,300  | 0     |
| Now: "Showers possible now. Showers possible from about…" (F3)          | 2,580  | 0     |
| "Light rain now" in mm but "Rain now" in inches (F5)                    | 424    | 0     |
| Now says it is raining, Today does not say Yes (F6)                     | 2,102  | 0     |
| Now says showers, Today says No (F6)                                    | 2,530  | 0     |
| Now says showers or rain, Today says "Dry for the rest of the day" (F6) | 928    | 0     |
| Today says "Easing off" while Now says it is not raining (F6)           | 1,276  | 0     |
| Today and Now name different "Easing off by about" hours (F6)           | 7,074  | 0     |

- **F1, the week's wettest day.** The week's total is the median of each model's own week,
  from the models that cover every day, but the wettest day's amount used every model. The
  wettest day and its amount now come from the same models as the total, so "most on …" can
  never exceed it.
- **F2, the day's last minutes.** Today's window counted the current hour by the minutes left,
  so at 11:52pm its thresholds were close to nothing. Now they never go below one hour's.
- **F3, Now's next 12 hours.** With showers now it says "Rain likely from about …" if rain
  follows, else "Dry from about …", else "On and off for the next 12 hours"; it never announces
  showers that are already falling. "Dry for the next 12 hours" only when no row under it has a
  quarter of the forecasts or more (shown as 30% or more); otherwise it names the first such
  hour.
- **F4.** "A wet week, heaviest on …" names the heaviest of the heavy or washout days, never a
  lighter one.
- **F5.** Whether rain is light is decided in millimetres before rounding and sent with each
  hourly point (`light`), so the words are the same in either unit.
- **F6, Today and Now agree.** One rule, from the same judgement of each hour: while the
  current hour is judged showers or wetter (Now says Maybe or Yes), Today counts that hour in
  full, as Now does, and a forecast counts as expecting rain from an hour's wet amount
  (0.2 mm). Today is then never drier than Now: raining now gives Yes, showers now at least
  Maybe. While it rains, Today names the same easing hour as Now (the first later hour judged
  spots or drier) and adds "Rain likely from about …" if rain comes back later today. Two other
  rules were measured and dropped. Counting the hour in full only while it rains (not for
  showers) still gave 2,582 "Now showers, Today No" and 922 "Dry for the rest of the day" under
  "Showers possible now". Counting any forecast with rain in the current hour as expecting rain
  put forecasts below the strip's wet zone among those expecting rain in 11,633 answers, and
  said "All forecasts say 0mm; 1 of 8 expects rain" 607 times. All that remains in the sweep is
  228 answers where Now says "Set to last the next 12 hours" and Today names an easing hour more
  than 12 hours ahead, which agree. The cost: while it is wet now, "still to come" includes all
  of the current hour (forecasts give rain by the hour, not the minute).

**Other fixes.**

- **F7, no stale copies past the hour.** The CDN could serve an answer for as long again as
  its max-age while fetching a new one (stale-while-revalidate), so today's rain answer could
  outlive its hour. Max-age plus stale-while-revalidate now ends by the next forecast hour for
  the API, city pages and the wet OG image (which also gained the next-hour cap). Max-age keeps
  its one-minute floor.
- **F8, crossing domains carries the place and units in the address.** In production,
  switching sites lost the device location, the saved place and °F/inches, because each domain
  has its own storage and location permission. Links that cross domains now carry them: a
  device location as `lat`, `lon` and `source=device`, a searched place as `lat`, `lon` and
  `name`, and the visitor's chosen units as `units=c|f` (°C too: a US visitor who picked °C
  would otherwise get the US default, °F). The page there stores them, then takes the units and
  the device location out of the address (a searched place keeps its shareable address). The
  brand, Nearby and city-page links carry only the units, so a place remembered on one site (a
  city chosen there, say) is not carried to the other site's home page.
- **F9, a fast clock.** A device clock running ahead made today's rain answer look out of date
  before the server had a newer hour, so the page asked again every few minutes (for good if
  an hour or more fast). When a fresh answer is already out of date by the device's clock, it
  now counts as current for as long as the server had left of its hour. With a clock 70
  minutes fast: 11 requests in an hour before, 3 after, then one per server hour. The same
  rule covers midnight: a clock already past the place's midnight while the server is not used
  to ask for the new day every few minutes until the server got there; it now waits for as long
  as the server had left of its day.
- **F10, the early request.** A saved answer from an earlier hour asks past the caches, and
  that used to throw away the request the page's `<head>` had already started: two requests.
  It now uses the early one, and asks again only if that answer is itself out of date.
- **F11.** The smoke test's "query string kept through the rewrite" check passed whether or
  not the query arrived (the page is static), so the claim is gone. `route()`'s unit tests and
  the production check of the isithot.today/wet redirect cover it.
- **F12, long answers.** "Maybe.", "Partly." and "Almost." were cut off on phones with larger
  text. Answers longer than four characters are now also held to the page's width; "Yes.",
  "No." and every answer at the usual text size are unchanged.
- **F13.** The showers icon was redrawn so its rain falls from under the cloud's right-hand
  end, clear of "Maybe." and "Partly." from 320px to 1280px at 100–200% text.
- **F14.** A wet city page's title says "Snow" (or "Heavy snow") when the day's rain mostly
  falls as snow, as the page does.

## Will it snow? (willitsnow.today)

Carl bought willitsnow.today to make the app worth opening in winter: the same one-pager for
snow (Now, Today or Tomorrow, This week), with its own palettes, gradients and icons, and
answers from "No." to "Yes." across six bands. willitsnow.today opens on the snow question, and
the toggle reads Hot | Wet | Snow on all three sites.

- **Data.** The one forecast request gains hourly `snowfall` (cm in the hour before the time
  given, at Open-Meteo's 7 cm of snow for 10 mm of water). That is 8 models × 4 variables, so
  3.2 calls per fetch, up from 2.4; three topics still share one cached forecast, and switching
  never waits on the network. `FORECAST_CACHE_VERSION` went from 3 to 4 and the request line
  changed, so CI's preview smoke re-records the fixtures. Snowfall is moved to the hour's start
  as precipitation is, and a model's day counts only with every hour, as rain's does. Older
  recordings without `snowfall` still parse (the fallback below).
- **One rule for Wet and Snow** (`snowWater`, `packages/core/src/snow.ts`) decides how much of
  each model's hour falls as snow:
  - None when the blended temperature is above +2.5 °C, whatever the model says (several
    models judge snow for a grid cell higher than the place).
  - Otherwise the model's snowfall, as water, never more than its precipitation (no snow out of
    a dry hour).
  - A model without `snowfall`: all its precipitation at or below 1 °C (`RAIN.snowAtOrBelowC`).
    The spec's data section said 0 °C here and its wet section kept `RAIN.snowAtOrBelowC`; 1 °C
    matches the research and leaves wet's answers unchanged where snowfall is missing. There is
    no cold floor (rain at -1 °C counted as snow); the spec left it out.
  - Wet's "It'll snow." now comes from this rule, so a snowy day reads the same on both sites.
    `rain.now.series[].snow` keeps its meaning (blended temperature at or below 1 °C); the new
    `asSnow` flag carries the shared rule and the Now view reads it when present.
- **Bands and thresholds** (`SNOW` in `config.ts`, in cm). The keys `nosnow`, `flakes`,
  `maybesnow`, `snow`, `heavysnow` and `deepsnow` differ from every hot and rain key, since
  palettes, icons and preview chips are looked up by band alone (a test checks all 18). A whole
  day: a few flakes from 0.1 cm, snow from 0.5 cm (0.2 in), heavy from 5 cm (2 in), deep from
  15 cm (6 in). An hour: 0.1, 0.8 and 2 cm for snow, heavy and deep; the spec gave no hourly
  "few flakes", so it is 0.07 cm (0.1 mm of water, Open-Meteo's smallest step). Votes work as
  rain's: 60% of models or more gives Yes (banded by the median), 25% Maybe (Snow possible),
  some flakes in a few models "A few flakes", else No snow. The rest of today scales like
  rain's, with the same one-hour floor and the same rule that Today is never less snowy than
  Now.
- **A No says why.** "Too warm for snow." when every model's lowest temperature stays above
  +2.5 °C (so it is never said while any model shows snow), "Rain, not snow." when the wet
  answer for the same window is Showers or wetter, otherwise "It won't snow.". The detail gives
  the low ("No lower than 9° all day." above +2.5 °C, "Down to -4° at the coldest." below) and
  the climate line. Titles and week rows name the reason ("No. Too warm"), never "No. No
  snow"; "No snow" is only the preview chip.
- **This week** is Yes when any day has snow ("Snow on Thu and Fri, heavy on Fri."), "A snowy
  week." from 4 such days, Maybe when snow is possible on any day, otherwise No. As for rain,
  the total is the median of each model's own sum.
- **Words.** "Will it snow today?", "Will it snow tomorrow?", "Is it snowing right now?", "Will
  it snow this week?", "Will it snow in Oslo today?". No "blizzard" (that needs wind, which
  would cost another 0.8 calls per fetch) and no "sleet" or freezing rain (the request cannot
  tell them apart from rain or snow). Amounts in sentences:
  under 0.5 cm is "a dusting"; whole centimetres up to 10, then the nearest 5; inches to the
  nearest half up to 3, then whole; a range comes from the middle forecasts ("2 to 5cm"). One
  units setting serves all topics: °C goes with cm, °F with inches, labelled "Snow units".
- **Snow normals** come from NASA POWER's `PRECSNOLAND` (snowfall as water, mm a day, by month)
  in a request and cache entry of their own (`climate-snow/v1/<cell>`, through the same
  `loadMonthly` as the others), so they never hold up the hot or wet answer; while any normal is
  still loading the answer is cached only briefly. A month with under 0.01 cm of snow a day is
  "Snow is rare here in October.", from 0.2 cm "Snow is common here in January.". The week is
  compared with normal only when the forecast or the normal is at least 1 cm ("more" at 1.5×
  and 1 cm more, "less" at half and 1 cm less), so a place where snow is rare never gets "More
  snow than usual" for a dusting.
- **Height guard.** Snow depends on height far more than rain, and POWER's cell is about 50 km
  across. Both heights were already in the responses (the forecast echoes the place's
  `elevation`; POWER gives the cell's mean height), so the normals are used only when the two
  are within 300 m, and when either is unknown.
- **Next data improvement: pass the place's height.** Done since; see "UV index and place
  height" below.
- **Three domains, one deploy.** The edge function's routing (`netlify/edge-functions/lib/route.ts`)
  is now one table of host, prefix and test header per site:
  - willitsnow.today is served from `/snow`, and www.willitsnow.today redirects to it (as
    www.isitwet.today does to isitwet.today).
  - On any real host, a path under another site's prefix redirects to that site, without the
    prefix and with the query: isithot.today/snow and isitwet.today/snow go to willitsnow.today,
    willitsnow.today/wet to isitwet.today. One behaviour changed: isitwet.today/snow/x used to
    be a wet 404 and now goes to willitsnow.today/x.
  - `x-willitsnow-host: 1` makes a deploy preview act as willitsnow.today, like
    `x-isitwet-host`, never in production. A real host wins over either header; with both sent
    to a preview, the first in table order (wet) wins.
  - Place links, units and "Use my location" cross to and from willitsnow.today in the address,
    as between the first two sites.
- **Pages and the toggle.** `/snow` mirrors `/wet`: home, city pages, About, Privacy, Cookies,
  Terms, 404, OG images, sitemap, robots and icons (`public/snow`, from `scripts/make-icons.mjs`),
  each server-rendered in Snow. About explains how snow is judged. The toggle's icons give way
  at narrow container widths so three labelled buttons fit the phone pill at 320px with 200%
  text (Hot 73, Wet 77, Snow 96 px). Snowflakes drift down twice (4 s at most), and not at all
  with reduced motion. The snow site keeps its last answer under `willitsnow:last`, which, like
  wet's, holds only until the next forecast hour; `CACHE.snapshotVersion` went from 5 to 6 for
  the three-button markup.
- **Synthetic data** (offline development and e2e): places at 64° or more (Reykjavík is the
  only city page there) stay below freezing all year, so the tests can show snow in any month,
  and beyond 45° about half the days of local winter are 7 °C colder. The committed
  `nasa-power-snow-*.json` fixtures are synthetic stand-ins until CI's next recording.
- **Size.** The browser keeps snow's "now" current with rain's own code (made generic over the
  point type); snow's day and week judging runs only on the server and in the on-demand
  preview. The app chunk went from 17.3 to 20.0 KB gzipped (budget 25.6 KB): the three-topic
  client, and snow's day and week strings, which reach it through the preview's imports as
  rain's already do (about 0.5 KB). If the budget gets tight, those strings can move to a
  module only the server and the preview import.

## UV index and place height

Carl: "Do the elevation thing. I would also like to include the UV index on the hot page with a
little bit saying whether its high medium or low", then "Include very high and extreme".

### Place height

- **Why.** Points are rounded to 0.05°, and Open-Meteo forecasts for the terrain height at the
  rounded point, which in hills and mountains can be hundreds of metres from the town's (about
  0.65 °C per 100 m, and for most models enough to remove snow from a valley town or rain from a
  hill town). Passing the place's own height makes Open-Meteo correct the temperature for it.
- **When the height is known.** A searched place: the geocoder's `elevation` goes through
  `SearchResult.elevation` and back as `elevation=` on `/api/v1/today` with `source=search`; a
  searched place without one that is a city page takes the city's. A city page: `City.elevation`
  in `data/cities.json`, and the IP fallback (an answer for that city) takes it too. Device and
  IP locations have no known height and keep Open-Meteo's default (no parameter); a device
  request's `elevation` is ignored.
- **City heights** come from GeoNames (`elevation`, else `dem`, the terrain model's height; CC
  BY 4.0), recorded in `data/cities.json` by `scripts/city-heights.mjs` and never fetched at
  runtime. Run it again after `pnpm cities` changes the list (which keeps recorded heights).
- **In the browser** a searched place's height stays with it: in the remembered place, and in
  the page's address (`/?lat=…&lon=…&name=…&country=…&elevation=…`), so a reload, a shared link
  and the head script's early request all ask for the same forecast. Places remembered before
  this have no height and work as before.
- **Validation.** Whole metres from -500 to 9,000 (the Dead Sea shore is about -430, Everest
  8,849); anything else, or anything that is not a plain number, is ignored as if absent
  (`parseElevation` in core).
- **Cache.** The forecast is fetched and cached for the height to the nearest 50 m (about
  0.3 °C), so the key is `forecast/v5/<cell>/<height>`, or `/dem` without one; the request
  sends the rounded height, so everyone in a band shares one forecast. Places in one cell at
  much the same height share it; one 300 m up the valley does not. `FORECAST_CACHE_VERSION` went
  from 4 to 5 (also for the UV index). Search results are cached under `search/v3/` so cached
  results gain heights at once.
- **Quota.** A cell now holds one forecast per height asked for in it, each cached for an hour
  as before. Device and IP locations all share `/dem`, while a city page or searched place uses
  its 50 m band, so a cell visited both ways holds two forecasts even on flat ground (London's
  city page is `/50`, a device in the same cell `/dem`): up to twice the calls such a cell cost
  before. In hills, places in one cell at different heights add a forecast per extra band.
- **Snow normals' height guard** now compares the climate cell's height with the place's own
  height when known, else with the height the forecast is for.
- **Response.** `location.elevation` (whole metres) when the height is known.

### UV index (hot topic)

- **Source.** Of the eight models, only GFS (worldwide, for the whole forecast) and UKMO (its UK
  2 km domain only, about the first 54 hours, so near the UK only) give their own hourly
  `uv_index` (Open-Meteo's source, `Sources/App`: `GfsVariable`, `UkmoVariable`; the global UKMO
  model has none). Five answer nulls, but MET Norway's seamless model answers GFS's values,
  hour for hour (seen in the live recordings: Open-Meteo fills a variable a model lacks from
  another), so the parser drops any series that is an exact copy of an earlier model's
  (`withoutCopies`); counted twice, GFS would always outvote UKMO in the median. Both are the
  average over the hour before each stamp, as radiation is (the recorded peaks sit about half
  an hour after solar noon), so the parser moves them to the hour's start as it does
  precipitation.
- **Request.** `uv_index` is added to the one forecast request: 8 models × 5 variables, 4.0 calls
  a fetch, up from 3.2. Open-Meteo charges `max(1, variables × models / 10)` calls per request
  (`calculateQueryWeight` in its source), so a separate UV request for one or two models would
  cost a whole call against 0.8 here, and add a second request, cache entry and failure mode.
  The free API's 10,000 calls a day still allow about 100 places checked around the clock.
- **Judging.** Each hour's UV index is the median of the models that give one. A day's is its
  highest hour, with the hour it starts (the earlier on a tie), over the whole day (today too,
  as the day's high is), and only when every hour from 10am to 6pm has one, as for highs. Now
  is the hour containing the moment; each point of `now.series` carries its hour's `uv`, so the
  browser keeps it current. Values are rounded to whole numbers, as WHO reports the index.
- **Levels.** WHO's five steps on the rounded index, with Carl's "Medium" for WHO's
  "Moderate": Low (0-2), Medium (3-5), High (6-7), Very high (8-10), Extreme (11+). Keys `low`,
  `medium`, `high`, `veryhigh`, `extreme` (`UV` and `UV_LEVELS` in `config.ts`).
- **Words.** Today and Tomorrow: "UV 7 · High, highest around 1pm". Now: "UV 5 · Medium now".
  Screen readers hear "UV index 7, high, highest around 1pm" (`viewDisplay(...).uv.sr`).
- **Nothing at UV 0.** At night, and on a polar winter's day, there is no line at all rather
  than "UV 0 · Low", on Today and Now alike, so the views never show a line with nothing to say.
  Today holds the line's place with a placeholder while loading; Now does not (it opens at night
  as often as by day).
- **On the page.** A line under the detail (`UvLine.astro`), after a small sun, at the
  detail's strength; the level's word is in bold, and no colour stands for a level (the line
  must read on all six hot palettes). Hidden, leaving no gap, when there is none.
  `CACHE.snapshotVersion` went from 6 to 7: a page saved without the line would otherwise keep
  being restored, and saved again, without it.
- **Hot only.** Wet and snow views are unchanged; `viewDisplay(...).uv` is null for them.
- **Previews** (`?preview=1`): every hot band has a UV index, and the six samples between them
  show all five levels (Edinburgh in January 1, Newcastle in October 2, London in April 4,
  Manchester in June 6, Bristol in July 8, Seville in August 11).
- **Synthetic data** gives GFS and UKMO an hourly UV index from the sun's height at the place
  and time, cut by each day's cloud (UKMO for 54 hours), MET Norway a copy of GFS's (as the
  live API answers, so the tests cover dropping it), and nulls for the other models; it
  echoes a requested height without changing its temperatures, so the end-to-end tests' answers
  stay put.

## Six models

Carl, with the wind topic: "Yes to both": drop MET Norway and JMA, and give wind its own units.
Six models remain: ECMWF (`ecmwf_ifs025`), GFS, ICON, UKMO, Météo-France and GEM.

- **Why these two.** Outside the Nordic countries Open-Meteo's `metno_seamless` is ECMWF's own
  model, so it counted ECMWF twice (and answered GFS's UV index as its own); JMA stores no wind
  gusts at all and its licence was unclear. Open-Meteo's source (main f625df2) shows that each of
  the six stores its own 10 m wind and gusts, so none answers a copy. This closes "MET Norway
  counts ECMWF twice" (Data) and "MET Norway matters more for rain" (Is it wet?).
- **Counts.** Everything that counts models reads `MODELS.length`: "5 of 6 forecasts agree",
  "Rain hour by hour from 6 forecasts", the About pages' agency list, and the loading strip's
  placeholder rows (six, so the answer's arrival never shifts the layout; it held eight). The
  counts quoted in older sections above are history.
- **One threshold changed.** With six models the shares are sixths. `RAIN.hourPossible` and
  `SNOW.hourPossible` were 0.375 (3 of 8 names the likeliest hour); 2 of 6 is a third and 3 of 6
  is already a likely hour, so 0.375 could never be reached and every showery six-model day said
  "On and off.". Both are now 1/3: 2 of 6 names the hour, while 2 of 8 and 2 of 7 still do not,
  so eight-model behaviour is unchanged. It also names 1 of 3 on a three-model day, which only
  happens far out in the week, where no timing line is shown. Every other share keeps its count
  or its meaning: Maybe from 2 of 6 (2 of 8 before), Yes from 4 of 6 (5 of 8), a likely hour at
  3 of 6 (4 of 8), and the hot blend still trims one at each end.
- **Request and cache.** `FORECAST_CACHE_VERSION` went from 5 to 6 and the request line changed,
  so CI's preview job re-records the fixtures; older eight-model recordings without wind still
  parse (with no wind in them). `CACHE.snapshotVersion` went from 8 to 9 (six model rows and
  the four-button toggle in the saved markup).
- **Quota.** 6 models × 7 variables is 4.2 calls a fetch (3.0 without wind's two; 4.0 with
  eight models and five variables): about 99 places checked around the clock on the free API's
  10,000 a day, against about 104 before (SETUP.md, section 2).

## Is it windy? (isitwindy.today)

Carl: "someone suggested I add a Wind tab, I purchased isitwindy.today as I think it's a good
idea." The same one-pager for wind (Now, Today or Tomorrow, This week), with its own palettes,
gradients and icons, and answers from "No." to "Yes." across six bands. isitwindy.today opens on
the wind question, and the toggle reads Hot | Wet | Snow | Wind on all four sites.

- **Data.** The one forecast request gains hourly `wind_speed_10m` and `wind_gusts_10m` (km/h,
  Open-Meteo's unit), 4.2 calls a fetch (see "Six models"). Open-Meteo labels the wind speed as
  instant and the gusts as the strongest of the hour before the stamp (three hours for ECMWF), so
  the parser keeps wind at its stamp and moves each gust to the hour's start, as it does rain and
  the UV index. Copied series are still dropped (`withoutCopies`), though no model copies
  another's wind. Each model's day keeps its strongest wind and gust between 7am and 9pm and its
  24-hour mean, worked out before the server drops the later days' hours.
- **Bands** (`WIND` in `config.ts`, whole km/h). A band is reached by its mean wind **or** its
  gust, the rule the Met Office uses for a gale ("force 8 or gusts reaching 43 knots"):

  | Band        | Answer | Mean wind from   | Gusts from        | Basis                                     |
  | ----------- | ------ | ---------------- | ----------------- | ----------------------------------------- |
  | Light winds | No.    | below breezy     | below breezy      | Beaufort 0–3                              |
  | Breezy      | A bit. | 21 km/h (13 mph) | 32 km/h (20 mph)  | Beaufort force 4                          |
  | Windy       | Yes.   | 30 km/h (19 mph) | 48 km/h (30 mph)  | force 5                                   |
  | Very windy  | Yes.   | 40 km/h (25 mph) | 64 km/h (40 mph)  | force 6                                   |
  | Gale        | Yes.   | 62 km/h (39 mph) | 80 km/h (50 mph)  | force 8; Met Office gale gusts 43 knots   |
  | Storm       | Yes.   | 88 km/h (55 mph) | 112 km/h (70 mph) | force 10; Met Office storm gusts 61 knots |

  Sources: the Met Office's Beaufort scale and marine glossary (gale, severe gale and storm by
  force or gusts), RMetS Metlink's land descriptions, and the US National Weather Service's
  forecast terms for breezy, windy and very windy (which start a little higher; ours start from
  the forces whose effects people notice). Changes from the spec's starting point: breezy's mean
  is force 4, not 3 (force 3 is about the UK's average wind); the mean wind counts for every
  band, not only the lower two; a storm's gusts are 70 mph, the Met Office's 61 knots, not 65.
  UK wind warnings have no fixed thresholds (they weigh likelihood and impact), so the bands
  never claim to be warnings. Still air (mean under 6 km/h and gusts under 16 km/h) reads "It's
  calm." and "Calm"; other light days read "Light winds", the Met Office's everyday words for
  force 1 to 3.

- **Whole numbers that agree with the band.** Each model's wind and gust is rounded to whole km/h
  as it is shown, the window's value is the median of those, and mph is worked out from the
  whole km/h. Every edge above converts to the right side in mph (a unit test checks every km/h
  value from 0 to 200), so "50mph" is never shown under a band that starts at 50 and says it is
  not reached. The backend chose to round each model before the median (the design said full
  precision): a one-hour Today then always equals Now.
- **Today, Tomorrow and the week.** Whole days are the waking hours, 7am to 9pm. Today is the
  rest of it, from the start of the current hour to 9pm (to midnight from 9pm), so a windy
  evening still to come counts; peaks are not sums, so nothing is scaled. Because Today always
  includes the current hour it is never calmer than Now (a property test over 300 random days).
  "Windiest around 3pm" names the hour with the strongest median gust. A model agrees when its
  own band is the window's ("4 of 6 forecasts say windy"); the strip shows each model's
  strongest gust, with the band's gust range as its zone. The week: Yes. with four or more windy
  days or any gale or storm, Partly. with fewer windy days, A bit. with breezy days only, else
  No.; "Windiest on Friday, gusts up to 45mph." names the day. Up to three days are named ("very
  windy today and on Fri and Sat"); a windy week's strongest band on more reads "on most days"
  or "all week", never a list that looks complete but is cut short.
- **Normals.** NASA POWER's `WS10M` (monthly mean wind at 10 m) in its own request and cache
  entry (`climate-wind/v1/<cell>`), with snow's 300 m height guard: a cell's mean height can be
  far from a valley town's, and exposure matters as much as height. Used only for "Windier than
  usual for October." (a day at 1.4 × normal and 5 km/h more, a week at 1.25 × and 3 km/h; calmer
  the same way down). **Needs a decision once CI has recorded live data**: the forecast is a
  point and the normal a 50 km cell's mean (coastal cells include sea), so the comparison may
  lean one way. `scripts/summarise-fixtures.mjs` prints the ratio of the forecasts' 24-hour mean
  to the cell's normal at Newcastle and Seville; if both are off by more than 30%, set
  `WIND.normals.scale` from it or drop the day line. The committed `nasa-power-wind-*` fixtures
  are synthetic stand-ins until then.
- **No warnings of ours.** Nothing says "warning", "danger" or "alert". For a UK place whose
  Today (or Tomorrow) or Now is a gale or a storm, the view links to the Met Office's official
  warnings page ("Met Office warnings", core `warningsLink`), a plain link under the detail;
  other countries have services of their own, so none. The About and Terms pages say the sites
  issue no warnings.
- **Words.** "Is it windy today?", "Is it windy right now?", "Will it be windy tomorrow?", "Will
  it be windy this week?", "Is it windy in Leeds today?". Answers No., A bit., Yes. (and the
  week's Partly.); "Very windy." wraps at the answer's size, so it is a verdict, never an answer.
  Speeds have no space before the unit, as amounts do: `45mph`, `72km/h`.
- **Units: a setting of their own.** The UK reads °C with mph, so wind does not follow the
  temperature setting. Wind is in mph by default where roads are signed in mph
  (`MPH_COUNTRIES`): the UK, the Crown Dependencies and the overseas territories that do, the US
  and its territories, and the Caribbean states that do (Carl, 18 October 2026); km/h elsewhere.
  The wind site's pill reads mph | km/h ("Wind units"); on the other three sites, showing Wind, the same two buttons switch to it.
  - The API takes `windUnits=mph|kmh`. Without it, a request that names `units` gets the
    place's unit (so it stays shareable at the CDN, and hot, wet and snow caching is unchanged);
    one that names neither gets the visitor's.
  - The browser keeps the choice under `isithot:windUnits` and sends it once chosen; until then
    it sends nothing for the first answer (the server picks the place's) and then the last
    answer's unit, as it does for °C and °F. The page's early request in `<head>` does the same.
  - City pages are rendered in the city's country's unit (London mph, Paris km/h); a visitor's
    other choice asks again quietly, as for °F.
  - A searched place's address carries its country (`country=GB`), so a reload or a shared link
    keeps its unit and warnings link. A named place without one (an older address, or an
    API client's) takes the nearest town's from the offline reverse geocoder.
  - Links between the domains carry it as `windUnits=` beside `units=` (F8), and the page there
    stores it and takes it out of the address.
- **Four domains, one deploy.** isitwindy.today is a fourth row in the edge function's table
  (`netlify/edge-functions/lib/route.ts`): served from `/wind`, www.isitwindy.today redirects to
  it, any real host's `/wind/…` goes there and isitwindy.today's `/wet/…` and `/snow/…` go to
  their sites, and `x-isitwindy-host: 1` makes a deploy preview act as it (never in production;
  with several headers sent, the first in table order wins). Nothing else tested for a topic by
  name; the route tests gained the fourth site.
- **Pages.** `/wind` mirrors `/snow`: home, city pages, places, About (with "Is it windy?" first,
  its bands in both units from `WIND`), Privacy, Cookies, Terms, 404, OG images, sitemap, robots
  and icons (`public/wind`, from `scripts/make-icons.mjs`; three white wind lines on green). The
  UV line stays Hot's alone. Each site's last answer: `isitwindy:last`, held only until the next
  forecast hour, as for wet and snow.
- **Search engines.** Wind blows everywhere, so no wind page is noindexed: the sitemap and the
  places page list all 300 cities, and other sites' pages link to every city's wind page.
  Titles follow the others' ("Is it windy in Leeds today? Hour by hour from 6 forecasts |
  isitwindy.today"); share cards carry the answer ("… Yes. Windy | isitwindy.today").
- **Palettes: yellow to green.** Every blue and violet is taken (Hot's Cold and Freezing, all of
  Wet, all of Snow), so the spec's "pale sky to storm teal-grey" would have looked like Wet's Dry,
  Showers and Heavy. Wind takes the free part of the wheel: pale straw with a warm sun for calm,
  spring green for breezy, then greens darkening to pine, and a storm's charcoal under a
  yellow-green light. Each palette is at least 13.4 (CIEDE2000) from every other topic's (the
  closest existing pair, Hot's Mild and Wet's Spots, is 11.7). `scripts/palette-contrast.mjs`
  holds Wind to every column (lowest 4.71, Windy at the glow's centre), and
  `e2e/contrast.spec.ts` measures all 24 bands as rendered. **Needs a decision**: green is the
  only free family; if Carl wants greyer, sea-green came within 11–14 of Wet's teals, so a
  switch between Wet and Wind on a wet, windy day would barely change colour.
- **Icons** follow the Beaufort scale's signs: a flag hanging still (calm), flying (breezy), the
  three wind lines (windy), a tree bending (very windy), bent hard with leaves torn off (gale),
  and Wet's and Snow's heavy cloud with violent gusts (storm). The wind always blows from the
  left. Wind lines, the flag, the trees and the leaves move three or four times and come to rest
  within 4.2 seconds, and not at all with reduced motion.
- **The four-way toggle.** Four buttons squeezed together at 320px with 200% text, and words were
  clipped at 125–150%. The toggle now has three steps on its container (`.wrap`, in ems, half an
  em early because the phone pill has that much more room than the page): icons and words from
  19.5em up (360px phones and desktop at the usual size), words alone below, smaller words below
  12.5em, and below 10.5em each icon over a smaller word, as on a phone's tab bar, four equal
  buttons in a pill no taller than before (60px buttons in 251px of the 256px it may use at
  320px with 200% text). Rejected: icons alone at the narrowest (enlarged text would lose the
  words), a 2 × 2 grid (twice as tall) and only the pressed button's word (buttons would move
  under the finger). `e2e/layout.spec.ts` checks every icon and word inside its button from
  320px to 1280px at 100–200% text. Wind's longer questions ("Will it be windy tomorrow?") keep
  clear of the icon as snow's do.
- **Synthetic data** (offline development and e2e): each place cycles from calm to gale over ten
  days, each model within ±15%, windiest in the afternoon; Reykjavík (64° or more) has a storm
  every hour of the year, so every band shows in any month. The preview (`?preview=1`) has a
  sample for each wind band, the UK ones in mph with the warnings link for gale and storm.
- **Fixtures.** CI's preview run records the six models and `WS10M`. The provider tests on
  those recordings require at least 5 models with a day's wind on days 1–2, 3 on every day, and,
  for at least 4 of the 6 models, gusts at least the mean wind in 90% of that model's hours. The
  first live recording (17 October 2026) showed why per model: ECMWF, ICON, UKMO and Météo-France
  were at 97–100% at Newcastle and Seville, but GFS's and GEM's diagnosed gusts fell below their
  own mean wind in light winds (Seville 68% and 72%), which a pooled 90% rule rejected. A
  misaligned or swapped series would fail every model.
- **Normals held back (17 October 2026).** That recording put the forecasts' 24-hour mean wind at
  0.44 (Newcastle) and 0.55 (Seville) of the cells' October normals, over two calm days: enough
  to show the comparison would lean to "calmer than usual" (the preview said so of a week with a
  very windy Friday), not enough to set `scale`. So `WIND.normals.compare` is false: the server
  neither fetches `WS10M` nor passes normals to the judge, the API's wind `normal` is null and
  About does not mention it. The fixture recordings keep recording `WS10M`, and
  `scripts/summarise-fixtures.mjs` prints the ratio each time; once a few weeks of recordings,
  windy days included, agree on a ratio, set `scale` to it and `compare` to true.
- **Size.** The browser keeps wind's "now" current with rain's code, as snow's does; wind's day
  and week judging runs only on the server and in the on-demand preview. The app chunk went from
  about 21 to 24.1 KB gzipped (budget 25.6 KB): wind's now, the four-topic client, the icons, and
  wind's day and week strings, which reach the chunk through the shared copy module as rain's and
  snow's do. Moving those strings to a module only the server and the preview import would win
  back about 0.5 KB if the budget gets tight.
- **Decided (Carl, 18 October 2026).** Wind keeps its green palettes; the calm band keeps
  "Light winds", with "Calm" only for still air; `MPH_COUNTRIES` adds the Caribbean states and
  the UK's overseas territories that sign roads in mph (not Samoa or Liberia, which use km/h as
  well).
- **Open.** At 200% text on phones up to about 420px the toggle shows each icon
  over a small word rather than the larger words alone; a single labelled button opening a menu
  would need new interaction code.

## Wind direction

Carl: "Is it feasible to add wind direction?" Yes: isitwindy.today now says where the wind blows
from, in words and with an arrow. Hot, Wet and Snow, and the week, are unchanged.

- **Data.** One more hourly variable in the one forecast request, `wind_direction_10m` (degrees
  clockwise from north, where the wind blows from): 8 variables × 6 models is 4.8 calls a fetch
  (from 4.2), about 87 places checked around the clock on the free API's 10,000 a day (SETUP.md,
  section 2). Open-Meteo's source (main f625df2) shows all six models serve it: ECMWF, GFS, ICON
  and Météo-France work it out from their own wind components, UKMO and GEM store it. It is
  instant at its stamp, as the wind speed is, so the parser keeps it there (gusts move, it does
  not), and drops copies (`withoutCopies`) as for the other wind variables.
  `FORECAST_CACHE_VERSION` went from 6 to 7, so CI's preview job re-records the fixtures; older
  recordings still parse (wind without a direction), and on recordings with it the provider tests
  want every hour of the first two days from at least 5 of the 6 models.
- **Never averaging angles.** 350° and 10° average to 180°, the opposite wind. Core
  `meanDirection` (`windDirection.ts`) adds each direction as a vector as long as its wind speed,
  so a strong wind counts for more than a light one, and the sum points the mean way. A direction
  is named only when it means something (`WIND.direction`): the winds' median speed is at least
  8 km/h (5 mph, within Beaufort 2, a light breeze; below it models' directions wander), and the
  resultant is at least 0.6 of the speeds' sum (1 when all agree; two forecasts 100° apart make
  0.64, 110° apart 0.57; opposite ones cancel out). Otherwise it is variable: `null` in the API,
  and left out of the words. The median, as the wind shown is, not the average, so still air
  never has one: two strong models of six would lift the average over the line and lend calm air
  their direction. It is of the unrounded speeds, so right at the line a wind shown as 5mph
  (8 km/h) may have none.
- **Which hour.** An hour's direction is all its models' together (`dir` on each Now series
  point, whole degrees, so the browser names it as the server would). A day's (Today, Tomorrow)
  is the direction at its peak, the hour "Windiest around 3pm" names, as that is when the wind
  matters; without a peak (a calm window, or one hour late in the evening) it is every model's
  every hour of the window together, by the same rules. Each model's own (`models[].direction`)
  is worked out the same way from it alone. A Now row's is its first hour's: a direction is for a
  moment, and the row's gust the stronger of two hours. The week has none: later days' hours are
  not kept, and "Windiest on Friday" says enough.
- **Words.** The eight points as the Met Office writes them, "from the north", "from the
  north-east" … "from the north-west", and N, NE, E, SE, S, SW, W, NW, each from whole degrees
  (north-east is 23° to 67°; 22.5° rounds up to 23°). Today and Tomorrow: "Gusts up to 27mph
  from the south-west, wind up to 10mph. Windiest around 12pm."; a calm day with a settled
  direction "Light winds from the south-west, gusts up to 9mph.", a forecaster's "light
  south-westerly winds" (still air never has one). Now: "Wind 12mph from the west, gusts 20mph
  right now." A variable direction is simply left out ("Gusts up to 27mph, wind up to 10mph."),
  never "variable" or "changeable", which read like a forecast of change.
- **The arrow** points where the wind goes (direction + 180°), as the Met Office draws it, beside
  the compass point it comes from: on a line under Now's detail (`DirectionLine.astro`) and on
  each row of the next 12 hours, under the time. A filled dart turned by an SVG `transform`
  attribute: the site sends no Content-Security-Policy (`netlify.toml` sets none and there is no
  `_headers`), and the strip already positions dots with inline styles, but an attribute needs
  nothing from a future policy's `style-src`. It never moves, so reduced motion has nothing to
  stop. Screen readers hear each row as "Gusts up to 32mph from 3pm, wind from the south-west"
  in place of its figures, letters and arrow; the Now line is hidden from them, as the detail
  before it has just said "from the west". A variable row keeps its line, empty, so the rows
  stay level; a variable Now hides its line.
- **Fitting.** Wind's gusts are the widest values in the rows ("130km/h" is about 5.8em at their
  size), and the rows already ran past the gutters at 320px with 200% text (and Reykjavík's
  km/h at 1280px) before a third line was added. Wind's rows now sit 0.6rem apart and take
  columns by the width of `.ahead`, a container: six from 37.8em (the desktop page), three from
  18.6em (phones from 360px at the usual size), two from 12.2em, else one. `e2e/layout.spec.ts`
  checks every figure, time, arrow and point inside the gutters from 320px to 1280px at 100–200%
  text; `e2e/contrast.spec.ts` measures the compass points in all six wind palettes (lowest 6.2,
  Windy). `CACHE.snapshotVersion` went from 9 to 10 for the new line in the saved markup.
- **Size.** The browser names directions (`wind.ts`) and draws the arrows; judging them
  (`windDirection.ts`, the vector mean) stays with the server and the preview, as wind's day and
  week do. The app chunk went from 24.3 to 24.9 KB gzipped (budget 25.6 KB).
- **Synthetic data**: each place's day blows from a direction of its own, veering up to 60°
  through the day, each model within 12° of the others; on calm days each model's wanders up to
  120° either way, hour by hour, so variable hours show; Reykjavík's storm blows from the
  north-east all year. The preview's samples veer from the south-west or west, 2° an hour; the
  calm sample's light air is variable all day, its tomorrow light winds from the west.
- **Checks on live data.** `scripts/smoke.mjs` checks that at least 5 of today's models carry a
  direction (named, or null for a model whose own wind is too light), that today has one or is
  variable, and every hour of Now's series; `scripts/summarise-fixtures.mjs` prints each model's
  hours with a direction over the first two days, and any copies.
- **Needs a decision.** 8 km/h and 0.6 are starting points: once recordings show how often the
  models disagree in light winds, move them in `WIND.direction`. Left as it was: the Today view's
  model list (every topic) still runs past the gutters at 320px with 200% text, and wind's at
  1280px with three-figure km/h gusts; the same column steps would fix it.

## Saved places (the iPhone app)

Carl wanted to save places in the native apps, beside the picker's recent ones. The iPhone app
has them now (built in "The iPhone app in the website's look", step 4); the website has none.

- **Where they show**: in the full-screen picker, with nothing typed, a "Saved" section between
  "Use my location" and "Recent", where `SearchSheet.astro` would put one on the web. A star
  beside a place saves or removes it.
- **The rules** are one pure function per action in `packages/client/src/saved.ts`, ported to
  Swift and checked by golden vectors (`saved.json`), as the recent places are: at most ten
  (`PLACES.savedMax`), in the order saved with the newest last, one per place (`targetKey`).
  The two lists change together (`PlaceLists`): saving takes a place out of Recent; removing it
  puts it back on top of Recent, so one more tap undoes it; choosing a saved place leaves both
  alone, so the list doesn't shuffle under the thumb; and Recent never shows a saved place
  (`shownRecent`). A saved place keeps the name and line it was saved with.
- **The phone's own point is never saved**, nor is approximate IP location. A device fix
  follows the phone: a saved "my location" that moved would mislead, and one that stood still
  would mislead under that name. So the Recent row a location fix made has no star; to keep the
  town you are in, search for it and save that. This is Carl's open question 1 in the build
  plan, built on its default; saving the point as a fixed place is on the Later list.
- **Kept in the app's own defaults** (`savedPlaces.v1`, beside `recent.v1`), not the App Group:
  no widget reads them, as the v1 widget follows the place on screen, and the spec keeps widgets
  that choose a place for the all-in-one app. Read leniently, as `recent.v1` is, and written
  whole after each change, the saved places first, so a write cut short leaves a place in both
  lists, which `shownRecent` shows once.
- **Free**, like Recent: the upgrade stays "no ads, plus widgets" (open question 2's default).
- **The API needs nothing new**: a saved place is a city slug or rounded coordinates, which
  `/api/v1/today` already takes. They never leave the phone; only the place chosen is asked
  about. Your privacy and the website's privacy notice now say the app keeps "recent and saved
  places".
- **On the web** each domain has its own storage, so a web version would need the same
  address-carrying approach as F8 above (clumsier for a list than for one place) or the sites on
  one shared domain. Nothing is built there.

## The client package (packages/client)

The iOS build spec (section 6) puts every rule a client follows in one pure TypeScript package,
at 100% coverage: the reference the Swift app ports, checked later by golden vectors generated
from it. The website adopts it in the same change, so the rules exist once.

- **Moved out of `app.ts`, not rewritten:** `Target` and `targetKey`; `todayQuery` (the
  parameter half of `apiUrl`, in the same order, so the website's requests are byte for byte
  the same), `freshQuery` (the hourly `t=`) and `searchQuery`; `hourUntil`, `dayUntil`, `hold`
  and `outOfDate`; the device and search targets (`deviceTarget`, `searchTarget`); and
  `CLIENT.refreshAfterMs`, the half hour away. Every function takes the moment as an argument.
  `app.ts` keeps its holds and passes them in and out, and keeps the preview's exemption.
- **New, for the apps:** `usableUntil`, `nextRefreshAt`, the hour picker (`pickHour`),
  `middleDay`, `updatedLine`, the widget planner (`widgetEntries`), the notification sync
  (`alertAction`, `registrationBody`, `fingerprint`), deep links and notification taps,
  recent places, and the apps' storage keys. `WIDGET` and `ALERTS.heartbeatDays` are in core's
  `config.ts`, as the spec places them; `ALERTS` gains the rest with the notifications work.
- **Where the repo differs from the spec.** A city `Target`'s name stays optional (a city page's
  target has none) and a searched place's region and country may be null, as the website has
  always stored them. The home page's head script (`HomePage.astro`) still builds its own copy
  of the query: it runs before any module has loaded, so it cannot import one. The e2e suites
  check that the app takes its answer rather than asking again.
- **Core's types throughout.** The snow week's agreement on each day and the hours ahead
  (`ahead=snow`), which the spec types for the client, are in the API now ("API contract",
  below), so the client reads `TodayResponse` as the website does and has no types of its own.
- **Choices the spec left open.** `pickHour`'s `end` is also never later than `usableUntil`, so
  an app that picks again at `end` never shows an old hour. The notification sync's "every
  switch off" means the evening and morning switches: "also when snow is possible" only widens
  those two, so alone it would keep a registration that never sends anything, and it is deleted
  instead. A notification tap whose place has no answer on the phone yet (so no date there to
  compare) opens on the notification's view; one whose date is more than a day ahead there (a
  phone's clock far behind) opens on the place's view for the time of day, as a past date does.
  Without a middle day, a widget's list of days starts with the week's first. `hourUntil` falls
  back to snow's answer without rain's, which the server never sends (snow comes exactly with
  rain). Two topics ahead are written as a form writes them, `ahead=snow%2Cwind`.
- **Size.** The site's app chunk went from 24.78 to 24.94 KB gzipped on the base it was built
  on (24.96 KB with the API additions merged; all site JavaScript 25.08 KB, budget 25.6 KB).
  Estimated by taking each part out of the built chunk and gzipping it again: about 40 B is
  `CLIENT` (the bundler keeps the whole object when one timing is read, so the apps' four come
  too), 25 B `ahead` in the query and 3 B the fallback to snow. The other
  90 B or so is the functions' new shape: they take the moment and the holds as arguments,
  `hold` returns a copy, the device and search targets are functions of their own, and the
  address is built in two places.

## Notifications: the probe (packages/server apns.ts)

The apps' snow notifications are sent by a Netlify scheduled function through Apple's push
service (APNs). Two things were unverified on Carl's legacy Netlify plan, so a small probe lands
first (iOS build spec, phase 1.5) and the full job follows.

The notifications' decisions are in five sections, in the order a notification travels: this
probe; when, whether and the words (core); the store and the sender; the devices endpoints, which
register a phone for a place; and the run, which reads those registrations and sends. One
record, one store, one sender, one quiet-hours rule and one dry-run rule run through all of them
("Notifications: the run", how the parts fit). SETUP section 5 has the checks and the rollout.

- **V8, does the schedule run?** `functions/api/alerts-run.mts` runs every 15 minutes (UTC) and,
  until the full job landed, only logged `alerts-run: disabled (production)`. The Netlify Functions
  page should list it as scheduled, with a log line every 15 minutes in production. About 2,900
  invocations a month. Elsewhere the line says what it saw, for example
  `(deploy-preview, ALERTS_SMOKE unset)`, so a preview check that sends nothing shows why. (Yes,
  on 23 October; the full run keeps these lines, naming `ALERTS_ENABLED` too: "Notifications: the
  run".)
- **V9, can a function reach APNs over HTTP/2?** On a deploy preview with `ALERTS_SMOKE=1`,
  **Run now** sends one push with the sandbox key to a made-up device (`apnsSmoke`). Apple's
  `400 BadDeviceToken` proves egress, TLS, HTTP/2 and that Apple took the key's token (a refused
  token is a 403). Production never sends it, whatever the setting.
- **The sender** uses Node's built-ins: an ES256 provider token (`providerToken`) and `node:http2`
  (`apnsSender`), tested against an in-process fake APNs. Keys come from Netlify's environment as
  the `.p8` text however it was pasted, or its base64 (`apnsKeyPem`, the same rule as
  `scripts/asc.mjs`). Nothing logs a key, a token or a device token.
- **Daily key check:** `.github/workflows/alerts-smoke.yml` runs the same push from GitHub with
  the sandbox key from the `apns-smoke` environment (main only, no reviewer, since it runs on a
  schedule). The production key is only ever in Netlify.
- **The topic is the app's bundle ID,** `today.willitsnow.app`. Until it is registered under the
  team, Apple may refuse it (a 400 naming the topic, or a 403); the smoke says so.

## Notifications: when, whether and the words (core alerts.ts)

The server's run decides and words every notification with core (iOS build spec, sections 8.4
and 8.6), so the apps never judge or word one, and the constants are `ALERTS` in `config.ts`.

- **No new thresholds.** The evening (18:00 to 19:59 at the place) reads tomorrow's whole day,
  `snow.days[1]`; the morning (07:00 to 08:59) the rest of today from the run's moment,
  `snow.days[0]`. Snow, heavy snow and deep snow always send; "Snow possible" only for those who
  asked for it; a few flakes and no snow never. A notification never says more than the page.
- **The page's words.** The title names the band and the day ("Heavy snow likely in Leeds
  tomorrow", "Snow possible in Leeds today"); the body is the day's own detail and agreement, so
  the Durham example reads "1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect
  snow.", in inches with °F. In the morning, while Now is snow or more, the title is "Snowing in
  Leeds now". A device location without a town's name (the API's "Your location") reads "near
  you": "Snow likely near you tomorrow". Nothing says "warning", "danger" or "alert", or names
  another weather type, app or website; a test checks every title and body the rule produces for
  days of every band, at different times of day, in both units.
- **Choices the spec left open.**
  - `snowAlert` sends nothing when that kind's switch is off, so it decides from all three
    switches. The test endpoint, which sends the evening's real notification whatever the
    evening switch says (with the record's "possible" choice), passes `{ ...prefs, evening: true }`.
  - "Snowing now" goes with any band that sends, though in practice Today is never less snowy
    than Now.
  - The result carries the date it is about (tomorrow's in the evening) as well as the title,
    body, band and relevance, for the payload and the collapse id, so the run never picks the day
    again.
  - `expiresAt` is in Unix seconds, as `apns-expiration` takes it: 21:00 at the place for the
    evening, 11:00 for the morning, on the day it is sent. It reads the zone's offset twice, so a
    clock change between its first guess and the answer is allowed for (Adak in March is the
    test).
  - Relevance: deep snow 1, heavy 0.8, snow 0.6, possible 0.3 (`SNOW_RELEVANCE`).
  - The windows and the quiet hours (21:00 to 06:59, `inQuietHours`, which the sender asserts) are
    tested at their edges across the UK's clock changes on 25 October 2026 and 28 March 2027 and
    Adelaide's, and in Kolkata, Kathmandu, Kiritimati and Pago Pago. An unknown time zone reads as
    UTC, as everywhere in core.
- **Other topics later.** A `TopicAlertRule<T>` picks its topic's answers from a response and
  decides its notification from its own verdict. Only snow's exists (`SNOW_ALERT_RULE`).
- **Size.** None of it reaches the website: the site's JavaScript is byte for byte the same.

## Notifications: the alert store and the push layer (packages/server alertStore.ts, apns.ts)

The storage and sending half of the full job (iOS build spec, sections 8.3 and 8.5). The run
(`runAlerts`), the devices handlers and core's rules build on it.

- **One store, `isithot-alerts`, strongly consistent.** Production uses the site-wide store;
  previews, branch deploys and `netlify dev` get a deploy-scoped one, chosen as the cache's is, so
  a preview never reads or writes a real registration. Unlike the cache, it never falls back to
  memory when Blobs is missing: two instances with their own memory would both send.
  - That choice is this code's, not Netlify's: any deploy of the site can open the site-wide
    store. It holds every device token, each place (a device location as its 0.05° point) and,
    for up to 50 minutes, the provider token, which together could send to every device. The
    repository is public and every pull request gets a preview, so Netlify must not build one
    from outside the team until Carl has read it (SETUP section 1, before notifications go
    live). Encrypting the tokens and places with a key only production holds would be a second
    guard; it is not built.
- **Every call either answers or fails, within 1.5 s.** `get` gives null only when Blobs said the
  key is absent; `set` with `onlyIfNew` gives false only when Blobs said the key exists. A failure
  or a timeout rejects (and is logged once, with ids cut to 8 characters). A call that times out
  may still land later, so callers do only what is safe either way: a claim that fails is not a
  claim, so nothing is sent; a read that fails is not "absent", so nothing is deleted and no zone
  is marked done; a release that fails keeps its claim, so that push is not retried today. A
  failure can cost a notification, but never sends one twice or deletes a registration wrongly.
- **What `@netlify/blobs` 11.1.3 does,** read from its source: `getStore` and `getDeployStore` both
  take `consistency`, and set on the store it sends every get, list, set and delete through the
  uncached edge (a test against Netlify's own local Blobs server proves it: with a dead cached
  edge, every call still works). A conditional write sends `if-none-match: *` and reports
  `modified: false` for a 412, but `modified: true` for any other answer, errors included, so a
  claim is believed only with the etag a real write returns, and otherwise read back. `list` with
  `directories` gives full paths without a trailing slash. The client retries 429s, 5xxs and
  network failures five times, 5 s apart, hence the timeout.
- **Keys.** As in section 8.3, with the zone `encodeURIComponent`'d wherever it appears (in `done/`
  keys too), so a zone is always one path segment, and one more key, the run's `judged/`
  ("Notifications: the run"). A test send claims one of the hour's slots,
  `test/v1/<id>/<yyyy-mm-ddThh>.<n>`, because one key an hour would allow one send an hour, not
  three, and a counter would be a read-modify-write. Unverified: that Netlify's service keeps
  `%2F` in a key as it is. Netlify's local server does (`Europe%2FLondon` is one directory); a
  deploy preview check (register, then list `reg/v1/`) settles it.
- **Deleting a registration re-reads it first.** A record written or refreshed since the run read
  it (a new `updatedAt` or `seenAt`) is kept, and the `ids` key goes only while it still names the
  same zone.
- **The provider token is shared through the store** (`apns/v1/jwt/<env>`), reused under 50
  minutes and only when it was made with the current key for the current team, so a rotated key
  takes effect at once. A 403 drops it, unless another run has already made a new one. No copy is
  kept in module memory: one strong read per run is cheap, and a copy could outlive a token Apple
  refused.
- **The sender.** One HTTP/2 session per APNs environment. The first push goes alone (Apple allows
  one stream until a valid provider token arrives), then up to min(`apnsConcurrency`, the
  session's `maxConcurrentStreams`) at once; Node itself queues requests past the server's limit,
  so the test counts them on the sending side. Each of the run's pushes is claimed just before
  it goes; a test send, already counted by its slot in the hour, goes unclaimed
  (`claimKey: null`). A 403, a 429 `TooManyProviderTokenUpdates` or no answer stops that
  environment for the run, leaving the rest unclaimed for the next. After a 429 or a 5xx it stays
  at one stream. A push that timed out is released and retried by the next run, as Apple advises
  for 5xxs; if Apple had in fact taken it, the same collapse id makes the second replace the first
  on the phone rather than stack.
- **Quiet hours are asserted in the sender,** with core's `inQuietHours`, the run's own rule:
  nothing goes from 21:00 to 06:59 at the place, test sends included, and a zone the runtime
  does not know reads as UTC, as the windows read it ("Notifications: the run").
- **The payload** is section 8.5's, key for key. It stays under 1,024 bytes for the longest city
  (Las Palmas de Gran Canaria) and for a searched place at the server's 80-character limits;
  80 three-byte characters for both name and region stay under Apple's 4,096, and `alertPush`
  refuses anything over 4,096 before a claim is written.
- **Logs** carry id prefixes, statuses, reasons, zones, the APNs environment and the app version;
  never a device token, a provider token, a key, a full id or a place query (which can hold
  coordinates). A test checks every line the tests log.

## Notifications: the devices endpoints (packages/server devices.ts)

How the apps register for notifications (iOS build spec, sections 8.2 and 8.3): `PUT` and
`DELETE /api/v1/devices` and `POST /api/v1/devices/test`, two thin functions over
`@isithot/server`, each limited by Netlify to 10 requests a minute per IP on each domain.

- **The body is checked whole before anything is read or written,** and is at most 2 KB (413
  `too_large`). It has the app, the platform (`ios`), the environment, a hex token of 64 to 200
  characters, the units, the three switches (booleans only), an optional app version, and the
  place in one of its three forms.
  - Anything but letters, digits, spaces and `. ( ) _ + -` in the app version ("1.0 (112)", at
    most 40 characters) is a 400 `bad_request`. It is logged with Apple's refusals, and a line
    separator (U+2028), a C1 control (U+0085) or a direction override (U+202E) in it could forge
    a log line or reverse how one reads.
  - Only `snow` is live: `wet`, `wind`, `hot` and `all` are a 400 `app_not_live`.
  - The token is lower-cased first, so a device has one id whichever case it sends.
  - No place, or the IP location's empty one, is a 400 `bad_location`. So is a slug with no page:
    where `/api/v1/today` says 404, a registration says the place is wrong.
  - Fields it does not know are ignored.
  - A contract test sends it every body the client's `registrationBody` makes: each place form,
    unnamed searched places, both units and environments, and every switch combination.
- **The place is canonicalised as `/api/v1/today` locates it,** with `locateCity` and
  `locateFromCoords` (now exported from `today.ts`):
  - a slug becomes its page's (`place=leeds-gb`);
  - coordinates are rounded again to 0.05°;
  - a searched place keeps its cleaned name, region, country, GeoNames id and height, and one sent
    without a name takes the nearest town's, as the API names it. Cleaning (`/api/v1/today`'s
    too) strips angle brackets, every control (C0 and C1), line and paragraph separators and the
    invisible format characters, direction overrides and zero-width spaces among them, but keeps
    the zero-width joiner and non-joiner that some scripts spell with. A name reaches logs and
    notifications as well as pages;
  - a device location is its point only (`lat=53.8&lon=-1.55&source=device`), whatever else it
    carries.

  The query is in the client's order, so a tap on the notification opens the app's own place
  (the tests check that `notificationRoute` gives the same `targetKey`). The zone and the name
  come from `getToday` on that query, with no wait for climate normals.

- **Every switch off is a delete (204),** and so is "also when snow is possible" alone. That
  switch only widens the other two, the app's sync already deletes then, and a record that can
  never send is data kept for nothing.
- **One write per id a minute** (429 `rate_limited`, with `Retry-After`), checked against the
  stored record's `updatedAt`, so it needs no key of its own. A delete is never refused. Two
  writes in the same instant both pass; Netlify's rule bounds those.
- **Keys and moves.** Only these handlers write `reg/` and `ids/`, and each write replaces the
  value whole.
  - A new registration writes its ids key first, then the record, so a DELETE after a failure
    between the two still finds it.
  - A move between zones takes four steps: the ids key naming the new zone and the ones left
    (`{ tz, from }`), the new record, deleting the old one, then the ids key naming the new zone
    alone. Whichever step fails, a DELETE removes every copy, and the next PUT finishes the move.
  - `createdAt` is kept; `updatedAt` and `seenAt` are set on every write.
- **A store failure is a 503 `store_unavailable`** with the JSON error, never a 200 for a write
  that did not land. No Blobs environment gives the same 503, not a crash. Production uses the
  site-wide store; previews, branch deploys and `netlify dev` the deploy's own, decided from the
  deploy context as for the run. A test against Netlify's local Blobs server checks each context.
- **The test send.** 404 `not_registered` without a registration. 429 `test_limited` after 3 in
  the hour (UTC) for the id, with `Retry-After` to the next hour. Otherwise one push at once, and
  202 `{ sent: true }`. It sends tomorrow's real evening notification when the rule sends one for
  the place (with the record's "possible" choice, whatever its evening switch says), and
  otherwise "Test notification".
  - **It goes through the run's sender** (`sendAlerts`, with no claim key, since the hour's slot
    has already counted it). So Apple's answers mean what they mean for the run, the provider
    token is the run's, shared through the store and dropped on a 403, and the quiet hours are
    asserted by the same code.
  - **The quiet hours apply** (21:00 to 06:59 at the place, core's `inQuietHours`): 409
    `quiet_hours`, with `Retry-After` to 07:00 there. They are checked before the slot is
    claimed, so a test pressed at night costs none of the three. Section 8.6 has the sender never
    send in those hours, and one rule for every push keeps that true. The cost is that App Review,
    pressing the button at night at the place it chose, sees a failure, so the review notes say
    so; the app shows `testFailed` until it has words of its own for this code.
  - Priority 10, and Apple stops trying after 15 minutes: a test that arrived hours later would
    only confuse, and a real evening notification's 21:00 would have passed for a late test.
  - The real notification keeps its collapse id (`snow-evening-<date>`), so the scheduled one
    replaces it on the phone. The fixed words use `snow-test`, so tests replace each other rather
    than pile up. They have relevance 0.3 (the lowest band's) and today's date at the place.
  - The forecast is waited for 3 s, and Apple 5 s. A forecast that is slow or fails gives the
    fixed words: the test is of notifications, not of the forecast.
  - The key is checked before the claim, so a missing key (503 `push_unavailable`; the log names
    the missing settings, never a value) costs no test.
  - Apple's answer is acted on as for the run. A refused device is deleted, and the answer is 404
    `not_registered`. A 403, a 429, a 5xx or no answer is 503 `push_unavailable`; any other
    refusal 502 `push_refused`. The sender logs Apple's answer as it does for the run
    (`alerts: deleted …`, `alerts: error: …`), and the endpoint adds one line of its own:
    `devices: test sent to snow.3f9c1a2b… (…)`, or `devices: test not sent to … (…): <outcome>`.
    A failed send still counts towards the three.
  - **`ALERTS_DRY_RUN` is read by the run's rule** (`alertsDryRun`): nothing is sent unless it is
    `false`, in any context, so a production that is still a dry run sends no tests either.
    Unlike the run, a test follows `false` on previews, branch deploys and `netlify dev` too:
    that is how a preview checks the whole path to Apple with a made-up device (SETUP section 5).
    A dry test claims its slot and decides its words as usual, the sender logs them
    (`alerts: dry run: …`), and it answers 202 `{ sent: false, dryRun: true }`, with no key
    needed.
  - `ALERTS_ENABLED`, the run's switch, does not apply to registrations or tests: registrations
    are kept whatever it says, so they are there when the run starts.
- **The test endpoint has the same Netlify limit** (10 a minute per IP). The spec names one only
  for `devices.mts`, but each test reads the store and may push.
- **Logs** carry id prefixes, zones, Apple's answers and the app version; never a device token, a
  key, a provider token, a full id, a place query or coordinates. The forecast code and the cache
  name an entry by its grid cell ("forecast/v7/54.80,-1.60/50"), so every line the handlers log
  goes through `placeLess` (the run's `scrub`, and any other pair of numbers). That includes
  `createDeps`'s own: a cache read slower than 1.5 s logs its key, and the handlers used to leave
  those to the plain console. A test checks every line the tests log, and one runs a PUT and a
  test send on the functions' own dependencies with a slow Blobs edge.
- **Junk registrations. Needs a decision before the public launch.** A made-up token is a new id,
  so the one-write-a-minute rule never applies to it, and only Netlify's 10 a minute per IP on
  each domain bounds them. Junk at a place with no snow is never pushed, so Apple never refuses
  it, and it stays for 90 days. Since the run judges each registration once a window, each costs
  at most one forecast a window (and none where it shares a place), the run's cap still bounds a
  run (60 forecasts free, 300 with the key), and a zone gets through 480 or 2,400 places a window.
  Past that, junk padding one zone would push real registrations out. Two ways to close it, both
  Carl's call: App Attest or DeviceCheck (an app change, the real fix), or a daily limit of new
  registrations per IP, which means keeping a keyed hash of the IP for a day (research section
  11 promises the IP is never stored, so the privacy notice would change) and could refuse people
  behind one mobile network's address.

## Notifications: the run (packages/server alerts.ts)

The scheduled function `alerts-run` (every 15 minutes, UTC) calls `alertsRun`, which reads the
switches and calls `runAlerts`, section 8.6's run. `runAlerts` takes no input but the clock, so
any other trigger could call it.

- **The switches** (Netlify, Functions scope; a change needs a redeploy):
  - `ALERTS_ENABLED` must be `true` (any case), or the run returns at once with one line saying
    why: `alerts-run: disabled (production, ALERTS_ENABLED unset)`, or on a preview
    `(deploy-preview, ALERTS_ENABLED unset, ALERTS_SMOKE unset)`. These are the probe's lines with
    the new switch named, so V8's check still reads the same.
  - `ALERTS_DRY_RUN` is read by `alertsDryRun`, one rule with the test endpoint's: nothing is
    sent until it is `false` (any case), so unset or a typo stays dry. The run is also forced dry
    by code in every context but production, whatever it says (it logs that it ignored a
    `false`).
  - `ALERTS_SMOKE=1` still makes a preview's run send only the smoke push, as for V9. Production
    never smokes, whatever the setting.
  - `ALERTS_FORCE_IDS`: below.
- **Order.** As section 8.6, with one change: today's claims (`sent/`) and judgements
  (`judged/`, below) for each due window are listed before the zone's records are read, and a
  registration already notified or judged is skipped unread. A record not seen for 90 days that
  was already notified or judged today is deleted at its next window instead.
- **Each registration is judged once a window, a key of its own (`judged/`).** Section 8.3 keeps
  no record of a registration judged with nothing to send, and only a claim or the zone's done
  marker showed progress. A zone too big for one run (the budget, the fetch cap) was then judged
  again from its first group every run: free while the forecasts were cached, but the cache keeps
  one for an hour, so the first groups cost the cap again and the last were never reached, for any
  band, all window, every day (about 4 × the cap distinct forecasts: 240 a window on the free API).
  So a run that leaves a zone unfinished writes
  `judged/v1/<localDate>/snow.<kind>/<app>.<id>` (`{ at }`, a plain write: every writer writes the
  same) for each of its registrations judged with nothing to send, or logged by a dry run. A
  zone picked up again after a stop then reads only what it has left, so it gets through a big
  zone over several runs: at most 8 runs a window, so 480 forecasts on the free API and 2,400 with
  the key. A run that finishes its zone writes none (its done marker says it all), so a normal
  evening costs no more writes than before. They are the first thing a short run gives up (none
  once the pushes' 4 s of grace are over), since they only save the next run work, and a listing
  of them that fails only means judging again.
- **One moment.** `now` is read once and given to `getToday` as `deps.now`, with
  `climateWaitMs: 0`: the normals only word a day without snow, which never sends.
- **Groups** are `query` + `units`, the biggest first, so a run stopped by its cap or budget has
  notified the most it could. Groups for one place in °C and °F share one forecast fetch.
  `ALERTS.fetchConcurrency` (4) run at a time.
- **The fetch cap** counts each distinct forecast URL requested (a hedged second request is the
  same fetch), plus each group still running, so a run never goes over it: 300 a run
  (`ALERTS.maxForecastFetchesPerRun.paid`) with `OPEN_METEO_API_KEY`, 60 without. Groups not
  started are left, with their zones, for the next run.
- **The budget** (`ALERTS.runBudgetMs`, 20 s) stops new record reads and new groups. Pushes for
  groups already judged may start for 4 s more (`PUSH_GRACE_MS`), and each push waits at most
  4 s for Apple (`APNS_RUN_TIMEOUT_MS`). A group started just before the budget can take about
  7.5 s more (a 1.5 s cache read, then the 6 s forecast timeout), so even then the run ends
  inside Netlify's 30 s; its pushes are left for the next run.
- **Done markers** are written only when every due registration in the zone is finished with:
  sent, refused for good, held, quiet, judged, or with nothing to send. These leave the zone for
  the next run: a failed listing or read, a forecast that failed (503), a released claim or a
  deferred push. The claims stop the next run from sending twice. A place that no longer exists
  (404) and a record the run cannot read are logged as errors and do not hold the zone up. A
  failed read leaves its zone unfinished, but the zone's other registrations still go.
- **Overlapping runs** (a late scheduled run, or **Run now** during one) send once, by the claims,
  and no longer lose a notification. A run counts another run's claim as finished, whether it
  found the claim in its listing or found it taken, but that run may yet get a 429, a 5xx, a 403
  or no answer and release it. Marking the zone done on it lost the notification for the day: the
  marker stood, the claim was gone, and Apple never had the push. So both sides act. A run that
  marked a zone done counting on others' claims lists the window's claims again once the marker
  is written, and takes the marker back if one has gone. A run that releases a claim deletes its
  zone's done marker. Whichever order the two runs' steps fall in, one of them sees the other's
  (the tests hold each order). A lease that stopped a second run starting was the other way, but
  **Run now** in the same quarter of an hour, the preview check in SETUP section 5, would then do
  nothing.
- **Stale.** A record whose `seenAt` (else `updatedAt`) is more than 90 days old is deleted when
  read, whatever its switches, through `forgetRegistration`, which keeps one refreshed since.
- **ALERTS_FORCE_IDS** takes prefixes of 8 to 32 hex characters, in any case. A shorter one would
  force many registrations at once, so it is ignored and counted as an error, without being
  quoted. A forced registration gets one notification per window per day whatever the band: the
  real one when the rule sends one, otherwise the test copy ("Test notification", relevance 0.3,
  dated as the real one would be). Its own switches still apply: a window switched off gets
  nothing.
- **The dry run** logs each notification
  (`alerts: dry run: snow.3f9c1a2b… sandbox evening 2026-10-19: <title> / <body>`). It claims
  nothing, makes no provider token and sends nothing. It still writes done markers, and judged
  markers where a zone is left unfinished, so each notification is logged once a window, and it
  still deletes stale records and cleans up.
- **The cleanup** runs in the 03:00 UTC hour. The first run then claims
  `done/v1/<UTC date>/cleanup` (`onlyIfNew`), lists `sent/v1/`, `judged/v1/` and `done/v1/` by
  date and `test/v1/` whole, and deletes the keys of dates more than 2 days before the UTC date:
  at 03:00 on 1 December, 27 and 28 November go, 29 November on stay. Cut short or failed, it
  releases its marker, so the next run in the hour carries on. The marker goes with its day's
  `done/` keys. That is at most four conditional writes a day, and no other run pays anything.
- **The log line**, one a run:
  `alerts-run: zones 1, records 2, groups 2, fetches 2, sent 1, deleted 0, errors 0; 812 ms`.
  Notes follow when they apply: `dry run, 3 logged`, `2 forced`,
  `1 zone left for the next run (out of time)` or `(fetch cap 60)`, and
  `cleanup deleted 120 old keys`. `errors` counts the lines logged as errors
  (`alerts-run: error: …` and the sender's `alerts: error: …`), each failure once. Those event
  lines (deletions, refusals, errors, a dry run's notifications) come before it; a clean run that
  sends logs only the summary.
- **Public logs.** Every line goes through `redact` (ids and JWTs) and a scrub of coordinates (a
  cache key's cell, `lat=`, `lon=`, `apikey=`). So do the forecast code's own messages
  (`forecast unavailable for forecast/v7/<cell>/…`), through `createDeps`'s new `log` option. An
  error about a group names its first registration's id prefix ("and 2 more"), never the place.
- **One quiet-hours rule.** Core's `inQuietHours` is the only one; it takes `ALERTS.quiet`, or the
  sender's `quiet`. An unknown zone reads as UTC there, as `alertWindows` reads it, so the run and
  the sender agree. The sender's own copy used to count an unknown zone as always quiet, which
  could have refused every push in a zone the run thought was in its window. The test endpoint
  checks it too, before it claims a slot, and its push goes through the same sender.
- **One record.** The devices handlers write `DeviceRecord`, which is the run's `AlertRecord`
  (section 8.2's record) narrowed, so the compiler keeps the two together. The run checks the
  token (hex), `env`, `query`, `units`, `updatedAt` and `alerts` as it reads one, and takes the
  zone, app and id from the key.
- **How the parts fit** is tested end to end (`test/notifications.test.ts`), with the real
  handlers and the real run on one memory store and the fake APNs. A registration made with
  `PUT` gets one push at the place's 18:05, with section 8.5's payload and headers, and none at
  18:20. After a `DELETE`, the next evening's run sends it nothing even when forced, while a
  device still registered there gets its forced one. Every place form and both units go through
  as the handler canonicalised them (the tap opens the place the `PUT` answered with); a move to
  another zone is notified only in its new zone; and a test send and the run use one provider
  token, whichever made it.
- **The dry-run script,** `pnpm tsx scripts/alerts-dry-run.ts --now <ISO>`, registers every city
  page's place in °C and °F with every switch on (zones from `getToday`, as the devices handler
  reads them), on synthetic forecasts with the fixed clock, and prints each notification.
  `--now 2026-10-18T18:05:00Z` gives section 8.5's Durham example exactly ("Snow likely in Durham
  tomorrow" / "1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6 forecasts expect snow.",
  "About 0.5in of snow. …" in °F); the spec's 2026-12-01T18:05:00Z has no snow in Durham in
  synthetic data. A test pins that output.
- **Preview checks.** A preview's run is always dry, so section 8.7 item 4's forced run shows the
  notification in its log rather than Apple's `400 BadDeviceToken`. The test endpoint covers
  Apple's half on the same preview: with `ALERTS_DRY_RUN=false` for Deploy Previews, a test to
  the same made-up device goes through the same sender to Apple's sandbox, which refuses it, and
  the registration is deleted (SETUP section 5). The run's own path to Apple can be checked on
  production once it sends, with the same device.

## The iPhone app's foundations (packages/mobile, apps/ios)

The first iOS step (iOS build spec, phase 0.1): the generator that feeds the app, its first two
fixtures, and the Swift package that holds the app's API models, tested on Linux.

- **Fixtures are the server's own answers.** `packages/mobile` asks the real `handleToday` with
  the app's query (`todayQuery` with `ahead=snow`), `DATA_SOURCE=synthetic`, the clock fixed, and
  the synthetic upstream on the same clock. `handleToday` gains an optional third argument for
  that, the function that makes its dependencies; every platform takes the default, `createDeps`,
  so the website is unchanged. Each fixture has a memory cache of its own, so none depends on one
  made before it. A file is the response as sent, in the server's key order and two-space
  indented, with `_fixture` (the query, the moment and a note) first.
- **The two fixtures.** `aberdeen-snow` is the spec's: 9:05am on 2 December 2026, snow today and
  for the rest of the day in every hour ahead, though it is raining at the time, so Now says No.
  `leeds-dry` is 9:05am on 1 December 2026, chosen because the synthetic forecast for Leeds then
  says No today (rain, not snow), No tomorrow (dry) and No for the week (a few flakes on
  Saturday), so every reason appears; in the hours ahead the rest of the day turns from rain to
  dry at 2pm. The vitest tests assert those answers, not only that the files exist.
- **`pnpm mobile:generate` and `pnpm mobile:check`.** The script does the reading and writing;
  the package is pure but for the synthetic upstream, which runs in memory. The generator owns
  its output folders: generating removes a file it no longer writes, and the check fails on a
  missing, changed or stale file and names each one. The check runs in `ci.yml`'s check job and
  in `ios.yml`.
- **Where the fixtures live.** The spec puts them in `IsItLogicTests/Resources/Fixtures`, but the
  model tests decode them first, and the spec's model tests read the query and grid vectors too.
  So they are in one test-only target, `IsItTestSupport` (`Tests/IsItTestSupport`, with the
  loader `Fixtures`), which every test target depends on; the vectors will join them there. It is
  not a product, so no app links it. Prettier leaves the folder alone, as it does the other
  fixtures.
- **`IsItModel`** has Appendix C's types, as `Codable`, `Sendable` and `Equatable` value types
  (the app will save the response it decoded). Decoding is lenient where section 4 asks:
  `@Lenient` turns a block that is missing, null or malformed into `nil` instead of failing the
  response, for `snow`, `snow.now`, `snow.week`, `snow.ahead`, `links` and `updated`, and for
  `nearby`, the other optional block the app can do without. Bands, reasons, confidence and
  location sources decode a value the app doesn't know as `.unknown`. What the app can't do
  without (the place, units, `updatedAt`, the credits, the snow days) still fails. Dates are ISO
  8601 with or without fractional seconds, parsed with `Date.ISO8601FormatStyle`, a value type,
  so there is no shared formatter. Now's `series` isn't decoded: the next hours come from
  `ahead`. The memberwise initialisers stay internal until something outside needs them.
- **`IsItLogic` is a placeholder** that compiles: one file and no public API until phase 3's first
  port, which brings `IsItLogicTests` with it.
- **Swift Testing**, not XCTest: parameterised cases suit the golden vectors, and both `swift test`
  on Linux and Xcode 26 run it.
- **Lint.** `apps/ios/.swift-format` is swift-format's defaults written out in full, so a newer
  toolchain can't change them quietly, with Prettier's two-space indent and 100 columns. On top of
  the defaults: no `try!`, no implicitly unwrapped optionals, literals for empty collections, and
  no blank lines just inside braces.
- **`ios.yml`** has the two Linux jobs for now: `generated` (`pnpm mobile:check`) and
  `swift-linux` (`swift:6.3.3-noble` with `tzdata`; the lint, then `swift test`). The macOS jobs
  come with the app skeleton. Its paths add the synthetic upstream, the city list and the script
  to the spec's, since the fixtures are made from them.

## The iPhone app's skeleton (apps/ios)

The iOS build spec's PRs 0.2 and 0.3: the XcodeGen project, the app and its widget, the debug
hooks, their tests and the macOS CI. `apps/ios/README.md` says how to build it and how agents
read CI; this records where the build fills or differs from the spec.

- **Keys are generated now.** `SharedStore` needs the App Group keys and the store version, and
  the spec never retypes them, so `pnpm mobile:generate` writes `IsItModel/Generated/Keys.swift`
  from the client's `keys.ts` (phase 2.2's first emitter, with the escaping and identifier rules
  and their tests). The generator owns that folder too, so a stale file there fails the check.
- **IsItKit has four modules so far:** `IsItServices` (`SharedStore`), `IsItAds` (Google Mobile
  Ads 13.11.0 and UMP 3.1.0, exact; nothing runs yet), `IsItUI` (the skeleton's answer view) and
  `IsItWidgetUI` (the widget's entry, provider and view, there so an app-hosted test can draw
  it). `SnowKit` comes with the first snow-only code; SwiftPM refuses an empty target.
- **The saved answer.** `SharedStore` writes `{ v, savedAt, key, response }` to
  `Library/Caches/today.v1.json` in the group's container, and ignores a file from another store
  version. Without the App Group, Debug builds of the app fall back to their own defaults and
  caches (`DebugHooks.storeFallback`, so the conditional stays in `DebugHooks.swift`); the widget
  never does, since only the app saves answers. A fixture is saved under the key
  `fixture:<name>`: the place keys are ported in phase 3.
- **The skeleton's widget** is the small family only, one entry with no reload: the app reloads
  the timelines when it saves. With nothing saved it draws the shape of an answer with no words.
  It has no gallery name or description yet, because those are app copy (phase 2.2). It can't
  show an old answer as current, because until the app fetches, the only answer it can find is a
  Debug fixture.
- **Fixtures in the app.** Debug builds bundle the `Fixtures` folder IsItCore's tests read, as a
  folder reference; `EXCLUDED_SOURCE_FILE_NAMES = Fixtures` leaves it out of Release. The unit
  test bundle has its own copy.
- **XCTest in the app's test bundles,** where IsItCore uses Swift Testing: UI tests need it, and
  `XCTAttachment` with `lifetime = .keepAlways` is what `xcresulttool export attachments` is known
  to export. The unit tests are hosted by the app, so they run with its entitlements, and they
  read the App Group back through the widget's own provider. They link IsItWidgetUI themselves,
  which the app doesn't.
- **What the skeleton leaves out of the Info.plist,** each until the phase that brings what it
  names: `UIAppFonts` (the font), `SKAdNetworkItems` (the ads), the `LaunchBackground` colour
  (the palettes; `UILaunchScreen` is empty), the app icon, the StoreKit configuration and the
  `FEATURE_*` switches. The privacy manifests declare UserDefaults (CA92.1 and 1C8F.1 for the
  app, 1C8F.1 for the widget) and no collected data, until location and notifications arrive.
  Phase 2.3 added the font and the icon.
- **XcodeGen's presets.** XcodeGen adds Xcode's template settings to each target unless a
  project xcconfig names the setting, so `Base.xcconfig` is what decides the device family
  (iPhone only), the Swift version and the icon (none; since phase 2.3 project.yml names the
  app's). Checked by generating the project on
  Linux with XcodeGen 2.46.0 built from source.
- **Test plans** name targets by their object IDs, which XcodeGen derives from the project's and
  target's names only (the same from any folder, on Linux or a Mac). `ci/xcodegen.sh` checks them
  after generating.
- **`Package.resolved`** was made on Linux by `swift package resolve`, which writes it before
  failing to download Google's binary zips (dl.google.com is blocked in the agents' container).
  Its `originHash` is IsItKit's manifest's, not the project's; that doesn't matter, because CI
  builds with `-disableAutomaticPackageResolution`, which uses the file as a lock file and never
  compares the hash. If CI can't use it, the job keeps the file Xcode writes, as an artefact and
  as a diff in the log.
- **CI additions to the spec's sketch.** `ci/simulator.sh` finds or makes the iPhone 17 on iOS
  26.5. `ci/test.sh` also summarises the build-for-testing step, so compiler errors appear with
  file and line. Every summary goes to the job log as well as the step summary, because the log
  is what the GitHub MCP tools return. `ci/release-check.sh` builds Release on every run and
  fails on a debug hook's name in a binary, a bundled fixture, or ads code in the widget;
  phase 0.4's archive check covers the signed archive. The resolve step uses
  `-onlyUsePackageVersionsFromResolvedFile`, the builds `-disableAutomaticPackageResolution`.
- **The contact sheet** draws every attachment at a third of its pixels, so screens and widgets
  appear at their true relative size, with labels in a 5×7 pixel font built into the script
  (pngjs only; no system fonts on the runner to depend on). Agents can't download artefacts from
  the container yet: GitHub serves them from Azure blob storage, which its network policy denies.

## The iPhone app's release job (apps/ios, scripts)

The iOS build spec's PR 0.4: `ios-release.yml`, which signs the app through App Store Connect and
uploads it to TestFlight, and `scripts/check-archive.sh`, which checks a build first.
`apps/ios/README.md` says how Carl runs it; this records where it fills or differs from the spec.

- **Debug hooks hide in short literals.** Swift keeps a string of up to 15 bytes inside the
  String value, and with `-O` the compiler builds a literal one in registers. Checked on 23
  October 2026: `swiftc -O` 6.3.3 IR for the hooks, compiled by its LLVM 21 for
  `arm64-apple-ios17.0`, builds `-uitest` with `mov x19, #0x752d` and three `movk`s, and strings(1)
  finds none of `-uitest`, `-fixture` or `-umpGeography` in the object (on x86-64 it does, because
  `movabs` keeps the 8 bytes together). Every hook in the spec's list is 15 bytes or fewer, so a
  strings-only check passes an optimised build with every hook compiled in. Long literals, type
  names (`URLProtocolStub`) and literals stored as data (an array of them) are found. So
  `scripts/swift-small-strings.mjs` rebuilds the short ASCII literals from arm64 `movz`/`movk`
  sequences, joining a 9-to-15-byte literal's two words, and `check-archive.sh` and
  `ci/release-check.sh` look in its output as well as in strings'. The tests use LLVM's own
  instruction words.
- **A literal's moves needn't be together** (found in review). With Apple's CPU models (apple-a7
  to apple-a17, apple-m1) each constant's `movz` and `movk`s sat side by side in the probes, but
  LLVM's generic model schedules them among other constants': 9 instructions apart for
  `contains("-uitest")`, 26 for six literals passed to one call. The first reader followed a
  register for 8 instructions, so it read `-uites`, and an archive with that hook compiled in
  passed. It now follows it for 64, until another move to that register or a `movk` for a 16-bit
  piece the constant already has. Joining a first word to the nearest second word is a guess,
  too: in the probes the nearest was often another string's, under every model, and the compiler
  can derive one second word from another (`add x1, x21, #0x23` turns `-forceEEA`'s into
  `-unlocked`'s, which the reader can't follow, so it reads `-unlockeA`). So `check-archive.sh`
  matches a hook of 8 bytes or more by its first 8, whatever follows them. Checked on 23 October 2026 with probes naming all twelve
  hooks through `contains`, `firstIndex(of:)`, `switch`, `==`, dictionary lookups and call
  arguments, for each of those CPU models: the reader recovers every hook's first word whole, and
  the check reports all twelve.
- **What `check-archive.sh` adds to the spec's list:** the fixtures (as `release-check.sh` checks
  the simulator build); `CFBundleShortVersionString` as well as `CFBundleVersion`, and
  `BUILD_NUMBER` when given; Google's consent SDK and an embedded framework as ways the widget
  could link ads; `get-task-allow` on neither signed bundle; and the rest of section 9.8's launch
  arguments (`-now`, `-clock`, `-unlocked`, `-noads`, `-resetStore`), matched only as whole short
  literals, since as substrings they'd match ordinary text. With ads test it fails on any
  publisher but Google's demo one, not only Carl's, so it needs no variable before C15; with
  `ADMOB_APP_ID` set, his publisher ID's digits must appear nowhere. With ads real the units must
  be well-formed and equal the variables. If Google's SDK, linked into the app, names its own
  demo publisher, a real build would fail; a test build says so in a notice, so it shows long
  before the release candidate.
- **Testable on Linux.** The reads that need macOS go through `plutil -convert xml1` and
  `codesign -d --entitlements - --xml` (the `:-` form the spec names is deprecated), named by
  `PLUTIL` and `CODESIGN`, and a small awk reader takes values from plutil's XML, so the tests
  stand in two short fakes and build archive and Payload trees in a temp folder. Each failure the
  spec lists has a test, and so does a passing archive and a passing `.ipa`.
- **The key** is written by `scripts/asc-key.mjs` with `asc.mjs` `keyPem`, the rule C12 needed
  (the raw `.p8` text with any line breaks, or base64; the spec's 18.3 said base64 only), after
  checking it is a usable key and that `ASC_KEY_ID` is 10 capital letters and digits, since the
  file name is built from it. The folder is mode 700 and the file 600, and a step that always
  runs deletes the folder. Each secret is given only to the steps that use it, and checkout keeps
  no token.
- **The release job resolves afresh.** No cache of `.spm` or XcodeGen: SwiftPM downloads Google's
  SDKs and checks them against their manifests' checksums, and `xcodegen.sh` checks its zip, so
  nothing restored from a cache goes into an App Store build.
- **Unsigned, two ways.** Phase 0.4 planned to stop after an unsigned archive until C12 existed.
  C12 exists, so the release job signs by default, and its `build: unsigned` input still builds
  and checks an unsigned archive with no key or approval. `ios.yml`'s `archive-check` job does the
  same on every pull request.
- **ExportOptions** sets `manageAppVersionAndBuildNumber` to false, so Xcode can't renumber the
  build the checks passed (its default for App Store Connect is true), and `uploadSymbols`.
  `archive.sh` checks its `teamID` against `Configs/Team.xcconfig`, and `APPLE_TEAM_ID` against
  both.
- **The upload's fallbacks are automatic** (section 18.3, step 5): altool, then a second export
  with destination upload, then fastlane 2.241.1's pilot, installed only when both of Apple's
  ways fail (pinned; its own dependencies aren't). When App Store Connect refuses the build
  itself (an ITMS or validation error, such as the missing icon until phase 2.3), it stops,
  since every way would get the same answer. `scripts/test/upload.test.mjs` drives the order
  with stand-ins.
- **What to Test** (section 21.1) is set through the API: `scripts/asc-notes.mjs` waits up to 20
  minutes for the build to be listed, then adds or updates its English (UK)
  `betaBuildLocalizations`, retrying while App Store Connect refuses changes. It warns rather
  than fails, since the build is uploaded by then.
- **Not yet:** the `rc-archive` artefact (section 21.2), with the release candidate. The signed
  archive embeds a development profile, which lists the team's registered devices, so whether to
  publish it on a public repo is a decision for then. Unproven until the first run: cloud signing
  of the archive (development signing may need a registered iPhone, and may add a certificate per
  run; the README's table says what to do), and altool on Xcode 26.6.

## The iPhone app's fixtures and golden vectors (packages/mobile)

The iOS build spec's PRs 2.1 and 2.4: every fixture in section 7.3 and every vector file in
section 7.4, written by `pnpm mobile:generate` into IsItCore's test resources and checked by
`pnpm mobile:check`. This records where they fill or differ from the spec.

- **21 fixtures, each the real `handleToday`'s answer.** Where the synthetic data can't give a
  state, the upstream is changed and the server does the rest: `relabelZone` for the offset
  zones, `onlyModels` for `limited` (ECMWF and GFS answer, the other four send null), `endsAfter`
  for a forecast that stops, and an upstream that is down for `stale`, which the server answers
  from a forecast it cached two hours before. That makes `stale` and `limited` real answers
  rather than edited ones, so `stale` has the old `updatedAt` with today worked out now, as the
  server sends it. Only `no-week` and `no-now` edit the answer (deleting `snow.week` or
  `snow.now`), and `old-forecast` is a real answer whose `_fixture.now` is 7 hours after it:
  the server never answers with a copy past the stale limit, so that state exists only on the
  phone. Each `_fixture.note` says how its file was made.
- **Moments the synthetic data needed.** Durham on 1 December says No tomorrow, so
  `durham-tomorrow` is 6:05pm on 16 December (Yes tomorrow from all 6 forecasts; its last hour
  ahead is midnight, the 17th's). The spec gives no moment for `shrewsbury-maybe` (9:05am on 12
  December), `denver-f` (9:05am MST on 28 January 2027: Denver seldom snows on the synthetic
  data, and that day has Maybe tomorrow, in inches) or `kolkata-0530` (9:10pm, so the hours
  ahead cross midnight). The searched places are at 5:30pm on 2 December, as the spec says.
  Reykjavík and Denver keep the synthetic source's whole-hour zones (`Etc/GMT+1`, `Etc/GMT+7`);
  only the offset zones are relabelled.
- **`relabelZone` moves whole days too.** Kiritimati is UTC+14 and the synthetic zone for its
  longitude UTC-10, a day behind, so with the hour strings left alone its forecast would start
  the day before and its week would have six days. Where the two offsets are a whole day apart
  the dates move by that day; the hours stay as they are, which is what puts them off the UTC
  hour.
- **The clock changes are four files** (`london-dst-autumn-night`, `-autumn-evening`,
  `-spring-night`, `-spring-evening`), one per moment the spec gives. The forecast has one UTC
  offset throughout, as Open-Meteo's `utc_offset_seconds` and the parser have it, so the hours
  ahead are right (1am twice in October, none in March) but on those two nights tomorrow's
  `from` is an hour out: 11pm GMT on 25 October, 1am BST on 29 March. The fixtures record the
  server as it answers.
- **One fixture more than the spec: `forecast-ends`.** Section 7.4's tomorrow cases need a
  response with no `days[1]`, and section 6.5 one whose last hour ahead ends before the stale
  cut-off; no real forecast does either. Leeds at 8:05pm with the upstream's forecast stopping at
  midnight does both: no tomorrow, no week, three hours ahead.
- **A vector file** is `{ fn, source, cases }`, with each case `{ fn, in, out }`, because most
  files cover several functions; `fn` lists them and `source` says where each comes from
  (`client@pickHour`). Moments are epoch milliseconds, as the client takes them. An answer is
  named by its fixture (`in.fixture`), and where a function returns one of the answer's own snow
  objects (pickHour's Now, today and week, the middle view's day, a widget entry's day) the vector
  has its path in that fixture ("snow.ahead.2.today"), which the Swift test reads back: the same
  object, compared whole, and the files stay under 1 MB. The generator refuses Infinity, NaN and
  holes, which JSON would write as null, and a path that isn't the answer's own object.
- **One case to a line,** so a changed answer is a changed line in review, and a mismatch can be
  found by its index.
- **Every output comes from the reference,** and a vitest test calls each function again from
  each case's input alone and compares, so a case can't say one thing and test another.
  `updatedLine`'s cases are also checked against core `updatedTime` at the same moment, as
  section 6.4 asks. `query.json` has no `windUnits` (the apps never send it) and adds
  `searchQuery`, which the picker needs. The vitest tests also check that each file covers what
  section 7.4 lists for it.
- **`IsItTestSupport` loads them:** `Vectors.cases(file, fn:, input:, output:)` decodes one
  function's cases as that function's own types and skips the rest, and `Fixtures.info` reads
  `_fixture`. The Swift tests check that every fixture decodes and shows its state, and that
  every vector file is there and names fixtures that exist. IsItLogic is untouched: its ports
  and their tests are phase 3.
- **Found on the way, not changed here:** with a phone clock behind the server across 6pm
  (planned at 5:59pm from a 6:05pm answer), `widgetEntries` has no entry at 6pm, since entries
  start only at the hours ahead, so a widget would say Today until 7pm. The vectors pin today's
  behaviour; whether to add the place's 6pm and midnight as boundaries is a client change for a
  PR of its own.

## The iPhone app's copy, constants and palettes (packages/mobile)

The iOS build spec's PR 2.2: the Swift emitters of section 7.1. `pnpm mobile:generate` now writes
`CoreCopy`, `Questions`, `AppCopy`, `Constants` and `Keys` into IsItModel's `Generated` folder,
and `Palettes` into IsItUI's, which the generator owns too, so a stale file there fails the check.
(Since the review of phases 2 and 3, `Palettes` is in IsItModel's too, and the App Shortcut's
strings are not in `AppCopy`: see "The iPhone app's phases 2 and 3, reviewed".)

- **The Swift is written as swift-format writes it,** so `swift format lint --strict` passes on
  every generated file: a declaration that would pass 100 columns breaks after its `=` (or a
  `case` after its colon), and a string literal too long for a line stays whole on a line of its
  own, which swift-format accepts since it can't break one. A call that doesn't fit has an
  argument on each line. Integers from five digits are grouped in threes (`1_800_000`;
  swift-format asks from seven). Strings are escaped by one rule (`swiftString`), so apostrophes,
  curly quotes and `$` are written as they are and a backslash can never start an
  interpolation.
- **`CoreCopy`** has the `COPY` keys the app uses (`CORE_COPY_KEYS`: section 10.9's list, plus
  the picker's title and Close, "Finding you…", the switcher's label and the three credits), in
  `COPY`'s order. `UNITS_LABELS.snow` is `snowUnitsLabel`, written once. The labels keyed by a
  view, units, band, reason or error code are functions over the Swift type with a `case` per
  key (`CoreCopy.viewLabel(_:)`, `snowUnitName(_:)`, `snowBandLabel(_:)`,
  `snowReasonLabel(_:)`, `errorMessage(code:)`), so a key core adds that Swift lacks fails the
  build; a band or reason the app doesn't know has no label (nil). `AppView` (now, today,
  week) is new in IsItModel, with core's raw values.
- **`Questions`** is core's `question()` itself, called for each view, with and without a place,
  `tomorrow` false and true, asked for the place `{place}`: twelve templates the Swift picks
  from and puts the place into, so it has no rules of its own. A nil or empty place asks without
  one, as core does. The generator stops if a template doesn't have the slot exactly once.
- **`appCopy.ts` is the one place app copy lives.** A string with `{name}` slots becomes a
  function taking a `String` for each (`AppCopy.placeButtonLabel(place:)`), so a slot can't be
  left unfilled. Three strings section 10 words but 10.9's table leaves out are added:
  `upgradeSettings` (10.4's row), `reportAdSubject` and `reportAdMail` (10.7's email). Since
  Carl's Q2 put "will it snow?" under the icon, the strings that said "willitsnow" for the app
  now say "the app" ("Notifications are off for this app in Settings.", "Open the app to turn on
  widgets."); the email's subject names willitsnow.today. The tests hold every string to the
  spec's rules: no "alert", "warning" or "danger" outside the notifications footer, no stray
  spaces, British spelling, sentence case (capitals only to start a sentence, or in a short list
  of names: Apple Account, Family Sharing, Privacy choices, Settings, Safari, Met Office, Apple,
  Google, UK, °C, °F), and no other weather type, website or app.
- **`Constants`** keeps the TypeScript's names and units (`Constants.Client.refreshAfterMs`,
  ms; `Constants.Cache.forecastStale`, seconds). The groups written whole (`SEARCH`, `AHEAD`,
  `WIDGET`, `CLIENT`) gain a member when a key is added, and stop the generator when the new
  value isn't a whole number, so a type is chosen rather than guessed; snow's shares and
  thresholds are declared `Double`, whole numbers too. `Constants.Alerts` names its one value,
  `heartbeatDays`, as `Cache` and `Grid` do: the notifications work (PR #30) added the run's
  windows, quiet hours and budgets to core's `ALERTS`, and the app needs none of them.
- **The models' agencies move into core** (`MODEL_AGENCIES` in `copy.ts`) from the About page,
  which now reads them there, unchanged: the spec's `MODELS (names and agencies)` assumed core had
  them, and the app's credits must say the same. Data only, so core's coverage is unchanged;
  `Constants.models` has each model's id, name and agency, and the generator stops on a model
  without one.
- **`Palettes`** are core's `SNOW_PALETTES` as plain data: colours as `0xRRGGBB` (`UInt32`), the
  glow as 0 to 1, and ink's WCAG 2 contrast against `g1` and `g2`, worked out as
  `scripts/palette-contrast.mjs` does and rounded down to two decimals, so a pair under 4.5:1 can
  never read as 4.5. The file imports only IsItModel (for `SnowBand`; an unknown band draws as
  `nosnow`), so it compiles anywhere: it was compiled and checked on Linux in a scratch package
  beside IsItModel. IsItUI's `Color(rgb:)` is the only SwiftUI part. The contrast test
  (`PaletteTests`) is in the app's unit tests, the only Apple tests CI runs, so
  `WillItSnowTests` now links IsItUI; it checks the ratios against the colours and 4.5:1, as the
  vitest test does.
- **Not yet:** the widget's gallery name and description, and the strings the screens will need
  that section 10 doesn't word yet (a Now row's "60% chance at 6pm", for example): each is added
  to `appCopy.ts` by the phase that builds its screen.

## The iPhone app's glyphs, icon and answer font (packages/mobile, apps/ios)

The iOS build spec's PR 2.3: the snow glyphs as asset catalogues (V7), the app icon (Q9) and
`BricolageAnswer.ttf`, all written by `pnpm mobile:generate` and checked by `pnpm mobile:check`.
This records where the build fills or differs from the spec.

- **The glyphs are template image sets.** `exportGlyphs.ts` takes `SNOW_GLYPHS` as strings (the
  script imports them; the package reads nothing) and wraps each in an SVG drawn as the website
  draws it (stroke 3, round caps and joins, on a group rather than the `<svg>`, where Core SVG is
  surest to inherit it), with `currentColor` made black. The sets are marked
  `template-rendering-intent: template` and `preserves-vector-representation`, so SwiftUI tints
  them with the foreground style and keeps them sharp at any size. The generator refuses what a
  template can't show as the website does: text, an element other than a shape or group, a
  colour other than `currentColor`, a CSS variable or reference, a `style`, and any class but
  a top-level `drift`. So a glyph drawn in two colours, as Hot's are, fails the generator rather than
  drawing wrong.
- **"Plus a drift layer" is two layers.** A drift layer alone can't move the flakes: drawn over
  the whole glyph, they would be doubled. So a glyph with drifting flakes has three sets: the
  whole glyph under the band's name (widgets, Reduce Motion, the resting state), `<band>-still`
  (all but the flakes) and `<band>-drift` (the flakes). In one colour, painting order doesn't
  change what is covered, so the still layer under the drift layer is the whole glyph exactly.
  `nosnow` has nothing that drifts and only the whole set: 16 sets for 6 glyphs.
- **The PNG fallback is a whole second catalogue.** `SnowKit/Fallback/Glyphs.xcassets` has the
  same 16 sets as 1x, 2x and 3x PNGs rendered by resvg, also template images. IsItKit's
  `Package.swift` excludes it; switching (V7) is processing it instead of
  `Resources/Glyphs.xcassets`, two lines, with nothing to regenerate. PNGs sitting unassigned in
  the SVG sets would have drawn actool warnings instead.
- **`Glyphs` in SnowKit.** `Glyphs.image(band)` is the whole glyph and `Glyphs.layers(band)` the
  two layers (nil for `nosnow`), as decorative images, as the website hides them from screen
  readers. A band with no glyph (`unknown`) draws as `nosnow`. The set names come from the
  generated `GlyphAssets.swift`, so nothing is retyped. SnowKit exists now (SwiftPM refuses an
  empty target); the app, the widget and the unit tests link it.
- **PNGs are byte for byte the same anywhere.** pngjs filters rows the same way every time and
  deflates with Z_RLE. Node's zlib is Chromium's fork, whose default strategy gives other bytes
  than canonical zlib (checked on 23 October 2026: 454,405 against 460,915 bytes for the same
  input), but its Z_RLE output is identical, since RLE never uses the hash the forks change. So
  `pnpm mobile:check` agrees with what any machine generated. The icons are 32 to 105 KB and the
  48 fallback PNGs 159 KB in all.
- **The icon** is the snow favicon, full bleed: its rounded rectangle becomes a square (iOS
  rounds the corners) and nothing is transparent. Dark (iOS 18) keeps a quarter of each gradient
  colour (`#271731` to `#170920`) with the flake its top colour half way to white (`#cdaee2`);
  tinted is a white flake on black, for iOS to tint. Each is a 1024×1024 RGB PNG, with no alpha
  channel (App Store Connect refuses one): rendering fails unless every pixel is opaque, and the
  PNG's colour type is checked. The colours derive from the favicon's, so the icon follows it.
  Carl approves it (Q9); the three PNGs show in the pull request's files.
- **The font is the website's, renamed.** `make-answer-font.py --ttf` builds the same instance
  and subset as the woff2, and refuses unless every table but the name table and head's
  timestamps matches the committed woff2 as fontTools decodes it. Two subset options make the
  script reproduce the committed woff2 with fontTools 4.66.1: `.notdef` keeps its outline and the
  name table keeps the licence URL, as the committed file has (without them, 4.66.1 drops both).
  The woff2 itself isn't rebuilt: with brotli 1.2 it would be 7,708 bytes rather than 7,680, the
  same font. The TrueType font is named `BricolageAnswer` (family, full and PostScript name), the
  name `Font.custom` asks for; the original names would have made it fall back silently. The
  font has no reserved name, so the OFL allows that; its copyright stays, and the name table
  gains the licence's description beside its URL. It keeps the source's timestamps, so two
  builds are identical (15,740 bytes).
- **The font is checked without Python.** CI's checks run Node alone. The font's version string
  ends with its recipe, a SHA-256 of the script, the source font and the website's woff2, and
  `exportFont.ts` compares it with the recipe of the files now, and checks every table's
  checksum and the font's. So editing the script or the woff2, or upgrading the source font,
  fails `pnpm mobile:check` until the font is rebuilt, and a damaged file fails it too.
  `pnpm mobile:generate` runs the Python (fontTools 4.66.1 exactly, which the script insists on,
  and brotli) only then, and checks the new font carries the recipe the TypeScript expects.
- **Where they live.** The generator owns the app's whole `Assets.xcassets` (the icon now; the
  `LaunchBackground` colour comes from the palettes, so it belongs there too), the `Fonts`
  folder, both glyph catalogues and SnowKit's `Generated` folder, at any depth, and removes
  folders a stale file leaves empty. Prettier leaves the catalogues alone.
- **The project.** Only the app names `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`
  (project.yml); `Base.xcconfig` keeps it empty for every other target. The font is a resource of
  the app (through `Apps/Snow/Resources`) and of the widget (its own source entry), and both
  Info.plists list it in `UIAppFonts`. Generated with XcodeGen 2.46.0 built from source: the
  app's resources hold `Assets.xcassets` and the font, the widget's the same font file, and both
  link SnowKit; the widget still links no IsItAds.
- **Checks.** `check-archive.sh` now fails without the icon (`Assets.car`, and
  `CFBundleIconName` `AppIcon` in the Info.plist) or without the font in either bundle and its
  `UIAppFonts`. `GlyphSnapshotTests` draws every glyph, whole and as its layers, in its band's
  ink on its band's gradient (the generated palettes) for the contact sheet, without forcing
  template rendering, so a glyph that lost it shows black: the first macOS run settles V7. `AnswerFontTests` checks the app registers the font as
  `BricolageAnswer`. On Linux, SnowKit's Swift was type-checked against a stub `Image` with
  SwiftUI's `init(decorative:bundle:)`, and every band's names checked against the catalogue.

## The iPhone app's ports and the vector guard (IsItCore, phase 3)

Phase 3 ports the shared rules to Swift, each checked against its vector file (spec sections 7.4
and 9.2), and its exit asks for a test that the set of vector files the tests load equals the set
generated, so none is skipped. This is in place before the first port, so the porters can work in
parallel against it.

- **One test target holds every port's golden test.** `IsItLogicTests` depends on IsItLogic,
  IsItModel and IsItTestSupport, and 3.2's ports (`Target`, `TodayQuery`, `GridRounding`, in
  IsItModel) are checked there too, so one guard sees every file. The vectors stay in
  IsItTestSupport's resources, beside the fixtures they name.
- **The guard runs the ports rather than watching for them.** Swift Testing runs tests in
  parallel, in any order, with no hook after the last, so no test can see which files the others
  loaded. Instead each port is a `VectorPort` (a check given the whole file) listed in
  `PortedVectors.all`, and `VectorCoverageTests` has a test case for each file pnpm
  mobile:generate writes: it loads the file and runs its port. Listed and loaded are then the
  same thing. It fails for a generated file that isn't listed, a listed file that isn't
  generated, a file whose port is still nil, and a port that leaves a case of any function in
  its file unchecked (`VectorFile.unchecked`), so the guard covers every case, not only every
  file. (Until the review of phases 2 and 3 it counted a function whose cases were read as
  covered, `VectorFile.unread`.)
- **It fails until phase 3 lands,** with one issue per file not yet ported, naming the pull
  request and the Swift that ports it; on 23 October 2026 that is all 13 files, listed in
  `apps/ios/README.md`. So `swift test` in IsItCore exits non-zero meanwhile, and `ios.yml`'s
  `swift-linux` job fails, which also keeps the macOS jobs that need it from running. Nothing is
  skipped or marked as a known issue to hide that: each port turns its own files green. With
  3.4, every file is ported, and the guard passes.
- **Parallel porters change different lines.** Each `PortedVectors.all` entry is a comment and a
  line, with a blank line after it, so ports of different files merge without conflicts, and each
  port lives in a test file of its own.
- **The loader.** `VectorFile` reads a file's `{ fn, source, cases }` once, decodes one
  function's cases as that function's own types when a test asks for them, and notes each case a
  check has run on (`forEachCase`). `file.compare(fn, input:, output:) { port }` checks the port
  on each case, equal and with the same text code unit for code unit (`sameText`), and, on a
  mismatch, names the file, the case's index, the function and its input, with both values. `Fixtures.decode(_:at:in:decoder:)` reads back an answer's object by the
  path a vector names (`snow.ahead.2.today`), as `atPath` does in `vectors.ts`; a test checks it
  against the decoded answer for every day, Now, week and hour ahead in all 21 fixtures.

## The iPhone app's places and queries (IsItCore, phase 3.2)

3.2 ports the client's targets and queries and core's grid rounding into IsItModel (spec sections
6.1, 6.2 and 9.2): `Target` (`.key`, `.device(lat:lon:)`, `Target(search:)`, `Target(query:)`),
`TodayQuery` (`.build(_:units:ahead:)`, `.fresh(_:now:)`, `.search(_:)`) and
`GridRounding.round(_:step:)`, each checked against `target.json`, `query.json` and `grid.json`,
and registered with the vector guard.

- **JavaScript's arithmetic is ported, not approximated,** because a key or a query that differs
  by one character is another cache entry, or another place. `String(n)` is written from Swift's
  shortest digits (the same digits; Swift writes "53.0" and "1e-07" where JavaScript writes "53"
  and "1e-7"). `Math.round` is the floor plus a look at what is left: the spec's
  `((v / step) + 0.5).rounded(.down)` rounds 0.49999999999999994 up to 1, and an odd whole
  number from 2^52 up to the even one above it, and new grid cases pin both.
  `Number(x.toFixed(d))` is worked out from the double's own bits in 128-bit integers (halves
  away from zero on the exact value, as `toFixed` rounds), not as `(x * 10^d).rounded() / 10^d`,
  whose product can round first. The step's decimals come from JavaScript's own writing of it,
  as core's `decimalsOf` counts them, so a step of 1e-7 has none there too.
- **`URLSearchParams` is ported too** (the WHATWG form parser and serializer), with
  `encodeURIComponent` for the search: one leading "?" dropped, empty pairs skipped, the first of
  a repeated name read, "+" as a space, a broken %-escape kept and broken UTF-8 replaced by
  U+FFFD; and `*-._`, letters and digits written as they are. Names and `source=search` are
  compared byte for byte, as JavaScript compares strings, where Swift's `==` would treat
  canonically equivalent text as equal. The server's checks on the numbers (`COORD`, `HEIGHT`,
  `GEONAME_ID`) are written out by hand, since a Swift `Regex`'s `\d` matches any script's
  digits.
- **Null and absent are the same in Swift,** as they are to every rule in the client: it reads
  a name, region or country only when it is a non-empty string. A searched place's `elevation`
  is a `Double` in the target, because a query can carry a fraction (`elevation=-25.5`), which
  the reference keeps; `SearchResult.elevation` is whole metres, as `ApiLocation`'s is.
- **The types the port needed.** `SearchResponse` and `SearchResult` (section 9.2 puts them in
  IsItModel; `Target(search:)` takes a result), and `Topic`, in core's order of topics, which is
  the order `build` writes `ahead` in. `build` has no `windUnits`: the apps never send it, and a
  vector with it would fail, since the reference's query would have it. `fresh` takes a `Date`;
  its hour is `Math.floor(now / HOUR)` of the moment's nearest whole millisecond (`epochMs`), as
  every ported rule reads a `Date` (see "IsItCore, put together" below).
- **What `place.v1` holds** is the client's `Target` JSON, or nothing for approximate IP
  location (section 9.6): `target.stored()` writes it and `Target(stored:)` reads it, falling back
  to IP location for nothing, or for anything that isn't a target, as the website reads its
  own. **The query contract** (sections 11.2 and 17.2) is `QueryContractTests`: for every target
  in `query.json`'s `todayQuery` cases (all four forms, with the awkward names and numbers) and
  units of °C, °F or none, the query the widget makes from the stored `place.v1` and `units.v1`
  is the app's, and the stored target reads back equal, with the same key.
- **More cases, from the reference.** `grid.json` gains `Math.round`'s edges and steps
  JavaScript writes oddly (1e-7, 0.1 + 0.2), and values from 1e21 up; `target.json` gains how
  `URLSearchParams` reads a query (above) and the server's patterns (ASCII digits only, the whole
  value); `query.json` gains the order of topics (`ahead=hot%2Cwet%2Csnow%2Cwind`), what the
  serializer escapes, and every form `String(n)` writes. JSON has no -0, so no case has one: the
  generator's own test compares the reference's -0 with the file's 0.
- **One quirk of the reference, kept.** A coordinate under 1e-6 in size is written with an
  exponent (`lat=1e-7`), which the server's check and `targetFromQuery` both refuse. No target
  the app makes has one (a coordinate on the grid is 0 or at least 0.05 in size), so the port
  keeps the behaviour, and `query.json` pins it.

## The iPhone app's clock rules (IsItCore, phase 3.3)

PR 3.3 ports the rules for what the app shows when: `PlaceTime`, `MiddleDay`, `Freshness`,
`HourPicker`, `UpdatedLine`, `Questions` and `StripGeometry`, each checked against its vector file
case by case (`placeTime`, `tomorrow`, `freshness`, `hours`, `questions` and `strip`).

- **The clock rules read the hot and rain answers' moments, so the model decodes them.** Client
  `hourUntil` reads rain's today and Now before snow's, and `dayUntil`, `hold`, `outOfDate` and
  core `showsTomorrow` read the hot answer's days and Now. The spec's model decodes neither
  (section 9.2), so `TodayResponse` gains `hotDays` (`days`: their dates), `hotNow` (`now`: its
  time and its series' hours) and `rain` (its days' `from` and its Now's hours), and
  `ApiSnowNow` gains `series` (the hours' moments and dates), each lenient: a damaged block is nil
  and the rest is kept. Nothing else of the hot and rain answers is decoded. Reading snow's
  instead would agree on every fixture, whose answers share their moments, but not with the
  TypeScript for an answer without rain, or with rain but without its Now; the port follows the
  TypeScript.
- **Moments are `Date` in the API and whole milliseconds inside.** The app, its `TimelineView`
  and WidgetKit work in `Date`, so the ports take and return `Date`, but the rules compare and
  add `epochMs` (IsItModel's `Date(epochMs:)` and `.epochMs`, to the nearest millisecond), as the
  TypeScript does, so a hold's `at`, or a moment a millisecond before a boundary, agrees to the
  millisecond rather than to a `Double`'s rounding.
- **`PlaceTime` reads only `TimeZone(identifier:)` and `secondsFromGMT(for:)`** (V4), then a
  Gregorian calendar in UTC reads the shifted clock: no `DateFormatter`, whose patterns and zone
  names differ between Linux and iOS. The seconds are dropped, as core's formatter drops them,
  and an unknown zone is UTC, as in core, down to the four-digit year `toISOString` writes.
- **The fallbacks have vectors of their own.** Every fixture carries rain, snow, both Nows, the
  hot Now and the hours ahead, so no case reached the rules' fallbacks. `vectors.ts` now also
  takes blocks out of two fixtures (`withoutBlocks`: rain, rain's Now, snow's Now, snow, the
  hours ahead or the hot Now), one whose hours start off the UTC hour (Kolkata), where the
  fallbacks give other moments, and one on it (Aberdeen), and records the reference's answers,
  with `in.without` naming what was taken out. The Swift tests take the same blocks out before
  decoding. Each fallback, broken on purpose in the Swift, fails its cases.
- **The strip's amounts are written as JavaScript writes numbers** (`JavaScriptNumber.string`,
  ECMAScript `Number::toString`: Swift's shortest digits, laid out as JavaScript lays them out),
  since core words "0.9cm" with a template string. Its positions are the same `Double` arithmetic
  in the same order, so they are compared exactly.
- **`Questions` needed no Swift of its own:** the generated `Questions.snow(view:place:tomorrow:)`
  passes every case, places that would trip a replacement pattern or an interpolation included.

## The iPhone app's widget plan, notification sync, links and recent places (IsItCore, phase 3.4)

PR 3.4 ports client `widgetEntries`, the notification sync (`alertPlaceAllowed`,
`registrationBody`, `fingerprint`, `alertAction`), the deep links (`parseDeepLink`,
`notificationRoute`) and the recent places (`addRecent`, `removeRecent`) into IsItLogic, as
`WidgetPlanner.entries`, `AlertSync`, `DeepLink` and `RecentPlaces`, each checked case by case
against `widget.json`, `alerts.json`, `links.json` and `recent.json`. With 3.2's and 3.3's files,
every vector file is now ported and the guard passes.

- **Built on 3.2 and 3.3, not beside them.** The widget planner calls `HourPicker.pick`,
  `MiddleDay` and `Freshness.usableUntil`, and the other three take 3.2's `Target`, so the branch
  merges both porters' branches rather than carrying thin copies of their code: nothing is
  duplicated, and the planner is checked against the same pick and middle day as `hours.json`.
- **Moments are `Date` in the API and whole milliseconds inside,** as in 3.3, so a heartbeat
  due to the millisecond, or an hour ahead a millisecond after `now`, agrees with the TypeScript.
  A plan's reload is `WidgetPlan.Reload` (`.never` or `.after(Date)`), WidgetKit's
  `TimelineReloadPolicy` in IsItCore's terms, and `WidgetEntry.date` is the `TimelineEntry` date.
  A week day's `snowy` and `total` stay optional, as the answer's are. The reference's `pickHour`
  non-null assertion becomes a stale entry that no moment reaches (each is before `usableUntil`),
  rather than a crash in a widget.
- **A fingerprint is written as `JSON.stringify` writes it,** keys sorted by UTF-16 code unit at
  every level, numbers as JavaScript writes them (`JavaScriptNumber.string`), and only the quote,
  the backslash and control characters escaped, by a small writer of its own: `JSONEncoder`
  escapes "/" unless told not to, and its key order and number forms are its own, not
  JavaScript's. The app only ever compares its own fingerprints, but the same bytes as the
  reference keep the rule and the vectors exact. They are compared byte for byte, as JavaScript
  compares strings (and so are recent places' keys), where Swift's `==` takes canonically
  equivalent text as the same. `alerts.json` gains a token with every escape and the characters
  written as they are (the slash, DEL, U+2028, accents and emoji).
- **A registration's place is `RegistrationBody.Place`:** a city's slug, or coordinates with the
  query's fields only (an empty name, region or country and a zero geonameId left out, the
  elevation kept), a device's with only `lat`, `lon` and `source`. Swift's `Target` has IP
  location among its cases where the client's `PlaceTarget` excludes it by type, so
  `AlertSync.body` is nil for it, which `alertAction` never asks for (`placeAllowed` first).
- **Links are matched as the reference's pattern matches them,** by hand rather than with
  `NSRegularExpression` or `Regex`: JavaScript's `trim` (its white space and line terminators:
  U+FEFF yes, U+0085 no, unlike Swift's `whitespacesAndNewlines`), lowercased with the same
  Unicode mappings (a Kelvin sign is a k), then the scheme, a host and an optional path of `a` to
  `z`, an optional slash, and the end, a query or a fragment. `links.json` gains the trim and
  Kelvin cases.
- **A notification's payload is `Any?`**, the `userInfo` dictionary (with its `aps`) or any JSON
  as `JSONSerialization` reads it, and each field is read only as a string, as the reference reads
  them with `typeof`. A place route's view is nil for the reference's `'default'`, the place's
  view for the time of day (`MiddleDay.defaultView`); `DeepLink.Route` is `Codable` as the
  client's JSON, for the vectors.
- **Two date readings, as the reference has.** The payload's `date` must be a real calendar date
  (`calendarDay`: `Date.parse`, kept only when `toISOString` gives it back). The place's date from
  `placeToday` is read as V8's `Date.parse` reads YYYY-MM-DD: any day up to 31, rolling over
  ("2026-11-31" is 1 December); anything else is NaN, never today or tomorrow. `Date.parse` also
  reads date-times and other forms, which the port doesn't, so the port takes the place's time as
  a `LocalDateTime` (`DeepLink.route(payload:placeNow:)`), the app's own `PlaceTime.local(_:in:)`,
  whose date is always YYYY-MM-DD, rather than any text. `links.json` gains a leap day, a date
  that isn't one, and the roll-over.
- **Recent places** are `RecentPlaces.adding(_:name:to:max:)` and `.removing(_:from:)`, with
  `slice(0, max)` ported whole: a negative `max` drops that many from the end, and `recent.json`
  gains that case. `RecentPlace` is `Codable` as `recent.v1` keeps it, with 3.2's `Target` JSON.
- **The pinned client findings stay pinned.** The planner reproduces the reference, so a widget
  planned with the phone's clock behind the server across 6pm still has no 6pm entry (the
  packages/mobile section above), and the vectors keep pinning it.
- **Each rule, broken on purpose in the Swift, fails its cases:** the week's four days, a
  heartbeat due exactly, a control character's escape, `trim`'s U+FEFF, the day roll-over, a
  negative cap and an hour ahead at `now` exactly.

## The iPhone app's IsItCore, put together (phase 3)

The three porters' branches (3.2, 3.3 and 3.4) are merged into one with ordinary merge commits.
Every vector file is ported, the guard passes with none left to port, and the package has no
`XCTSkip`: phase 3's exit (spec section 19).

- **One writer of JavaScript's numbers.** 3.2 wrote `JavaScriptNumber.string` in IsItModel, for
  keys and queries, and 3.3 `JavaScript.string` in IsItLogic, for the strip's amounts, which 3.4's
  fingerprint used too: two ports of ECMAScript `Number::toString`. They agreed on 2.5 million
  doubles (random bit patterns, each power of ten from 1e-330 to 1e310 times a few mantissas,
  amounts to the hundredth, -0, NaN and the infinities), so one is kept: 3.2's, in the lower
  module, beside its `Math.round` and `toFixed`. It is `package`, so IsItLogic's ports use it
  without it becoming the apps' API. 3.3's tests of it now test it, in IsItModelTests, unchanged
  otherwise. Broken on purpose, it fails `query.json`, `target.json`, `strip.json` and
  `alerts.json` cases.
- **One hour.** Core `HOUR`, which `freshness.ts`, `query.ts` and `widget.ts` all import, is
  `Date.hourMs` (`package`, beside `epochMs`), for `Freshness`, `WidgetPlanner` and
  `TodayQuery.fresh`, where 3.3 and 3.4 each had a constant of their own and 3.2 counted in
  seconds. The client's own `DAY` (in `alerts.ts` and `links.ts`) and `MINUTE` (`widget.ts`) are
  each file's, and stay each port's.
- **A fresh query reads the moment as the clock rules do.** 3.2's `fresh` floored the seconds
  over 3,600, which agrees with the reference for every whole millisecond, so for every vector,
  but not with the rest of IsItCore for a system clock's moment within half a millisecond before
  the hour: `epochMs` rounds it up to the hour, so `Freshness` counts the hour begun, while the
  fresh query asked for the hour before. It now floors `epochMs` over `Date.hourMs`, as
  `Math.floor(now / HOUR)`; `FreshQueryTests` pins both sides of the half.
- **Nothing else was written twice.** 3.4 built on 3.2's `Target` and 3.3's `HourPicker`,
  `MiddleDay` and `Freshness`, and on 3.3's `FixtureAnswers` in its tests. The byte-for-byte
  string comparisons are one line each, where each rule compares, and stay there.
- **Not proven here:** no app or widget target links IsItLogic yet (`project.yml` links IsItModel
  only), so IsItLogic is built only on Linux until phase 5 uses it; Darwin's Foundation
  (`userInfo` bridging, `JSONDecoder`'s doubles, time zones) is proven only by the macOS jobs,
  which run once `swift-linux` is green.

## The iPhone app's phases 2 and 3, reviewed

What the review of phases 2 and 3 found, and what changed for it.

- **More vectors, from the reference.** Replaying every committed case through the client with
  coverage left some of its branches unreached, so their Swift went unchecked. `alerts.json`
  gains a searched place with an empty name, region and geonameId (as `searchTarget` keeps an
  unnamed result) and one with no name, which a registration leaves out. `widget.json` cases can
  take blocks out as the other files' do (`in.without`): Kolkata and Aberdeen without their hours
  ahead, when fetched and at 6pm, and Durham's evening with no tomorrow in its snow answer while
  the hot answer has one, so an `ok` entry with no middle day, its week from the first day and the
  `nosnow` palette. `hours.json` gains the same evening and an answer whose snow has no days, and
  `freshness.json` answers whose hot days, or whose hot Now's hours, are an empty list. Now every
  branch of the client's `alerts.ts`, `freshness.ts`, `hours.ts` and `widget.ts` is reached by a
  case; only `todayQuery`'s `windUnits` isn't, which the apps never send. Each fallback, broken
  on purpose in the Swift, fails its cases.
- **`withoutBlocks` takes items out of lists.** `snow.days.1` takes that day out (any after it
  move up), and `now.series.*` empties the list, so an answer can lose tomorrow or every hour
  rather than only a field; `FixtureAnswers` takes them out the same way. Where a vector names
  one of the answer's objects by its path, the generator checks the path names the same object in
  the whole fixture (`pathInWhole`), which the Swift reads it from, so taking an item out can't
  move the one a vector names.
- **Query inputs are checked against the URL standard.** Swift's `URLSearchParams` follows the
  WHATWG urlencoded parser, as browsers do, and so the website. Node 22's, which runs the
  reference when the vectors are made, doesn't always: in a pair with a %-escape that decodes to
  broken UTF-8 it mangles raw non-ASCII characters too ("a=%FF€" gives two U+FFFD, where the
  standard gives U+FFFD and €). A vector built on that would pin Node's bug, and the rule that the
  Swift is fixed to match would then break the Swift. So `vectors.ts` reads each `targetFromQuery`
  input and each notification's place with the standard's parser as well (`specFormPairs`), and
  stops when Node reads it otherwise (`assertSpecParse`). Every input so far agrees. A new one
  keeps non-ASCII %-encoded wherever an escape in the same pair is broken UTF-8.
- **The guard counts cases checked, not functions read.** `VectorFile.cases` reads a function's
  cases and checks none; `forEachCase` runs a check over them and notes each case after its check
  has run; `compare` is built on it, and so are the hand-written loops in the hours and widget
  ports. `VectorCoverageTests` fails a function with any case no check ran on, naming how many
  were checked, so a port that read a function's cases and dropped them, or checked only some,
  now fails (both were tried: `removeRecent`'s cases read and dropped, and `pickHour` over its
  first three).
- **Text is compared code unit for code unit.** Swift's `==` takes canonically equivalent text as
  equal, where JavaScript's `===` compares code units, so `compare` also checks `sameText`: every
  string in both values, at any depth and in order (as `Mirror` sees them), the same UTF-8. The
  hours and widget loops check their objects' text the same way. A fingerprint written
  decomposed, and a widget's place name, now fail their cases. Numbers are left to `==`, so a -0
  where the file has 0 (JSON has no -0) doesn't fail.
- **An hour beyond JavaScript's dates is damage.** `ApiClockHour` took any finite number as an
  hour's start, and `epochMs`, an `Int`, trapped on one past `Int`'s range the first time a rule
  read it: a crash in the app or the widget from a valid JSON number. An hour's start must now be
  a moment JavaScript's `Date` can hold (finite, within ±8.64e15 ms, ECMAScript's time range), or
  the series fails to decode and `@Lenient` drops it, as it drops other damage. The reference
  would carry the number through; no server answer has one.
- **A date's fraction is cut to milliseconds,** as `Date.parse` cuts it, rather than rounded
  (".9995Z" is .999). For the forms the server writes, a "Z" and up to three digits, the two
  agreed already. Elsewhere they still differ, and no answer has those forms: JavaScript reads a
  time with no offset as the device's own, which the port refuses, and refuses "+00", which the
  port reads.
- **`PlaceTime` is exact for the zones the API sends,** Open-Meteo's IANA names as written,
  aliases included, from 1582 on, which every vector and fixture is. `Intl` and Foundation differ
  on names the API never sends: Intl reads any case and UTC offsets ("+05:30"), which Foundation
  doesn't, and refuses "GMT+5", which Foundation reads; before 1582 Foundation's calendar is
  Julian. Matching Intl in full would mean porting its parsing of names and ICU's table of
  aliases, for names no answer has, so the boundary is documented on `PlaceTime` instead, and no
  vector names such a zone.
- **A notification's route takes the place's time, not text.** `DeepLink.route(payload:placeNow:)`
  takes a `LocalDateTime` (`PlaceTime.local(_:in:)`) where it took a `String`, so a caller can't
  pass a date-time, which `Date.parse` reads and the port doesn't.
- **The palettes are in IsItModel** (`Generated/Palettes.swift`), not IsItUI as spec section 7.1
  has it. The widget extension links IsItServices, IsItWidgetUI and SnowKit, none of which reached
  IsItUI, so it couldn't have drawn its palette background (spec 11.1) or the locked state's
  `nosnow` (11.3) without linking the app's screens. The file is plain data keyed by `SnowBand`,
  so IsItModel is its natural home: every target reaches it, and it compiles and is tested on
  Linux, where `GeneratedPaletteTests` checks the ratios as the app's `PaletteTests` does.
  `Color(rgb:)` is in SnowKit, the one SwiftUI module the app, the widget and the unit tests all
  link, beside the glyphs it colours. The generator no longer owns IsItUI's `Generated` folder,
  which is gone; the project is unchanged.
- **The App Shortcut's strings are not in `AppCopy`.** App Intents reads the intent's `title` and
  the App Shortcut's phrase when the app is built: the title must be a `LocalizedStringResource`
  literal in the intent's declaration, and the phrase an `AppShortcutPhrase` literal with the
  app's name as `\(.applicationName)`. No `String` constant or function can become either, so
  phase 7 would have had to type them in Swift. They stay in `appCopy.ts`, held to the copy rules,
  as `APP_INTENT_KEYS`; `AppCopy.swift` leaves them out, and the phase that builds the intent
  (spec 11.5) generates them as those literals, with `{app}` written as the token. The Swift
  check of the generated `intentPhrase(app:)` went with the function; `copy.test.ts` still pins
  both strings and the phrase's one slot.
- **Not proven here:** SnowKit's `Color(rgb:)` and the app tests' imports build only on the macOS
  jobs, and what App Intents reads at build time is from Apple's documentation, unchecked on
  Xcode.

## The iPhone app's data and launch (IsItState, phase 5.1)

PR 5.1's data half: the API client, what is stored, `AppModel` and the launch order (iOS build
spec, sections 4 and 9.4 to 9.6). Everything that can be pure is in IsItCore and tested on
Linux; IsItKit only fills its protocols. `apps/ios/README.md` lists the types.

- **A third IsItCore module, `IsItState`,** rather than IsItLogic, which holds only ports of the
  client's TypeScript with vectors. `AppModel` is in it, `@MainActor @Observable`, since
  Observation and the main actor work in the Linux toolchain (Swift 6.3.3), so the launch order
  and the refresh rules are tested there with fakes, in Swift 6 mode. The spec put `APIClient`
  and the clock in IsItServices; they are here instead, over protocols (`HTTPTransport`,
  `AppClock`), with URLSession behind `URLSessionTransport` in IsItServices. The app links
  IsItLogic and IsItState as well; the widget reaches them through IsItServices.
- **Services through `AppEnvironment`:** the client, the clock (`now`, and `schedule(at:_:)`,
  which a test clock keeps until the test runs it, so no test waits on time), the stored state,
  the widget reloads, the later phases' steps (`AppHooks`, with `NoHooks` doing nothing:
  StoreKit in phase 7, the location fix in phase 6, the ads and notifications in phase 8, and
  routes in phases 6 and 8) and the jitter's random source. Every protocol is `Sendable`, so the
  main-actor model can call them across isolation in Swift 6 mode.
- **The launch** (`init(environment:)`, then `launch()`): step 1 in `init`, so the saved answer
  is on the first frame. It paints when its key is the target's, byte for byte as the website
  compares keys, and `HourPicker.pick` is non-nil (nil from `usableUntil` on), and, beyond the
  spec, only in the units asked for, so centimetres never paint for someone who chose inches.
  The fetch is skipped when the answer was saved under `CLIENT.reuseMs` ago, again beyond the
  spec only when it isn't out of date (a quick re-open past the hour still asks) and not saved
  after now (a clock moved back). Out of date, the fetch is the website's `fresh` one: ask, and
  when the answer is still out of date (a fast clock), ask once more with `TodayQuery.fresh`,
  then `Freshness.hold`. Then steps 2 and 4 to 7 call the hooks in the spec's order: the
  entitlement check starts first and is awaited only before the ads (step 5), which start only
  when not unlocked.
- **The first launch** asks by IP location with no units, as section 5.6 says, and keeps the
  server's choice (`res.units`) in `units.v1`, so every later request, the widgets' included,
  carries units. A city page's place that answers 404 `not_found` is dropped for IP location and
  the user is told once (`AppCopy.slugGone`, `notice`), as section 4 says.
- **Keeping current**: a quiet refresh at `Freshness.nextRefreshAt` plus 0 to 90 s of jitter,
  scheduled after every answer and cancelled in the background, so no wait has to outlast the
  phone's sleep. Back in the foreground, section 9.5's rule: after more than
  `CLIENT.refreshAfterMs` away, the view for the time of day and a fetch; sooner, a fetch only
  when the answer is out of date, past `usableUntil`, or missing (until the review, below, the
  website's `wake` rule, which also fetched any answer older than 30 minutes). After a failure:
  offline or 429 (which section 5.6 has the app treat as offline; since the review it is never
  called offline) asks again after `CLIENT.retryAfterMs` plus the jitter, which costs the
  server nothing while there is no connection; any other error waits for the
  next forecast hour of the answer on screen, or with none, for "Try again" or the next return,
  so a broken request can't spend the function quota every minute. Only the newest fetch's
  answer is shown.
- **Offline** is `URLError`'s no-connection codes, `timedOut` among them (a weak signal far more
  often than a slow server, on a phone); `AnswerState` keeps the picked hour until
  `usableUntil`, then the stale state, and with nothing saved says there is no recent forecast.
  The footer's line is `AppCopy.offline` with `UpdatedLine`; an answer without `updated` has
  none. An error keeps the answer on screen, and the message is the server's, or
  `CoreCopy.unavailable` when it sent none (which the page says too since the review, below).
- **What is stored.** `SavedToday` moved from IsItServices to IsItModel, with its codec: `v` is
  read first, on its own, so another version's file is ignored whatever it holds.
  `StoredUnlock` reads `unlock.v1` as `{ unlocked, checkedAt, productID }` JSON, the API's dates
  in it; phase 7's StoreKit code writes it. `SharedStore` is the App Group's `StoredState`, and
  `MemoryState` stands in when a Release build can't open the group (nothing is kept; the
  widget sees nothing).
- **Dates are exact to the millisecond.** `ApiJSON`'s encoder wrote dates with a formatter that
  cuts the `Date`'s seconds, so a moment such as .234 s, whose double is a hair below, was
  written .233: a saved answer fetched at an arbitrary moment read back a millisecond early. The
  encoder now writes the moment's nearest whole millisecond as `toISOString` does, and the
  decoder gives the millisecond's own `Date` (`Date(epochMs:)`), so a date written and read
  back is equal; `SavedToday` keeps `savedAt` to the millisecond. Every date the server sends
  reads as before, to the millisecond.
- **The fixtures in the app** come through the transport now: `-fixture <name>` answers every
  request with that fixture, after forgetting the saved answer, so the launch runs as it does
  for real and the fixture is saved for the widget under the target's key (no longer
  `fixture:<name>`). `-apiOrigin <url>` asks a deploy preview. The unit tests' host doesn't
  launch (XCTest's `XCTestConfigurationFilePath`), so a live fetch can't write the App Group
  under `AppGroupTests`; a fixture launch always launches. All three are in `DebugHooks.swift`
  under `#if DEBUG`. (Connecting the halves started the model's clock at the fixture's moment
  too: "The iPhone app's home screen, connected", below.)
- **The skeleton's widget can't show an old hour.** It now finds real answers, so its provider
  shows the hour `HourPicker.pick` gives (an entry now and at each hour ahead), and nothing from
  `usableUntil` on, until phase 7's planner replaces it.
- **Not proven here:** `URLSessionTransport`, `SharedStore`'s defaults, `WidgetCenterReloader`,
  the app's wiring and the debug hooks are Apple only, built and run only by the macOS jobs.
  IsItServices and the widget's provider type-check on Linux against stubs of WidgetKit and
  `containerURL`; whether `XCTestConfigurationFilePath` is in the hosted app's environment on
  Xcode 26.6 is from long practice, not checked.

## The iPhone app's Today page (IsItCore, IsItKit, apps/ios; phase 5.1, the page half)

The iOS build spec's PR 5.1, its page half: the home screen's top bar and its Today page, from a
`TodayResponse`, as section 10.2 lays them out. The model that fetches (`AppModel`, the launch
order) is the other half, written beside it; the two meet in `HomeView.swift`.

- **The content is a presenter in IsItLogic, tested on Linux.**
  `HomePage(_:view:at:phase:placeName:)` makes one page as plain values: its state, band and
  palette, the question, the answer, the heading VoiceOver reads with the place, the verdict and
  detail, the middle page's agreement heading, strip (`StripGeometry`), strip summary, model list
  and limited line, Retry, and the footer. It works out nothing of its own: it takes the hour
  `HourPicker` picks, the middle day `MiddleDay` gives, `Questions.snow`, `MiddleDay.label`,
  `UpdatedLine` and the generated copy. `HomeTopBar(placeName:approximate:)` is the top bar, with "Finding you…"
  (`CoreCopy.locating`) while no place is known, as the website's header has it.
- **Its reference is TypeScript, and so are its vectors.** packages/mobile `page.ts` (`homePage`)
  is built only of core's and the client's functions: core `viewDisplay` of the answer client
  `pickHour` picks at the moment, as the website shows that answer, with the hour's Now as
  `snowNow`, its today in place of the answer's own and its week (the server's answer at the
  start of that hour, by the `ahead` semantic test), and the middle view's day from client
  `middleDay`; core `question` and `viewLabel`; client `updatedLine`; `COPY` and appCopy.ts.
  `page.json` holds its answers for every fixture and view at the fixture's own moment, and for
  eleven of them at an hour ahead, the last minute before `usableUntil` and at it; for Durham
  across 6pm and without tomorrow; after each kind of request; with the place's name given or
  empty; without `updated` or snow; and with no answer: 222 page cases, and core `creditParts`'
  cases. The vitest replays each from its input, the vector guard holds the Swift to every case
  (`PageVectorTests`), and `HomePageTests` reads the spec's fixtures as examples, their strings
  taken from the file. Broken on purpose (the offline line's precedence, the 6pm flip a minute
  out), the Swift fails its cases.
- **The states.** Loading (no answer, asking): "Checking…" on `nosnow`'s palette, with shapes
  holding the page's layout. Error (no answer, the request failed): the website's "Forecasts
  are unavailable right now…" with Retry; offline, since connecting the halves, "No recent
  forecast. Connect to the internet to refresh." with Retry (below). Not available (an answer without
  snow, or without the view's block: no Now, no week, no tomorrow from 6pm): "Not available right
  now.". No recent forecast (past `usableUntil`, on every view): `AppCopy.staleApp`, never the
  old hour. An answer on screen stays while a request is out or after one failed. Without an
  answer to show, the page has no band, so no glyph, and `nosnow`'s palette.
- **The footer.** "Updated" and the `UpdatedLine` (at the place's date now, so "yesterday, …"
  after midnight); then the offline line, which says when the forecast is from, or else the
  stale line: offline, "It will refresh shortly" would not be true. Past `usableUntil` there is
  no notice, since no forecast is showing, and the Updated line stays. The links out and the
  places nearby are the answer's own (`links`, `nearby`), each hidden when there are none; the
  website words the links into a sentence ("… on BBC Weather, Met Office or AccuWeather."), and
  the app lays them out as a row of links under the intro, as section 10.2 has them, so it needs
  no joining words of its own. The credits are the answer's `attribution` in pieces with their
  links (`Credits.parts`, the port of core `creditParts`, matching phrases code unit for code
  unit as `startsWith` does).
- **The credits' links moved into core,** from `Credit.astro` (`CREDIT_LINKS`, and
  `creditParts` in place of its regular expression), so the website and the apps link the same
  phrases from one list; the generator writes it into `CoreCopy.creditLinks`. The website's
  output is unchanged: the old split and the new give the same pieces for every credit.
- **Two app strings.** `headingLabel` ("{place}. {question} {answer}", section 10.2's "Leeds.
  Will it snow tomorrow? Yes.") and `modelLine` ("{name} · {value}", "ECMWF · 2cm"). Without a
  place's name the heading is the website's own, the question and then the answer. The question
  on screen asks without the place, as on the website's home page.
- **No units input.** The task named the units among the presenter's inputs, but nothing on the
  page depends on them: every amount is the answer's own, in `snow.unit`, worded by the server or
  by `StripGeometry`, so a units input would have nothing to decide. The units a request asks
  for are the model's.
- **The views take plain values and actions** (IsItUI):
  `HomeShell(topBar:theme:actions:content:)`, the background of the page on screen,
  cross-fading in 0.9 s when the band changes (at once with Reduce Motion), with the top bar over
  the pages; `ForecastPageView(page:theme:glyph:actions:)`, one page; `PageTheme`; and
  `HomeActions` (retry, open the place picker, open Settings, use my location, open a link,
  select a nearby place). They never see the app's model, which is written beside them; `HomeView.swift` connects the two, and for now gives the
  skeleton's model, links opening in Safari through `openURL`, and actions that wait for the
  model that fetches and for phase 6's sheets. Phase 5.2 puts the switcher and the pager in the
  shell's content and adds the Now and week bodies to `HomePage`, so the shell isn't rewritten.
- **IsItUI depends on IsItLogic, and not on SnowKit.** The app gives each page its colours
  (`PageTheme(palette)`, with SnowKit's `Color(rgb:)`) and its glyph (`Glyphs.image`), so IsItUI
  names no topic and the widget, which links SnowKit, still links none of the app's screens. The
  app now links IsItLogic (project.yml), generated with XcodeGen 2.46.0 built from source: the
  targets' IDs, which the test plans name, are unchanged.
- **Accessibility, as section 16 asks for these elements:** the question and answer are one heading
  element labelled with the place; the strip is one element read as its summary; a model's row reads
  its name and amount; at accessibility sizes the rows stack, the place name wraps to two lines and
  the glyph stops growing at 160 points; every text uses a text style, the answer
  `Font.custom("BricolageAnswer", size: 64, relativeTo: .largeTitle)`; the background and glyph are
  left alone by Smart Invert (since PR #33's second macOS run, inverted with the text, which the
  exemption left unreadable on them: "The iPhone app's UI tests, after PR #33's second macOS run");
  buttons and links use the system's styles, tinted in the palette's ink. A model that disagrees has
  a lighter amount rather than fainter text, as on the website, so it keeps its contrast; its dot on
  the strip is fainter.
- **The fixture hook shows a fixture at its own moment** (its `_fixture.now`; first
  `DebugHooks.launchMoment`, and since connecting the halves the model's clock, below), so a UI
  test on any day sees the state the fixture was made for. The UI tests
  changed where the page's structure did: the place is a button labelled "Place: Aberdeen. Change
  place.", and the question and answer are one heading ("Aberdeen. Will it snow today? Yes."),
  so they read those where they read the skeleton's place and answer texts, and still wait for
  the verdict and check it. `durham-tomorrow` (tomorrow's answer at 6:05pm) and `old-forecast`
  (no recent forecast, and no verdict) are new.
- **Not here yet:** the flakes' drift (the glyph is drawn whole), the announcement when the
  picked hour changes the answer (section 16, phase 5.4), pull to refresh (5.3), the
  notifications card and the upgrade row (phases 8 and 7), and the ImageRenderer snapshots of
  every page, band and text size (section 17.2).
- **Not proven here:** IsItUI and the app compile only on the macOS jobs, so the views, their
  layout, VoiceOver's reading of them and the UI tests are unproven until the first `ios` run;
  only the presenters, their vectors and the lint ran here.

## The iPhone app's home screen, connected (apps/ios, IsItCore; phase 5.1)

PR 5.1's two halves, the data and the launch and the Today page, joined on `claude/ios-home` by
ordinary merge commits that keep both sides, then connected: the app's root makes the model with
the production services and runs the launch, and the home screen draws the model's state. The
spec's 5.1 is "the Today page from the live API", the skeleton TestFlight build; Carl sees his
own approximate place in it with no picker.

- **The merges.** project.yml links IsItModel, IsItLogic and IsItState into the app (both halves
  added to the same line). DebugHooks keeps the data half's fixture transport, `-apiOrigin` and
  the unit-test host guard, and the page half's fixture moment; the page half's `launchAnswer`,
  which fed the skeleton's model, went with that model.
- **The root** (`WillItSnowApp`) makes `AppModel` with `APIClient` over `URLSessionTransport` at
  `API_ORIGIN`, `SystemClock`, the App Group's `SharedStore` (`MemoryState` without one),
  `WidgetCenterReloader` and `NoHooks`; `.task` runs `launch()` and the scene's phase drives the
  background and foreground rules. With no `place.v1` the target is approximate IP location, so
  the first launch asks `?ahead=snow` and the server places the phone (section 9.4, "Nothing
  prompts on first launch").
- **The view has no rules of its own.** `AppModel` gains `topBar`, `page(_:at:)`, `now` and
  `placeName` (IsItState, tested on Linux), which hand the presenters the model's state, so
  `HomeView.swift` only draws them and passes taps back. `HomePage.Phase(AppPhase)` drops the
  error's details. The place's name is the target's own (a city page's, a searched place's),
  else the answer's, and never an empty one; "approximate" is the IP target, so the line shows
  from the first frame, beside "Finding you…".
- **The minute tick came with 5.1,** not 5.2 as the spec has it: a `TimelineView(.everyMinute)`
  draws the page at the model's clock, so an app left open never shows an old hour past
  `usableUntil` (section 0.2's honest copy). The page is a child view whose body reads the model,
  so it is drawn again when the model changes as well as each minute.
- **Only the middle page.** `model.view` (Now from 6pm) isn't drawn until 5.2's pager binds it;
  5.1 shows Today, or Tomorrow from 6pm.
- **The states agree between the halves.** The page's presenter (vector-checked TypeScript) is
  what is drawn; the model's `AnswerState` says the same, and `HomeScreenTests` holds the two
  together for every fixture at its own moment, a millisecond before `usableUntil` and at it, in
  every phase. Where they differed, offline with nothing saved, the page now says
  `AppCopy.staleApp` ("No recent forecast. Connect to the internet to refresh."), as
  `AnswerState` and section 9.5 do, rather than "Forecasts are unavailable right now. Try again
  in a few minutes.", which blames the forecasts for the phone's connection; Retry stays. The
  change is in packages/mobile `page.ts` first, then `HomePage`, and `pnpm mobile:generate`
  rewrote the six cases of `page.json` it touches.
- **Deviation: an error over an answer stays quiet** (reverted in review, below: the page now
  follows section 4). Section 4 says a 503 keeps the saved answer
  "and show[s] `COPY.unavailable` with Try again". The website keeps the answer and shows no
  error ("a stale answer beats an error", `app.ts`), and so does the app: the answer shows while
  it has hours, the model asks again at the next forecast hour, pull to refresh is there, and
  past `usableUntil` the page says there is no recent forecast. Retry shows only with nothing to
  show. Also as the website, the page words any failure as `CoreCopy.unavailable` rather than
  the server's own message (`FetchError.message`); for a 503 they are the same text.
- **Pull to refresh came with 5.1** (5.3 in the spec): `.refreshable` on the page, in
  `HomeView.swift`, which the page's scroll view takes up, so IsItUI is unchanged. It calls
  `refresh()`, which keeps what is on screen.
- **Nearby loads in place** through `AppModel.select(_:)`, new: the place becomes the target and
  is kept in `place.v1`; the last place's answer leaves the screen at once, so the page is
  checking under the new name and never shows one place's answer under another's; a failure
  then shows as with nothing saved (offline, no recent forecast and Retry). The saved answer
  stays the last place's until the new one replaces it. The place on screen again only asks
  again. Choosing a nearby place doesn't add it to the recent places, which come with the
  picker (phase 6).
- **The notice** (`AppCopy.slugGone`) shows in the top bar in the approximate line's place
  (`HomeTopBar(placeName:approximate:notice:)`), where it explains itself, until a place is
  chosen; it isn't kept between launches. No string was added.
- **One clock for the model and the page.** `SystemClock(startingAt:)` (IsItState) runs from a
  given moment, scheduling by its own time, which a Linux test checks ahead and behind the
  system's. A Debug build launched with `-fixture` or `-network` starts it at the fixture's
  `_fixture.now`, or at `-now <iso>` (spec 9.8). This replaces `DebugHooks.launchMoment`: before,
  the page was drawn at the fixture's moment while the model decided at the real one, so from 2
  December 2026 the model would have judged the fixtures stale. `-clock fixed` is still phase
  5.4's.
- **A launch test with no fixture hook.** `-network <name>` stubs the network beneath the app's
  own `URLSessionTransport` (`URLProtocolStub`, spec 9.8's URLProtocol stub, added to a copy of
  section 4's configuration, `URLSessionTransport.configuration()`), so the real client,
  transport, decoding and store run; it answers only the request for approximate IP location
  and errs on any other, so an answer on screen proves the request. `-network off` has no
  connection, and `-resetStore` forgets the place, units and saved answer first. `LaunchTests`
  uses them for the first launch, an offline relaunch over the saved answer, and offline with
  nothing saved. `-fixture` keeps its own transport, so a stub that fails on CI fails only these
  three tests. `check-archive.sh` looks for `-network` as a short literal too (13 hooks), with
  a test that it finds one; `-now` and `-resetStore` were on its list already. A launch with
  `-network` always launches, as with `-fixture`, in case the UI-tested app's environment has
  XCTest's configuration.
- **Not here yet:** Now and the week, the switcher and the pager (5.2); the VoiceOver
  announcement and `-clock fixed` (5.4); the place picker, Settings and "Use my location"
  (phase 6), whose buttons are drawn and do nothing until then.
- **Not proven here:** everything Apple only: the root's wiring, `HomeView` (the tick, the
  refresh, the actions), the hooks, the URLProtocol stub, and the five new or changed UI tests,
  which first run on the macOS jobs. `DebugHooks.swift` (Debug and Release), IsItServices and
  the root's environment were type-checked on Linux in Swift 5 mode against stub UIKit and
  WidgetKit modules; whether `.refreshable` on the page reaches its inner scroll view, and
  whether XCUITest can scroll to and tap a place under "Nearby:", are from Apple's documentation
  and practice, unchecked.

## The iPhone app's home screen, reviewed (phase 5.1)

What the review of PR 5.1 found, and what changed for it.

- **Every fixture UI test starts from a clean store.** `-fixture` forgets only the saved answer,
  and `testNearbyLoadsInPlace` leaves Dundee as the place in the App Group, so `testOldForecast`,
  which XCTest runs straight after it (methods in alphabetical order; the plan doesn't
  randomise), would have read "Dundee. Will it snow tomorrow? …" over Durham's answer, since the
  place's own name comes before the answer's. `FixtureLaunchTests` now launches with
  `-resetStore` before `-fixture` (`prepare(store:)` runs first), so the place, the units and the
  saved answer are forgotten; `-fixture` itself is unchanged, so a fixture tried by hand keeps
  the place chosen. `testOldForecast` waits for the footer's Updated line, which only an answer
  brings, rather than reading the heading that the loading state already has.
- **A place chosen during the location fix stands.** Launch step 4 compared the fix with the
  place as it was after the wait, so a place chosen while the fix was out (one under "Nearby:"
  now, the picker's from phase 6) was replaced by the device's cell and saved to `place.v1`. The
  model keeps the place the fix was for, and moves only while that is still the place. A Linux
  test holds the fix (`RecordingHooks(holdingFix:)`) and loads Dundee meanwhile.
- **Back in the foreground, section 9.5's rule, not the website's.** The return fetched whenever
  the answer was more than 30 minutes old, however short the time away (the website's `wake`,
  which counts from its last load), where section 9.5 says to refetch sooner than 30 minutes
  away only when the answer is out of date. Now: after more than `CLIENT.refreshAfterMs` away,
  the view for the time of day and a fetch; sooner, a fetch only when the answer is out of date,
  and, kept beyond the spec, past `usableUntil`, missing, or fetched at an unknown time or after
  now. A quick switch away and back with a current answer asks nothing; the hourly quiet refresh
  keeps it current. Since the return asks less, what was due when the app left stays due: the
  model keeps the quiet refresh's or the retry's time across the background and schedules it
  again for then, at once if it has passed. Before, a return within half an hour of an offline
  failure dropped the minute's retry for the next forecast hour, leaving "You're offline" on
  screen for up to an hour after the connection came back.
- **A 429 is never "offline".** Section 5.6 has the app treat a 429 like being offline, and
  section 4 says to keep the saved answer and retry quietly. The app did both by making it the
  offline phase, which told a phone that was connected but rate limited that it was offline
  ("You're offline. Showing the forecast from …"; with nothing saved, "Connect to the internet"),
  against section 0.2's honest copy, and at the moment section 5.6 expects 429s from carrier NAT.
  Now a 429 is an error (`AppPhase.error(.rateLimited)`), retried as offline is, after
  `CLIENT.retryAfterMs` plus the jitter. Over an answer the page adds nothing: no offline line,
  no Retry. With nothing saved it says core's words for it ("Too many requests. Try again in a
  minute.", `FetchError.rateLimited.message`), with Retry. The page has a phase of its own for
  it, `limited`.
- **An error says so, as section 4 asks.** 5.1 kept the website's way ("Deviation: an error over
  an answer stays quiet", above), which overrode an explicit line of the spec without Carl's
  word, so the page follows section 4 now. After a failed request, over an answer that shows,
  the footer says `CoreCopy.unavailable` ("Forecasts are unavailable right now. Try again in a
  few minutes.") with Retry under it, in place of the stale line; past `usableUntil` there is
  still neither. With nothing saved the page says the server's own message
  (`AppPhase.serverMessage`, the `ApiError` message), or `CoreCopy.unavailable` when it sent
  none, as `AnswerState` already did; the test that held the two together used only a 503,
  whose message is that same text, and now has a 400, a bodiless 500 and a 429 as well. Section
  4's "Try again" is the app's Retry (`CoreCopy.retry`), as section 10.2 has it; no string was
  added for it.
- **The reference first.** packages/mobile `page.ts` takes the 429 phase and the server's
  message (`PageInput.message`); `pnpm mobile:generate` rewrote `page.json` (255 page cases,
  from 222: each failure over an answer, over a stale one, over a view with nothing to show and
  past `usableUntil`, and with no answer the server's message, empty or not, and the 429); and
  `HomePage(_:view:at:phase:message:placeName:)` ports it. Broken on purpose (the message
  ignored, a 429 worded as offline over an answer), the Swift fails its cases, `HomePageTests`
  and the test that holds the page to `AnswerState`.
- **Retry goes where its line is.** IsItUI draws the page's Retry in the body with no answer, and
  under the footer's line with one (`RetryButton`, in both places).
- **The place button says what it does before the place is known.** VoiceOver read only "Finding
  you…" for it, which also stays after a failed first launch. It now reads "Finding you…, change
  place." (`AppCopy.placeButtonUnknown`, beside section 10.9's `placeButtonLabel`), as the
  website's place button reads "…, change location" to a screen reader. The text on screen is
  unchanged.
- **Not proven here:** the UI tests' clean launches, the footer's Retry and the place button's
  label are Apple only, so the macOS jobs prove them; IsItUI's changes were not compiled here.
  Everything else ran on Linux.

## The iPhone app's pages, switcher and pager (IsItCore, IsItKit, apps/ios; phases 5.2 and 5.3)

The iOS build spec's PRs 5.2 and 5.3, less what 5.1 brought forward (the minute's tick, pull to
refresh, the footer, the loading and error states, and the refresh rules, above): the Now and
This week pages, the switcher and the pager, the 6pm flip, the glyph's drift, changes announced
once to VoiceOver, and every text size up to AX5 (sections 9.5, 10.1, 10.2 and 16).

- **The bodies are the presenter's, the TypeScript first.** packages/mobile `page.ts` gives each
  page `hours` and `week`: Now's rows from core `viewDisplay` (the label, "60%", and its `sr`,
  "60% chance at 6pm", the website's screen-reader line) with the hour's chance for the row's
  bar; the week's rows from `viewDisplay` too ("Tue", "2cm", the band label) with the day's
  `snowy` and `total` (S1) and what VoiceOver reads, built of core's words: the day in full
  (`WEEKDAYS` of its date, or "Today", the server's label for the week's first day), the amount,
  the band label starting in lower case as it is mid-sentence, and `snowAgreementLine` ("4 of 6
  forecasts expect snow", "1 of 5 forecasts expects snow"); never a percentage.
  `pnpm mobile:generate` rewrote `page.json` (the same 255 page cases, with the new fields),
  and `HomePage` ports it: `HomePage.Hours`, `HourRow`, `Week` and `WeekRow`.
- **The Swift's words are the app's copy, proven to be core's.** Core words the rows in
  TypeScript only (`sr` is built inline in `display.ts`, `snowAgreementLine` is a function), so
  appCopy.ts has six templates for the Swift: `percent`, `hourRowLabel`, `weekRowLabel`,
  `weekRowLabelShort`, `dayAgreement` and `dayAgreementOne`; a vitest fills them for every row in
  `page.json` and every agreement from 0 to 6 forecasts and compares them with core's, and the
  vectors compare the Swift's code unit for code unit. `CoreCopy.weekdays` is core's `WEEKDAYS`,
  generated. The generator now puts a parameter on each line when a function's signature would
  pass 100 columns (`weekRowLabel`), as swift-format does.
- **Beyond the reference: an answer saved before S1.** The Swift decodes the week's days without
  `snowy` and `total`, as IsItModel always has; their rows have no dots and are read without
  the agreement (`weekRowLabelShort`). The TypeScript's types always have them, so this is
  `HomePageTests`', not a vector's.
- **The dots are the forecasts with data.** Section 10.2 says six dots; a day a model has no
  data for has `total` 5, so the row draws five, `snowy` of them filled, and says "of 5", rather
  than an empty sixth that would read as a forecast saying no.
- **`CivilDate`** (IsItLogic) is the links' date reading moved out of `DeepLink`, unchanged, so
  the week's rows find a date's weekday the same way, with no calendar or locale.
- **The switcher** (`ViewSwitcher`, IsItUI) is the segmented picker section 10.2 asks for, of the
  pages' own labels, so the middle one reads Tomorrow from 6pm. At accessibility text sizes a
  segment would cut "This week" short, and section 16 wants full labels, so there it is a row of
  buttons that wraps, the one on screen underlined and marked selected.
- **The pager** (`HomePager`, IsItUI) is a horizontal `ScrollView` of the three pages, each the
  container's size, with `.scrollTargetBehavior(.paging)` and `.scrollPosition(id:)`, plus a
  `ScrollViewReader` scroll on first appearance in case the initial position isn't applied.
  Switcher and pager share one binding to `AppModel.view`, so a tap, a swipe, a route and the
  return after 30 minutes away (5.1's rule, unchanged) always agree. A tap moves the pages
  without animation: an animated programmatic scroll passes Today on its way from Now to the
  week, and the position it reports on the way could set the view mid-scroll. (The container's
  size, `containerRelativeFrame`, turned out to be the screen's safe area in height, which put
  the top bar under the status bar; each page has been the pager's own size since main's first
  macOS run: "The iPhone app's UI tests, after main's first macOS run", below.)
- **Only the page on screen is in the accessibility tree.** The other two are hidden from
  VoiceOver (which changes page with the switcher, as with a system page view) and so from the UI
  tests, whose identifiers (`heading`, `verdict`, …) stay unique. Pull to refresh is on each
  page's own scroll view, not the pager's.
- **The view it opens on** is `MiddleDay.defaultView`, as 5.1 set it; 5.1 drew only the middle
  page, so the app now opens on Now from 6pm. A route to a view (a widget's `.view`) now sets the
  view in the model, at once or at the launch's end, and still goes to the later phases' hooks.
  The view never moves by itself while the app is open: at 6pm the middle tab becomes Tomorrow
  where it is. (Until the review, "The iPhone app's home screen, reviewed (phases 5.2 to 5.4)",
  below, any answer arriving with nothing on screen moved it, a nearby place's and Retry's too.)
- **The 6pm flip is the minute's tick alone**: each minute every page is drawn at the model's
  clock, so the middle page shows `snow.days[1]` from 6pm at the place with no request (the
  quiet refresh is at the next forecast hour). `FlipTests` prove it at 5:59pm and 6pm in Durham
  (with the clock 6 minutes behind its answer, as `page.json` has Durham across 6pm), minute by
  minute from 5:30pm in London on the day the clocks went back, and in Kathmandu (UTC+5:45,
  where 6pm is 12:15 UTC), each with no request and the view unmoved.
- **The drift is the website's CSS** (`.glyph .drift`): `GlyphDrift` (IsItLogic) has its
  keyframes (down 6 and right 3 as it fades by 45%, back in from 4 above and 2 left at 46%),
  `ease-in-out` as CSS's `cubic-bezier(0.42, 0, 0.58, 1)`, 1.6 s twice: 3.2 s, under 5 s. The
  app's flakes are one layer (SnowKit's `-drift` image), so they move together rather than a
  little out of step. `GlyphMotion` says when: on the glyph's first paint (its first band, also
  after a new place's loading state) and when the band changes, never with Reduce Motion, which
  also stops a drift under way. `GlyphView` (IsItUI) draws it with `TimelineView(.animation)`,
  paused when still. Under `-now` and, beyond the task, `-uitest` (which already turns
  animations off) the glyphs never drift (`DebugHooks.stillMotion()`), so no attached screen
  catches the flakes faded.
- **Changes are announced once** (sections 9.5 and 16): `Announcements` (IsItState) is handed
  the page on screen each time it is drawn, and gives its heading when it says something new on
  the same view, which `HomeView` posts as an announcement: the answer arriving after
  "Checking…", a refresh's new answer, a failure with nothing to show, the hour picked changing
  the answer, Tomorrow from 6pm, and no recent forecast once the answer's hours run out. Nothing
  for the first page drawn, a tick or refresh that changed nothing, the loading state, or a move
  to another view (the user's, a route's, or the return's: VoiceOver reads the page from there).
  `AnnouncementTests` drive the model through each, minute by minute where it matters, and
  count one announcement for each change. The app posts it with UIKit's
  `UIAccessibility.post(notification:argument:)` and `.announcement`: the same notification as
  SwiftUI's `AccessibilityNotification`, which section 16 names, by an API certain on iOS 17.
  (Since the review, below, the verdict is announced with the heading, and the answer after
  "Checking…" on whichever view it opens.)
- **Text sizes up to AX5.** Every text wraps (`fixedSize(horizontal: false, vertical: true)`),
  the question included; the answer word, one word in the answer font, keeps to its line and
  shrinks to fit (to half) rather than break mid-word; the pages scroll. Now's rows put the bar
  under the hour and chance, and the week's rows stack (the day and amount, wrapping if they
  must, then the band, then the dots) at accessibility sizes, as the model list already did.
- **The UI tests changed where the screen did.** `testDurhamTomorrow` and `testOldForecast`
  launch at 6:05pm in Durham, so the app now opens on Now: each first reads Now's heading, then
  taps Tomorrow and reads the middle page's heading and verdict, every 5.1 assertion kept. New:
  `testSwitcherAndSwipe` (each tab, the next hours on Now, swipes back to Today and Now, each tab
  selected), which attaches Now and This week for the contact sheet. Phase 5.4's `HomeTests`
  will build on the identifiers listed in `apps/ios/README.md`.
- **Not proven here:** IsItUI and the app compile only on the macOS jobs, so the switcher, the
  pager and its initial position, the bodies' layouts at each text size, the drift, the
  announcement and the three changed or new UI tests (whether a segment reports `isSelected`,
  and whether `swipeRight()` on the app pages the outer scroll view) are unproven until the
  first `ios` run. Everything in IsItCore ran on Linux, and every Swift file was linted.

## The iPhone app's home accessibility and its UI tests (IsItCore, IsItKit, apps/ios; phase 5.4)

The iOS build spec's PR 5.4: the home screen's accessibility (section 16) proven on the
simulator by `HomeTests`, `OfflineTests` and the audits (section 17.2), with every page on the
contact sheet at Large and AX3 (phase 5's exit). `apps/ios/README.md` ("Phase 5.4") says how to
read them.

- **What a page should say is generated from page.json.** A UI test can't call the presenter
  (it drives the app from another process), and typing a page's words into a test would check
  the app against the test's copy rather than the reference. packages/mobile now writes
  `apps/ios/Apps/Snow/UITests/Generated/HomeScreens.json` (`exportHomeScreens.ts`): for each
  screen a test opens, its fixture, the moment as `-now` takes it, how its request went, the
  view it opens on (core `defaultView`), its top bar and its three pages, the very outputs of
  page.json's cases. The screens are listed once (`homeScreens`, vectors.ts), which also adds
  each to page.json, so the Swift on Linux is held to the same inputs; a screen page.json has no
  case for stops the generator. JSON in the test bundle rather than generated Swift: there is no
  swift-format layout to reproduce, and XcodeGen puts a `.json` in the folder into the UI test
  bundle's resources (checked with XcodeGen 2.46.0 built from source). Prettier ignores the
  folder, as it does the other generated resources.
- **Two references grow, TypeScript first.** A model line in page.ts now has its `name` and
  `value` as well as its `text`, as the Swift's `HomePage.ModelLine` always had, since VoiceOver
  reads a row as its name with the amount as its value; and the top bar has a reference,
  `homeTopBar` (the place or "Finding you…", the place button's label, the approximate line or
  the notice, "Use my location", Settings), with cases in page.json, which `PageVectorTests` now
  holds `HomeTopBar` to. Nothing the app shows changed.
- **`-clock fixed`** (spec 9.8): `FixedClock` (IsItState) reads one moment; work scheduled for
  a time it has reached runs at once and work for any later time never runs, so a test on it
  never meets the quiet refresh or the retry, and reads the screen its moment shows however
  slowly the simulator goes. `-clock run`, which 5.1's tests rely on, stays the default; the
  flip and the end of `usableUntil` are tested with it.
- **The minute tick counts the model's minutes.** `TimelineView(.everyMinute)` ticked on the
  system's minutes, so a Debug clock started at 5:59:30pm reached 6pm 30 seconds in and turned
  the page only at the system's next minute, up to a minute later. The tick is now
  `TimelineView(.periodic(from: MinuteTick.anchor(…), by: 60))`, from a moment when the model's
  clock read a whole minute, plus 50 ms so that rounding in the two clocks' arithmetic never
  ticks a hair before the minute. In the app the two clocks are the same, so it is the system's
  minute, as before.
- **`-network unavailable`** answers every request as the server does when the forecasts can't
  be had without a cache (503, `upstream_unavailable`, core's message), over the app's own
  transport as `-network off` is: a failure over a saved answer, which section 4 says keeps the
  answer, says forecasts are unavailable, and offers Retry.
- **The system's controls take the page's tone.** The pages always use their band's palette (section
  10.1), but the switcher's segmented control and the bordered Retry draw their own text in the
  system's colour scheme: black on the snow bands' purple in light mode, and white on no snow's
  lilac in dark mode, which the contrast audit would very likely fail. `Palette.inkIsLight`
  (IsItLogic, light ink on a dark page, by WCAG luminance, tested on Linux) sets `PageTheme.dark`,
  and the shell and each page set the colour scheme for what they hold. The status bar is the
  system's, and `preferredColorScheme` would also turn phase 6's sheets, which follow Dark Mode, so
  it is left as it is. Fixed before the first audit rather than waiting for it to say so.
- **Hit regions.** The footer's links and places, "Use my location" and the switcher's buttons
  at accessibility sizes are at least 44 points tall (`HitTarget.minimum`), and Retry is the
  large control size. The credits' links stay inside their text, beside the data as the licence
  asks; if the audit flags them, that is the reason to give.
- **The audits** (`HomeAuditTests`, spec 17.2's `AccessibilityAuditTests` for the home screen,
  named apart so the later phases' audits of their own screens don't meet it in one file):
  `performAccessibilityAudit(for: .all)` on each page of the three fixtures at Large and at AX3
  (`-UIPreferredContentSizeCategoryName`, UIKit's own default); the handler keeps every issue
  rather than stopping at the first, and the test fails once with them all, each with its page,
  kind, Apple's descriptions and the element. `HomeAuditTests.exceptions` takes an issue that is
  the audit's mistake, with its reason; it is empty, since no issue has been seen yet, and none
  is allowed on a guess. The first run may show the segmented control's fixed font at Large (a
  system control; at accessibility sizes the switcher is buttons) and the credits' links. (The
  review, below, gave those two their exceptions, corrected AX3's value, and has every
  screenful of each page audited.)
- **The contact sheet** sorts attachments by name, so each audited page is attached as
  `home-<fixture>-<n>-<size>-<m>-<tab>` (`home-aberdeen-snow-1-large-1-now` …
  `home-leeds-dry-2-ax3-3-this-week`): fixture by fixture, Large before AX3, in the switcher's
  order. Phase 5's exit asks for Large and AX3; section 16's XXXL belongs to the `ImageRenderer`
  snapshots, which wait for the page's content to be drawn apart from its scroll view, which
  `ImageRenderer` doesn't draw. (Since the review, below, each screenful, `…-1-now-01` on.)
- **Time in the tests.** The flip and the end of the saved answer's hours start half a minute
  before with `-clock run` (the spec's example has 10 seconds before 6pm), so a slow launch on the
  runner can't pass the moment before the first check, and wait up to 75 seconds for it (two
  minutes before, and up to three minutes, since the review, below). The new tests carry on after
  a difference, so one run lists every one; a screen that never comes throws, which stops the
  test.
- **Not proven here:** everything Apple only. The UI tests were type-checked on Linux against stubs
  of XCUITest written from Apple's documentation (with `NSPredicate(format:)`, which Linux lacks,
  stubbed), and their types decoded `HomeScreens.json` there; `DebugHooks.swift` was type-checked in
  Debug and Release against stub UIKit and WidgetKit. A page is read from one snapshot of the
  accessibility tree (`XCUIElement.snapshot()`), rather than an element query for each of its forty
  or so checks, which would each ask the app, and an identifier checked must be in it once, which
  also proves the pages off screen are out of the tree. Unproven until the first `ios` run: the
  periodic timeline, the colour scheme on the system's controls, the hit regions, what the audits
  find, whether a segment reports `isSelected`, whether a swipe on a page's scroll view pages the
  pager, and whether the AX3 argument reaches SwiftUI's text sizes.

## The iPhone app's home screen, reviewed (phases 5.2 to 5.4)

What the review of phases 5.2 to 5.4 found, and what changed for it.

- **The UI tests wouldn't have compiled.** `HomeAuditTests` named the audit kinds `.action` and
  `.parentChild`, which XCTest has for macOS only, so `build-for-testing`, and every test after
  it, would have failed on the first run. The audit now names iOS's seven kinds; any other still
  reads "type <raw value>". The Linux stubs of XCUITest had both kinds, which is how the
  type-check missed it: they now have the iOS SDK's alone.
- **AX3 is `UICTContentSizeCategoryAccessibilityXL`.** UIKit's raw values abbreviate the sizes
  (`…AccessibilityM` to `…AccessibilityXXXL` for AX1 to AX5), so the spelled-out
  `…AccessibilityExtraExtraExtraLarge` matched nothing, and the AX3 audits ran at Large (and would
  have been AX5). Each audit now checks first that the switcher is the one for its size: the
  buttons (`view-now`) at AX3, and not at Large. A size that doesn't reach the app fails the test.
- **The two issues 5.4 foresaw have exceptions**, each matched narrowly and given its reason.
  The first is `dynamicType` on the segmented control or its segments. Section 10.2 asks for a
  segmented picker, and UIKit's control keeps its own type size; at accessibility sizes the
  switcher is buttons whose labels scale, and those are never excused. The second is `hitRegion`
  on a link inside the credits (`credits`, a new identifier on their lines). They are the
  attribution beside the data that the licence asks for, and WCAG 2.2's target size (2.5.8)
  allows a target inside a sentence. 5.4 allowed nothing ("none on a guess"), so the first run
  would almost surely have failed on the segmented control, which is on every page at Large.
  Drawing the switcher as buttons at every size would remove the first exception, but the spec
  asks for the segmented picker, so that is Carl's call. An exception no audit in a test needed is
  printed at its end, so one the app outgrows can go. Any other issue fails the test.
- **Every screenful is audited.** An audit reads only what is on screen, so 5.4 audited and
  attached each page's first screen alone. At AX3 that missed Now's rows, the week's rows (both
  stacked at that size) and every footer. At Large it missed the footer's links and places, whose
  44-point hit regions 5.4 had made for the audit. `HomeAuditTests` now audits and attaches each
  screenful, from the page's top down to the end of the credits. It scrolls four fifths of the
  page at a time, with a slow drag that holds before it lifts so the page can't fling past a
  screenful, and fails if the end hasn't come after 15. The attachments are
  `home-<fixture>-<n>-<size>-<m>-<tab>-<k>`, with k from 01, so the contact sheet keeps the order.
- **The running clocks start two minutes before their moment.** The flip test opened at
  5:59:30pm, and the end of the saved answer's hours started half a minute before `usableUntil`.
  Both had to launch, find the screen and check it before that moment passed, on a runner whose
  simulator took six minutes to boot on the last run on main. `RUNNING_LEAD_MS` (packages/mobile)
  is now two minutes: `durham-flip-start` is at 5:58pm, and `aberdeen-snow-last-minutes-offline`
  (renamed from `…-last-seconds-…`) at 3:03pm. Each test waits up to three minutes for the
  moment.
- **The `ios` job's timeout is 90 minutes**, up from 45. The UI plan grew from 8 tests to 26, its
  audits now cover every screenful, and two tests wait two minutes. A slow first run reports its
  results rather than being cancelled with none.
- **The app opens on the view for the time of day once.** `AppModel` moved to that view whenever
  an answer arrived with nothing on screen, which showed once the pager followed `model.view`.
  Three things put the user back on Today, or on Now from 6pm, without a word: moving during the
  launch's "Checking…", choosing a place under "Nearby:" from a page other than the default one
  (whose answer starts from nothing, as it must), and Retry after a failed launch. The website
  opens on its view once, and never after the visitor has moved (`openOnDefault`,
  `views.moved()`), and now the model does the same. The view is chosen by the saved answer
  painted at launch, or else by the first answer shown, unless the user or a route has chosen one
  first. A user's choice is the pager or switcher setting a different view; writing back the
  view on screen is not a move. After that only the user, a route and the return after 30
  minutes away (section 9.5) move it. `AppModelViewTests` cover a move while the launch checks,
  the same view written back, a nearby place from This week and from Tomorrow in the evening,
  Retry from Now, Retry's first answer with no move (Now in the evening, as on the website), a
  route's view across a failed launch, and a painted answer then a move. On the simulator,
  `HomeTests.testNearbyLoadsInPlaceOnThisWeek` covers the nearby place.
- **The answer after "Checking…" is announced on whichever view it opens.** `Announcements`
  said nothing for a page on a different view from the last one drawn. So the evening's first
  answer was silent, because it moves the view from Today (where the loading state is) to Now,
  and so was a widget's view at launch. It now keeps whether the last page was checking: after
  the loading state, the new page is announced whatever its view. Between two answered pages a
  move still says nothing. The rule against announcing "Checking…" had no test: with it removed,
  every IsItState suite passed. `checkingSaysNothing` now draws a nearby place's Checking… page
  between two answers.
- **The verdict is announced with the heading.** The website's live region holds the heading and
  the verdict (`#live`, aria-atomic), so a change to either is read, both together. The app
  compared and announced the heading alone, so at 2pm in leeds-dry, where "Rain, not snow."
  becomes "It won't snow." under "No.", VoiceOver heard nothing. It now compares both and says
  "<heading> <verdict>" (`AppCopy.announcement`, new), for example "Leeds. Will it snow today?
  No. It won't snow." `hourChanges` now counts three announcements on aberdeen-snow's Now,
  including the 10am verdict.
- **A move between views is still not announced.** The website reads out the answer of the view
  a reader moves to, 400 ms after it settles. Section 16 asks for an announcement when the hour
  picked changes the answer. A move is the user's own action, VoiceOver already speaks the tab
  it selects ("This week, selected"), and an announcement over that would cut it off. This is
  left for the device checklist (section 17.4) to judge.
- **Not proven here:** everything Apple only. That covers what the audits find beyond the two
  exceptions, the drag, whether the AX3 value reaches SwiftUI, the credits' container, and the
  new UI test. IsItUI's one change wasn't compiled. The UI tests type-checked on Linux against
  the corrected stubs, and the exceptions' matching ran there. Everything in IsItCore ran on
  Linux.

## The iPhone app's home audits, after PR #31's first macOS run

PR #31's first `ios` run (40047913226) built, passed the unit tests and the Release check, and
failed the UI plan: 26 tests, 20 passed, and the 6 that failed were all `HomeAuditTests`. HomeTests,
OfflineTests, LaunchTests and FixtureLaunchTests passed. The fixes, none of them an exception:

- **At Large the pages never scrolled to their end.** From the second screenful on, every audit
  found the same issues, so the page had stood still. The drag ran down the page's middle, across
  buttons and links, from near the screen's bottom edge. It is now a drag in the page's left
  margin, where no control is, starting well clear of the bottom edge; its length brings the first
  element not shown whole to the top. A page that stops short of its end fails at once with the
  geometry of each screenful, so the next log says where things were.
- **At AX3 every audit after the first scroll threw** `-902 "Invalid target app"`. The drag at AX3
  started still closer to the bottom edge, so a system gesture is the likely cause, and the new drag
  avoids it. Each audit now checks the app is in the foreground first, and an audit that throws
  fails its page with the app's state and moves on to the next page.
- **An element a screenful cuts is judged where it is whole.** The audit measured contrast on the
  answer and question once they had scrolled under the switcher, and on the nearby places and
  links at the screen's bottom edge. The palettes give the ink 6.26:1 or more on both ends of every
  gradient, so no colour changed. An issue on a page element is now judged at once only on a
  screenful that shows the element whole; otherwise it is held until the page's last screenful and
  dropped if another screenful showed the element whole. The top bar and the switcher, which don't
  scroll, are always judged at once.
- **The top bar's approximate line was the one real fault.** "Using approximate location." and
  "Use my location" failed Dynamic Type on every page, and "Use my location" failed contrast on
  the pale pages. Both sat inside a `ViewThatFits` choosing between a row and a column of copies
  of the same two views. The line is now one `FlowLayout`, the footer's way with its links, which
  passed both checks: each view is laid out once, so the audit follows one element. The switcher's
  accessibility-size buttons and the week rows use the same layout for the same reason.

These were found and fixed while phase 6 was put together with this branch, and are ported here so
this PR can pass on its own. They are unproven until the next macOS run.

## The iPhone app's place picker (phase 6.1)

The iOS build spec's PR 6.1: the full-screen picker behind the top bar's place button and the
approximate line's "Use my location", with search, "Use my location" and the recent places
(sections 4, 9.4 step 4, 10.3, 15.2 and 16). `apps/ios/README.md` ("Phase 6", "6.1") lists the types.

- **The search box's rules moved into the client, and the app ports them.** The website's
  picker decided in `app.ts` what a search asks for (the text trimmed, at least `SEARCH.minChars`
  long, else "Type at least 2 letters." or nothing) and wrote the line under a result (the region,
  then the country's name or its code). Both moved to `packages/client/src/search.ts`
  (`searchInput`, `resultDetail`), which `app.ts` imports; the website's behaviour is the same.
  `search.json` (phase 6's vector file) holds the cases: JavaScript's `trim` (U+FEFF and the
  space separators go, U+0085 and U+200B stay) and `length` in UTF-16 code units (one letter
  outside the Basic Multilingual Plane is enough, as the server counts it), and each part of the
  line missing or empty. `PlaceSearch.input` and `.detail` port them; JavaScript's `trim`, which
  DeepLink had, is now `JavaScriptString` in IsItModel for both.
- **The search, as section 4 has it, on the model's clock.** `PlacePickerModel` (IsItState)
  waits `Constants.Search.debounceMs` after the last keystroke through `AppClock.schedule`, so
  the Linux tests move a test clock rather than wait; a keystroke cancels the wait and the
  request still out (its task is cancelled, which cancels URLSession's request), and a counter
  drops any answer that comes anyway. The last search's results stay while a new one is waiting
  or out, as the website's do, rather than flashing empty; with nothing typed the recent places
  show instead. The keyboard's Search key chooses the first result, as Enter does on the
  website. `APIClient.search` asks `/api/v1/search?q=` with `TodayQuery.search`, with the same
  headers and timeout as the forecast.
- **A failed search says why, without blaming the forecasts for the connection.** Offline
  (`APIClient.offlineCodes`), it says "You're offline. Connect to the internet to search."
  (`AppCopy.searchOffline`, new): the website's "Forecasts are unavailable right now…" isn't
  true then, and "No recent forecast…" (the forecast's offline line) is about something else. A
  429 says core's rate-limited message, and anything else the server's message, or
  `CoreCopy.unavailable` without one (`FetchError.searchMessage`).
- **Choosing a place** is `AppModel.choose(_:name:)`: the place is kept and loaded in place
  (`select(_:)`, as a place under "Nearby:" is: `place.v1`, the loading state under its name,
  the answer saved for the widgets and the widgets reloaded), then phase 8's `syncAlerts` hook is
  called, so a notification place that follows the device's location can follow it; `AlertSync`
  decides, and a chosen notification place never follows browsing (section 12.1). The sheet
  closes as the place is chosen, not when its answer arrives.
- **Recent places.** A search result or a recent place joins the list at once, under its name;
  the device's place has no name of its own, so it joins under its answer's name when the answer
  arrives (`RecentPlace`'s rule: "a device location's comes from its answer"), and not at all if
  none comes. A place under "Nearby:" is browsing and doesn't join it. `recent.v1` is the
  client's JSON in the app's own defaults (`RecentDefaults`; the widgets never read it);
  `RecentPlaces.list(stored:)` reads it leniently, skipping an entry that isn't a place, IP
  location or a second entry for a place, and cutting it to five. `-resetStore` forgets it. The
  "Recent" heading is written as it is (`.textCase(nil)`), not capitalised.
- **The location hook is filled with a service of its own.** `AppHooks.locate(_:)` is gone:
  `LocationService` (IsItState: `access()`, `requestAccess()`, `fix()`) is in `AppEnvironment`,
  with `NoLocation` (as if permission were off) by default. The rules are `AppModel`'s, tested on
  Linux: launch step 4 reads the permission and takes a fix only when it is granted, never
  asking; `locate()`, for "Use my location", asks only when permission was never asked
  (restricted reads as denied), then takes one fix, rounded with `Target.device(lat:lon:)`. A
  permission that went while the fix was out reads as denied, and a fix that never came says
  "Couldn't find your location. Search for a place instead." (`AppCopy.locationUnavailable`,
  new). The tests' recording hooks are the location too, so the launch's order of calls is still
  checked whole. A tap while the fix is out does nothing.
- **Deviation: Core Location is in IsItLocation, not IsItServices.** The widget links
  IsItServices, and Xcode links a package target's code whole, Objective-C classes kept by dead
  stripping, so `CoreLocationService` there would put `CLLocationManager` in the widget's
  binary, which has no purpose string and asks for no location (App Store Connect's ITMS-90683
  checks each bundle). It is a module of its own that only the app links, as IsItAds is.
  `ci/release-check.sh` and `scripts/check-archive.sh` now fail a widget that names
  `CLLocationManager`, as they fail one that links Google Mobile Ads.
- **The approximate line's "Use my location" opens the picker finding the phone's place**, so
  permission is still asked at that tap, and a refusal has somewhere to say so with Open
  Settings and the search beside it. It starts in `onAppear`, not `.task`, which is cancelled as
  the sheet closes and would cancel the chosen place's fetch with it.
- **The purpose string is generated** (section 15.2's words, `AppCopy.locationPurpose`): the
  generator writes it into `apps/ios/Configs/Generated/Copy.xcconfig` (a folder it owns) as
  `LOCATION_PURPOSE`, which Snow.xcconfig includes and Info.plist reads as
  `$(LOCATION_PURPOSE)`. An xcconfig reads `//` as a comment and `$(` as a setting, so the
  emitter refuses either, and a line break or spaces at the ends. `InfoPlistTests`, hosted by
  the app, checks the built Info.plist holds the copy, and no `NSLocationDefaultAccuracyReduced`.
  The app's privacy manifest declares coarse location, linked, not tracking, for app
  functionality (section 15.1); the widget's waits for phase 7, when it fetches.
- **Search fixtures, from the real server.** `packages/mobile` asks `getSearch` on the synthetic
  geocoder, at a fixed moment, as the picker asks: `search-leeds` (a city page),
  `search-kathmandu` (no city page, so a point on the grid; the synthetic geocoder is given
  GeoNames' Kathmandu besides the city list, as `data/places.json` has it) and `search-none`.
  They are in `Fixtures/Search`, so they ship with the Debug fixtures and `Fixtures.names()`
  doesn't list them among the answers.
- **UI tests without the network or the prompt.** `-network` takes a list: the first fixture
  answers approximate IP location as before, each other answers its own place (by its query: a
  city by slug, coordinates by their point, whoever's they are), and the picker's searches are
  answered by the search fixtures with the same query, so an answer on screen still means the
  app asked for the right place. `-location <lat>,<lon>|denied|unavailable` stands in for Core
  Location (a hook in the archive checks, as a short literal; 15 with 6.2's `-openURLs`). `PickerTests` covers section
  17.2's list (stubbed search, too short, no results, a slug result and a coordinate result,
  recents, "Use my location" denied), a fix chosen, and the sheet's accessibility audit with the
  keyboard down.
- **Not proven here:** IsItUI's `PlacePickerView`, `PickerSheet`, `HomeView`'s sheet, Core
  Location's calls and the UI tests are Apple only, built and run only by the macOS jobs. On
  Linux, IsItServices, IsItLocation and `DebugHooks.swift` (Debug and Release) were type-checked
  in Swift 5 mode against stub `CoreLocation`, `UIKit` and `WidgetKit` modules, and the
  `-network` stub's answers were run for the requests the picker's tests make. Unchecked: that
  `.searchable` in the sheet's navigation bar is the only search field XCUITest finds, that a
  swipe on a recent place's button shows the system's Delete, a section header's label with
  `.textCase(nil)`, and that the audit passes with the system's search bar. (It didn't: the search
  field's own clear button was too small to tap, and the box is the app's own since PR #33's second
  macOS run, "The iPhone app's UI tests, after PR #33's second macOS run".)

## The app's support page and privacy notice (S8)

App Store Connect needs a Support URL with real contact details and a Privacy Policy URL, so
the website carries both for the snow app (iOS build spec, section 5.8 and 15.5).

- **The privacy notice gains "Our apps"**, the text of section 15.5 made complete (below): what
  the app sends (the place, rounded to about 5 km, and the units), what notifications keep and
  when it is deleted, AdMob in the free version, and Apple handling purchases. The heading stands
  for the section's first label, so its first paragraph has none. It sits after the website's
  sections and before "Your rights". The website's paragraphs are as they were ("No accounts" is
  still true), except two that now cover the app as well: the intro ("This notice covers all
  four, and our iPhone app") and "Your rights", which said there is usually nothing to find. With
  notifications on there is (a token with a place, as section 15.3's label says, Linked: Yes), so
  it points to Settings → Your privacy and the delete button, or an email with the ID that screen
  shows. The page's description says the app is covered. "Last updated" moves to 23 October. One
  notice on all four sites, as before.
- **What the notice says notifications keep is what the server stores** (`DeviceRecord`, written
  by `devices.ts` on the notifications branch), not section 15.5's shorter list: the token and the
  ID made from it, the place, zone, units and switches, the app's version, whether it is a
  developer build (`env`), when notifications were turned on (`createdAt`) and when the app last
  checked in (`updatedAt` and `seenAt`, both set by every PUT). `v`, `app` and `platform` say
  nothing about anyone. The claims the run and the test send write (`sent/` and `test/`, keyed by
  the ID, holding no token or place) outlive a delete until the 03:00 UTC cleanup takes them, up
  to about three and a half days later, so the notice and the support page say "a few days".
  So does the run's `judged/` note (`{ at }`, keyed the same way), written for a registration
  judged with nothing to send in a zone the run left unfinished; since phases 5 and 6 were
  reviewed together, both pages and Your privacy name it too ("some forecast checks that found
  nothing to send").
  Settings → Your privacy shows the ID's first 8 characters, the place with its zone, the units
  and the switches (section 10.6), so both pages say it shows "the main things we keep".
  - **When it goes.** Turning notifications off in iPhone Settings sends nothing: the app finds
    the permission denied and sends DELETE the next time it is opened (section 12.2), so both
    pages say so, and that the in-app switches delete at once. The 90 days count from the app's
    last PUT, and with nothing changed it puts again only every `ALERTS.heartbeatDays` (7), so a
    registration can go about 83 days after the app was last opened: "about 90 days" in the
    notice, "about three months" on the support page.
  - **In the app's copy since phase 6.2.** Section 15.5's text and `APP_COPY.privacyNotifications`
    (the app's summary, above the live data and the link to this notice) had the shorter list and
    "90 days after you last open the app". Phase 6.2 gave the app's lines the notice's facts:
    "an ID made from it", "a few details such as the app's version and when it last checked
    in", "about 90 days", "no longer installed" and the iPhone Settings case ("The iPhone app's
    Settings", below), and a vitest test holds them to this notice.
- **`/support` on every site** (`SupportBody.astro`; `support.astro` and `snow/`, `wet/`, `wind/`),
  built like Privacy: the contact address (`CONTACT_EMAIL`) as a `mailto:` link and no postal
  address (Q7), then short answers on restoring the purchase, adding a widget, why a
  notification didn't come, and turning notifications off to delete your data (Settings → Your
  privacy → "Turn off notifications and delete my data"), and links to the privacy notice and
  terms. It is about the snow app alone, wherever it is served: it names no other app, site or
  weather, so it leaves out the legal pages' "one service" line (an e2e test checks both).
  - The widget steps cover iOS 18 (Edit, then Add Widget) and iOS 17 (+ at the top left), which
    the app supports, and name the app as the widget gallery and iPhone Settings list it: "will
    it snow?", the name under the icon (Q2).
  - "The app's Settings" and "your iPhone's Settings" are always named as such.
  - Tests are refused from 9pm to 7am at the place (409 `quiet_hours`), which the app shows as
    `testFailed` for now, so the page says to try one in the daytime there. A notification the
    iPhone could not take in time is dropped at its `apns-expiration` (9pm for the evening, 11am
    for the morning), so "It isn't time yet" says that too.
  - The app's labels it quotes are `APP_COPY`'s, and the e2e test builds every answer's full text
    from `APP_COPY` and from the app's `CFBundleDisplayName` in `Info.plist`, so a label renamed
    in the app fails it. It checks the notice's app sections and rights paragraph in full too.
- **Search engines:** every site's copy is canonical on willitsnow.today/support (`Content`'s
  `canonicalTopic`), the App Store listing's Support URL, so search engines see one page about
  one app rather than four copies on four domains. Only willitsnow.today's sitemap lists it, since
  a sitemap lists canonical addresses, and the other sites' sitemaps do not promote a snow app's
  page. That is how section 5.8's "add it to the sitemap" is read. It is not `noindex`. Every
  footer links it, after Terms. Privacy, Cookies and Terms stay canonical on each site's own
  domain and out of the sitemaps, as before.
- **The address wraps.** At 320px with text at 200%, support@willitsnow.today is wider than the
  page, and Privacy (which has carried it since the contact PR) scrolled sideways. A `mailto:`
  link in a content page may now break anywhere; an e2e test checks both pages on every site.
- **Written out, not generated:** the notice's 90 days and the support page's "about three
  months", "about 6pm" and "about 7am", "until 9pm" and "until 11am", and "between 9pm and 7am"
  are the notifications branch's `ALERTS.staleAfterDays`, `windows` and `quiet` (phase 4). A
  change there must change these pages, and their tests, by hand. The test takes the two times
  from the app's switches (`APP_COPY.evening` and `morning`); once `ALERTS.windows`, `quiet` and
  `staleAfterDays` reach main, it should check the numbers against them as well.

## The iPhone app's Settings (apps/ios, IsItCore, packages/mobile; phase 6.2 and 6.3)

The iOS build spec's PRs 6.2 and 6.3: the Settings sheet behind the gear, How it works, Credits
and licences, the static lines of Your privacy, and Report an ad (sections 10.4, 10.6 and 10.7).
`apps/ios/README.md` ("Phase 6", "6.2 and 6.3") lists the types.

- **The shell has only what works now.** Section 10.4's order stands, with three sections left to
  the phases that make them work, rather than rows that do nothing (section 0.2: nothing
  dormant, no placeholder): Notifications (12.1) is phase 8's and goes after the units; the
  upgrade row and "Restore purchase" are phase 7's and go after that, since there is no product
  to price or restore until StoreKit is in (10.4 says "Restore purchase, always visible": from
  phase 7 on); "Privacy choices" shows only while the ads are on and Google's form is required,
  which only phase 8's consent code can say, so the app passes false. `SettingsScreen` takes
  that flag already, `YourPrivacy` the lines kept for notifications (nil until a registration),
  and `SettingsActions` the form and the delete button, both nil.
- **"Ads on" is the free version** (`!unlocked`), as section 14.2 starts the ads only when not
  unlocked: Report an ad shows in the free version (10.7) and Your privacy's ads line with it,
  though phase 6 builds no banner yet. Bought, neither shows.
- **Your privacy says what the privacy notice says.** Section 10.6's lines were shorter than PR
  #28's notice and PR #30's server (`devices.ts`): the place is "a town, or your location
  rounded to about 5 km" (a town isn't rounded); until a place is chosen the server estimates
  one from the connection; besides the token, the place, zone, units and switches, the server
  keeps an ID made from the token and a few details (the app's version, the developer-build
  flag, when notifications were turned on and when the app last checked in); deletion is "when
  you turn notifications off in the app, when Apple tells us the app is no longer installed, or
  about 90 days after you last open it" (the 90 days count from the last PUT, at most a week
  old while the app is used), and "If you turn notifications off in your iPhone's Settings
  instead, we delete them the next time you open the app." `credits.test.ts` holds each fact to
  the notice's own words, and the 90 to the notice's and to `ALERTS.staleAfterDays`, the days
  the notifications run keeps a registration that has not checked in.
- **"See Privacy choices." is a line of its own** (`APP_COPY.seePrivacyChoices`), shown after the
  ads line only while the Privacy choices row is in Settings: outside the UK and the EEA,
  Google's form isn't required and there is no row to see. Section 10.6 had it in the ads line.
- **Report an ad (10.7).** The subject is `reportAdSubject` with the marketing version
  ("Report an ad (willitsnow.today 1.0)"), the body section 10.7's with the phone's time in
  figures and its own zone ("2026-10-23 15:05 Europe/London", which matches logs whatever the
  phone's language) and the place on screen (empty while none is known). The email is written
  at the tap. The `mailto:` URL encodes the subject and body as `encodeURIComponent` does
  (RFC 6068: a space is `%20`, never `+`, which a mail app would show). When the open's
  completion says false, the fallback sheet shows the address with "Copy address" and "Copied.",
  announced to VoiceOver. Contact us falls back the same way, with one new string,
  `contactUsBody` ("Email {email}. Tell us what happened, and the version number at the end of
  Settings.", as the support page asks).
- **Addresses come from core.** `Constants.Site` (generated) has willitsnow.today's privacy,
  terms and support pages and `CONTACT_EMAIL`; the pages' paths are packages/mobile's
  `SITE_PAGES`, and a test finds each in `apps/web/src/pages/snow/` with the body that renders
  at that path. No URL or address is typed in Swift.
- **How it works** is the About page's snow section and its location and data paragraphs,
  rewritten for an app about snow alone: no four-sites paragraph, no "Wet and Snow agree"
  sentence (another weather type), and "rounded to about 5 km before it leaves your phone". Its
  numbers are slots the app fills from the generated constants, written as the About page
  writes them (`String(n)`, `Math.round`): `Constants.models.count`, `Snow.likelyFrom`,
  `maybeFrom`, `Day.snow`, and, newly generated, `Snow.cmPerMm`, `warmAboveC`, `Snow.Hour` and
  `Snow.Normals` (core `SNOW.hour` and `SNOW.normals`, whole). The answer words are lower case
  ("the answer is yes"), so the copy keeps the sentence-case rule without making Yes, Maybe and
  No names; "the climate records" stand for NASA POWER, which the credits name.
- **Credits are data, beside core's.** Core's credits (`COPY.forecastCredit`, `metOfficeCredit`)
  are shown as the footer splits and links them; packages/mobile `credits.ts` adds the models'
  agencies, listed as the About page lists them, the climate records' credit (core's
  `climateCredit`, then NASA's project, for snowfall only) and the place names', with GeoNames
  linked, and the typeface and Google's two SDKs, each with its notice. `pnpm mobile:generate`
  writes them into `AppCredits.swift`. They are names and licence titles as their owners write
  them ("SIL Open Font License", "NASA Langley Research Center"), so they aren't in `APP_COPY`,
  whose British spelling and sentence-case tests they couldn't pass; they have tests of their
  own (no other weather type, https links, the files).
- **The notices are bundled whole** in `Apps/Snow/Resources/Licences/`, which the app target's
  resources already take (XcodeGen 2.46.0 built from source puts the three files in the app's
  resources phase, not the widget's; project.yml is unchanged). Bricolage Grotesque's is its
  npm package's LICENSE (the font's source, `exportFont.ts`), and a test holds the copy to it
  byte for byte. Google's are the LICENSE files of the two Swift packages at the revisions
  `Package.resolved` pins (Apache 2.0, "Copyright 2021 Google LLC", SHA-256 `fd112c8…`), and a
  test fails when a pin moves, so they are copied again. Those notices cover the packages; the
  binary SDKs they fetch are Google's, under Google's terms, and whether the zips carry notices
  of their own was not checked here (dl.google.com is blocked).
- **The units** (`AppModel.setUnits(_:)`): kept in `units.v1`, then `refresh()` in them,
  keeping what is on screen, as the website's units pill reloads quietly; then
  `syncAlerts(target:units:)`, since a registration carries the units (a no-op until phase 8).
  Offline, the choice stays and the answer on screen stays in the old units, with the offline
  line; the next launch never paints it (`Launch.paints` checks the units).
- **A Debug hook for the rows, `-openURLs record|nomail`.** A UI test can't follow Safari or the
  mail app, so under it the sheet's `openURL` records each URL and shows the last one at its
  bottom, with the units the last request asked in (only the units, never the place); `nomail`
  refuses `mailto:` as a phone without a mail app does. It is in `DebugHooks.swift` under
  `#if DEBUG`, and `check-archive.sh` looks for it in Release binaries (15 hooks, with 6.1's
  `-location`). Since phase 6 was put together it records the picker's Open Settings too (below).
- **The literal-strings guard** (section 10, phase 6's exit) is a vitest test,
  `packages/mobile/test/swiftLiterals.test.ts`: it reads every Swift file the app and its
  packages compile, and fails on a view or modifier given a string literal (`Text("…")`,
  `Button("…")`, `.navigationTitle("…")`, `.accessibilityLabel("…")`, a `prompt:` or `title:`
  with words of its own). `Text(verbatim:)`, identifiers and SF Symbols' names pass. When phase
  6 was put together it gained a second guard, for prose in any literal (below).
- **The copy test's names** gain "iPhone" and "ID" (in "your iPhone's Settings" and "an ID made
  from it"), proper nouns as section 10.9's word list allows.
- **Not proven here:** IsItUI's Settings views, the sheet, the recorder, the pasteboard,
  `openURL`'s completion saying false for a refused `mailto:` and `SettingsTests` (with its
  accessibility audits) are Apple only, so the macOS jobs prove them first; whether XCUITest
  finds the segmented control's segments by "cm" and "in", and whether the audit passes the
  system's own Form and navigation bar, are from practice, unchecked. The presenters, the
  model, the copy and the generated files ran here. (The audit failed the Form's text on PR #33's
  macOS runs: Settings is a page that scrolls now, "The iPhone app's UI tests, after PR #33's
  third macOS run".)

## The iPhone app's phase 6, put together (apps/ios, packages/mobile)

Phase 6.1 (the picker) and 6.2 with 6.3 (Settings) were built side by side from the same home
screen, then merged into `claude/ios-picker` with ordinary merge commits, keeping both. What
had to be made to agree:

- **One sheet at a time, presented in one place.** Both builds put their sheet on `HomeView`'s
  `TimelineView` with a state of their own. Now one state, `HomeSheet?` (`.picker(PickerRequest)`
  or `.settings`), drives both: the picker as a full-screen cover (section 10.3) and Settings as
  a sheet (10.4), each closing only itself, so two can never be asked for at once. The top bar's
  place button and the approximate line's "Use my location" open the picker (the second finding
  the phone's place), and the gear opens Settings; `HomeContent` takes one `open` closure for
  both. Both sheets are outside the page's colours and follow the system's, and Dark Mode.
- **One URL recorder.** 6.2's `-openURLs` recorder was applied inside `SettingsSheet`. It is now
  applied where `HomeView` presents each sheet, to both, so the picker's Open Settings
  (`UIApplication.openSettingsURLString`) is recorded as Settings' rows are, and
  `PickerTests.testOpenSettingsOpensTheAppsPage` reads it. The home screen's own links are left
  as they were (phase 5.4's HomeTests own them).
- **One search stub.** 6.1's `-network` answered the picker's searches from the search fixtures;
  `-fixture` answered every request, searches included, with its forecast, which doesn't decode
  as a search. Both now share `SearchStub` in `DebugHooks.swift`: a search fixture's query gets
  that fixture, any other search a 404, whichever hook is on. The units each request asks in
  are still noted for the recorder by both transports.
- **The hooks are counted once.** Each build added one hook (`-location`, `-openURLs`) and
  counted 14; there are 15, in `check-archive.sh`'s summary and its test.
- **Generated files were regenerated, not merged.** `pnpm mobile:generate` after the merge wrote
  nothing new: git's merge of `AppCopy.swift` was already what the merged `appCopy.ts` generates.
  The generator's file list has both builds' additions (`AppCredits.swift` after `Constants.swift`,
  `Copy.xcconfig` after the palettes), and its test the shifted indices.
- **The guard for words typed in the Swift** (phase 6's exit, section 10 and Appendix D) has
  two halves in `packages/mobile/test/swiftLiterals.test.ts`. 6.2's stays as it was: no view or
  modifier is given a literal. The new one reads every string literal in the Swift that ships
  and fails on any that looks like prose and isn't on the allowlist.
  - **Why a lexer, not a regex over lines.** A literal can sit anywhere (a `let`, a ternary, an
    interpolation, a multi-line or raw literal, an argument on the next line), and what makes
    one harmless is the call it belongs to (`fatalError(` on the line above, say). So
    packages/mobile `swiftLiterals.ts` reads Swift's comments (nested block comments too), every
    form of literal with its escapes and interpolations, and the brackets, giving each literal
    its text, line, callee and argument label. A literal or bracket it can't close throws, so a
    source it misreads fails the guard rather than slipping past it.
  - **What counts as prose:** two words or more, or one capitalised word, or one word ending a
    sentence, where a word is letters (with an apostrophe or hyphen inside) and the punctuation
    around it. Keys, CamelCase identifiers, paths, URL pieces, header names such as
    `Content-Type`, and format specifiers have none, so the allowlist names only what looks like
    prose and isn't shown: by call (`accessibilityIdentifier`, `fatalError` and its kin,
    `appendingPathComponent`), by label (`debugDescription`, `forResource`, `withExtension`,
    `subdirectory`, `forInfoDictionaryKey`, `systemName`), and three names (`Accept`,
    `Infinity`, `Fallback`), each commented, with a test that each name is still used.
  - **Where it looks:** every `.swift` file under `apps/ios`, found by walking the folder so a new
    one is covered at once, but the generated folders, the test targets and build output. The
    tests are left out because their literals are the words they expect and their failure
    messages; the generated copy because its words are checked in TypeScript.
  - **Its limit:** one lowercase word or a symbol ("cm", "°C") looks like a key, so it passes; in
    a view, the first guard catches it. (Narrowed in review: given to any view or label, however,
    it fails; "The iPhone app's phase 6, reviewed".) The Swift had no stray prose to move into
    `appCopy.ts`: what the guard flagged were DebugHooks' crash messages, IsItModel's decoding
    errors' and the three names. Planted literals ("Opens in Safari" in `HomeView`, a sentence in
    a new folder) fail it.
- **Not proven here:** `HomeView`'s one-state presentation (the `Optional<HomeSheet>` bindings),
  the recorder on the picker and the new UI test are Apple only, so the macOS jobs prove them
  first. The bindings' logic was run on Linux against a stub of SwiftUI's `Binding` (its
  dynamic member by a writable key path), and `DebugHooks.swift`'s Foundation half (the search
  stub with both transports) type-checked in Swift 5 mode, Debug and Release, with the SwiftUI
  recorder left out.

## The iPhone app's phase 6, reviewed (apps/ios, packages/mobile)

What the review of phase 6 (the picker and Settings, put together) found, and what changed for
it.

- **Close means no place, even while the phone is being found.** The approximate line's "Use my
  location" opens the picker already finding the phone's place; closed then, the fix still
  chose the device's place when it came: `place.v1`, the request with the rounded location, the
  recent places and the notifications' sync. A search result or recent place chosen meanwhile was
  replaced the same way. `PlacePickerModel` now notes when its showing is over (a place chosen,
  or `close()`), and a fix that comes after that chooses nothing and leaves the row idle. Two
  Linux tests hold the fix (`RecordingHooks(holdingFix:)`): Close, then the fix; a city chosen,
  then the fix. Both failed before the change.
- **Your privacy says what the notice says about the notes, the searches and the phone.** The
  notifications line said everything kept is deleted when notifications go off, but the run's and
  the test button's notes (`sent/`, `judged/`, `test/`, keyed by the registration ID, with no token
  or place) stay until the cleanup a few days later, as the privacy notice and the support page say.
  The line now ends "For a few days after each notification and each test, we also keep a note that
  it was sent, even once the rest is deleted. It holds no token or place." (That left out `judged/`,
  which records no sending; since phases 5 and 6 were reviewed together, it names "some forecast
  checks that found nothing to send" too.) The forecast line adds the notice's other two facts about
  the app: place names searched for go to Open-Meteo, and the app keeps the place, units, recent
  places and last forecast on the iPhone (still five lines, as section 10.6 has them).
  `credits.test.ts` holds each to the notice's words; "Open-Meteo" joins the sentence-case test's
  names. The 90 days are written out in the copy, and since main (PR #30) was merged in, the test
  checks them against `ALERTS.staleAfterDays` as well as against the notice.
- **The literal guard catches a word however a view is given it.** It missed a lowercase word
  passed to `Text(verbatim:)` (how every view here draws text) or to an accessibility label,
  a unit beside an interpolation (`"\(depth) cm"`, `"\(snowy) of \(total)"`), and a capitalised
  abbreviation with a value (`"ID \(prefix)"`, `"ID " + prefix`), which phase 8's "What we keep
  for notifications" will show. Now a literal with any letter in it is words when its label is
  `verbatim`, `prompt`, `title` or `message`, when it is a view's or label modifier's unlabelled
  argument, or UIKit's announcement's; and anywhere, one word set beside other text with a space
  is prose. Only a lowercase word or a symbol alone outside any view still passes, as a key's
  shape. The shipped Swift passed unchanged: no literal is given to `Text(verbatim:)`.
- **"Copied." is announced with UIKit.** `MailFallbackView` posted iOS 17's
  `AccessibilityNotification.Announcement`, which the Accessibility framework declares and IsItUI
  didn't import; whether SwiftUI re-exports it was never shown. It now posts
  `UIAccessibility.post(notification: .announcement, argument:)`, UIKit's long-standing call,
  which the home screen's announcement on the pages branch uses too.
- **The UI tests read a text by its own label.** SettingsTests found a text containing some words
  with `staticTexts.containing(_:)`, which matches elements with such a descendant; a text has
  none, so the positive checks would have failed and the negative ones passed without testing
  anything. It is `staticTexts.matching(_:)` now.
- **Every screen the UI tests open is audited, and an audit lists every issue.** The full licence
  screen, Contact us's fallback and the picker's results (with the keyboard put away by a drag on
  the list, as scrollable content does from iOS 16) had no audit, against section 16; they have
  one each, with their screens attached. Every audit in PickerTests and SettingsTests goes through
  `auditAccessibility(of:on:)` (`UITests/ScreenAudit.swift`): every audit type, each issue noted
  with its type, its element's identifier and label and Apple's description, then one failure
  that lists them all, since the tests stop at their first failure. There are no exceptions.
- **Left for Carl: does a recent place from "Use my location" follow the phone?** A device fix
  joins the recent places as a device target named by its answer ("Leeds"). Chosen from the list
  later, it is My location again, so launch step 4 moves it to wherever the phone is at the next
  launch: chosen in London, "Leeds" becomes London. The spec doesn't say how recents and step 4
  meet, and both fixes change what users see: a recent chosen from the list could be a fixed place
  that step 4 never moves (a flag beside `place.v1` that only "Use my location" sets), or device
  fixes could stay out of the recent places. Nothing changed until Carl picks one; it is under
  "Open decisions" below.
- **Not proven here:** the announcement, the UI tests' text query, the new audits and their
  helper, and the keyboard put away by a drag are Apple only, so the macOS jobs prove them first.
  The helper uses only the audit API that the pages branch's `HomeAuditTests` built with on its
  macOS run, and the three UI test files type-checked on Linux against stubs of XCUITest's
  main-actor API. Whether the audits pass is unknown until then: candidates are the system's `.secondary` footers
  and detail lines (contrast), Credits' links inside a paragraph (hit regions), and, behind the
  Settings sheet, the home screen before phase 5.4's fixes. The picker model, the copy and the
  guard ran on Linux.

## The iPhone app's phases 5 and 6, put together (apps/ios, IsItCore, packages/mobile)

Phases 5.2 to 5.4 (PR #31, `claude/ios-pages`) and phase 6 (`claude/ios-picker`) were built side
by side from the 5.1 home screen. Main, with the support pages (#28) and the notifications server
(#30), was merged into phase 6 first, then the pages branch, with ordinary merge commits keeping
both. What had to be made to agree:

- **Choosing a place keeps the view.** Phase 6's `show(_:)` opened an answer on the view for the
  time of day whenever nothing was on screen before it (`response == nil`), which `select(_:)`
  makes so for every new place: a place chosen from This week came back on Today, or on Now from
  6pm. Phase 5's review had already replaced that rule, for a place under "Nearby:", with
  `opened`: the view is chosen once, by the saved answer painted, the first answer shown, the
  user or a route. The merge keeps phase 5's rule, and `choose(_:name:)` goes through
  `select(_:)`, so a place chosen in the picker answers on the view the user is on, as a nearby
  place does. Only while nothing has chosen a view (a failed launch, the user not having moved)
  does its answer open on the view for the time of day. Two Linux tests in `AppModelViewTests`
  hold both: a recent place chosen from This week stays on This week, and is still a recent
  place; one chosen after a failed launch at 6:05pm in Durham opens on Now. The first fails when
  `choose` resets the view (checked by planting that). Phase 6's picker tests assert no view, so
  none of them changed.
- **The sheets over every page.** `HomeView` keeps phase 6's one `HomeSheet?` (the picker as a
  full-screen cover, Settings as a sheet, each under the `-openURLs` recorder) and phase 5's
  minute tick (`TimelineView(.periodic(from: MinuteTick.anchor(…), by: 60))`), with the
  switcher, the pager and `Announcements` in `HomeContent`. The top bar is `HomeShell`'s, above
  the pager, so the place button, "Use my location" and the gear open their sheets from Now,
  Today and This week alike. The sheets are presented from outside `HomeShell`, so phase 5.4's
  dark colour scheme for the system's controls on a dark page doesn't reach them; they still
  follow the system's colours and Dark Mode.
- **Under a sheet, the pages leave the accessibility tree** (`.accessibilityHidden(sheet != nil)`
  on `HomeContent`). VoiceOver already ignores what is under a modal sheet, but XCUITest's
  queries, and so perhaps its audit, see it: phase 6's review named "behind the Settings sheet,
  the home screen" as a candidate for the Settings audit's failures, and with phase 5 the
  switcher's segmented control is there, whose own type size `HomeAuditTests` allows as an
  exception and phase 6's audit, which has none, would not. (Firmer since: PR #31's macOS run
  found the top bar's "Use my location" and "Using approximate location." failing Dynamic Type
  on every page, and "Use my location" contrast on the pale ones; the top bar stays on screen,
  dimmed, behind a sheet. "The iPhone app's phases 5 and 6, reviewed", below.) Nor, since that
  review, are their changes announced under a sheet. The home screen is audited by
  `HomeAuditTests`, page by page and screenful by screenful; the sheets' audits now read only the
  sheet. `SettingsTests.assertSnowOnly` already counted only what can be tapped, and no picker or
  Settings test reads the home screen while its sheet is open.
- **The hooks, from both.** `DebugHooks.swift` has phase 5's `-clock fixed|run`,
  `-network unavailable` and `stillMotion()`, and phase 6's `-location`, `-openURLs`, the search
  stub, `-resetStore` forgetting the recent places, and `-network`'s list. `StubServer.Mode` is `.off`,
  `.unavailable` (503 `upstream_unavailable` for every request, searches too) or
  `.fixtures(ip:places:)`: `-network`'s value is one of the first two whole, or else a comma list
  of fixtures, and the clock starts at the first one's moment (`StubServer.fixtureNames`). A list
  with no name stops the app. No two hooks share a name, and the archive checks' list was already
  whole (`-clock` was in it from the spec).
- **The copy and the generated files.** `appCopy.ts` has both sides' keys (git merged it without a
  conflict). `generate.ts` writes both sides' new files (`Copy.xcconfig` and the search fixtures;
  `HomeScreens.json` after the vectors) and owns both new folders (`Configs/Generated`,
  `UITests/Generated`), and its test has the indices that follow. `pnpm mobile:generate` after
  the merge wrote nothing: git's merge of the generated Swift, the vectors and `HomeScreens.json`
  was already what the merged sources generate. `PortedVectors` lists `page.json` with 5.4's
  `HomeTopBar` and 6.1's `search.json`.
- **The literal guard over phase 5's Swift.** It passed unchanged. Phase 5's Swift (the pager, the
  switcher, the bodies, the glyph view, the announcements and the clocks) gives no view a literal,
  and its only prose is `DebugHooks`' crash message for a bad `-clock`, allowed as a crash's
  message. Nothing moved into `appCopy.ts`.
- **The tests still find what they look for.** Phase 5's UI tests use the top bar's `place`,
  `settings`, `use-my-location` and `approximate` and the pages' identifiers; phase 6's use the
  sheets' own (`picker-…`, `result-…`, `recent-…`, `location-detail`, `close-settings`, `units`,
  `debug-…`) and the page's `heading` and `verdict`, which the pager keeps once in the tree, the
  page on screen's. At the stubbed launches' moments (12:05pm in Leeds; 11:50am UTC) that is
  Today, the page phase 6's tests were written against, and a chosen place stays on it. The UI
  test helpers don't collide: `HomeScreens.swift`'s `XCTestCase` extension (`launchApp(_:)`,
  `launch(_:clock:size:)` and `tap(_:in:)`, which take a `HomeScreen`) and the classes' private
  `launch(_:)` and `tap(_:in:)`, which take strings, are overloads by type, as `LaunchTests`' was
  already beside it.
- **The project.** `project.yml` merged without a conflict (6.1's IsItLocation for the app, 5.4's
  comment on the UI test bundle, which now names phase 6's files too). XcodeGen 2.46.0, built on
  Linux, generates the merged project: the test plans' target IDs are unchanged, and the UI test
  bundle has `HomeScreens.json`, `PickerTests`, `SettingsTests` and `ScreenAudit`.
- **Not proven here:** everything Apple only: `HomeView` as merged (the periodic timeline with the
  sheets, and the pages hidden under them), IsItUI, and the UI tests over the merged app, so the
  macOS jobs prove them first. (The merge took PR #31's head as its macOS run was thought to be
  still going. It had finished, and failed: 6 of 26 UI tests, every one `HomeAuditTests`, with the
  home screen exactly as merged here. The review below fixed what it found.) On Linux,
  `DebugHooks.swift` (Debug and Release, its SwiftUI recorder left out) type-checked in Swift 5 mode
  against stub UIKit, WidgetKit and Core Location modules; its stub answered
  `-network ip-first-launch`, `ip-first-launch,leeds-dry`, `off`, `unavailable` and `aberdeen-snow`
  as it should for IP location, a named place, a known search and an unknown one; and its clock
  started where each launch says, fixed under `-clock fixed`. Everything in IsItCore ran on Linux.

## The iPhone app's phases 5 and 6, reviewed (apps/ios, IsItCore, packages/mobile, the website)

What the review of phases 5 and 6 put together found, and what changed for it.

- **PR #31's macOS run had failed, not passed or still been running.** Its `ios` job on f030349
  (run 40047913226) built, passed the 18 unit tests and the Release check, and failed the UI
  plan: 26 tests, 20 passed, 6 failed, all six `HomeAuditTests`. HomeTests (7), OfflineTests
  (4), LaunchTests (3) and FixtureLaunchTests (6) passed, and the UI step took about 32 minutes
  of the 90. The merge into phase 6 had left the home screen and its audits as they were on
  #31, so the combined branch would have failed the same six. What the log showed, and the
  changes (none an exception):
  - **At Large, the pages never scrolled to their end** ("its end never came into view in 15
    screenfuls", every page of the three fixtures), and from the second screenful on every
    audit found the same issues, so the page stood still after its first scroll. The drag went
    from 90% of the page's frame to 10%, down its middle, across buttons and links, starting
    near the screen's bottom edge, with a 50 ms press. It is now a drag in the page's left
    margin (10 points in; the pages have 20 of padding), where no control is, from no lower
    than 90% of the part of the page on screen and 80 points above the screen's bottom edge,
    with no press to speak of; its length brings the first element the screen doesn't show
    whole to the top (read from one snapshot of the page), between a quarter and four fifths of
    the page on screen; the credits' frame is read once it has settled (a page pulled past its
    end springs back, which the old test read as a move); and a page that scrolls no further
    short of its end fails at once with where the page and the credits were on each screenful,
    as do the other failures, so the next log says where things are.
  - **At AX3, every audit after the first scroll threw**
    `com.apple.accessibilityAudit Code=-902 "Invalid target app <pid>"`: the first screenful was
    attached and audited, the drag ran, the second screenful was attached, and the audit then found
    no app to audit. The drag at AX3 started still closer to the bottom edge (the top bar and the
    stacked switcher are taller there), so a system gesture is the likely cause; the new drag keeps
    clear of it. Each audit now first checks the app is in the foreground, and an audit that throws
    fails its page with the app's state and the geometry, and the test goes on to the next page,
    rather than stopping the test with nothing else known. Unproven until the next run.
  - **What a screenful cuts is judged where it is whole.** The audit measured contrast for
    elements the screen didn't show whole: the answer and the question passed on each page's
    first screenful, where they were whole, and failed on every screenful after, scrolled off
    the page's top under the switcher; the places nearby and the outbound links failed on the
    first screenful, where, by the layout's sizes, they were at the screen's bottom edge or
    below it. The palettes give the ink 6.26:1 or more on both ends of every gradient (section
    16's check), so no colour changed. `HomeAuditTests` now judges an issue on a page element at
    once only if its screenful shows the element whole (within the part of the page on screen,
    to a point), and holds the rest until the page's last screenful: one that another screenful
    showed whole was judged there, and goes; one no screenful showed whole is judged as it was,
    marked so. The top bar's and the switcher's elements, which don't scroll, are always judged
    at once. On Linux, a copy of the logic ran against fake issues (an answer cut at the top, a
    place at the bottom edge, the top bar's button, a whole element, one taller than the page, a
    week row's "Today" scrolled under the switcher, a segment) and judged each as above.
  - **The top bar's approximate line was the one real fault found**: "Using approximate
    location." and "Use my location" failed `dynamicType` ("partially unsupported") on every
    page of every fixture, and "Use my location" `contrast` on every pale page (nosnow,
    flakes), on every screenful, where it was whole. Both were inside a `ViewThatFits` that
    chose between a row and a column of the same two views; the same text, link and button
    drawn by the footer's `FlowLayout` passed both. The line is now one `FlowLayout`, the text
    and the button each laid out once, centred in a line as tall as the button's hit region.
    The two other `ViewThatFits` on the home screen, the switcher's buttons and a week row's day
    and amount at accessibility sizes, became `FlowLayout`s the same way; no AX3 audit
    reported, since each test threw at its second screenful. Whether this clears the issues is
    for the next run: nothing in the log says which of the two arrangements, or what in them,
    the audit read.
  - **The hand-off and the merge's section** above read as if #31's macOS run were still to
    come; the section now says it had failed, and how.
    `.accessibilityHidden(sheet != nil)` stays: the elements the run flagged on the home screen
    include the top bar's, which stays on screen, dimmed, behind Settings' sheet.
- **UIKit's segmented control, decided once for both phases.** Phase 5 expects the audit to report
  a segmented control's fixed type size (`HomeAuditTests.exceptions[0]`), phase 6 put one in
  Settings (the units) under an audit that allows nothing, and the merge's reasoning for hiding the
  home screen leaned on phase 5's expectation; both can't hold. Whatever the audit does, section
  16 has every string grow to AX5, and a segmented control's titles don't. So Settings draws its
  own: `UnitsSegments` (IsItUI), cm | in as two buttons in a segmented track, the one chosen
  raised and marked selected, labels in the Form's text so they grow, each 44 points at least and
  tapped on its own (`.plain`, as a Form row's buttons must be). Section 10.4 asks for "a segmented
  cm | in control", which this is in look; 10.2 asks for a segmented `Picker` for the switcher, so
  the home switcher keeps UIKit's at standard sizes, with its documented exception, and buttons
  that scale at accessibility sizes. Drawing the switcher the same way and dropping the exception
  is Carl's call, below. `SettingsTests` finds the units by their group (`app.find("units")`, not
  `segmentedControls["units"]`), and now also checks the other choice isn't selected each time.
- **VoiceOver hears nothing from under a sheet.** The pages left the accessibility tree under a
  sheet, but their announcements were still posted: at 6pm with Settings open on Durham's Today,
  the minute's tick turned the middle page to Tomorrow and VoiceOver spoke "Durham. Will it snow
  tomorrow? Yes. It'll snow." over Settings; a quiet refresh's new answer too.
  `Announcements.drawn(_:covered:)` (IsItState) now says nothing while covered, and still notes
  the page as heard, so nothing from under the sheet is said once it closes (VoiceOver reads the
  page from there) and the next change after it is. `HomeView` passes `covered: sheet != nil`.
  Two Linux tests (`AnnouncementTests`): London's 6pm flip drawn covered, minute by minute, says
  nothing, then or after; a failure drawn covered, then a nearby place's answer, is announced.
  Both failed before the change (checked with the parameter in place and ignored).
- **`-clock fixed` no longer stops the picker's search.** `FixedClock` never runs work due later,
  and the picker's 250 ms pause after typing was scheduled on the model's clock, so a picker test
  at a fixed moment would have shown "Searching…" for ever. The pause counts time passing and
  shows no moment, so it now runs on `AppEnvironment.waits`, the model's clock unless given; a
  Debug build under `-clock fixed` gives the system's (`DebugHooks.waits()`), and a Release build
  never does. Two Linux tests: with a `FixedClock` for the model and a test clock for waits, the
  search asks once the waits' clock passes 250 ms (it failed before the change); without waits,
  the model's clock times it, as every existing picker test has it.
- **Your privacy and the notice name the run's `judged/` note.** They said only notifications and
  tests leave a note that outlives a delete. The run also writes
  `judged/v1/<date>/snow.<kind>/<app>.<id>` (`{ at }`) for a registration judged with nothing to
  send in a zone it leaves unfinished, and the cleanup takes it with the others, more than 2 days
  on. Keyed by the registration ID, it is personal data like them, so the copy
  (`APP_COPY.privacyNotifications`), the privacy notice (`PrivacyBody.astro`) and the support page
  (`SupportBody.astro`) now add "after some forecast checks that found nothing to send" and "Our
  notes of notifications, tests and forecast checks"; `credits.test.ts`'s pair and the Playwright
  assertions on both pages changed with them, and appCopy.ts's comment says which keys each note is.
- **Not proven here:** everything in IsItUI (the top bar, the switcher's and the week rows'
  `FlowLayout`, `UnitsSegments`), `HomeView`'s `covered`, and the UI tests, which compile and run
  only on the macOS jobs: whether the audit now passes the top bar, whether the new drag scrolls
  each page to its end in at most 15 screenfuls at AX3, whether the AX3 audits run, and whether
  Settings' audit passes `UnitsSegments`. On Linux the nine UI test files type-checked against
  stubs of XCUITest (with the new `state`, `elementType`, snapshot `frame` and
  `withOffset(_:)`), the held-issue logic ran against fakes, `DebugHooks.swift` type-checked in
  Debug and Release, and IsItCore's 313 tests passed.

## The iPhone app's UI tests, after main's first macOS run

PRs #31 and #32 merged before their macOS UI tests finished. Main's first `ios` run on 71128e9
(run 40061399787, job 120775981243) built, passed the 20 unit tests and the Release check, and
failed the UI plan: 39 tests, 21 passed, 18 failed. Every `PickerTests` test but
`testUseMyLocationDenied` failed (8, "No picker"), every `SettingsTests` test (4, "No Settings"),
and every `HomeAuditTests` test (6, each page "scrolls no further, but its end isn't on screen",
and the audit's issues). FixtureLaunchTests, HomeTests, LaunchTests and OfflineTests passed. PR
#32's own run (job 120771667747) failed the same 18 at the same lines, to within 3.33 points.

- **One app fault explains the picker, Settings and the pages at Large.** `HomePager` gave each
  page `.containerRelativeFrame([.horizontal, .vertical])`. A horizontal scroll view is a page's
  container only along the axis it scrolls, so each page took the height of the screen's safe
  area (778.33 points on the iPhone 17: 874, less 62 and 34), the scroll view took the page's,
  and `HomeShell`'s `.frame(maxHeight: .infinity)` doesn't clamp a child taller than its offer.
  The home screen was taller than the safe area by the top bar and the switcher, and the window
  centred it. Two numbers in the log agree. The pages began at y=132.33, so the overflow was
  140.67 points, half of it above the safe area. Every page at Large stopped scrolling with its
  content's end at y=910.67, which is 132.33 + 778.33. So the place button and the gear were
  centred at about y=18, under the status bar, where a tap never reaches the app. "Use my
  location" was at about y=64, just below it, which is why `testUseMyLocationDenied`, the one
  picker test that opens the picker from there, passed. At Large each page's last 36.67 points
  were below the screen for good; at AX3 the pages ran 148 points below it, and stopped sooner
  still (below). The tests were right, and assert what they did.
- **The fix:** `HomePager` reads its own size with a `GeometryReader` and makes each page
  exactly that size, the space under the top bar and the switcher, so the home screen fits the
  safe area. `HomeShell` says beside its frame that its content must take the height it is
  offered.
- **A guard for it.** `expectFits` (`HomeScreens.swift`) checks the place button, the gear and the
  page on screen each lie within the window (since its review, the pager's bottom edge in the
  page's place: "The iPhone app's UI tests, reviewed", below). It runs in HomeTests' three
  fixture tests and at each of HomeAuditTests' launches, at Large and at AX3. With main's
  geometry from the log, place and gear at y=-4.33 (Large) and -115.67 (AX3) and the page running
  to 910.67 or 1022, it fails on each of the three. With the top bar at the safe area's top and
  the page ending at 840 or 874, it passes (run on Linux against stubs of XCUITest, below). When
  a tap on the place button or the gear opens nothing, PickerTests' and SettingsTests' failures
  now give the same geometry.
- **What the log can't say, and what the next run will show.** Three things.
  - **AX3's scroll ranges ended early.** The credits stopped 1,000 to 1,600 points short of
    each page's end, in both runs, ending in a 3.33-point bounce. The stops don't follow the
    pages' heights: durham-tomorrow's Now page is 144 points taller than aberdeen-snow's and
    scrolled only 44 points further, and aberdeen-snow's week, its tallest page, had its shortest
    range.
  - **The issues the audit found besides the top bar's.** These are contrast on the nearby
    places at Large, on four answer and verdict texts, and on five unlabelled elements in each
    fixture at AX3. There is also `sufficientElementDescription` on an element with no
    identifier and no label, on every screenful of every page, never shown whole.
  - **The top bar's contrast issues**, "Use my location" at Large and "Using approximate
    location." at AX3, are likely the same fault: both texts sat at or above the status bar's
    edge.

  Nothing was changed for these on a guess, and no exception was added. Each issue now names its
  element's type and frame on screen, and an issue no screenful showed whole names the part of
  the page on screen; the sheets' audits do the same, with their kinds by name. A page that stops
  short or never reaches its end now also gives:
  - the page's whole frame and the window's;
  - each drag;
  - the page's four lowest elements;
  - where XCUITest's own `swipeUp()` then moved the credits, which tells a range that ends from a
    drag the page didn't take;

  and the app's element tree is attached as `<name>-tree`.

- **Up to 20 screenfuls a page, from 15.** Once the home screen fits, the page on screen at AX3 is
  about 420 points under the stacked top bar and switcher, not the 630 the overflowing pages
  showed. The week at AX3 is about 2,930 points tall. The bound only stops a page that never
  ends, and every screenful is still audited.
- **Not proven here:** `HomePager` is SwiftUI and compiles only on the macOS jobs, so whether the
  pages now fit, the picker and Settings open, and the pages reach their ends is for the next run.
  No Linux test can reach a SwiftUI layout. On Linux, the nine UI test files type-checked against
  stubs of XCUITest (with `XCTAttachment(string:)` and the element types they name). A copy of
  `expectFits`, `homeGeometry` and the audit's issue text ran there against fake trees with main's
  geometry (failing) and the fixed one (passing), and IsItCore's tests passed.

## The iPhone app's UI tests, reviewed

What the review of the fix for main's first macOS run found, and what changed for it. Nothing
was given an exception, and no test asks less.

- **The next run won't pass the home audits.** The pager's fix explains the top bar's issues and
  the pages' ends at Large, not three others, and nothing changed the app for those on a guess:
  - **The places nearby at Large** failed contrast on each page's last screenful, judged at
    once, so whole on screen, at about y=650 to 780, clear of the status bar and the home
    indicator; the pager's fix moves them about 70 points and changes no colour. They are
    underlined buttons in text under 18 points (17 points, regular), as "Use my location" is (13
    points, semibold), whose failures at Large may be this rather than the status bar's edge. The
    underlined outbound links (17 points, semibold) pass, as does the plain footnote "Using
    approximate location." at Large, and at AX3, where all of them are large text, no place
    fails. The ink gives 6.26:1 or more on every page, so what the
    audit measured there is for the screens to show.
  - **`sufficientElementDescription`** on an element with neither an identifier nor a label, once
    on each screenful of every page of all six tests, never whole on screen. HomePager's
    horizontal scroll view had neither and, taller than the screen, was never whole. Fitting the
    screen now, it would be judged at once and fail still, if it is the one; it is `pager` now,
    so the next log names it if so.
  - **AX3's scroll ranges.** At Large, each page's scroll range and the 778.33-point viewport add
    up to its content's height from the credits' frames (aberdeen-snow's Now: 177 + 778.33 =
    955). At AX3 they add up to 1,354 to 1,488 points on every page, where the content is 2,345 to
    3,027 points tall, and they don't follow the heights (aberdeen-snow's tallest page has the
    shortest range). So at accessibility sizes the scroll view's scrollable height or the
    elements' accessibility frames are wrong, whatever the page's frame, which is all the pager's
    fix touched. The three AX3 tests are expected to fail again, "scrolls no further", sooner now
    that about 415 points of page are on screen; `stopped` says what it finds.

  **Left for Carl:** the `ios-attachments` and `ios-results` artefacts of run 40061399787, the
  `home-*` screens (`home-*-2-ax3-*` for AX3) and the xcresult, which the network policy keeps
  from agents. They show what the audit measured and whether each stopped page shows the region
  of its end. The app is to be fixed from them, with an exception only where they prove an issue
  false, and only with Carl's agreement; without them, the next run is for the diagnostics, not a
  pass.

- **The page on screen is the part a user can see.** `onScreen` took the page's frame within the
  window, as if it were the scroll view's fixed viewport. On main's run, durham-tomorrow's
  Tomorrow page at Large had scrolled 312.33 points by its second screenful (its credits from
  1,114 to 801.67) when its verdict, about 264 points down the content and so near y=84 under
  the switcher, was judged at once; aberdeen-snow's week judged "Yes." at about y=68 the same
  way. With a viewport from y=132.33 both would have been held, then dropped, as the first
  screenful showed them whole. So the frame XCUITest gives the page's scroll view most likely
  moves with its content (or XCUITest gave those elements no frame, which `note` also judges at
  once; each issue's frame now says which). With a content frame, a scrolled page took in the top
  bar and the switcher: elements under the switcher were judged whole there (the answer and
  verdict failures), and each scroll brought the next element to y≈8, at AX3 under 363 points of
  top bar and switcher, never audited in view. `shown(_:in:)` now clips the page's frame to the
  window below the switcher (`pageWindow`), for the held issues, the scroll's length and the
  drag; should the frame be the viewport, it changes nothing. Each failure gives the page's frame
  on every screenful, which settles it.
- **`expectFits` reads the page's top, not its bottom.** A content frame runs below the screen
  from the page's top however well the page fits, so the guard would have failed HomeTests'
  three fixture tests, which pass on main, and every HomeAuditTests launch. It now checks that
  the place button, the gear and the switcher lie within the window; that the pager, whose
  frame doesn't move as it scrolls only across, runs from under the switcher to no lower than
  the window's bottom edge; and that the page starts under the switcher. A page's end is
  HomeAuditTests' to check. On Linux against fake trees: main's geometry fails at Large (the
  place button, the gear and the pager) and at AX3; the fixed layout passes, the pager to 840 or
  874 and the page's frame its viewport or its 955-point content.
- **What the guard can't see, it says.** It doesn't prove the place button and the gear are below
  the status bar, whose frame XCUITest doesn't give. On the iPhone 17 a home screen 50 to 70
  points too tall would put their centres, where a tap lands, under it, with them and the pager
  within the window (if the pager ends at the safe area's bottom edge; one 60 points too tall
  passes on Linux). PickerTests' and SettingsTests' taps are the real guard, and their failures
  give the geometry, the pager's now too.
- **The sheets' audits run for the first time on the next run**, allowing nothing, and each test
  stops at its first failure. Three likely failures are fixed in the app:
  - **A notice's project link** (`NoticeView`) was a line of footnote text, about 18 points
    tall, and now is 44, as the footer's links are.
  - **Credits and licences' links sat inside their sentences**, as tall as their line: the hit
    regions that phase 5.4 expected the audit to flag on the home screen, where an exception lets
    them through. Nothing on this page needs them inside the sentence, so each credit is now its
    words whole, then each of its sources and licences as a row of its own that opens it in
    Safari (`LeavingRow`, as Settings' rows that leave the app). SettingsTests reads the credits'
    words as before.
  - **Secondary text and the tint.** In the light appearance the system's secondary label (60% of
    0x3c3c43) blends to 3.28:1 on a grouped list's background and 3.43:1 on its rows, and its blue,
    the default tint, gives 3.59:1 and 4.01:1, under 4.5:1 for text under 18 points.
    `SheetStyle` (IsItUI) draws the picker's search, location and results' second lines, and the
    headers and footers of Settings, Credits and Your privacy, in 0x636366 (5.36:1 and 5.98:1),
    and tints both sheets with the system's blue as Increase Contrast draws it: 0x0040dd light
    (6.77:1 and 7.56:1), 0x409cff dark (4.92:1 or more, where the default gives 3.82:1 on a
    sheet's rows). The dark appearance keeps the system's secondary label, 5.29:1 or more. "Copy
    address", white on its fill, takes 0x0040dd in both (7.56:1): no blue reads at 4.5:1 both
    under white and on a dark row. The values are IsItLogic's `SheetColours`, which
    `SheetColoursTests` holds to 4.5:1 on Linux, with the system's they replace.
  - **Not changed:** the search field's placeholder, the system's, about 1.7:1, which
    `.searchable` doesn't let the app colour. Should the audit flag it, the next run will say.
    (It never did; the search box is the app's own since PR #33's second macOS run, its prompt in
    `SheetStyle.secondary`.)
- **Not proven here:** IsItUI and the UI tests compile only on the macOS jobs. On Linux, the nine
  UI test files type-checked against stubs of XCUITest; `expectFits`, `pageWindow`,
  `shown(_:in:)`, the issue text and the held-issue logic ran against fake trees and issues as
  above; the strict swift format lint passed; and IsItCore's 317 tests passed.

## The iPhone app's UI tests, after PR #33's macOS run

PR #33's own `ios` run (40073206108, job 120811218473, on 4b67a27) built, passed the 20 unit tests
and the Release check, and failed the UI plan: 39 tests, 27 passed, 12 failed (21 failure
records). The build's one warning, "'IsItLogic' is missing a dependency on 'IsItModel'", is Xcode's
dependency scan of the generated project: IsItCore's Package.swift declares it. The pager's fix
held: `expectFits` passed at every launch of HomeTests and HomeAuditTests, the pages begin at
y=203 (Large) and 425.33 (AX3) and end at the window's bottom edge, and the place button and the
gear take their taps. Six of main's 18 failures now pass (PickerTests' `testTooShortAndNoResults`,
`testChoosingACityResult`, `testChoosingAPointResult`, `testOpenSettingsOpensTheAppsPage`,
`testRecentPlaces` and `testUseMyLocation`), and so do FixtureLaunchTests, HomeTests, LaunchTests
and OfflineTests. The other twelve fail further on: the six HomeAuditTests, the picker's two
audits and the four SettingsTests, the sheets now opening and audited for the first time. The
fixes, with no exception (the toolbar's Close buttons were one until the review, in the next
section):

- **The audit moved the page, and the test assumed it didn't.** The page's frame was the same on
  every screenful, (0, 425.33, 402, 448.67) at AX3, so it is the scroll view's fixed viewport, and
  the clip to `pageWindow` changes nothing. Each drag moved the credits 339 to 346 points, but the
  next screenful began where the one before had, and XCUITest's own swipe up then moved them 661
  to 689 points further on all nine AX3 pages. What put the page back was the audit:
  `performAccessibilityAudit(for: .all)` lays the app out at a text size below Large for its
  Dynamic Type check, where each page is 65 to 100 points shorter, and the scroll view keeps that
  size's end, M, once the size is put back. Two measurements agree page by page, to within the
  drags' slack: M from the AX3 drags, and where the Large pages' second screenfuls' issue frames
  put them (250.33 and 250.34 for the Now pages of aberdeen-snow and leeds-dry, 294.33 for
  durham-tomorrow's Now, 331.67 and 331.66 for leeds-dry's Today). On the week pages, step()'s
  snapshot, taken after the audit, gave the same distance on two screenfuls the page had been
  dragged 177 to 229 points apart. So every AX3 page went back to M before each drag (leeds-dry's
  Now nine times), and the test called the page "no further"; very likely this is also what PR
  #31's note read as a page that stood still. The issues' frames were read after the move too, so
  the held logic compared them with screenfuls recorded before it: answers and verdicts under the
  switcher when attached were judged whole where the move had brought them, and the "Contrast
  failed (no element)" issues came only on screenfuls the audit had moved, never on a first. Now
  each screenful is audited in two calls (`AuditKinds`, ScreenAudit.swift): every kind but two
  first, on the screen as attached, and a move by it fails the test with the numbers; then
  `.dynamicType` and `.textClipped`, the two that change the text size. Each issue's element is
  noted where it was on the screenful, moved back by as much as the audit moved the credits (the
  top bar and the switcher don't scroll), and before the next scroll `restore` drags the page back
  to within 24 points short of where the screenful had it (a drag spends 13 to 20 points before
  the page moves, so it never overshoots, and the next scroll is worked out from where the page
  then is, so nothing goes unaudited). The two calls hold every kind iOS defines between them, so
  every kind still runs on every screenful. A page that stops now compares its credits after the
  drag with where the screenful had them, and its drags say which put the page back. AX3 pages are
  about nine screenfuls now, each with up to eight restoring drags: HomeAuditTests, 11 minutes on
  this run, should take about 30, within the job's 90 (the job took 41.5).
- **The page's background was an element.** An `other` element at (0, 0, 402, 874), with no
  identifier or label, failed `sufficientElementDescription` on every screenful of every page, 30 of
  the 107 home issues. Only `PageBackground` is drawn edge to edge, and it isn't the pager, which is
  `pager` now. Its gradients have no element, so `.accessibilityHidden(true)` had nothing to hide,
  and the `.accessibilityIgnoresInvertColors()` after it left the view a node of its own; under the
  sheets, where the home screen is hidden, it was gone. The hidden modifier now comes last, in
  `PageBackground` and in `GlyphView` (whose image the old order did hide), and `HomeShell` hides
  its whole background, cross-fade and all. (Wrong: on PR #33's second run the element was still
  there. The order didn't matter; the hidden modifier, on a view with no element, made one, and the
  background now has no accessibility modifier: "The iPhone app's UI tests, after PR #33's second
  macOS run".)
- **The results' keyboard.** `testResultsAccessibilityAudit` found the results but the keyboard
  stayed up after a drag on them: the list had the default keyboard dismissal, and a user who
  wanted to read past the keyboard couldn't put it away but by Search, which chooses the first
  result. The picker's list has `.scrollDismissesKeyboard(.immediately)` and
  `.scrollBounceBehavior(.always)`, so a drag on a list shorter than the screen is still a scroll.
  The test is as it was; its comment, which said a scroll dismisses the keyboard by default, is
  corrected.
- **The picker's location row.** "Use my location", a `Label`'s title and the picker's only one,
  was the one text the audit expected to clip at larger sizes. It is now the icon and a wrapping
  text side by side, as the other rows' text is.
- **The mail fallback opened as an inset card.** `.presentationDetents([.medium, .large])` opened
  it at the medium detent, which iOS 26 draws as a card 8 points in from each side over Settings,
  its content laid out full width and drawn at 0.9602 (386/402) of it: every frame started at
  x=27.20 and Close was 34.57 points tall of 36. Two texts clipped, two texts of Settings around
  and through the card with no element of their own, and Close short of contrast on the glass
  came from that. The modifier is gone, so the fallback opens full height, opaque, as a sheet does
  by default; section 10.7 asks only for a sheet.
- **The toolbar's Close buttons.** `picker-close`, `close-settings` and `close-fallback` failed
  Dynamic Type ("partially unsupported"): a toolbar draws a text item at the bar's own type size,
  whatever the text size. They were the only buttons any sheet's audit flagged for Dynamic Type;
  rows (but for Your privacy's full-policy row under the recorder, below), Open Settings, Copy
  address and cm and in, in the same text styles, passed that check. This round first allowed it
  as a limitation of UIKit's; the review found the app can avoid it, so each Close is now the xmark
  with "Close" as its label, and the sheets' audits allow nothing (next section).
- **The Debug recorder lay over the sheets' last rows.** Under `-openURLs`, its two lines were a
  bottom `safeAreaInset` on a translucent bar, which insets a list's content but not its frame.
  `testRowsOpenWhatTheySay` opened Privacy policy and Terms, but Support, Settings' last row, never
  opened: `isHittable` is an accessibility hit test, which passes through a view with no element, so
  the row was hittable under the bar, and the tap landed on the bar. Your privacy's full-policy row
  ended 1 point under the bar's top, and was the one row there "unsupported" for Dynamic Type (not
  the bar's doing: it failed again with the recorder below the content, as the `Form` jumped to its
  top for the text-size check, "The iPhone app's UI tests, after PR #33's second macOS run"); the
  two "Contrast failed (no element)" issues on Settings are most likely Help's rows under it. And
  the lines were `caption2`, which is 11 points from the smallest size to Large, the one text style
  that doesn't change below Large, so both failed Dynamic Type. The lines now sit below the sheet's
  content on an opaque background, in `subheadline` (12 to 15 points from the smallest size to
  Large). Debug code only: Release has no recorder. SettingsTests taps a row only once it has
  stopped moving and lies whole above the recorder's lines, and a line that never reads its URL says
  what it read.
- **Not fixed: what the next log will say.** Every home text passes WCAG at full ink with the
  glow, by the diagnosis's calculator: 5.42:1 at the least ("Use my location" on snow, under the
  glow), the places nearby 8.73:1 or more. So no palette changed and no exception was added for:
  - **The home's text buttons at Large.** "Use my location" and the places nearby (44 of the
    issues) failed contrast, while plain text and the footer's links beside them, in the same ink,
    size and weight, passed: "Using approximate location." on the same line, and the outbound
    links whose label modifiers are those of "Use my location". "Use my location" passed only on
    heavysnow, the darkest page there. The log can't say whether the audit measured a Button's
    label drawn lighter than the ink (a dimmed or pressed state) or caught it as the Dynamic Type
    check redrew the screen; the first call now runs before any size change, which tests the
    second.
  - **Five two-line details at y=510** on the first screenful of the middle and week pages at
    Large (plain body text, 9.49:1 to 13.53:1, no glow there, and the page not scrolled), while
    the one-line details at the same place passed.
  - **Settings' "About" header** ("partially unsupported" for Dynamic Type), while the Privacy and
    Help headers, the same view and style, passed; and "Copied." in the fallback, "Label not
    human-readable", which may have been the scaled card (its identifier is no longer its own
    word either, next section).

  For these, each contrast failure now says what the screenful's screenshot shows inside the element
  (`PixelRange`: its darkest and lightest pixels, and the WCAG contrast between them) beside the
  page's ink and its background at the element's centre, as `PageBackground` draws it
  (`PageColours`), from each band's palette, which `HomeScreens.json` now carries (packages/mobile
  `homePalettes`, tested in `homeScreens.test.ts`); the sheets' contrast failures give the pixels
  too. Pixels at the ink's full contrast mean the audit measured something the screen doesn't show;
  pixels short of it show what was drawn. Should the buttons be drawn lighter, the next step is a
  button style that draws their labels in the page's ink in every state, marking a press another
  way. Should Settings' "no element" contrast remain with the recorder moved, LeavingRow's arrow, in
  the system's `.secondary`, is the next candidate; should "About" or "Copied." remain, the run's
  xcresult (`ios-results`, for Carl) shows them. (PR #33's second run answered each: the buttons
  were drawn in full ink and nothing moved, Settings' "no element" issues were gone, and "About" and
  "Copied." remained: "The iPhone app's UI tests, after PR #33's second macOS run".)

- **Not proven here:** IsItUI, the app and the UI tests compile only on the macOS jobs. On Linux,
  the nine UI test files type-checked against stubs of XCUITest and of the UIKit and Core Graphics
  calls the pixel reading makes; copies ran against fakes: the two calls hold every kind between
  them, `RGB`'s WCAG figures match the generator's (13.62:1 for no snow's ink on its `g1`),
  `PixelRange` finds the extremes, `PageColours` matches the diagnosis's calculator (5.72:1 for
  "Use my location" on snow, 10.71:1 for a place nearby on no snow), AX3's "It'll snow." read at
  y=469 after a 343-point move is noted at 126, held and dropped as the first screenful showed it
  whole, the top bar's elements aren't moved, and the regenerated `HomeScreens.json` decodes with
  every page's band having its palette. The strict swift format lint passed, and IsItCore's tests
  passed.

## The iPhone app's UI tests after PR #33's macOS run, reviewed

What the review of that fix found, and what changed for it. No test asks less, and the one
exception the fix had added is gone.

- **The recorder's lines would have squeezed three audits.** The Debug recorder now sits below a
  sheet's content and shows the whole URL, so the height its lines take is the content's.
  `testRowsOpenWhatTheySay` audited How it works, Credits and licences and the licence after
  Report an ad's tap, with its email recorded: 201 characters with no space, about 5 lines (some
  130 points) at Large, about 11 at AX3 and taller than the 874-point window at AX5, where the
  audit's text-size checks lay a sheet out and where the sheet's navigation stack would be
  squeezed to nothing. None of the three has run on macOS: the test stopped at Support. It now taps
  Contact us and Report an ad after the pages' audits, every assertion as it was, so the pages are
  audited with Support's address recorded, three lines or so at AX5. The other audits had short
  lines already ("none" or "f" in `testUnitsChangeAsksInTheNewUnits` and `testYourPrivacy`), and
  the mail fallback, audited with an email recorded, covers Settings and its lines. The lines are
  not held to a few in a scroll view, as the review also offered: a long URL would then be cut at
  their foot, which is what the clipped-text check fails.
- **The toolbar's Close was the app's to change, so it isn't an exception.** The exception called
  Dynamic Type on a toolbar button a limitation the app couldn't change, and the run doesn't show
  that: Your privacy, on Settings' stack, has a bar button of its own, the back button in the same
  navigation bar, and its audit didn't flag it; the three Closes flagged were SwiftUI buttons with
  a text label. Drawn as an icon, as iOS 26 draws its own close control, Close has no text to stay
  at the bar's size. `CloseLabel` (IsItUI, SheetStyle.swift) is an icon-only `Label`: the xmark,
  with `CoreCopy.close` ("Close") as its title, which VoiceOver reads. The identifiers and the
  toolbar placements are as they were, and no test read the word on screen. `SheetAudit` is
  gone, and the sheets' audits allow nothing. Its matcher also needed a non-empty identifier,
  which a system control may lack, such as the active search bar's cancel button in
  `testResultsAccessibilityAudit`, whose audit has never run: should a system control the app
  can't change fail there, its exception is to match it by its place in the navigation bar or the
  search bar, with the run's evidence.
- **The first call's kinds are named.** `AuditKinds.inPlace` was `.all` less the two resizing
  kinds, so every bit set but two, macOS's `action` and `parentChild` and bits no kind has among
  them. Apple documents the kinds and `.all`, and shows explicit sets; such a mask had never run,
  and should XCTest check one against the kinds the platform has, every audited test would fail
  before its first issue, the six HomeAuditTests and every sheet's. It now names its five:
  `.contrast`, `.elementDetection`, `.hitRegion`, `.sufficientElementDescription` and `.trait`;
  with `resizing`'s two, the seven kinds the iOS SDK defines, which `names` lists too. Nothing is
  skipped; a kind a later SDK adds is to be added there.
- **"Copied." has an identifier of its own.** It failed "Label not human-readable", and the fix
  rested on the scaled card being the cause, which the log doesn't show. Its identifier was
  `copied`, the label's own word, the one text in the app like that; it is `copy-confirmation`
  now, and the test reads the same text by it. A guess, which costs nothing: the gear's
  identifier, `settings`, is its label's word too, and it passed on every home screenful. Should
  "Copied." fail again, the test stops there once more, and the Contact us fallback's audit after
  it, which has never run, waits another round. (It failed again, the word itself the cause: it is
  "Address copied." now, "The iPhone app's UI tests, after PR #33's second macOS run".)
- **A page that stops would have run to the screenfuls' bound.** "Scrolls no further" compared
  the credits after the step's drag with where `restore` left them, and `restore` stops up to 24
  points short of the screenful on purpose (13 to 20 with this run's drags). At a scroll end short
  of the credits' end, the drag still moved the page those points, so the check never fired, and
  each screenful after paid two audits and a full restore until the 20th: some 6 to 9 minutes an
  AX3 page, which, should main's first-run fault come back, would take the job past its 90
  minutes, and a cancelled job uploads neither its summary nor its xcresult. It now compares them
  with where the screenful had them: from at most 24 points short, a step of a quarter of the page
  on screen or more, less a drag's 20, leaves a page that scrolls at least 68 points past it at
  AX3, so only a page at the end of its scroll range fails there.
- **Checked on Linux:** the nine UI test files type-check against the stubs, and the copies'
  checks pass: the two calls are the seven kinds between them, once (`.all` less two fails that
  check), and the sheets' notes fail every issue, Close's Dynamic Type and a button with no
  identifier included. IsItUI and the UI tests compile only on macOS: the icons are for the next
  run's screens (`app-settings`, the picker's and the fallbacks') to show.

## The iPhone app's UI tests, after PR #33's second macOS run

PR #33's `ios` run on e3b4a58 (run 40086509556, job 120850750875) ran the 39 UI tests: 28
passed and 11 failed, every failure an issue of the accessibility audit, none a test's own check.
The six HomeAuditTests failed on 93 `sufficientElementDescription` issues, one on every screenful,
all on the same `other` element at (0, 0, 402, 874), and on 50 contrast issues (14 on "Use my
location", 30 on places nearby, 6 on `detail`); `testResultsAccessibilityAudit` on the search
field's clear button; and four SettingsTests on "Copied.", the Debug recorder's URL, the "About"
header and Your privacy's full-policy row. This run's xcresult (each screenful, the screen
recordings) and run 1's element trees were read for each cause. The fixes:

- **The page's background was an element, and the modifier meant to hide it made it.** A
  gradient has no accessibility element; SwiftUI makes one when an accessibility modifier is
  given a view with none, and `.accessibilityHidden(true)` is such a modifier. Run 1's trees show
  it three ways. Each Now row (`.accessibilityElement(children: .ignore)` with a label) has an
  unlabelled `other` child exactly the bar's frame, the bar a `GeometryReader` of capsules with
  `.accessibilityHidden(true)`; each week row one the size of its whole row of dots (184.33 by
  21.67 for six, one element, not six), hidden the same way; the strip, the same kind of row with
  the same shapes and no modifier, has none. And the window-sized leaf is a SwiftUI
  `AccessibilityNode` (its class in the snapshot), the first child of the home screen's container,
  beside the place button: only `PageBackground`, which ignores the safe area, has its frame. The
  earlier diagnosis (previous section, "The page's background was an element") was wrong: the
  order of `accessibilityHidden` and `accessibilityIgnoresInvertColors` didn't matter, and hiding
  it last and hiding `HomeShell`'s whole background, on this run, left it where it was. Whether
  the hidden modifier makes the node or `accessibilityIgnoresInvertColors` (a separate primitive)
  makes one the hidden modifier can't hide, the run can't say; both are gone. `PageBackground`,
  `HomeShell`'s background, the hour bars, the agreement dots and the loading skeleton's shapes
  now have no accessibility modifier; shapes and gradients have no element to hide. The glyph
  keeps `.accessibilityHidden(true)`, as do the chevron and the rows' arrows: an image is an
  element, which the modifier removes (run 1's trees have no glyph). Nothing, here or elsewhere,
  is to give a shape or a gradient an accessibility modifier, an identifier as a probe included.
- **Two checks say where any such element is, next run.** `expectNoBareElements` (HomeScreens.swift)
  reads one snapshot and fails on any `other` leaf with neither identifier nor label under no
  labelled element (a row's bar is under its row's label), naming its path from the window with
  each element's index; HomeTests runs it beside `expectFits` in each fixture's test, and
  HomeAuditTests at each launch. On run 1's nine trees it finds the background's node and
  nothing else. HomeAuditTests also attaches the app's tree on every page's first screenful
  (`<page>-tree`; a page that stops attaches `<page>-tree-stopped`), where only stopped pages did:
  on this run none stopped, so there was no tree.
- **Smart Invert inverts the page with its text.** The background and the glyph were exempt
  (`accessibilityIgnoresInvertColors`, spec section 16's "Glyphs and gradients"), the ink wasn't,
  so under Smart Invert the ink inverted over a background that didn't: about 1:1 for the ink on
  the pale pages and 3.7:1 for white on snow's purple, modelled as an inversion with the hue turned
  back, where both inverted keep 8:1 to 13:1. Safari inverts the website's page and text together
  (it has no `inverted-colors` rule). Neither is exempt now; the glyph, drawn in the ink, goes with
  the text. A departure from spec section 16, whose exemption is for photos and artwork.
- **The home's contrast failures are the check's, not the screen's.** In every flagged frame the
  screenful's pixels run from the ink to the background, at 6.15:1 to 14.61:1 (`PixelRange`), and
  the ink on the page's background gives 5.41:1 or more at each corner. The verdicts don't follow
  the contrast: "Use my location", the ink exactly on 8.1% of its frame's pixels on all nine pages,
  failed on seven (at 12.5:1 or more on no snow) and passed on heavy snow's two (6.9:1). They
  didn't move: each page failed the same places on both runs at different heights, and the
  recording shows nothing moving from a screenful's screenshot to the Dynamic Type check's sizes,
  so neither a pressed button nor the text-size check drew them (the question run 1 left). What
  fails is text whose frame is mostly the page's gradient: the text buttons' 44-point lines
  around 13 to 17-point words, and details of two or three lines whose last is short. What passes
  is text whose frame is mostly text: every one-line text ("Using approximate location.", the same
  size beside "Use my location", 18 of 18), the semibold links in the same 44-point lines (27
  of 27) and every button at AX3. Which places in a row fail, no estimator reproduced (a dozen
  tried, from the top colours to Otsu), and Apple publishes none. Two changes:
  - **The text buttons' element is their words' band** (`WordsButton`, IsItUI): a tap anywhere
    on the 44-point line still acts (`.contentShape(.interaction, …)`), while the element is the
    band of it the words take (`ContentShapeKinds.accessibility`, iOS 17), no shorter than 34
    points (`HitTarget.shortestElement`), so its frame is more ink than gradient. Not the words'
    own height, which the diagnosis proposed: the hit-region check failed the picker's clear
    button, 19.67 by 19 (below), "Use my location"'s words are about 16 to 18, and 34 is clear of
    them by "Copy address"'s 32.97, which passed on run 1. Only for words 44 points wide or more:
    every element the check passed had a side of 44 or more (York 34 by 44 and Perth 41 by 44 on
    this run, "Copy address" 123.9 by 32.97 on run 1) and the one it failed had neither, so words
    narrower than 44 (York and Perth at Large) keep the whole 44-point line, which passed hit
    regions on both runs, and their contrast is left to the `DrawnText` exception below.
    `testNearbyLoadsInPlaceOnThisWeek` checks the place's element (Dundee's, about 61 points wide
    at Large) is under 44 points and taps its line above the words, outside the element, as
    `testUseMyLocationDenied` taps "Use my location": the whole line is still the button. The
    places nearby have identifiers (`nearby-<slug>`).
  - **An exception that proves each issue false** (`HomeAuditTests.exceptions`, `DrawnText`):
    contrast on a `detail`, "Use my location" or a place nearby is allowed only when the
    screenful shows, inside its frame, the ink on 2% or more of the pixels (within 3 levels a
    channel), the frame's top row the page's background (within 6 levels of `PageColours`), and
    the ink on the background 4.5:1 or more at all four corners. Text dimmed, in another colour,
    over a plate, or on a page short of contrast fails it. Run on Linux against this run's
    screenfuls, all 50 issues prove (the ink on 7.0% of the pixels at the least, the top rows
    within 2 levels, 5.41:1), and none does dimmed, on another page's colours or synthetic with
    a 2.6:1 ink. The paragraphs have no app-side change short of redesigning them, and the band
    may not be enough for the buttons, so the exception covers both; the issues it allows, and
    any exception no issue needed, are attached (`home-<fixture>-<size>-allowed`) and listed in
    the failure, where they went to `print`, which reaches neither the log nor the result bundle.
    So the next run says whether the band alone cleared the buttons, and whether the credits'
    hit-region exception ever fires.
  - Not done: a screenshot after the first audit call, which the diagnosis offered for the size
    changes the first screenful's first call showed; it would add a PNG a page to the contact
    sheet, and the verdicts there matched the second screenful's.
- **The picker's search box is the app's own.** The flagged button was UIKit's
  `_UITextFieldClearButton`, 19.67 by 19 points, in the field `.searchable` draws; on iOS 26 the
  active search keeps it while the field has text, with the keyboard put away, and SwiftUI has no
  way to resize or remove it (with nothing typed, `testPickerAccessibilityAudit` passed). Not an
  exception: the app can avoid it. `SearchBox` (PlacePickerView.swift) is a `TextField` under the
  navigation bar, above the list, with the Search key choosing the first result, and while it
  holds text a clear button 44 points square, "Clear search" (`AppCopy.clearSearch`, its xmark
  the icon). The field is UIKit's rounded one, at its own height, about 34 points: a plain field
  is only as tall as its line, about 22, near what the hit-region check fails. Its prompt is
  `SheetStyle.secondary` (the system placeholder, about 1.7:1, was never flagged). PickerTests
  find the box by its identifier (`place-search`), whatever type XCUITest gives it, check there is
  no clear button with nothing typed, and in `testRecentPlaces` that the button is 44 by 44,
  labelled, clears the box back to the recent places and leaves the keyboard up. The earlier
  notes on `.searchable` (phase 6.1, "Unchecked", and "Not changed: the search field's
  placeholder") are superseded.
- **"Copied." is "Address copied."** It failed "Label not human-readable" on both runs, with its
  identifier `copied` in the scaled card and `copy-confirmation` at full height, so neither was the
  cause. Every label the check has failed is one token with no space and a full stop, a slash or
  a colon ("Copied.", "https://willitsnow.today/support"); every label of more than one word, full
  stops and all, passed ("Rain, not snow.", "No places found."), and so did single words without
  ("Settings", "none"). The new words say what was copied, on screen and in VoiceOver's
  announcement: a departure from spec section 10.9's "Copied.", made in `appCopy.ts`.
- **The Debug recorder's lines say what they hold.** The URL as `debug-opened`'s label failed the
  same check on How it works, where "none" and "f" had passed. Each line is labelled ("Last link
  opened", "Units last asked for", `AppCopy`, shown only in Debug builds) with the URL or the units
  as its value, which the screen still shows; SettingsTests and PickerTests read the value, and
  check the labels. (On run 3 the units' line, showing only its value under the longer label, was
  "Text clipped": each line shows its label too now, next section.)
- **Settings' "About" header** was "partially unsupported" for Dynamic Type on both runs, at the
  same frame, while Privacy and Help, the same `Text` in the same style from the same `ForEach`,
  passed. The recording shows it growing at every size it is on screen, xSmall to AX2, 0.80 to 0.84
  of Privacy's width at each; from AX3 the form's visible part ends above it. So it scales, and the
  audit's rule is its own (Help, never on screen at an accessibility size, passed, and so did rows
  that left as late). Three changes. A section gets a header only when it has a heading: About was
  the one header after the heading-less Report an ad's empty one, the one thing setting it apart.
  The sheets' audits attach the screen as audited and the element tree (`audit-<screen>`,
  `audit-<screen>-tree`): each failing sheet's test stopped at its audit, so none showed what it
  read. And `SettingsTests.headersGrow`, an exception for this audit only: "partially unsupported"
  on a static text labelled "About", standing only while "Privacy", the control, is on screen as
  the audit begins and the audit raises no Dynamic Type issue on it (`ScreenException`,
  ScreenAudit.swift); not Help, which never failed. Should About stop growing, Privacy, on screen
  at every size, fails too, and the exception no longer applies; the allowed issue and an
  exception not needed are attached (`audit-<screen>-allowed`) and listed in the failure. (Run 3
  failed About again, with no empty header before it, and Report an ad: what set them apart was
  the `Form`, which Settings no longer is, and the exception is gone, next section.)
- **Your privacy is a page that scrolls.** `testYourPrivacy` scrolls to the page's end before its
  audit, so the full policy's row was at y=738. The recording shows the `Form` jump back to its top
  as the Dynamic Type check began and stay there through all twelve sizes, so the row was on
  screen at no other size, and the audit called it "unsupported" and clipped. The same row in
  Settings passed, and run 1's attribution of it to the recorder's bar (previous section) was
  wrong: the recorder now sits below the content and the row failed again. `YourPrivacyView` is
  now a scroll view of paragraphs, as How it works is, the policy's row 44 points tall: a scroll
  view keeps its offset, held to its end, and no text a scroll view had brought into view was
  failed so (the home pages' second screenfuls, scrolled to their ends). (The row passed on run 3,
  but not for that reason: the page went back to its top as the check began, as the `Form` had,
  and the row was on screen only at the two smallest sizes. What failed it was the `Form`'s cells,
  next section.)
- **What the next run settles:** whether any bare element is left (`expectNoBareElements`, with
  its path) and the trees; whether the band alone cleared the buttons' contrast, its frame in the
  tree and the hit-region check passing it at 34 points; the search box's type, height and hit
  region; whether "About" fails again, with its frame and Privacy's in `audit-settings-tree`;
  and the allowed lists, the credits' exception among them.
- **Checked on Linux:** the copy's tests (written first) and `pnpm mobile:generate`; IsItCore's
  tests (the picker's clear label, the fallback's words); the nine UI test files type-check
  against the stubs of XCUITest, whose snapshots now carry `elementType`, as the SDK's do; and
  copies of the new logic ran there: `DrawnText` against this run's 50 screenful crops and
  synthetic frames as above, the contrast exception's match (a verdict, an unproven place and
  an element with no reading refused), `bareElements` against run 1's tree (the background's
  node found, a row's bar not), the header exception (allowed with its control, refused when
  Privacy failed or wasn't read, for another kind, message, text, Help's among them, or type),
  and the edge tap's offset (19.5 points above a 34-point band's centre). IsItUI, the app and the
  UI tests compile only on macOS: `WordsButton`'s shape, `SearchBox` and the scrolling privacy
  page are for the next run's trees and screens to show.

## The iPhone app's UI tests, after PR #33's third macOS run

PR #33's `ios` run on 1cc28b7 (run 40100641627, job 120892226190) ran the 39 UI tests: 35 passed,
five of the six HomeAuditTests and every behaviour test among them, and 4 failed.
`testAberdeenSnowAtAX3`: the first audit call on the Now page's sixth screenful threw "Audit failed
to complete in time" (code -56). Three SettingsTests: "Text clipped" on the Debug recorder's units
line (`debug-units`) on How it works, Settings and Your privacy, and on Settings, "Report an ad"
"partially unsupported" for Dynamic Type (and "About", which `headersGrow` allowed). This run's
screen recordings, screenshots and element trees, and run 2's, were read for each cause. The fixes:

- **An audit call ran out of XCTest's time, with the app still.** A screen recording writes a frame
  only when the screen changes; each frame's time (ffprobe), set beside the attachments' times,
  times the first call on every screenful, up to the Dynamic Type check's burst of 13 frames (a
  frame a size, xSmall to AX5, then AX3 again). The failing call began about 0.2 seconds after its
  screenful's screenshot (14:12:53.667), and the next thing the test did, tap Today, began at
  14:13:11.98: the call ran some 17 seconds. On run 2 the same call took 12.4, the longest of about
  130 calls timed; this run took about 0.55 of run 2's time a screenful (the window-sized background
  element gone), so about 7 was to be expected. The test's other first calls took 3.3 to 7.9 seconds
  on Now, 3.5 to 9.5 on Today and 3.0 to 10.8 on This week; two of them, Today's first screenful
  (9.5) and This week's ninth (10.8), ran about 2.5 times as long as expected and finished. The app
  was still: no frame from the last drag's end (14:12:51.6) to the tap (14:13:12.25) but one at
  14:13:00.08, within 4 levels of the frame before it, the status bar at the minute, as at about :00
  of every minute in both runs; the app's minute tick falls at about :17.7 each minute under the
  fixed clock (`MinuteTick.anchor`) and drew no frame there; `WordsButton`'s geometry callback fires
  only when its words change size, which nothing did, every Dynamic Type burst is exactly 13 frames,
  and the same eight places nearby were audited in 6.2 and 4.6 seconds on Today and This week; the
  test found no issue, so no handler ran; and the tree is about 60 elements. That screenful is the
  suite's costliest to audit, with the most controls at once (the eight places nearby, the credits'
  four links, the top bar, the switcher's three buttons), and on every page the lower screenfuls
  cost more. So the slowdown was the simulator's audit service's or the host's, and the call that
  met it on the costliest screenful went over the limit. Which of the two, the artefacts can't say.
  Apple documents neither -56 nor the deadline; other projects report it on busy hosts, count an
  issue handler's time against it, and retry on -56 alone (justinahn711/weight-training-app #193 and
  #196, straff2002/OpenGlasses #484). The test then left the page (`return`), so Now's seventh and
  eighth screenfuls went unaudited: the test failed, so nothing was hidden, but that coverage was
  lost.
- **A call that times out runs once more, on the same screen** (`runAudit`, ScreenAudit.swift, for
  HomeAuditTests and every sheet's audit). Its handler only keeps each issue; the tests read the
  issue's element, the credits' frame and the screenshot's pixels once the call is done, outside its
  deadline (they were already read only after the checks finished). On -56, and nothing else, the
  attempt's issues are dropped, so none is counted twice; 2 seconds later, should the screen be the
  one the call was to audit, the same call with the same kinds runs again. On the home pages that is
  the app in the foreground, the switcher the one for the test's text size (a Dynamic Type check cut
  short could leave another) and the credits within a point of where the screenful had them, the
  resizing call's page put back first (`restore`, which may stop up to 24 points short, and then the
  call doesn't run again); on the sheets, every element but the containers of the same type and
  identifier within a point of where it was as audited (`ScreenLayout`). A second timeout, a screen
  that isn't the one, or any other error fails the test, with each attempt's error and time. Not an
  exception and not a skip: every kind runs on every screenful attached, or the test fails. Not more
  than once, nor without the check, either of which could audit a screen other than the one
  attached.
- **The calls' times are kept.** Each call's place, kinds, seconds, issues and any timeout are
  attached at the test's end (`home-<fixture>-<size>-audit-times`, `audit-<screen>-times`, a line a
  call), and the slowest call and any that timed out are named in `home-<fixture>-<size>-allowed`.
  `print` reaches neither the log nor the result bundle, so `ci/test.sh` reads them from the
  exported attachments (`xcresult-summary.mjs timings`, tested on Linux) and puts the ten slowest
  calls and every one that timed out in the step summary and the log (`### Audit times:`), with the
  time each timeout took, roughly the deadline.
- **The five kinds that read the screen as it is are two calls** (`AuditKinds`: contrast, then
  element detection, hit regions, descriptions and traits; then the resizing call, three calls a
  screenful). The rule was to split them once a first call came to more than about 60% of the
  deadline, and this run is past it: This week's ninth first call finished in 10.8 seconds against
  a deadline of about 17 (the timed-out call's), some 63%, and run 2's 12.4 on the same Now
  screenful was about 72%. Nor would the retry alone have saved this run: Today's first screenful,
  audited about 4.6 seconds after the timeout, took 9.5 seconds, about 2.5 times its expected
  time, so the host was still slow, and the same five kinds run again 2 seconds after the -56, at
  that rate, would have taken about 17.5 and timed out again. So the split is made now, not after
  another run. Every kind still runs on every screenful, each call with a deadline and a retry of
  its own (`runAudit`); contrast stays first, so the screenshot taken before the calls is the
  screen its issues' pixels come from, and a call but the resizing one that moves the page still
  fails. It costs a call more a screenful, about a hundred a run. The times attachment is to
  confirm it.
- **The Debug recorder's lines show their labels.** "Text clipped" was on `debug-units`, labelled
  "Units last asked for", 34 by 18 points showing "none" (How it works, Your privacy) and 5.33 by 18
  showing "f" (Settings). From run 2 to run 3 only its label changed, to the longer words, the
  screen still showing the value alone; on run 2, its label the text it showed, it passed. The label
  alone doesn't explain it: `debug-opened` showed the same "none", 34 points wide, under "Last link
  opened" on Settings and Your privacy, and passed. The one difference between the two lines was
  `.fixedSize(horizontal: false, vertical: true)`, the opened line's and not the units'. Each line
  now shows its label, then what it holds ("Units last asked for: f", `AppCopy.recorderLine`,
  packages/mobile first), held to its full height; its accessibility label is the label alone and
  its value what it holds, as the tests read them, byte for byte. Either change might do alone; the
  two runs implicate both, so both. The lines are taller for it: Report an ad's email takes about 6
  lines at Large, and with Support's address recorded the two take about half the window at AX5,
  where How it works is audited.
- **Settings is a page that scrolls.** The recording of Settings' text-size check (12 sizes) shows
  the `Form` at its top at every size, and every row growing at every size it is on screen. Report
  an ad is on screen from xSmall to AX2, half cut at AX3 and gone at AX4 and AX5; About is gone from
  AX3. How it works leaves at AX3 too, as About does; Credits and licences and Terms leave from AX1,
  Help's header from xxL; all passed, and Privacy policy, on screen through AX4, passed. So whether
  a row stays on screen doesn't divide what passed from what failed, and nothing in the rows does:
  Report an ad passed on run 2 (with an empty header above it), and About failed on all three runs,
  the empty header before it gone on this one. What the texts that failed share is the `Form`, a
  collection view whose cells exist only while on screen and are reused for other rows, so which of
  its texts the audit can follow from size to size is the `Form`'s doing. A scroll view lays out
  every view at every size, and its text has passed on screen or off on every run: How it works (its
  paragraphs off screen from Large), the home pages, and now Your privacy, whose policy row failed
  "unsupported" and clipped as a `Form`'s row on runs 1 and 2 and passed as a scroll view's on this
  one, though the page went back to its top as the check began, as the `Form` had, so the row was on
  screen only at the two smallest sizes (the previous section's reason, that a scroll view keeps its
  offset, was wrong). The evidence's reading, not a proof: Apple doesn't publish the audit's rules.
  Settings is now `SheetPage(.grouped)` (IsItUI, SheetStyle.swift): a scroll view of
  `SheetSection`s, each its header (`.headline` in `SheetStyle.secondary`, a heading to VoiceOver),
  its rows on a card with a hairline between each two (`SheetDivider`), and its footer
  (`.footnote`); each row at least 52 points tall (`sheetRow()`), and each that does something a
  button the whole row wide (`SheetRowStyle`, pressed in `systemGray4`), a page on the stack in the
  primary colour with a chevron (`PageRowLabel`), a page or email outside the app in the tint with
  its arrow (`LeavingRow`); the units row (its label beside the two units' buttons) and the version
  line are not buttons, nor are Credits and licences' models line and each credit's words. The
  measures (`SheetMetrics`) are read off this run's Settings screenshot: the grouped background
  #F2F2F7 with white cards 16 points in, corners of about 26 (25.8 and 25.9 by a
  circle's fit), rows 52 tall with their 20.33-point text 16 points in, the units row 78 with its
  48-point control, hairlines at (32, y, 338, 1), and the header in `.headline` ("Privacy" 56.7
  points wide against 53.3 in a row), the footer in `.footnote`. Credits and licences, a `Form` too
  and never yet audited (`testRowsOpenWhatTheySay` stopped before it on all three runs), is the same
  now, its sources' links buttons that call `openURL`, as Settings' rows do; How it works, Your
  privacy and a notice are `SheetPage`'s plain style, drawn as before. The picker's `List` stays: it
  passed on this run. A departure from section 10.4's native form, its look kept but for the
  sections 24 points apart (17 to 35 in the `Form`), the first card 16 points under the bar (35) and
  the pressed row the app's own. Not a `List` with `.insetGrouped`, the same collection view, nor a
  `LazyVStack`, lazy too. Should About or Report an ad fail again as a scroll view's text, laziness
  wasn't the cause: `audit-settings` and `audit-settings-tree` show what the audit read, and the
  header's frame there is the next thing to read.
- **The sheets' audits allow nothing again.** `SettingsTests.headersGrow` is gone, and with it
  `ScreenException`, `allowing:` and `audit-<screen>-allowed`, which nothing else used.
  `testUnitsChangeAsksInTheNewUnits` also checks Your privacy's row is 44 points tall or more.
- **What the next run settles:** the times, whether a -56 comes at about the same time each time
  (the deadline), how often calls slow down so, and whether a call run again passes; whether
  Settings' About and Report an ad pass as a scroll view's, Credits and licences' first audit, the
  typeface's licence's first audit (its project link labelled in words, "Bricolage Grotesque's
  project page", the URL its value, as the recorder's opened line has them, which passed on this
  run, where the URL as a label was "not human-readable" on run 2), and the recorder's lines under
  "Text clipped"; and the grouped pages' look on the contact sheet (`app-settings`,
  `app-credits`).
- **Checked on Linux:** the copy's tests (written first) and `pnpm mobile:generate`; IsItCore's
  tests, the notices' link labels among them (written first); the nine UI test files type-check
  against the stubs of XCUITest, whose
  `XCUIApplication.state` and `performAccessibilityAudit` are `open` now, as an Objective-C class's
  members are in the SDK, so a fake can stand in; and copies of the new logic ran there: `runAudit`
  against a fake app (a timeout run again once, after the pause, only once settled, its first issues
  dropped; a second timeout, or a screen not settled, failing with both errors and times; another
  error failing at once, with no pause and no check), `ScreenLayout` (a row moved 2 points found,
  half a point, a scroll bar coming and going and a label changing not), the times' lines and
  report, and `AuditKinds`' three calls (the seven kinds between them, each once, in order, a
  sheet's audit making each once); `xcresult-summary.mjs timings` against an export's manifest
  (vitest). IsItUI and the app
  compile only on macOS: `SheetPage`, the Settings and Credits pages and the recorder's lines are
  for the next run's screens and trees to show.

## The iPhone app in the website's look (apps/ios, packages/mobile, scripts)

Carl asked for the iPhone app to look as close to the website as possible, with the cm/in toggle
kept in Settings and no name at the top; for a more modern Settings ("very retro iOS and boring
at the moment"); and for saved places beside the picker's recent ones. The design was measured
against the website's own CSS and is built in seven steps, each pushed so the macOS job compiles
it. This section grows with each step.

**Step 1: the brand fonts.** The website sets every word in Bricolage Grotesque; the app had only
the answer word's subset (`BricolageAnswer.ttf`). The step adds the text faces and names every
font for the Swift. No screen uses them yet: the home screen moves to them in step 3.

- **Static instances, not the variable font.** What ships is what is drawn, whether or not Core
  Text applies the optical size of a custom variable font, and however SwiftUI would map a
  weight onto one. The website sets text between 12.5 and 24 px, where "Will it snow today?" at
  wght 400 is 8.733 em wide at opsz 14, 8.710 at 16 and 8.689 at 18: one optical size, 16, draws
  every size within 1% of the website's continuous one.
- **Three faces, not the design's six.** `BricolageText-Regular` (400), `-Medium` (500) and
  `-SemiBold` (600), all at opsz 16, beside `BricolageAnswer` (780, opsz 96). A Book (450) face
  for the question and Display (opsz 22) cuts for the verdict and the grid's values change widths
  by under 1% and the weight by a step nobody sees at those sizes: the question takes Regular and
  the verdict and values SemiBold. If the contact sheet beside the website shows a difference,
  they come back.
- **Latin and latin-ext merged.** The website loads the two subsets as it needs them; each app
  face is both, merged with fontTools' merger (374 code points, 476 glyphs, about 71 KB a face),
  so Łódź, Reykjavík and Météo-France never fall back to SF Pro mid-word. Scripts beyond latin-ext
  fall back to the system font, as on the website. The faces keep every feature the subsets have:
  `kern`, `mark`, `mkmk`, `ccmp`, `locl`, `tnum`, `pnum`, `frac`, `numr` and `dnom` (tabular
  figures for the grids and week amounts through `.monospacedDigit()`).
- **The name table is rewritten.** Every instance comes out of the instancer named "Bricolage
  Grotesque 96pt ExtraBold", so the three would collide when registered. Each face is named
  family "Bricolage Text" with its style, and its PostScript name (`Font.custom`'s and
  `UIFont(name:)`'s, and the file's name) is its own. The copyright and the licence's URL stay,
  and the licence's description is added, as for the answer font; the axes' names go, since
  nothing in a static font points to them. `OS/2`'s regular bit is set only on the 400 face and
  `head.macStyle` is 0. The font has no reserved name, so the OFL allows the renamed, modified
  versions (below, "Credits and licences").
- **Byte for byte the same each build.** The merger stamps `head.modified` with the time of the
  build (two prototype builds differed only there), so the script sets `created` and `modified`
  to the source's, as the answer font keeps its. The script was run twice and the outputs
  compared with `cmp`: identical, and identical to the committed files.
- **Checked without Python.** As with the answer font, each face's version string (name ID 5)
  ends with its recipe, a SHA-256 of `scripts/make-text-fonts.py` and the two subset files, and
  `pnpm mobile:check` checks each file's recipe and every table's checksum in Node
  (`exportFont.ts`, `TEXT_FONTS`, which names the faces as the script's `FACES` does; a vitest
  holds the two together). `pnpm mobile:generate` runs the script only when a face is missing or
  stale. It builds all three at once, into a folder of its own, and writes only those that
  differ. The fonts folder is the generator's, so a face no longer listed is stale.
- **`BrandFont`, generated.** `IsItModel/Generated/BrandFonts.swift` names every face by its
  PostScript name, with its `file`, so no face's name is typed in the app's Swift (the literal
  guard) and the widget, which links IsItModel, can name the same faces when it moves to them.
- **Registered by the app and the widget.** Both Info.plists list all four files in
  `UIAppFonts`, since an extension can't load the app's fonts; `project.yml` needed no change,
  as the Fonts folder was already a resource of both. `check-archive.sh` still checks only the
  answer font in a Release bundle (on the Later list).
- **Tested where it can be.** On Linux: `exportFont.test.ts` (each face current, stale and
  missing; its names, weight and regular bit; a glyph for every letter of "Météo-France Łódź
  Reykjavík Kraków Malmö 0.9cm 100% ° ’ … · –" in its cmap), `appFonts.test.ts` (both plists'
  `UIAppFonts` are `BrandFont`'s files, in order), `generate.test.ts` (the Swift) and IsItModel's
  `GeneratedFontTests`. On macOS, `AnswerFontTests` became `BrandFontTests`: every face is
  registered under its PostScript name in its own family, each text face has a glyph for every
  character of "Météo-France Łódź 0.9cm 100% ° ’ … ·" (`CTFontGetGlyphsForCharacters`), and the
  built Info.plist lists every file. A plist or resource slip fails these before any UI test.

**Step 2: the brand colours and the shared parts.** One colour story and one set of parts for
every screen, with no screen changed yet: the home screen moves to them in step 3, the picker in
step 5 and Settings in step 6.

- **Three surfaces.** Every screen is one of three, each from a core palette (g1, g2, g3, glow,
  ink, pill). The **page** (the home screen and its three pages) wears the band of the page on
  screen, over `PageBackground`. The **sheet** (the place picker) wears the band of the page it
  opened over, over `SheetBackground`: pill to pill with 15% of g2 at 168°, no glow, the
  website's `.sheet`. **Content** (Settings and every page it opens) wears `Palettes.content`,
  core's `SNOW_PALETTES.snow`, which is the website's own content pages' palette
  (`LOOKS.snow.content`: About, Privacy, Support and Terms), over `PageBackground`. In one
  sentence: the forecast and the search over it wear the band on screen, the app's own pages the
  website's content palette, and nothing follows Dark Mode, as the website makes the same split.
  This supersedes spec 10.1's "sheets follow Dark Mode". The system's own parts on each surface
  take its dark or light scheme (`PageTheme.controls`).
- **The tokens are data, TypeScript first.** `packages/mobile/src/brandColours.ts` holds each
  token's share (`BRAND_SHARES`), generated into IsItModel's `BrandColours.swift`
  (`BrandShares`, and the content card's colour), which IsItUI and the Linux tests read: `chip`
  (pill at 85% over the background, opaque under Reduce Transparency), `selected` (an ink fill
  with words in pill), `soft` (ink at 85%, on flat fills only, never on a page's gradient),
  `wash` (ink at 12%), `field` and `fieldBorder` (ink at 8% and 55%), `border` (28%), `hairline`
  (22%), `affordance` (70%) and `card` (pill moved 25% away from the ink, opaque: `#401a4f` on
  content). Under Increase Contrast soft text, affordances and the search box's edge are full
  ink, hairlines and borders 40%, and `PageBackground` draws no glow; ink on the content page is
  then 7.32:1 or more. In IsItUI, `PageTheme` gains `pill` and `card`, `init(_ palette:)` (moved
  from the app, with IsItUI's own `Color(rgb:)`, since IsItUI doesn't link SnowKit) and
  `PageTheme.content`; `Surface` and the `surface` and `pageTheme` environment values say where a
  view is drawn, and `BrandTokens` (read through `@SurfaceTokens`) gives each token as the
  environment's contrast and transparency settings change it.
- **Every pair, every band, at its worst point.** The model is the app's own background model,
  the same as `PageBackground`, `HomeAuditTests`' `PageColours` and the website: mixes in sRGB
  rounded to 8 bits, the worst point anywhere on a 402 by 874 screen sampled every 6 points,
  ratios rounded down. `brandColours.test.ts` pins each pair to the design's figure (rounded down
  to one decimal), so a palette or share change can't pass quietly, and holds every text pair to
  4.5:1 and the search box's edge to 3:1; `brandColours.ts` is under the suite's 100% coverage.

  | Band      | page: ink / page | ink / chip | pill on ink | sheet: ink | soft  | ink / wash | soft / pressed | placeholder | field edge |
  | --------- | ---------------- | ---------- | ----------- | ---------- | ----- | ---------- | -------------- | ----------- | ---------- |
  | nosnow    | 10.09            | 13.01      | 13.62       | 13.01      | 8.51  | 10.33      | 7.18           | 7.60        | 3.45       |
  | flakes    | 8.28             | 12.31      | 13.17       | 12.31      | 8.32  | 9.82       | 6.96           | 7.36        | 3.43       |
  | maybesnow | 4.87 (glow)      | 8.18       | 8.97        | 8.97       | 7.02  | 6.46       | 5.19           | 5.71        | 3.98       |
  | snow      | 4.88 (glow)      | 10.17      | 11.54       | 11.54      | 8.79  | 8.22       | 6.47           | 7.19        | 4.61       |
  | heavysnow | 6.18             | 13.82      | 15.47       | 15.47      | 11.39 | 10.98      | 8.45           | 9.45        | 5.50       |
  | deepsnow  | 6.17             | 17.05      | 19.07       | 19.07      | 13.82 | 13.96      | 10.51          | 11.73       | 6.23       |

  On content: ink on the page 4.88 at the glow's centre (7.32 without the glow), on a card 14.20,
  soft on a card 10.62, ink on a pressed row or the units track 10.00, soft on a pressed row
  7.76, pill on ink 11.54, and a hairline against its card 1.96 (decorative). The page's worst
  points, 4.87 and 4.88, are under the glow at the top bar's right end, where the words sit on
  chips at 8.18 or more; every pair on a flat fill is 5.19:1 or more.

- **Two website values are left out**, and the tests pin them below 4.5:1: ink at 10% as a
  button's fill on the page (the website's `.button`, 4.01:1 on maybesnow), and ink at 85% or
  90% as text on the gradient (4.03:1 on content; 4.31:1 for the website's detail under the snow
  glow).
- **The shared parts, one copy each.** `BrandType.swift`: `TextRole`, the type scale (each role
  a face, the website's size at 402 wide, the text style it grows with, its tracking and line
  spacing), and `.brandFont(_:)`, which scales the tracking and line spacing with the text and
  steps the face up under Bold Text, which a custom font doesn't follow on its own.
  `Backgrounds.swift`: `PageBackground`, moved from `PageTheme.swift`, and `SheetBackground`,
  neither with an accessibility modifier. `Buttons.swift`: `PillButton` (a chip hugging its
  words or a wide pill, secondary in the surface's fill or primary in ink, its element the pill
  and its tap region the 44-point line, as `WordsButton`), `IconPillButton` (the gear: a chip
  circle in a 44 by 44 element), `PressStyle` (scale 0.96, never dimmed, none under Reduce
  Motion), `RowPressStyle` (the wash) and `PinShape` (the website's pin). `PillSegments.swift`:
  the website's segmented pill, its ink thumb sliding by `matchedGeometryEffect` on the website's
  300 ms curve, each segment a button with `.isSelected`. `Layouts.swift`: `FlowLayout`, moved
  from `PageFooterView.swift` unchanged, and `EqualColumns`, the website's grid, never lazy.
- **Checked where it can be.** Linux: `brandColours.test.ts`, the Swift's generation and
  `GeneratedPaletteTests`' content palette and card. IsItUI compiles only on macOS: the existing
  39 UI tests are to stay green and look unchanged, since nothing on screen uses the new parts.

**Step 3: the home screen in the website's look.** The top bar, the switcher and the three
pages, drawn as the website draws them for the same answer (Header.astro, ViewTabs.astro,
Views.astro, Now.astro, Week.astro, `view.ts`), measured at 402 points wide, where a CSS pixel is
a point. The design's mock, drawn by the website itself with the app's changes, is the target.
This supersedes spec 10.1 and 10.2 on type, colours, the switcher, Now and the week.

- **Rules every screen follows**, the audit's lessons so far, binding on steps 5 and 6 as well:
  no lazy container (a page is a `ScrollView` and a `VStack`); each element laid out once, with
  accessibility sizes a branch on `isAccessibilitySize`, never `ViewThatFits`; no accessibility
  modifier on a view with no element (shapes, gradients, tracks, thumbs, cards); every visible
  word inside some element's frame, so a grid cell is one element over both its lines; an
  element on a page's gradient hugs its words, any `.frame(maxWidth: .infinity)` outside it, and
  text that can run to two lines at Large sits on a flat fill (the detail and Nearby, proven by
  the `DrawnText` exception, are the only exceptions); tap regions 44 points each way and
  elements at least 34 on their short side; pressed states wash or scale, never dim; and every
  word from the generated copy.
- **Type.** Every word is in a `TextRole` through `.brandFont`: the question in Regular, the
  verdict, the grid's values, the headings, the tabs and the week's days and amounts in
  SemiBold, a model that disagrees in Regular, Retry in Medium, the answer word in
  `BricolageAnswer` at 0.3 of the page's width (120.6 points on a 402-point iPhone, 96 to 208,
  growing with the large title) on one line, shrinking rather than breaking, and "Checking…" and
  the error words in it at 28. SwiftUI can't set the answer's 0.86 line height, so 0.17 of its
  size comes off the space above and below it instead, every text keeping its whole frame.
- **The top bar** is the website's pills, trailing: the place in a chip with the website's pin
  (no chevron, wrapping in its pill, never cut short) and the gear in a round chip beside it, in
  the place of the website's cm | in pill, which stays in Settings. On approximate IP location
  the website's "Use my exact location" chip sits beneath them (`CoreCopy.useExactLocation`),
  and "Using approximate location." is no longer shown: it is the chip's VoiceOver hint, so the
  user still hears why. A notice about the place (`AppCopy.slugGone`) is a chip of words above
  it. `homeTopBar` and `HomeTopBar` say so (`approximate` is now only the notice). At
  accessibility sizes the bar is leading, the gear trailing, so wrapped words read from the
  left. Every word in it sits on a chip's flat fill, 8.18:1 or more on every band, where bare
  ink under maybesnow's glow at the bar's right end is 4.87.
- **The switcher is the website's tabs, and the segmented `Picker` is gone.** At standard sizes
  a chip track at most 352 wide, centred, in equal thirds, the view on screen on an ink thumb
  with its words in `pill`, sliding on the website's 300 ms curve (`PillSegments`); at
  accessibility sizes, where a third would cut a label short, separate chips that wrap (This week
  on a second line at AX3), not the website's smaller words broken mid-word. One container, the
  tab bar (`.isTabBar`), labelled "Forecast period" (`views`), holds the three buttons,
  `view-now`, `view-today` and `view-week` at every size, each `.isSelected` when shown. UIKit's
  segmented control kept its own type size as the text grew, which `HomeAuditTests` allowed as
  its one Dynamic Type exception; the tabs' words scale, so that exception is deleted and the
  audit allows the home screen one fewer. The open decision about it ("The iPhone app's phases 5
  and 6, reviewed") is closed by Carl's "as close to the website as possible".
- **The hero.** The glyph sits at the top right, 35 below the page's top and 8 into the gutter,
  in full ink (not the website's 0.95, so it matches the text it is tinted with), at 112 points
  growing with the text to 176 and at most 0.4 of the width; the question sits 35 below it,
  wrapping short of the glyph. At accessibility sizes the glyph has a line of its own above the
  question. The question is offered the width beside the glyph and keeps its own
  (`LimitedWidth`, IsItUI), so the heading's element hugs its words rather than reaching over the
  glyph or across the gradient; the design's `.frame(maxWidth:)` would have grown it to the
  whole width beside the glyph. The loading skeleton and its placeholder circle are gone, as the
  website shows none, and the loading word doesn't pulse.
- **Today's models and Now's hours are the website's grid**: three equal columns (two at
  accessibility sizes, where "Météo-France" wraps after its hyphen), each cell its value over its
  name, never lazy (`EqualColumns`, `ValueCell`). Each cell is one element over both lines, its
  frame hugging them: a model read as its name with its amount as the value (`model-<i>`), an
  hour as "20% chance at 10am" (`hour-<i>`). Now's chance bars are gone, as the website has
  none; `HourRow.chance` stays in the presenter and the vectors.
- **The week is the website's rows, and spec 10.2's agreement dots go.** Under "The week ahead"
  (`CoreCopy.nextDays`, `week-heading`), each day is its name, a track with a dot from none to
  the week's snowiest day (core `weekParts`' `track(0, max)`, ported as `WeekRow.left` through
  `StripGeometry.track`, now internal and shared), its amount and its band; at accessibility
  sizes the track goes, as the website drops it under 19 em, and the row stacks. How many
  forecasts expect snow, which spec 10.2 made each day's signature, is now spoken only: each row
  is one element, still read "Tuesday, 2cm, snow, 4 of 6 forecasts expect snow". The columns are
  the website's least widths raised to the widest snow labels, so they line up row to row, which
  the website's per-row grids don't quite do. `HomePage.week` is `{ heading, rows }` in the
  TypeScript and the Swift, and `left` is a number, never null: core's is null only on a
  placeholder row, which `homePage` never shows, so `page.ts` throws rather than pass one on.
- **The footer** has the website's type and spacing: Updated and the notice 12 apart; Retry the
  website's chip (`PillButton`, the page's chip colour with the `border` edge, at least 44 tall,
  also under the error state's words); "Want the full picture?" 44 below with its links each on
  a 44-point line; "Nearby:" and its places as one run that wraps, each place underlined with a
  comma after all but the last (`AppCopy.listComma`, outside the underline and outside the
  place's spoken label, so `app.buttons["Dundee"]` still finds it), two texts side by side
  rather than `Text + Text`, which the iOS 26 SDK deprecates; a hairline 40 above the credits;
  and the credits' links underlined rather than bold.
- **Two website values are not copied**, as step 2 measured: the detail and the agreement
  heading are full ink, not 0.9 (4.31:1 under snow's glow, and `DrawnText` matches pixels
  against the exact ink), and Retry is filled with the chip colour, not 10% ink (4.01:1 on
  maybesnow).
- **What can't match the website.** No wordmark, Hot | Wet | Snow | Wind bar, city links, "All
  places" or site links (Carl's rule); the gear has no website counterpart; the top bar and the
  switcher stay pinned, as iOS's convention and the UI tests' (`pageWindow`) expect, where the
  website's scroll away; the thumb moves when the pager settles, not with the finger; every
  control is 44 points to tap (pills drawn 36, the chip 34, Retry 44, where the website's are 32,
  about 20 and 32), and the links and places sit on 44-point lines, so the footer is airier; no
  ellipsis on a long place; underlines at the font's own position and thickness; the optical size
  fixed per face; the answer's 0.86 line height emulated; at large text sizes the app stacks where
  the website shrinks its tabs and overlaps; the week's columns line up; the vh-based spacing is
  fixed at the iPhone 17's values; and the website's intro, ad slot and places hub aren't pages of
  the app. The 0.3 s colour fade on a view change and the loading word's pulse are on the Later
  list.
- **Tests.** TypeScript: `vectors.test.ts` (the chip without the line, the notice above it, the
  week's heading and every dot between 0 and 100, Durham's at 0, 50 and 100, every snowless week
  at 0), `homeScreens.test.ts` and the copy tests. Linux: `PageVectorTests` (the week's heading
  and each dot against `page.json`), `HomePageTests` (the dots of Durham, Leeds and a snowless
  week; the top bar's chip and notice) and the state tests, which now check `useMyLocation` to
  know a chosen place isn't approximate, since `approximate` is nil either way. On macOS:
  `HomeAuditTests` loses `exceptions[0]`, the segment term in `AuditLog.note` and the tabs it
  matched by; it knows the size reached the app by whether This week's tab starts at or below
  Now's bottom (`switcherWraps`), now that the tabs are buttons at both sizes. `HomeScreens.swift`
  reads the week's heading and checks it (`week-heading`), and `HomeScreens.json` is regenerated
  (the chip's words, no approximate line, the week's heading and dots). The other home tests need
  no change: their labels, identifiers and the `WordsButton` geometry hold. The first macOS run
  is to show whether the grids' cells, the pills and the tab bar's trait pass as the design
  expects (its section 5's risks and fallbacks).

**Step 4: saved places' rules and storage.** The rules, the copy and the store, with no change
to the picker's look yet (step 5 draws it); the picker as it is ignores the presenter's new
fields. "Saved places (the iPhone app)" above says what they are.

- **TypeScript first.** `packages/client`: `PLACES = { recentMax: 5, savedMax: 10 }`
  (`config.ts`), `saved.ts` (`isSaved`, `canSave`, `savePlace`, `unsavePlace`, `choosePlace`,
  `shownRecent`), `RecentPlace.detail` and `addRecent`'s last argument, and
  `APP_KEYS.savedPlaces = 'savedPlaces.v1'`, all at 100% coverage. `packages/mobile`: `saved.json`
  (an empty and a full list, the tenth and eleventh save, a place saved twice under two names,
  approximate IP location, the phone's point named and not, a searched point at the phone's
  coordinates, saving from Recent and from a search, removing with the sixth recent place cut,
  choosing saved and unsaved places, and overlapping lists), `recent.json`'s cases with a line
  (every older case kept), `Constants.Places`, and the copy (`saved`, `savedHint`, `savedFull`,
  `savePlace`, `unsavePlace`, `placeSaved`, `placeUnsaved`, `deleteRecent`).
- **A recent place keeps its line** ("England, United Kingdom"), so Recent tells two Newcastles
  apart as the results do. The field is optional, as the stored shape only ever gains optional
  fields: `recent.v1`'s older entries read as they are, and a place without a line is written
  without one.
- **`savePlace` also refuses a place with no name**, which `canSave` (a target alone) can't see,
  so the lenient reader, which skips empty names, always reads back a list `savePlace` could
  have made.
- **Swift.** `SavedPlaces` (IsItLogic) is the port, with `savedPlaces.v1`'s codec; `RecentPlaces`
  keeps the line and reads its limit from `Constants.Places`; `PlaceSearch.line(_:)` gives a
  result's line or none. `PlacePicker` gains the Saved section (its heading always with nothing
  typed, the hint with none saved, the line when full), every row's `Star` (filled or empty, its
  label, which a row's press-and-hold menu reuses, and what VoiceOver is told after a tap), a
  saved result's value "Saved", the recent places through `shownRecent`, and "Delete". IsItState
  gains `SavedPlaceStore` and `MemorySavedPlaces` (`AppEnvironment.saved`); `AppModel.saved`,
  `.lists`, `.save(_:)`, `.unsave(_:)` and `choose(_:name:detail:)`, which follows
  `choosePlace`; and `PlacePickerModel.save(_:)` (a result or a recent place), `.unsave(_:)` and
  `.choose(saved:)`. `AppModel` writes only the lists that changed, the saved places first.
  IsItServices gains `SavedPlaceDefaults`; the app wires it in, and `-resetStore` forgets it.
- **Privacy.** "recent places" becomes "recent and saved places" in Your privacy
  (`privacyForecast`), the website's privacy notice (`PrivacyBody.astro`, its date moved on),
  `e2e/credits.spec.ts`, `credits.test.ts`'s pair, Linux's `InfoPagesTests` and the first line
  `SettingsTests.testYourPrivacy` reads. Nothing new leaves the phone.
- **Tests.** Linux: `SavedVectorTests` (listed in `PortedVectors`), `RecentVectorTests` with the
  line, the saved places' codec (a round trip, nothing or not a list, the entries skipped, at
  most ten), `PlacePickerTests` (Saved over Recent, a place in both shown once, the stars and
  their words, the hint, a full list with no empty stars, a result's value, typing, every new
  word in sentence case and about snow alone), `PlacePickerModelTests` (a star saving a result in
  place with nothing chosen or asked, a recent place moved to Saved and back, Recent cut to five,
  a saved place chosen, the line kept, the phone's point refused, a full list, both lists read
  back by a new model) and `AppModelTests` (the writes, saved places first, and nothing written
  for a change that changes nothing). Three state tests now expect a chosen result's line among
  the recent places.

**Step 5: the picker in the website's look, with saved places.** The full-screen picker drawn
as the website's (`SearchSheet.astro`, `.sheet`), with step 4's saved places in it. This
supersedes spec 10.3 on the picker's look: no navigation bar, no grouped list, no system blue.

- **Its surface is the sheet**, in the band of the page on screen when it opens (Now, Today or
  This week, whichever is showing), followed if a refresh changes it while open, fading in 0.9 s
  as the pages do (at once under Reduce Motion), as the website's picker takes `:root`'s palette.
  `PickerSheet` reads the theme from the model in its own body, so the cover follows the model.
  The background is `SheetBackground` (the band's `pill` to 15% `g2`, no glow), every word is in
  its ink, and the system's parts on it (the status bar, the keyboard, the spinner, the menus)
  take the band's colour scheme. It never follows Dark Mode, as the pages don't; spec 10.1's
  "sheets follow Dark Mode" no longer holds for it. Settings follows in step 6.
- **Not a `List`.** A `ScrollView` and a `VStack` below the title row and the box, every row made
  at once, as the build plan's rule 1 asks of every page: a lazy container's text was "partially
  unsupported" by the audit's Dynamic Type check though it grew (PR #33's runs), and saved places
  make the list longer than any the audit passed. The keyboard still goes with a drag
  (`scrollDismissesKeyboard(.immediately)`) and the rows still bounce.
- **Press and hold instead of swipes**, which only a `List` has (Carl's open question 3, on its
  default). A recent place's menu holds "Save {place}" when it can be saved and "Delete"
  (`AppCopy.deleteRecent`, destructive); a saved place's holds "Remove {place} from saved
  places". Each item is the same row's VoiceOver action (`accessibilityAction(named:)`), and the
  star stays the main way to save and remove.
- **The parts** (PickerChrome.swift). `SheetHeader`: "Search for a place" (`sheetTitle`, a
  heading) and the website's Close pill (`PillButton` on the sheet: the wash with the `border`
  edge, at least 44 by 44, `picker-close`), the word in `button` type on the title's first
  baseline, so both scale with the text where the toolbar's xmark couldn't. `SearchBox` around
  `BoxTextField`, a `UITextField` in a representable: as tall as the box (`sizeThatFits`, at
  least 44) so its own element is, its text inset inside it so the whole box but the clear
  button is the field to tap, in the `field` role's face through `UIFontMetrics(.body)` (a face up
  under Bold Text), its prompt in `soft`, the caret ink, the keyboard dark on a dark band, the
  search-field trait, and the model's text written back only when it differs, so the caret never
  jumps. The clear button is an ink xmark, 44 by 44, that asks for the keyboard again. `PlaceRow`:
  the place as one button (`label` name, `note` line in `soft`, washed when pressed, at least 44
  tall), read "Leeds, England, United Kingdom", with "Saved" as a saved result's value;
  `StarButton` beside it (`star` or `star.fill` in ink, at least 44 by 44, growing with
  `.body`), its own button with its own style, so a tap on the star never chooses the place.
- **Rows.** "Use my location" in `labelStrong` with no icon (the website has none) and an ink
  spinner while the fix is out; its line and the search's in `line`; "Open Settings" a
  `WordsButton` in `labelStrong`, underlined, as the pages draw a link; "Saved" and "Recent" in
  `heading`, as written, with the header trait; the hint and the full line in `line`.
  Identifiers: `saved-heading`, `saved-<key>`, `saved-hint`, `saved-full`, and each star
  `star-<its row's identifier>` (`star-result-<i>`, `star-saved-<key>`, `star-recent-<key>`);
  every older one is kept.
- **VoiceOver.** After a star, the presenter's announcement is posted ("Leeds saved.", "Leeds
  removed from saved places."); focus isn't moved to a row that moved (the Later list). Rows
  that move between Saved and Recent animate as the system animates a change, at once under
  Reduce Motion.
- **Contrast.** Every text pair on the sheet is 5.19:1 or more on every band (step 2's table:
  ink on the sheet 8.97 at least, `soft` 7.02, ink on the wash 6.46, `soft` on a pressed row
  5.19, the placeholder on the field 5.71), and the field's edge at least 3.43, so nothing like
  `SheetStyle.secondary` is needed, and the picker no longer uses `SheetStyle`.
- **Tests.** `PickerTests`: `testRecentPlaces` reads Leeds with its line and deletes it from its
  menu (`press(forDuration: 1.2)`, then Delete); new are `testSavingAResult` (a result's star in
  place, nothing chosen, the row's value "Saved", kept across a relaunch, chosen from Saved and
  staying there), `testSavingARecentAndRemovingIt` (to Saved by the star and back, the hint, and
  the menu's Remove), `testSavedPlacesAccessibilityAudit` and `…AtAX3` (Kathmandu saved, Leeds a
  recent place, location access off, the keyboard down: `picker-saved`, `picker-saved-ax3`), and
  `testPickerOnADarkBand` (`-fixture aberdeen-snow`, Leeds saved: `picker-dark`). The UI plan
  goes from 39 tests to 44. A menu item is found by its words among buttons that aren't a star,
  since "Remove Leeds from saved places" is the star's label too. The Linux harness's XCUITest
  stub gains `press(forDuration:)`, as the SDK has it.
- **For the first macOS run to show.** `BoxTextField`'s element at 44 or more (else the fallback
  is a container view the field fills); the menus' items as buttons to XCUITest (else the
  accessibility actions, tested on Linux through the presenter); the long Saved and Recent lists
  at AX3; the Close pill's and the stars' contrast on the wash; and the status bar on a dark band,
  on the contact sheet.

## API contract

The spec's shape is implemented exactly. Additive fields: `days[].month`, `agreementText`,
`limitedText`, `stripSummary`, `scale`, `models[].value` (one decimal, for the strip),
top-level `nearby` (nearest city pages: 4, 8 since "Search engines"), `now` and `week` (the two new views; shapes in
`packages/core/src/types.ts`), `rain` (Is it wet?, with its own `days`, `now` and `week`)
`snow` (Will it snow?, the same shape as `rain`, with amounts in cm or in) and `wind` (Is it
windy?, the same shape again, with speeds in mph or km/h). `location` may
include `slug` and `geonameId`. `days` holds today and tomorrow (never more than two); the rest
of the week is summarised in `week`.

- **Stale fallback.** If upstream fails and a cached forecast under 6 hours old exists, the
  API answers **200** with that result and `"stale": true` (cached for 60 seconds). Only
  without a usable cache does it return `503 upstream_unavailable`. A 503 carrying data tends
  to be treated as a failure by generic HTTP clients, which the apps would rather avoid. The
  503 says what went wrong upstream in `error.detail` (e.g.
  `open-meteo: timed out after 6000ms (2 attempts)`), for logs and debugging; clients show
  `message`.
- **Units default.** °F for US visitors (and US territories plus the few other countries that
  use °F day to day; the list is in `config.ts`). City pages render in the city's country's
  default, and the visitor's own °C/°F choice then applies in the browser.
- **CDN caching.** Responses that depend on the visitor (no coordinates, or no explicit
  `units`) are browser-cache only, so the CDN never serves one visitor's location or units to
  another. The website always sends explicit units after the first answer.

Round 2 additions and clarifications (no field changes its meaning):

- `days[1].verdict` is in the future tense ("It'll be hot."); `days[0]` keeps "It's hot.". The
  website shows `days[1]` and `rain.days[1]` in the middle view from 6pm at the place.
- `rain.now.series[].light` (new boolean): the hour's median amount is under 0.5 mm, decided
  in millimetres so "Light rain now." is the same in either unit. Responses cached before it
  lack it; treat a missing flag as false.
- `rain.week.wettest` is picked, and its amount given, from the same models as `total`, so its
  amount never exceeds the total (it falls back to each day's consensus amount when there is no
  total).
- `rain.days[0]` while the current hour is wet: that hour counts in full, and `threshold` (the
  strip's wet zone) is an hour's wet amount, 0.2 mm (0.01 in).
- `Netlify-CDN-Cache-Control`: stale-while-revalidate is cut (down to 0) so that max-age plus
  it ends by the next forecast hour. Only max-age's one-minute floor can run past the hour.

Will it snow? additions (no field changes its meaning):

- `snow` is present exactly when `rain` is: `snow.days` (the rest of today, then tomorrow),
  `snow.now` (the current hour with a day of judged hourly points, kept current in the browser
  by core `computeSnowNow`/`formatSnowNow`) and `snow.week`. A day without snow carries
  `reason` (`warm`, `rain` or `dry`). Amounts are in `snow.unit`: `cm` with `units=c`, `in`
  with `units=f`.
- `rain.now.series[].asSnow` (new, optional): most of the hour's precipitation falls as snow by
  the shared rule. Sent only when the forecast has snowfall; `snow` keeps its meaning.

UV index and place height additions (no field changes its meaning):

- `days[i].uv` (optional): `{ max, level, peak }`, the day's highest hourly UV index (whole
  number), its level (`low`, `medium`, `high`, `veryhigh` or `extreme`) and the hour it starts
  ("1pm", null when `max` is 0). Absent when the forecast has no UV index for the day.
- `now.uv` (optional): `{ value, level }` for the hour containing the moment, and
  `now.series[].uv` (optional) the hour's rounded UV index, for recomputing it in the browser.
  Responses cached before these lack them.
- `location.elevation` and `SearchResult.elevation` (optional): the place's height, whole
  metres, when known. `/api/v1/today` takes `elevation` with `source=search`.

Is it windy? additions (no field changes its meaning):

- `wind` is present when the forecast has wind and gusts: `wind.days` (the rest of today from the
  current hour to 9pm, or midnight from 9pm, then tomorrow 7am to 9pm), `wind.now` (the current
  hour with a day of judged hourly points, kept current in the browser by core
  `computeWindNow`/`formatWindNow`) and `wind.week`. Speeds are whole numbers in `wind.unit`
  (`mph` or `kmh`); each model's `gust` and `mean` are whole numbers, `value` one decimal for the
  strip. Responses cached before it lack it.
- `/api/v1/today` takes `windUnits=mph|kmh`. Without it, wind is in the place's country's unit
  when `units` is given (so the response stays shareable), else the visitor's.

Wind direction additions (no field changes its meaning):

- `wind.days[i].direction`, `wind.days[i].models[j].direction`, `wind.now.direction` and
  `wind.now.hours[i].direction` (optional): `{ degrees, compass, words }` (whole degrees from 0
  to 359, where the wind blows from; `N`, `NE` … `NW`; "from the south-west"), or `null` when the
  direction is variable. `wind.now.series[i].dir` (optional): the hour's whole degrees, or
  `null`. Each is absent when the forecast has no direction for it (responses cached before it,
  and later days whose hours the server no longer keeps); the week's days have none.

Search engines change (no field changes its meaning):

- `nearby` holds the 8 nearest city pages (`LINKS.nearby`), up from 4.

App additions, for the iPhone app (its build spec, section 5; no field changes its meaning). Every
answer gains what an app needs to draw it without working anything out; the website works the
same out itself, with the same core functions, and does not read them:

- `updated`: `{ date, clock }`, `updatedAt` at the place (core `updatedParts`, which
  `updatedTime` now uses, so the website's "Updated" line is byte for byte as before; a test checks
  it at 37-minute steps across the autumn clock change, in seven zones). The split adds 29 B
  gzipped to the website's script (24,905 to 24,934 B of the 25,600 B budget).
- `links`: core `outboundLinks(location)`, the footer's BBC Weather, Met Office and AccuWeather
  links.
- `snow.days[i].bandLabel`: `snowLabel(band, reason)`, as the week's rows have it.
- `snow.week.days[i]`: `chance`, `snowy`, `total` and `reason`; `rain.week.days[i]`: `chance`,
  `wet` and `total`. Each is its day's own (`SnowDayComputation` and `RainDayComputation`, already
  worked out), as `snow.days` and `rain.days` give them.
- They are on every answer, not only with `ahead`: they add 0.17 to 0.19 KB gzipped (0.86 to
  0.87 KB raw; measured with `tsx scripts/ahead-cost.ts`), the website can use them later, and nothing
  unrelated hangs on the next-hours flag. The city pages embed their answer, so their HTML grows
  by the same.
- A contract test (`packages/server/test/contract.test.ts`) asks the website's own requests
  (a city, device coordinates, a searched place and the IP location, each with and without
  `units`, with `windUnits` and with `t`). The top-level and `snow` keys must be the documented
  sets, so `ahead` is absent without the opt-in, and every other field, with the status and
  headers, must equal a snapshot taken before these additions on the same synthetic data and
  clock (`packages/server/test/fixtures/contract.json`). `tsx scripts/contract-snapshot.ts`
  writes it, leaving out the added fields, so running it again must leave the file unchanged.

`ahead=snow` is the only app opt-in, and the website never sends it. It adds `snow.ahead`
(`ApiSnowAhead[]`, core `snowAhead`), present only when asked for and when the snow block
exists, for `AHEAD.hours` (6) hours. `ahead=<topic>[,<topic>]`; v1 answers `snow`, and unknown
topics and repeats are ignored. Its semantics, as the app spec words them (one sentence
corrected, below):

- Entry `i` is for the `i`-th forecast hour after the one containing the request moment, up to
  `AHEAD.hours`. Its `time` is that hour's start. In +5:30 and +5:45 zones that is :30 or :15
  past the UTC hour, because forecast hours are local hours.
- `now` is `formatSnowNow(computeSnowNow(judged, time), unit)` without `series`. Snow's Now
  depends only on the hour containing the moment, so this equals the website's Now for the whole
  hour, except the `time` field, which the app never shows.
- `today` is `formatSnowDay(computeSnowDay(day, { from: time, normals }), units)`: **the answer
  the server gives at the first instant of that hour**, from the same forecast. After the
  place's midnight it is the new date's day, from that hour.
- `computeSnowDay` weights the current hour by the minutes left, and its thresholds scale with
  the fractional window hours. So the website's Today, asked later in the same hour, can differ
  a little from `today`, either way. The gap is biggest in the last hour or two before
  midnight, when the window is short. The app shows `today` for the whole hour and never claims
  it is minute-exact. From 18:00 the middle view shows Tomorrow, so in the evening `today`
  reaches the screen only through the week's first row and the "Today" row of the medium
  widget.
- `week` is `formatSnowWeek(computeSnowWeek([today, ...later days]), units)` on the same basis,
  so the week verdict, detail and first row always agree with `today`. After midnight the week
  starts on the new date.
- Why only 6 hours: the app and widgets stop showing a forecast once it is
  `CACHE.forecastStale` (6 h) old, as the server's own stale rule does. A response's `updatedAt`
  is never later than its request, so entries beyond 6 hours would never be shown.

Built and checked:

- **The correction.** The spec said the website's Today, later in the hour, "can be a little less
  snowy". The tests show it can also be a little snowier: with the current hour dry, the minutes
  left take nothing off the totals but lower the thresholds. Two forecasts with 0.16 cm in the
  last hour of the day make 10pm's entry "No." (flakes; 0.2 cm needed over two hours) while the
  server says "Maybe." at 10:30pm (0.15 cm over an hour and a half). A few flakes in the last
  hour go the other way: 11pm's entry says flakes, the server at 11:30pm none. Both are pinned
  in `packages/core/test/snow-ahead.test.ts` at 10pm, 10:30pm, 11pm, 11:30pm and 11:59pm.
- An hour whose day has no snow answer (no model covers the rest of that day) is left out, as the
  response itself would have no `snow` then.
- **The semantic test** (`packages/server/test/ahead.test.ts`): each entry equals `getToday()`
  asked at that hour's start on the same cached forecast (`snow.now` without `series`,
  `snow.days[0]` and `snow.week`), for a morning, across the place's midnight, in Kolkata (+5:30)
  and Kathmandu (+5:45), relabelled from the synthetic zones, and across the UK clock changes on
  Sun 25 Oct 2026 and Sun 28 Mar 2027. The answer is otherwise the same as without `ahead`,
  headers included.
- **Cost (V10)**, measured with `tsx scripts/ahead-cost.ts` on synthetic data, 6 entries each.
  Within the 1 KB gzipped budget:

  | Place             | Moment (UTC)     | Today in the entries | Added, raw | Added, gzipped | Answer, gzipped |
  | ----------------- | ---------------- | -------------------- | ---------- | -------------- | --------------- |
  | Aberdeen (snowy)  | 2 Dec 2026 9:05  | snow in all six      | 17.4 KB    | 0.42 KB        | 4.38 → 4.81 KB  |
  | Reykjavík (mixed) | 2 Dec 2026 15:05 | flakes, then none    | 17.3 KB    | 0.54 KB        | 4.01 → 4.56 KB  |
  | Leeds (dry)       | 19 Oct 2026 9:05 | none                 | 16.9 KB    | 0.38 KB        | 4.21 → 4.59 KB  |

  CPU per request, in this container (4 CPUs, Node 22, shared with another agent's work), in
  five runs over two days, at load averages from under 1 to 5:
  - warm (forecast and normals cached, code run before; medians of 200): `snowAhead` takes 0.5
    to 0.7 ms, a whole request 0.6 to 0.9 ms more (3.6 to 4.8 ms without, 4.3 to 5.5 ms with),
    and its JSON 0.03 to 0.05 ms more. One run, as the other agent's work started, measured its
    first place at 1.3 ms for `snowAhead` and 1.7 ms more for the request (7.1 ms without, 8.8
    ms with);
  - cold (a new process, medians of 15): `snowAhead`'s first run takes 2.1 to 3.5 ms (5.4 ms in
    that same run; 1.8 to 14.5 ms at the extremes), after that process's first request has
    taken 93 to 165 ms.

  The Netlify function's own duration is for Carl's preview logs after deploy. If either figure
  ever runs over, the spec's fallback is to send `week` only where it differs from the entry
  before.

No CORS. The apps call the API natively (`URLSession` is not a browser), so CORS does not apply
to them. `Access-Control-Allow-Origin: *` would let any other website call the API from its
visitors' browsers, which costs Netlify invocations and Open-Meteo calls. So the API sends no
`Access-Control-*` header, and the rule is: add CORS only for a named origin, if a web view ever
needs it.

Caching, `t` and rate limits for app traffic (nothing changes for them):

- The app will always send explicit `units` (from the first answer's `units`), and a slug or
  coordinates rounded to 0.05°, so its answers are shared by the CDN with everyone in the cell
  who asks the same. Only its first launch, before any place is known, asks for the IP location,
  which is private. A test checks the headers with `ahead` are the website's.
- No `t` in normal use: no CDN entry outlives the next forecast hour (but for max-age's
  one-minute floor), and the app ignores its local URL cache. It will follow the website's rule:
  when the saved answer is out of date and the new one still is (a phone clock running fast),
  it asks once more with `t=<UTC hour>` and then holds, so a fast clock costs at most one extra
  request per server hour.
- The rate limit stays at 60 a minute per IP on each domain. The app will treat a 429 like being
  offline. If the function logs show 429s from carrier NAT after an evening notification, raise
  `windowLimit` in `functions/api/today.mts` and `RATE_LIMIT` in core config together. Measure it in
  TestFlight and in launch week. (The spec counts on CDN hits not counting towards the limit; that
  is Netlify's to say, and is not checked here.)

`/app-ads.txt` (the website, not the API): AdMob's ads.txt for the apps, from
`PUBLIC_ADMOB_PUBLISHER_ID` (a comment line until it is set), as `/ads.txt` is from the AdSense
ID. It is in the edge function's `excludedPath`, so all four domains serve the one root file and
each app's listing can name its own site (`netlify/test/route.test.ts`; `e2e/domains.spec.ts`
checks it answers `text/plain` on all four hosts).

## Credits and licences

- **Credits follow each source's licence.** Open-Meteo's licence asks for a "Weather data by
  Open-Meteo.com" link to open-meteo.com next to the data, and its CC BY 4.0 asks us to say
  when the data was changed (the blends, medians and verdicts are changes). The Met Office's
  grids (UKMO, one of the 8 models) are CC BY-SA 4.0 instead. So the credits are "Weather data
  by Open-Meteo.com (CC BY 4.0), modified", "Contains Met Office data © Crown copyright, the
  Met Office, licensed under CC BY-SA 4.0" and "Climate data: NASA POWER" (`ATTRIBUTION` in
  `copy.ts`). The API's `attribution` carries them; the footer of every page on all the
  sites shows them, with Open-Meteo, NASA POWER and both licences linked, plus GeoNames. The
  About pages name the agencies behind the models (from `MODELS`, so dropping a model updates
  them) and say that the sites combine and modify the data. The iPhone app's page footer shows
  the API's `attribution` lines as they are, with the same phrases linked: the phrases and their
  links are core's (`CREDIT_LINKS`, split by `creditParts`), which the website's `Credit.astro`
  reads too.
- **The fonts in the apps.** Bricolage Grotesque is under the SIL Open Font License 1.1, with
  no reserved font name. The iPhone app bundles the answer's subset as `BricolageAnswer.ttf` and
  three static text faces as `BricolageText-{Regular,Medium,SemiBold}.ttf`, each renamed and so a
  modified version, which the OFL allows; each name table keeps the copyright and carries the
  licence's description and URL. The app's credits screen (spec section 10.6) gives the licence's
  full text, which covers every face.
- **Fair use, not non-commercial.** ShareAlike attaches only to adapted material, and a verdict
  or a median of 8 models very likely is not (a reading, not legal advice). The per-model
  figures the pages and `models[]` show are the closest thing to passing on Met Office data,
  and CC BY-SA does not let us add terms that restrict them. The Terms page therefore drops
  "personal, non-commercial purposes" for a fair-use clause (reasonable use, no automated bulk
  scraping or heavy load, rate limits apply) and says the data stays under its own licences.
- **NASA POWER terms (closed).** NASA's registry entry for POWER: "There are no restrictions on
  the use, access, and/or download of data from the NASA POWER Project. We request that you
  cite the NASA POWER Project when using the data provided from NASA POWER Project.", licensed
  CC BY 4.0. An ad-supported site may use it; the footer and About pages cite it.
- **Declined consent means a limited ad or none.** In the UK and EEA a non-personalised ad
  still needs consent, so without it Google shows a limited ad, which uses no cookies, or no ad.
  The Cookies page and the comment in `scripts/ads.ts` say so; ad behaviour is unchanged.

## Search engines

Carl approved the SEO groundwork from the October research. Google's own weather box answers
generic searches ("weather today"), so the sites aim at a question with a place ("will it rain
in Leeds today"), with pages that are plainly original, easy to browse and honest to crawlers.

- **Home pages never offer a crawler a made-up answer.** The server still sends the loading
  state, whose placeholder ("High of 00°, feels like 00°…") holds the layout. The views carry
  `data-nosnippet` while unanswered, so search results never quote it. The attribute stays once
  the browser answers, so the answer for a crawler's own location stays out of snippets too.
  The answer is still never rendered on the server: Googlebot crawls from the US and would
  index a US town in °F (so "render the home answer from the visitor's location", under
  Performance, is for speed only, never for search engines).
- **Home pages say what they are.** Under the answer and the ad, a short static introduction
  (what the site answers, that it combines 8 forecasts and compares with what is normal for the
  place, a link to How it works), "Popular places" (20 UK city pages across the four nations,
  `LINKS.popular` in `config.ts`) and a link to the places page. It is a labelled region
  outside `<main>`, so the saved snapshot does not carry it. It follows the Hot | Wet | Snow |
  Wind toggle, as the brand and Nearby do (Carl noticed every site's toggle showed the hot
  site's text): with Wet showing on isithot.today it says what isitwet.today answers, and its
  links go there, carrying the chosen units. The server still renders only the page's own text;
  the others ride in attributes (`data-wet` and so on), which search engines do not read as the
  page's text, rather than in the script, which is near its size budget.
- **The heading is the question with its answer**: an `h1` holding the question ("Is it hot in
  Leeds today?", `#question`) and the answer ("Yes.", `#answer`), and the same for Now and This
  week (`h2`, raised to level 1 while on screen, as before: one main heading a page). The look
  and the ids are unchanged. Today's live region holds the heading and the verdict, so an answer that
  arrives or changes is read with its question ("Is it hot in Leeds today? Yes. It's hot.").
  Nothing in it changes from minute to minute (Now's minute update is outside it; an e2e test
  watches it for three minutes), and a Hot | Wet | Snow switch is still announced once.
  `CACHE.snapshotVersion` went from 7 to 8 for the new markup.
- **Titles never carry the answer**, which went out of date in search results and contradicted
  the page after 6pm. City pages give the question and what the page offers: "Is it wet in
  Leeds today? Rain hour by hour from 8 forecasts | isitwet.today" (8 is `MODELS.length`).
  Words after the question give way when the part before the site name would pass 65
  characters (`TITLE_MAX_LENGTH`); the question never does (core `cityTitle`). Wet's titles say
  "rain", the word people search with, while the page still asks "Is it wet…?". Descriptions
  say what the page answers (`cityDescription`). The tab title follows suit, since search
  engines run the page's script and index the title it sets: the home page's tab no longer
  reads "Yes. It's hot.", though it still names the site of the question on screen. Share
  cards (og:title, og:description, the OG image) keep today's answer.
- **"Updated 3:05pm BST"** under the views says when the forecast behind the answer was fetched
  (the API's `updatedAt`), in the place's own time, with the zone's abbreviation where it has
  one (BST, CEST, EDT; none for zones known only by an offset, such as Tokyo's), in a
  `<time datetime>`. A stale copy from before midnight reads "yesterday, 11:40pm GMT". The
  browser updates it with every new answer. There was no freshness line to reuse.
- **Places pages.** `/places` on each site (isitwet.today/places and willitsnow.today/places
  through the edge function's usual rewrite) lists every city page the site lists: the UK by
  nation, then the world by country, A to Z (core `placeGroups`). Every footer, the home pages
  and city pages link to it, so every city page is two clicks from a home page.
- **City pages link on**: 8 nearby city pages (was 4; `LINKS.nearby`, also the API's `nearby`
  count), the same city on the other sites (three since Is it windy?) as real links to their own
  domains (which the browser keeps on the same host on previews and locally, and which carry the
  chosen units, as Nearby's do), and All places. The toggle stays as buttons.
- **Structured data**: WebSite (name, alternateName, url) on each home page, one per domain as
  Google's site names need; BreadcrumbList (site › Places › city) on city pages and the places
  page. No FAQPage or HowTo: Google no longer shows either.
- **Sitemaps** list home, About, the places page and the city pages the site lists, and
  willitsnow.today's the snow app's support page (since S8). No `lastmod` (nothing knows when a
  page last changed), `changefreq` or `priority` (Google ignores both).
- **Snow pages where it never snows** would say No all year. They get `noindex`, are left out of
  willitsnow.today's sitemap and places page, and the other sites' pages for those places do
  not link to them. The pages still work, and search on the site still finds them. The rule
  (`SNOWLESS` in `config.ts`, core `snowless`), applied to `data/cities.json` as pages and
  sitemaps are built: within 30° of the equator and below 3,000 m, a city without a recorded
  height counting as low. No city in the list is that high (Bogotá, 2,582 m, is the highest).
  **Needs a decision**: check the 63 it leaves out. Houston (snow in January 2025),
  Johannesburg (1,767 m, snow every few years) and Chongqing see snow on rare days; Cairo,
  Basrah, Alexandria, Funchal, Casablanca, Los Angeles, Sydney and Cape Town, just past 30°,
  stay listed though they almost never do.
  - Angola: Luanda. Australia: Brisbane. Bangladesh: Chittagong, Dhaka. Brazil: Belo
    Horizonte, Brasília, Fortaleza, Rio de Janeiro, Salvador, São Paulo. China: Chongqing,
    Dongguan, Guangzhou, Shenzhen. Colombia: Bogotá, Cali. Congo - Kinshasa: Kinshasa. Côte
    d’Ivoire: Abidjan. Cuba: Havana. Dominican Republic: Santo Domingo. Ethiopia: Addis Ababa.
    Hong Kong: Hong Kong. India: Ahmedabad, Bengaluru, Chennai, Delhi, Hyderabad, Kolkata,
    Mumbai, Pune. Indonesia: Denpasar, Jakarta, Surabaya. Kenya: Nairobi. Mexico: Cancún,
    Mexico City. Myanmar: Yangon. Nigeria: Ibadan, Kano, Lagos. Pakistan: Karachi. Peru: Lima.
    Philippines: Quezon City. Saudi Arabia: Jeddah, Riyadh. Senegal: Dakar. Singapore:
    Singapore. Somalia: Mogadishu. South Africa: Durban, Johannesburg. Spain: Las Palmas de
    Gran Canaria, Santa Cruz de Tenerife. Taiwan: Taipei. Tanzania: Dar es Salaam. Thailand:
    Bangkok, Phuket. United Arab Emirates: Dubai. United States: Houston, Miami, Orlando.
    Venezuela: Caracas, Maracaibo. Vietnam: Ho Chi Minh City.
- **Not done here** (Carl's calls, from the same research): the wet question's wording
  ("Will it rain…?" on the page), different city lists per site, page-specific additions such
  as the best and worst day of the week, "where in the UK" pages, and the About page's name and
  contact. Search Console and Bing are in SETUP.md, section 7.

## Design

- **Header controls and the tab bar sit on a pill.** They sit on the bright top-right glow, so
  they get a backing in each band's `pill` colour (the gradient colour with the most contrast
  against the text) at 85%.
- **Every text meets WCAG 2.2 AA in every band and view** (Carl's go-ahead, October 2026).
  `e2e/contrast.spec.ts` measures it on rendered pages for all 24 bands (six each for hot, wet,
  snow and wind), all three views, on phone and desktop, and fails CI below 4.5:1 (3:1 for large
  text). What changed from the approved prototype (`reference/prototype.html` is updated to
  match):
  - Hot is darker: `#cc3d17` to `#a51c17`, with a deeper glow (`#ff9a4a`). The old `#e8571f`
    is only 3.6:1 against white before the glow is added.
  - The glow strength is set per band: Freezing 60%, Cold 45%, Hot 40%, Scorching 70%, Mild
    and Warm unchanged at 85% (their dark text is fine on it).
  - The question is no longer faded, and small secondary text (model names, agreement line,
    scale, credit) is faded less.
  - Models outside the agreement band show a lighter figure instead of faded text, and the
    search sheet sits on the band's `pill` colour.
  - With text enlarged to 200% on a 360px phone nothing is cut off: the header controls
    wrap, the tab labels shrink to fit (a word too long for its third, such as "Tomorrow",
    breaks inside it), long answers shrink to the page's width, and the week rows drop their
    dot track.
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

Site JS is about 24 KB gzipped (budget 25 KB, checked in CI by `scripts/js-budget.mjs`; it
was 8 KB before Now and This week, 12 KB before Is it wet?, 16 KB before round 2, 17 KB before
Will it snow?, 20.7 KB before the credits and Search engines work, which added the titles,
the Updated line's time zones and the links to the other sites, and about 21 KB before Is it
windy?). The rain, snow and wind day and week judging runs only on the server; the browser
carries the code that keeps rain's, snow's and wind's "now" current. Cached API responses come
back from the Netlify CDN in 10–40 ms. LCP sits just above the 1.5 s target under Lighthouse's
simulated Moto G on slow 4G. Things that got it there:

- A 7.6 KB static cut of Bricolage at the answer's weight is inlined in the page, so the
  answer word paints in its final font straight away. The full variable font (77 KB) loads
  for everything else.
- Fallback fonts are sized to Bricolage's widths (Arial, Roboto, DejaVu), line height is
  explicit, and the detail line has a fixed width, so the font swap does not move text.
- The home page starts its API request from an inline script in `<head>`, before the main
  script has loaded.

Possible next step if LCP needs to drop further: render the home page's answer on the server
from the visitor's approximate location. Keep it out of what search engines see (they would
index the crawler's own US town; see "Search engines").

## Open decisions carried over from the spec

- Tuning α and the band edges after real use (all in `packages/core/src/config.ts`).
- Remove-ads model. The `AdSlot` component takes an `adsDisabled` flag for it.
- The iPhone app: whether a recent place that came from "Use my location", chosen again from the
  list, follows the phone at the next launch (as now) or stays put ("The iPhone app's phase 6,
  reviewed").
- The iPhone app: whether to restore spec section 16's Smart Invert exemption for the glyph and
  the gradients, which the app now inverts with the text. Restored, it is for the page as a
  whole, its text too, and only once the window-sized element the audit fails is settled ("The
  iPhone app's UI tests, after PR #33's second macOS run").
