#!/usr/bin/env bash
# Shows the evening notification's banner on the simulator the UI plan ran on (iOS build spec,
# section 12.4's T3, and phase 8's exit): simctl push of the payload packages/mobile generates
# from the server's own alertPush(), first with the app open on Durham, where the app's
# willPresent shows it, then with the app closed, on the Home Screen, where the system does.
#
# Every wait is a condition read by ci/banner.mjs, with a deadline that is only a reporting
# limit, never a guess at how long something takes: the app's own line once its answer is on
# screen in its colours (DebugHooks' `debug-notifications shown`, on the app's standard output,
# which also gives the real notification permission, so a refused one is named, not guessed
# at); a baseline once two screenshots in a row are the same; after each push, screenshots one
# after another until one shows a banner (banner.mjs: a block of rows changed across the width
# within the top quarter, ending above its foot, so neither the app's redraw below it nor a
# screen dimmed all over passes); then, over the app, screenshots until that band is the
# baseline's again, the banner gone, before the app is closed. Each read is printed with its
# time since the push. A missing line is reported and the pushes still made, so the banners'
# evidence is kept. On main's run on 1d643d3 one screenshot taken 2 s after each push saw no
# banner, and why is not known (docs/DECISIONS.md, "What main's run on 1d643d3 showed"), so once
# the step ends, however it ends, the simulator's log of it is read (`log show`, from the step's
# start: no background process, and nothing logging while the screenshots are timed) into
# Push/simulator.log, and the app's standard output is kept as Push/app-stdout.txt, both
# uploaded with the attachments; the banners' screenshots go to Push for the contact sheet.
#
# The banner needs notifications allowed, which simctl can't grant (they are no simctl privacy
# service): NotificationPermissionTests, in the UI plan on this same simulator, allows them at
# the real prompt. The app is the one the UI plan installed. -uitest keeps the page still and
# -clock fixed its minute, and simulator.sh's status bar says 9:41, so only the banner changes.
#
# Usage: apps/ios/ci/push.sh <UDID>
set -euo pipefail

udid="${1:?the simulator UDID simulator.sh printed}"
ios="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID=today.willitsnow.app
PAYLOAD="$ios/Packages/IsItCore/Tests/IsItTestSupport/Resources/Fixtures/Payloads/evening.apns"
shots="$ios/build/attachments/Push"
banner=(node "$ios/ci/banner.mjs")
# The step's start, as the simulator's log reads a time: the simulator keeps its host's clock and
# time zone.
began="$(date '+%Y-%m-%d %H:%M:%S')"
# What the simulator logs of a notification's way: UserNotifications and BulletinBoard in every
# process, SpringBoard, which shows banners, usernotificationsd, which delivers them,
# CoreSimulatorBridge, which takes simctl's push, and the app. apsd's reconnect loop writes
# 100,000 to 330,000 lines a minute in every run, so of it only the lines naming the app, and its
# errors and faults.
PREDICATE='subsystem BEGINSWITH "com.apple.UserNotifications"
  OR subsystem BEGINSWITH "com.apple.BulletinBoard"
  OR process == "SpringBoard" OR process == "usernotificationsd"
  OR process == "CoreSimulatorBridge" OR process == "WillItSnow"
  OR (process == "apsd" AND (eventMessage CONTAINS "today.willitsnow.app"
    OR messageType == error OR messageType == fault))'
# The baselines, which only the comparisons need.
work="$(mktemp -d)"
# The simulator's log from the step's start, once it has ended, however it ended: a bounded read
# of what the simulator kept, so nothing runs on after the step. A log that can't be read is
# warned of, failing nothing, as the banners are what the step judges.
finish() {
  local code=0 log="$shots/simulator.log"
  if [ -d "$shots" ]; then
    xcrun simctl spawn "$udid" log show --style compact --info --debug --start "$began" \
      --predicate "$PREDICATE" >"$log" 2>&1 || code=$?
    if [ "$code" -ne 0 ]; then
      echo "::warning::push.sh: The simulator's log couldn't be read (log show exited $code): $(head -n 1 "$log")"
    else
      echo "Push/simulator.log: $(wc -l <"$log" | tr -d ' ') lines of the simulator's log since $began"
    fi
  fi
  rm -rf "$work"
}
trap finish EXIT
status=0

fail() {
  echo "::error::push.sh: $*"
  status=1
}

# The screen at rest as the baseline for $1 (app or home), then the push, the banner looked for
# $2 ("over the app") and kept as $3, each read timed from the push; and over the app, the banner
# gone before the app is closed, so the Home Screen's baseline is taken without it.
look() {
  local base="$work/before-$1.png" code=0
  echo "The screen $2 at rest: screenshots until two in a row are the same"
  if ! "${banner[@]}" settle "$udid" "$base" --within 30; then
    fail "The screen $2 never came to rest for a baseline within 30 s: each read is above"
    return
  fi
  if [ "$1" = app ]; then
    echo "simctl push, then screenshots until one shows the banner $2, and until it has gone"
    "${banner[@]}" push "$udid" "$APP_ID" "$PAYLOAD" "$base" "$shots/$3" --within 20 --gone 40 ||
      code=$?
  else
    echo "simctl push, then screenshots until one shows the banner $2"
    "${banner[@]}" push "$udid" "$APP_ID" "$PAYLOAD" "$base" "$shots/$3" --within 20 || code=$?
  fi
  case "$code" in
    0) ;;
    3)
      echo "::error::push.sh: simctl push couldn't deliver $(basename "$PAYLOAD") (see the log)"
      exit 1
      ;;
    4) fail "The banner $2 hadn't gone 40 s after simctl push: each screenshot is above, with its time since the push" ;;
    *) fail "No banner $2 within 20 s of simctl push: each screenshot is above, with its time since the push; Push/simulator.log has the simulator's record of it" ;;
  esac
}

rm -rf "$shots"
mkdir -p "$shots"

# The answer for Durham, the payload's place, at the fixture's minute, with the app's standard
# output in a file, where it says once the answer is on screen, and what the permission is.
console="$shots/app-stdout.txt"
if ! xcrun simctl launch --terminate-running-process --stdout="$console" "$udid" "$APP_ID" \
  -uitest -noads 1 -resetStore -fixture durham-tomorrow -place place=durham-gb -clock fixed \
  -notifications system >&2; then
  echo "::error::push.sh: couldn't launch $APP_ID on $udid (the UI plan installs it)"
  exit 1
fi
echo "The app's answer on screen, and its notification permission"
if "${banner[@]}" line "$console" "debug-notifications shown" --within 60; then
  said="$(grep -m 1 '^debug-notifications shown' "$console")"
  said="${said#debug-notifications shown }"
  # Whether the app's line holds the setting $1 ("alertSetting=enabled").
  reads() { case " $said " in *" $1 "*) return 0 ;; *) return 1 ;; esac }
  if ! reads authorizationStatus=authorized || ! reads alertSetting=enabled; then
    fail "Notifications aren't allowed on this simulator, as the app reads them: $said (NotificationPermissionTests allows them at the prompt)"
  fi
else
  fail "The app never said its answer was on screen within 60 s of its launch (Push/app-stdout.txt), so the permission it reads isn't known"
fi

look app "over the app" notification-banner-app.png

# Closed, the app has no say: the system shows the banner. An app that had already gone (a crash)
# leaves the first shot showing the Home Screen's banner, not the app's.
if ! xcrun simctl terminate "$udid" "$APP_ID" >&2; then
  fail "$APP_ID wasn't running after its banner, so notification-banner-app.png doesn't show it over the app (see the log)"
fi
look home "on the Home Screen" notification-banner-home.png

if [ "$status" -eq 0 ]; then
  line="### Notification banner: shown over the app and on the Home Screen (simctl push)"
else
  line="### Notification banner: failed (see the errors above)"
fi
echo "$line"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$line" >>"$GITHUB_STEP_SUMMARY"; fi
exit "$status"
