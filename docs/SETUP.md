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

The free API is for non-commercial use only and bans ads.

1. Subscribe to the Standard plan at https://open-meteo.com/en/pricing ($29/month, 1M calls).
2. In Netlify: **Project configuration → Environment variables → Add a variable**:
   `OPEN_METEO_API_KEY` = your key, scope **Functions** (or all), all deploy contexts.
3. Trigger a redeploy. With a key present the code switches to the
   `customer-api.open-meteo.com` and `customer-geocoding-api.open-meteo.com` hosts by itself.

Quota: each cache miss is one forecast request for 8 models × 3 variables. Forecasts are
cached per 5 km grid cell for 30 minutes, and API responses at the CDN for 10 minutes, so calls
scale with the number of distinct places, not page views.

## 3. Custom domain

1. Netlify: **Domain management → Add a domain** → `isithot.today`.
2. Either move DNS to Netlify (simplest) or add the records Netlify shows at your registrar.
3. Netlify issues the HTTPS certificate automatically. Make `isithot.today` the primary
   domain; `www` redirects to it.

Canonical URLs, the sitemap and OG image links use Netlify's `URL` variable, which follows the
primary domain, so nothing in code changes.

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
```

Alert on a non-200 response, or when the body does not contain `"days"`.

## 7. Before launch

- Review the Privacy, Cookies and Terms drafts and add a contact email (Privacy page).
- Confirm NASA POWER's terms cover use on an ad-supported site (spec open decision).
- Decide on the open design items in [DECISIONS.md](DECISIONS.md), especially Hot-band
  contrast.
- Run the deploy preview smoke test (it runs on every pull request) and check Lighthouse.
