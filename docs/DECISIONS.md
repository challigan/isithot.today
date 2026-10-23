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
  results), so a saved list can go between them later. Nothing is built for it yet (see "Saved
  places").

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

## Saved places (planned for the apps)

Carl wants to save places in the native apps. Nothing is built for it on the web.

- The full-screen picker is where the saved list goes: a "Saved places" section between the
  search box and the results (in `SearchSheet.astro`, between "Use my location" and the
  results list).
- The API needs nothing new: a saved place is a city slug or rounded coordinates, which
  `/api/v1/today` already takes.
- On the web each domain has its own storage, so places saved on isithot.today would not show
  on isitwet.today or willitsnow.today. A web version would need the same address-carrying
  approach as F8 above (clumsier for a list than for one place) or the sites on one shared
  domain.
- The iPhone app's recent places (the last five, newest first, one per place) are a rule in
  `packages/client` (`addRecent`), below.

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

- **V8, does the schedule run?** `functions/api/alerts-run.mts` runs every 15 minutes (UTC) and,
  until the full job lands, only logs `alerts-run: disabled (production)`. The Netlify Functions
  page should list it as scheduled, with a log line every 15 minutes in production. About 2,900
  invocations a month. Elsewhere the line says what it saw, for example
  `(deploy-preview, ALERTS_SMOKE unset)`, so a preview check that sends nothing shows why.
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
  them) and say that the sites combine and modify the data. The apps will need the same
  visible credits, not only the JSON field.
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
- **Sitemaps** list home, About, the places page and the city pages the site lists. No
  `lastmod` (nothing knows when a page last changed), `changefreq` or `priority` (Google
  ignores both).
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
