#!/usr/bin/env bash
#
# ensure-pods-linked.sh — guard against the "new local expo module isn't in the
# binary" trap.
#
# `expo run:ios` with an existing ios/ does NOT re-run autolinking/pod install,
# so a NEWLY ADDED modules/<name>/ pod silently never links: the app builds and
# runs, requireOptionalNativeModule() returns null, and the feature "works" via
# its JS fallback. This bit for real: modules/outlined-text stayed MISSING on
# device through several `just remote` rounds (Podfile.lock had GestureSurface
# from an earlier prebuild, but not OutlinedText).
#
# Checks every modules/*/ios/*.podspec pod name against ios/Podfile.lock and
# runs the full prebuild (expo prebuild --clean + pod install) if any is
# missing. Called by `just local` and scripts/remote-build.sh before building.
set -euo pipefail

cd "$(dirname "$0")/.."
LOCK="ios/Podfile.lock"

# An existing native project keeps its previous identity until regenerated.
# Check the app target as well as pods before a local/remote development install.
identity_changed=0
if [[ "${APP_VARIANT:-stable}" == development ]]; then
  expected_bundle_id=com.massimotseng.yomifin.dev
else
  expected_bundle_id=com.massimotseng.yomifin
fi
if ! grep -Eq "PRODUCT_BUNDLE_IDENTIFIER = \"?${expected_bundle_id//./\\.}\"?;" ios/*.xcodeproj/project.pbxproj 2>/dev/null; then
  identity_changed=1
fi

missing=()
for spec in modules/*/ios/*.podspec; do
  [ -e "$spec" ] || continue
  pod="$(basename "${spec%.podspec}")"
  if [ ! -f "$LOCK" ] || ! grep -q "^  - ${pod} " "$LOCK"; then
    missing+=("$pod")
  fi
done

if [ "${#missing[@]}" -gt 0 ] || [ "$identity_changed" -eq 1 ]; then
  echo "› local module pod(s) not linked yet: ${missing[*]}"
  echo "› ensuring app identity: $expected_bundle_id"
  echo "› running prebuild (expo prebuild --clean + pod install)…"
  bun run prebuild
else
  echo "✓ all local module pods present in Podfile.lock"
fi
