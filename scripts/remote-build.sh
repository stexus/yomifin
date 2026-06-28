#!/usr/bin/env bash
#
# remote-build.sh — build Streamyfin and deploy to the iPad over WiFi.
#
# Designed to be run on the Mac build box OVER SSH (the "remote flow"):
#   Linux desktop --ssh--> headless Mac --wifi--> iPad
#
# Why this script exists (see YOMIFIN_CONTEXT.md §8 / §1a):
#   An SSH session does NOT auto-unlock the login keychain the way a GUI login
#   does, so `codesign` fails with errSecInternalComponent / "User interaction
#   is not allowed". We unlock the keychain explicitly before building.
#   (The signing key's partition list must already include codesign — done once
#   via `security set-key-partition-list`; see YOMIFIN_CONTEXT.md §8.)
#
# Nix is found over SSH because Determinate Nix writes PATH setup to /etc/zshenv,
# which non-interactive SSH commands source.
#
# Usage (from an interactive SSH session — prompts once for the keychain pw):
#   ssh massimo@10.0.0.99
#   cd ~/playground/yomifin/streamyfin && ./scripts/remote-build.sh
#
# Fully non-interactive (e.g. ssh host './scripts/remote-build.sh') — pass the
# macOS login password via env so the unlock doesn't need a TTY:
#   ssh massimo@10.0.0.99 "cd ~/playground/yomifin/streamyfin && \
#     KEYCHAIN_PASSWORD='…' ./scripts/remote-build.sh"
#
set -euo pipefail

# iPad's RN/expo device UDID (from `xcrun xctrace list devices`). Override via
# env: DEVICE_UDID=… ./scripts/remote-build.sh
DEVICE_UDID="${DEVICE_UDID:-00008027-000641082130402E}"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

cd "$(dirname "$0")/.."

echo "› Unlocking login keychain for codesign…"
if [ -n "${KEYCHAIN_PASSWORD:-}" ]; then
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
else
  # Interactive prompt — works over an interactive SSH session.
  security unlock-keychain "$KEYCHAIN"
fi

echo "› Building + deploying to device $DEVICE_UDID via Nix shell…"
# Metro runs here on the Mac; the iPad connects to it over WiFi. Keep this
# session open while developing, or Ctrl-C after install if you only wanted the
# build on-device.
exec nix develop --command bash -c \
  "EXPO_TV=0 bunx expo run:ios --device $DEVICE_UDID"
