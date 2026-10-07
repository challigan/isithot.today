#!/usr/bin/env node
/**
 * Smoke test a deployed site: node scripts/smoke.mjs https://deploy-preview-1--isithotapp.netlify.app
 * Prints what it sees so the CI log doubles as a report.
 *
 *   --wet              Also check the isitwet.today pages on the same deploy: under /wet, and at
 *                      the root with the x-isitwet-host: 1 header. The header works on deploy
 *                      previews only (the edge function ignores it in production and does not run
 *                      under astro dev).
 *   --wet-site <url>   Also check the isitwet.today pages on their own domain (production).
 */
const args = process.argv.slice(2);
/** The value of `--name value` or `--name=value`, taken out of the arguments. */
function option(name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  const [arg] = args.splice(i, 1);
  return arg === name ? (args.splice(i, 1)[0] ?? '') : arg.slice(name.length + 1);
}
const wetSite = option('--wet-site')?.replace(/\/$/, '');
if (wetSite === '') {
  console.error('--wet-site needs a URL, e.g. --wet-site https://isitwet.today');
  process.exit(2);
}
const wet = args.includes('--wet');
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:4321').replace(/\/$/, '');

// The sites' own addresses (SITES in packages/core/src/config.ts): canonical URLs, robots.txt
// and sitemaps always name these, whichever deploy served them.
const HOT = 'https://isithot.today';
const WET = 'https://isitwet.today';
const CITY = 'newcastle-upon-tyne-gb';

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
const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(String(html))?.[1];
const canonicalOf = (html) =>
  /<link rel="canonical" href="([^"]*)"/.exec(String(html))?.[1] ?? '(none)';
const ogImageOf = (html) =>
  /<meta property="og:image" content="([^"]*)"/.exec(String(html))?.[1] ?? '(none)';
const locs = (xml) => [...String(xml).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

/**
 * The isitwet.today pages, wherever they are served from: `origin` is the deploy, `prefix` is
 * "/wet" when requesting the pages directly, and `headers` can ask a deploy preview to act as
 * isitwet.today. Whatever the route, the pages must name isitwet.today.
 */
async function checkWetSite(label, { origin = base, prefix = '', headers = {} } = {}) {
  // "/" is "/wet" and "/?q" is "/wet?q" under the prefix.
  const path = (p) => (prefix ? prefix + p.replace(/^\/(?=\?|$)/, '') : p);
  const at = (p) => get(path(p), { origin, headers });
  const name = (p) => `${label}: GET ${path(p)}`;

  const home = await at('/');
  check(
    home.res.status === 200 && String(home.body).includes('Is it wet today?'),
    name('/'),
    `${home.res.status} ${home.ms}ms "${titleOf(home.body)}"`,
  );

  // The query string must survive the rewrite (the page reads it in the browser).
  const query = '/?lat=51.5&lon=-0.12&name=X';
  const located = await at(query);
  check(
    located.res.status === 200 && String(located.body).includes('Is it wet today?'),
    name(query),
    `${located.res.status} ${located.ms}ms`,
  );

  const page = await at(`/in/${CITY}`);
  const title = titleOf(page.body);
  const canonical = canonicalOf(page.body);
  check(
    page.res.status === 200 && !!title?.startsWith('Is it wet in Newcastle today?'),
    name(`/in/${CITY}`),
    `${page.res.status} ${page.ms}ms "${title}"`,
  );
  check(canonical === `${WET}/in/${CITY}`, `${label}: canonical is on isitwet.today`, canonical);
  const ogImage = ogImageOf(page.body);
  check(ogImage === `${WET}/og/${CITY}.png`, `${label}: og:image is on isitwet.today`, ogImage);

  const og = await at(`/og/${CITY}.png`);
  check(
    og.res.status === 200 && og.res.headers.get('content-type') === 'image/png',
    name(`/og/${CITY}.png`),
    `${og.res.status} ${og.ms}ms ${og.body?.byteLength} bytes`,
  );

  const robots = await at('/robots.txt');
  check(
    robots.res.status === 200 && String(robots.body).includes(`Sitemap: ${WET}/sitemap.xml`),
    name('/robots.txt'),
    String(robots.body).match(/^Sitemap:.*$/m)?.[0] ?? `${robots.res.status}`,
  );

  const sitemap = await at('/sitemap.xml');
  const urls = locs(sitemap.body);
  check(
    sitemap.res.status === 200 &&
      urls.length >= 302 &&
      urls.every((u) => u.startsWith(`${WET}/`)) &&
      urls.includes(`${WET}/in/${CITY}`),
    name('/sitemap.xml'),
    `${urls.length} urls, first ${urls[0]}`,
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
    `${t1.res.status} ${t1.ms}ms ${head(t1.res, ['x-isithot-via', 'cache-control', 'netlify-cdn-cache-control'])}`,
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

  const t2 = await get(q);
  check(
    t2.res.status === 200,
    'second call',
    `${t2.ms}ms ${head(t2.res, ['age', 'cache-status', 'x-nf-request-id'])}`,
  );

  const ip = await get('/api/v1/today');
  check(
    ip.res.status === 200,
    'GET /api/v1/today (IP location)',
    `${ip.ms}ms ${ip.body?.location?.name} ${ip.body?.location?.source} units=${ip.body?.units} ${head(ip.res, ['x-isithot-via', 'cache-control'])}`,
  );
  check(
    ip.body?.rain?.unit === (ip.body?.units === 'f' ? 'in' : 'mm'),
    'rain unit follows the temperature units',
    `units=${ip.body?.units} rain=${ip.body?.rain?.unit}`,
  );

  const city = await get('/api/v1/today?place=seville-es&units=c');
  check(
    city.res.status === 200 && city.body.location.slug === 'seville-es',
    'GET today?place=seville-es',
    `${city.body?.days?.[0]?.answer} ${city.body?.days?.[0]?.detail} | rain: ${city.body?.rain?.days?.[0]?.answer} ${city.body?.rain?.days?.[0]?.detail}`,
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
    page.res.status === 200 && title?.startsWith('Is it hot in Newcastle today?'),
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
    sitemap.res.status === 200 && urls.length >= 302 && urls.every((u) => u.startsWith(`${HOT}/`)),
    'GET /sitemap.xml',
    `${urls.length} urls`,
  );

  const bad = await get('/api/v1/today?lat=999&lon=0');
  check(
    bad.res.status === 400 && bad.body?.error?.code === 'bad_location',
    'bad coordinates give 400',
  );

  const missing = await get('/in/atlantis-xx');
  check(missing.res.status === 404, 'unknown city page gives 404', `${missing.res.status}`);

  if (wet) {
    await checkWetSite('wet under /wet', { prefix: '/wet' });
    await checkWetSite('wet via x-isitwet-host', { headers: { 'x-isitwet-host': '1' } });
  }
  if (wetSite) await checkWetSite(`wet at ${wetSite}`, { origin: wetSite });
} catch (err) {
  check(false, 'smoke test crashed', String(err));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
