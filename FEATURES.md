# FEATURES.md — yomifin feature tracker

Read `YOMIFIN_CONTEXT.md` first (architecture, settled decisions, gotchas, build).
This file is the single tracker: what's shipped, what's next, and enough context
per backlog item to start work without re-exploration.

**Working agreement for a feature session:**
1. Pick ONE item below. Investigate before building if the item says so.
2. Keep `utils/yomifin/` pure (options passed in, no settings reads inside); add a
   bun test case for new engine/marker behavior.
3. `./scripts/yomifin-test.sh` + `bun run typecheck` + `bun run lint` green before
   calling anything done.
4. The exit criterion is **demonstrated on the physical iPad** (JS-only changes via
   Metro `just dev`; native changes need `just local`/`just remote`).
5. When an item ships, move it to Shipped (one line + pointers) and prune its
   backlog entry. Don't create new markdown files; extend this one or
   YOMIFIN_CONTEXT.md.

---

## Shipped

| Feature | Where | Notes |
| --- | --- | --- |
| Tappable subtitle overlay, mpv-synced | `components/yomifin/TappableSubtitleOverlay.tsx`, `direct-player.tsx` | mpv `onSubtitleText`; text tracks hidden natively, PGS renders natively (overlay empty) |
| Yomitan lookup engine (deinflection, preprocessors, forward-greedy, panes) | `utils/yomifin/lookup.ts` + vendored `utils/yomifin/yomitan/` | `"group"` mode = one pane per headword; fidelity audit in `utils/yomifin/LOOKUP_FIDELITY.md` |
| SQLite dictionary storage + import | `utils/yomifin/{dictionaryStore,importDictionary,expoSqlite,loadInstalledDictionary}.ts`, `scripts/build-dictionary-db.ts` | one combined `.db`; on-device `.zip` import (chunked) or prebuilt `.db` copy; idempotent per title |
| Dictionary management UI (enable/reorder/tint) | Settings → Dictionaries; `utils/yomifin/dictionaryConfig.ts` | priority order feeds lookup; per-dict tint feeds popup |
| Definition popup: panes, theming, per-dict blocks | `components/yomifin/DefinitionPopup.tsx`, `popupTheme.ts` | fixed-position/size, ◀ n/m ▶ cycler, light/dark/auto theme |
| Selection: dictionary block / definition / sense / segment + ✎ manual trim | `utils/yomifin/{selection,senses}.ts`, popup | structural (`<li>` paths) + textual (㊀①-blob split) tiers; long-press → ✎ editor; feeds `{popup-selection-text}` |
| Anki cards: runtime fields + marker templates | `utils/yomifin/{anki,ankiConfig,ankiFieldSeeds,markers,furigana}.ts`, Settings → Anki | deck/model/field discovery via AnkiConnect; `{…}` marker picker; deck-scoped dedupe |
| On-device card media (frame JPEG + AAC clip) | `utils/yomifin/ankiMedia.ts`, `modules/mpv-player` (`captureScreenshot`/`extractAudio`) | capture only on add-press, background queue, static-stream seek; best-effort (text card always lands) |
| Word audio `{audio}` (jpod101 / jisho / custom URL) | `utils/yomifin/{wordAudio,wordAudioSources}.ts` | ordered fallthrough, invalid-clip sentinel, configurable in Settings → Anki |
| Multi-sentence cards (cue store + range extend) | `utils/yomifin/cues.ts`, `utils/atoms/yomifinCueStore.ts`, popup sentence strip | ‹＋ ＋› extend, ↺ reset; `{sentence}` + audio clip span the range; `{cloze-*}` extend too |
| Player polish | `direct-player.tsx`, Settings → Reader | pause-on-lookup/resume, popup side anchor, controls-dim setting, native `subSeek(±1)` prev/next-cue buttons |
| Media dedup + batch mining | `utils/yomifin/{mediaKey,ankiMedia}.ts`, `anki.ts` (upload skip), `direct-player.tsx` | content-derived filenames `yomifin_<fnv>.{jpg,m4a}` keyed on itemId + quantized times (audio key = SELECTED cue range); in-session capture cache collapses repeat captures (RAM, bounded: 12 media / 32 word clips, FIFO); disk hygiene: capture temps deleted in `finally`, plus a 24h `yomifin_*` sweep (`cacheSweep.ts`) on player mount; native `captureScreenshot` downscales to ≤720px |
| Video gestures (taps) | `GestureOverlay.tsx` (RNGH, 1-finger only), `MpvPlayerView.swift` `onTwoFingerTap` seam v2 + `tapSuppression.ts` (80ms grace), `Controls.tsx`, Settings → Reader | two-finger tap = play/pause (NATIVE UIKit window recognizer — RNGH can't do multi-touch taps, see gotcha; feedback bubble via `twoFingerNonce`, hidden while controls up), double-tap L/R seek, single tap = controls; seam-version probe logs stale binaries |
| HTML glossary markers | `structuredContent.ts` (`scToHtml`/`glossaryContentHtml`/`glossaryDefinitionsToHtml`), `selection.ts`, `anki.ts`, `ankiConfig.ts` `htmlGlossary`, Settings → Anki toggle | Yomitan default-template parity (device-verified): `{glossary}` = ONE numbered `<ol>` across definitions inside `<div class="yomitan-glossary">`, each `<li data-dictionary>` prefixed `<i>(tags, dict)</i>`; single definition = bare span, no ol; `{single-glossary:…}` = brief mode (no `<i>` prefix, defs from that dict aggregated — fixed an overwrite bug); SC data attrs emit Yomitan's `data-sc-*` prefix; extracted `<li>` selections get a `<ul>` context; global toggle, default off; gaiji images still skipped (see Small) |
| 🔊 word audio in popup | `DefinitionPopup.tsx`, `wordAudio.ts` (`fetchWordAudioCached`) | speaker button beside headword; expo-audio playback; fetch cached per term+reading so `{audio}` on card-add reuses the clip; filename content-derived `yomifin_word_<fnv>.<ext>`; 2026-07-02 fix: `Crypto.digest` needs a TypedArray (raw ArrayBuffer threw on-device and broke the jpod101 sentinel check) |
| AnkiConnect timeouts | `anki.ts` `ankiInvoke` | AbortController: 4s control actions, 15s media uploads — unreachable Anki used to hang ~60s ("frozen" settings pane / card add) |

## Backlog (roughly priority-ordered)

### 1. Yomitan settings parity (lookup knobs)
Lift hardcoded lookup constants into the Reader settings group with Yomitan
defaults. Audit the honored options at the `findTerms` call site in `lookup.ts`
first — only expose what the vendored engine actually uses: `maxScanLength`
(currently 16 — the one real match-length cap, see LOOKUP_FIDELITY §4), max
results/pane cap, text-preprocessor toggles, `removeNonJapaneseCharacters`.
Thread settings → options object (keep `utils/yomifin/` pure). Pin a couple of
knobs in `lookup.test.ts`.

### 2. Stremio addon sources (separate tab, mining-capable)
Play content resolved via Stremio addons alongside Jellyfin, with the full mining
pipeline (tappable subs → lookup → Anki card with audio+image). **Prerequisites
are already met:** the user has debrid services (Real-Debrid-style) set up and
Stremio addons configured — so `/stream/` resolution returns range-seekable HTTPS
direct links, which is exactly what mpv playback AND the capture seams need. Do
NOT build on-device torrent playback; debrid-resolved (or plain HTTP) streams only.

Why mining mostly survives the source swap (verified against the code):
- Tappable subs are mpv-driven (Pivot B) — embedded subs work for any source; the
  mpv module already supports external subtitle URLs (`externalSubtitles` load
  option + `addSubtitleFile(url)` → `sub-add`).
- `captureScreenshot`/`extractAudio` take a `sourceUrl` — any range-seekable HTTPS
  URL works (that's what the debrid links are); `""` falls back to the playing URL.
- Lookup/popup/Anki are source-agnostic. `{document-title}` comes from addon meta.
- Cue store: the only Jellyfin-specific seam (`Stream.srt` fetch). External SRT
  URLs feed `parseSrt` directly; embedded-only subs degrade to single-cue (already
  handled). Build alongside "Online subtitle sources" (below) — same external-SRT
  → cue-store path.

Architecture boundary (design before building):
1. `utils/stremio/` — pure, bun-testable addon client mirroring the yomifin
   pattern: manifest fetch/validation, catalog/meta/stream resolution, addon list
   + debrid config in settings. Stremio addons are plain HTTP JSON APIs
   (`manifest.json`, `/catalog/{type}/{id}.json`, `/meta/`, `/stream/`,
   `/subtitles/`). Tests against recorded fixtures.
2. Separate tab: catalogs → meta → stream picker, shell UI over (1).
3. A second, MINIMAL player route taking `{url, title, subtitleUrls}` — do NOT
   thread Stremio through `direct-player.tsx` with conditionals. First extract the
   yomifin wiring (cue store, capture context, pause-on-lookup, popup mount) from
   `direct-player.tsx` into a shared hook/component both players use — this is the
   one risky step (touches the load-bearing file): one careful session + a full
   Jellyfin-side device regression pass before building the new route on top.

Exit criteria (on device): browse an addon catalog, play a debrid-resolved stream,
subtitles tappable (embedded AND an external SRT), mine a card whose audio+image
capture from the stream URL; the Jellyfin player path is demonstrably unregressed.

### 3. Pane cycler polish
Cycler exists (footer ◀ n/m ▶). Wanted: prominent index at the TOP beside the
headword, horizontal swipe across the popup, and left/right edge-tap zones.
Pure popup UI change.

### 4. Profiles (JA/ZH bundles)
{ language, dictionary set, deck, model, field templates, word-audio sources } as
a switchable bundle; auto-select by audio/subtitle track language, default JA.
Natural composition of existing runtime configs — design the settings shape so
current single-profile config becomes "the JA profile" without migration pain.

### 5. Chinese parity
`language-descriptors.js` already registers ZH (longest-match, no deinflection).
Expect verification, not new code — plus: ZH has **no text preprocessors**, so no
simplified↔traditional folding (documented divergence, LOOKUP_FIDELITY §4). Adding
an st/ts folding preprocessor is the real work. Needs a real ZH dictionary import
to validate.

### 6. Subtitle rendering QoL
ASS support (parse, strip override tags, render dialogue as tappable plain text);
overlay styling (outline, font size, vertical offset — runtime settings).

### 7. Online subtitle sources
Pull subs from APIs (e.g. jimaku.cc) into an internal track; feasibility of
on-device sync (alass/ffsubsync-style) TBD.

### 8. Drag-anywhere-to-seek, done right (first attempt reverted 2026-07-02)
Infuse-style: horizontal drag anywhere on the video acts like a seek-bar drag.
Attempt 1 (reverted; flick-to-skip ±s restored on `enableHorizontalSwipeSkip`)
drove the vestigial remote-scrub shared values from the RNGH pan via
`runOnJS(true)` per-frame callbacks + a debounced `handleSliderChange` — device
verdict: **very laggy, and no trickplay thumbnails** (react-native-awesome-slider
only renders its bubble during ITS OWN internal gesture; an external scrub can't
summon it). Requirements for attempt 2: (a) pan `onUpdate` as a WORKLET writing a
SharedValue directly (UI thread, zero bridge traffic per frame); (b) a dedicated
scrub-bubble component (thumbnail + timestamp) positioned via reanimated from
that SharedValue, independent of awesome-slider; (c) commit seek only on release
(+ throttled trickplay-tile prefetch on the JS side); (d) same lifecycle contract
as attempt 1 (pause during, seek + resume on release, exactly-once end,
cancel-safe). Pairs naturally with item 9 (all-native gesture surface) if that
lands first.

### 9. All-native gesture surface (end-state refactor — trigger, don't schedule)
Today's player gestures are TWO recognizer trees deduplicated through
`tapSuppression.ts` + 80ms grace delays: RNGH (single/double tap, pan) and the
native window two-finger tap (seam v2). It works and the coupling is ~30 lines,
but the correct end state is ONE UIKit tree: a native "gesture surface" expo view
sitting exactly where `GestureOverlay`'s View sits (below buttons, above video)
owning UITapGestureRecognizers (single/double/two-finger, arbitrated via
`require(toFail:)`) + UIPanGestureRecognizer, emitting semantic events
(`onSingleTap`, `onDoubleTap(x)`, `onTwoFingerTap`, pan stream). Deletes
tapSuppression, grace delays, and the `twoFingerNonce` plumbing. Do it WHEN a
trigger arrives — a new gesture (pinch-to-zoom), another arbitration bug, or
spare native-iteration budget — not before: it re-pays every hit-testing subtlety
(button pass-through, dim layer, exclusion zones, window-wide two-finger) in
Swift, and gesture tuning needs many on-device rebuild loops.

### 10. Subtitle sidebar (transcript) — do last
Collapsible flex-row panel over the existing cue store (`yomifinCuesAtom` already
holds the full parsed track): timestamp + line rows, active line highlighted +
auto-scrolled, tap row → `seek(cue.start*1000)`. Bitmap tracks: unavailable,
degrade gracefully.

### Small / opportunistic
- `canAddNotes` pre-check for nicer duplicate UX (today: `allowDuplicate:false` +
  surfaced error toast).
- HTML glossary gap: dictionary-internal images (gaiji) are skipped by `scToHtml`
  (same as plain text) — needs importer media support + Anki media upload.
- Screenshot downscale is hardcoded (max width 720px, JPEG q0.8) at the native
  `captureScreenshot` seam; lift into a setting only if it ever matters.
- AAC bitrate tuning for the audio clip.
- Zero-cost frame capture: tap the `vo=avfoundation` VO's enqueued `CVPixelBuffer`
  — needs a forked/patched MPVKit; current per-card cost (one range request + one
  GOP decode behind the spinner) is acceptable until then.
- Split `DefinitionPopup.tsx` (~900 lines) if it gets in the way: candidates are
  the selection-target rendering (dictionary block / gloss / sense / segment
  Pressable nesting) and the ✎ editor as separate components. Cosmetic — don't do
  it speculatively.
