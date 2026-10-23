#!/usr/bin/env bash
# Uploads build/export/WillItSnow.ipa to App Store Connect for TestFlight (iOS build spec,
# section 18.3, step 5), the first way that works:
#
#   1. xcrun altool --upload-app, with the team key;
#   2. the signed archive exported again with destination upload (xcodebuild -exportArchive);
#   3. fastlane 2.241.1's pilot (upload_to_testflight), installed only then.
#
# If App Store Connect refuses the build itself (a validation error, such as a missing icon), no
# other way is tried, since each would get the same answer; the step summary quotes the reason.
# Then Carl uploads from Xcode, or the cause is fixed. Says which way worked, or why none did, in
# the step summary and the log.
#
# Environment: ASC_KEY_ID and ASC_ISSUER_ID, with the key where scripts/asc-key.mjs wrote it.
#
# Usage: apps/ios/ci/upload.sh
set -euo pipefail

ios="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$ios/../.." && pwd)"
build="$ios/build"
archive="$build/WillItSnow.xcarchive"
ipa="$build/export/WillItSnow.ipa"
log="$build/upload.log"
keys="$HOME/.appstoreconnect/private_keys"
FASTLANE=2.241.1

beautify() {
  if command -v xcbeautify >/dev/null; then xcbeautify --renderer github-actions; else cat; fi
}
report() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then tee -a "$GITHUB_STEP_SUMMARY"; else cat; fi
}

if [ -z "${ASC_KEY_ID:-}" ] || [ -z "${ASC_ISSUER_ID:-}" ]; then
  echo "::error::upload.sh: ASC_KEY_ID and ASC_ISSUER_ID are needed: run this in the testflight environment"
  exit 2
fi
key="$keys/AuthKey_$ASC_KEY_ID.p8"
for file in "$ipa" "$key"; do
  if [ ! -f "$file" ]; then
    echo "::error::upload.sh: no $(basename "$file"): run archive.sh export (and scripts/asc-key.mjs) first"
    exit 2
  fi
done
: >"$log"

# Whether App Store Connect refused the build itself, rather than the upload failing.
refused() {
  grep -E -e 'ITMS-[0-9]+|VALIDATION_ERROR|Validation failed' "$log" >/dev/null
}

with_altool() {
  xcrun altool --upload-app -f "$ipa" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" \
    2>&1 | tee -a "$log"
  return "${PIPESTATUS[0]}"
}

with_xcodebuild() {
  local options="$build/ExportOptions-upload.plist"
  cp "$ios/ci/ExportOptions.plist" "$options"
  plutil -replace destination -string upload "$options"
  rm -rf "$build/upload"
  xcodebuild -exportArchive \
    -archivePath "$archive" \
    -exportPath "$build/upload" \
    -exportOptionsPlist "$options" \
    -allowProvisioningUpdates -authenticationKeyPath "$key" \
    -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
    2>&1 | tee -a "$log" | beautify
  return "${PIPESTATUS[0]}"
}

with_fastlane() {
  local json="$keys/fastlane.json" status=0
  gem install fastlane -v "$FASTLANE" --no-document >/dev/null || return 1
  node "$repo/scripts/asc-key.mjs" --fastlane "$json" || return 1
  FASTLANE_SKIP_UPDATE_CHECK=1 FASTLANE_HIDE_CHANGELOG=1 \
    fastlane "_${FASTLANE}_" pilot upload --ipa "$ipa" --api_key_path "$json" \
    --skip_waiting_for_build_processing true 2>&1 | tee -a "$log" || status=${PIPESTATUS[0]}
  rm -f "$json"
  return "$status"
}

upload_with() {
  case "$1" in
    altool) with_altool ;;
    xcodebuild) with_xcodebuild ;;
    fastlane) with_fastlane ;;
  esac
}

how=""
for way in altool xcodebuild fastlane; do
  echo "upload.sh: uploading with $way"
  if upload_with "$way"; then
    how="$way"
    break
  fi
  if refused; then break; fi
  echo "::warning::upload.sh: the upload with $way failed; trying the next way"
done

if [ -n "$how" ]; then
  echo "### Upload: sent to App Store Connect with $how; TestFlight lists it once it has processed" |
    report
  exit 0
fi
{
  if refused; then
    echo "### Upload: App Store Connect refused the build"
  else
    echo "### Upload: failed with altool, xcodebuild and fastlane (see the log); upload from Xcode instead"
  fi
  echo
  echo '```'
  grep -E -m 20 -e 'ITMS-[0-9]+|VALIDATION_ERROR|Validation failed|[Ee]rror' "$log" ||
    echo "(no error lines: see the log)"
  echo '```'
} | report
exit 1
