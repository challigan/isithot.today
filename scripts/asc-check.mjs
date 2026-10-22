#!/usr/bin/env node
/**
 * Proves the App Store Connect key works, and changes nothing: counts the account's apps and its
 * registered app IDs, and names only this project's (`today.*`, asc.mjs `report`), since the repo
 * is public and so is the job's log.
 * Run by .github/workflows/asc-check.yml in the protected `testflight` environment.
 */
import { AscError, credentials, getAll, report } from './asc.mjs';

const TEAM_ID = /^[A-Z0-9]{10}$/;

try {
  const creds = credentials();
  const team = process.env.APPLE_TEAM_ID?.trim() ?? '';
  console.log(
    TEAM_ID.test(team)
      ? 'APPLE_TEAM_ID is set (10 characters).'
      : 'APPLE_TEAM_ID is missing or not 10 capital letters and digits: set it under Settings → Secrets and variables → Actions → Variables.',
  );

  const apps = await getAll('/v1/apps?limit=200&fields[apps]=name,bundleId', creds);
  const ids = await getAll(
    '/v1/bundleIds?limit=200&fields[bundleIds]=name,identifier,platform',
    creds,
  );
  console.log(`\n${report(apps, ids).join('\n')}`);
  if (!TEAM_ID.test(team)) process.exitCode = 1;
} catch (err) {
  console.error(err.message);
  if (err instanceof AscError && err.status === 401) {
    console.error(
      "Check that it is a Team key (not an Individual key), and that ASC_KEY_ID and ASC_ISSUER_ID are that key's.",
    );
  }
  if (err instanceof AscError && err.status === 403) {
    console.error('The key signs in but may not do this: it needs Admin access.');
  }
  process.exitCode = 1;
}
