# IMPLEMENTATION_PLAN — ARCHIVE: Phases –1 through 3 (DONE)

> Historical detail moved out of `IMPLEMENTATION_PLAN.md` to save context. These
> phases are **complete**; the authoritative "where we are" summary (Pivots A/B/C,
> Phase 3 & 4 done) lives in the **STATUS & HANDOFF** section of the main plan.
> Kept here only for history / spelunking. Phase 4's detail already lives in the main
> plan's STATUS section, not here.

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

## Phase 3 — One Anki card (sentence only) — DONE ✅ (see STATUS)

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

