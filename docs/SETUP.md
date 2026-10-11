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
- **Netlify Blobs** (the API cache) needs no setup. Production uses one shared store;
  previews get their own.
- **Rate limiting**: the API functions declare a 60 requests/minute per-IP rule in code. If
  your Netlify plan does not include code-based rate limiting, Netlify ignores the rule and the
  site still works; upgrade or add a rule in the UI later.

Merging the pull request deploys to production at https://isithotapp.netlify.app.

## 2. Open-Meteo Standard plan (before ads or public launch)

The free API is for non-commercial use only and bans ads. Testing with friends, with ads off,
is fine on it. Its limits are 600 calls a minute, 5,000 an hour, 10,000 a day and 300,000 a
month. Each forecast fetch costs 4.0 calls (8 models × 5 hourly variables: temperature,
feels-like, precipitation, snowfall and UV index, one request serving all three sites; it was
2.4 before Will it snow? and 3.2 before the UV index), and a fetch only happens when a 5 km
cell's cached forecast is over an hour old: at most 96 calls a day for a place checked around
the clock, so it would take roughly 100 such places (or search engines crawling every city page
of the three sites every hour) to reach the daily limit. Searched places and city pages are
forecast for their own height, so in hills and mountains places in one cell at different
heights (50 m bands) are separate forecasts. A group of friends is nowhere
near it. If the limit is ever hit, the API serves the last forecast (up to 6
hours old) marked stale, and the Netlify function log shows
`forecast unavailable for … open-meteo: HTTP 429 …` (a 503 says the same in `error.detail`).

1. Subscribe to the Standard plan at https://open-meteo.com/en/pricing ($29/month, 1M calls).
2. In Netlify: **Project configuration → Environment variables → Add a variable**:
   `OPEN_METEO_API_KEY` = your key, scope **Functions** (or all), all deploy contexts.
3. Trigger a redeploy. With a key present the code switches to the
   `customer-api.open-meteo.com` and `customer-geocoding-api.open-meteo.com` hosts by itself.

Quota: each cache miss is one forecast request for 8 models × 5 hourly variables (4.0 calls),
and a second one when Open-Meteo has not answered within 2 seconds.
Forecasts are cached per 5 km grid cell (and 50 m height band, where the place's height is
known) for an hour, and API responses at the CDN for up to 10
minutes (never past the next hour, stale copies included, since today's rain and snow answers
cover the rest of the day), so calls scale with the number of distinct places, not page views.
All three sites share the cache. NASA POWER needs no key and has no quota to plan for: each
50 km climate cell is fetched once (three small requests: highs, rainfall and snowfall) and
cached for good.

## 3. Custom domain

1. Netlify: **Domain management → Add a domain** → `isithot.today`.
2. Either move DNS to Netlify (simplest) or add the records Netlify shows at your registrar.
3. Netlify issues the HTTPS certificate automatically. Make `isithot.today` the primary
   domain; `www` redirects to it.

Canonical URLs, sitemaps, robots.txt and OG image links use the three site addresses in
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
   `https://isitwet.today/sitemap.xml`. Before ads go on, add isitwet.today to AdSense's sites.

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
   `https://willitsnow.today/sitemap.xml`. Before ads go on, add willitsnow.today to AdSense's
   sites.

On deploy previews the snow site is at `https://deploy-preview-<n>--isithotapp.netlify.app/snow`,
and the header `x-willitsnow-host: 1` makes a preview act as willitsnow.today (previews only).
The preview smoke test checks both (`scripts/smoke.mjs --wet --snow`).

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

## 6. Uptime monitor

Any free monitor (UptimeRobot, Better Stack) on:

```
https://isithot.today/api/v1/today?place=london-gb&units=c
https://isitwet.today/in/london-gb
https://willitsnow.today/in/london-gb
```

Alert on a non-200 response, or when the API body does not contain `"days"`.

## 7. Before launch

- Review the Privacy, Cookies and Terms drafts and add a contact email (Privacy page).
- Confirm NASA POWER's terms cover use on an ad-supported site (spec open decision).
- Decide on the items marked **Needs a decision** in [DECISIONS.md](DECISIONS.md).
- Try the place picker on a real iPhone and Android phone (open it, type, hide the keyboard,
  pick a result), and look at the Tomorrow tab with text at 200% (the word should break with a
  hyphen); both were checked in emulation only.
- Run the deploy preview smoke test (it runs on every pull request) and check Lighthouse.
