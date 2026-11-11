# Setup and launch checklist

Everything runs today without any keys: the free Open-Meteo API and NASA POWER need none.
These steps move it from preview to a public, ad-supported launch, roughly in spec phase order.

## 1. Netlify (done, check once)

The `isithotapp` project builds from this repo. `netlify.toml` sets the build command, publish
directory, functions directory and Node 22, so the UI settings can stay at their defaults.

- **Base directory** and **package directory**: leave empty (the build runs from the repo
  root). If Netlify ever asks which monorepo package to build, pick the root.
- **Deploy previews**: on by default; every pull request gets
  `https://deploy-preview-<n>--isithotapp.netlify.app`.
- **Pull requests from outside the team (before notifications go live, section 5).** The
  repository is public, so anyone can open a pull request, and its preview would run their code
  with this site's Netlify Blobs, where the notifications' store keeps every device token and
  place. In **Site configuration → Build & deploy → Continuous deployment**, set the **Sensitive
  variable policy** to **Require approval**, so Netlify builds a pull request from a fork only
  once you approve it. Approve only one whose changes you have read. (If Netlify has moved or
  renamed the setting, its docs call these "untrusted deploys".)
- **Netlify Blobs** (the API cache) needs no setup. Production uses one shared store;
  previews get their own.
- **Rate limiting**: the API functions declare a 60 requests/minute per-IP rule in code. If
  your Netlify plan does not include code-based rate limiting, Netlify ignores the rule and the
  site still works; upgrade or add a rule in the UI later.

Merging the pull request deploys to production at https://isithotapp.netlify.app.

## 2. Open-Meteo Standard plan (before ads or public launch)

The free API is for non-commercial use only and bans ads. Testing with friends, with ads off,
is fine on it. Its limits are 600 calls a minute, 5,000 an hour, 10,000 a day and 300,000 a
month. Each forecast fetch costs 4.8 calls (6 models × 8 hourly variables: temperature,
feels-like, precipitation, snowfall, UV index, wind speed, wind gusts and wind direction, one
request serving all four sites; it was 2.4 before Will it snow?, 3.2 before the UV index, 4.0
with eight models before Is it windy?, and 4.2 before wind direction; without wind's three
variables six models would cost 3.0), and a fetch only happens when a 5 km cell's cached
forecast is over an hour old: at most 116 calls a day for a place checked around the clock, so
it would take roughly 87 such places (or search engines crawling every city page of the four
sites every hour) to reach the daily limit. Searched places and city pages are forecast for
their own height (50 m bands) while device and IP locations are not, so a cell visited both ways
is two forecasts (about 43 such places reach the limit), and in hills places in one cell at
different heights are more. A group of friends
is nowhere near it. If the limit is ever hit, the API serves the last forecast (up to 6 hours
old) marked stale, and the Netlify function log shows
`forecast unavailable for … open-meteo: HTTP 429 …` (a 503 says the same in `error.detail`).

1. Subscribe to the Standard plan at https://open-meteo.com/en/pricing ($29/month, 1M calls).
2. In Netlify: **Project configuration → Environment variables → Add a variable**:
   `OPEN_METEO_API_KEY` = your key, scope **Functions** (or all), all deploy contexts.
3. Trigger a redeploy. With a key present the code switches to the
   `customer-api.open-meteo.com` and `customer-geocoding-api.open-meteo.com` hosts by itself.

Quota: each cache miss is one forecast request for 6 models × 8 hourly variables (4.8 calls),
and a second one when Open-Meteo has not answered within 2 seconds.
Forecasts are cached per 5 km grid cell (and 50 m height band, where the place's height is
known) for an hour, and API responses at the CDN for up to 10
minutes (never past the next hour, stale copies included, since today's rain, snow and wind
answers cover the rest of the day), so calls scale with the number of distinct places, not page
views. All four sites share the cache. NASA POWER needs no key and has no quota to plan for:
each 50 km climate cell is fetched once (four small requests: highs, rainfall, snowfall and wind
speed) and cached for good.

## 3. Custom domain

1. Netlify: **Domain management → Add a domain** → `isithot.today`.
2. Either move DNS to Netlify (simplest) or add the records Netlify shows at your registrar.
3. Netlify issues the HTTPS certificate automatically. Make `isithot.today` the primary
   domain; `www` redirects to it.

Canonical URLs, sitemaps, robots.txt and OG image links use the four site addresses in
`packages/core/src/config.ts` (`SITES`), not the deploy URL.

### isitwet.today (the second site)

The same deploy serves both sites. A Netlify edge function (`netlify/edge-functions/topic.ts`)
sends requests for isitwet.today to the `/wet` versions of the pages, which open on "Is it
wet?"; isithot.today/wet redirects to isitwet.today. Nothing else to deploy. In the Netlify UI:

1. **Domain management**: `isitwet.today` is a **domain alias** of the project, and
   `isithot.today` stays the **primary** domain.
2. Add `www.isitwet.today` as a second alias if you want www to work; the edge function sends
   it to the apex.
3. **HTTPS**: the certificate lists both domains (and the www names). Use **Renew
   certificate** if a new alias is missing.
4. Google Search Console: add the isitwet.today property and submit
   `https://isitwet.today/sitemap.xml` (section 7). Before ads go on, add isitwet.today to
   AdSense's sites.

Deploy previews cannot use the isitwet.today host, so the wet site is at
`https://deploy-preview-<n>--isithotapp.netlify.app/wet` there; sending the header
`x-isitwet-host: 1` to a preview behaves as if the request came to isitwet.today (previews
only). After each production deploy, `.github/workflows/production-smoke.yml` checks the live
domains and the redirects between them.

Browsers keep storage and location permission per domain, so the sites do not share a saved
place or units. Links from one to another carry the chosen units in the address
(`units=c|f`); "Use my location" and a searched place also carry the place (`lat`, `lon`, and
`source=device` or `name`). The page there stores them. Nothing to set up. On previews and
locally all the sites are one origin, so this only shows on the real domains.

### willitsnow.today (the third site)

The same deploy serves it too: the edge function sends requests for willitsnow.today to the
`/snow` pages, which open on "Will it snow?". On any of the real domains, a path under another
site's prefix goes to that site (isithot.today/snow and isitwet.today/snow to willitsnow.today,
willitsnow.today/wet to isitwet.today). In the Netlify UI, **before the snow branch is merged**
(the production smoke test after that deploy checks the domain, its www and the redirects
between the sites):

1. **Domain management**: add `willitsnow.today` as a **domain alias** of the project (Carl has
   added it; check it is listed). `isithot.today` stays the **primary** domain.
2. Add `www.willitsnow.today` as another alias; the edge function sends it to the apex.
3. DNS: if the domain's DNS is not on Netlify, add the records Netlify shows for both names at
   the registrar.
4. **HTTPS**: the certificate must list `willitsnow.today` and `www.willitsnow.today` as well as
   the other sites' names. Use **Renew certificate** if they are missing, and check that
   https://willitsnow.today/ answers before merging.
5. Google Search Console: add the willitsnow.today property and submit
   `https://willitsnow.today/sitemap.xml` (section 7). Before ads go on, add willitsnow.today to
   AdSense's sites.

On deploy previews the snow site is at `https://deploy-preview-<n>--isithotapp.netlify.app/snow`,
and the header `x-willitsnow-host: 1` makes a preview act as willitsnow.today (previews only).
The preview smoke test checks both (`scripts/smoke.mjs --wet --snow --wind`).

### isitwindy.today (the fourth site)

The same deploy serves it as well: the edge function sends requests for isitwindy.today to the
`/wind` pages, which open on "Is it windy?". A path under another site's prefix goes to that
site, as for the others (isithot.today/wind to isitwindy.today, isitwindy.today/snow to
willitsnow.today). In the Netlify UI, **before the wind branch is merged** (the production smoke
test after that deploy checks the domain, its www and the redirects between the sites, and fails
until they answer):

1. **Domain management**: add `isitwindy.today` as a **domain alias** of the project.
   `isithot.today` stays the **primary** domain.
2. Add `www.isitwindy.today` as another alias; the edge function sends it to the apex.
3. DNS: if the domain's DNS is not on Netlify, add the records Netlify shows for both names at
   the registrar (where Carl bought it).
4. **HTTPS**: the certificate must list `isitwindy.today` and `www.isitwindy.today` as well as
   the other sites' names. Use **Renew certificate** if they are missing, and check that
   https://isitwindy.today/ and https://www.isitwindy.today/ answer before merging.
5. Google Search Console: add the isitwindy.today property and submit
   `https://isitwindy.today/sitemap.xml` (section 7). Before ads go on, add isitwindy.today to
   AdSense's sites.

On deploy previews the wind site is at `https://deploy-preview-<n>--isithotapp.netlify.app/wind`,
and the header `x-isitwindy-host: 1` makes a preview act as isitwindy.today (previews only).
Wind speeds have a units setting of their own (`windUnits=mph|kmh` in links between the sites,
alongside `units`): mph by default in the UK and US, km/h elsewhere.

## 4. Cloudflare Web Analytics (cookieless, free)

Works on any host, not only Cloudflare.

1. Cloudflare dashboard → **Analytics & Logs → Web Analytics → Add a site** → enter
   `isithot.today` and choose the JavaScript snippet option.
2. Copy the token from the snippet and set `PUBLIC_CF_BEACON_TOKEN` in Netlify, then redeploy.

## 5. Google AdSense and consent

1. Apply at https://adsense.google.com with `isithot.today` once the site is live on the
   domain with the legal pages published.
2. **Privacy & messaging → European regulations**: create a GDPR message for the UK and EEA
   using Google's certified CMP. Optionally add the US state regulations message for "Do Not
   Sell".
3. Create one **display ad unit** (responsive). Keep **Auto ads off**: the layout reserves one
   slot below the outbound links.
4. In Netlify set `PUBLIC_ADSENSE_CLIENT` (`ca-pub-…`), `PUBLIC_ADSENSE_SLOT` (the unit's ID)
   and `PUBLIC_ADS_ENABLED=true`, then redeploy. `/ads.txt` is generated from the client ID.

Ads load after the page is interactive. They wait for the CMP's consent signal where GDPR
applies, and the slot's height is reserved so the page does not jump.

The apps' ads (C15, once the AdMob account is approved). The iPhone app's free version has three
ad units, and only the release candidate's build needs their IDs: every other build uses
Google's demo units, so nothing here holds up a TestFlight build with **ads** `test`.

1. In AdMob (https://admob.google.com), add the iOS app (not yet published) and create three ad
   units: a **Banner** for the band under the home screen's pages, a second **Banner** for the
   end of each page, and an **Interstitial** for the full-screen ad when a place is chosen. If
   you have already made the one banner C15 first asked for, it is the home screen's: add the
   other two. The page-end banner is a unit of its own, so AdMob reports the two apart.
2. On both banners, set the refresh rate to 60 seconds. On the interstitial, set a frequency cap
   of 1 impression per 5 minutes per user: the app already shows one at most every 5 minutes,
   and this is Google's own guard beside it. Set the app's maximum ad content rating to G (the
   app asks for G as well).
3. **Privacy & messaging**: create the European regulations message (UK and EEA) and publish it;
   it is the consent form the app shows. Add your iPhone as a test device.
4. In GitHub, **Settings → Secrets and variables → Actions → Variables** (the repository's
   variables, not the `testflight` environment's; none is a secret), add `ADMOB_APP_ID`
   (`ca-app-pub-…~…`), `ADMOB_BANNER_ID` (the home screen's banner), `ADMOB_PAGE_BANNER_ID` (the
   page-end banner) and `ADMOB_INTERSTITIAL_ID` (`ca-app-pub-…/…` each). An **iOS release** run
   with **ads** `real`, the release candidate, needs all four, and stops at once, naming them, if
   one is missing or malformed. With `test`, the archive check only makes sure your publisher
   ID appears nowhere in the app.
5. Once AdMob gives the publisher ID (`pub-…`), set `PUBLIC_ADMOB_PUBLISHER_ID` in Netlify and
   redeploy. `/app-ads.txt` on every domain then carries its line (until then, a comment). AdMob
   reads it from the developer website each app's store listing names, so each app lists its
   own site.
6. Once the app is live on the App Store, in AdMob open **Apps → App settings** and link the app
   to its App Store listing. Until then AdMob can't find the listing's developer website, so it
   can't check `app-ads.txt`, and the app's ads aren't fully served. Then check under
   **app-ads.txt** that willitsnow.today's file shows as verified.

The apps' notifications: Apple push keys, done on 23 October. Two team-scoped APNs keys (one
Sandbox, one Production) from Certificates, IDs & Profiles → Keys. In Netlify (scope
**Functions**), `APNS_TEAM_ID`, `APNS_KEY_ID_SANDBOX`, `APNS_KEY_SANDBOX`,
`APNS_KEY_ID_PRODUCTION` and `APNS_KEY_PRODUCTION`, the two key texts marked as secret. The three
sandbox values are also secrets in the GitHub environment `apns-smoke` (main only), for the daily
smoke (`alerts-smoke.yml`). To check a function can reach Apple: set `ALERTS_SMOKE=1` for the
**Deploy Previews** context only, open a deploy preview's Functions page, choose `alerts-run` and
press **Run now**; its log should read `alerts-run: smoke passed: 400 BadDeviceToken…`.

The app's listing in App Store Connect names two pages on the snow site's own domain: the
**Support URL** https://willitsnow.today/support (on the version's page) and the **Privacy Policy
URL** https://willitsnow.today/privacy (App Privacy). Every site serves both (`/support` and
`/privacy`), every copy of `/support` is canonical on willitsnow.today, and the production smoke
test checks `/support` on all four. The support page gives support@willitsnow.today and no postal
address; App Review's contact (name, phone and that address) is entered separately.

### The apps' notifications: switching them on

The run (`alerts-run`, every 15 minutes) is off until `ALERTS_ENABLED` is `true`. Every switch is
an environment variable in Netlify (**Site configuration → Environment variables**), scope
**Functions**, and takes effect only after a redeploy (**Deploys → Trigger deploy → Deploy
site**). Three rules hold whatever the switches say:

- **Nothing reaches a phone unless `ALERTS_DRY_RUN` is `false`.** Unset (or anything else) means a
  dry run everywhere: the run and the app's **Send a test notification** only log what they would
  send.
- **Only production's run sends.** A preview's run is always dry. A test send follows
  `ALERTS_DRY_RUN` in every context, so a preview can check the whole path to Apple with a
  made-up device (below).
- **Nothing is sent from 9pm to 7am at the place,** test sends included: a test pressed then
  answers that nothing is sent at night there, and costs none of the hour's three.

The run's log is at **Logs → Functions → alerts-run**, a test's at **Logs → Functions →
devices-test**. The run logs one summary line a run, after any lines about single registrations:

```
alerts-run: zones 0, records 0, groups 0, fetches 0, sent 0, deleted 0, errors 0; dry run, 0 logged; 140 ms
```

`errors` should be 0. A line starting `alerts-run: error:`, `alerts: error:` or `devices: error:`
says what went wrong: tell me. Nothing in the logs is a device token, a key or a place's
coordinates.

**First, on a deploy preview, with a made-up device (section 8.7 item 4).** This checks the
whole server side before anything is switched on in production. It uses a made-up device token,
64 `a`s, whose id starts `19fbad5f15a7`; Apple refuses it, so nothing reaches a phone. A deploy
preview's store is new with every deploy, so the settings go in before the preview is built.

1. For the **Deploy Previews** context only, set `ALERTS_ENABLED` = `true`, `ALERTS_FORCE_IDS` =
   `19fbad5f15a7` and `ALERTS_DRY_RUN` = `false` (on a preview that lets only the test send reach
   Apple; the run stays dry). Then open a pull request (or push to one) so a preview builds with
   them.
2. Register the made-up token on that preview at a place where it is now between 18:00 and
   19:59, or 07:00 and 08:59: `london-gb` at 6 to 8pm UK time, `tokyo-jp` at 9 to 11am UK time
   in winter, or `new-york-city-us` at 12 to 2pm UK time in winter. From a terminal (or any app
   that sends a PUT), with the preview's address and the place:

   ```
   curl -X PUT https://deploy-preview-NN--SITE.netlify.app/api/v1/devices \
     -H 'content-type: application/json' \
     -d '{"app":"snow","platform":"ios","env":"sandbox","token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","place":{"place":"tokyo-jp"},"units":"c","alerts":{"snow":{"evening":true,"morning":true,"possible":false}},"appVersion":"preview check"}'
   ```

   It answers with the id, the place and its time zone. In the preview's Blobs store
   `isithot-alerts` (the deploy's own, never production's), the record should be in one folder
   per zone, `reg/v1/Asia~Tokyo/`.

3. On the preview's **Functions** page, choose `alerts-run` and press **Run now**. A preview's
   run is always dry, so the log shows the notification instead of sending it:

   ```
   alerts-run: ALERTS_DRY_RUN is ignored on deploy-preview: only production sends
   alerts: dry run: snow.19fbad5f… sandbox evening 2026-11-05: Test notification / Notifications are working. We'll tell you when snow is likely in Tokyo.
   alerts-run: zones 1, records 1, groups 1, fetches 1, sent 0, deleted 0, errors 0; dry run, 1 logged; 1 forced; 900 ms
   ```

   (or the real notification, if snow is likely there). **Run now** again in the same window logs
   `zones 0`: the place is done for that window.

4. Now Apple's half, in the same window: send a test notification to the made-up device.

   ```
   curl -X POST https://deploy-preview-NN--SITE.netlify.app/api/v1/devices/test \
     -H 'content-type: application/json' \
     -d '{"app":"snow","token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
   ```

   It goes through the same sender as the run, to Apple's sandbox, which refuses the made-up
   device. The answer is `404 not_registered` ("Apple refused this device, so it is no longer
   registered."), the `devices-test` log has
   `alerts: deleted snow.19fbad5f… (400 BadDeviceToken, sandbox, app preview check)`, and the
   record is gone from the store. That proves Netlify reaches Apple, the key, the provider token
   and the deletion.

5. Delete the three settings from Deploy Previews again.

**Then the rollout:**

1. **Once the full run is merged (by Fri 30 Oct): dry, in production.** First check that Netlify
   asks for your approval before it builds a pull request from outside the team (section 1).
   Then add `ALERTS_ENABLED` = `true` (all contexts, or Production only). Leave `ALERTS_DRY_RUN`
   unset: production then logs each notification instead of sending it, and so does a test send.
   Redeploy, then check the log shows the line above every 15 minutes, saying `dry run`, with
   `errors 0`. Until the app registers, `zones` stays 0.
2. **From the first build with notifications on your phone (TestFlight, target Wed 4 Nov): on,
   for real.** In that build, Settings → Notifications, turn on **Evening before (about 6pm)** and
   allow notifications, then **Send a test notification**: until you've done the rest of this step
   it says **Our server isn't sending notifications yet, so nothing was sent.** Settings → **Your
   privacy** shows **ID** and its first 8 characters: that is enough for `ALERTS_FORCE_IDS`. In
   Netlify, for the **Production** context only, set `ALERTS_DRY_RUN` = `false` and
   `ALERTS_FORCE_IDS` = your id (or its first 8 characters or more; several ids go
   comma-separated). Redeploy. **Send a test notification** now arrives within seconds (between
   7am and 9pm at your notifications' place). Your phone also gets one notification at about 6pm
   and one at about 7am at your place, for each switch you have on: the real one when snow is
   likely, otherwise "Test notification". The log line says `sent 1` and `1 forced` for those
   runs. Everyone else (TestFlight testers) gets only real notifications, when snow is likely.

   **Done on Sun 8 Nov.** All three are set in **Production** and the site was redeployed; a test
   arrives within seconds. Netlify refused the **Functions** scope when they were set through its
   API (403), so they apply to all scopes. They are switches and an id prefix, not secrets, so
   nothing else changes.

   **Mon 9 Nov: no 6pm notification.** The test arrived, but the 6pm one didn't: the run logged
   `zones 1, records 0`. Netlify had split each registration's key at the zone's `/`, so the run
   found no registrations (DECISIONS, "Zone keys Netlify can't split"). Merge the pull request
   "Notifications: zone keys Netlify can't split". Netlify deploys it by itself; there is nothing
   to set and no redeploy to start. From the next run (within 15 minutes), your phone gets a
   notification at about 6pm and about 7am for each place with notifications on, as above, and
   those runs' lines say `forced`. **Send a test notification** keeps working throughout. Once a
   day, at 03:00 UTC, the cleanup's line adds `; N registrations under old keys` until every phone
   has registered again (when a setting or place changes, and at least weekly while the app is
   used).

   **Then, once that test has arrived (Wed 4 Nov): the server for several places, 10 minutes.**
   Merge the pull request "Notifications for several places on one phone (server)". Netlify
   deploys it by itself: there is nothing to set and no redeploy to start. At the next quarter
   hour, **Logs → Functions → alerts-run** shows the run's line with `errors 0`. Then, in the 8.1
   TestFlight build, Settings → Notifications → **Send a test notification** (between 7am and 9pm
   at your notifications' place): it still arrives within seconds. Nothing else changes on your
   phone. If either check shows something else, tell me what it said. Until an app build that uses
   the new server is out, the previous deploy can be put back without harm: **Deploys**, choose
   the one before, **Publish deploy**.

3. **By Thu 12 Nov:** it is already fully on. Press **Send a test notification** in the current
   TestFlight build; it must arrive before submission. The review note says when nothing is sent
   (it is in "Saved places' notifications (phase 8.4b)", below, one note for the purchase and
   notifications together).
4. **Release day:** delete `ALERTS_FORCE_IDS` and redeploy. The log line no longer says
   `forced`.

To switch the run off at once, set `ALERTS_ENABLED` to `false` and redeploy: each run then logs
`alerts-run: disabled (production, ALERTS_ENABLED is not true)` and does nothing else.
Registrations are still kept, so they are there when it is switched on again; to stop test sends
too, delete `ALERTS_DRY_RUN` (a dry run).

**Optional, once production sends: the run's own path to Apple.** Register the made-up token on
production (`https://willitsnow.today/api/v1/devices`, the same body), add `19fbad5f15a7` to
`ALERTS_FORCE_IDS` after your id (comma-separated) and redeploy. The next run in that place's
window (the next day's, if the place was already done for this one) logs
`alerts: deleted snow.19fbad5f… (400 BadDeviceToken, sandbox, app preview check)`. Then take
`19fbad5f15a7` out of `ALERTS_FORCE_IDS` again.

**Checking the words without Netlify:** `pnpm tsx scripts/alerts-dry-run.ts --now
2026-10-18T18:05:00Z` registers every city page's place in °C and °F on synthetic forecasts and
prints each notification the run would send at that moment. At that moment it prints the Durham
example: "Snow likely in Durham tomorrow" / "1 to 2cm of snow. Mostly between 2am and 6am. 5 of 6
forecasts expect snow."

### The app's notifications (phases 8.1 and 8.2)

The iPhone app's side of the notifications: Settings → Notifications, the card on the Today page,
and Your privacy's "What we keep for notifications" with its delete button. It continues the
rollout above. Already done and needed as they are: the two Apple push keys in Netlify (above),
the App ID `today.willitsnow.app` with Push Notifications and App Groups (C8), and the app's
record in App Store Connect (C9). Nothing here needs a certificate (the server signs with the
keys), a profile made by hand, or anything in GitHub.

1. **Apple Developer portal, before the first build with notifications (2 minutes).**
   Certificates, Identifiers & Profiles → **Identifiers** → `today.willitsnow.app`: Push
   Notifications should be ticked. It says "Configured" with no certificates, which is right for
   push keys. While you are there, `today.willitsnow.app.widgets` should have App Groups
   (`group.today.willitsnow.app`) and nothing else ticked. Then **Profiles**: if there is a profile
   for `today.willitsnow.app` that you made by hand before Push Notifications was ticked, delete
   it, as it lacks the push permission; Xcode's and CI's automatic signing make their own, which
   carry it. If there are none, there is nothing to do.
2. **Netlify, by Fri 30 Oct:** rollout step 1 above (`ALERTS_ENABLED`, with `ALERTS_DRY_RUN` left
   unset), then redeploy. The `alerts-run` log line says `dry run` and `errors 0`.
3. **Optional, a Debug build from your Mac.** Run it on your iPhone, as a Debug build, never
   Release: a Release build run from Xcode registers for the wrong push environment, and the server
   deletes it at its first notification. Settings → Notifications → **Evening before (about 6pm)**
   → **Allow** → **Send a test notification**: while production is dry it says "Our server isn't
   sending notifications yet, so nothing was sent." To see a real delivery before C18, ask me for
   a deploy preview that sends, and point the Debug build at it: in Xcode, **Product → Scheme →
   Edit Scheme → Run → Arguments**, under Arguments Passed On Launch add `-apiOrigin` and the
   preview's address (`-apiOrigin https://deploy-preview-<n>--isithotapp.netlify.app`), then run
   again. Only a Debug build reads it; untick it afterwards. The Push Notifications Console
   (developer.apple.com → Push Notifications Console → Delivery Log) then shows the delivery.
4. **The first TestFlight build with notifications (target Wed 4 Nov, M4).** Install it, then
   Settings → Notifications → turn on **Evening before (about 6pm)** → **Allow**. **Send a test
   notification**: it says "Our server isn't sending notifications yet, so nothing was sent."
   Then Settings → **Your privacy**: the first line under "What we keep for notifications" is
   **ID** and 8 characters. Send me those 8 characters.
5. **C18 (Wed 4 Nov, 10 minutes; done on Sun 8 Nov):** rollout step 2 above, in Netlify's
   **Production** context only (`ALERTS_DRY_RUN` = `false`, and `ALERTS_FORCE_IDS` = your 8
   characters), then redeploy. Send a test again, between 7am and 9pm at your notifications'
   place: it arrives within seconds, and the `devices-test` log says `test sent`.
6. **The checks on your phone (C19)**, each with that TestFlight build. If one shows something
   else, tell me what it said, with a screenshot.
   - **The prompt** appears once, at the first switch you turn on, never when the app opens. On a
     fresh install (delete the app and install it again) the Today card's **Turn on** asks the
     same way.
   - **A test arrives**, and a tap on it opens that place's middle page (Today, or Tomorrow after
     6pm).
   - **The cold start:** press **Send a test notification**, at once swipe the app away in the app
     switcher, wait for the banner and tap it. The app should open on the place. If it opens on
     the home screen only, tell me: it is the open question in apps/ios/README.md's "Settled"
     (8.1), and its fix is ready to write. **Done on Sun 8 Nov:** it opened on the place.
   - **The app in front:** with the app open on another place, a test shows a banner over the app,
     and the page refreshes.
   - **iOS Settings' link:** iOS Settings → will it snow? → Notifications → **Notification
     Settings** (the link at the foot) opens the app's own Settings at Notifications.
   - **Off in iOS Settings:** turn the app's notifications off there, then open the app again.
     Settings says "Notifications are off for this app in Settings.", Your privacy shows nothing
     kept for notifications, and the log says `devices: deleted`.
   - **Your location:** Settings → Notifications → **Where you are** → **Use my location**, then
     allow location. The row says "Your location", and Your privacy's "Where you are" line names
     your area. (Builds from 8.4a on; 8.1's build calls the row **Place**.)
   - **Where you are in the UK** shows **Met Office warnings** at the foot of Notifications, which
     opens Safari.
   - **Delete:** Your privacy → **Turn off notifications and delete my data** says "Notifications
     are off. We've deleted your notification token, places, units and choices." (8.1's build says
     "place"), and the log says `devices: deleted`.
   - **Quiet hours:** from 9pm to 7am on your iPhone, the test says "Nothing is sent from 9pm to
     7am. Try again after 7am." (Builds from 8.4b on judge it by your iPhone's clock; 8.1's build
     says "at the place" and judges it there.)
7. **App Store Connect (C22, by Fri 13 Nov).**
   - **App Privacy:** under Identifiers, **Device ID** gets the purpose **App Functionality** (the
     push token): linked to the user, not used for tracking, beside Coarse Location. If Device ID
     is already there for Google's ads (Third-Party Advertising), tick App Functionality on that
     same entry: App Store Connect keeps one entry for each kind of data, with its purposes
     ticked, so Device ID is then linked overall.
   - **Review notes:** one note for the purchase and notifications together, which replaces the
     notifications paragraph that was here, the purchase's and the widgets': it is in "Saved
     places' notifications (phase 8.4b)", below, step 6.

8. **C20 (Thu 12 Nov):** rollout step 3 above. Notifications are already fully on since C18
   (`ALERTS_ENABLED` = `true` and `ALERTS_DRY_RUN` = `false` in Production), so there is nothing to
   set or redeploy. Send a test from the release candidate before you submit: it must arrive, as
   App Review's will only arrive with the production push key in place.
9. **Release day (C25):** rollout step 4 above: delete `ALERTS_FORCE_IDS`, then redeploy.

### Where you are (phase 8.4a)

From phase 8.4a, the app's notification is for **where you are**: your phone's location if you
share it with the app, otherwise a rough place our server works out from your internet connection.
There is no place to choose any more. It needs the server change merged first (rollout step 2
above, "the server for several places", Wed 4 Nov). Nothing in Netlify or App Store Connect
changes.

The new build keeps its notification settings under new names, so it can't see or delete what the
8.1 build registered. Done in this order, nothing is left notifying your phone from the old build.

1. **Fri 6 Nov, before you merge 8.4a (2 minutes).** On your phone, in the TestFlight build you
   have now (8.1's): Settings → **Your privacy** → **Turn off notifications and delete my data**.
   It should say "Notifications are off. We've deleted your notification token, place, units and
   choices." If it says it couldn't reach our server, try again with a connection. Do this before
   you install any newer build.
2. **Merge 8.4a** ("Notifications where you are (phase 8.4a)") once its checks are green. There is
   nothing to set in Netlify for it.
3. **The next TestFlight build:** GitHub → Actions → **iOS release** → **Run workflow** →
   `testflight` → approve the `testflight` environment when asked, then wait for TestFlight to show
   the build (Apple's processing can take an hour). **Delete the app from your phone**, then
   install the build from TestFlight, so it starts as a first install: the card comes back, and
   the app hasn't asked for your location.
4. **The checks (about 15 minutes, between 7am and 9pm UK time).** If one shows something else,
   tell me what it said, with a screenshot.
   - **Approximate.** Open the app, and don't tap anything that uses your location yet. The card
     on the middle page (Today, or Tomorrow after 6pm) says "Get a notification the evening
     before snow is likely where you are.", with a line beneath about a rough place from your
     internet connection. Tap **Turn on**, then **Allow**. The card says "Done. …" and, a moment
     later, "…likely near" your town. No location prompt appears.
   - Settings → Notifications → **Where you are** shows your town and "Approximate, from your
     internet connection". Settings → **Your privacy** shows "Where you are: <your town>,
     Europe/London".
   - **Your ID.** Your privacy's first line is **ID** and 8 characters. A new install can have a
     new ID: if they differ from the ones in `ALERTS_FORCE_IDS` (Netlify, **Production** context),
     put the new ones there in their place and redeploy (rollout step 2 above). **Send a test
     notification**: it arrives within seconds.
   - **Your location.** Settings → Notifications → **Where you are** → **Use my location** →
     **Allow While Using App**. The page goes back to Settings by itself, and the row says "Your
     location" with your town.
   - **Back to approximate.** iOS Settings → Privacy & Security → Location Services → will it
     snow? → **Never**, then open the app again. Settings → Notifications → **Where you are** says
     "Approximate, from your internet connection" again.
   - **A town on another network.** If you can, open the app once on mobile data with Wi-Fi off,
     and once on Wi-Fi, an hour or more apart: the town may change with the connection. Tell me if
     either is far from where you are.

### Saved places' notifications (phase 8.4b)

From phase 8.4b, each saved place has a bell beside its star. With the one-off purchase, the bell
turns on notifications for that place, the evening before and on the day, as for where you are.
Without it, the bell has a small lock and opens the purchase. The purchase is renamed **No ads,
widgets and more** to say so. Notifications for where you are stay free. Version 1.0 waits for
this phase. Nothing in Netlify changes: the server for several places is already merged.

1. **Merge 8.4b** ("Notifications for saved places (phase 8.4b)") once its checks are green
   (target Tue 10 Nov). There is nothing to set in Netlify for it.
2. **App Store Connect, the purchase's words (5 minutes).** **Apps** → **willitsnow.today** →
   under **Monetization**, **In-App Purchases** → **Snow unlock** → **App Store Localization**,
   English (U.K.):
   - **Display Name:** No ads, widgets and more
   - **Description:** No ads, widgets and saved-place notifications

   Type them exactly, with no full stop: the app and its tests use the same words. Press **Save**.
   If the purchase's status says **Ready for Review**, it has been added to the 1.0 draft and the
   words are locked: on the 1.0 page, remove Snow unlock from **In-App Purchases and
   Subscriptions**, change the words, then add it back. While it says **Prepare for Submission**,
   the words can be changed straight away. TestFlight shows the new name within about an hour.

3. **The review screenshot.** On GitHub open **Actions**, then **iOS** on the left, then the latest
   run on `main` with 8.4b in it, and under **Artifacts** download **ios-attachments**. The
   screenshot is `review/app-upgrade.png`: the upgrade sheet with its three lines (no ads, widgets,
   notifications for saved places). In App Store Connect, **Snow unlock** → **Review Information**
   → **Screenshot**: upload it in the old one's place, then **Save**.
4. **A TestFlight build:** GitHub → **Actions** → **iOS release** → **Run workflow** → `testflight`
   → approve the `testflight` environment when asked, then wait for TestFlight to show the build
   (Apple's processing can take an hour).
5. **The checks (about 30 minutes, beside C19, on Tue 10 Nov or Wed 11 Nov, between 7am and 7pm
   UK time).** If one shows something else, tell me what it said, with a screenshot.
   - **The locked bell.** You bought the purchase in an earlier build, so on your own Apple
     Account the bell is already unlocked. To see the lock and buy from the bell, use the Sandbox
     tester (below, "The app's purchase", step 6) and clear its purchase history first; otherwise
     go on to the next check. Tap the place name at the top, search **Rovaniemi** and tap the
     star: a bell with a small lock appears beside it. Tap the bell: the purchase page opens over
     the search screen. **Buy** (TestFlight buys in Apple's test environment, so nothing is
     charged), then close the page: the bell fills by itself, and the search screen is still open.
   - **With the purchase.** Search **Rovaniemi**, tap the star, then the bell. If you have never
     allowed notifications for this build, **Allow**. The bell fills. If every notification was
     off, "Evening before (about 6pm)" comes on with it, for where you are too.
   - **Settings → Notifications** shows **Saved places** with "1 on". Tap it: Settings closes and
     the search screen opens, with Rovaniemi's bell filled.
   - **Two tests.** Settings → **Send a test notification**: it says "Sent 2 test notifications.
     They should arrive in a few seconds.", and two arrive, in two stacks. Tapping Rovaniemi's
     opens Rovaniemi.
   - **Your privacy** lists "Rovaniemi, Europe/Helsinki" and "Your iPhone's time zone:
     Europe/London" under "Where you are". Now unstar Rovaniemi (VoiceOver, if it is on, says
     "Rovaniemi removed from saved places. Its notifications are off."). After a minute, Your
     privacy no longer lists Rovaniemi or your iPhone's time zone.
   - **Delete:** Your privacy → **Turn off notifications and delete my data** says
     "Notifications are off. We've deleted your notification token, places, units and choices."
   - **The purchase's words.** Settings shows "Thank you. Ads are off, widgets are on and you can
     turn on notifications for saved places."
   - **Optional, the night.** A saved place's notification between 9pm and 7am on your iPhone
     arrives without a sound, straight into Notification Centre. You will only see this if snow is
     likely at a saved place in the evening or the morning there while it is night here, so
     skipping it is fine.
6. **By Fri 13 Nov (C22): the review note, the listing and one decision.**
   - **The review note:** paste this into **Snow unlock** → **Review Information** → **Review
     Notes**, and into the 1.0 version's **App Review Information** → **Notes**. It replaces the
     purchase's note (step 3 of "The app's purchase"), the widgets' (step 4 of "The app's widgets")
     and the notifications' (step 7 of "The app's notifications"):

     > Notifications are optional and off by default; the app works fully without them. The free
     > notification is for where you are: your location if you share it, otherwise an approximate
     > place from your internet connection. To try it, tap the gear (Settings), then turn on
     > "Evening before (about 6pm)", allow notifications, and tap "Send a test notification". It
     > arrives within a minute.
     >
     > The purchase, No ads, widgets and more (£1.99, non-consumable, Family Sharing), unlocks
     > three things: no ads, the Snow forecast widget for the home screen and lock screen, and
     > notifications for saved places. To buy it, tap the gear, then No ads, widgets and more, then
     > Buy; it is also the row at the end of the middle page. To try saved-place notifications,
     > tap the place name at the top, search for a town (for example Denver), tap the star beside
     > it, then the bell beside the star. Before the purchase the bell opens the purchase page;
     > after buying there, the bell turns on. "Send a test notification" in Settings then sends two
     > tests: one for where you are and one for the saved place. Restore purchase is in Settings.
     > If the App Store doesn't answer, Settings still shows the purchase without a price, and its
     > page says it isn't available right now.
     >
     > Tests aren't sent from 9pm to 7am on your iPhone, and at most three times an hour. Real
     > notifications are sent only when snow is likely at a place: about 6pm the evening before and
     > about 7am on the day, at the place's time; from 9pm to 7am on your iPhone, those for saved
     > places arrive silently. Tapping one opens that place's forecast. Notifications never carry
     > promotions. Settings, then Your privacy, shows what we keep, and "Turn off notifications and
     > delete my data" removes it.

   - **The listing** (the version's page, with the rest of C22). Replace whole blocks:
     - **Promotional text:** where it says "where you choose", the sentence becomes "Plus a
       notification the evening before snow is likely where you are."
     - **Description, the Notifications part,** becomes:

       > Notifications
       > • The evening before: about 6pm, when snow is likely tomorrow.
       > • On the day: about 7am, when snow is likely today.
       > • Free for where you are, using your location or a rough place from your internet
       > connection. Only when most forecasts expect snow, unless you also ask about days when
       > snow is possible.
       > • With the one-off purchase, the same for up to 10 saved places, such as somewhere you're
       > going.

     - **Description, the paragraph after Widgets,** becomes: "Free, with ads. A one-off purchase
       removes the ads, adds the widgets and adds notifications for up to 10 saved places, the
       evening before and on the day. Everything else, including notifications for where you are,
       is free. No account needed." (App Review 2.3.2: the listing must say what the purchase
       adds.)
   - **The decision, by Fri 13 Nov: made-up registrations.** The server takes notifications for
     where you are and up to 10 saved places from any phone, trusting the app's purchase check, as
     the ads and widgets already do. Someone could send made-up registrations and fill a time
     zone's notification run; the server's limits slow that down but don't stop it. The choice:
     add Apple's App Attest or DeviceCheck before launch (about two days' work, and the release
     moves), or launch with the limits and decide again for 1.0.1 once there are numbers (step 8).
     I recommend the second. Tell me which.
7. **App Privacy:** nothing new. Coarse Location and Device ID are already there from earlier
   steps.
8. **Each month after launch (5 minutes).** Netlify → **Logs** → **Functions** → `alerts-run`:
   once a day its line says `alerts-run: cleanup: <n> devices with saved places`. App Store
   Connect → **Sales and Trends**: the units of Snow unlock so far. One purchase covers up to six
   devices with Family Sharing, so if the devices are more than 6 × the units + 10, tell me: the
   next step is for the server to check the purchase itself.

### The app's purchase (C2, C9, C16)

The iPhone app sells one thing, once: **No ads, widgets and more**, £1.99 ("Remove ads and add
widgets" until phase 8.4b). It takes every ad away straight after the purchase, from phase 7.2 it
turns the widgets on, and from phase 8.4b it unlocks notifications for saved places. You have made the purchase
in App Store Connect (C9); these steps check it, finish it, send it to review with the app and try
it on your phone. StoreKit needs nothing in GitHub or Netlify: no secret and no variable.

1. **The agreement (C2).** In App Store Connect, open **Business**, then **Agreements**. The
   **Paid Apps Agreement** must say **Active**, with its tax and banking information complete.
   Until it is Active the App Store sells nothing to the app, not even in TestFlight: the app
   shows no price, Settings' "No ads, widgets and more" opens a page that says "The purchase
   isn't available right now. Try again later.", and Restore purchase still shows. If it isn't
   Active by **Mon 2 Nov**, tell me: I'll build a switch that can leave the purchase and the
   widgets out. Version 1.0 goes without them only if the agreement is still not Active on
   **Fri 13 Nov** (spec section 23.5).

2. **The purchase (C9).** Open **Apps**, then **willitsnow.today**, then under **Monetization**
   **In-App Purchases**, then **Snow unlock**. Check each field against this list, which is what
   the app and its tests sell (`apps/ios/Apps/Snow/StoreKit/Snow.storekit`, made from
   `packages/mobile/src/purchase.ts`):
   - **Type:** Non-Consumable.
   - **Reference Name:** Snow unlock.
   - **Product ID:** `today.willitsnow.app.unlock`. It can never be changed.
   - **Price Schedule:** £1.99, with the United Kingdom as the base country or region, and every
     other one priced from it.
   - **Availability:** every country or region the app is in: all but mainland China (Q11).
   - **App Store Localization**, English (U.K.): **Display Name** "No ads, widgets and more",
     and **Description** "No ads, widgets and saved-place notifications" (exactly, with no full
     stop: the app's tests hold the same words). These are phase 8.4b's words; until it is merged
     the app and its tests still say "Remove ads and add widgets" and "No ads, plus home and lock
     screen widgets" ("Saved places' notifications (phase 8.4b)", above, step 2).
   - **Family Sharing:** turned on (**Turn On**, if it isn't yet). Once on it can't be turned off,
     which is what you chose (Q4).

   If App Store Connect says something different, change it there to match, or tell me if you
   think App Store Connect is the one that is right.

3. **Review Information**, further down the same page:
   - **Screenshot:** the upgrade sheet with its price, which the app's tests take (since phase
     8.4b, with its three lines: take it from a run with 8.4b in it, "Saved places'
     notifications (phase 8.4b)", above, step 3). On GitHub open **Actions**, then **iOS** on the
     left, then the latest run on `main`, and under **Artifacts** download **ios-attachments**. The screenshot is
     `review/app-upgrade.png` in it (not one from the `UI` folder, whose files are named by
     codes): 1206 × 2622 pixels, the whole iPhone 17 screen. Upload that. When phase 7.3 makes a
     new one, with the widgets on the sheet, upload it in this one's place. GitHub keeps artefacts
     for 5 days, and runs happen only when the app's files change: if it has gone, open that run,
     press **Re-run all jobs**, and take it from the run that makes.
   - **Review Notes:** the note for the purchase and notifications together, in "Saved places'
     notifications (phase 8.4b)", above, step 6. It replaces the note that was here, which named
     only the ads and the widgets.

   Press **Save**. The purchase's status is then **Prepare for Submission**: it has all it needs,
   and isn't in a submission yet.

4. **With version 1.0 (C24).** A first in-app purchase goes to App Review with a version of the
   app, never on its own. On the version's page (**Apps**, **willitsnow.today**, then **1.0**
   under **iOS App**), find **In-App Purchases and Subscriptions**, add **Snow unlock** there,
   then submit the version as usual (spec section 21.4). App Review then sees the two together.
   Once added, its status is **Ready for Review**, and its name and description can't be changed
   until it is taken out of the draft again, so type 8.4b's words first.

5. **On your iPhone, from TestFlight**, once a build with 7.1 in it has reached you:
   1. Open the app, tap the gear, then **No ads, widgets and more · £1.99** (**Remove ads and add
      widgets · £1.99** in a build before 8.4b), then **Buy for £1.99**, and confirm on Apple's
      own sheet. A TestFlight build buys in Apple's test
      environment with your own Apple Account, so nothing is charged and you need no Sandbox
      tester, unless you want to buy again (step 6). The ads go at once: the band under the
      pages, the ad at the end of each page, and no more full-screen ads. The page and Settings
      then say "Thank you. Ads are off, widgets are on and you can turn on notifications for saved
      places." ("Thank you. Ads are off and widgets are on." before 8.4b).
   2. If there is no price, and the page says the purchase isn't available right now, the App
      Store has nothing to sell the app yet. Check that the agreement is Active (step 1), and
      that the purchase has its price and its English (U.K.) name (step 2); it doesn't need to be
      Ready to Submit for TestFlight. A change in App Store Connect can take up to an hour to
      reach TestFlight, so try again later.
   3. Delete the app, install it again from TestFlight and open it. It should come back as the
      paid version by itself, as Apple remembers the purchase. Open Settings and tap **Restore
      purchase** anyway: it should say "Purchase restored."
   4. From phase 7.2 the widgets are locked until the purchase, so TestFlight can go to external
      testers (Q6).

   If any step shows something else, tell me what it said, with a screenshot.

6. **A Sandbox tester (C16) is optional.** You need one only to buy again on the same phone: a
   purchase your own Apple Account makes in TestFlight can't be undone, and deleting the app only
   restores it. Apple's "Clear Purchase History" works for a Sandbox Apple Account only.
   1. **Make the tester:** **Users and Access → Sandbox → Test Accounts**, then **+**, with an
      email address that isn't an Apple Account already.
   2. **Install from TestFlight** as usual, signed in with your own Apple Account (TestFlight
      needs it to download).
   3. **Sign out of purchases only:** Settings → your name → **Media & Purchases → Sign Out**.
      iCloud stays signed in.
   4. **Sign in to the tester:** Settings → **Developer**, then at the foot **Sandbox Apple
      Account → Sign In**. Developer appears only with Developer Mode on (Settings → Privacy &
      Security → **Developer Mode**), and that switch appears once the iPhone has been connected
      to a Mac with Xcode.
   5. **Buy in the app.** The purchase is now the tester's.
   6. **To buy again:** Settings → Developer → the Sandbox Apple Account → **Manage → Clear
      Purchase History** (or the tester's page in App Store Connect), then sign out of the
      tester and back in.

   While you're signed out of Media & Purchases, purchased content in other apps on that phone
   may not work, so a spare phone is safest. Signing back in to Media & Purchases moves
   TestFlight's purchases back to your own Apple Account. Some developers report that a purchase
   made before the switch stays with the app; if Settings still says "Thank you" after step 4,
   delete the app and install it again before buying (Apple, "Testing In-App Purchases with
   sandbox", "Sign in to your Sandbox Apple Account for a TestFlight app"). A build you run from
   Xcode sells from Snow.storekit instead, which needs no account (apps/ios/README.md, "Phase
   7.1: the purchase", "Trying it"). Refunds, Ask to Buy and a purchase taken back are already
   tested on CI (the StoreKit tests).

### The app's widgets (phase 7.2)

The widget, **Snow forecast**, comes with the purchase: a small and a medium one for the Home
Screen, and a round, a rectangular and an inline one for the Lock Screen. No new secret, variable,
capability, identifier or profile is needed anywhere; in App Store Connect only the review note and
the listing's description change (step 4). The widget's App ID with its App Group (C8) and the purchase (C9)
already exist, and the release job's cloud signing makes the widget's profile as it does the app's.

1. **Check the widget's App ID once.** In the Apple Developer site, open **Certificates,
   Identifiers & Profiles**, then **Identifiers**, then `today.willitsnow.app.widgets`. **App
   Groups** should be ticked, and its **Configure** should show `group.today.willitsnow.app`.
   Nothing else should be ticked (no Push Notifications). Only if an archive's signing fails on the
   widget does anything more need doing here.

2. **TestFlight.** Once a build with 7.2 reaches you, the widgets are locked until the purchase,
   so the external group (Q6, if yes) can have it.

3. **On your iPhone, from TestFlight.** Open the app once first: a widget appears in the gallery
   only once its app has been opened since it was installed.
   1. **The gallery.** Touch and hold the Home Screen, tap **Edit**, then **Add Widget**, and
      search for "will it snow". It shows "Snow forecast", "Today's snow answer, then tomorrow's
      from 6pm." and the sample, small and medium: Durham, Tomorrow, Yes., Snow · 4cm and six
      dots. No price.
   2. **Small and medium.** Add both. If you haven't bought yet, each says "Open the app to turn
      on widgets." on the light palette, with no price. Tap one: the app opens on the purchase.
      Buy it, go back to the Home Screen, and within a few seconds both show answers (phase 7's
      exit). If you bought in 7.1's build, they show answers at once: your place, Today (Tomorrow
      after 6pm), the answer, the band with the amount or why not, and the dots; and on the
      medium's right half, Now (up to two lines), then as many of the week's days as fit below
      it, each row whole.
   3. **Taps.** The small opens the app on Today (Tomorrow after 6pm). The medium's right half
      opens This week, and its left half Today.
   4. **The Lock Screen.** Touch and hold the Lock Screen, tap **Customise**, and add the round
      one, the rectangular one and the one above the clock. Each shows today's or tomorrow's
      answer, and a tap opens the app.
   5. **It follows the app.** Choose another place, and change the units to inches. Back on the
      Home Screen, the widgets follow within a few seconds.
   6. **6pm.** Without opening the app, the widget says Tomorrow from 6pm.
   7. **StandBy.** Charge the iPhone on its side while it is locked, and add the widget to
      StandBy's stack: white on black, and red at night.
   8. **Appearance.** Touch and hold the Home Screen, tap **Edit**, then **Customise**, and try
      Dark, then Clear, then Tinted. It stays readable, and the glyph and the answer take the tint.
   9. **VoiceOver.** Each widget reads one sentence, such as "Durham. Tomorrow: Yes. Snow, 4cm. 6
      of 6 forecasts expect snow."; the medium's right half reads Now, then the days.
   10. **Larger Text** (**Settings → Accessibility → Display & Text Size → Larger Text**, at its
       largest) and **Bold Text**: still readable. The answer shrinks to fit. The medium shows
       fewer days, each one whole (usually none at the accessibility sizes), and its Now line
       wraps and shrinks, dropping the word "Now" above it before any of its own words.
   11. **Offline.** Aeroplane mode overnight: the widget keeps its hours, then says "No recent
       forecast. Open the app to refresh.", never an old hour.
   12. **A restart.** Restart the phone and leave it locked for a while. The Lock Screen widgets
       show grey shapes until you unlock, then answers within the hour, or at once when you open
       the app. Meanwhile one may say "Open the app to turn on widgets." or "No recent forecast.
       Open the app to refresh.": before the first unlock the widget can't read what the app
       keeps, and it waits rather than show another town.
   13. **Optional, V3** (only if you use your Mac): connect the iPhone, open Console.app, choose the
       iPhone, press **Start streaming**, and search for `subsystem:today.willitsnow.app.widgets`.
       Then remove a widget and add it again (or pull down on the app's page to refresh it, which
       reloads every widget). Each line says `unlock=` and `storekit=`. Tell me what `storekit=`
       said (`answered:1`, `answered:0` or `late`). The widget asks StoreKit every time, even though
       you have bought, so this works on your phone as it is. Any answer is fine, and so is skipping
       it.
   14. **Optional, a refund** (only with a Debug build run from Xcode on your iPhone,
       apps/ios/README.md, "Building on a Mac"): buy from Snow.storekit, add a widget, then
       refund the purchase in Xcode (**Debug → StoreKit → Manage Transactions**). The app locks,
       and within a few seconds the widgets say "Open the app to turn on widgets.". The StoreKit
       tests already cover refunds, so skipping it is fine.

   If anything shows something else, send me a screenshot and what it said.

4. **App Review** (with C22: the version's **App Review Information**, and the listing's files).
   The review note is the one for the purchase and notifications together ("Saved places'
   notifications (phase 8.4b)", above, step 6), which names the widget among what the purchase
   unlocks; it replaces the widgets' own note that was here. The App Store description must also
   say the widgets come with the purchase (App Review 2.3.2), as that step's listing does.

5. **Netlify:** nothing new. The weekly look at function invocations (C17) now includes the
   widgets' requests, besides the app's: for each widget on each phone, once every 4 hours while
   the server answers (six a day), and once an hour while it fails or has nothing usable. So a
   failing spell (429s or errors) shows up as more invocations, not fewer. If they climb while the
   server answers, changing `WIDGET.refreshHours` from 4 to 6 in packages/core cuts them by a third.

## 6. Uptime monitor

Any free monitor (UptimeRobot, Better Stack) on:

```
https://isithot.today/api/v1/today?place=london-gb&units=c
https://isitwet.today/in/london-gb
https://willitsnow.today/in/london-gb
https://isitwindy.today/in/london-gb
```

Alert on a non-200 response, or when the API body does not contain `"days"`.

## 7. Search Console and Bing

Once the four domains answer over HTTPS. Best after the paid Open-Meteo plan (section 2):
crawlers fetch every city page, and on the free plan's daily limit that can push the sites onto
stale answers. Each site's `robots.txt` already names its sitemap.

1. **Google Search Console** (https://search.google.com/search-console): add four **Domain**
   properties (not URL prefix, so `www` and `http` are covered too): `isithot.today`,
   `isitwet.today`, `willitsnow.today` and `isitwindy.today`. Each shows a
   `google-site-verification=…` TXT record: add it in Netlify (**Domains → the domain → DNS
   settings → Add new record**, type TXT, name `@`) or at the registrar, wait a few minutes and
   press **Verify**.
2. In each property, **Sitemaps**: submit `sitemap.xml`. Expect 303 URLs on isithot.today,
   isitwet.today and isitwindy.today, and 240 on willitsnow.today, which leaves out the 63 places
   where it never snows (DECISIONS.md, "Search engines").
3. **URL Inspection** → **Test live URL** on each site's home page and two city pages (say
   `/in/london-gb` and `/in/leeds-gb`), then **View tested page** → **Screenshot** and
   **HTML**. Home pages should show the introduction and Popular places, and no "00°" text;
   city pages the answer, "Updated …", the links to the other three sites and "All places".
   Then **Request indexing** for each home page.
4. **Bing Webmaster Tools** (https://www.bing.com/webmasters): sign in, choose **Import from
   Google Search Console**, and pick all four sites. It brings their sitemaps with them.

Each month, per site (about 15 minutes):

- **Pages** (indexing): a rising "Crawled – currently not indexed" count for `/in/` pages means
  Google finds city pages thin: tell me before adding cities. willitsnow.today's places where it
  never snows show as "Excluded by 'noindex' tag", as intended.
- **Performance**: filter to the UK and to queries with a place in them, to see which
  question-plus-place searches ("will it rain in Leeds today") bring visitors.
- **Manual actions** and **Security issues**: both should say none.
- **Core Web Vitals**, once ads are on, and **Links** (who links to the sites).
- Open-Meteo's usage page: crawlers count against the plan too.

## 8. Before launch

- **The App Store screenshots** (6.9-inch iPhone, 1320 × 2868): GitHub → **Actions** → **App
  Store screenshots** → **Run workflow** on `main`. In about 30 minutes the run's
  **app-store-screenshots** artefact holds seven, numbered in order: Today with snow, This week,
  Now, Tomorrow after 6pm, the picker with saved places and a bell on, Notifications and the
  purchase. Upload them under the version's **iPhone 6.9" Display** screenshots. The run's
  summary says if one is missing or the wrong size.
- Review the Privacy, Cookies and Terms drafts (the contact email is in) and the Support page.
  Take "Draft for review" off them before the app is submitted: its listing links Privacy and
  Support. **Done on Wed 11 Nov,** the day the app went to App Review: the three pages keep their
  "Last updated" dates.
- Decide on the items marked **Needs a decision** in [DECISIONS.md](DECISIONS.md).
- Try the place picker on a real iPhone and Android phone (open it, type, hide the keyboard,
  pick a result), and look at the Tomorrow tab with text at 200% (the word should break with a
  hyphen); both were checked in emulation only.
- Run the deploy preview smoke test (it runs on every pull request) and check Lighthouse.
