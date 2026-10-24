#!/usr/bin/env bash
# Builds the app in Release for the simulator and checks what section 9.8 of the iOS build spec
# promises of a Release build: no debug hook compiled in, no fixture bundled, and the widget
# with no ads code. Phase 0.4's scripts/check-archive.sh makes these checks and more on the
# signed App Store archive; this one needs no signing, so every pull request runs it.
#
# Usage: apps/ios/ci/release-check.sh
set -euo pipefail

ios="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$ios/../.." && pwd)"
data="$ios/build/ReleaseData"

beautify() {
  if command -v xcbeautify >/dev/null; then xcbeautify --renderer github-actions; else cat; fi
}

xcodebuild build \
  -project "$ios/WillItSnow.xcodeproj" \
  -scheme WillItSnow \
  -configuration Release \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath "$data" \
  -clonedSourcePackagesDirPath "$ios/.spm" \
  -disableAutomaticPackageResolution \
  ARCHS=arm64 CODE_SIGNING_ALLOWED=NO 2>&1 | beautify

app="$data/Build/Products/Release-iphonesimulator/WillItSnow.app"
widget="$app/PlugIns/WillItSnowWidgets.appex"
status=0
# Reads all of its input, unlike grep -q, so under pipefail the command before it never dies of
# SIGPIPE and turns a match into a miss.
contains() { grep -F -e "$1" >/dev/null; }
fail() {
  echo "::error::release-check.sh: $*"
  status=1
}

[ -d "$app" ] || {
  echo "::error::release-check.sh: no $app"
  exit 1
}
[ -x "$widget/WillItSnowWidgets" ] || fail "the widget extension isn't embedded in the app"

# DebugHooks.swift's launch arguments: Release compiles a stub that names none of them. The
# optimiser builds a literal of 15 bytes or fewer in instructions, where strings(1) can't see it,
# so swift-small-strings.mjs reads those (as scripts/check-archive.sh does).
binaries=("$app/WillItSnow" "$widget/WillItSnowWidgets")
for framework in "$app"/Frameworks/*.framework; do
  if [ -d "$framework" ]; then
    binaries+=("$framework/$(basename "$framework" .framework)")
  fi
done
for binary in "${binaries[@]}"; do
  [ -f "$binary" ] || continue
  text="$(strings -a "$binary" && node "$repo/scripts/swift-small-strings.mjs" "$binary")"
  for hook in -uitest -fixture; do
    if contains "$hook" <<<"$text"; then
      fail "$(basename "$binary") contains the debug hook $hook"
    fi
  done
done

# EXCLUDED_SOURCE_FILE_NAMES leaves the fixtures out of Release. Each fixture says what it is
# in its _fixture block.
if [ -e "$app/Fixtures" ] || grep -rlF --include='*.json' '"_fixture"' "$app" | contains /; then
  fail "the Release app bundles the fixtures"
fi

# The widget never links IsItAds, so no Google Mobile Ads, dynamic or static.
if otool -L "$widget/WillItSnowWidgets" | contains GoogleMobileAds ||
  strings -a "$widget/WillItSnowWidgets" | contains GADMobileAds; then
  fail "the widget links Google Mobile Ads"
fi

# Nor IsItLocation: no location API in the widget, which has no purpose string.
if strings -a "$widget/WillItSnowWidgets" | contains CLLocationManager; then
  fail "the widget links the app's location code"
fi

if [ "$status" -eq 0 ]; then
  line="### Release build: no debug hooks, no fixtures, no ads or location code in the widget"
else
  line="### Release build: failed its checks (see the errors above)"
fi
echo "$line"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$line" >>"$GITHUB_STEP_SUMMARY"; fi
exit "$status"
