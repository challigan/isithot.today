#!/usr/bin/env bash
# Builds the app for testing, or runs one test plan, on the simulator simulator.sh booted (iOS
# build spec, section 18.1). Then writes what happened to the GitHub step summary: the counts,
# and each error or failing test with its file and line (ci/xcresult-summary.mjs). A test plan's
# attachments are exported for the contact sheet, and the UI plan's audit calls' times read from
# them: the slowest, and every call that didn't finish in time.
#
#   apps/ios/ci/test.sh build <UDID>   build-for-testing     -> build/Build.xcresult
#   apps/ios/ci/test.sh Unit <UDID>    the Unit test plan    -> build/Unit.xcresult, build/attachments/Unit
#   apps/ios/ci/test.sh UI <UDID>      the UI test plan      -> build/UI.xcresult, build/attachments/UI
#
# Exits with xcodebuild's status, whatever the summary makes of it.
set -euo pipefail

what="${1:?build, Unit or UI}"
udid="${2:?the simulator UDID simulator.sh printed}"
ios="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build="$ios/build"

case "$what" in
  build)
    name=Build
    action=(build-for-testing)
    ;;
  Unit | UI)
    name="$what"
    action=(test-without-building -testPlan "$what" -parallel-testing-enabled NO)
    ;;
  *)
    echo "test.sh: $what is not build, Unit or UI" >&2
    exit 2
    ;;
esac
result="$build/$name.xcresult"
mkdir -p "$build"
rm -rf "$result"

beautify() {
  if command -v xcbeautify >/dev/null; then xcbeautify --renderer github-actions; else cat; fi
}

set +e
xcodebuild "${action[@]}" \
  -project "$ios/WillItSnow.xcodeproj" \
  -scheme WillItSnow \
  -destination "id=$udid" \
  -derivedDataPath "$build/DerivedData" \
  -clonedSourcePackagesDirPath "$ios/.spm" \
  -disableAutomaticPackageResolution \
  -xcconfig "$ios/Configs/CI-Simulator.xcconfig" \
  -resultBundlePath "$result" 2>&1 | beautify
status=${PIPESTATUS[0]}
set -e

# Into the step summary for people, and the log for agents (the GitHub MCP's get_job_logs
# returns the log, not the summary).
report() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then tee -a "$GITHUB_STEP_SUMMARY"; else cat; fi
}

if [ ! -d "$result" ]; then
  echo "### $name: no result bundle (xcodebuild exited $status; see the log)" | report
  exit "$status"
fi
if [ "$what" = build ]; then
  xcrun xcresulttool get build-results --path "$result" >"$build/$name.build.json" ||
    echo "test.sh: xcresulttool couldn't read the build results" >&2
  node "$ios/ci/xcresult-summary.mjs" build "$build/$name.build.json" | report ||
    echo "test.sh: no summary of the build" >&2
else
  xcrun xcresulttool get test-results summary --path "$result" >"$build/$name.summary.json" ||
    echo "test.sh: xcresulttool couldn't read the test summary" >&2
  xcrun xcresulttool get test-results tests --path "$result" >"$build/$name.tests.json" ||
    echo "test.sh: xcresulttool couldn't read the tests" >&2
  node "$ios/ci/xcresult-summary.mjs" tests "$name" "$build/$name.summary.json" \
    "$build/$name.tests.json" | report || echo "test.sh: no summary of the tests" >&2
  rm -rf "$build/attachments/$name"
  mkdir -p "$build/attachments/$name"
  xcrun xcresulttool export attachments --path "$result" --output-path "$build/attachments/$name" ||
    echo "test.sh: no attachments exported from $name" >&2
  if [ "$what" = UI ]; then
    node "$ios/ci/xcresult-summary.mjs" timings "$build/attachments/$name" | report ||
      echo "test.sh: no audit times" >&2
  fi
fi
exit "$status"
