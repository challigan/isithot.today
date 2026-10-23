#!/usr/bin/env node
/**
 * Sets a TestFlight build's "What to test" from the release job's `notes` input (iOS build spec,
 * section 21.1), in English (UK), the app's primary language. ios-release.yml runs it after the
 * upload, with the key from the `testflight` environment. App Store Connect lists a build a few
 * minutes after its upload, while it processes, so this waits for it, for up to 20 minutes. It
 * never fails the job, since the build is uploaded either way: a problem is a warning, and the
 * step summary says to type the notes in App Store Connect.
 *
 *   NOTES=<text> BUILD_NUMBER=<CFBundleVersion> node scripts/asc-notes.mjs
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AscError, credentials, getAll, request } from './asc.mjs';

export const BUNDLE_ID = 'today.willitsnow.app';
export const LOCALE = 'en-GB';
/** App Store Connect's limit for What to test. */
export const MAX_LENGTH = 4000;

/** The notes trimmed and cut to MAX_LENGTH; `{ text, cut }`. */
export function clip(notes) {
  const text = notes.trim();
  return text.length > MAX_LENGTH
    ? { text: text.slice(0, MAX_LENGTH), cut: true }
    : { text, cut: false };
}

/** Sets What to test on the build, updating its localisation for `locale` or adding one. */
async function write(buildId, notes, locale, creds, fetchImpl) {
  const type = 'betaBuildLocalizations';
  const localisations = await getAll(
    `/v1/builds/${buildId}/betaBuildLocalizations?fields[betaBuildLocalizations]=locale,whatsNew`,
    creds,
    fetchImpl,
  );
  const existing = localisations.find((l) => l.attributes?.locale === locale);
  if (existing) {
    await request(
      'PATCH',
      `/v1/betaBuildLocalizations/${existing.id}`,
      creds,
      { data: { type, id: existing.id, attributes: { whatsNew: notes } } },
      fetchImpl,
    );
    return 'updated';
  }
  await request(
    'POST',
    '/v1/betaBuildLocalizations',
    creds,
    {
      data: {
        type,
        attributes: { locale, whatsNew: notes },
        relationships: { build: { data: { type: 'builds', id: buildId } } },
      },
    },
    fetchImpl,
  );
  return 'created';
}

/**
 * Waits for build `version` (its CFBundleVersion) of the app to appear, then sets its What to
 * test. While it processes, App Store Connect may refuse the change (409), so that is tried again
 * until the time is up. Returns `{ state, action }`: the build's processing state, and whether
 * the localisation was created or updated.
 */
export async function setWhatToTest(
  { creds, version, notes, bundleId = BUNDLE_ID, locale = LOCALE },
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    waitMs = 20 * 60_000,
    pollMs = 30_000,
  } = {},
) {
  const apps = await getAll(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId`,
    creds,
    fetchImpl,
  );
  const app = apps.find((a) => a.attributes?.bundleId === bundleId);
  if (!app) throw new Error(`App Store Connect has no app record for ${bundleId}`);

  const deadline = now() + waitMs;
  for (;;) {
    const [build] = await getAll(
      `/v1/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(version)}` +
        '&fields[builds]=version,processingState&limit=1',
      creds,
      fetchImpl,
    );
    if (build) {
      try {
        const action = await write(build.id, notes, locale, creds, fetchImpl);
        return { state: build.attributes?.processingState ?? 'UNKNOWN', action };
      } catch (err) {
        if (!(err instanceof AscError && err.status === 409) || now() >= deadline) throw err;
      }
    } else if (now() >= deadline) {
      throw new Error(
        `build ${version} wasn't in App Store Connect after ${Math.round(waitMs / 60_000)} minutes`,
      );
    }
    await sleep(pollMs);
  }
}

/** What the step says, in the log and the step summary. */
function say(lines) {
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const version = process.env.BUILD_NUMBER?.trim() ?? '';
  const { text, cut } = clip(process.env.NOTES ?? '');
  if (!text) {
    say(['### What to test: no notes given, so left as it is']);
  } else {
    try {
      if (!/^\d+$/.test(version)) throw new Error('BUILD_NUMBER is missing');
      const { state, action } = await setWhatToTest({ creds: credentials(), version, notes: text });
      const lines = [`### What to test: ${action} for build ${version} (${state.toLowerCase()})`];
      if (cut)
        lines.push('', `The notes were cut to App Store Connect's ${MAX_LENGTH} characters.`);
      if (state === 'FAILED' || state === 'INVALID') {
        console.log(
          `::warning::asc-notes.mjs: App Store Connect marked build ${version} ${state.toLowerCase()}: see the email it sent`,
        );
        lines.push('', `App Store Connect marked the build ${state.toLowerCase()}.`);
      }
      say(lines);
    } catch (err) {
      console.log(`::warning::asc-notes.mjs: What to test isn't set: ${err.message}`);
      say([
        `### What to test: not set (${err.message})`,
        '',
        `Type it in App Store Connect: TestFlight, build ${version || '?'}, Test Details.`,
      ]);
    }
  }
}
