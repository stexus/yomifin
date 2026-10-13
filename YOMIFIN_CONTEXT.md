# YOMIFIN_CONTEXT.md — read this first

Yomifin is a **personal iPad language-immersion player** built as a fork of
Streamyfin (React Native / Expo Jellyfin client with a libmpv playback core).
It adds **tappable subtitles → Yomitan-style dictionary lookup → one-press Anki
cards with on-device audio + image**, for Japanese and Chinese (Chinese device gates remain in the tracker). Single user,
sideloaded with a purchased FlareStore certificate, no App Store concerns.

- **What to build next / feature backlog:** `FEATURES.md` (the tracker — point a
  session at one feature there).
- **Historical planning docs** (original context, phase-by-phase implementation
  plans, spike reports): `docs/yomifin/archive/` — spelunking only, superseded
  by this file.
- **Vendored Yomitan provenance + re-vendor procedure:** `utils/yomifin/yomitan/VENDOR.md`.
- **Lookup-fidelity audit** ("can we silently miss a match Yomitan would find?" — no):
  `utils/yomifin/LOOKUP_FIDELITY.md`.
- Upstream Streamyfin conventions (bun, Jotai, expo-router, TV patterns): `CLAUDE.md`.

## Upstream baseline — 2026-09-23

The isolated `sync/upstream-develop-2026-09-23` branch integrates Streamyfin
`develop` at `7fb905d1e887377ba80ca49b62582690729f77bf` (316 upstream commits).
The original `yomifin` branch is the clean pre-sync checkpoint `a5349749`.
This branch uses Expo SDK 57, React Native tvOS 0.86 and MPVKit 0.41.
Merge validation and remaining physical-iPad gates are in `FEATURES.md`.

The fork deliberately keeps iPhone/iPad on the RN player route, even if a stored
preference selects Native: upstream's fully native chrome does not host the
lookup/card overlays. `isNativePlayerSupported` in `utils/atoms/settings.ts`
enforces this; the upstream TV/Android options remain available. Native iOS
playback is now `MpvPlayerView → MPVPlayerEngine → MPVLayerRenderer`; preserve
the subtitle-text delegate and capture/visibility/sub-seek forwarding through
all three layers when syncing again.

`bun run test:unit` runs repository unit tests through `scripts/test-unit.ts`,
isolates `.ui.test.tsx` React component tests from native module mocks, then runs
the 20 standalone Yomifin/Yozora stages. Bare `bun test` also discovers the
ignored local Yomitan checkout and standalone scripts that can end its process
early. Use the package command for a complete result.

## Architecture

```
mpv (native, modules/mpv-player) ──onSubtitleText {text,start,end}──▶ direct-player.tsx
                                                                          │
        app/(auth)/player/direct-player.tsx  (integration seam: wires everything below)
                                                                          │
   YomifinLookupLayer (components/yomifin/) — overlay ABOVE the video surface
     ├─ TappableSubtitleOverlay   per-grapheme tap anchors on the live cue text
     ├─ tap → YomifinDictionary.lookup(textFromTapToEndOfLine)   (utils/yomifin/lookup.ts)
     │     └─ vendored Yomitan Translator (utils/yomifin/yomitan/)  — preprocessors,
     │        deinflection, "group" mode → panes (one headword per pane)
     │     └─ SqliteDictionaryDatabase → one combined indexed .db (all dictionaries)
     └─ DefinitionPopup — fixed-position panes, per-dict tints, selection,
           sentence strip (cue-range extend), "+ Anki card"
                 └─ anki.ts: marker templates (markers.ts) → AnkiConnect addNote
                 └─ ankiMedia.ts: on-device frame + audio clip via native mpv seams
```

Key principles (violating these has bitten us before):

- **The language layer is isolated and pure.** Everything under `utils/yomifin/`
  is RN-free and bun-testable (no settings reads inside — options are passed in).
  Device-only modules (expo-sqlite/expo-file-system) are confined to
  `dictionaryStore.ts` / `expoSqlite.ts` / `loadInstalledDictionary.ts`.
- **Everything rendered over the video sits inside `YomifinErrorBoundary`** so a
  popup crash can never freeze the app root (this happened; it took down the UI).
- **Run `./scripts/yomifin-test.sh` after any change under `utils/yomifin/`**
  (20 stages covering the language layer, card capture/submission, and Yozora helpers). Add a test case when you
  add lookup/marker behavior. `bun run typecheck` + `bun run check` must stay clean; `bun run lint` applies fixes.
- **Exit criteria are device gates.** JS-side tests are necessary, not sufficient;
  a feature is done when demonstrated on the physical iPad.

### Settled decisions — do NOT reopen

1. **Overlay, not sidebar.** libmpv renders into an `AVSampleBufferDisplayLayer`
   (plain CALayer/UIView) that doesn't swallow touches; RN views overlay it fine
   (Streamyfin's own `<Controls>` already do). Mount overlays as siblings of
   `<MpvPlayerView>` in `direct-player.tsx`.
2. **mpv owns subtitles (Pivot B).** Native emits `onSubtitleText {text,start,end}`
   (mpv `sub-text`). For TEXT tracks we hide mpv's rendering
   (`setSubtitleVisibility(false)`) and render our tappable overlay from that text —
   perfect sync, no flicker. BITMAP (PGS/VobSub) renders natively, overlay stays
   empty. The earlier "fetch SRT + interpolate a clock" approach flickered and was
   reverted. The full-track SRT parse (`yomifinCuesAtom`) is a **data source only**
   (multi-sentence cards, future sidebar), never the live overlay.
3. **Dictionaries are SQLite (Pivot A).** One combined `yomifin-dictionaries.db`
   (expo-sqlite default dir; persists across rebuilds, Finder-shareable). Import a
   Yomitan `.zip` on-device (chunked, ~2 min) or copy a prebuilt `.db` built by
   `scripts/build-dictionary-db.ts` (seconds). In-memory loading of a real
   dictionary is dead on device (~5 min parse, ~300MB heap, froze the JS thread);
   `InMemoryDictionaryDatabase` survives for tests/small fixtures only.
4. **Card media is captured on-device (Pivot C).** No server-side ffmpeg. Native
   seams in `modules/mpv-player` (iOS): `captureScreenshot` (throwaway `vo=libmpv`
   handle + SW render API → CPU frame → UIKit JPEG) and `extractAudio` (throwaway
   libmpv encode-mode handle → AAC `.m4a`). Both run on a background queue, both
   accept a `sourceUrl` = the **static/original** stream
   (`…/Videos/{id}/stream?static=true`) so a seek is an HTTP range request, never a
   transcode. Offline capture supplies its file URL explicitly; capture never falls
   back to the live player's source. Tap time freezes frame/cue times plus source
   URL/identity/headers. **Add** freezes the selected range, audio track and Anki
   settings before yielding for the spinner; only then does decoding run. A
   transcode's audio ID is mapped back to the original file. Cache keys/filenames
   distinguish source versions and audio tracks; in-flight captures stay deduplicated.
   Why the weird screenshot path: the playback `vo=avfoundation` has **no** VO-side
   screenshot (frames live on the GPU) and MPVKit's ffmpeg ships **no image
   encoders** — every simpler approach was tried and failed on device.
5. **All Anki field values flow through the marker engine** (`markers.ts`
   `renderTemplate` — Yomitan-style `{expression} {sentence} {glossary}
   {single-glossary:D} {picture} …`). Field maps are runtime config
   (`Settings.yomifinAnkiConfig`, edited in Settings → Anki); nothing hardcoded.
6. **Pane model:** lookup uses Translator `"group"` mode (Yomitan's popup mode) —
   one pane per headword, one definition block per dictionary inside it, sorted by
   the user's dictionary priority. `"simple"` fragments multi-dict results.

## File map

| Area | Where |
| --- | --- |
| Player integration (everything wires in here) | `app/(auth)/player/direct-player.tsx` |
| Overlay / popup / renderer / error boundary | `components/yomifin/` |
| Language layer (pure, tested) | `utils/yomifin/` |
| Vendored Yomitan core (don't edit; see VENDOR.md) | `utils/yomifin/yomitan/` |
| Cue store atoms | `utils/atoms/yomifinCueStore.ts` |
| Yozora on-demand client (tab · sections · player · pure API/session) | `utils/yozora/`, `components/yozora/`, `app/(auth)/(tabs)/(yozora)/`, `app/(auth)/player/yozora-player.tsx`, Settings → Yozora; plan: `docs/yomifin/archive/YOZORA_MIGRATION_PLAN.md` |
| Settings keys (`yomifin*`, `controlsDimOpacity`) | `utils/atoms/settings.ts` |
| Settings screens: Dictionaries / Anki / Reader | `app/(auth)/(tabs)/(home)/settings/{dictionaries,anki,reader}/` |
| Native mpv seams (subtitle text, sub-seek, capture) | `modules/mpv-player/` (`MpvPlayerView.swift`, `PlayerEngine.swift`, `MPVLayerRenderer.swift`, module + TS ref) |
| Native outlined subtitle text (TextKit stroke + char-index tap) | `modules/outlined-text/` (falls back to JS stacked copies on stale binary/non-iOS) |
| Offline dictionary .db builder | `scripts/build-dictionary-db.ts` |
| Regression guards | `./scripts/yomifin-test.sh` |

## Yozora integration status

The Yozora client replaces the old Anime/Stremio routes and direct addon clients.
All resolution, metadata and progress go through `/api/v1`; types/constants in
`utils/yozora/types.ts` are hand-maintained. `session.ts` stores credentials in
separate `yozora.*` MMKV keys, while settings hold only preferences. The player
receives canonical title/episode identity plus a resolved URL and resume time;
it sends progress ticks and can re-resolve an expired URL. Both players share
`components/video-player/controls/PlayerControls.tsx`, its menu sheets, status
bar, timeline, transport and interaction behavior, alongside the lookup layer and
optional-server `OnlineSubtitlesModal`. `Controls.tsx` and `YozoraPlayerControls.tsx`
are source adapters; shared UI receives plain data/callbacks and milliseconds.
The menu sheets report open/dismiss state to suspend control hiding. Native
subtitle scaling lives in `hooks/usePlayerSubtitleStyle.ts`. Keep session/reporting,
subtitle loading and mining snapshots inside their source routes.

See `FEATURES.md` for pending device gates and the unimplemented detail-page
parity pass. The archived migration plan is historical, not a second tracker.

## Native seams (mpv module) worth knowing

- `onSubtitleText {text,start,end}` — live cue (drives the overlay + tap-time freeze).
- `onProgress {position,duration,…}` (seconds; throttled) + `getCurrentPosition()`.
- `setSubtitleTrack(id)` / `setSubtitleVisibility(bool)` / `disableSubtitles()`;
  `applyMpvSubtitleSelection` / `resolveSubtitleTrack`
  (`utils/jellyfin/subtitleUtils.ts`) match Jellyfin streams to real mpv track
  identities. Do not restore the old positional `getMpvSubtitleId` mapping.
  External Yomifin subtitle selection must bypass Jellyfin's track reselection.
- `subSeek(±1)` — prev/next cue via mpv `sub-seek`.
- `setSubtitleDelay(seconds)` — mpv `sub-delay` (positive = subs later); drives the
  online-subtitle sync UI. NB: `sub-text`'s start/end stay in the FILE timeline —
  the JS side adds the delay for capture/anchoring.
- `addSubtitleFile(pathOrUrl, select)` — mpv `sub-add`; online (jimaku) subs are
  downloaded to cache (`yomifin_sub_*`) and loaded through this.
- `captureScreenshot(path, sourceUrl, pos, headers)` / `extractAudio(start, end, aid, path, sourceUrl, headers)`
  — background-queue Promises with explicit frozen inputs (see Settled decision 4).
- `getCurrentAudioTrack()`, `getSubtitleTracks()`, `getTechnicalInfo()`.
- **Gesture surface (separate module, `modules/gesture-surface/`)** —
  `YomifinGestureSurface` expo view owning ALL video tap gestures (single/double/
  two-finger) via one UIKit recognizer tree; mounted inside `GestureOverlay.tsx`.
  Sync availability probe: `requireOptionalNativeModule` (null = stale binary →
  legacy RNGH-tap fallback). mpv's `twoFingerTapSeamVersion` = 3 in binaries that
  have it (the old window recognizer is REMOVED there). PAN stays an RNGH worklet
  on purpose — drag-anywhere-to-seek writes SharedValues on the UI thread.

Changes to `modules/mpv-player` (or any native dep / app.json plugin) need a
fresh native binary: `just ipa` + FlareStore sign/install, or the Xcode development
path `just local` / `just remote`. Pure JS/TS changes only need Metro (`just dev`)
when using a development build; standalone Release installs need another IPA.

**NEW local module trap:** editing sources inside an EXISTING module pod
recompiles fine with plain `expo run:ios`, but a NEW `modules/<name>/` pod only
links when pod install re-runs — without it the app builds, runs, and
`requireOptionalNativeModule()` returns null (outlined-text stayed MISSING on
device through several rebuild rounds). `just local` / `remote-build.sh` now run
`scripts/ensure-pods-linked.sh` first (auto-prebuilds when a `modules/*/ios/*.podspec`
pod is absent from `ios/Podfile.lock`).

## Dev environment & build (hard-won facts)

### Two-app workflow (2026-10-13; GitHub Dev publication verified)

The user wants to keep a working daily-use app while developing on the same
iPad. User steps, actual commands, and agent implementation context are in
[Development and distribution](docs/yomifin/DEVELOPMENT_AND_DISTRIBUTION.md).

- Stable: `com.massimotseng.yomifin`, Release with bundled JavaScript; works
  without Metro. Preserve this identity and its existing installation/data.
- Development: `com.massimotseng.yomifin.dev`, Debug Expo development client.
  **Do not bundle the application's JavaScript into this IPA**: serve it from
  Metro for Fast Refresh. A standalone preview build does not meet this need.
- FlareStore uses the purchased certificate to sign/install both. GitHub
  Actions should build unsigned device IPAs and publish a two-app source;
  signing credentials stay in FlareStore.
- JS/TS work normally uses Metro. Swift/mpv, native dependencies, Expo plugins,
  entitlements, and other native changes require a new development-client IPA.
  Stable releases are deliberately selected after testing.
- Separate bundle IDs mean separate local settings/dictionaries/downloads;
  shared Jellyfin or Anki servers still share their server-side state.

Status: variant configuration, build/Metro commands, and GitHub workflow are
implemented. A local Debug IPA was built and inspected: `.dev` identity, no app
JavaScript bundle. GitHub has published Dev and the public source catalog; the
first stable build is running from `32608336` (tag `yomifin-stable-20261013-1`).
Check the distribution guide for its run link and current publication status.
Physical-iPad sign/install/refresh checks remain pending. Continue development
on `sync/upstream-develop-2026-09-23` with the setup commits incorporated;
`setup/yomifin-flarestore` contains its committed history plus the build setup.
The setup branch is historical; new work stays on the integration branch.
The shared player UI and Anki capture-isolation changes are now committed for
user-requested rebuilds tagged `yomifin-dev-20261013-2` and
`yomifin-stable-20261013-2`. Check their workflow status before assuming publication.
The first cloud Dev binary predates the new capture API; install the rebuilt Dev
client before using current Metro code. Physical-iPad feature checks remain open.
Agents should use existing Git SSH access to push build
tags; Actions publishes with its built-in `GITHUB_TOKEN`. Do not ask the user for
GitHub CLI login, OAuth authorization, or a PAT. The user handles iPad installation
prompts and, if the fork has Actions disabled, enables it in GitHub's Actions tab.
The source URL is live; check its entries rather than assuming an unpublished
variant is available.

A reproducible toolchain is available through Nix (`flake.nix`, `nix develop`
or direnv). The `justfile` uses tools on PATH directly (it no longer enters Nix);
`remote-build.sh` enters Nix when needed. The `justfile` wraps all workflows:
`just ipa-dev` (Metro Debug client), `just ipa-stable` / `just ipa` (standalone
Release IPA for FlareStore), `just setup`
(fresh Mac), `just local` / `just remote` (legacy Xcode development install),
`just dev` (Metro), and `just yomifin-test`.

### Current install flow: FlareStore certificate

As of 2026-09-23 the user uses a purchased FlareStore certificate. Build on the
Mac, then sign/install externally:

```bash
# From the repo, with Bun, CocoaPods and Xcode available (optionally nix develop):
just ipa-stable
# Output: build/stable/Yomifin.ipa
# Development client: just ipa-dev → build/development/Yomifin-Dev.ipa
```

`scripts/ios/build-variant.sh` installs frozen dependencies, initializes the pinned
submodule revisions, regenerates only the ignored iOS project, installs pods,
and runs the unsigned Release archive/IPA builder. It supplies the macOS tar /
Xcode tool guards even outside Nix. The resulting app bundles its JavaScript and
does not need Metro. Output lives under ignored `build/`; no signing credentials
or Apple account are needed to create it.

In FlareStore, select the purchased certificate/profile, import the IPA, and
sign/install. If the certificate is not already configured, its setup accepts
the `.p12`, `.mobileprovision` and P12 password.
[FlareStore's iPadOS guide](https://flarestore.app/guide/ios/).
Keep the bundle ID consistent with the existing installation you want to update
(the repo defaults to `com.massimotseng.yomifin`). Signing validity is governed by
that certificate/profile, not the old free-Personal-Team seven-day workflow.
Do not put signing assets/passwords in tracked files; `.p12` and
`.mobileprovision` are already ignored. The IPA command does not upload anything
to a signing service or modify the login keychain.

The low-level `ios:unsigned-build --sign` option uses Xcode automatic ad-hoc
export; it is not wired to the purchased certificate. Use external signing for
this flow. `just local` / `just remote` still use the configured personal Xcode
team for Metro development with the `.dev` identity; they do not automatically
select FlareStore assets.
The SSH development loop remains Linux → Mac mini (`massimo@10.0.0.99`) → iPad
via `./scripts/remote-build.sh`.

Facts that cost real time to learn (all reproducible via `app.json`/plugins —
**never hand-edit `ios/`**):

- **SSH keychain trap:** SSH sessions don't unlock the login keychain → signing
  fails remotely. `remote-build.sh` runs `security unlock-keychain` first. If
  codesign prompts repeatedly locally, run
  `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <pw> ~/Library/Keychains/login.keychain-db`.
- **Legacy free Apple account fallback:** bundle id `com.massimotseng.yomifin`, team `27326V9T54`
  (the Apple ID belongs to two teams; this one owns the App ID). Certs/profiles
  expire every **7 days** → rebuild + re-trust (Settings → General → VPN & Device
  Management). `plugins/withFreeAccountEntitlements.js` strips paid entitlements
  (push, wifi-info). This conservative entitlement set also remains in the
  externally signed IPA until the purchased profile's capabilities are checked;
  buying a certificate alone does not grant every entitlement. The plugin must
  stay **first** in `app.json` plugins (Expo runs
  later-registered entitlement mods first); add new offending entitlement keys
  there if a "profile does not support X" error appears.
- **`plugins/withDisableScriptSandboxing.js`** keeps
  `ENABLE_USER_SCRIPT_SANDBOXING=NO` (Xcode 26 default breaks the RN packager
  build phase).
- **iPad UDID** for `expo run:ios --device`: `00008027-000641082130402E`
  (justfile default).
- The SDK 57 `expo-modules-jsi@57.0.4` dependency needs the checked-in Bun patch
  qualifying `Swift.abs` in its Date decoder to compile with Xcode 26.3. The
  version-pinned patch is guarded by `scripts/check-patched-deps.ts`; revisit it
  when that package changes. Do not leave an untracked node_modules-only fix.
- The Nix shellHook deliberately defers to system Xcode (unsets
  `DEVELOPER_DIR`/`SDKROOT`, shadows Nix `xcrun`/GNU `tar`, clears `CC`/`CXX`,
  sets UTF-8 locale) — each of those guards a real failure; don't remove them.

## Gotchas / learned constraints (kept because they will bite again)

- **Hermes:** no `Intl.Segmenter` word granularity (overlay uses per-grapheme tap
  anchors — fine, the dictionary decides boundaries); avoid `\p{}` regex from
  upstream Yomitan (that's why `language-descriptors.js` is trimmed to JA+ZH).
- **RN can't read selection out of styled `<Text>`** — that's why popup selection
  is tap-to-select targets plus the ✎ plain-`TextInput` manual-trim fallback,
  not free text selection.
- **RNGH + RN touch responders don't compose** over the player: never add RN
  `Pressable`/`onTouch*` handlers to the gesture surface. Dim via
  `backgroundColor: rgba(…)`, never `opacity` (UIKit ignores hit tests below
  alpha 0.01). Current binaries use `YomifinGestureSurface` for single/double/
  two-finger taps with UIKit `require(toFail:)` arbitration; surface API v2
  gives double taps a 220ms window. RNGH owns the worklet pan and, after the
  upstream merge, the optional hold-to-speed gesture. The hold must restore
  speed on release/cancellation; its interaction with UIKit taps needs the
  merge's device gate. Do not rebuild the gesture tree when only a callback
  changes: actions read latest refs so a render cannot cancel an active hold.
  RNGH multi-touch taps failed repeatedly on iOS; do not reintroduce them.
  The old mpv window recognizer (seams 1/2), suppression/grace delay and nonce
  path survive only for stale binaries/Android; seam 3 removed that recognizer.
  Metro's seam version and surface PRESENT/MISSING probes identify the installed
  binary. A build that never lands on the iPad looks like a broken native seam.
  JS `onTouchesDown` was unreliable here, and `mgr.fail()` is worklet-only.
- **Anki duplicate detection** is collection-wide by default and first-field-only:
  we send `duplicateScope:"deck"`; a new reading on an existing Expression still
  rejects (Anki semantics, not a bug).
- **AnkiConnect from RN has no CORS** (native fetch), but the server needs
  `webBindAddress: 0.0.0.0`. Media upload (`storeMediaFile`) is idempotent by
  filename.
- **Popup z-order contract:** tap-outside backdrop `zIndex 9990` < subtitle
  overlay `9999` (so tapping another word re-looks-up instead of closing) <
  popup `100000` (above controls).
- **Best-effort card invariant:** any media/word-audio failure still adds a text
  card. Never let capture errors block `addNote`. Report missing attachments in the
  completion toast and omit references to failed uploads; do not retry `addNote`
  automatically.
- Debug logs are grep-able prefixes: `[YOMIFIN LOOKUP]`, `[YOMIFIN MEDIA]`,
  `[YOMIFIN ANKI]`, `[YOMIFIN SENSES]` (Metro), `[captureScreenshot]` (device).
