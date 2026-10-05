#!/usr/bin/env bash
# Build either the Metro development client or the standalone daily-use app.
set -euo pipefail
cd "$(dirname "$0")/../.."

variant="${1:-development}"
case "$variant" in
  development) configuration=Debug; filename=Yomifin-Dev.ipa ;;
  stable) configuration=Release; filename=Yomifin.ipa ;;
  *) echo "Usage: bash scripts/ios/build-variant.sh [development|stable]" >&2; exit 1 ;;
esac

if [[ "$(uname -s)" != Darwin ]]; then
  echo "IPA builds require macOS and Xcode." >&2
  exit 1
fi

# Preserve the existing IPA helper's guards for builds outside the Nix shell.
native_tools_dir="$(mktemp -d "${TMPDIR:-/tmp}/yomifin-variant-tools.XXXXXX")"
trap 'rm -rf "$native_tools_dir"' EXIT
ln -s /usr/bin/tar "$native_tools_dir/tar"
ln -s /usr/bin/xcrun "$native_tools_dir/xcrun"
export PATH="$native_tools_dir:$PATH"
unset CC CXX NIX_CFLAGS_COMPILE NIX_LDFLAGS MACOSX_DEPLOYMENT_TARGET \
  SDKROOT DEVELOPER_DIR CPATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH \
  OBJC_INCLUDE_PATH LIBRARY_PATH
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
export EXPO_TV=0 APP_VARIANT="$variant" EXPO_PUBLIC_BUILD_PROFILE="$variant"

bun install --frozen-lockfile
git submodule update --init --recursive
bash scripts/ios/install-metal-toolchain.sh

if [[ "$variant" == development ]]; then
  export NODE_ENV=development SKIP_BUNDLING=1 SKIP_BUNDLING_METRO_IP=1
else
  export NODE_ENV=production
  unset SKIP_BUNDLING SKIP_BUNDLING_METRO_IP FORCE_BUNDLING
fi

# A clean prebuild is required when switching identities in generated ios/.
bunx expo prebuild --platform ios --clean --no-install
mkdir -p "build/$variant"

# Here --production selects archive/IPA packaging, not necessarily Release.
# It resets the configuration, so --configuration MUST come after it.
bun scripts/ios/build-ios.ts \
  --production --configuration "$configuration" --skip-credentials \
  --output "build/$variant/$filename"

IPA_PATH="build/$variant/$filename" bun scripts/ios/app-source.ts --validate-only

echo "Unsigned IPA: build/$variant/$filename"
echo "Sign and install through FlareStore."
