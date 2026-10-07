#!/usr/bin/env node
/**
 * Builds two data files from GeoNames (via the `all-the-cities` package, CC BY 4.0):
 *
 *   data/cities.json  ~300 cities with their own pages (150 UK, 150 worldwide)
 *   data/places.json  compact list of towns used to name a rounded device location
 *
 * Run with `pnpm cities`. Edit the lists below to change which cities get pages.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const all = require('all-the-cities');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

const UK_COUNT = 150;
const WORLD_COUNT = 150;
const WORLD_PER_COUNTRY = 8;

/** Feature codes for boroughs, districts and neighbourhoods rather than towns. */
const SKIP_CODES = new Set(['PPLX', 'PPLL', 'PPLA3', 'PPLA4', 'PPLH', 'PPLQ', 'PPLW']);

/** GeoNames entries that are districts or areas, not towns people search for. */
const SKIP_NAMES = new Set([
  'Saint Peters',
  'Fylde',
  'Mendip',
  'High Peak',
  'Rossendale',
  'Castlereagh',
  'Kingswood',
  'Tonypandy',
  'Buckley',
]);

/** English names for places GeoNames lists in the local language. Used for the slug too. */
const ENGLISH_NAMES = {
  Sevilla: 'Seville',
  Genève: 'Geneva',
  Irákleion: 'Heraklion',
  'Saint Andrews': 'St Andrews',
};

/** Short names people actually use. The slug keeps the full name. */
const SHORT_NAMES = {
  'Newcastle upon Tyne': 'Newcastle',
  'Kingston upon Hull': 'Hull',
  'Southend-on-Sea': 'Southend',
  'Royal Leamington Spa': 'Leamington Spa',
  'Royal Tunbridge Wells': 'Tunbridge Wells',
  'Barrow in Furness': 'Barrow-in-Furness',
  'New York City': 'New York',
  'Mexico City': 'Mexico City',
};

/** UK places always included for geographic coverage, even below the population cut. */
const UK_ALWAYS = [
  'Inverness',
  'Stirling',
  'Perth',
  'Aberdeen',
  'Dundee',
  'Fort William',
  'Oban',
  'Saint Andrews',
  'Truro',
  'Penzance',
  'Salisbury',
  'Chichester',
  'Durham',
  'Winchester',
  'Lancaster',
  'Kendal',
  'Carlisle',
  'Aberystwyth',
  'Armagh',
  'Newry',
  'Canterbury',
  'Bath',
  'York',
  'Exeter',
];

/** Worldwide places always included: European capitals and popular holiday spots for UK visitors. */
const WORLD_ALWAYS = [
  ['Paris', 'FR'],
  ['Madrid', 'ES'],
  ['Barcelona', 'ES'],
  ['Rome', 'IT'],
  ['Lisbon', 'PT'],
  ['Athens', 'GR'],
  ['Amsterdam', 'NL'],
  ['Dublin', 'IE'],
  ['Berlin', 'DE'],
  ['Brussels', 'BE'],
  ['Vienna', 'AT'],
  ['Prague', 'CZ'],
  ['Copenhagen', 'DK'],
  ['Stockholm', 'SE'],
  ['Oslo', 'NO'],
  ['Helsinki', 'FI'],
  ['Reykjavík', 'IS'],
  ['Warsaw', 'PL'],
  ['Budapest', 'HU'],
  ['Zürich', 'CH'],
  ['Genève', 'CH'],
  ['Málaga', 'ES'],
  ['Alicante', 'ES'],
  ['Palma', 'ES'],
  ['Sevilla', 'ES'],
  ['Valencia', 'ES'],
  ['Santa Cruz de Tenerife', 'ES'],
  ['Las Palmas de Gran Canaria', 'ES'],
  ['Benidorm', 'ES'],
  ['Faro', 'PT'],
  ['Porto', 'PT'],
  ['Funchal', 'PT'],
  ['Nice', 'FR'],
  ['Marseille', 'FR'],
  ['Venice', 'IT'],
  ['Florence', 'IT'],
  ['Naples', 'IT'],
  ['Milan', 'IT'],
  ['Antalya', 'TR'],
  ['Dubrovnik', 'HR'],
  ['Split', 'HR'],
  ['Valletta', 'MT'],
  ['Larnaca', 'CY'],
  ['Paphos', 'CY'],
  ['Irákleion', 'GR'],
  ['Marrakesh', 'MA'],
  ['Dubai', 'AE'],
  ['Orlando', 'US'],
  ['Las Vegas', 'US'],
  ['Miami', 'US'],
  ['San Francisco', 'US'],
  ['Cancún', 'MX'],
  ['Toronto', 'CA'],
  ['Vancouver', 'CA'],
  ['Sydney', 'AU'],
  ['Melbourne', 'AU'],
  ['Auckland', 'NZ'],
  ['Singapore', 'SG'],
  ['Bangkok', 'TH'],
  ['Phuket', 'TH'],
  ['Denpasar', 'ID'],
  ['Cape Town', 'ZA'],
];

const US_STATES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  PR: 'Puerto Rico',
};
const UK_NATIONS = { ENG: 'England', SCT: 'Scotland', WLS: 'Wales', NIR: 'Northern Ireland' };

function region(c) {
  if (c.country === 'GB') return UK_NATIONS[c.adminCode] ?? null;
  if (c.country === 'US') return US_STATES[c.adminCode] ?? null;
  return null;
}

function slugify(name, country) {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-${country.toLowerCase()}`;
}

function km(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round = (v, d) => Number(v.toFixed(d));
const point = (c) => ({ lat: c.loc.coordinates[1], lon: c.loc.coordinates[0] });

function toCity(c) {
  const p = point(c);
  const english = ENGLISH_NAMES[c.name] ?? c.name;
  const name = SHORT_NAMES[english] ?? english;
  return {
    slug: slugify(english, c.country),
    name,
    region: region(c),
    country: c.country,
    countryName: countryNames.of(c.country) ?? c.country,
    lat: round(p.lat, 4),
    lon: round(p.lon, 4),
    population: c.population,
    geonameId: c.cityId,
  };
}

const byPop = [...all].sort((a, b) => b.population - a.population);
const london = { lat: 51.5074, lon: -0.1278 };

// --- UK -------------------------------------------------------------------
function ukEligible(c) {
  if (c.country !== 'GB') return false;
  if (SKIP_NAMES.has(c.name)) return false;
  if (c.featureCode === 'PPLC') return true;
  if (c.featureCode !== 'PPLA3' && SKIP_CODES.has(c.featureCode)) return false;
  // Greater London boroughs and districts are covered by the London page.
  return km(point(c), london) > 20;
}

const ukPicked = [];
function addUk(c) {
  if (ukPicked.some((p) => p.cityId === c.cityId)) return;
  // Skip a place that is effectively part of a larger town already picked.
  if (ukPicked.some((p) => km(point(p), point(c)) < 3)) return;
  ukPicked.push(c);
}
for (const name of UK_ALWAYS) {
  const c = byPop.find((x) => x.country === 'GB' && x.name === name);
  if (c) addUk(c);
  else console.warn(`UK city not found: ${name}`);
}
for (const c of byPop) {
  if (ukPicked.length >= UK_COUNT) break;
  if (ukEligible(c)) addUk(c);
}

// --- World ------------------------------------------------------------------
const worldPicked = [];
const perCountry = new Map();
function addWorld(c, force = false) {
  if (worldPicked.some((p) => p.cityId === c.cityId)) return;
  if (worldPicked.some((p) => km(point(p), point(c)) < 10)) return;
  const n = perCountry.get(c.country) ?? 0;
  if (!force && n >= WORLD_PER_COUNTRY) return;
  perCountry.set(c.country, n + 1);
  worldPicked.push(c);
}
for (const [name, country] of WORLD_ALWAYS) {
  const c = byPop.find(
    (x) => x.country === country && (x.name === name || x.altName.split(',').includes(name)),
  );
  if (c) addWorld(c, true);
  else console.warn(`World city not found: ${name}, ${country}`);
}
for (const c of byPop) {
  if (worldPicked.length >= WORLD_COUNT) break;
  if (c.country === 'GB' || SKIP_CODES.has(c.featureCode)) continue;
  addWorld(c);
}

const cities = [
  ...ukPicked.sort((a, b) => b.population - a.population),
  ...worldPicked.sort((a, b) => b.population - a.population),
].map(toCity);

const slugs = new Set();
for (const c of cities) {
  if (slugs.has(c.slug)) throw new Error(`Duplicate slug ${c.slug}`);
  slugs.add(c.slug);
}
writeFileSync(join(root, 'data/cities.json'), JSON.stringify(cities, null, 1) + '\n');
console.log(`data/cities.json: ${ukPicked.length} UK + ${worldPicked.length} worldwide`);

// --- Places for naming a device location -------------------------------------
const places = all
  .filter((c) => !SKIP_CODES.has(c.featureCode) || c.featureCode === 'PPLA3')
  .filter((c) => c.population >= (c.country === 'GB' || c.country === 'IE' ? 1000 : 5000))
  .map((c) => {
    const p = point(c);
    const english = ENGLISH_NAMES[c.name] ?? c.name;
    return [
      c.cityId,
      SHORT_NAMES[english] ?? english,
      c.country,
      round(p.lat, 3),
      round(p.lon, 3),
      region(c) ?? '',
    ];
  });
writeFileSync(
  join(root, 'data/places.json'),
  JSON.stringify({
    fields: ['geonameId', 'name', 'country', 'lat', 'lon', 'region'],
    rows: places,
  }) + '\n',
);
console.log(`data/places.json: ${places.length} places`);
