#!/usr/bin/env bash
# Shows the evening notification's banner on the simulator the UI plan ran on (iOS build spec,
# section 12.4's T3, and phase 8's exit): simctl push of the payload packages/mobile generates
# from the server's own alertPush(), first with the app open on Durham, where the app's
# willPresent shows it, then with the app closed, on the Home Screen, where the system does. Each
# banner's screenshot must differ from the one taken just before its push, or the step fails
# naming the likely cause; both go to build/attachments/Push for the contact sheet.
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
# The screenshots before each push, which only the comparison needs.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
status=0

fail() {
  echo "::error::push.sh: $*"
  status=1
}

screenshot() {
  xcrun simctl io "$udid" screenshot "$1" >&2
}

# The screen as $1, then the payload pushed and, once its banner is down, the screen as $2.
push() {
  screenshot "$1"
  if ! xcrun simctl push "$udid" "$APP_ID" "$PAYLOAD" >&2; then
    echo "::error::push.sh: simctl push couldn't deliver $(basename "$PAYLOAD") (see the log)"
    exit 1
  fi
  sleep 2
  screenshot "$2"
}

rm -rf "$shots"
mkdir -p "$shots"

# The answer for Durham, the payload's place, at the fixture's minute. Nothing here can wait on
# the app (there is no XCUITest to ask), so 12 seconds for the launch and the answer's paint.
if ! xcrun simctl launch --terminate-running-process "$udid" "$APP_ID" -uitest -noads 1 \
  -resetStore -fixture durham-tomorrow -place place=durham-gb -clock fixed \
  -notifications system >&2; then
  echo "::error::push.sh: couldn't launch $APP_ID on $udid (the UI plan installs it)"
  exit 1
fi
sleep 12
push "$work/before-app.png" "$shots/notification-banner-app.png"
if cmp -s "$work/before-app.png" "$shots/notification-banner-app.png"; then
  fail "No banner over the app after simctl push: notifications aren't allowed on this simulator (NotificationPermissionTests allows them), or willPresent didn't show it"
fi

# Closed, the app has no say: the system shows the banner. An app that had already gone (a crash)
# leaves the first shot showing the Home Screen's banner, not the app's. Then long enough for the
# first banner to have gone, so the shot before the second push is the Home Screen alone.
if ! xcrun simctl terminate "$udid" "$APP_ID" >&2; then
  fail "$APP_ID wasn't running after its banner, so notification-banner-app.png doesn't show it over the app (see the log)"
fi
sleep 8
push "$work/before-home.png" "$shots/notification-banner-home.png"
if cmp -s "$work/before-home.png" "$shots/notification-banner-home.png"; then
  fail "No banner on the Home Screen after simctl push: notifications aren't allowed on this simulator (NotificationPermissionTests allows them)"
fi

if [ "$status" -eq 0 ]; then
  line="### Notification banner: shown over the app and on the Home Screen (simctl push)"
else
  line="### Notification banner: failed (see the errors above)"
fi
echo "$line"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$line" >>"$GITHUB_STEP_SUMMARY"; fi
exit "$status"
