#!/usr/bin/env bash
# Archives will it snow? in Release for iPhones, and exports the archive for App Store Connect
# (iOS build spec, section 18.3, steps 2 and 4).
#
#   apps/ios/ci/archive.sh unsigned   build/WillItSnow.xcarchive with no signing at all
#                                     (CODE_SIGNING_ALLOWED=NO), for the archive checks before
#                                     signing is proven: ios.yml's archive-check job, and
#                                     ios-release.yml's unsigned build
#   apps/ios/ci/archive.sh signed     the same, signed through App Store Connect (cloud signing:
#                                     -allowProvisioningUpdates with the team key)
#   apps/ios/ci/archive.sh export     build/export/WillItSnow.ipa from the signed archive, as
#                                     ci/ExportOptions.plist says: for App Store Connect, exported
#                                     (not uploaded), signed automatically for Carl's team, and
#                                     with the build number left as it is
#
# Environment:
#   ADS_UNITS       test (Google's demo units; the default) or real, which needs ADMOB_APP_ID,
#                   ADMOB_BANNER_ID, ADMOB_PAGE_BANNER_ID and ADMOB_INTERSTITIAL_ID (repository
#                   variables)
#   BUILD_NUMBER    CFBundleVersion for the app and the widget; Base.xcconfig's 1 when unset
#   ASC_KEY_ID, ASC_ISSUER_ID
#                   for signed and export: the team key, which scripts/asc-key.mjs wrote to
#                   ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8
#   APPLE_TEAM_ID   if set, it must be the team in Configs/Team.xcconfig and ci/ExportOptions.plist
#
# The archive's errors and warnings go to the step summary and the log with their file and line
# (ci/xcresult-summary.mjs, as in ci/test.sh); the export's errors are quoted. Exits with
# xcodebuild's status, or 2 when something it needs is missing.
set -euo pipefail

what="${1:-}"
ios="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build="$ios/build"
archive="$build/WillItSnow.xcarchive"
exported="$build/export"
ads="${ADS_UNITS:-test}"

beautify() {
  if command -v xcbeautify >/dev/null; then xcbeautify --renderer github-actions; else cat; fi
}
# Into the step summary for people, and the log for agents.
report() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then tee -a "$GITHUB_STEP_SUMMARY"; else cat; fi
}
missing() {
  echo "::error::archive.sh: $*"
  exit 2
}

case "$what" in
  unsigned | signed | export) ;;
  *)
    echo "usage: archive.sh unsigned | signed | export" >&2
    exit 2
    ;;
esac

# The team key, for cloud signing.
auth=()
if [ "$what" != unsigned ]; then
  if [ -z "${ASC_KEY_ID:-}" ] || [ -z "${ASC_ISSUER_ID:-}" ]; then
    missing "ASC_KEY_ID and ASC_ISSUER_ID are needed: run this in the testflight environment"
  fi
  key="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
  if [ ! -f "$key" ]; then
    missing "no App Store Connect key in ~/.appstoreconnect/private_keys: run node scripts/asc-key.mjs first"
  fi
  team="$(sed -n 's/^DEVELOPMENT_TEAM = //p' "$ios/Configs/Team.xcconfig")"
  export_team="$(plutil -extract teamID raw -o - "$ios/ci/ExportOptions.plist")"
  if [ "$export_team" != "$team" ]; then
    missing "ci/ExportOptions.plist's teamID is $export_team, but Configs/Team.xcconfig's is $team"
  fi
  if [ -n "${APPLE_TEAM_ID:-}" ] && [ "$APPLE_TEAM_ID" != "$team" ]; then
    missing "APPLE_TEAM_ID (the testflight environment's variable) isn't the team in Configs/Team.xcconfig, $team"
  fi
  auth=(-allowProvisioningUpdates -authenticationKeyPath "$key"
    -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

if [ "$what" = export ]; then
  if [ ! -d "$archive" ]; then missing "no $archive: run archive.sh signed first"; fi
  rm -rf "$exported"
  set +e
  xcodebuild -exportArchive \
    -archivePath "$archive" \
    -exportPath "$exported" \
    -exportOptionsPlist "$ios/ci/ExportOptions.plist" \
    "${auth[@]}" 2>&1 | tee "$build/export.log" | beautify
  status=${PIPESTATUS[0]}
  set -e
  ipa="$exported/WillItSnow.ipa"
  if [ "$status" -eq 0 ] && [ -f "$ipa" ]; then
    echo "### Export: WillItSnow.ipa, $(du -h "$ipa" | cut -f 1)" | report
    exit 0
  fi
  {
    echo "### Export: failed (xcodebuild exited $status)"
    echo
    echo '```'
    grep -E -m 20 'error|Error Domain' "$build/export.log" || echo "(no error lines: see the log)"
    echo '```'
  } | report
  [ "$status" -ne 0 ] || status=1
  exit "$status"
fi

# The archive.
settings=(ADS_UNITS="$ads")
case "$ads" in
  test) ;;
  real)
    if ! [[ ${ADMOB_APP_ID:-} =~ ^ca-app-pub-[0-9]{16}~[0-9]{10}$ ]] ||
      ! [[ ${ADMOB_BANNER_ID:-} =~ ^ca-app-pub-[0-9]{16}/[0-9]{10}$ ]] ||
      ! [[ ${ADMOB_PAGE_BANNER_ID:-} =~ ^ca-app-pub-[0-9]{16}/[0-9]{10}$ ]] ||
      ! [[ ${ADMOB_INTERSTITIAL_ID:-} =~ ^ca-app-pub-[0-9]{16}/[0-9]{10}$ ]]; then
      missing "ads real needs the repository variables ADMOB_APP_ID (ca-app-pub-…~…), ADMOB_BANNER_ID, ADMOB_PAGE_BANNER_ID and ADMOB_INTERSTITIAL_ID (ca-app-pub-…/… each): Settings, Secrets and variables, Actions, Variables"
    fi
    settings+=(ADMOB_APP_ID="$ADMOB_APP_ID" ADMOB_BANNER_ID="$ADMOB_BANNER_ID"
      ADMOB_PAGE_BANNER_ID="$ADMOB_PAGE_BANNER_ID" ADMOB_INTERSTITIAL_ID="$ADMOB_INTERSTITIAL_ID")
    ;;
  *) missing "ADS_UNITS is $ads, not test or real" ;;
esac
if [ -n "${BUILD_NUMBER:-}" ]; then
  if ! [[ $BUILD_NUMBER =~ ^[1-9][0-9]*$ ]]; then missing "BUILD_NUMBER is $BUILD_NUMBER, not a whole number"; fi
  settings+=(CURRENT_PROJECT_VERSION="$BUILD_NUMBER")
fi
if [ "$what" = unsigned ]; then
  signing=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=)
else
  signing=("${auth[@]}")
fi

mkdir -p "$build"
# Exactly the versions in Package.resolved, as in ios.yml; the archive then resolves nothing.
xcodebuild -resolvePackageDependencies \
  -project "$ios/WillItSnow.xcodeproj" -scheme WillItSnow \
  -clonedSourcePackagesDirPath "$ios/.spm" -onlyUsePackageVersionsFromResolvedFile

result="$build/Archive.xcresult"
rm -rf "$archive" "$result"
set +e
xcodebuild archive \
  -project "$ios/WillItSnow.xcodeproj" \
  -scheme WillItSnow \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$archive" \
  -derivedDataPath "$build/ArchiveData" \
  -clonedSourcePackagesDirPath "$ios/.spm" \
  -disableAutomaticPackageResolution \
  -resultBundlePath "$result" \
  "${signing[@]}" "${settings[@]}" 2>&1 | beautify
status=${PIPESTATUS[0]}
set -e

if [ -d "$result" ]; then
  xcrun xcresulttool get build-results --path "$result" >"$build/Archive.build.json" ||
    echo "archive.sh: xcresulttool couldn't read the build results" >&2
  node "$ios/ci/xcresult-summary.mjs" build "$build/Archive.build.json" |
    sed "1s/^### Build:/### Archive, $what, ads $ads:/" | report ||
    echo "archive.sh: no summary of the archive" >&2
else
  echo "### Archive, $what: no result bundle (xcodebuild exited $status; see the log)" | report
fi
if [ "$status" -eq 0 ] && [ ! -d "$archive/Products/Applications/WillItSnow.app" ]; then
  echo "::error::archive.sh: xcodebuild succeeded but $archive holds no WillItSnow.app"
  status=1
fi
exit "$status"
