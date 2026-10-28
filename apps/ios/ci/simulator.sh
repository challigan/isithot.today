#!/usr/bin/env bash
# Boots the simulator CI tests on (iOS build spec, section 18.1), an iPhone 17 on iOS 26.5, or on
# iOS 26.2 for the StoreKit plan, making it first if the runner has none, with the status bar at
# 9:41. Prints its UDID.
#
# Why 26.2: StoreKit Test doesn't connect to its test environment on the iOS 26.3 to 26.5
# simulators (FB22500243), which Apple's iOS 26.6 notes list as fixed, and the image has no 26.6
# simulator runtime (apps/ios/README.md, "Settled"). Before it looks for a device, it checks the
# runner has the runtime, and downloads it once if not; if that fails too, it stops with one error
# that names the runtime, rather than leaving simctl create to fail.
#
# Usage: udid="$(apps/ios/ci/simulator.sh)"        iOS 26.5: the Unit and UI plans
#        udid="$(apps/ios/ci/simulator.sh 26.2)"   iOS 26.2: the StoreKit plan
set -euo pipefail

version="${1:-26.5}"
# PROBE: any runtime, downloaded if the runner hasn't it; an iPhone 16 on iOS 18.
fallback="probe: no iOS $version"
case "$version" in
  18.*)
    NAME="iPhone 16"
    DEVICE_TYPE=com.apple.CoreSimulator.SimDeviceType.iPhone-16
    ;;
  *)
    NAME="iPhone 17"
    DEVICE_TYPE=com.apple.CoreSimulator.SimDeviceType.iPhone-17
    ;;
esac
RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-${version//./-}"
APP_ID=today.willitsnow.app

# Whether the runner has the runtime, ready to use.
has_runtime() {
  xcrun simctl list runtimes --json | python3 -I -c '
import json, sys
runtimes = json.load(sys.stdin)["runtimes"]
found = any(r["identifier"] == sys.argv[1] and r.get("isAvailable") for r in runtimes)
sys.exit(0 if found else 1)
' "$RUNTIME"
}

if ! has_runtime; then
  echo "simulator.sh: no $RUNTIME on this runner, so downloading iOS $version" >&2
  if ! xcodebuild -downloadPlatform iOS -buildVersion "$version" >&2 || ! has_runtime; then
    echo "::error::simulator.sh: the runner has no $RUNTIME and couldn't download it: $fallback" >&2
    exit 1
  fi
fi

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
