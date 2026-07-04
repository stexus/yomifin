# justfile — Yomifin / Streamyfin dev recipes
#
# Wraps the workflows documented in YOMIFIN_CONTEXT.md (Dev environment & build).
# Everything runs inside the Nix dev shell (`nix develop`) so the toolchain
# (bun, node, cocoapods, jdk) is reproducible on any Apple Silicon Mac.
#
# Usage:
#   just              # list recipes
#   just setup        # one-time first-time setup on a fresh Mac
#   just local        # build + deploy to iPad from THIS Mac
#   just remote       # build + deploy to iPad (run while SSH'd into the Mac)
#
# Override the iPad device UDID (default = the documented iPad):
#   just local DEVICE_UDID=XXXX
#
# The `remote` recipe assumes you are ALREADY SSH'd into the Mac build box.

set shell := ["bash", "-uc"]

# iPad's RN/expo device UDID (from `xcrun xctrace list devices`).
DEVICE_UDID := env_var_or_default("DEVICE_UDID", "00008027-000641082130402E")


# Default: list all recipes.
default:
    @just --list

# --- One-time setup -------------------------------------------------------

# First-time setup on a fresh Apple Silicon Mac (Xcode + Nix + Apple ID required).
setup: xcode-license deps metal-toolchain prebuild
    @echo "✓ Setup complete. Next: open Xcode once to set Team/Bundle ID signing,"
    @echo "  then run 'just local' to build + deploy to the iPad."

# Point at system Xcode and accept its license (needs sudo).
xcode-license:
    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
    sudo xcodebuild -license accept

# Install JS deps and pull native submodules.
deps:
    bun i && bun run submodule-reload

# Install the Metal toolchain (required for the MPVKit/libmpv native build).
metal-toolchain:
    bun run ios:install-metal-toolchain

# Generate ios/ (and run pod install). Re-run after native/app.json changes.
prebuild:
    bun run prebuild

# --- Local build (this Mac) ----------------------------------------------

# Build + deploy to the iPad from this Mac.
# ensure-pods-linked: a NEW modules/<name>/ pod needs a prebuild/pod-install —
# `expo run:ios` alone never links it (outlined-text stayed MISSING on device).
local:
    ./scripts/ensure-pods-linked.sh
    EXPO_TV=0 bunx expo run:ios --device {{DEVICE_UDID}}

# JS/TS-only dev loop — start Metro (no native rebuild for JS changes).
dev:
    bunx expo start --dev-client

# List attached devices + their UDIDs.
devices:
    xcrun xctrace list devices

# --- Remote build (run while SSH'd into the headless Mac build box) -------

# Build + deploy via remote-build.sh (unlocks the login keychain, then prompts once for its password).
remote:
    DEVICE_UDID={{DEVICE_UDID}} ./scripts/remote-build.sh

# Non-interactive variant: KEYCHAIN_PASSWORD env supplies the keychain password (no TTY needed).
remote-ci:
    KEYCHAIN_PASSWORD='{{env_var('KEYCHAIN_PASSWORD')}}' DEVICE_UDID={{DEVICE_UDID}} ./scripts/remote-build.sh

# --- Housekeeping ---------------------------------------------------------

# Clean-regenerate the native ios/ project.
clean:
    bun run clean

# Run the full JS check suite (typecheck, lint, format, i18n, doctor).
test:
    bun run test

# Yomifin regression guards (run after any change under utils/yomifin/).
yomifin-test:
    ./scripts/yomifin-test.sh
