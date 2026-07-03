# YOMIFIN_CONTEXT.md — read this first

Yomifin is a **personal iPad language-immersion player** built as a fork of
Streamyfin (React Native / Expo Jellyfin client with a libmpv playback core).
It adds **tappable subtitles → Yomitan-style dictionary lookup → one-press Anki
cards with on-device audio + image**, for Japanese (Chinese later). Single user,
sideloaded, no App Store concerns.

- **What to build next / feature backlog:** `FEATURES.md` (the tracker — point a
  session at one feature there).
- **Historical planning docs** (original context, phase-by-phase implementation
  plans, spike reports): `docs/yomifin/archive/` — spelunking only, superseded
  by this file.
- **Vendored Yomitan provenance + re-vendor procedure:** `utils/yomifin/yomitan/VENDOR.md`.
- **Lookup-fidelity audit** ("can we silently miss a match Yomitan would find?" — no):
  `utils/yomifin/LOOKUP_FIDELITY.md`.
- Upstream Streamyfin conventions (bun, Jotai, expo-router, TV patterns): `CLAUDE.md`.

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
  (11-ish bun suites: deinflection, lookup, structured content, sqlite parity,
  importer, config, markers, senses, cues, word audio). Add a test case when you
  add lookup/marker behavior. `bun run typecheck` + `bun run lint` must stay clean.
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
   transcode; `""` falls back to the playing (local) file. Capture runs **only** on
   "+ Anki card" press — tap time only freezes a cheap `CaptureContext`.
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
| Settings keys (`yomifin*`, `controlsDimOpacity`) | `utils/atoms/settings.ts` |
| Settings screens: Dictionaries / Anki / Reader | `app/(auth)/(tabs)/(home)/settings/{dictionaries,anki,reader}/` |
| Native mpv seams (subtitle text, sub-seek, capture) | `modules/mpv-player/` (`MpvPlayerView.swift`, `MPVLayerRenderer.swift`, module + TS ref) |
| Offline dictionary .db builder | `scripts/build-dictionary-db.ts` |
| Regression guards | `./scripts/yomifin-test.sh` |

## Native seams (mpv module) worth knowing

- `onSubtitleText {text,start,end}` — live cue (drives the overlay + tap-time freeze).
- `onProgress {position,duration,…}` (seconds; throttled) + `getCurrentPosition()`.
- `setSubtitleTrack(id)` / `setSubtitleVisibility(bool)` / `disableSubtitles()`;
  `getMpvSubtitleId` (`utils/jellyfin/subtitleUtils.ts`) maps Jellyfin→mpv track ids
  (this mapping was once wrong and picked the wrong initial track — fixed, beware).
- `subSeek(±1)` — prev/next cue via mpv `sub-seek`.
- `setSubtitleDelay(seconds)` — mpv `sub-delay` (positive = subs later); drives the
  online-subtitle sync UI. NB: `sub-text`'s start/end stay in the FILE timeline —
  the JS side adds the delay for capture/anchoring.
- `addSubtitleFile(pathOrUrl, select)` — mpv `sub-add`; online (jimaku) subs are
  downloaded to cache (`yomifin_sub_*`) and loaded through this.
- `captureScreenshot(path, sourceUrl, pos)` / `extractAudio(start, end, aid, path, sourceUrl)`
  — background-queue Promises (see Settled decision 4).
- `getCurrentAudioTrack()`, `getSubtitleTracks()`, `getTechnicalInfo()`.

Changes to `modules/mpv-player` (or any native dep / app.json plugin) need
`bun run prebuild` + `expo run:ios` (`just local` / `just remote`). Pure JS/TS
changes only need Metro (`just dev`).

## Dev environment & build (hard-won facts)

Toolchain is Nix (`flake.nix`): run everything via `nix develop` (or direnv). The
`justfile` wraps all workflows — `just setup` (fresh Mac), `just local` (build+
deploy to iPad), `just remote` (from SSH into the Mac build box), `just dev`
(Metro), `just yomifin-test`. Remote loop: Linux desktop → SSH → headless Mac mini
(`massimo@10.0.0.99`) → WiFi → iPad, via `./scripts/remote-build.sh`.

Facts that cost real time to learn (all reproducible via `app.json`/plugins —
**never hand-edit `ios/`**):

- **SSH keychain trap:** SSH sessions don't unlock the login keychain → signing
  fails remotely. `remote-build.sh` runs `security unlock-keychain` first. If
  codesign prompts repeatedly locally, run
  `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <pw> ~/Library/Keychains/login.keychain-db`.
- **Free Apple account:** bundle id `com.massimotseng.yomifin`, team `27326V9T54`
  (the Apple ID belongs to two teams; this one owns the App ID). Certs/profiles
  expire every **7 days** → rebuild + re-trust (Settings → General → VPN & Device
  Management). `plugins/withFreeAccountEntitlements.js` strips paid entitlements
  (push, wifi-info) — it must stay **first** in `app.json` plugins (Expo runs
  later-registered entitlement mods first); add new offending entitlement keys
  there if a "profile does not support X" error appears.
- **`plugins/withDisableScriptSandboxing.js`** keeps
  `ENABLE_USER_SCRIPT_SANDBOXING=NO` (Xcode 26 default breaks the RN packager
  build phase).
- **iPad UDID** for `expo run:ios --device`: `00008027-000641082130402E`
  (justfile default).
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
- **RNGH + RN touch responders don't compose** over the player: mixing a
  `GestureDetector` with the controls-dim `Pressable` broke both (two failed
  attempts). The gesture layer is now ONE RNGH composition
  (`GestureOverlay.tsx`: `Race(pan, Exclusive(twoFingerTap, doubleTap,
  singleTap))`) whose child View doubles as the controls-dim layer — never add an
  RN `Pressable`/`onTouch*` back into that surface. Two more traps hit on device:
  (1) dim that view via `backgroundColor: rgba(…)`, NEVER via `opacity` — UIKit
  hit-testing ignores views with alpha ≤ 0.01, so `opacity: 0` kills every gesture
  the moment controls hide; (2) **RNGH cannot recognize multi-touch taps on iOS,
  period** — its `RNTapHandler` counts taps per `touchesBegan` event, and on
  device a two-finger tap registered as a single tap, a double tap, or nothing
  across THREE different RNGH designs (`minPointers`, `Manual` touch observer,
  paired taps-2/minPointers-2 recognizers — all failed). Two-finger tap is now a
  NATIVE seam: `MpvPlayerView.swift` attaches a plain
  `UITapGestureRecognizer(numberOfTouchesRequired: 2)` to the WINDOW (the RN
  overlay sits above the mpv view, so window is the only place that sees the
  touches) as a pure observer (no cancels/delays) → `onTwoFingerTap` event →
  direct-player toggles play and calls `suppressTaps()`
  (`components/video-player/controls/tapSuppression.ts`) so the RNGH single/
  double-tap recognizers — which the same tap also satisfies — swallow it. The
  RNGH recognizers recognize in the SAME instant as the native one, so the
  suppression check races the bridge: GestureOverlay grace-delays tap execution
  ~150ms (doubleTap always; singleTap only when double-tap seek is off, since
  Exclusive already delays it ~280ms otherwise) and re-checks `tapsSuppressed()`
  at fire time. UIKit recognizer-prevention history: on seam v1, RNGH's doubleTap
  ACTIVATING failed the still-Possible native window tap (observed on device
  2026-07-02 as two-finger → seek); seam v2 sets a UIGestureRecognizerDelegate
  returning true from shouldRecognizeSimultaneouslyWith, making the native
  recognizer un-preventable — which is what allowed deleting GestureOverlay's
  RNGH two-finger recognizers for good (v2 verified working on device). NEVER
  run a v1/seam-less binary with this JS: the Metro probe logs the seam VERSION
  (`twoFingerTapSeamVersion`; v2 = current) — bump it on ANY native seam change
  so stale installs are provable. Feedback bubble: direct-player bumps
  `twoFingerNonce` → Controls → GestureOverlay effect shows pause/play. Also: a "full rebuild" that doesn't land on the iPad looks
  exactly like a broken native feature — the `hasTwoFingerTapSeam` probe logs
  PRESENT/MISSING in Metro on video load; trust it over assumptions.
  JS-side `onTouchesDown` events are also unreliable here (missed events,
  `trackedTouchCount` warnings): don't build gesture logic on them, and don't
  call `mgr.fail()` from `runOnJS(true)` callbacks (`setGestureState` is
  worklet-only).
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
  card. Never let capture errors block `addNote`.
- Debug logs are grep-able prefixes: `[YOMIFIN LOOKUP]`, `[YOMIFIN MEDIA]`,
  `[YOMIFIN ANKI]`, `[YOMIFIN SENSES]` (Metro), `[captureScreenshot]` (device).
