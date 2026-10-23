#!/usr/bin/env tsx
/**
 * One push to a made-up device with the APNs sandbox key, from wherever this runs (GitHub's
 * ubuntu runners, daily: .github/workflows/alerts-smoke.yml). Passes on Apple's 400
 * BadDeviceToken, which proves the key and the path to Apple; fails on anything else. Reads
 * APNS_TEAM_ID, APNS_KEY_ID_SANDBOX and APNS_KEY_SANDBOX, and prints none of them.
 *
 *   pnpm tsx scripts/alerts-smoke.ts
 */
import { apnsSmoke } from '../packages/server/src/apns';

const result = await apnsSmoke((name) => process.env[name], { now: Date.now() });
console.log(`APNs sandbox smoke ${result.ok ? 'passed' : 'failed'}: ${result.line}`);
if (!result.ok) process.exitCode = 1;
