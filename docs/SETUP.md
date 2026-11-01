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
   per zone, `reg/v1/Asia%2FTokyo/`: that settles whether Netlify keeps `%2F` in a key.

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
   for real.** In that build, switch notifications on and open **Your privacy** for your
   registration's id. In Netlify, for the **Production** context only, set `ALERTS_DRY_RUN` =
   `false` and `ALERTS_FORCE_IDS` = your id (or its first 8 characters or more; several ids go
   comma-separated). Redeploy. **Send a test notification** now arrives within seconds (between
   7am and 9pm at your notifications' place). Your phone also gets one notification at about 6pm
   and one at about 7am at your place, for each switch you have on: the real one when snow is
   likely, otherwise "Test notification". The log line says `sent 1` and `1 forced` for those
   runs. Everyone else (TestFlight testers) gets only real notifications, when snow is likely.
3. **By Thu 12 Nov:** it is already fully on. Press **Send a test notification** in the current
   TestFlight build; it must arrive before submission. The review notes should say that nothing
   is sent from 9pm to 7am at the chosen place, test notifications included.
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

### The app's purchase (C2, C9, C16)

The iPhone app sells one thing, once: **Remove ads and add widgets**, £1.99. It takes every ad away
straight after the purchase, and from phase 7.2 it turns the widgets on. You have made the purchase
in App Store Connect (C9); these steps check it, finish it, send it to review with the app and try
it on your phone. StoreKit needs nothing in GitHub or Netlify: no secret and no variable.

1. **The agreement (C2).** In App Store Connect, open **Business**, then **Agreements**. The
   **Paid Apps Agreement** must say **Active**, with its tax and banking information complete.
   Until it is Active the App Store sells nothing to the app, not even in TestFlight: the app
   shows no price, Settings' "Remove ads and add widgets" opens a page that says "The purchase
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
   - **App Store Localization**, English (U.K.): **Display Name** "Remove ads and add widgets",
     and **Description** "No ads, plus home and lock screen widgets" (exactly, with no full stop:
     the app's tests hold the same words).
   - **Family Sharing:** turned on (**Turn On**, if it isn't yet). Once on it can't be turned off,
     which is what you chose (Q4).

   If App Store Connect says something different, change it there to match, or tell me if you
   think App Store Connect is the one that is right.

3. **Review Information**, further down the same page:
   - **Screenshot:** the upgrade sheet with its price, which the app's tests take. On GitHub open
     **Actions**, then **iOS** on the left, then the latest run with 7.1 in it (on `main` once it is
     merged), and under **Artifacts** download **ios-attachments**. The screenshot is
     `review/app-upgrade.png` in it (not one from the `UI` folder, whose files are named by
     codes): 1206 × 2622 pixels, the whole iPhone 17 screen. Upload that. When phase 7.3 makes a
     new one, with the widgets on the sheet, upload it in this one's place. GitHub keeps artefacts
     for 5 days, and runs happen only when the app's files change: if it has gone, open that run,
     press **Re-run all jobs**, and take it from the run that makes.
   - **Review Notes:** paste this:

     > Unlocks two things: no ads in the app, and the Snow forecast widget for the home screen
     > and lock screen. To buy it, tap the gear at the top right of the app (Settings), then
     > Remove ads and add widgets, then Buy. It is also the row at the end of the middle page
     > (Today, or Tomorrow after 6pm). Restore purchase is in Settings, beneath it. If the App
     > Store doesn't answer, Settings still shows Remove ads and add widgets, without a price,
     > and its page says the purchase isn't available right now.

   Press **Save**. The purchase's status then changes from **Missing Metadata** to **Ready to
   Submit**.

4. **With version 1.0 (C24).** A first in-app purchase goes to App Review with a version of the
   app, never on its own. On the version's page (**Apps**, **willitsnow.today**, then **1.0**
   under **iOS App**), find **In-App Purchases and Subscriptions**, add **Snow unlock** there,
   then submit the version as usual (spec section 21.4). App Review then sees the two together.

5. **On your iPhone, from TestFlight**, once a build with 7.1 in it has reached you:
   1. Open the app, tap the gear, then **Remove ads and add widgets · £1.99**, then **Buy for
      £1.99**, and confirm on Apple's own sheet. A TestFlight build buys in Apple's test
      environment with your own Apple Account, so nothing is charged and you need no Sandbox
      tester. The ads go at once: the band under the pages, the ad at the end of each page, and
      no more full-screen ads. The page and Settings then say "Thank you. Ads are off and widgets
      are on."
   2. If there is no price, and the page says the purchase isn't available right now, the App
      Store has nothing to sell the app yet. Check that the agreement is Active (step 1), and
      that the purchase has its price and its English (U.K.) name (step 2); it doesn't need to be
      Ready to Submit for TestFlight. A change in App Store Connect can take up to an hour to
      reach TestFlight, so try again later.
   3. Delete the app, install it again from TestFlight and open it. It should come back as the
      paid version by itself, as Apple remembers the purchase. Open Settings and tap **Restore
      purchase** anyway: it should say "Purchase restored."
   4. Until phase 7.2, the widget shows its answers whether or not you bought, so keep
      TestFlight to the internal group (you).

   If any step shows something else, tell me what it said, with a screenshot.

6. **A Sandbox tester (C16) is optional.** TestFlight never uses one, and a build you run from
   Xcode sells from Snow.storekit, Xcode's local stand-in for the App Store, which needs no
   account (apps/ios/README.md, "Phase 7.1: the purchase", "Trying it"). Only a build from Xcode
   with that turned off (**Product → Scheme → Edit Scheme → Run → Options**, **StoreKit
   Configuration** set to None) buys from Apple's test environment, and needs one: **Users and
   Access → Sandbox → Test Accounts**, then **+**, with an email address that isn't an Apple
   Account already. On the iPhone, with Developer Mode on, try one purchase in a build Xcode
   installed; **Settings → Developer → Sandbox Apple Account → Sign In** appears after that
   (Apple, "Testing In-App Purchases with sandbox"). Refunds, Ask to Buy and a purchase taken
   back are already tested on CI (the StoreKit tests).

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

- Review the Privacy, Cookies and Terms drafts (the contact email is in) and the Support page.
  Take "Draft for review" off them before the app is submitted: its listing links Privacy and
  Support.
- Decide on the items marked **Needs a decision** in [DECISIONS.md](DECISIONS.md).
- Try the place picker on a real iPhone and Android phone (open it, type, hide the keyboard,
  pick a result), and look at the Tomorrow tab with text at 200% (the word should break with a
  hyphen); both were checked in emulation only.
- Run the deploy preview smoke test (it runs on every pull request) and check Lighthouse.
