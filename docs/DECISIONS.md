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
    cancelled). A 4xx (bad request, bad key, rate limited) is not retried. The 6 s now covers
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
- **Needs a decision: MET Norway matters more for rain.** Outside the Nordics it is close to a
  second copy of ECMWF (see Data above), and for rain each model is a plain wet/dry vote, so
  ECMWF effectively votes twice: 2 of 8 is enough for Maybe. Dropping MET Norway outside the
  Nordics would make it 2 of 7.
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
- **Next data improvement: pass the place's height.** Not in this version. Points are rounded
  to 0.05°, and Open-Meteo uses the terrain height at the rounded point, which in mountains can
  be several hundred metres from the town (2–6 °C, enough to turn rain into snow). Passing
  `elevation=` for searched places (the geocoder returns it) and city pages (GeoNames heights
  through `pnpm cities`), with the height rounded to 50 m in the forecast cache key, would fix
  it, but it changes hot and wet answers in the mountains too, so it waits for a decision.
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

## API contract

The spec's shape is implemented exactly. Additive fields: `days[].month`, `agreementText`,
`limitedText`, `stripSummary`, `scale`, `models[].value` (one decimal, for the strip),
top-level `nearby` (4 nearest city pages), `now` and `week` (the two new views; shapes in
`packages/core/src/types.ts`), `rain` (Is it wet?, with its own `days`, `now` and `week`)
and `snow` (Will it snow?, the same shape as `rain`, with amounts in cm or in). `location` may
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

## Design

- **Header controls and the tab bar sit on a pill.** They sit on the bright top-right glow, so
  they get a backing in each band's `pill` colour (the gradient colour with the most contrast
  against the text) at 85%.
- **Every text meets WCAG 2.2 AA in every band and view** (Carl's go-ahead, October 2026).
  `e2e/contrast.spec.ts` measures it on rendered pages for all 18 bands (six each for hot, wet
  and snow), all three views, on phone and desktop, and fails CI below 4.5:1 (3:1 for large
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

Site JS is about 20 KB gzipped (budget 25 KB, checked in CI by `scripts/js-budget.mjs`; it
was 8 KB before Now and This week, 12 KB before Is it wet?, 16 KB before round 2 and 17 KB
before Will it snow?). The rain and snow day and week judging runs only on the server; the
browser carries the code that keeps rain's and snow's "now" current. Cached API responses come
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
from the visitor's approximate location.

## Open decisions carried over from the spec

- NASA POWER terms for an ad-supported site.
- Tuning α and the band edges after real use (all in `packages/core/src/config.ts`).
- Remove-ads model. The `AdSlot` component takes an `adsDisabled` flag for it.
