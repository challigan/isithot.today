/**
 * A small App Store Connect API client for the app workflows, with Node's built-ins only: it signs
 * the team key's tokens and makes the requests. The key comes from the protected `testflight`
 * environment (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8) and is never printed. ASC_KEY_P8 may be the
 * .p8 file's text as it is, whatever state pasting left its line breaks in, or the file in base64.
 */
import { createPrivateKey, sign } from 'node:crypto';

export const API = 'https://api.appstoreconnect.apple.com';

const BEGIN = '-----BEGIN PRIVATE KEY-----';
const END = '-----END PRIVATE KEY-----';

/** The key's PEM from ASC_KEY_P8, rebuilt from its base64 body so any line breaks will do. */
export function keyPem(value) {
  let text = value.trim();
  if (!text.includes(BEGIN)) text = Buffer.from(text, 'base64').toString('utf8');
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error(`ASC_KEY_P8 is not a .p8 key: paste the file's text, from ${BEGIN} to ${END}.`);
  }
  const body = text.slice(start + BEGIN.length, end).replace(/\s+/g, '');
  return `${BEGIN}\n${body.match(/.{1,64}/g)?.join('\n') ?? ''}\n${END}\n`;
}

/** The key's settings from the environment, or why they are missing. */
export function credentials(env = process.env) {
  const missing = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8'].filter((n) => !env[n]?.trim());
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')}: run this job in the testflight environment.`);
  }
  return { keyId: env.ASC_KEY_ID.trim(), issuerId: env.ASC_ISSUER_ID.trim(), p8: env.ASC_KEY_P8 };
}

/** A token for the team key, good for `minutes` (Apple allows 20 at most). */
export function token({ keyId, issuerId, p8 }, now = Date.now(), minutes = 15) {
  const key = createPrivateKey(keyPem(p8));
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const unsigned = `${part({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${part({
    iss: issuerId,
    iat,
    exp: iat + minutes * 60,
    aud: 'appstoreconnect-v1',
  })}`;
  // JWTs want the raw r and s, not DER.
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${signature.toString('base64url')}`;
}

/** An error answer, with Apple's own reasons (they never carry the key). */
export class AscError extends Error {
  constructor(status, body) {
    const why = (body?.errors ?? []).map((e) => `${e.title}: ${e.detail}`).join('; ');
    super(`App Store Connect answered ${status}${why ? `: ${why}` : ''}`);
    this.status = status;
  }
}

/**
 * This project's bundle IDs all start `today.` (today.willitsnow.app, today.isitwindy.app…). The
 * check names only those: the log is public, and the account's other apps and app IDs (anything
 * registered under the team, sideloading tools' included) are Carl's business.
 */
export const OURS = 'today.';

/** The check's report: counts of everything, names and identifiers of this project's only. */
export function report(apps, ids) {
  const ours = (id) => id.startsWith(OURS);
  const ourApps = apps.filter((a) => ours(a.attributes.bundleId));
  const ourIds = ids.filter((b) => ours(b.attributes.identifier));
  const others = (n) => (n ? `, and ${n} other${n === 1 ? '' : 's'}, not named here` : '');
  return [
    `The key works. Apps on the account: ${apps.length}.`,
    `This project's (${OURS}*): ${ourApps.length}${others(apps.length - ourApps.length)}.`,
    ...ourApps.map((a) => `  ${a.attributes.name} (${a.attributes.bundleId})`),
    `Registered app IDs: ${ids.length}.`,
    `This project's (${OURS}*): ${ourIds.length}${others(ids.length - ourIds.length)}.`,
    ...ourIds.map(
      (b) => `  ${b.attributes.identifier} (${b.attributes.platform}, "${b.attributes.name}")`,
    ),
  ];
}

/** Every page of a GET (following `links.next`), their `data` items together. */
export async function getAll(path, creds, fetchImpl = fetch) {
  const items = [];
  let url = `${API}${path}`;
  while (url) {
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token(creds)}`, accept: 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new AscError(res.status, body);
    items.push(...(body.data ?? []));
    url = body.links?.next ?? null;
  }
  return items;
}
