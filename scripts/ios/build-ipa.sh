#!/usr/bin/env bash
# Build an unsigned Release IPA for FlareStore (or another external signer).
# Signing assets belong in the signer; this step needs no Apple account/keychain.
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "IPA builds require macOS and Xcode." >&2
  exit 1
fi

# Match the Nix shell's Apple-toolchain guards even when invoked outside it.
# GNU tar warnings contaminate Expo's extracted framework plists.
native_tools_dir="$(mktemp -d "${TMPDIR:-/tmp}/yomifin-ipa-tools.XXXXXX")"
trap 'rm -rf "$native_tools_dir"' EXIT
ln -s /usr/bin/tar "$native_tools_dir/tar"
ln -s /usr/bin/xcrun "$native_tools_dir/xcrun"
export PATH="$native_tools_dir:$PATH"
unset CC CXX NIX_CFLAGS_COMPILE NIX_LDFLAGS MACOSX_DEPLOYMENT_TARGET \
  SDKROOT DEVELOPER_DIR CPATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH \
  OBJC_INCLUDE_PATH LIBRARY_PATH
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
export EXPO_TV=0

bun install --frozen-lockfile
git submodule update --init --recursive
export NODE_ENV=production
bunx expo prebuild --platform ios --clean --no-install
mkdir -p build
bun run ios:unsigned-build --output build/Yomifin.ipa

echo "Unsigned IPA: $(pwd)/build/Yomifin.ipa"
echo "Import into FlareStore, sign with your certificate/profile, then install."
