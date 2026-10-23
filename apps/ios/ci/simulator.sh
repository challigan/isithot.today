#!/usr/bin/env bash
# Boots the simulator CI tests on (iOS build spec, section 18.1), an iPhone 17 on iOS 26.5, making
# it first if the runner has none, with the status bar at 9:41. Prints its UDID.
#
# Usage: udid="$(apps/ios/ci/simulator.sh)"
set -euo pipefail

NAME="iPhone 17"
RUNTIME=com.apple.CoreSimulator.SimRuntime.iOS-26-5
DEVICE_TYPE=com.apple.CoreSimulator.SimDeviceType.iPhone-17
APP_ID=today.willitsnow.app

udid="$(xcrun simctl list devices available --json | python3 -I -c '
import json, sys
devices = json.load(sys.stdin)["devices"].get(sys.argv[1], [])
print(next((d["udid"] for d in devices if d["name"] == sys.argv[2]), ""))
' "$RUNTIME" "$NAME")"
if [ -z "$udid" ]; then
  echo "simulator.sh: no $NAME on $RUNTIME, so making one" >&2
  udid="$(xcrun simctl create "$NAME" "$DEVICE_TYPE" "$RUNTIME")"
fi

# Boots it if it isn't already, and waits until it has finished.
xcrun simctl bootstatus "$udid" -b >&2
xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3 >&2
# The app doesn't ask for location yet; this is for the phases that do.
if ! xcrun simctl privacy "$udid" grant location "$APP_ID" >&2; then
  echo "::warning::simulator.sh: couldn't grant location to $APP_ID before it is installed" >&2
fi
echo "$udid"
