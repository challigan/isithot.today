#!/usr/bin/env node
/**
 * Writes the App Store Connect team key for xcodebuild and altool (iOS build spec, section 18.3,
 * step 1): ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8, mode 600, from ASC_KEY_P8 read
 * as asc.mjs keyPem reads it (the .p8 text however it was pasted, or base64). With
 * `--fastlane <path>` it writes fastlane's key file instead, for apps/ios/ci/upload.sh's last way
 * to upload. Prints neither the key nor its ID. ios-release.yml deletes the folder in a step that
 * always runs.
 *
 *   node scripts/asc-key.mjs [--fastlane <path>]
 */
import { credentials, writeFastlaneKey, writeKey } from './asc.mjs';

const args = process.argv.slice(2);
try {
  if (args.length === 0) {
    writeKey(credentials());
    console.log('Wrote the App Store Connect key to ~/.appstoreconnect/private_keys (mode 600).');
  } else if (args.length === 2 && args[0] === '--fastlane') {
    writeFastlaneKey(credentials(), args[1]);
    console.log("Wrote fastlane's App Store Connect key file (mode 600).");
  } else {
    console.error('usage: asc-key.mjs [--fastlane <path>]');
    process.exitCode = 2;
  }
} catch (err) {
  console.error(`::error::asc-key.mjs: ${err.message}`);
  process.exitCode = 1;
}
