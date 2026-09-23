{
  description = "Streamyfin — Jellyfin client (Expo / React Native) dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Pin the JDK to 17 (Temurin). Newer JDKs (23/25) break the
        # RN/AGP native Android build — see .github/workflows/build-apps.yml.
        jdk = pkgs.temurin-bin-17;
      in
      {
        # Use mkShellNoCC: we only need prebuilt binaries (bun, node, jdk, …).
        # The default mkShell pulls in Nix's clang stdenv, which exports
        # CC/CXX/NIX_CFLAGS_COMPILE and forces Nix's libc++ headers into every
        # compile — that breaks the iOS native build (xcodebuild/CMake pods
        # compile Nix libc++ against the iPhoneOS SDK -> FP_ZERO/uint8_t errors).
        devShells.default = pkgs.mkShellNoCC {
          name = "streamyfin";

          packages = with pkgs; [
            # JS toolchain
            bun # primary package manager / runner (CI pins 1.4.2)
            nodejs_22 # Node >20 required by the project

            # React Native / Metro
            watchman

            # Java (Android / Gradle) — pinned to 17
            jdk

            # iOS native dependency manager (macOS only, harmless elsewhere)
            cocoapods

            # General tooling used by scripts / submodules
            git
            jq
          ];

          JAVA_HOME = "${jdk}";

          # CocoaPods (Ruby) needs a UTF-8 locale or `pod install` crashes with
          # "Unicode Normalization not appropriate for ASCII-8BIT".
          LANG = "en_US.UTF-8";
          LC_ALL = "en_US.UTF-8";

          shellHook = ''
            # --- iOS toolchain fix -------------------------------------------
            # The Nix `cocoapods` package pulls in apple-sdk/xcbuild stubs that
            # export DEVELOPER_DIR / SDKROOT and a fake `xcrun`, all of which
            # shadow the real Xcode toolchain and break on-device iOS builds.
            # Defer Apple tooling to the system Xcode (selected via xcode-select)
            # while keeping every other tool from Nix.
            unset DEVELOPER_DIR SDKROOT
            _xcshim="''${TMPDIR:-/tmp}/streamyfin-xcode-shim"
            mkdir -p "$_xcshim"
            # Real xcrun (not Nix's xcbuild stub).
            [ -x /usr/bin/xcrun ] && ln -sf /usr/bin/xcrun "$_xcshim/xcrun"
            # macOS bsdtar, not Nix GNU tar: Expo's precompiled xcframework
            # unpacking expects bsdtar; GNU tar corrupts the plist and forces a
            # slow full build-from-source of React/Hermes.
            [ -x /usr/bin/tar ] && ln -sf /usr/bin/tar "$_xcshim/tar"
            export PATH="$_xcshim:$PATH"
            # Defensive: ensure no stray Nix C/C++ toolchain vars leak into the
            # Xcode build and pull in Nix's libc++/SDK headers.
            unset CC CXX NIX_CFLAGS_COMPILE NIX_LDFLAGS \
                  MACOSX_DEPLOYMENT_TARGET SDKROOT DEVELOPER_DIR \
                  CPATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH \
                  OBJC_INCLUDE_PATH LIBRARY_PATH 2>/dev/null || true
            # -----------------------------------------------------------------

            echo ""
            echo "🎬 Streamyfin dev shell"
            echo "   node : $(node --version)"
            echo "   bun  : $(bun --version)"
            echo "   java : $(java -version 2>&1 | head -n1)"
            echo ""
            echo "First-time setup:"
            echo "   bun i && bun run submodule-reload"
            echo "   bun run prebuild"
            echo "   bun run ios   # or: bun run android"
            echo ""
            echo "Note: Xcode (iOS) and/or Android Studio + SDK are still"
            echo "      required for native builds and emulators/simulators."
            echo ""
          '';
        };
      }
    );
}
