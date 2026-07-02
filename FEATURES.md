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

## Backlog (roughly priority-ordered)

### 1. Media dedup + batch mining
Mining several words from one sentence must share one `.m4a` + one `.jpg` (no dup
files, no repeated capture). Mostly free because `storeMediaFile` is idempotent by
filename and capture is already deferred: the only reason for duplicates today is
`baseName = card_${Date.now()}`. Build: (a) content-derived media key — cheap hash
(FNV over `itemId + audioStart/End + framePos` quantized to ~250ms/cue start) →
`yomifin_<hash>.{m4a,jpg}`; the audio key must use the **selected cue range** so
1-line and 2-line selections differ; (b) in-session `Map<key, Promise<CapturedMedia>>`
cache in the capture layer + a `Set<storedFilename>` to skip re-upload; (c) image
downscale setting (max width ~720px / JPEG quality) applied at the native
`captureScreenshot` seam or in `ankiMedia.ts`. Exit: two words from the same line →
two notes referencing the SAME files, `[YOMIFIN MEDIA]` fires once; extended
multi-cue selection gets its own key.

### 2. HTML-formatted glossary markers (Yomitan-parity output)
`{glossary}` / `{single-glossary:…}` / `{popup-selection-text}` currently ship
plain text (`scToText`). Yomitan ships rendered HTML
(`<div class="yomitan-glossary"><ol><li data-dictionary=…>…`, inline styles, ruby).
Build a pure `scToHtml` serializer (structured-content JSON ≈ mini-HTML; same
recursion as `scToText`/`StructuredContent`, no DOM needed) + Yomitan's wrapper
markup, behind a per-field or global toggle. Known gap to phase separately:
dictionary-internal images (gaiji) need importer media support + Anki upload.

### 3. Word-audio playback in the popup
🔊 button next to the headword that plays the word audio (reuse
`fetchWordAudio`); cache the clip so `{audio}` on card-add reuses the fetched file.

### 4. Yomitan settings parity (lookup knobs)
Lift hardcoded lookup constants into the Reader settings group with Yomitan
defaults. Audit the honored options at the `findTerms` call site in `lookup.ts`
first — only expose what the vendored engine actually uses: `maxScanLength`
(currently 16 — the one real match-length cap, see LOOKUP_FIDELITY §4), max
results/pane cap, text-preprocessor toggles, `removeNonJapaneseCharacters`.
Thread settings → options object (keep `utils/yomifin/` pure). Pin a couple of
knobs in `lookup.test.ts`.

### 5. Video gestures rebuild (deferred; two failed attempts — read this first)
Two-finger-tap pause + double-tap L/R seek never worked on device. Attempt 1
(extending `useGestureDetection`/`onTouch*` with multi-touch counting) →
`trackedTouchCount` warnings, laggy taps. Attempt 2 (RNGH `GestureDetector`
wrapping the overlay) → recognizer fought the dim `Pressable`'s `onPress`. Both
fully reverted. Correct path: rebuild the WHOLE video gesture layer (single tap,
double-tap seek, two-finger tap, drags) as ONE RNGH `Gesture.Race`/`Exclusive`
composition — never mix RN responders with RNGH. Validate two-finger + double-tap
on the iPad before building the rest. Add settings keys
(`yomifinDoubleTapSeconds`, etc.) only with this rebuild.

### 6. Stremio addon sources (separate tab, mining-capable)
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

### 7. Pane cycler polish
Cycler exists (footer ◀ n/m ▶). Wanted: prominent index at the TOP beside the
headword, horizontal swipe across the popup, and left/right edge-tap zones.
Pure popup UI change.

### 8. Profiles (JA/ZH bundles)
{ language, dictionary set, deck, model, field templates, word-audio sources } as
a switchable bundle; auto-select by audio/subtitle track language, default JA.
Natural composition of existing runtime configs — design the settings shape so
current single-profile config becomes "the JA profile" without migration pain.

### 9. Chinese parity
`language-descriptors.js` already registers ZH (longest-match, no deinflection).
Expect verification, not new code — plus: ZH has **no text preprocessors**, so no
simplified↔traditional folding (documented divergence, LOOKUP_FIDELITY §4). Adding
an st/ts folding preprocessor is the real work. Needs a real ZH dictionary import
to validate.

### 10. Subtitle rendering QoL
ASS support (parse, strip override tags, render dialogue as tappable plain text);
overlay styling (outline, font size, vertical offset — runtime settings).

### 11. Online subtitle sources
Pull subs from APIs (e.g. jimaku.cc) into an internal track; feasibility of
on-device sync (alass/ffsubsync-style) TBD.

### 12. Subtitle sidebar (transcript) — do last
Collapsible flex-row panel over the existing cue store (`yomifinCuesAtom` already
holds the full parsed track): timestamp + line rows, active line highlighted +
auto-scrolled, tap row → `seek(cue.start*1000)`. Bitmap tracks: unavailable,
degrade gracefully.

### Small / opportunistic
- `canAddNotes` pre-check for nicer duplicate UX (today: `allowDuplicate:false` +
  surfaced error toast).
- AAC bitrate tuning for the audio clip.
- Zero-cost frame capture: tap the `vo=avfoundation` VO's enqueued `CVPixelBuffer`
  — needs a forked/patched MPVKit; current per-card cost (one range request + one
  GOP decode behind the spinner) is acceptable until then.
- Split `DefinitionPopup.tsx` (~900 lines) if it gets in the way: candidates are
  the selection-target rendering (dictionary block / gloss / sense / segment
  Pressable nesting) and the ✎ editor as separate components. Cosmetic — don't do
  it speculatively.
