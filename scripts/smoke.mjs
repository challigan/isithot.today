#!/usr/bin/env node
/**
 * Smoke test a deployed site: node scripts/smoke.mjs https://deploy-preview-1--isithotapp.netlify.app
 * Prints what it sees so the CI log doubles as a report.
 *
 *   --wet              Also check the isitwet.today pages on the same deploy: under /wet, and at
 *                      the root with the x-isitwet-host: 1 header. The header works on deploy
 *                      previews only (the edge function ignores it in production and does not run
 *                      under astro dev).
 *   --snow             The same for willitsnow.today: under /snow, and with x-willitsnow-host: 1.
 *   --wind             The same for isitwindy.today: under /wind, and with x-isitwindy-host: 1.
 *   --wet-site <url>   Also check the isitwet.today pages on their own domain (production).
 *   --snow-site <url>  The same for willitsnow.today.
 *   --wind-site <url>  The same for isitwindy.today.
 */
const args = process.argv.slice(2);
/** The value of `--name value` or `--name=value`, taken out of the arguments. */
function option(name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  const [arg] = args.splice(i, 1);
  return arg === name ? (args.splice(i, 1)[0] ?? '') : arg.slice(name.length + 1);
}

// The sites' own addresses (SITES in packages/core/src/config.ts): canonical URLs, robots.txt
// and sitemaps always name these, whichever deploy served them. The other sites are served from
// under their prefix on any deploy, and at the root on a preview sent their header (the edge
// function, netlify/edge-functions/lib/route.ts); their pages ask their own question.
const HOT = 'https://isithot.today';
// Each sitemap lists home, About, the places page and the city pages the site lists: all 300 on
// isithot.today, isitwet.today and isitwindy.today; willitsnow.today leaves out the places where
// it never snows (SNOWLESS in packages/core/src/config.ts, 63 of them), such as Singapore.
const SITES = {
  wet: {
    url: 'https://isitwet.today',
    prefix: '/wet',
    header: 'x-isitwet-host',
    home: 'Is it wet today?',
    city: 'Is it wet in Newcastle today?',
    minUrls: 303,
  },
  snow: {
    url: 'https://willitsnow.today',
    prefix: '/snow',
    header: 'x-willitsnow-host',
    home: 'Will it snow today?',
    city: 'Will it snow in Newcastle today?',
    minUrls: 240,
    unlisted: 'singapore-sg',
  },
  wind: {
    url: 'https://isitwindy.today',
    prefix: '/wind',
    header: 'x-isitwindy-host',
    home: 'Is it windy today?',
    city: 'Is it windy in Newcastle today?',
    minUrls: 303,
  },
};
const CITY = 'newcastle-upon-tyne-gb';
/** A title with an answer in it ("… today? Yes. 24° | …"): titles must never carry one. */
const ANSWERED = / (Yes|No|Almost|Maybe|A bit|Partly)\. /;

/** Each site's own domain to check, from --wet-site, --snow-site and --wind-site. */
const siteUrls = {};
for (const [t, site] of Object.entries(SITES)) {
  const url = option(`--${t}-site`)?.replace(/\/$/, '');
  if (url === '') {
    console.error(`--${t}-site needs a URL, e.g. --${t}-site ${site.url}`);
    process.exit(2);
  }
  siteUrls[t] = url;
}
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:4321').replace(/\/$/, '');

let failures = 0;

function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

/** Redirects are not followed, so a page that should be served but redirects fails. */
async function get(path, { origin = base, headers = {} } = {}) {
  const started = performance.now();
  const res = await fetch(origin + path, { redirect: 'manual', headers });
  const ms = Math.round(performance.now() - started);
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json')
    ? await res.json()
    : type.startsWith('image/')
      ? await res.arrayBuffer()
      : await res.text();
  return { res, body, ms };
}

const head = (res, names) => names.map((n) => `${n}=${res.headers.get(n) ?? '-'}`).join(' ');
/**
 * Why an API call failed: the error body's code and `detail` (what went wrong upstream, e.g.
 * "open-meteo: timed out after 6000ms (2 attempts)"), or the start of a body that is not JSON
 * (a platform error page).
 */
function why({ res, body }) {
  if (res.ok) return '';
  const error = body?.error;
  if (error) return ` | ${error.code}: ${error.detail ?? error.message}`;
  return ` | ${String(body).replace(/\s+/g, ' ').slice(0, 200)}`;
}
const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(String(html))?.[1];
const canonicalOf = (html) =>
  /<link rel="canonical" href="([^"]*)"/.exec(String(html))?.[1] ?? '(none)';
const ogImageOf = (html) =>
  /<meta property="og:image" content="([^"]*)"/.exec(String(html))?.[1] ?? '(none)';
const locs = (xml) => [...String(xml).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

/**
 * A site's pages (isitwet.today, willitsnow.today, isitwindy.today), wherever they are served
 * from: `origin` is the deploy, `prefix` is the site's ("/wet") when requesting the pages
 * directly, and `headers` can ask a deploy preview to act as the site. Whatever the route, the pages must name the site.
 */
async function checkSite(t, label, { origin = base, prefix = '', headers = {} } = {}) {
  const { url: own, home: asked, city: cityAsked, minUrls, unlisted } = SITES[t];
  const host = new URL(own).host;
  // "/" is "/wet" and "/?q" is "/wet?q" under the prefix.
  const path = (p) => (prefix ? prefix + p.replace(/^\/(?=\?|$)/, '') : p);
  const at = (p) => get(path(p), { origin, headers });
  const name = (p) => `${label}: GET ${path(p)}`;

  const home = await at('/');
  check(
    home.res.status === 200 && !!titleOf(home.body)?.startsWith(asked),
    name('/'),
    `${home.res.status} ${home.ms}ms "${titleOf(home.body)}"`,
  );

  // A shared place's address is served. Only the browser reads the query string (the page is
  // static), so whether it survives the rewrite is not visible here: route()'s unit tests
  // (netlify/test/route.test.ts) cover the rewrite, and production-smoke.yml checks that
  // isithot.today/wet?lat=… redirects to isitwet.today/?lat=… with it.
  const query = '/?lat=51.5&lon=-0.12&name=X';
  const located = await at(query);
  check(
    located.res.status === 200 && !!titleOf(located.body)?.startsWith(asked),
    name(query),
    `${located.res.status} ${located.ms}ms`,
  );

  const page = await at(`/in/${CITY}`);
  const title = titleOf(page.body);
  const canonical = canonicalOf(page.body);
  check(
    page.res.status === 200 && !!title?.startsWith(cityAsked) && !ANSWERED.test(title),
    name(`/in/${CITY}`),
    `${page.res.status} ${page.ms}ms "${title}"`,
  );
  check(canonical === `${own}/in/${CITY}`, `${label}: canonical is on ${host}`, canonical);
  const ogImage = ogImageOf(page.body);
  check(ogImage === `${own}/og/${CITY}.png`, `${label}: og:image is on ${host}`, ogImage);

  const og = await at(`/og/${CITY}.png`);
  check(
    og.res.status === 200 && og.res.headers.get('content-type') === 'image/png',
    name(`/og/${CITY}.png`),
    `${og.res.status} ${og.ms}ms ${og.body?.byteLength} bytes`,
  );

  const robots = await at('/robots.txt');
  check(
    robots.res.status === 200 && String(robots.body).includes(`Sitemap: ${own}/sitemap.xml`),
    name('/robots.txt'),
    String(robots.body).match(/^Sitemap:.*$/m)?.[0] ?? `${robots.res.status}`,
  );

  const sitemap = await at('/sitemap.xml');
  const urls = locs(sitemap.body);
  check(
    sitemap.res.status === 200 &&
      urls.length >= minUrls &&
      urls.every((u) => u.startsWith(`${own}/`)) &&
      urls.includes(`${own}/in/${CITY}`) &&
      urls.includes(`${own}/places`) &&
      (!unlisted || !urls.includes(`${own}/in/${unlisted}`)),
    name('/sitemap.xml'),
    `${urls.length} urls, first ${urls[0]}`,
  );

  const places = await at('/places');
  check(
    places.res.status === 200 && canonicalOf(places.body) === `${own}/places`,
    name('/places'),
    `${places.res.status} ${places.ms}ms ${canonicalOf(places.body)}`,
  );

  const missing = await at('/in/atlantis-xx');
  check(
    missing.res.status === 404,
    `${label}: unknown city page gives 404`,
    `${missing.res.status}`,
  );
}

try {
  const home = await get('/');
  check(
    home.res.status === 200 && String(home.body).includes('Is it hot today?'),
    'GET /',
    `${home.ms}ms`,
  );

  const q = '/api/v1/today?lat=54.95&lon=-1.6&units=c';
  const t1 = await get(q);
  const day = t1.body?.days?.[0];
  check(
    t1.res.status === 200 && !!day,
    `GET ${q}`,
    `${t1.res.status} ${t1.ms}ms ${head(t1.res, ['x-isithot-via', 'cache-control', 'netlify-cdn-cache-control'])}${why(t1)}`,
  );
  if (day) {
    console.log(`      location: ${JSON.stringify(t1.body.location)}`);
    console.log(`      ${day.date} ${day.band} | ${day.answer} ${day.verdict} | ${day.detail}`);
    console.log(
      `      ${day.agreementText} | confidence=${day.consensus.confidence} | normals=${day.normalHigh}`,
    );
    console.log(`      models: ${day.models.map((m) => `${m.name}=${m.value}`).join(', ')}`);
    check(day.consensus.total >= 5, 'at least 5 models returned data', `${day.consensus.total}`);
    check(day.normalHigh !== null, 'climate normals present');
    check(t1.body.days.length === 2, 'two days returned');
    const now = t1.body.now;
    check(!!now && /^(Yes|No|Almost)\.$/.test(now.answer), 'now answered', now?.detail);
    check(
      now?.series?.length >= 20,
      'now carries a day of hourly series',
      `${now?.series?.length}`,
    );
    const week = t1.body.week;
    check(!!week && week.days.length >= 5, 'week answered', `${week?.days?.length} days`);
    if (week) {
      console.log(`      week: ${week.answer} ${week.verdict} | ${week.detail}`);
      console.log(
        `      days: ${week.days.map((d) => `${d.label}=${d.high}(${d.bandLabel})`).join(' ')}`,
      );
    }
    if (now) console.log(`      now: ${now.answer} ${now.verdict} | ${now.detail}`);
    // Feels-like comes from hourly apparent temperature: if it never differs from the air
    // temperature, the variable is not being read.
    check(
      t1.body.days.some((d) => d.feelsLike !== d.high) ||
        now?.series?.some((p) => p.feelsLike !== p.temperature),
      'feels-like read from hourly apparent temperature',
    );
  }

  // "Is it wet?" comes in the same response. Structure only: the answers depend on the weather.
  const rain = t1.body?.rain;
  const rainDay = rain?.days?.[0];
  check(
    rain?.unit === 'mm' && !!rainDay && /^(Yes|No|Maybe)\.$/.test(rainDay.answer),
    'rain answered',
    rain ? `unit=${rain.unit} ${rainDay?.answer}` : 'no rain in the response',
  );
  if (rainDay) {
    console.log(
      `      rain: ${rainDay.date} ${rainDay.band} | ${rainDay.answer} ${rainDay.verdict} | ${rainDay.detail}`,
    );
    console.log(
      `      ${rainDay.agreementText} | confidence=${rainDay.confidence} | amount=${rainDay.amount}${rain.unit} threshold=${rainDay.threshold}${rain.unit} snow=${rainDay.snow} likely=${JSON.stringify(rainDay.likely)}`,
    );
    console.log(
      `      models: ${rainDay.models.map((m) => `${m.name}=${m.amount}${rain.unit}`).join(', ')}`,
    );
    check(
      rainDay.models.length >= 5 &&
        rainDay.models.every((m) => Number.isFinite(m.amount) && Number.isFinite(m.value)),
      'at least 5 models have rain totals',
      `${rainDay.models.length}`,
    );
    check(rain.days.length === 2, 'two rain days returned', `${rain.days.length}`);
    const rainNow = rain.now;
    check(
      !!rainNow && /^(Yes|No|Maybe)\.$/.test(rainNow.answer),
      'rain now answered',
      rainNow?.detail,
    );
    check(
      rainNow?.series?.length >= 20,
      'rain now carries a day of hourly series',
      `${rainNow?.series?.length}`,
    );
    const rainWeek = rain.week;
    check(
      !!rainWeek && rainWeek.days.length >= 5 && /^(Yes|No|Maybe|Partly)\.$/.test(rainWeek.answer),
      'rain week answered',
      `${rainWeek?.days?.length} days`,
    );
    if (rainWeek) {
      console.log(`      rain week: ${rainWeek.answer} ${rainWeek.verdict} | ${rainWeek.detail}`);
      console.log(
        `      days: ${rainWeek.days.map((d) => `${d.label}=${d.amount}${rain.unit}(${d.bandLabel})`).join(' ')}`,
      );
    }
    if (rainNow) {
      console.log(`      rain now: ${rainNow.answer} ${rainNow.verdict} | ${rainNow.detail}`);
      console.log(`      hours: ${rainNow.hours.map((h) => `${h.label}=${h.chance}%`).join(' ')}`);
    }
  }

  // "Will it snow?" too, worked out from the same forecast at the same moment. Structure only.
  const snow = t1.body?.snow;
  const snowDay = snow?.days?.[0];
  check(
    snow?.unit === 'cm' && !!snowDay && /^(Yes|No|Maybe)\.$/.test(snowDay.answer),
    'snow answered',
    snow ? `unit=${snow.unit} ${snowDay?.answer}` : 'no snow in the response',
  );
  if (snowDay) {
    console.log(
      `      snow: ${snowDay.date} ${snowDay.band} | ${snowDay.answer} ${snowDay.verdict} | ${snowDay.detail}`,
    );
    console.log(
      `      ${snowDay.agreementText} | confidence=${snowDay.confidence} | amount=${snowDay.amount}${snow.unit} threshold=${snowDay.threshold}${snow.unit} reason=${snowDay.reason} likely=${JSON.stringify(snowDay.likely)}`,
    );
    console.log(
      `      models: ${snowDay.models.map((m) => `${m.name}=${m.amount}${snow.unit}`).join(', ')}`,
    );
    check(
      snowDay.models.length >= 5 &&
        snowDay.models.every((m) => Number.isFinite(m.amount) && Number.isFinite(m.value)),
      'at least 5 models have snow totals',
      `${snowDay.models.length}`,
    );
    check(snow.days.length === 2, 'two snow days returned', `${snow.days.length}`);
    check(
      snowDay.from === rainDay?.from,
      'snow and rain worked out from the same moment',
      `${snowDay.from} ${rainDay?.from}`,
    );
    const snowNow = snow.now;
    check(
      !!snowNow && /^(Yes|No|Maybe)\.$/.test(snowNow.answer),
      'snow now answered',
      snowNow?.detail,
    );
    check(
      snowNow?.series?.length >= 20,
      'snow now carries a day of hourly series',
      `${snowNow?.series?.length}`,
    );
    const snowWeek = snow.week;
    check(
      !!snowWeek && snowWeek.days.length >= 5 && /^(Yes|No|Maybe)\.$/.test(snowWeek.answer),
      'snow week answered',
      `${snowWeek?.days?.length} days`,
    );
    if (snowWeek) {
      console.log(`      snow week: ${snowWeek.answer} ${snowWeek.verdict} | ${snowWeek.detail}`);
      console.log(
        `      days: ${snowWeek.days.map((d) => `${d.label}=${d.amount}${snow.unit}(${d.bandLabel})`).join(' ')}`,
      );
    }
    if (snowNow)
      console.log(`      snow now: ${snowNow.answer} ${snowNow.verdict} | ${snowNow.detail}`);
  }

  // "Is it windy?" too, from the same forecast at the same moment, in its own units: Newcastle's,
  // mph, when the request names °C but not the wind's units. Structure only.
  const wind = t1.body?.wind;
  const windDay = wind?.days?.[0];
  check(
    wind?.unit === 'mph' && !!windDay && /^(Yes|No|A bit)\.$/.test(windDay.answer),
    'wind answered, in mph for Newcastle',
    wind ? `unit=${wind.unit} ${windDay?.answer}` : 'no wind in the response',
  );
  if (windDay) {
    console.log(
      `      wind: ${windDay.date} ${windDay.band} | ${windDay.answer} ${windDay.verdict} | ${windDay.detail}`,
    );
    console.log(
      `      ${windDay.agreementText} | confidence=${windDay.confidence} | gust=${windDay.gust}${wind.unit} mean=${windDay.mean}${wind.unit} peak=${windDay.peak} normal=${windDay.normal}`,
    );
    console.log(
      `      models: ${windDay.models.map((m) => `${m.name}=${m.gust}/${m.mean}${wind.unit}`).join(', ')}`,
    );
    check(
      windDay.models.length >= 5 &&
        windDay.models.every((m) => Number.isFinite(m.gust) && Number.isFinite(m.mean)),
      'at least 5 models have wind and gusts',
      `${windDay.models.length}`,
    );
    // Gusts and the mean wind are separate variables: if no model's differ, one is misread.
    check(
      windDay.models.some((m) => m.gust !== m.mean),
      'gusts read apart from the mean wind',
    );
    check(wind.days.length === 2, 'two wind days returned', `${wind.days.length}`);
    check(
      windDay.from === rainDay?.from,
      'wind and rain worked out from the same moment',
      `${windDay.from} ${rainDay?.from}`,
    );
    const windNow = wind.now;
    check(
      !!windNow && /^(Yes|No|A bit)\.$/.test(windNow.answer),
      'wind now answered',
      windNow?.detail,
    );
    check(
      windNow?.series?.length >= 20,
      'wind now carries a day of hourly series',
      `${windNow?.series?.length}`,
    );
    const windWeek = wind.week;
    check(
      !!windWeek && windWeek.days.length >= 5 && /^(Yes|No|A bit|Partly)\.$/.test(windWeek.answer),
      'wind week answered',
      `${windWeek?.days?.length} days`,
    );
    if (windWeek) {
      console.log(`      wind week: ${windWeek.answer} ${windWeek.verdict} | ${windWeek.detail}`);
      console.log(
        `      days: ${windWeek.days.map((d) => `${d.label}=${d.gust}${wind.unit}(${d.bandLabel})`).join(' ')}`,
      );
    }
    if (windNow) {
      console.log(`      wind now: ${windNow.answer} ${windNow.verdict} | ${windNow.detail}`);
      console.log(`      hours: ${windNow.hours.map((h) => `${h.label}=${h.gust}`).join(' ')}`);
    }
  }
  // Wind's own units when asked for, leaving the temperature's alone.
  const kmh = await get(`${q}&windUnits=kmh`);
  check(
    kmh.res.status === 200 && kmh.body?.wind?.unit === 'kmh' && kmh.body?.units === 'c',
    'windUnits=kmh gives km/h',
    `${kmh.res.status} units=${kmh.body?.units} wind=${kmh.body?.wind?.unit}${why(kmh)}`,
  );

  const t2 = await get(q);
  check(
    t2.res.status === 200,
    'second call',
    `${t2.ms}ms ${head(t2.res, ['age', 'cache-status', 'x-nf-request-id'])}${why(t2)}`,
  );

  const ip = await get('/api/v1/today');
  check(
    ip.res.status === 200,
    'GET /api/v1/today (IP location)',
    `${ip.ms}ms ${ip.body?.location?.name} ${ip.body?.location?.source} units=${ip.body?.units} ${head(ip.res, ['x-isithot-via', 'cache-control'])}${why(ip)}`,
  );
  check(
    ip.body?.rain?.unit === (ip.body?.units === 'f' ? 'in' : 'mm'),
    'rain unit follows the temperature units',
    `units=${ip.body?.units} rain=${ip.body?.rain?.unit}`,
  );
  check(
    ip.body?.snow?.unit === (ip.body?.units === 'f' ? 'in' : 'cm'),
    'snow unit follows the temperature units',
    `units=${ip.body?.units} snow=${ip.body?.snow?.unit}`,
  );
  check(
    ip.body?.wind?.unit === 'mph' || ip.body?.wind?.unit === 'kmh',
    'wind has a unit of its own',
    `units=${ip.body?.units} wind=${ip.body?.wind?.unit}`,
  );

  const city = await get('/api/v1/today?place=seville-es&units=c');
  check(
    city.res.status === 200 &&
      city.body.location.slug === 'seville-es' &&
      city.body.wind?.unit === 'kmh',
    'GET today?place=seville-es (wind in km/h, Spain’s unit)',
    `${city.res.status} ${city.ms}ms ${city.body?.days?.[0]?.answer} ${city.body?.days?.[0]?.detail} | rain: ${city.body?.rain?.days?.[0]?.answer} ${city.body?.rain?.days?.[0]?.detail} | snow: ${city.body?.snow?.days?.[0]?.answer} ${city.body?.snow?.days?.[0]?.detail} | wind: ${city.body?.wind?.days?.[0]?.answer} ${city.body?.wind?.days?.[0]?.detail}${why(city)}`,
  );

  const search = await get('/api/v1/search?q=Newcastle');
  check(
    search.res.status === 200 && search.body.results?.length > 0,
    'GET /api/v1/search?q=Newcastle',
    `${search.body?.results?.map((r) => `${r.name}/${r.country}${r.slug ? '*' : ''}`).join(', ')} ${head(search.res, ['x-isithot-via'])}`,
  );

  const page = await get(`/in/${CITY}`);
  const title = titleOf(page.body);
  check(
    page.res.status === 200 &&
      title?.startsWith('Is it hot in Newcastle today?') &&
      !ANSWERED.test(title),
    `GET /in/${CITY}`,
    `${page.ms}ms "${title}"`,
  );
  const canonical = canonicalOf(page.body);
  check(canonical === `${HOT}/in/${CITY}`, 'canonical is on isithot.today', canonical);

  const og = await get(`/og/${CITY}.png`);
  check(
    og.res.status === 200 && og.res.headers.get('content-type') === 'image/png',
    `GET /og/${CITY}.png`,
    `${og.ms}ms ${og.body?.byteLength} bytes`,
  );

  const robots = await get('/robots.txt');
  check(
    robots.res.status === 200 && String(robots.body).includes(`Sitemap: ${HOT}/sitemap.xml`),
    'GET /robots.txt',
    String(robots.body).match(/^Sitemap:.*$/m)?.[0] ?? `${robots.res.status}`,
  );

  const sitemap = await get('/sitemap.xml');
  const urls = locs(sitemap.body);
  check(
    sitemap.res.status === 200 &&
      urls.length >= 303 &&
      urls.every((u) => u.startsWith(`${HOT}/`)) &&
      urls.includes(`${HOT}/places`),
    'GET /sitemap.xml',
    `${urls.length} urls`,
  );

  const places = await get('/places');
  check(
    places.res.status === 200 && canonicalOf(places.body) === `${HOT}/places`,
    'GET /places',
    `${places.ms}ms ${canonicalOf(places.body)}`,
  );

  const bad = await get('/api/v1/today?lat=999&lon=0');
  check(
    bad.res.status === 400 && bad.body?.error?.code === 'bad_location',
    'bad coordinates give 400',
  );

  const missing = await get('/in/atlantis-xx');
  check(missing.res.status === 404, 'unknown city page gives 404', `${missing.res.status}`);

  for (const [t, { prefix, header }] of Object.entries(SITES)) {
    if (args.includes(`--${t}`)) {
      await checkSite(t, `${t} under ${prefix}`, { prefix });
      await checkSite(t, `${t} via ${header}`, { headers: { [header]: '1' } });
    }
    if (siteUrls[t]) await checkSite(t, `${t} at ${siteUrls[t]}`, { origin: siteUrls[t] });
  }
} catch (err) {
  check(false, 'smoke test crashed', String(err));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
