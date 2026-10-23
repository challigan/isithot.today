#!/usr/bin/env bash
# Checks a Release build of will it snow? before it goes to App Store Connect (iOS build spec,
# sections 9.8 and 18.3, steps 3 and 4).
#
#   scripts/check-archive.sh <WillItSnow.xcarchive> <test|real>
#       The archive, signed or not. It fails if either bundle lacks its privacy manifest or the
#       answer font, the app has no icon, the widget links Google Mobile Ads, either binary names
#       a debug hook, the ad units aren't Google's demo ones (test) or Carl's (real), the app and
#       widget differ in version or build, ITSAppUsesNonExemptEncryption isn't false, or the
#       fixtures are bundled.
#   scripts/check-archive.sh --ipa <WillItSnow.ipa, or a folder holding its Payload>
#       The exported app's signed entitlements. It fails unless the app has aps-environment
#       production, both have the App Group, the widget has no aps-environment, and neither is
#       debuggable (get-task-allow).
#
# Optional environment: BUILD_NUMBER (the app's CFBundleVersion must be it), and ADMOB_APP_ID and
# ADMOB_BANNER_ID, Carl's AdMob IDs (repository variables, not secrets): with real the app must
# use them, and with test his publisher ID must appear nowhere.
#
# The reads that need macOS go through plutil and codesign, named by PLUTIL and CODESIGN so that
# scripts/test/check-archive.test.mjs can stand in for them on Linux. strings(1) and
# swift-small-strings.mjs, which finds the short literals strings can't, run anywhere. Each
# failure is an error annotation, and all of them go to the step summary and the log. Exits 1 if
# a check fails, 2 on a usage error. Sourcing the file defines the functions and runs nothing.
set -euo pipefail

APP=WillItSnow
WIDGET=WillItSnowWidgets
APP_GROUP=group.today.willitsnow.app
# Google's demo publisher (section 14.3): every ad unit of a test build is one of its.
DEMO_PUBLISHER=3940256099942544
# The debug hooks' names (section 18.3), looked for anywhere in strings' output and as whole
# short literals.
HOOKS=(-uitest -fixture -apiOrigin -route -umpGeography -openURLs URLProtocolStub 127.0.0.1)
# DebugHooks.swift's other launch arguments (section 9.8), too short or too ordinary to look
# for inside longer strings, so matched only as whole short literals.
LITERAL_HOOKS=(-now -clock -unlocked -noads -resetStore -network -location)

PLUTIL="${PLUTIL:-plutil}"
CODESIGN="${CODESIGN:-codesign}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

failures=()
facts=()

# --- Reads -------------------------------------------------------------------------------------

# The plist at $1 as XML: one element a line, a tab for each level, as plutil writes it.
plist_xml() {
  "$PLUTIL" -convert xml1 -o - "$1"
}

# The entitlements the bundle at $1 is signed with, as plist_xml writes them. Fails when it isn't
# signed or has none.
entitlements_xml() {
  local signed status=0
  signed="$(mktemp)"
  "$CODESIGN" -d --entitlements - --xml "$1" >"$signed" 2>/dev/null || status=$?
  if [ "$status" -eq 0 ]; then plist_xml "$signed" || status=$?; fi
  rm -f "$signed"
  return "$status"
}

# The value of the top-level key $1 in the plist XML on stdin: a string, a number, true or false,
# or each string of an array on a line of its own. Fails when there is no such key. It reads
# identifiers, versions and booleans, so it decodes no XML entities.
plist_get() {
  awk -v key="$1" '
    state == 0 && $0 == ("\t<key>" key "</key>") { state = 1; next }
    state == 1 {
      if ($0 == "\t<array>") { state = 2; next }
      if ($0 == "\t<array/>") exit
      value = $0
      sub(/^\t/, "", value)
      if (value == "<true/>") value = "true"
      else if (value == "<false/>") value = "false"
      else if (value == "<string/>") value = ""
      else { sub(/^<[a-z]+>/, "", value); sub(/<\/[a-z]+>$/, "", value) }
      print value
      exit
    }
    state == 2 {
      if ($0 == "\t</array>") exit
      if ($0 ~ /^\t\t<string>.*<\/string>$/) {
        item = $0
        sub(/^\t\t<string>/, "", item)
        sub(/<\/string>$/, "", item)
        print item
      }
    }
    END { exit (state == 0) }
  '
}

# Every string strings(1) finds in the binary at $1 into $2.strings, and the short Swift literals
# the compiler builds in instructions into $2.literals. Both are empty when there is no binary.
read_binary() {
  : >"$2.strings"
  : >"$2.literals"
  if [ ! -f "$1" ]; then
    fail "$(basename "$(dirname "$1")") has no executable $(basename "$1")"
    return 0
  fi
  strings -a "$1" >"$2.strings"
  node "$here/swift-small-strings.mjs" "$1" >"$2.literals" ||
    fail "swift-small-strings.mjs couldn't read $(basename "$1")"
}

# --- Reporting ---------------------------------------------------------------------------------

fail() {
  failures+=("$*")
  echo "::error::check-archive.sh: $*"
}

# Into the step summary for people, and the log for agents, as ci/test.sh does.
report() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then tee -a "$GITHUB_STEP_SUMMARY"; else cat; fi
}

# The summary of what was checked, headed $1; fails if any check did.
finish() {
  local line
  {
    if [ "${#failures[@]}" -eq 0 ]; then
      echo "### $1: passed"
    else
      echo "### $1: ${#failures[@]} failed"
    fi
    echo
    for line in ${failures[@]+"${failures[@]}"} ${facts[@]+"${facts[@]}"}; do echo "- $line"; done
  } | report
  [ "${#failures[@]}" -eq 0 ]
}

# Up to three lines of $2 containing $1, shortened, for a message.
excerpt() {
  grep -F -m 3 -e "$1" "$2" | cut -c 1-80 | awk 'NR > 1 { printf "; " } { printf "%s", $0 }'
}

# --- The archive -------------------------------------------------------------------------------

# The bundle at $1 has a privacy manifest that is a plist.
check_privacy() {
  local name
  name="$(basename "$1")"
  if [ ! -f "$1/PrivacyInfo.xcprivacy" ]; then
    fail "$name has no PrivacyInfo.xcprivacy"
  elif ! plist_xml "$1/PrivacyInfo.xcprivacy" >/dev/null 2>&1; then
    fail "$name's PrivacyInfo.xcprivacy isn't a plist"
  fi
}

# The app at $1, whose Info.plist XML is $2, has its icon: App Store Connect refuses a build
# without one (ITMS-90022). actool compiles the AppIcon set into Assets.car and names it in
# CFBundleIcons, CFBundlePrimaryIcon, CFBundleIconName.
check_icon() {
  if [ ! -f "$1/Assets.car" ] || ! awk '
    previous ~ /^\t*<key>CFBundleIconName<\/key>$/ && $0 ~ /^\t*<string>AppIcon<\/string>$/ { found = 1 }
    { previous = $0 }
    END { exit !found }
  ' "$2"; then
    fail "the app has no icon: no Assets.car, or no CFBundleIconName AppIcon in its Info.plist"
  fi
}

# The bundle at $1, whose Info.plist XML is $2, carries the answer font and names it in
# UIAppFonts: an extension can't load fonts from the app's bundle (spec section 9.7).
check_font() {
  local name
  name="$(basename "$1")"
  if [ ! -f "$1/BricolageAnswer.ttf" ]; then
    fail "$name has no BricolageAnswer.ttf"
  elif ! plist_get UIAppFonts <"$2" | grep -F -x -e BricolageAnswer.ttf >/dev/null; then
    fail "$name's UIAppFonts doesn't name BricolageAnswer.ttf"
  fi
}

# The executable of the bundle at $1, whose Info.plist XML is $2.
executable() {
  local name
  name="$(plist_get CFBundleExecutable <"$2")" || name=""
  if [ -z "$name" ]; then name="$(basename "$1" | sed 's/\.[^.]*$//')"; fi
  echo "$1/$name"
}

# Whether the short literals in $2 include the hook $1. A hook of 8 bytes or more is matched by
# its first 8, the literal's first word, whatever follows them: swift-small-strings.mjs joins
# that word to the nearest second word, which can be another string's, or finds none.
is_literal() {
  if [ "${#1}" -ge 8 ]; then
    cut -c 1-8 "$2" | grep -F -x -e "${1:0:8}" >/dev/null
  else
    grep -F -x -e "$1" "$2" >/dev/null
  fi
}

# The binary read into $1.{strings,literals}, named $2, names no debug hook.
check_hooks() {
  local hook
  for hook in "${HOOKS[@]}"; do
    if grep -F -e "$hook" "$1.strings" >/dev/null; then
      fail "$2 contains the debug hook $hook: $(excerpt "$hook" "$1.strings")"
    elif is_literal "$hook" "$1.literals"; then
      fail "$2 builds the debug hook $hook as a short Swift literal"
    fi
  done
  for hook in "${LITERAL_HOOKS[@]}"; do
    if is_literal "$hook" "$1.literals"; then
      fail "$2 builds the debug hook $hook as a short Swift literal"
    fi
  done
}

# The app and the widget (Info.plist XML $1 and $2) have the same version and build.
check_versions() {
  local version build widget_version widget_build
  version="$(plist_get CFBundleShortVersionString <"$1")" || version=""
  build="$(plist_get CFBundleVersion <"$1")" || build=""
  widget_version="$(plist_get CFBundleShortVersionString <"$2")" || widget_version=""
  widget_build="$(plist_get CFBundleVersion <"$2")" || widget_build=""
  if [ -z "$build" ]; then fail "the app has no CFBundleVersion"; fi
  if [ "$widget_build" != "$build" ]; then
    fail "the widget's CFBundleVersion is ${widget_build:-missing}, the app's ${build:-missing}"
  fi
  if [ "$widget_version" != "$version" ]; then
    fail "the widget's CFBundleShortVersionString is ${widget_version:-missing}, the app's ${version:-missing}"
  fi
  if [ -n "${BUILD_NUMBER:-}" ] && [ "$build" != "$BUILD_NUMBER" ]; then
    fail "the app's CFBundleVersion is ${build:-missing}, not $BUILD_NUMBER (BUILD_NUMBER)"
  fi
  # First in the summary.
  facts=("$APP ${version:-?} (${build:-?})" ${facts[@]+"${facts[@]}"})
}

# The ad units for $1 (test or real), from the app's Info.plist XML $2 and its binary's strings $3.
check_ads() {
  local ads="$1" info="$2" text="$3" app_id banner ours="" publishers publisher
  local demo_app="^ca-app-pub-${DEMO_PUBLISHER}~[0-9]{10}$"
  local demo_banner="^ca-app-pub-${DEMO_PUBLISHER}/[0-9]{10}$"
  local any_app='^ca-app-pub-[0-9]{16}~[0-9]{10}$'
  local any_banner='^ca-app-pub-[0-9]{16}/[0-9]{10}$'
  app_id="$(plist_get GADApplicationIdentifier <"$info")" || app_id=""
  banner="$(plist_get IsItBannerUnitID <"$info")" || banner=""
  if [[ ${ADMOB_APP_ID:-} =~ $any_app ]]; then ours="${ADMOB_APP_ID:11:16}"; fi
  # Every AdMob publisher the Info.plist or the app binary names (ca-app-pub-… or pub-…).
  publishers="$(cat "$info" "$text" | grep -E -o 'pub-[0-9]{16}' | sed 's/^pub-//' | sort -u)" ||
    publishers=""

  if [ "$ads" = test ]; then
    if ! [[ $app_id =~ $demo_app ]]; then
      fail "with ads test, GADApplicationIdentifier is ${app_id:-missing}, not a Google demo app ID"
    fi
    if ! [[ $banner =~ $demo_banner ]]; then
      fail "with ads test, IsItBannerUnitID is ${banner:-missing}, not a Google demo unit"
    fi
    for publisher in $publishers; do
      if [ "$publisher" != "$DEMO_PUBLISHER" ]; then
        fail "with ads test, the app names the AdMob publisher pub-$publisher, not only Google's demo one"
      fi
    done
    if [ -n "$ours" ] && grep -F -e "$ours" "$info" "$text" >/dev/null; then
      fail "with ads test, the app contains Carl's publisher ID (ADMOB_APP_ID's)"
    fi
    facts+=("ads test: Google's demo units ($app_id)")
    # Google's SDK, linked into the app, could name its own demo publisher; if so, a real build
    # would fail below, so say so on every run, long before the release candidate.
    if grep -F -e "$DEMO_PUBLISHER" "$text" >/dev/null; then
      echo "::notice::check-archive.sh: the app binary itself contains Google's demo publisher ID; with ads real this archive would fail"
      facts+=("note: the app binary itself contains Google's demo publisher ID, which ads real refuses")
    fi
  else
    if grep -F -e "$DEMO_PUBLISHER" "$info" >/dev/null; then
      fail "with ads real, the app's Info.plist contains Google's demo publisher $DEMO_PUBLISHER"
    fi
    if grep -F -e "$DEMO_PUBLISHER" "$text" >/dev/null; then
      fail "with ads real, the app binary contains Google's demo publisher $DEMO_PUBLISHER: $(excerpt "$DEMO_PUBLISHER" "$text")"
    fi
    if ! [[ $app_id =~ $any_app ]]; then
      fail "with ads real, GADApplicationIdentifier is ${app_id:-missing}, not an AdMob app ID"
    elif [ -n "${ADMOB_APP_ID:-}" ] && [ "$app_id" != "$ADMOB_APP_ID" ]; then
      fail "with ads real, GADApplicationIdentifier is $app_id, not ADMOB_APP_ID"
    fi
    if ! [[ $banner =~ $any_banner ]]; then
      fail "with ads real, IsItBannerUnitID is ${banner:-missing}, not an AdMob ad unit"
    elif [ -n "${ADMOB_BANNER_ID:-}" ] && [ "$banner" != "$ADMOB_BANNER_ID" ]; then
      fail "with ads real, IsItBannerUnitID is $banner, not ADMOB_BANNER_ID"
    fi
    facts+=("ads real: $app_id")
  fi
}

# The archive at $1, built with the ad units $2.
check_archive() {
  local apps="$1/Products/Applications" app widget info="$work/app.xml" widget_info="$work/widget.xml"
  local encryption
  app="$apps/$APP.app"
  widget="$app/PlugIns/$WIDGET.appex"
  if [ ! -d "$app" ]; then
    fail "no $APP.app in $apps"
    return 0
  fi
  if ! plist_xml "$app/Info.plist" >"$info" 2>/dev/null; then
    fail "$APP.app has no Info.plist that plutil can read"
    return 0
  fi
  check_privacy "$app"
  check_icon "$app" "$info"
  check_font "$app" "$info"
  read_binary "$(executable "$app" "$info")" "$work/app"
  check_hooks "$work/app" "the app binary"
  check_ads "$2" "$info" "$work/app.strings"

  encryption="$(plist_get ITSAppUsesNonExemptEncryption <"$info")" || encryption=missing
  if [ "$encryption" != false ]; then
    fail "the app's ITSAppUsesNonExemptEncryption is ${encryption:-empty}, not false"
  fi

  # EXCLUDED_SOURCE_FILE_NAMES leaves the fixtures out of Release; each says what it is in its
  # _fixture block.
  if [ -e "$app/Fixtures" ] || grep -r -l -F --include='*.json' '"_fixture"' "$app" >/dev/null; then
    fail "the app bundles the fixtures"
  fi

  if [ ! -d "$widget" ]; then
    fail "the widget extension $WIDGET.appex isn't embedded in the app"
    return 0
  fi
  if ! plist_xml "$widget/Info.plist" >"$widget_info" 2>/dev/null; then
    fail "$WIDGET.appex has no Info.plist that plutil can read"
    return 0
  fi
  check_privacy "$widget"
  check_font "$widget" "$widget_info"
  read_binary "$(executable "$widget" "$widget_info")" "$work/widget"
  check_hooks "$work/widget" "the widget binary"
  # Linked dynamically, the framework's path is in the load commands; statically, its classes'
  # names are in the binary.
  if grep -E -e 'GoogleMobileAds|GADMobileAds|UserMessagingPlatform' "$work/widget.strings" \
    >/dev/null || [ -e "$widget/Frameworks/GoogleMobileAds.framework" ]; then
    fail "the widget links Google Mobile Ads"
  fi
  # Nor Core Location (IsItLocation is the app's alone): the widget has no purpose string, and a
  # location API in its binary would want one.
  if grep -E -e 'CLLocationManager|CoreLocationService' "$work/widget.strings" >/dev/null; then
    fail "the widget links the app's location code"
  fi
  check_versions "$info" "$widget_info"
  facts+=("checked: privacy manifests, the icon, the answer font, $((${#HOOKS[@]} + ${#LITERAL_HOOKS[@]})) debug hooks in both binaries, the ad units, the widget's links, versions, encryption and fixtures")
}

# --- The exported app --------------------------------------------------------------------------

# The entitlements XML $1 grants the App Group.
has_group() {
  plist_get com.apple.security.application-groups <"$1" | grep -F -x -e "$APP_GROUP" >/dev/null
}

# The entitlements XML $1, of bundle $2, aren't debuggable.
check_debuggable() {
  local allowed
  allowed="$(plist_get get-task-allow <"$1")" || allowed=false
  if [ "$allowed" = true ]; then fail "$2 is signed debuggable (get-task-allow)"; fi
}

# The .ipa at $1, or the folder holding its Payload.
check_ipa() {
  local root="$1" app widget entitlements="$work/app.entitlements"
  local widget_entitlements="$work/widget.entitlements" aps
  if [ -f "$1" ]; then
    root="$work/ipa"
    mkdir -p "$root"
    if ! unzip -q "$1" -d "$root"; then
      fail "$1 isn't an .ipa that unzip can open"
      return 0
    fi
  fi
  app="$root/Payload/$APP.app"
  widget="$app/PlugIns/$WIDGET.appex"
  if [ ! -d "$app" ]; then
    fail "no Payload/$APP.app in $1"
    return 0
  fi

  if entitlements_xml "$app" >"$entitlements"; then
    aps="$(plist_get aps-environment <"$entitlements")" || aps=missing
    if [ "$aps" != production ]; then fail "the app's aps-environment is $aps, not production"; fi
    if ! has_group "$entitlements"; then fail "the app lacks the App Group $APP_GROUP"; fi
    check_debuggable "$entitlements" "$APP.app"
  else
    fail "$APP.app isn't signed, or has no entitlements"
  fi

  if [ ! -d "$widget" ]; then
    fail "the widget extension $WIDGET.appex isn't embedded in the app"
  elif entitlements_xml "$widget" >"$widget_entitlements"; then
    if ! has_group "$widget_entitlements"; then fail "the widget lacks the App Group $APP_GROUP"; fi
    if aps="$(plist_get aps-environment <"$widget_entitlements")"; then
      fail "the widget has aps-environment ($aps); only the app gets notifications"
    fi
    check_debuggable "$widget_entitlements" "$WIDGET.appex"
  else
    fail "$WIDGET.appex isn't signed, or has no entitlements"
  fi
  facts+=("checked: the app pushes in production; both have $APP_GROUP; the widget doesn't push; neither is debuggable")
}

# --- Main --------------------------------------------------------------------------------------

usage() {
  echo "usage: check-archive.sh <WillItSnow.xcarchive> <test|real>" >&2
  echo "       check-archive.sh --ipa <WillItSnow.ipa, or a folder holding its Payload>" >&2
  exit 2
}

main() {
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  if [ "$#" -eq 2 ] && [ "$1" = --ipa ]; then
    check_ipa "$2"
    finish "Signed app checks"
  elif [ "$#" -eq 2 ] && { [ "$2" = test ] || [ "$2" = real ]; }; then
    check_archive "$1" "$2"
    finish "Archive checks"
  else
    usage
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
