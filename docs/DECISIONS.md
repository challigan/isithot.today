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
  `WIDGET`, `ALERTS`, `CLIENT`) gain a member when a key is added, and stop the generator when
  the new value isn't a whole number, so a type is chosen rather than guessed; snow's shares and
  thresholds are declared `Double`, whole numbers too. `ALERTS` has only `heartbeatDays` until
  the notifications work adds the windows.
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
- **Accessibility, as section 16 asks for these elements:** the question and answer are one
  heading element labelled with the place; the strip is one element read as its summary; a
  model's row reads its name and amount; at accessibility sizes the rows stack, the place name
  wraps to two lines and the glyph stops growing at 160 points; every text uses a text style, the
  answer `Font.custom("BricolageAnswer", size: 64, relativeTo: .largeTitle)`; the background and
  glyph are left alone by Smart Invert; buttons and links use the system's styles, tinted in the
  palette's ink. A model that disagrees has a lighter amount rather than fainter text, as on the
  website, so it keeps its contrast; its dot on the strip is fainter.
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
  week, and the position it reports on the way could set the view mid-scroll.
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
  Settings → Your privacy shows the ID's first 8 characters, the place with its zone, the units
  and the switches (section 10.6), so both pages say it shows "the main things we keep".
  - **When it goes.** Turning notifications off in iPhone Settings sends nothing: the app finds
    the permission denied and sends DELETE the next time it is opened (section 12.2), so both
    pages say so, and that the in-app switches delete at once. The 90 days count from the app's
    last PUT, and with nothing changed it puts again only every `ALERTS.heartbeatDays` (7), so a
    registration can go about 83 days after the app was last opened: "about 90 days" in the
    notice, "about three months" on the support page.
  - **Not yet in the app's copy.** Section 15.5's text and `APP_COPY.privacyNotifications` (the
    app's summary, above the live data and the link to this notice) have the shorter list and
    "90 days after you last open the app". Phase 6 should give the app's line the notice's
    "about" and "main things", or the app could refresh `seenAt` on every open (a client change,
    with a vector update).
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
- **The answer font in the apps.** Bricolage Grotesque is under the SIL Open Font License 1.1,
  with no reserved font name. The iPhone app bundles the answer's subset as `BricolageAnswer.ttf`,
  renamed and so a modified version, which the OFL allows; its name table keeps the copyright
  and carries the licence's description and URL. The app's credits screen (spec section 10.6)
  gives the licence's full text.
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
