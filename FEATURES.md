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
**⚠️ Pending device verification:** the rows below are code+test complete but NOT
yet demonstrated on the iPad. The first four (maxResults, profiles, Chinese parity,
pane cycler) and "Subtitle rendering QoL" are JS-only → `just dev`. "Online
subtitles + sync" adds a NATIVE seam (`setSubtitleDelay`) → needs `just local` /
`just remote` (nudge/auto-sync silently no-op on a stale binary; everything else in
the panel still works). Gates: zh auto-select + st/ts folding with the CC-CEDICT
TERM zip (`assets/dictionaries/CC-CEDICT.zip`; the `…Hanzi….zip` variant is
kanji-bank-only and imports 0 terms), JA path unregressed, popup swipe vs
ScrollView/selection taps, zh card → zh profile's Anki config; overlay styling knobs
visibly apply mid-playback; jimaku search→file→load with a real key, tappable
external ASS + a mined card with correct audio span after a nonzero delay, auto-sync
lands within a nudge on a known-offset sub, and switching back to a Jellyfin track
restores native/overlay rendering. Remove rows from this note as verified.

| Feature | Where | Notes |
| --- | --- | --- |
| Lookup knob: max results | `lookup.ts` `maxResults` (default 32 = Yomitan), Settings → Reader, threaded via `loadInstalledDictionary` opts | trims the entry TAIL after sorting (headline/order untouched); pinned in `lookup.test.ts`; remaining parity knobs (maxScanLength, preprocessor toggles) parked under Small |
| Profiles (JA/ZH bundles) | `utils/yomifin/profiles.ts` (+test), settings keys `yomifinActiveProfile`/`yomifinProfiles`, Settings → Dictionaries/Anki profile switcher, `direct-player.tsx` `yomifinLanguageHint` | { language, dictionary set, Anki config } per profile; NO-MIGRATION design: legacy `yomifinDictionaryConfig`/`yomifinAnkiConfig` keys ARE the JA profile's fallback storage until first profile-aware edit shadows them; player auto-selects profile from subtitle-track language (then audio), manual choice is the fallback; effective profile threads popup → `getAnkiConfig(profileId)` → `addAnkiCard` |
| Chinese parity (st↔ts folding) | `yomitan/chinese-text-preprocessors.js` (OURS, `chinese-simple2traditional` dep — MIT, char-level, no `\p{}`), registered in `language-descriptors.js`; zh cases in `lookup.test.ts` | closes LOOKUP_FIDELITY §4 divergence: 汉语 finds 漢語-stored entries and vice versa; zh = exact + longest-match, no deinflection; `language` threads from the active profile. NOTE: `assets/dictionaries/CC-CEDICT.zip` is the TERM dictionary to import — the `…Hanzi….zip` variant is kanji-bank-only (importer reads `term_bank_*` → would import 0 terms) |
| Pane cycler polish | `DefinitionPopup.tsx` | prominent n/m index beside the headword, horizontal swipe (RNGH pan, `.runOnJS(true)`, activeOffsetX ±32 / failOffsetY ±24 so scroll+taps unaffected), left/right edge-tap strips over the card gutters; footer ◀ ▶ kept |
| Subtitle rendering QoL | `utils/yomifin/subtitleParse.ts` (+test), `srt.ts` (VTT cue-id tolerance), `TappableSubtitleOverlay.tsx`, `YomifinLookupLayer.tsx`, Settings → Reader | ASS/SSA parse for the CUE STORE (`parseAss`/`parseSubtitleText`: Format field order, override tags stripped, `\N`→newline, `{\p}` drawing cues dropped, layered dupes deduped) + VTT; the LIVE overlay stays mpv-driven — mpv's `sub-text` is already tag-stripped, `cleanSubtitleOverlayText` is defensive insurance in `onSubtitleText`; overlay style knobs (runtime settings): font size, outline none/normal/strong (textShadow tiers), bottom offset |
| Online subtitles (jimaku.cc) + sync | `utils/yomifin/{jimaku,subSync,subtitleParse}.ts` (+tests), `components/yomifin/OnlineSubtitlesModal.tsx`, `utils/atoms/yomifinOnlineSubs.ts`, `DropdownView.tsx` (menu entry, gated on API key), `direct-player.tsx` wiring, native `setSubtitleDelay` seam (mpv `sub-delay`; iOS) | side panel: search by AniList id (item ProviderIds, any key casing) else title → entry → episode-filtered files → download to cache (`yomifin_sub_*`, sweeper-compatible) → mpv `sub-add` + hidden native rendering (tappable overlay takes over) + parsed cues into the cue store; SYNC: auto = pure offset correlation vs the item's own track (`estimateSubtitleOffset`, coarse→fine sweep, peak-sharpness confidence gate, null → manual) — this is alass's NO-SPLIT objective in TS (shipping the real tools is impossible: ffsubsync = Python+VAD, alass = Rust, Hermes has no wasm) and is CROSS-VALIDATED against real `alass-cli --no-split` by `scripts/yomifin-sync-crosscheck.ts` (brew install alass; runs in yomifin-test.sh, skips if absent; agreement ≤10ms on knowns; drop real pairs in `scripts/sync-fixtures/`, gitignored); manual ±0.1/±0.5s nudges; delay bookkeeping: store cues shifted into VIDEO timeline, live `sub-start/end` shifted by delay in JS (mpv reports FILE timeline — assumption to confirm on device: if audio clips land 2×delay off, drop the JS-side shift); picking a Jellyfin track dismisses the external sub + zeroes delay; API key in Settings → Reader |

| Stremio addon sources (separate tab + minimal player, mining-capable) | `utils/stremio/client.ts` (+`client.test.ts`, step 16 of yomifin-test.sh), `useStremioAddons.ts`, tab `app/(auth)/(tabs)/(stremio)/` + `components/stremio/CatalogShelf.tsx`, route `app/(auth)/player/stremio-player.tsx`, `Settings.stremioAddonUrls` | DEVICE-VERIFIED 2026-07-03: catalog → debrid stream → jimaku sub → mined card. Pure addon client (manifest/catalog/meta/stream, capability checks, `skip` paging, torrent/`infoHash` streams filtered — debrid/HTTP only); Discover-style shelves → grid → meta/episodes → aggregated stream picker; player is a self-contained minimal route (direct-player UNTOUCHED — deliberate, see pruned backlog design) reusing MpvPlayerView + the full yomifin pipeline (tappable overlay, popup, pause-on-lookup, capture w/ sourceUrl = playing debrid URL, cue store from `stream.subtitles[0]` else jimaku); CC menu hosts the jimaku panel (same `OnlineSubtitlesModal`; auto-sync reference = addon-provided sub's cues when present, else manual nudges); icons = direct-player's Ionicons shrunk. NB addon manifest URLs (contain tokens) are settings DEFAULTS — private fork only |

## Backlog (roughly priority-ordered)

### 1. Stremio post-MVP (deferred from the shipped MVP)
In rough order of expected want:
- **Shared player-wiring extraction** — pull the yomifin glue (cue store, capture
  context, pause-on-lookup, popup mount, onSubtitleText/delay bookkeeping) out of
  `direct-player.tsx` into a hook/component both players use, then grow the
  stremio player's controls toward parity (gestures, playback speed, controls-dim,
  trickplay n/a). This is the one risky step (touches the load-bearing file): one
  careful session + a full Jellyfin-side device regression pass. Trigger: actually
  missing a control during real use — keep a list.
- Watch-state / resume for stremio playback (nothing is persisted today; every
  play starts at 0).
- Catalog `search` / `genre` extras (client already builds the extra segment;
  UI only) + a Stremio search surface.
- `/subtitles/` resource resolution (both installed addons serve it) as another
  subtitle source next to jimaku + `stream.subtitles`.
- Embedded-sub gate never explicitly verified: tappable overlay on a stream's
  EMBEDDED text track (jimaku path is verified; embedded should be identical —
  confirm once).

### 2. Drag-anywhere-to-seek, done right (first attempt reverted 2026-07-02)
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
cancel-safe). Pairs naturally with item 3 (all-native gesture surface) if that
lands first.

### 3. All-native gesture surface (end-state refactor — trigger, don't schedule)
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

### 4. Subtitle sidebar (transcript) — do last
Collapsible flex-row panel over the existing cue store (`yomifinCuesAtom` already
holds the full parsed track): timestamp + line rows, active line highlighted +
auto-scrolled, tap row → `seek(cue.start*1000)`. Bitmap tracks: unavailable,
degrade gracefully.

### Small / opportunistic
- Remaining Yomitan lookup knobs (maxScanLength, JA preprocessor toggles,
  `removeNonJapaneseCharacters`) — maxResults shipped; expose the rest only if a
  real miss/annoyance shows up.
- ZH word-audio default sources: the JA defaults (jpod101/jisho) just miss for
  hanzi terms (best-effort, no crash); wire a real ZH source via the custom-URL
  slot in the ZH profile when one is chosen.
- `canAddNotes` pre-check for nicer duplicate UX (today: `allowDuplicate:false` +
  surfaced error toast).
- HTML glossary gap: dictionary-internal images (gaiji) are skipped by `scToHtml`
  (same as plain text) — needs importer media support + Anki media upload.
- Screenshot downscale is hardcoded (max width 720px, JPEG q0.8) at the native
  `captureScreenshot` seam; lift into a setting only if it ever matters.
- AAC bitrate tuning for the audio clip.
- Sync upgrade path — vendor REAL alass on-device: compile `alass-core` (Rust) as an
  iOS static lib + C FFI into the mpv module. What it buys over `subSync.ts`:
  SPLITS (TV↔BD cut differences — constant offset can't fix those) and fps-drift
  correction — note NEITHER is expressible via mpv `sub-delay`; the integration
  must rewrite the downloaded subtitle file (alass's native mode) and re-`sub-add`
  it. Cost: Rust cross-compilation toolchain in the Nix flake + Xcode build.
  Trigger: a real sub pair the constant-offset model can't sync (the cross-check
  harness flags exactly this: "NON-constant correction" on a fixtures pair).
- Zero-cost frame capture: tap the `vo=avfoundation` VO's enqueued `CVPixelBuffer`
  — needs a forked/patched MPVKit; current per-card cost (one range request + one
  GOP decode behind the spinner) is acceptable until then.
- Split `DefinitionPopup.tsx` (~900 lines) if it gets in the way: candidates are
  the selection-target rendering (dictionary block / gloss / sense / segment
  Pressable nesting) and the ✎ editor as separate components. Cosmetic — don't do
  it speculatively.
