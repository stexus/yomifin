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

## Phases –1 → 4 — DONE ✅ (detail archived)

Phases **–1 (environment), 0 (overlay spike), 1 (tappable subtitles), 2 (Yomitan
lookup), 3 (one Anki card), 4 (quality media cards)** are complete and on-device
validated. The authoritative summary — what shipped, the three architecture pivots
(A: SQLite storage, B: mpv-driven subtitles, C: on-device media), and the native seams
— is the **STATUS & HANDOFF** section above. Their original per-phase narrative (goals,
proves/exit-criteria, spike results, seam maps) was moved to
**`IMPLEMENTATION_PLAN_ARCHIVE.md`** to keep this file focused on the active roadmap.

---

## MVP COMPLETE (Phases 0–4). Everything below is the **v2 roadmap** (revised 2026-06-30).

> **This roadmap supersedes the old Phases 5–8** (profiles / ZH parity / ASS / online
> subs). Those were de-prioritized. The new priority is to make the *mining + reading*
> experience excellent: configurable runtime Anki fields with Yomitan-style field
> markers, multiple dictionaries with themed UI, lookup-engine fidelity, and
> player-interaction polish. Chinese parity, ASS, subtitle styling, profiles, online
> subtitle sources, and the **cycleable-panes popup UI** are collected in **Phase 11
> (Quality of Life)** — not dropped, just batched into one experience-cleanup pass. The
> subtitle sidebar is **Phase 12** (last).
>
> **Current position (2026-07-01):** Phases 5, 6, 7 are **done**; **Phase 8 (runtime
> Anki fields) is in progress / next**.

### Requirements → phase map (so nothing is lost)

| User request | Phase |
| --- | --- |
| Popup opens in a static location, fixed size, never hidden by UI | **5** |
| Lookup pauses video; closing resumes (configurable setting) | **5** |
| Reduce dim when playback menu is up | **5** |
| Two-finger tap = pause; double-tap left/right = seek ∓ | **5** |
| UI + gesture to go back/forward by **subtitle** (not time) | **5** (nav) / **8** (cue store) |
| Fix lookup logic to match Yomitan (あっさり → あさり / 漁る, no あ/あっ spam) | **6** |
| Multiple word readings / lookup results as **cycleable panes** (pane *model* done in 6; UI in 11) | **11** |
| Support 5–10+ **dictionaries** | **7** |
| Per-dictionary subtle UI boundary (e.g. background tint) | **7** |
| Popup light / dark / auto theme from settings | **7** |
| Anki fields **configurable per note type, at runtime** (not hardcoded) | **8** |
| Yomitan-style field markers ({audio} {glossary} {single-glossary:DICT} {popup-selection-text}) | **8** |
| Tap a dictionary section (selects all its text) or a single definition within it | **8** (block/item selection shipped in 7; sense-level in 8) |
| Anki card can use **multiple sentences** for sentence/audio (default 1) | **8** (cue store + assembly) |
| **Batch / dedup media** — multiple words from one sentence share one audio+image (no dup files in Anki) | **9** |
| **Downscale the card picture** (configurable resolution/quality) to save space | **9** |
| Prominent **top** current-entry indicator ("3 / 15") + swipe / edge-tap to change entry | **11** |
| Subtitle **sidebar** with timestamps; tap a line → seek there (de-prioritized) | **12** |
| **Yomitan settings parity** — expose Yomitan's lookup/scan options (max results, scan length, …) | **10** |

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

## Phase 6 — Lookup-engine fidelity + pane model — DONE ✅

> **Status: DONE ✅.** Lookup matching now behaves like Yomitan and results are grouped
> into one pane per headword (each pane carries all that headword's dictionaries). The
> fidelity audit (`utils/yomifin/LOOKUP_FIDELITY.md`) proves exactly one seam
> (`findTermsBulk`) decides term existence and it's fully implemented; Phase 7 later
> switched `findTerms("simple")` → `"group"` (Yomitan's popup mode) so a headword's
> dictionaries merge into one pane. Regression cases are in `lookup.test.ts`.
> **The *cycler UI* (one pane at a time, top index, swipe / edge-tap navigation) is
> NOT part of this phase — it moved to Phase 11 (Quality of Life).**

**Goal:** (a) make matching behave like Yomitan; (b) group results into **one headword
per pane** (data model), each carrying all its dictionary definitions.

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

(The *cycler UI* that presents these panes one-at-a-time is Phase 11.)

**Exit criteria (met):** tapping あっさり yields あっさり (first) plus
あさり / 漁る and does **not** headline bare あ / あっ; tapping 計画通り yields panes
計画通り → 計画 → 計, each showing only its own dictionaries; the test suite is green.

---

## Phase 7 — Multiple dictionaries + themed, bounded popup UI — DONE ✅

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

**Cue store + multi-cue selection substrate (built here, reused by Phase 12's sidebar).**
The multi-sentence markers below need the whole subtitle track, which mpv's live
`sub-text` does not hand us up front. So load + parse the full track once per item into
a `Cue[]` (`{index, start, end, text}`), exposed via a small context/atom. Reuse
`utils/yomifin/{srt,fetchSubtitleSrt}.ts` (in the tree since Phase 1); TEXT tracks only
(BITMAP/PGS degrade to single-cue = mpv's current `{start,end}`). Track a **selected
cue range** `[anchorIdx…extendIdx]` (default = the single tapped cue, span **1**) with
"extend to previous / next line" affordances in the popup. This is a *data* substrate —
no sidebar UI yet (that's Phase 12, which just renders this store).

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
  pipeline on device. Options: (a) ship a configurable audio-source URL like Yomitan.
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
5. **Downscale the picture (space saving).** Add a setting for capture image resolution
   / quality (e.g. max width or a JPEG quality factor) and downscale before base64 +
   `storeMediaFile`, so cards don't carry full-frame stills. Cheapest path: pass a size
   cap to the native `captureScreenshot` seam (or downscale in `ankiMedia.ts` after
   capture). Default to a sensible cap (e.g. ~720px wide). Combined with dedup, this
   keeps the media footprint small.

**Open question (decide during build):** the hash should be stable but cheap on Hermes;
a short FNV/CRC over the key string is plenty (no crypto needed). Confirm two genuinely
different moments never collide within an item (include `itemId` + ms-resolution range).

**Exit criteria (on device):** mine two different words from the same subtitle line →
two Anki notes that reference the **same** audio + image filename (verify in Anki's
media folder: one file, not two); the capture pipeline logs (`[YOMIFIN MEDIA]`) fire
**once**, not twice; an extended multi-cue selection produces its own distinct shared
file.

---

## Phase 10 — Yomitan settings parity

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
  case, hiragana↔katakana). Phase 6 already wired these into the pipeline; here they
  become **user-toggleable** with Yomitan-matching defaults.
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

## Phase 11 — Quality of Life (batched experience cleanup)

A grab-bag of polish done in one pass. Independent items; no strict internal order.

**Cycleable-panes popup UI (moved here from Phase 6).** The pane *model* already exists
(Phase 6: one headword per pane, all its dictionaries inside). This is the *presentation*:
- `DefinitionPopup` shows **one pane at a time** instead of a long scroll dump.
- The current-entry indicator must be **prominent and at the TOP** (e.g. "3 / 15" beside
  the headword), not buried at the bottom where the eye never goes.
- Navigation between panes: **horizontal swipe** across the popup, **and** taps on the
  **left / right edges** of the box (◀ / ▶ hit zones), so both work.
- *Exit check:* tapping 計画通り shows cycleable panes 計画通り → 計画 → 計; the
  "N / M" index is clearly visible at the top; swipe and edge-tap both change panes.

**Profiles** — { language, deinflection settings, dictionary set, deck, note type, field
templates } as a switchable bundle (JA vs ZH switches engine + destination). Should
switch **automatically** based on audio or subtitle language, defaulting to the JA
profile. Natural follow-on once Phase 8's runtime config exists.

**Chinese parity** — validate longest-match lookup against real ZH dictionaries
(`language-descriptors.js` already includes ZH; expect verification, not new code).

**ASS subtitles** — parse ASS, strip override tags, render dialogue as tappable plain
text (accept loss of typesetting in the tappable layer).

**Better subtitle formatting** — black outline for readability; runtime style changes;
movable vertical offset, font size, etc.

**Online subtitle sources** — pull subs from APIs (e.g. jimaku.cc) into an internal
track. On-device syncing of downloaded subs to an internal track via a backend like
alass/ffsubsync (feasibility TBD).

---
## Phase 12 — Subtitle sidebar (transcript)  [de-prioritized — do last]

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

## How to drive this with Claude Code

- **One phase at a time.** Do not let Claude Code skip ahead or write later phases as
  if earlier risks are resolved. **MVP + Phases 5, 6, 7 are DONE**; **next up is
  Phase 8** (runtime Anki fields + Yomitan-style markers).
- **Roadmap order (current):** ~~5 player polish~~ → ~~6 lookup fidelity + pane model~~
  → ~~7 dictionaries + theming~~ → **8 runtime Anki fields/markers (+ cue store) ← NEXT**
  → 9 media dedup/batch → 10 Yomitan settings parity → 11 Quality of Life (cycler UI +
  profiles + ZH + ASS + subtitle styling + online subs) → **12 sidebar (last)**.
- **Investigations before builds** where a phase calls for it — notably **Phase 8**
  (marker engine / runtime fields): get the map before cutting.
- **Honor exit criteria** as literal gates. A phase isn't done until its criterion is
  demonstrably met on the physical iPad.
- **Keep the language layer isolated + guarded:** run `./scripts/yomifin-test.sh`
  after any change under `utils/yomifin/`; keep the lookup/popup inside
  `YomifinErrorBoundary`.
- **Two architectural seams to respect:** (1) the **pane model** (Phase 6, done) — one
  headword per pane, its dicts inside it; (2) the **marker engine** (Phase 8) — all
  Anki field values flow through `renderTemplate`, nothing hardcoded. The **selection
  model** spans Phases 7–8: Phase 7 shipped block/item selection; Phase 8 adds
  sense-level selection + consumes it via `{popup-selection-text}`.
- Pivots A/B/C (SQLite storage, mpv-driven subtitles, on-device media) are settled —
  don't reopen them. The full-track parse (Phase 8 cue store, rendered by Phase 12's
  sidebar) is a **data source only**, never the active-line overlay (that stays
  mpv-driven).

## Suggested next Claude Code prompt

> Read CONTEXT.md and IMPLEMENTATION_PLAN.md. Phases 5–7 are done; we are starting
> **Phase 8 — Runtime Anki field configuration + Yomitan-style field markers**. This is
> the most architectural phase, so DESIGN before building: write a short plan for (a)
> the **cue store + multi-cue selection substrate** (full-track parse via
> `utils/yomifin/{srt,fetchSubtitleSrt}.ts`, a `Cue[]` context, a selected cue range
> defaulting to 1), (b) the **marker engine** `renderTemplate(template, ctx)` and its
> `MarkerContext`, and (c) how `ankiConfig.ts`'s hardcoded field map is replaced by a
> per-model, settings-stored mapping fed from AnkiConnect `modelFieldNames`. Confirm the
> marker set with me ({expression} {reading} {sentence} {sentence-audio} {picture}
> {glossary} {single-glossary:DICT} {popup-selection-text}) and the open question on
> {audio} (word audio source) before writing code. Then implement incrementally, keep
> the language layer pure (settings passed in, not read inside `utils/yomifin/`), add
> tests, run `./scripts/yomifin-test.sh`, and honor the Phase 8 exit criteria on the
> physical iPad.
