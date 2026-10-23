#!/usr/bin/env bash
# Generates apps/ios/WillItSnow.xcodeproj from project.yml with XcodeGen 2.46.0 (iOS build spec,
# section 9.1), puts the committed Package.resolved where Xcode reads it, and checks that the
# test plans name the project's targets.
#
# An xcodegen on the PATH is used when it is 2.46.0 (Carl's Mac: brew install xcodegen).
# Otherwise the release zip is downloaded from GitHub into XCODEGEN_DIR (default
# ~/.xcodegen/2.46.0, which CI caches) and its SHA-256 checked before it is used.
#
# Usage: apps/ios/ci/xcodegen.sh   (from anywhere)
set -euo pipefail

VERSION=2.46.0
# The release zip's SHA-256, worked out from the download on 23 October 2026.
SHA256=4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806
URL="https://github.com/yonaskolb/XcodeGen/releases/download/$VERSION/xcodegen.zip"

ios="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools="${XCODEGEN_DIR:-$HOME/.xcodegen/$VERSION}"
mkdir -p "$tools"
tools="$(cd "$tools" && pwd)"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

if command -v xcodegen >/dev/null && [ "$(xcodegen --version)" = "Version: $VERSION" ]; then
  xcodegen=xcodegen
else
  zip="$tools/xcodegen.zip"
  if [ ! -f "$zip" ]; then
    curl -fsSL --retry 3 -o "$zip.part" "$URL"
    mv "$zip.part" "$zip"
  fi
  actual="$(sha256 "$zip")"
  if [ "$actual" != "$SHA256" ]; then
    echo "xcodegen.sh: $zip has SHA-256 $actual, not $SHA256. Not using it." >&2
    rm -f "$zip"
    exit 1
  fi
  # Unpacked fresh from the checked zip every time.
  rm -rf "$tools/xcodegen"
  unzip -q "$zip" -d "$tools"
  xcodegen="$tools/xcodegen/bin/xcodegen"
fi

found="$("$xcodegen" --version)"
if [ "$found" != "Version: $VERSION" ]; then
  echo "xcodegen.sh: $xcodegen says \"$found\", not $VERSION" >&2
  exit 1
fi

cd "$ios"
"$xcodegen" generate --spec project.yml

# The package versions are pinned by the committed file, not resolved afresh (section 9.1).
swiftpm=WillItSnow.xcodeproj/project.xcworkspace/xcshareddata/swiftpm
mkdir -p "$swiftpm"
cp Package.resolved "$swiftpm/Package.resolved"

# A test plan names each target by its object ID in the project. XcodeGen derives the IDs from
# the project's and the target's names, so they stay put, but a renamed target would leave a
# plan pointing at nothing: fail here, by name, rather than in xcodebuild.
python3 -I - WillItSnow.xcodeproj/project.pbxproj TestPlans/*.xctestplan <<'PY'
import json, re, sys

pbxproj = open(sys.argv[1], encoding="utf-8").read()
targets = {
    name: ref
    for ref, name in re.findall(
        r"^\t\t([0-9A-F]{24}) /\* (\S+) \*/ = \{\n\t\t\tisa = PBXNativeTarget;", pbxproj, re.M
    )
}
wrong = 0
for path in sys.argv[2:]:
    plan = json.load(open(path, encoding="utf-8"))
    named = [plan["defaultOptions"]["targetForVariableExpansion"]]
    named += [entry["target"] for entry in plan["testTargets"]]
    for target in named:
        actual = targets.get(target["name"])
        if target["identifier"] != actual:
            wrong += 1
            print(
                f"xcodegen.sh: {path} names {target['name']} as {target['identifier']}, "
                f"but the project has {actual or 'no such target'}",
                file=sys.stderr,
            )
sys.exit(1 if wrong else 0)
PY
