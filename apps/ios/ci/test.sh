#!/usr/bin/env bash
# Builds the app for testing, or runs one test plan, on the simulator simulator.sh booted (iOS
# build spec, section 18.1). Then writes what happened to the GitHub step summary: the counts,
# and each error or failing test with its file and line (ci/xcresult-summary.mjs). A test plan's
# attachments are exported for the contact sheet. The audit calls' times are read from `UI`'s and
# `Audit`'s (below): the slowest, and every call that didn't finish in time; so is every touch the
# system cancelled in the app (`gesture-cancelled`), a tap played again among them; and the
# upgrade sheet's screenshot, App Review's (docs/SETUP.md), is copied from `UI`'s to
# review/app-upgrade.png beside them. The StoreKit plan, on the iOS 26.2 simulator
# (simulator.sh 26.2), runs with test timeouts on and 60 seconds for each test (XCTest rounds an
# allowance up to whole minutes, so none is shorter), so a purchase sheet that hangs (FB22836426)
# fails its test rather than the job (ios.yml's storekit job budgets for all 18 hanging).
#
# The UI plan runs in two jobs that start together (ios.yml's ios and audits), as its screen
# audits took 33 of its 76 minutes on PR #54's first run: `UI` runs the plan without them
# (-skip-testing:), and `Audit` runs only them, from the same plan (-only-testing:), so Xcode's
# own plan still holds every UI test. They are AUDITS, below. `Audit` fails, saying so, when no
# test of AUDITS ran (the class renamed or moved, which xcodebuild runs as nothing and passes;
# xcresult-summary.mjs `split`).
#
# ONLY_TESTING, set only by an iteration run (ios.yml's `only` input, phase 8.4a), names the tests
# to run as xcodebuild does, Target/Class or Target/Class/method, separated by commas or spaces
# (WillItSnowUITests/NotificationsTests/testWhereYouAre). A plan then runs only the named tests
# whose target is one of its own, each passed as -only-testing:, and a plan with none of them
# isn't run and says so; a build builds everything. A name that isn't Target/Class[/method], or
# whose target is in no plan, stops the script before anything runs; a name in AUDITS is `Audit`'s
# and every other UI test's is `UI`'s; and a name of the plan's own that ran no test (a misspelt
# class or method, which xcodebuild runs as nothing and passes) fails the step once the plan has
# run, saying which (xcresult-summary.mjs `ran`), so a misspelt name never passes. Unset or empty,
# as on every pull-request and merge run, the whole plan runs (for `UI` and `Audit`, their part).
#
#   apps/ios/ci/test.sh build <UDID>      build-for-testing        -> build/Build.xcresult
#   apps/ios/ci/test.sh Unit <UDID>       the Unit test plan       -> build/Unit.xcresult, build/attachments/Unit
#   apps/ios/ci/test.sh UI <UDID>         the UI test plan but     -> build/UI.xcresult, build/attachments/UI
#                                         AUDITS                      and build/attachments/review
#   apps/ios/ci/test.sh Audit <UDID>      the UI plan's AUDITS     -> build/Audit.xcresult, build/attachments/Audit
#   apps/ios/ci/test.sh StoreKit <UDID>   the StoreKit test plan   -> build/StoreKit.xcresult, build/attachments/StoreKit
#
# Exits with xcodebuild's status, whatever the summary makes of it.
set -euo pipefail

what="${1:?build, Unit, UI, Audit or StoreKit}"
udid="${2:?the simulator UDID simulator.sh printed}"
ios="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build="$ios/build"
# The screen audits (UITests/HomeAuditTests.swift), which `Audit` runs and `UI` leaves out.
AUDITS=WillItSnowUITests/HomeAuditTests

case "$what" in
  build)
    name=Build
    action=(build-for-testing)
    ;;
  Unit | UI)
    name="$what"
    plan="$what"
    action=(test-without-building -testPlan "$plan" -parallel-testing-enabled NO)
    ;;
  Audit)
    name="$what"
    plan=UI
    action=(test-without-building -testPlan "$plan" -parallel-testing-enabled NO)
    ;;
  StoreKit)
    name="$what"
    plan="$what"
    action=(test-without-building -testPlan "$what" -parallel-testing-enabled NO
      -test-timeouts-enabled YES -default-test-execution-time-allowance 60)
    ;;
  *)
    echo "test.sh: $what is not build, Unit, UI, Audit or StoreKit" >&2
    exit 2
    ;;
esac

# Into the step summary for people, and the log for agents (the GitHub MCP's get_job_logs
# returns the log, not the summary).
report() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then tee -a "$GITHUB_STEP_SUMMARY"; else cat; fi
}

# The test targets of the plan named $1, one a line, from its file.
plan_targets() {
  node -e 'for (const t of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    .testTargets) console.log(t.target.name)' "$ios/TestPlans/$1.xctestplan"
}

# Whether the test named $1 (Target/Class[/method]) is in AUDITS: `Audit`'s, not `UI`'s.
in_audits() {
  [[ $1 == "$AUDITS" || $1 == "$AUDITS"/* ]]
}

# ONLY_TESTING's names (above), and those in this plan as -only-testing: arguments.
tests=()
if [ "$what" != build ]; then
  IFS=$', \t\n' read -r -d '' -a fields <<<"${ONLY_TESTING:-}" || true
  for field in ${fields[@]+"${fields[@]}"}; do
    if [ -n "$field" ]; then tests+=("$field"); fi
  done
fi
only=()
if [ ${#tests[@]} -gt 0 ]; then
  mine="$(plan_targets "$plan")"
  every="$(plan_targets Unit && plan_targets UI && plan_targets StoreKit)"
  for test in "${tests[@]}"; do
    if ! [[ $test =~ ^[A-Za-z0-9_]+/[A-Za-z0-9_]+(/[A-Za-z0-9_]+)?$ ]]; then
      echo "test.sh: ONLY_TESTING's \"$test\" isn't a test's name: Target/Class or" \
        "Target/Class/method" >&2
      exit 2
    fi
    target="${test%%/*}"
    if ! grep -qxF "$target" <<<"$every"; then
      echo "test.sh: ONLY_TESTING's \"$test\" names no test plan's target" \
        "(${every//$'\n'/, })" >&2
      exit 2
    fi
    if ! grep -qxF "$target" <<<"$mine"; then continue; fi
    if [ "$what" = UI ] && in_audits "$test"; then continue; fi
    if [ "$what" = Audit ] && ! in_audits "$test"; then continue; fi
    only+=("-only-testing:$test")
  done
  if [ ${#only[@]} -eq 0 ]; then
    echo "### $what: not run (ONLY_TESTING names none of its tests: ${tests[*]})" | report
    exit 0
  fi
  echo "### $what: only ${only[*]#-only-testing:}" | report
  action+=("${only[@]}")
elif [ "$what" = UI ]; then
  action+=("-skip-testing:$AUDITS")
elif [ "$what" = Audit ]; then
  action+=("-only-testing:$AUDITS")
fi

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
  # Each test an iteration run named ran here, or the step fails, whatever xcodebuild said.
  if [ ${#only[@]} -gt 0 ] && ! node "$ios/ci/xcresult-summary.mjs" ran "$name" \
    "$build/$name.tests.json" "${only[@]#-only-testing:}" | report; then
    if [ "$status" -eq 0 ]; then status=1; fi
  fi
  # A whole run of AUDITS ran a test of it, or the step fails, whatever xcodebuild said.
  if [ "$what" = Audit ] && [ ${#only[@]} -eq 0 ] && ! node "$ios/ci/xcresult-summary.mjs" split \
    "$name" "$build/$name.tests.json" "$AUDITS" | report; then
    if [ "$status" -eq 0 ]; then status=1; fi
  fi
  rm -rf "$build/attachments/$name"
  mkdir -p "$build/attachments/$name"
  xcrun xcresulttool export attachments --path "$result" --output-path "$build/attachments/$name" ||
    echo "test.sh: no attachments exported from $name" >&2
  if [ "$what" = UI ] || [ "$what" = Audit ]; then
    # The audit calls' times: the screen audits' in `Audit`, the sheets' and the picker's in `UI`.
    node "$ios/ci/xcresult-summary.mjs" timings "$build/attachments/$name" | report ||
      echo "test.sh: no audit times" >&2
    # Every touch the system cancelled, a tap played again among them, which a passing test
    # wouldn't otherwise show.
    node "$ios/ci/xcresult-summary.mjs" cancels "$build/attachments/$name" | report ||
      echo "test.sh: no list of cancelled touches" >&2
  fi
  if [ "$what" = UI ]; then
    # The upgrade sheet's screenshot for App Review (docs/SETUP.md, "The app's purchase"), as
    # review/app-upgrade.png in the attachments: the export names each file by a UUID.
    review="$build/attachments/review"
    rm -rf "$review"
    if shot="$(node "$ios/ci/xcresult-summary.mjs" attachment "$build/attachments/$name" \
      app-upgrade)"; then
      mkdir -p "$review"
      cp "$shot" "$review/app-upgrade.png" || echo "test.sh: couldn't copy $shot" >&2
    else
      echo "test.sh: no app-upgrade screenshot for App Review" >&2
    fi
  fi
fi
exit "$status"
