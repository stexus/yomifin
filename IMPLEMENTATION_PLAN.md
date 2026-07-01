# IMPLEMENTATION_PLAN.md — Japanese/Chinese Immersion Player for iPad

Read `CONTEXT.md` first. This plan is **spike-first, branch-on-result**: the riskiest
unknown (overlay-on-mpv) is proven before anything is built around it. Each phase has
an explicit **proves / exit criteria** so progress is verifiable, not vibes.

**MVP definition (the finish line for this plan):** a native iPad app that plays a
Jellyfin video via **libmpv**, shows **tappable subtitles**, does a **real Yomitan
lookup** on tap, and creates **one sentence-only Anki card** via the 24/7 server's
AnkiConnect. Audio/image, ASS, profiles, storage-at-scale are explicitly v2.

---

## STATUS & HANDOFF (updated 2026-06-29) — READ THIS FIRST

Where we actually are, and two **architecture pivots** that supersede parts of the
phase text below. (The original phase descriptions are kept for history; where they
conflict with this section, **this section wins**.)

### Done & on-device validated
- **Phase –1 / 0 / 1 / 2** complete. Real Yomitan lookup works on the iPad: tap a
  conjugated word → deinflect → dictionary entry → structured-content popup.
- **On-device dictionary import** (Settings → Dictionaries): import a Yomitan `.zip`
  (chunked, progress bar, ~2 min once) or a prebuilt `.db` (seconds). Validated.

### Done, pending ONE native rebuild to validate
These are committed but only exercise after `expo run:ios` (they touch native /
new deps). Rebuild cmd: `nix develop --command bash -c 'EXPO_TV=0 bunx expo run:ios
--device 00008027-000641082130402E'`.
- **Pivot B (mpv-driven subtitles)** — see below.
- **expo-sqlite storage** + the **initial-subtitle-track fix**.
- **Smoke test after rebuild:** (1) subtitle starts on the *correct* track, (2)
  switching is instant, (3) PGS renders natively (overlay empty), (4) import a dict
  and confirm it survives an incremental rebuild.

### PIVOT A — dictionary storage: in-memory → SQLite (supersedes "in-memory MVP" + Phase 6 storage)
In-memory load was dead on device (~5 min synchronous parse, ~300MB heap, froze the
JS thread → UI/navigation crashes). Now: an **offline builder**
(`scripts/build-dictionary-db.ts`) and an identical **on-device importer** turn a
Yomitan `.zip` into a single indexed SQLite `.db`; lookups are one indexed query
(sub-ms). Storage sits behind the `SqlRunner`/`SqliteDictionaryDatabase` interface;
shared `importDictionary.ts` guarantees offline and device imports match. The combined
`yomifin-dictionaries.db` lives in the app Documents container, so it **persists
across normal rebuilds**; only a clean uninstall wipes it (re-add via prebuilt `.db`
in seconds, or Finder file-sharing).

### PIVOT B — subtitles: app-rendered SRT → mpv-driven (supersedes CONTEXT §7 and Phase 1/2 subtitle text)
Fetching a separate Jellyfin SRT + interpolating a clock at 60fps caused flicker, slow
switching, and couldn't show PGS. Now **mpv owns subtitle loading/selection/timing**.
Native emits `onSubtitleText {text, start, end}` (mpv `sub-text`); for TEXT subs we
`setSubtitleVisibility(false)` and render our tappable overlay from that text (perfect
sync, no flicker); BITMAP subs (PGS/VobSub) render natively and the overlay stays
empty. `getMpvSubtitleId` (Streamyfin's existing Jellyfin→mpv mapping) selects tracks.

### Safety / infra added
- **`YomifinErrorBoundary`** wraps the lookup layer + popup so a render crash in the
  experimental layer can never take down the app root (was causing full-UI freezes).
- **Regression guards:** `./scripts/yomifin-test.sh` (5 suites: deinflector, lookup
  integration, structured-content, sqlite parity, importer idempotency+parity). Run
  after any language-layer change. All green.

### Commit trail (branch `yomifin`)
`Phase 2 lookup` → `device fixes` → `error boundary` → `SQLite backend` → `Pivot B
mpv subs` → `shared importer` → `single-file db` → `on-device import + Dictionaries
UI` → `initial-track fix` (HEAD). `git log --oneline` for hashes.

### PIVOT C — Phase 4 media: server-side ffmpeg → ON-DEVICE (supersedes Phase 4 + CONTEXT §"Server-side ffmpeg")
User directive: do as much **on-device** as possible; streaming-vs-local must not
matter. We do NOT build the 24/7-server ffmpeg endpoint. Both audio + image are
produced on-device with the **ffmpeg already bundled in MPVKit** (verified from the
binary's build flags: `screenshot-to-file` present; encoders incl. `aac`; muxers incl.
`mp4`/`mov`/`matroska` → `.m4a` works; full demux/decode set). The only network hop is
the inherent POST to AnkiConnect (no on-device AnkiConnect exists on iOS).

### Phase 4 (Anki quality cards) — DONE ✅ (full media card mined on iPad, optimized)
Fully on-device, best-effort (a capture failure still adds a text card — Phase 3 can't
regress). Final shape after device tests #1–#5 below. New native seams in
`modules/mpv-player` (iOS):
- `captureScreenshot(path, sourceUrl, pos)` — throwaway **`vo=libmpv` + SW render API**
  handle seeks `sourceUrl` to `pos`, renders one frame to a CPU buffer, JPEG via UIKit.
  (mpv's own `screenshot*` can't work: the playback `vo=avfoundation` has no VO-side
  screenshot, and MPVKit's ffmpeg has no image encoders.)
- `extractAudio(start,end,aid,path,sourceUrl)` — throwaway **libmpv encode-mode handle**
  → AAC `.m4a` of `[start,end]`. Works streamed + local.
- Capture runs **only on "+ Anki card" press** (cheap `onSnapshotCard()` freezes cue +
  frame pos at tap); `sourceUrl` is the **static/original** stream (no transcode);
  capture handle is `hwdec=auto`. See "cost optimizations" below.
Wired: `MPVLayerRenderer` → `MpvPlayerView` → `MpvPlayerModule` → TS ref
(`captureScreenshot`/`extractAudio`). JS: `utils/yomifin/ankiMedia.ts` (capture+base64),
`anki.ts` (`storeMediaFile` + media field refs), `ankiConfig.ts` (added `sentenceAudio`/
`picture` field names). `direct-player` captures cue `{start,end}` from `onSubtitleText`
and passes `onCaptureMedia` into `YomifinLookupLayer`; capture starts at tap (frozen
frame), is awaited on "+ Anki card".

**Device test #1 results (2026-06-30):** audio `.m4a` WORKS (encode handle confirmed on
iOS). Two bugs found + fixed:
- **Picture didn't go over.** Root cause: MPVKit's ffmpeg ships **no image encoders**
  (png/mjpeg/webp absent; only aac etc.), so `screenshot-to-file` can't write a JPG and
  fails silently. FIX: `captureScreenshot` now uses `screenshot-raw` (raw pixels, no
  encoder) + **iOS-native UIKit/CoreGraphics JPEG** encode. (Needs the next rebuild.)
- **False "duplicate" for words not in the deck.** Root cause: Anki's default duplicate
  scope is the whole collection (any note of the model), so a word in another deck
  flags as dup. FIX: `addNote` now sets `duplicateScope:"deck"` +
  `duplicateScopeOptions{deckName}`. (JS-only.)
- **Logging added:** `[YOMIFIN MEDIA]` (capture steps + byte counts) and `[YOMIFIN
  ANKI]` (addNote fields/media + errors) in Metro; native `[captureScreenshot]` logs in
  Xcode/device console.

**Device test #2 results (2026-06-30):** duplicate fix ✅, audio ✅. Screenshot still
`false` — `screenshot-raw` returned nothing because our custom `vo=avfoundation` has no
VO-side screenshot and frames are on the GPU (videotoolbox). FIX: `captureScreenshot`
now sets `screenshot-sw=yes` (force swscale CPU path, VO-independent) and **throws a
descriptive reason** that surfaces in Metro (so we no longer need Xcode logs to debug).

**Device test #3 results (2026-06-30):** screenshot still failed — `screenshot-raw
failed: error running command`. Root cause confirmed: the custom `vo=avfoundation`
(AVSampleBufferDisplayLayer) implements **no** VO-side screenshot and frames live on the
GPU, so *no* mpv `screenshot` command can ever work on the main handle.

**New approach (rebuild #4):** `captureScreenshot` now spins a **throwaway handle with
`vo=libmpv` + the software render API** (`MPV_RENDER_API_TYPE_SW`), seeks it to the
current position, renders ONE frame into a CPU buffer (libplacebo/swscale, no GL/Metal,
no ffmpeg image encoder), and encodes the JPEG with iOS-native UIKit. Fully on-device;
streamed + local. (Verified the render API + SW params are in MPVKit and link normally
— the sym-ptr block is `#ifdef MPV_CPLUGIN_DYNAMIC_SYM`, off here.) Still throws a
descriptive reason to Metro on failure (`render ctx`, `no frame`, `sw render`, etc.).

**Device test #4 results (2026-06-30):** ✅ Picture lands. Full card (Expression/Reading/
Sentence/Glossary + SentenceAudio + Picture) confirmed end-to-end on device.

### Phase 4 cost optimizations (rebuild #5)
The render-API capture works but re-opens+seeks the source; addressed three costs:
- **Capture-on-press, not per-tap (JS-only, biggest win):** capture used to fire on
  EVERY lookup tap. Now `YomifinLookupLayer` only takes a cheap `onSnapshotCard()`
  (freeze cue range + frame position) at tap; the expensive seek/decode runs **only**
  when "+ Anki card" is pressed (`onCaptureMedia(ctx, baseName)`). The seek targets the
  frozen position, so correctness holds even though capture is deferred.
- **Static/original stream for capture (kills transcode):** the throwaway handles point
  at `…/Videos/{id}/stream?static=true&api_key=…` (built in `direct-player`), so seeking
  2h in is a plain HTTP range request, never a second transcode — regardless of the
  playback session. `sourceUrl=""` (offline) falls back to the playing local file.
  Native `captureScreenshot`/`extractAudio` gained a `sourceUrl` param.
- **Power:** capture handle now `hwdec=auto` (hardware-decode the GOP, SW-download one
  frame) instead of full software decode.
- **Not done (future):** the zero-extra-cost path is tapping the `avfoundation` VO's
  enqueued `CVPixelBuffer` — needs a forked/patched MPVKit that exposes it. Until then,
  the per-card cost is one bounded range-request + one-GOP decode, hidden behind the
  card-add spinner.

**Device test #5 (after rebuild):** confirm card still lands with media; verify ordinary
lookups no longer trigger `[YOMIFIN MEDIA]` logs (only the add-card press does).

**Follow-ups (not built):** pause-on-popup for a cleaner frame; extend-selection to
prev/next cue for more context; tune AAC bitrate; `canAddNotes` pre-check.

### Phase 3 (Anki) — DONE ✅ (text card mined on iPad)
The end-to-end loop is wired (hardcode-to-prove first; settings screen deferred):
- `utils/yomifin/ankiConfig.ts` — **single hardcoded config seam** (url/deck/model/
  field-map/tags). **EDIT THESE before first card test** (server IP, deck, note-type,
  field names). Designed as a drop-in: Phase 5 swaps `getAnkiConfig()` to read the
  settings store, nothing else changes.
- `utils/yomifin/anki.ts` — AnkiConnect `addNote` client via native fetch (no CORS),
  plus a structured-content→plain-text gloss flattener (never ships the RN tree).
- `DefinitionPopup` gained a **"+ Anki card"** button → success/error `toast`
  (sonner-native). Sentence is **frozen at tap time** in `YomifinLookupLayer`
  (`setSentence(text)` in `handleWordTap`) and threaded into the popup.
- Field mapping (default hardcoded): Expression=lemma, Sentence=cue; reading/glossary
  fields available but blank by default ("" = skip).

**Validated:** with `ankiConfig.ts` set for the user's server (deck `Testing`, model
`Lapis-Jp`) and `webBindAddress=0.0.0.0`, a text card was mined on the iPad and landed
in Anki. MVP exit criteria met. Terminal-proven extras: first-field duplicate rejection
surfaces as a toast; `storeMediaFile` round-trips media (used by Phase 4).

**Deferred / follow-ups:** (1) minimal Anki settings screen (plan §Config) — skipped
for now per hardcode-to-prove. (2) `canAddNotes` pre-check / smarter dedupe UX (MVP
relies on allowDuplicate:false + surfaced error; note Anki dedups on the FIRST field
only, so a new reading on an existing Expression is still rejected).

---

## Phase –1 — Environment (prerequisite, do once)

**Goal:** be able to build and run *unmodified* Streamyfin on the iPad.

**Build infrastructure (PROVISIONAL — see CONTEXT §1a; don't get married to it):**
intended setup is Linux desktop → SSH → headless M4 Mac Mini (build box) → WiFi →
iPad. Fall back to coding directly on the Mac if this is more friction than it's
worth. One-time setup steps to expect:
- Install Xcode on the Mini headlessly (`xcodes`, then `sudo xcodebuild -license
  accept`).
- One VNC/Screen Sharing session to set up Apple ID + development certificate +
  device/provisioning in Xcode's GUI.
- Pair the iPad by cable ONCE to enable wireless deploy; thereafter use
  `xcrun devicectl` over WiFi (needs explicit `--device <id>`).
- Add `security unlock-keychain` to the build script to avoid the SSH signing
  failure. Budget an afternoon for signing/keychain specifically.

**Then:**
- Set up the Node/Expo toolchain and CocoaPods on the Mini.
- Clone Streamyfin, get it building, run it on the physical iPad (not just the
  simulator — the simulator may not exercise the libmpv path correctly).
- Connect it to the real Jellyfin server; confirm a video plays via its libmpv
  backend.

**Exit criteria:** unmodified Streamyfin plays a Jellyfin video on the physical iPad,
built and deployed via the chosen infrastructure. **If this fails, stop** —
everything downstream depends on it. Do not modify anything yet.

---

## Phase 0 — THE OVERLAY SPIKE (the hinge) — DONE ✅ PASS

**Result:** overlay-on-mpv PASSED on the physical iPad. libmpv renders into an
`AVSampleBufferDisplayLayer` (a normal CALayer in a plain UIView/ExpoView), not a
raw Metal/GL surface; `MpvPlayerView` doesn't swallow touches; and Streamyfin
already overlays interactive RN `<Controls>` as siblings of the player. A hardcoded
tappable 猫 label mounted over playing video received taps and logged. **Overlay is
the adopted container; sidebar is a trivial future fallback.** Seam map written to
`PHASE0_SEAMS.md`. Throwaway spike code removed.


**Goal:** prove (or kill) overlay-on-mpv with the smallest possible change.

**Investigation first (Claude Code task):** map Streamyfin's player. Produce a short
report identifying seams (a)–(d) from `CONTEXT.md §5`: the video-surface view, how to
read current timestamp, how to snapshot a frame, how to access subtitle tracks and
disable mpv's own subtitle rendering. Do not refactor — just locate and document.

**The spike:** render ONE hardcoded tappable label (e.g. the word 猫) positioned
**on top of** the libmpv video surface. Tapping it logs to console. Nothing else.

**Exit criteria (branch point):**
- **PASS** — the label sits over playing video and receives the tap →
  **overlay architecture confirmed.** Proceed with overlay as the container in all
  later phases. Sidebar becomes a trivial future fallback.
- **FAIL** — the mpv surface won't accept touchable overlays (swallows touches /
  refuses sibling views) → **fall back to the sidebar container** (flex row: mpv view
  at reduced width + a sidebar view holding the tappable text). Re-run this same
  one-label tap test inside the sidebar to confirm, then proceed with sidebar.

Either way you exit Phase 0 with a **known container** for tappable text. All
remaining phases are container-agnostic — only the *mount location* of the text
differs; the engine, parsing, and card logic are identical.

**Throwaway code is expected here.** Do not build for reuse; build to learn.

---

## Phase 1 — Tappable subtitles synced to playback — DONE ✅ PASS

**Result:** PASS on the physical iPad. Fetched one Jellyfin SRT (287 cues parsed),
mpv's own subs disabled, the active line renders bottom-center over the video and
updates with playback, and tapping a word logs the correct from-token-to-end-of-line
text. Tap anchors are per-grapheme (Intl.Segmenter word granularity is not present
in this Hermes build → per-grapheme fallback) — acceptable, since Phase 2 owns real
boundaries. Code (isolated language layer): `utils/yomifin/{srt,segment,fetchSubtitleSrt}.ts`,
`components/yomifin/TappableSubtitleOverlay.tsx`, wired in
`app/(auth)/player/direct-player.tsx`.

**Original goal:** real subtitle text, tappable, synced to the video, in the chosen container.

1. Fetch ONE SRT file for the playing item from Jellyfin as data. Parse it
   (lines + start/end timings). SRT only for now.
2. Disable mpv's own subtitle rendering (`sub-visibility=no` / don't load the sub
   track into mpv).
3. Read mpv's current playback timestamp; determine the active subtitle line.
4. Render the active line as tappable word-spans (segment the line into tap anchors;
   the segmenter can be crude here — even naive — because Phase 2 owns real
   boundaries). Tap → log the tapped token + the text from that token to end of line.
5. Advance/replace the line as playback time crosses boundaries.

**Exit criteria:** playing a Jellyfin video, the correct subtitle line shows in the
container and updates with playback; tapping a word logs the correct "from-here-to-
end-of-line" text.

---

## Phase 2 — Real Yomitan lookup (second-biggest risk)

**Goal:** tapping a word produces a real dictionary definition via harvested Yomitan
core. This is where "working Yomitan support" is actually proven.

**Investigation first (Claude Code task):** map Yomitan's core. Identify and assess
extraction difficulty for: the **deinflector**, the **dictionary-database / lookup
layer** (and its IndexedDB dependency), and the **structured-content renderer**.
Output: which modules to lift, what their external dependencies are, and the plan to
repoint storage to **SQLite or in-memory**.

**Build:**
1. Harvest the Yomitan core modules into the RN app, discarding the extension shell
   (storage, DOM scanning, messaging, background/content-script split).
2. Load ONE dictionary the crude way (in memory is fine for MVP; do not solve
   large-scale SQLite storage yet). Use a Japanese dictionary first (deinflection is
   the harder, more valuable path to prove).
3. Wire Phase 1's tap → forward-greedy lookup (deinflection for JA) → result.
4. Render the definition in a popup using the **structured-content renderer** (needed
   even for "definitions only").

**Exit criteria:** tapping a conjugated Japanese word in a real subtitle resolves to
its dictionary entry and shows a correctly rendered definition popup. (Chinese
longest-match can be validated next, but JA-with-deinflection is the gate.)

**DONE ✅** — plus two pivots that changed *how* this works vs the text above:
storage is **SQLite** (not in-memory; see STATUS → Pivot A) and subtitle text is
**mpv-driven** (not app-fetched SRT; see STATUS → Pivot B). Code lives in
`utils/yomifin/` (deinflect, termMatching, Sqlite/InMemory DBs, importer, lookup,
structuredContent) and `components/yomifin/` (overlay, popup, StructuredContent,
error boundary, lookup layer).

---

## Phase 3 — One Anki card (sentence only)  ← NEXT

**Goal:** close the loop end to end.

1. Popup gets a "make card" button.
2. On press, assemble a note: the looked-up word + the current full subtitle sentence.
   No audio, no image yet.
3. POST a complete note to the 24/7 server's AnkiConnect (`addNote`) into a
   **hardcoded** deck/note-type for now (profiles are v2).
4. Confirm the card appears in Anki.

**Exit criteria:** tapping a word and pressing "make card" lands a sentence card in
Anki on the server. **This completes the MVP.**

### Implementation notes (current insight after Pivots A/B)

- **Where the sentence comes from (changed by Pivot B):** the current sentence is the
  live mpv subtitle text — already in `direct-player`'s `yomifinSubtitleText` state and
  passed to `YomifinLookupLayer` as the `text` prop. **Capture it at tap time** (in
  `handleWordTap`) so it's frozen even if playback continues, and thread it into
  `DefinitionPopup` (which currently only gets the `LookupResult`). The tapped line is
  also available in `TappableSubtitleOverlay.handleTokenPress` (`line`).
- **Where the word/reading/definition come from:** the `LookupResult` already has
  `entries[0].term` (lemma), `.reading`, `.definitions`, and `.matchedText` (surface).
  Decide field mapping: e.g. Expression=lemma, Reading=reading, Sentence=captured
  subtitle, optionally a plain-text gloss. (Glossary is structured content — for the
  Anki field, flatten to text or send minimal HTML; don't ship the RN tree.)
- **No CORS in React Native.** AnkiConnect's CORS allow-list is a *browser* concern;
  native `fetch` from RN bypasses it. The user must still set AnkiConnect
  `webBindAddress` to `0.0.0.0` (or LAN IP) so it's reachable off-localhost. POST:
  `fetch('http://<server>:8765', {method:'POST', body: JSON.stringify({action:'addNote',
  version:6, params:{note:{deckName, modelName, fields:{...}, tags:['yomifin'],
  options:{allowDuplicate:false}}}})})`. Response is `{result, error}` — surface
  `error` to the user (e.g. duplicate, missing deck/model).
- **Config:** add a minimal **Anki settings screen** (mirror the Dictionaries screen
  pattern: `settings/anki/page.tsx` + route + ListItem) holding server URL, deck,
  model, and field names. Persist with the app's settings store. Runtime-configurable
  field mapping is the Phase 5 goal but a basic version here avoids recompiles.
- **Error isolation:** the "make card" action is async + network — wrap in try/catch,
  show a success/failure toast; the popup is already inside `YomifinErrorBoundary`.
- **Phase 4 readiness (don't build yet, but preserve the data):** the
  `onSubtitleText` event already carries `{start, end}` (the cue's time range) — these
  are exactly the clip boundaries the server-side ffmpeg step will need. `direct-player`
  has the Jellyfin `item` + current `progress`. Consider capturing `{itemId, start,
  end}` alongside the sentence at card time so Phase 4 (audio/image) is a drop-in.
- **Duplicate handling:** `allowDuplicate:false` + show AnkiConnect's duplicate error
  is the MVP; `canAddNotes` pre-check and dedupe UX are later polish.

---

## MVP COMPLETE (Phases 0–4). Everything below is the **v2 roadmap** (revised 2026-06-30).

> **This roadmap supersedes the old Phases 5–8** (profiles / ZH parity / ASS / online
> subs). Those were de-prioritized. The new priority is to make the *mining + reading*
> experience excellent: a subtitle sidebar, configurable runtime Anki fields with
> Yomitan-style field markers, multiple dictionaries with themed UI, multi-result
> cycleable lookup panes, lookup-engine fidelity, and player-interaction polish.
> Chinese parity, ASS, and online subtitle sources are pushed to a **"Later / parked"**
> bucket at the bottom — not dropped, just not next.

### Requirements → phase map (so nothing is lost)

| User request | Phase |
| --- | --- |
| Popup opens in a static location, fixed size, never hidden by UI | **5** |
| Lookup pauses video; closing resumes (configurable setting) | **5** |
| Reduce dim when playback menu is up | **5** |
| Two-finger tap = pause; double-tap left/right = seek ∓ | **5** |
| UI + gesture to go back/forward by **subtitle** (not time) | **5** (nav) / **8** (cue store) |
| Fix lookup logic to match Yomitan (あっさり → あさり / 漁る, no あ/あっ spam) | **6** |
| Multiple word readings / lookup results as **cycleable panes** | **6** |
| Support 5–10+ **dictionaries** | **7** |
| Per-dictionary subtle UI boundary (e.g. background tint) | **7** |
| Popup light / dark / auto theme from settings | **7** |
| Anki fields **configurable per note type, at runtime** (not hardcoded) | **8** |
| Yomitan-style field markers ({audio} {glossary} {single-glossary:DICT} {popup-selection-text}) | **8** |
| Tap a dictionary section (selects all its text) or a single definition within it | **8** (selection model, designed in 6/7) |
| Anki card can use **multiple sentences** for sentence/audio (default 1) | **8** (cue store + assembly) |
| **Batch / dedup media** — multiple words from one sentence share one audio+image (no dup files in Anki) | **9** |
| Subtitle **sidebar** with timestamps; tap a line → seek there (de-prioritized) | **10** |
| **Yomitan settings parity** — expose Yomitan's lookup/scan options (max results, scan length, …) | **11** |

---

## Phase 5 — Player interaction polish (low risk, high daily value) — MOSTLY DONE ✅ (gestures deferred ⏸️)

> **Status:** 5 of 6 items shipped; only the **video gestures** (two-finger-tap
> play/pause + double-tap-L/R-to-seek) are **deferred** — they never worked reliably on
> the physical iPad. Two approaches both failed on device: (1) extending the existing RN
> touch pipeline (`useGestureDetection`, `onTouch*` on a `Pressable`) with multi-touch
> counting + double-tap disambiguation → `trackedTouchCount` warnings, unreliable
> two-finger, laggy single tap; (2) a react-native-gesture-handler `GestureDetector`
> wrapping the overlay → the RNGH recognizer fought the dim `Pressable`'s `onPress` (at
> 0% dim the controls would never hide) and two-finger still didn't fire. Both attempts
> were fully reverted.
>
> **Done (kept):**
> - Fixed-position/fixed-size `DefinitionPopup` (~⅓ width, near-full height, side
>   anchored via `yomifinPopupPosition`, tap-outside-to-close+resume). Renders above
>   controls at `zIndex 100000`.
> - Pause-on-lookup / resume-on-close (`yomifinPauseOnLookup`, `pausedByLookupRef` so it
>   never fights a manual pause) wired through `YomifinLookupLayer` → `direct-player`.
> - Reduced controls dim (`controlsDimOpacity`, default 0.4) in `GestureOverlay`.
> - Native mpv `sub-seek ±1` (`subSeek(delta)` across the Swift stack + module + TS ref)
>   for prev/next **cue**, surfaced as buttons in `CenterControls` next to the time-skip
>   controls (shown only when a subtitle track is selected).
> - Settings keys (`utils/atoms/settings.ts`) + a **Reader** settings screen
>   (`settings/reader/page.tsx`, registered in `(home)/_layout.tsx`, linked from
>   `settings.tsx`).
>
> **Deferred gesture work — when we come back:** treat it as its own investigation.
> Likely correct path: rebuild the *whole* video gesture layer (single tap, double-tap
> seek, two-finger tap, vertical brightness/volume drag, horizontal skip) in **one** RNGH
> `Gesture.Race`/`Gesture.Exclusive` composition rather than mixing RN touch responders
> with RNGH (the mixing caused the `onPress`/recognizer conflicts). Validate two-finger +
> double-tap on the physical iPad *first*. The `yomifinDoubleTapSeconds` /
> `yomifinTwoFingerTapPause` / `yomifinDoubleTapSeek` settings keys were intentionally
> **not** added back — add them with the gesture rebuild.
>
> **Note:** `subSeek` is native — it needs an iOS rebuild to take effect.

**Build:**
1. **Static, fixed popup.** Move `DefinitionPopup` from bottom-anchored/variable-height
   to a **fixed position + fixed size** box that always renders **above** the controls
   layer and is never occluded. In `direct-player`, mount `YomifinLookupLayer` (or just
   the popup) **last in the z-stack** and give the popup an explicit, settings-aware
   anchor (e.g. right or left third). Respect safe-area insets. The popup must not move
   or resize as content grows — it scrolls internally (it already has a `ScrollView`).
2. **Pause-on-lookup / resume-on-close (configurable).** Add a setting
   `yomifinPauseOnLookup` (default **on**). `YomifinLookupLayer` already calls
   `onLookupOpen?.()` — wire it in `direct-player` to `videoRef.current?.pause()` when
   the setting is on, and resume on popup `onClose` **only if** we were the ones who
   paused (track a `pausedByLookup` ref so we don't fight a user's manual pause).
3. **Reduce dim on controls.** Find the controls scrim/overlay opacity in
   `components/video-player/controls/Controls.tsx` and lower it (expose as a constant
   or a setting `controlsDimOpacity`). Goal: see the frame clearly while scrubbing.
4. **Gestures.** Add a `GestureDetector` (react-native-gesture-handler) layer over the
   video (must compose with the existing tap-to-toggle-controls and the subtitle
   overlay taps — be careful with hit ordering):
   - **Two-finger tap → toggle play/pause.**
   - **Double-tap left third → seek −N s; double-tap right third → seek +N s** (N as a
     setting, default 10). Use the existing `seek(positionMs)` callback.
5. **Subtitle prev/next navigation.** Add ◀▌ / ▌▶ controls (and optionally a 3-finger
   swipe) that jump to the previous/next **subtitle cue**, not a fixed time. Cleanest
   path: a native **`sub-seek -1` / `sub-seek 1`** mpv command exposed through
   `modules/mpv-player` (mpv jumps to the prev/next cue boundary natively, no JS cue
   list needed). If exposing a new native command is heavy, defer the *button* to
   Phase 8 (which builds the JS cue store) but keep the gesture stub here.

**Settings:** add a **"Yomifin / Reader"** settings group (`utils/atoms/settings.ts`
`Settings` interface + `defaultValues`, plus a settings screen mirroring the
Dictionaries page). New keys: `yomifinPauseOnLookup`, `yomifinDoubleTapSeconds`,
`controlsDimOpacity`, `yomifinPopupPosition`.

**Exit criteria (on device):** popup appears in a fixed spot above the controls and is
never covered; a lookup pauses the video and closing it resumes (toggle the setting and
confirm both behaviors); the frame is clearly visible with controls up; two-finger tap
pauses; double-tap L/R seeks; prev/next-subtitle moves by cue.

---

## Phase 6 — Lookup-engine fidelity + multi-result cycleable panes  ← NEXT

**Goal:** (a) make matching behave like Yomitan; (b) present results as **one headword
per pane**, cycled with forward/back, instead of one long dump.

**Investigation first (do before building):** reproduce the あっさり case against the
vendored Translator and diagnose. Yomitan resolves あっさり → あっさり (own entry), and
via **emphatic-sequence collapsing** (っ removal) → あさり → deinflect → 漁る; it does
*not* surface bare あ / あっ. Our app currently surfaces あ / あっ and misses
あさり / 漁る. Likely causes to check, in order:
   - **Text transformations not applied:** Yomitan's JA language descriptor runs
     `collapseEmphaticSequences` (and others) as `textReplacements`/`textPreprocessors`
     before lookup. Our `findTerms` call passes `textReplacements: [null]` and
     `removeNonJapaneseCharacters: false` — confirm the vendored
     `language-descriptors.js` preprocessors are actually wired into the Translator
     pipeline we lifted. This is the prime suspect for missing あさり/漁る.
   - **Spurious short prefixes:** あ / あっ are real interjection entries, but Yomitan
     ranks/groups them below the full match and doesn't explode every prefix into the
     headline. Check how `findTerms` merges results across scan lengths and how we sort
     — we may be returning every substring length as a co-equal entry. Align sort/group
     with Yomitan (longest / exact-match-count first; shorter prefixes demoted, not
     dropped).
   Output a short note: which of the two it is, the one-line vendored seam, and the fix.

**Build:**
1. **Apply the fix** from the investigation (most likely: wire the JA text
   preprocessors so emphatic collapsing happens; correct the cross-length
   merge/sort/group so short prefixes are demoted not headlined). Add a regression case
   to `lookup.test.ts` (あっさり ⇒ includes あさり/漁る, full あっさり first; 計画通り ⇒
   includes 計画通り, 計画, 計). Run `./scripts/yomifin-test.sh`.
2. **Pane model.** Reshape the popup around **panes**, where each pane = one resolved
   headword (≈ today's `LookupEntry`) carrying **all** its dictionary definitions.
   `LookupResult.entries` already maps 1:1 to headwords — group/order them into
   `panes[]` (e.g. 計画通り → [計画通り, 計画, 計〈けい〉, 計〈はか〉]). Keep all dict
   definitions for a headword *inside that pane*; do not flatten across panes.
3. **Cycler UI.** `DefinitionPopup` shows **one pane at a time** with **◀ / ▶** and an
   index ("2 / 4"). The main pane stays compact; cycling swaps the headword + its
   definitions. No giant scroll dump on the primary view.

**Exit criteria (on device):** tapping あっさり yields あっさり (first) plus
あさり / 漁る and does **not** headline bare あ / あっ; tapping 計画通り yields
cycleable panes 計画通り → 計画 → 計, each showing only its own dictionaries; the test
suite is green.

---

## Phase 7 — Multiple dictionaries + themed, bounded popup UI

> **Status: DONE ✅ (pending final on-device pass).** Implemented JS-only (Metro
> reload). Highlights + one engine change worth noting:
> - **Config:** `yomifinDictionaryConfig` settings atom (enable/disable + priority
>   order + per-dict tint), reconciled against the SQLite inventory by the pure
>   `utils/yomifin/dictionaryConfig.ts`. Dictionaries screen rebuilt on
>   `DraggableFlatList` (drag reorder, toggle, tap-swatch tint) with a **fixed** bottom
>   action bar; multi-select `.zip` import (keep-awake during import). Enabled titles
>   feed `YomifinDictionary` in priority order.
> - **Engine change (important):** `lookup.ts` switched `findTerms("simple")` →
>   **`"group"`** — Yomitan's own popup mode. `"simple"` never merges a headword's
>   dictionaries, so multi-dict fragmented into duplicate panes; `"group"` = one
>   headword pane with one definition block PER dictionary, sorted by priority. Phase 6
>   panes preserved. Still one indexed query for 5–10 dicts.
> - **Theming:** `components/yomifin/popupTheme.ts` + `yomifinPopupTheme`
>   (light/dark/**auto**=dark for now, app forces dark). All hardcoded colors removed
>   from `DefinitionPopup`/`StructuredContent`; per-dict tints derive from the theme.
> - **Selection scaffolding:** `utils/yomifin/selection.ts` (`PopupSelection`) — tap a
>   dictionary block or a glossary item to select it (visible state). **Fine-grained
>   sense-level** selection is deferred to Phase 8 (see the "Sense-level selection" note
>   under Phase 8) because many dicts pack all senses into one structured-content blob.
> - **Confirmed (not a gap):** reading match + kana normalization are already fully
>   vendored/wired — a katakana query resolves hiragana-stored readings and reading-only
>   matches (e.g. イケメン → イケ面). Locked in by new `lookup.test.ts` cases.
> - **Tests:** new `dictionaryConfig.test.ts` (config reconciler + selection) as suite
>   6/6; `lookup.test.ts` gained multi-dict priority/enable + reading/kana cases. All
>   green. Vendored `yomitan/` untouched.

**Goal:** real multi-dictionary support (5–10+) with clear per-dictionary visual
boundaries and a themeable popup.

Storage already supports many dictionaries in one indexed `.db` (Pivot A; the importer
is idempotent per dictionary). This phase is **management + presentation**.

**Build:**
1. **Dictionary management.** Extend the Dictionaries settings screen to list all
   installed dictionaries with: **enable/disable**, **priority order** (drag/reorder),
   and a **per-dictionary color/tint**. Persist as an ordered config (e.g.
   `dictionaryStore` + a settings atom). `buildEnabledDictionaryMap` in `lookup.ts`
   already takes names in priority order with an `index`/`priority` — feed it this
   config instead of a hardcoded single name. Confirm lookup across 5–10 dicts stays
   sub-ms (it's one indexed query; verify on device).
2. **Per-dictionary boundary UI.** In the pane, render each dictionary's definitions in
   a block with a **subtle background tint** (the per-dict color at low alpha) + the
   dictionary name as a quiet header, so boundaries are obvious. Keep it subtle
   (CONTEXT: clean/readable over flashy).
3. **Popup theming (light / dark / auto).** Add a `yomifinPopupTheme` setting
   (light/dark/**auto** = follow the app/system theme used elsewhere). Replace the
   hardcoded dark colors in `DefinitionPopup`/`StructuredContent` with a small theme
   object; per-dict tints derive from the active theme.
4. **Selection scaffolding (for Phase 8).** While theming the renderer, make each
   **dictionary block** and each **individual definition** a tappable selection target
   (visually indicate selected state). Selection state is consumed by Phase 8's
   `{popup-selection-text}` marker — design the data shape now, even if the Anki
   consumption lands next phase.

**Exit criteria (on device):** 5+ dictionaries enabled, reorderable, each visually
distinct in the pane; the popup honors light/dark/auto; lookups stay fast; tapping a
dictionary block or a single definition visibly selects it.

---

## Phase 8 — Runtime Anki field configuration + Yomitan-style field markers

**Goal:** kill the hardcoded field map. Fields are chosen **per note type at runtime**,
and each field's value is a **template string** of markers resolved against the current
pane + selection + media + sentence range. This is the most architectural phase —
design before building.

**Cue store + multi-cue selection substrate (built here, reused by Phase 10's sidebar).**
The multi-sentence markers below need the whole subtitle track, which mpv's live
`sub-text` does not hand us up front. So load + parse the full track once per item into
a `Cue[]` (`{index, start, end, text}`), exposed via a small context/atom. Reuse
`utils/yomifin/{srt,fetchSubtitleSrt}.ts` (in the tree since Phase 1); TEXT tracks only
(BITMAP/PGS degrade to single-cue = mpv's current `{start,end}`). Track a **selected
cue range** `[anchorIdx…extendIdx]` (default = the single tapped cue, span **1**) with
"extend to previous / next line" affordances in the popup. This is a *data* substrate —
no sidebar UI yet (that's Phase 10, which just renders this store).

**Runtime note-type config:**
- Replace `ankiConfig.ts`'s hardcoded `AnkiFieldMap` with a settings-stored, per-model
  mapping. Query AnkiConnect at config time: `modelNames`, then
  `modelFieldNames(modelName)` to enumerate the actual fields of the chosen note type.
  The Anki settings screen lets the user pick deck + model, then assign a **template
  string** to each discovered field.
- `buildFields` becomes: for each field, render its template through the marker engine.

**Marker engine (the core new abstraction).** A pure function
`renderTemplate(template: string, ctx: MarkerContext): string` that substitutes
Yomitan-style `{marker}` tokens. `MarkerContext` is assembled at card time from: the
active pane (headword/reading/word-classes/inflection), all that pane's dictionaries,
the current selection (Phase 7), the captured media (Phase 4), and the selected cue
range (built above). Initial marker set:
- `{expression}` / `{reading}` / `{word}` — headword + reading of the active pane.
- `{sentence}` — the selected cue range joined (default 1 cue; more if extended).
- `{audio}` — **word** audio. Open question / decision needed: we have no Forvo/jpod
  pipeline on device. Options: (a) ship a configurable audio-source URL like Yomitan;
  (b) on-device TTS; (c) reuse the **sentence** audio clip. Pick the smallest viable
  one and document; don't block the phase on perfect word audio.
- `{sentence-audio}` — the `[sound:…]` ref for the clip over the **selected cue range**
  (this is the multi-sentence audio requirement: range = min start … max end of the
  selected cues; default 1).
- `{picture}` — the captured frame `<img>` ref (Phase 4).
- `{glossary}` — the **full** flattened glossary of the active pane (all enabled dicts).
- `{single-glossary:DICT_NAME}` — only that dictionary's glossary for the active pane
  (mirrors Yomitan's `{single-glossary-…}`). Resolve `DICT_NAME` against installed
  dictionaries.
- `{popup-selection-text}` / `{selection}` — the text the user selected in the popup
  (Phase 7 selection model): a whole dictionary block, or one definition, flattened.
- `{clipboard}`-style extras are out of scope.

**Selection → marker wiring.** Phase 7 gives selectable dictionary blocks / definitions;
here we flatten the current selection to text (reuse `scToText` / `normalizeGlossary`
from `anki.ts`) and expose it as `{popup-selection-text}`. If nothing is selected, the
marker resolves to the active pane's full glossary (sensible default).

**Sense-level (fine-grained) selection — build here (deferred from Phase 7).** Phase 7
shipped block-level + coarse-item selection (`utils/yomifin/selection.ts`:
`PopupSelection = {kind:"dictionary"|"definition", …}`), which selects a whole dictionary
block or one *glossary item*. The gap: many dictionaries (e.g. JMdict for 読む) pack ALL
their senses into a SINGLE structured-content blob — one glossary item holding a nested
`<ol>`/`<ul>` of senses — so "one definition" today = the whole tree; you can't isolate
sense #3. To fix, descend into the structured-content tree and make individual sense
nodes tappable:
  - **Data shape:** extend `PopupSelection` with
    `{kind:"sense"; paneIndex; dictionary; glossIndex; path:number[]}` where `path` is the
    index chain locating a node inside that glossary item's SC tree (e.g. the Nth `<li>`
    of the senses list). `selectionGlossary()` gains a case that walks `path` to return
    just that subtree; `scToText` already flattens it.
  - **Renderer:** `components/yomifin/StructuredContent.tsx` needs an optional
    "selectable node" mode: identify sense boundaries (top-level list items are the
    pragmatic heuristic; fall back to top-level block children), render each as a
    tappable target that reports its `path`, and paint a selected state. Thread
    `selection` + `onSelect(path)` down through the recursive render (currently it only
    threads `color`/`linkColor`/`onLinkPress`).
  - **Scope note:** keep the Phase 7 block/item selection as the coarse default; sense
    selection is the refinement. Confirmed feasible; it's a renderer change, not an
    engine change (the lookup layer is untouched).

**Multi-sentence card.** The sentence field and the sentence-audio field both read the
**selected cue range** from the cue store above (default span 1). Audio: extend
`extractAudio(start,end,…)` to use `min(starts)…max(ends)` of the selected cues; sentence
text joins the cues' lines. Verify a 2-cue selection produces a card whose audio + text
span both lines.

**Migration:** keep `getAnkiConfig()` as the seam (STATUS already promised this). The
hardcoded map becomes the *default* the settings screen seeds; everything downstream
(`buildFields`) goes through `renderTemplate`.

**Exit criteria (on device):** pick a note type at runtime, see its real fields, assign
templates using markers; a card lands whose fields reflect the markers (e.g. a
`{single-glossary:…}` field has only that dict, a `{popup-selection-text}` field has
exactly the tapped definition, a 2-cue selection yields multi-line sentence + matching
audio). No field names are hardcoded in source.

---

## Phase 9 — Media dedup + batch mining (reach)

**Goal:** mining several words from the **same** sentence/frame must not produce
duplicate audio/images in the Anki collection, and must not re-run the capture pipeline
per word. End result: one shared `.m4a` + one shared `.jpg` referenced by every card
from that moment.

**Why this is mostly free.** Two seams already cooperate: AnkiConnect `storeMediaFile`
is **idempotent by filename** (re-storing the same name is a no-op), and the capture is
already deferred to the add-card press. The *only* reason we get duplicates today is the
filename: `baseName = card_${Date.now()}` is unique per card. Make the filename
**content-derived** and dedup falls out for free — across cards, across sessions, even
across a reinstall.

**Build:**
1. **Deterministic media keys (the core change).** Derive `baseName` from the *content
   identity* of the capture, not the clock: a stable hash of
   `{itemId, audioStart, audioEnd, framePosQuantized}` (quantize the frame position to
   e.g. the cue start, or to ~250ms, so taps a few ms apart collapse to one key).
   Filenames become `yomifin_<hash>.m4a` / `yomifin_<hash>.jpg`. Same sentence/frame →
   same filename → Anki stores it once; every card just references it. Note the audio
   key must use the **selected cue range** (Phase 8 cue store), so "1 word, 1 line" and
   "2 words, same 1 line" share a clip, while an extended 2-cue selection is its own key.
2. **In-session capture cache.** A small `Map<mediaKey, Promise<CapturedMedia>>` in the
   capture layer (`ankiMedia.ts` / `YomifinLookupLayer`) so that within one playback
   session the expensive seek/decode/encode runs **once per key**; later cards with the
   same key await the cached promise (and re-`storeMediaFile` is a cheap no-op, or skip
   it if we recorded that the key was already stored).
3. **`canAddNotes` / `storeMediaFile` thrift.** Before re-uploading, optionally skip the
   base64 round-trip if we've already stored that filename this session (track a
   `Set<storedFilename>`). Keeps the wire small when batching many words.
4. **Batch UX (pick the lighter option):**
   - **(a) Implicit batch (preferred, minimal UI):** because keys are content-derived,
     the user just adds each word normally; the *first* card pays the capture cost, the
     rest are instant and share the media. No new mode — dedup is automatic. Ship this
     first; it already satisfies the "don't run the pipeline twice / no dup files" goal.
   - **(b) Explicit batch (optional polish):** a "mine multiple from this line" affordance
     in the sidebar/popup that lets the user tap several words on the current cue, then
     commit all cards at once — still one capture, N notes. Only build if (a) isn't
     enough in practice.

**Open question (decide during build):** the hash should be stable but cheap on Hermes;
a short FNV/CRC over the key string is plenty (no crypto needed). Confirm two genuinely
different moments never collide within an item (include `itemId` + ms-resolution range).

**Exit criteria (on device):** mine two different words from the same subtitle line →
two Anki notes that reference the **same** audio + image filename (verify in Anki's
media folder: one file, not two); the capture pipeline logs (`[YOMIFIN MEDIA]`) fire
**once**, not twice; an extended multi-cue selection produces its own distinct shared
file.

---

## Phase 10 — Subtitle sidebar (transcript)  [de-prioritized — do last]

**Goal:** a tappable transcript of the whole subtitle track alongside the video. Nice
to have, not important — explicitly the **last** item.

**Cheap by now.** Phase 8 already built + exposed the **cue store** (`Cue[]` parsed from
the full track) and the active-cue mapping. This phase is essentially just the panel UI
over that store; no new data plumbing.

**Build:**
1. **Sidebar UI.** A collapsible panel (flex-row: video shrinks, sidebar takes a fixed
   width — exactly the Phase 0 "sidebar fallback" layout, now used by choice). Each row:
   timestamp + line text; the **active line is highlighted and auto-scrolls into view**.
   Tapping a row → `seek(cue.start * 1000)`. A toggle button shows/hides it. For
   BITMAP/PGS tracks (no text) the sidebar is simply unavailable — degrade gracefully.
2. **Reuse for navigation.** Wire any deferred Phase 5 prev/next-subtitle buttons to the
   same cue store (JS path), so they work without the native `sub-seek`.

**Exit criteria (on device):** the sidebar lists the whole track with timestamps;
tapping a line seeks there; the active line tracks playback and auto-scrolls into view.

---

## Phase 11 — Yomitan settings parity

**Goal:** stop hardcoding lookup behavior; surface the Yomitan-equivalent options as real
user settings so the engine can be tuned the way Yomitan users expect. This is a
**separate, incremental** item — it can be picked up piecemeal alongside/after the phases
above, wherever a hardcoded knob is annoying.

**Approach.** Audit the options the vendored Translator + `findTerms` already accept but
that we currently pass as constants, and lift each into the **Yomifin / Reader** settings
group with Yomitan's defaults. Mirror Yomitan's own settings names/semantics so behavior
is predictable. Candidate knobs (verify each against the vendored
`utils/yomifin/yomitan/` + our `lookup.ts` call site — only expose ones the engine truly
honors):
- **Max results** — cap on the number of returned entries/panes (`maxResults`-style).
- **Scan length** — max characters scanned from the tap point for the longest match
  (`scanLength`); today this is an implicit constant in the forward-greedy scan.
- **Deinflection / text-transform toggles** — the per-language `textPreprocessors`
  Yomitan exposes (e.g. collapse emphatic sequences, halfwidth/fullwidth, alphabetic
  case, hiragana↔katakana). Phase 6 wires these into the pipeline; here they become
  **user-toggleable** with Yomitan-matching defaults.
- **`removeNonJapaneseCharacters`** and other flags currently hardcoded in the
  `findTerms` call.
- **Sort / grouping mode** — result ranking (term/frequency), if the vendored code
  supports it, matching Yomitan's "sort frequency dictionary" idea.
- **Frequency dictionaries display** (only if a frequency dict is imported) — defer if
  no frequency data is present.

**Build:**
1. Enumerate the real, honored options at the `findTerms`/Translator seam (don't invent
   settings the engine ignores). One line per option: current hardcoded value → Yomitan
   default → settings key.
2. Add the keys to `utils/atoms/settings.ts` (interface + `defaultValues` = Yomitan
   defaults) and to the Reader settings screen.
3. Thread them from settings → the `findTerms` options object in `lookup.ts` (replace the
   constants). Keep the language layer pure — pass options in, don't read settings inside
   `utils/yomifin/`.
4. Add/extend `lookup.test.ts` cases that pin a couple of knobs (e.g. `maxResults=1`
   returns one pane; a longer `scanLength` still finds the same longest match). Run
   `./scripts/yomifin-test.sh`.

**Exit criteria (on device):** changing max results visibly caps the number of
cycleable panes; changing scan length changes how far a long compound is matched;
toggling a text-transform (e.g. emphatic collapse) changes the あっさり result; defaults
match Yomitan out of the box. No lookup knob remains a source-level constant.

---

## Later / parked (not next — pulled from the old Phases 5–8)

- **Profiles** — { language, deinflection settings, dictionary set, deck, note type,
  field templates } as a switchable bundle (JA vs ZH switches engine + destination).
  Natural follow-on once Phase 8's runtime config exists.
- **Chinese parity** — validate longest-match lookup against real ZH dictionaries
  (`language-descriptors.js` already includes ZH; expect verification, not new code).
- **ASS subtitles** — parse ASS, strip override tags, render dialogue as tappable plain
  text (accept loss of typesetting in the tappable layer).
- **Online subtitle sources** — pull subs from APIs (e.g. jimaku.cc) into an internal
  track.

---

## How to drive this with Claude Code

- **One phase at a time.** Do not let Claude Code skip ahead or write later phases as
  if earlier risks are resolved. **Phase 5 is MOSTLY DONE** (some items deferred — see
  the Phase 5 header). MVP + Phase 4 are DONE; **next up is Phase 6**
  (lookup-engine fidelity + cycleable panes).
- **Roadmap order (revised):** 6 lookup fidelity + panes → 7 dictionaries + theming →
  8 runtime Anki fields/markers (+ cue store) → 9 media dedup/batch → **10 sidebar
  (de-prioritized, last)**. **Phase 11 (Yomitan settings parity)** is a *separate,
  incremental* item — fold it in wherever a hardcoded lookup knob becomes annoying.
- **Investigations before builds** where a phase calls for it — notably **Phase 6**
  (lookup-engine fidelity) and **Phase 8** (marker engine / runtime fields): get the
  map before cutting.
- **Honor exit criteria** as literal gates. A phase isn't done until its criterion is
  demonstrably met on the physical iPad.
- **Keep the language layer isolated + guarded:** run `./scripts/yomifin-test.sh`
  after any change under `utils/yomifin/`; keep the lookup/popup inside
  `YomifinErrorBoundary`.
- **Two new architectural seams to respect:** (1) the **pane model** (Phase 6) — one
  headword per pane, its dicts inside it; (2) the **marker engine** (Phase 8) — all
  Anki field values flow through `renderTemplate`, nothing hardcoded. The **selection
  model** spans Phases 7–8; design its data shape in 7, consume it in 8.
- Pivots A/B/C (SQLite storage, mpv-driven subtitles, on-device media) are settled —
  don't reopen them. The full-track parse (Phase 8 cue store, rendered by Phase 10's
  sidebar) is a **data source only**, never the active-line overlay (that stays
  mpv-driven).

## Suggested next Claude Code prompt

> Read CONTEXT.md and IMPLEMENTATION_PLAN.md. Phase 5 is mostly done; we are starting
> **Phase 6 — Lookup-engine fidelity + multi-result cycleable panes**. Do the
> INVESTIGATION first: reproduce the あっさり case against the vendored Yomitan
> Translator and determine why the app surfaces bare あ / あっ and misses あさり / 漁る
> — check (1) whether the JA text preprocessors (`collapseEmphaticSequences` in
> `utils/yomifin/yomitan/language-descriptors.js`) are actually wired into the
> `findTerms` pipeline we lifted (our call passes `textReplacements: [null]`), and
> (2) how results are merged/sorted across scan lengths (are short prefixes headlined
> instead of demoted?). Report which it is, the one-line vendored seam, and the fix —
> do NOT change code yet. Then, after I confirm, implement the fix with a regression
> case in `utils/yomifin/lookup.test.ts` (あっさり ⇒ includes あさり/漁る with full
> あっさり first; 計画通り ⇒ 計画通り, 計画, 計) and run `./scripts/yomifin-test.sh`.
> Only after the engine fix is green, reshape `DefinitionPopup` around the **pane
> model**: one headword per pane (≈ today's `LookupEntry`, all its dictionaries kept
> inside the pane), shown one at a time with ◀ / ▶ and an index. Honor the Phase 6
> exit criteria on the physical iPad.
