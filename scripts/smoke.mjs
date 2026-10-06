#!/usr/bin/env node
/**
 * Smoke test a deployed site: node scripts/smoke.mjs https://deploy-preview-1--isithotapp.netlify.app
 * Prints what it sees so the CI log doubles as a report.
 */
const base = (process.argv[2] ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
let failures = 0;

function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function get(path) {
  const started = performance.now();
  const res = await fetch(base + path, { redirect: 'manual' });
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

  const city = await get('/api/v1/today?place=seville-es&units=c');
  check(
    city.res.status === 200 && city.body.location.slug === 'seville-es',
    'GET today?place=seville-es',
    `${city.body?.days?.[0]?.answer} ${city.body?.days?.[0]?.detail}`,
  );

  const search = await get('/api/v1/search?q=Newcastle');
  check(
    search.res.status === 200 && search.body.results?.length > 0,
    'GET /api/v1/search?q=Newcastle',
    `${search.body?.results?.map((r) => `${r.name}/${r.country}${r.slug ? '*' : ''}`).join(', ')} ${head(search.res, ['x-isithot-via'])}`,
  );

  const page = await get('/in/newcastle-upon-tyne-gb');
  const title = /<title>([^<]*)<\/title>/.exec(String(page.body))?.[1];
  check(
    page.res.status === 200 && title?.startsWith('Is it hot in Newcastle today?'),
    'GET /in/newcastle-upon-tyne-gb',
    `${page.ms}ms "${title}"`,
  );

  const og = await get('/og/newcastle-upon-tyne-gb.png');
  check(
    og.res.status === 200 && og.res.headers.get('content-type') === 'image/png',
    'GET /og/newcastle-upon-tyne-gb.png',
    `${og.ms}ms ${og.body?.byteLength} bytes`,
  );

  const sitemap = await get('/sitemap.xml');
  const count = (String(sitemap.body).match(/<loc>/g) ?? []).length;
  check(sitemap.res.status === 200 && count >= 302, 'GET /sitemap.xml', `${count} urls`);

  const bad = await get('/api/v1/today?lat=999&lon=0');
  check(
    bad.res.status === 400 && bad.body?.error?.code === 'bad_location',
    'bad coordinates give 400',
  );

  const missing = await get('/in/atlantis-xx');
  check(missing.res.status === 404, 'unknown city page gives 404', `${missing.res.status}`);
} catch (err) {
  check(false, 'smoke test crashed', String(err));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
