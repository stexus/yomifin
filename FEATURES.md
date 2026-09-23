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

## Repository audit — 2026-09-23

The previously uncommitted Yozora migration and tap-time snapshot fix are now
accounted for here. The migration plan is archived at
`docs/yomifin/archive/YOZORA_MIGRATION_PLAN.md`; its intermediate phase notes are
historical. Device verification dates below preserve prior session reports;
this audit does not claim a new physical-iPad run. The quick wins, SUB-6 sync,
Anki sync/duplicate UI and tap-time fix retain explicit pending gates.

Local validation: all 19 regression stages pass (including 29 Yozora cases);
typecheck passes using the repo's existing Jellyseerr-submodule exclusion.
The optional alass cross-check skips because `alass-cli` is not installed.
Biome warnings found in the audit were unused parameters/suppressions and have
been removed. Cleanup committed as `a5349749` on `yomifin` before the separate
upstream synchronization below.

## Upstream sync — 2026-09-23

Branch: `sync/upstream-develop-2026-09-23`. Target: Streamyfin `develop`
`7fb905d1e887377ba80ca49b62582690729f77bf` (316 commits since the shared base;
23 conflicted paths). The original `yomifin` branch stays at the clean audit
checkpoint. This is an integration candidate; the Shipped rows below describe
pre-merge verification, not a new device run.

Resolved integration decisions:
- Adopt Expo SDK 57 / RN tvOS 0.86 / MPVKit 0.41 and upstream's player engine,
  subtitle identity matching, media-segment controls and TV/navigation changes.
- Keep the RN player UI on iPhone/iPad so lookup and Anki remain reachable.
  Forward decoded cues, subtitle visibility, cue seek and media capture through
  upstream's new native engine; retain personal signing/config plugins. Capture
  keeps a thread-safe URL/header snapshot after upstream removed its old fields.
- Keep native UIKit taps and worklet drag-seek; compose upstream hold-to-speed
  into that surface. Preserve Yozora, search scopes, overlay styles and settings.
- Set external-subtitle refs before native loading so track-ready callbacks do
  not select a Jellyfin track over a newly loaded online subtitle.
- Add a one-line, version-pinned ExpoModulesJSI Swift compiler patch (`Swift.abs`)
  for Xcode 26.3; retain upstream dependency versions otherwise.
- Scope Bun unit-test discovery to repository files and run the fork's standalone
  scripts separately, preventing ignored checkouts or early process exits from
  producing incomplete test runs.

Validation on this Mac:
- 376 unit tests across 44 files and all 19 Yomifin/Yozora regression stages pass.
- Typecheck (existing Jellyseerr exclusion), Biome and translation-key checks pass.
- Frozen Bun install, version-pinned dependency-patch guard and staged whitespace
  checks pass. Local Bun is 1.3.13; upstream CI pins 1.4.2.
- iOS Metro/Hermes production export succeeds. iOS prebuild and CocoaPods install
  succeed; use macOS `/usr/bin/tar` (the Nix shell supplies a shim), since GNU tar
  warnings contaminate Expo's extracted plist and disable precompiled modules.
- Full unsigned Debug build for generic iOS succeeds on Xcode 26.3 after the
  ExpoModulesJSI patch and capture-source fix. Signing/install and runtime behavior
  were not exercised. Android/TV native builds were not run.
- Expo Doctor: **19/20**, with the package-version check still failing for 34
  upstream-pinned dependencies (including Sentry 8.23 vs the SDK recommendation
  7.11, and newer recommended Expo patches). Dependency alignment remains a
  follow-up; `bun run test` is therefore not fully green. The ignored Android
  project also needs a fresh prebuild before Android work. Optional alass
  cross-check still skips because `alass-cli` is absent.

**Required before treating the sync as device-verified:** rebuild/install the
new binary and exercise Jellyfin + Yozora playback/resume; embedded text/bitmap
and online subtitles (selection, delay, server sync); lookup pause/resume and an
Anki card with image/audio; single/double/two-finger taps, drag-seek, hold-speed
release/cancel; episode navigation and reader/audio/subtitle menus. The existing
pending gates below remain pending. Android/TV runtime checks are also not part
of this local audit.

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
| HTML glossary markers | `structuredContent.ts` (`scToHtml`/`glossaryContentHtml`/`glossaryDefinitionsToHtml`), `selection.ts`, `anki.ts`, `ankiConfig.ts` `htmlGlossary`, Settings → Anki toggle | Yomitan default-template parity (device-verified): `{glossary}` = ONE numbered `<ol>` across definitions inside `<div class="yomitan-glossary">`, each `<li data-dictionary>` prefixed `<i>(tags, dict)</i>`; single definition = bare span, no ol; `{single-glossary:…}` = brief mode (no `<i>` prefix, defs from that dict aggregated — fixed an overwrite bug); SC data attrs emit Yomitan's `data-sc-*` prefix; extracted `<li>` selections get a `<ul>` context; global toggle, default off; gaiji images still skipped (see Small) |
| 🔊 word audio in popup | `DefinitionPopup.tsx`, `wordAudio.ts` (`fetchWordAudioCached`) | speaker button beside headword; expo-audio playback; fetch cached per term+reading so `{audio}` on card-add reuses the clip; filename content-derived `yomifin_word_<fnv>.<ext>`; 2026-07-02 fix: `Crypto.digest` needs a TypedArray (raw ArrayBuffer threw on-device and broke the jpod101 sentinel check) |
| AnkiConnect timeouts | `anki.ts` `ankiInvoke` | AbortController: 4s control actions, 15s media uploads — unreachable Anki used to hang ~60s ("frozen" settings pane / card add) |
| ZH word audio + Azure TTS fallback | `utils/yomifin/wordAudioSources.ts` (`wiktionary` + `azure-tts` source types, pinyin normalize/numbered helpers, Commons imageinfo API url+parse, `defaultWordAudioSources`/`mergeWordAudioSources`, SSML helpers; +tests), `wordAudio.ts` (API-first wiktionary branch, Azure POST branch, UA header), `ankiConfig.ts` (per-profile audio defaults + merge), Settings → Anki (toggles, Azure region/key/voice inputs) | DEVICE-VERIFIED 2026-07-03 (Commons recordings on-device; Azure TTS branch is code+tests+live-URL checked but not yet exercised with a real key — spot-check when one exists). ZH profile defaults to Wikimedia Commons recordings. NAMING (live-verified): zh files are PINYIN-named, NOT hanzi — `Zh-nǐ.ogg`/`Zh-māma.ogg` = the CC-CEDICT reading lowercased/concatenated, plus an old single-syllable numbered set (`Zh-hao3.ogg`); candidates = diacritic .ogg/.oga → numbered → hanzi last-resort, resolved via ONE `imageinfo` API query (blind Special:FilePath probing = a 404 per miss and Wikimedia 429s 404-storms — observed live; FilePath kept only as API-failure fallback; descriptive User-Agent sent). Azure Speech TTS (REST, SSML, mp3 out) sits LAST in the order BY DESIGN — synthesized only when every recorded source missed (real gaps: 妈 alone, 中国); stored source lists predating these types get new ones appended via merge (JA: disabled; ZH legacy: wiktionary enabled) — no migration; popup 🔊 and `{audio}` share the same cached fetch |
| Unified native gesture surface (seam v3) | `modules/gesture-surface/` (`YomifinGestureSurface`; sync `requireOptionalNativeModule` probe), `GestureOverlay.tsx`, `MpvPlayerView.swift` (window recognizer REMOVED; `twoFingerTapSeamVersion` → 3) | DEVICE-VERIFIED 2026-07-03. ONE UIKit tap tree (single/double/two-finger, `require(toFail:)` arbitration) on a native view where the dim layer sits — no grace delays/`tapSuppression`/`twoFingerNonce` on the live path. PAN deliberately stays an RNGH worklet (drag-seek needs UI-thread SharedValue writes; native pan events = per-frame bridge lag). Behavior delta vs the window recognizer (accepted): two-finger taps ON subtitle text/popup no longer toggle play. Legacy fallback (RNGH taps + window seam + suppression) still auto-selected on stale binaries/Android — deletion = backlog §2 |
| Drag-anywhere-to-seek (attempt 2) | `GestureOverlay.tsx` (worklet pan modes), `ScrubBubble.tsx`, `Controls.tsx` scrub lifecycle, `Settings.yomifinDragSeekEnabled` (default ON; Settings → Reader) | DEVICE-VERIFIED 2026-07-03. Worklet `onUpdate` → SharedValues (zero per-frame bridge); dedicated bubble: trickplay tile (~120ms JS prefetch) + ReText timestamps (`useAnimatedProps` on TextInput), independent of awesome-slider; commit exactly once on release/cancel, pause-during/seek+resume; full width = full duration; `progress.value` written live so the slider tracks. Off → legacy flick-to-skip; exclusion zones + volume/brightness verticals unchanged |
| Pane cycler polish (buttons-only, animated) | `DefinitionPopup.tsx` | DEVICE-VERIFIED 2026-07-03: prominent n/m index beside the headword; footer ◀ ▶ + edge-tap zones (34px strips + hitSlop, faint ‹ › chevrons) drive a keyed direction-aware `FadeInLeft/Right` (180ms) pane transition. SWIPE WAS REMOVED: two attempts (post-swipe commit, then fully interactive worklet drag with baselined offset + RNGH-aware scroll arbitration) both read as choppy/discontinuous on device over the popup's dense subtree — tombstone comment in the file warns not to re-add a pan without a two-pane tracking design (neighbor pane rendered live under the drag) |
| Player UI rework (senplayer-style) | `components/video-player/controls/{PlayerStatusBar,ControlsScrims,ScrubProgressBar,BottomControls,HeaderControls,Controls,ScrubBubble}.tsx`, `hooks/useSystemStatus.ts`, `dropdown/DropdownView.tsx` (`variant`), `components/settings/PlayerUISettings.tsx`, `direct-player.tsx` | DEVICE-VERIFIED 2026-07-04 (full, incl. `expo-battery` % after rebuild; battery hides gracefully on stale binaries). Custom OSD status bar (clock 12h + battery during playback, configurable `playerStatus*`; expands to date + wifi (netinfo) + stream throughput (mpv bitrate) + centered title `Series · S02E04 · Title` when controls up; mounted outside the fade). Trimmed top action row (`⋯` = quality/speed/tech-info only). `DropdownView` `variant`: `menu`/`subtitles`(track+scale+tappable-styling+online-subs)/`audio` — sub/audio pickers moved above the bar (LEFT), skip-intro/credits + next-ep countdown (RIGHT). Sleek 6px slider (chapter ticks kept) flanked by fixed-width time columns (current LEFT, tappable length RIGHT cycling length→−remaining→ends-at); transport cluster (prev-ep/skip-back/prev-sub/play-pause/next-sub/skip-forward/next-ep) BELOW the bar. `CenterControls` + on-screen volume/brightness sliders removed (gesture verticals stay; `CenterControls.tsx` orphaned). No dim on Jellyfin — `ControlsScrims` top/bottom gradients; `GestureOverlay` dim now opt-in (`dimWhenControlsShown` remains an opt-in; both players use scrims). Drag-seek pops ONLY the sleek bar when controls hidden (`ScrubProgressBar`) + `ScrubBubble` mini progress bar. Follow-up device tweaks: sub/audio picker icons 24→20 + chapter 22→19 (don't bleed into the video); current-chapter name floated ABSOLUTELY (top:100%) below the current-time label so it adds no row height to the bottom-anchored stack. TWO device-found bugs fixed: (1) skip-intro CRASH — the `@expo/ui` SwiftUI Menu pickers re-rendered every second inside the tick-driven `BottomControls`; fixed by `memo(DropdownView)` (restores the tick-free ~30s cadence the old top `⋯` had); (2) progress-bar JITTER while subtitle-seeking — flanking time labels changed width on digit rollover AND the play-icon↔`Loader` swap changed Row C height (bottom-anchored stack pushed the bar); fixed by fixed-width time columns + a fixed 46×46 play/pause box |
| Control pane auto-hide | `Controls.tsx`, `useControlsTimeout.ts` | DEVICE-VERIFIED 2026-07-04: the pane dismisses ~5s after it's shown / last interacted with (tapping a bottom control resets the timer via `handleControlsInteraction`); suppressed mid-scrub (slider/remote/drag-anywhere) and while the episode list is open. `useControlsTimeout` was previously hard-`disabled` |
| Jimaku search keyboard avoidance | `OnlineSubtitlesModal.tsx` | DEVICE-VERIFIED 2026-07-04: the online-subs card is vertically centered so the on-screen keyboard covered the search field — track keyboard height (`keyboardWillShow/Hide` on iOS) and pad the panel bottom by it so the card re-centers above the keyboard |
| Yozora discovery, playback and server progress | `utils/yozora/`, `components/yozora/`, `app/(auth)/(tabs)/(yozora)/`, `app/(auth)/player/yozora-player.tsx`, Settings → Yozora | Prior session records device verification on 2026-07-15 (migration summary). Home/Anime/Movies/Shows/Library, server-ranked sources, cross-device progress/resume, expiration re-resolve, shared player controls and full mining pipeline. Credentials use dedicated MMKV keys. Replaces the deleted client-side Anime/Stremio stacks and local watch state. |
| Unified search and Yozora subtitle loading | `utils/yozora/useYozoraSearch.ts`, `components/search/{SearchScopeSelector,YozoraSearchResults}.tsx`, `components/yomifin/OnlineSubtitlesModal.tsx` | DEVICE-VERIFIED 2026-07-15 per existing tracker: Jellyfin · Yozora · Both, legacy stored scope mapped on read, server subtitle → tappable overlay + lookup. Addon manifests are now managed on the server; hardcoded manifest defaults removed from the working tree (older commits still contain them). SUB-6 sync remains a separate pending gate below. |

## Implemented — pending device verification

**⚠️ Pending device verification:** the rows below are code+test complete but NOT
yet demonstrated on the iPad. The first three (maxResults, profiles, Chinese
parity) are JS-only → `just dev`. "Subtitle rendering QoL" and "Online
subtitles + sync" add NATIVE code (`modules/outlined-text`, `setSubtitleDelay`) →
need `just local` / `just remote` (on a stale binary the overlay falls back to the
JS stacked-copies outline — known-fuzzy — and sync nudge/auto-sync silently no-op).
"Snappier single tap" is NATIVE (gesture-surface apiVersion 2) → `just local`;
on a v1-surface binary the prop is ignored and the stock ~350ms window stays
(Metro logs the surface version). Its gate: with double-tap seek ON, single tap
toggles controls noticeably faster than before, and double-tap seek still lands
reliably at a normal tapping rhythm. Gates: zh auto-select + st/ts folding with the CC-CEDICT
TERM zip (`assets/dictionaries/CC-CEDICT.zip`; the `…Hanzi….zip` variant is
kanji-bank-only and imports 0 terms), JA path unregressed, zh card → zh profile's
Anki config; overlay styling knobs
visibly apply mid-playback; jimaku search→file→load with a real key, tappable
external ASS + a mined card with correct audio span after a nonzero delay, auto-sync
lands within a nudge on a known-offset sub, and switching back to a Jellyfin track
restores native/overlay rendering. The backup row (2026-07-03) is JS-only →
`just dev`; gates: "Export .db" shares a file that round-trips through "Import
.db"; Anki settings JSON round-trips (export → reset → import restores
deck/model/templates for BOTH profiles). Remove rows from this note as verified.

| Feature | Where | Notes |
| --- | --- | --- |
| Lookup knob: max results | `lookup.ts` `maxResults` (default 32 = Yomitan), Settings → Reader, threaded via `loadInstalledDictionary` opts | trims the entry TAIL after sorting (headline/order untouched); pinned in `lookup.test.ts`; remaining parity knobs (maxScanLength, preprocessor toggles) parked under Small |
| Profiles (JA/ZH bundles) | `utils/yomifin/profiles.ts` (+test), settings keys `yomifinActiveProfile`/`yomifinProfiles`, Settings → Dictionaries/Anki profile switcher, `direct-player.tsx` `yomifinLanguageHint` | { language, dictionary set, Anki config } per profile; NO-MIGRATION design: legacy `yomifinDictionaryConfig`/`yomifinAnkiConfig` keys ARE the JA profile's fallback storage until first profile-aware edit shadows them; player auto-selects profile from subtitle-track language (then audio), manual choice is the fallback; effective profile threads popup → `getAnkiConfig(profileId)` → `addAnkiCard`. Follow-ups (same pending batch): in-player profile PILL (`ProfilePill.tsx`, rendered IN the controls top bars — next to the ⋯ dropdown via `Controls`/`HeaderControls` `headerLeftSlot`/`leftSlot` in direct-player, beside the ✕ button in yozora-player — so it shows/fades exactly with the controls; shows `JA/ZH · auto`, tap = switch remembered per-title via `yomifinProfileOverrides` keyed SeriesId/ItemId or `yozora:<name>`, long-press = back to auto; precedence override > track hint > manual default, pinned in profiles.test.ts); per-profile DICTIONARY VISIBILITY (`yomifinDictionaryLanguages` title→profile map, unmapped = ja so zero migration; lookups and Settings → Dictionaries list only the active profile's dicts, `→ ZH`/`→ JA` chip moves a row across, imports auto-assign to the importing profile, `{single-glossary:…}` picker filtered too) |
| Chinese parity (st↔ts folding) | `yomitan/chinese-text-preprocessors.js` (OURS, `chinese-simple2traditional` dep — MIT, char-level, no `\p{}`), registered in `language-descriptors.js`; zh cases in `lookup.test.ts` | closes LOOKUP_FIDELITY §4 divergence: 汉语 finds 漢語-stored entries and vice versa; zh = exact + longest-match, no deinflection; `language` threads from the active profile. NOTE: `assets/dictionaries/CC-CEDICT.zip` is the TERM dictionary to import — the `…Hanzi….zip` variant is kanji-bank-only (importer reads `term_bank_*` → would import 0 terms) |
| Subtitle rendering QoL | `utils/yomifin/subtitleParse.ts` (+test), `srt.ts` (VTT cue-id tolerance), `TappableSubtitleOverlay.tsx`, `YomifinLookupLayer.tsx`, Settings → Reader | ASS/SSA parse for the CUE STORE (`parseAss`/`parseSubtitleText`: Format field order, override tags stripped, `\N`→newline, `{\p}` drawing cues dropped, layered dupes deduped) + VTT; the LIVE overlay stays mpv-driven — mpv's `sub-text` is already tag-stripped, `cleanSubtitleOverlayText` is defensive insurance in `onSubtitleText`; overlay style knobs (runtime settings, in Settings → Reader AND the in-player dropdown next to Subtitle Scale): font size, weight (400–700, default 500 — 600 + outline read thick), outline none/thin/normal/strong (FRACTIONAL widths, 2.5%/4%/7.5% of font size — a 2pt-outside stroke blobbed dense kanji counters shut, device-observed as "blocky"), bottom offset. Outline is NATIVE (`modules/outlined-text`, iOS, render v4): glyph VECTOR paths extracted from the TextKit layout (`CTFontCreatePathForGlyph` per laid-out glyph, effective post-substitution font), then stroke (ROUND joins) AND fill both rendered from that same path — libass-style single-geometry registration. Failed detours, all device-observed: `.strokeWidth` attribute miters corners (blocky); TextKit-drawn fill over the path stroke is subpixel-misregistered (uneven border); emoji/color glyphs (no vector outline) are TextKit-drawn individually, un-outlined — with per-character tap hit-testing from the SAME layout (`onCharacterTap` → char index → token mapping in JS) and off-glyph touch pass-through (`point(inside:)`); height reported via `onMeasured`. RN cannot draw a text stroke — textShadow is a blur, and the 8×-stacked-copies JS trick was DEVICE-REJECTED as fuzzy (kept only as the stale-binary/non-iOS fallback, de-blurred) |
| Export dictionary .db + Anki settings backup | `dictionaryStore.ts` `prepareDbForExport` (WAL checkpoint) + Settings → Dictionaries "Export .db" (expo-sharing); `utils/yomifin/ankiSettingsTransfer.ts` (+test, step 16 of yomifin-test.sh) + Settings → Anki "Backup" Export/Import | .db export runs `PRAGMA wal_checkpoint(TRUNCATE)` first (expo-sqlite is WAL — sharing the bare file would silently drop recent imports) then hands the combined file to the share sheet; Anki settings = versioned JSON (`yomifin-anki-settings` v1) holding BOTH profiles' RAW stored configs (JA legacy-key fallback included via resolveProfile; Azure key rides along on purpose — cloning a working setup is the point); import validates type/version/shape, merges per-profile via `withProfileData`, leaves dictionaryConfig untouched; getAnkiConfig's per-key defaulting makes partial imports safe |
| Online subtitles (jimaku.cc) + sync | `utils/yomifin/{jimaku,subSync,subtitleParse}.ts` (+tests), `components/yomifin/OnlineSubtitlesModal.tsx`, `utils/atoms/yomifinOnlineSubs.ts`, `DropdownView.tsx` (menu entry, gated on API key), `direct-player.tsx` wiring, native `setSubtitleDelay` seam (mpv `sub-delay`; iOS) | side panel: search by AniList id (item ProviderIds, any key casing) else title → entry → episode-filtered files → download to cache (`yomifin_sub_*`, sweeper-compatible) → mpv `sub-add` + hidden native rendering (tappable overlay takes over) + parsed cues into the cue store; SYNC: auto = pure offset correlation vs the item's own track (`estimateSubtitleOffset`, coarse→fine sweep, peak-sharpness confidence gate, null → manual) — this is alass's NO-SPLIT objective in TS (shipping the real tools is impossible: ffsubsync = Python+VAD, alass = Rust, Hermes has no wasm) and is CROSS-VALIDATED against real `alass-cli --no-split` by `scripts/yomifin-sync-crosscheck.ts` (brew install alass; runs in yomifin-test.sh, skips if absent; agreement ≤10ms on knowns; drop real pairs in `scripts/sync-fixtures/`, gitignored); manual ±0.1/±0.5s nudges; delay bookkeeping: store cues shifted into VIDEO timeline, live `sub-start/end` shifted by delay in JS (mpv reports FILE timeline — assumption to confirm on device: if audio clips land 2×delay off, drop the JS-side shift); picking a Jellyfin track dismisses the external sub + zeroes delay; API key in Settings → Reader |
| Snappier single tap (gesture-surface apiVersion 2) | `TimedDoubleTapRecognizer` in `GestureSurfaceView.swift`; `doubleTapMaxIntervalMs` prop (native default 220ms), passed as `DOUBLE_TAP_WINDOW_MS` from `GestureOverlay.tsx` | UIKit's stock double-tap window (~350ms, not exposed) IS the single-tap latency behind `require(toFail:)` — device-verified as sluggish on surface v1. The subclass force-fails itself (`state = .failed`, needs `UIGestureRecognizerSubclass`) 220ms after the first tap lifts unless a second touch has begun, releasing the failure chain early. Trade-off (same one RNGH's old maxDelay(280) made): a second tap slower than the window becomes a fresh single tap |
| Yozora UX quick wins (CW tap split + manual sources under auto-play) | `components/yozora/ContinueWatchingRail.tsx`, `components/yozora/SourceSheet.tsx` (`PlayTarget.forcePicker`), `(yozora)/detail.tsx` | CODE COMPLETE, PENDING DEVICE VERIFICATION (JS-only). User requests 2026-07-15: (a) CW card tap targets split — THUMBNAIL resumes playback, title/subtitle text opens the detail page (thumbnail long-press still opens detail); (b) with `yozoraAutoPlay` on you can still pick a source manually: episode rows grow a grey list icon (hidden when auto-play is off — row tap already opens the picker then) and movie heads a ghost “Sources” button, both set `forcePicker` which makes SourceSheet skip the bare-resolve branch. DEVICE GATES: tap CW title text → detail (no playback); tap thumbnail → resumes; with auto-play on, list icon on an episode row → full source list → pick a non-default source → plays |
| Anki collection sync + live duplicate check | `utils/yomifin/anki.ts`, Settings → Anki, `components/yomifin/DefinitionPopup.tsx` | Implemented in `472792cb`; previously missing from this tracker. Collection-wide Sync action; deck-scoped duplicate probe with an explicit add-anyway option. Device gate: sync succeeds and duplicate/unique/unreachable states behave correctly in the popup. |
| Tap-time card snapshot | `components/yomifin/YomifinLookupLayer.tsx` | Snapshot sentence, cue times and frame position before awaiting dictionary lookup; capture the successful popup's context so a later tap cannot change an in-flight card's media. Device gate: mine while subtitles advance and tap another word during card creation; sentence/audio/frame must stay matched. |
| Yozora server subtitle sync (SUB-6) | `OnlineSubtitlesModal.tsx`, `utils/yozora/api.ts`, `yozora-player.tsx` | Implemented; existing notes explicitly leave this device gate open. On a mistimed server subtitle, Sync on server must load the retimed copy and reset delay. Audit fixes also expose server subtitles without a direct jimaku key and preserve download/native-load failures instead of reporting success. |
| Yozora async cancellation fixes | `components/yozora/SourceSheet.tsx`, `utils/yozora/useYozoraSearch.ts` | Audit fixes invalidate pending completions on close, retarget, unmount, cleared search or scope/session change. Device gate: dismiss while resolving (auto and manual), and clear/change search while a request is in flight; no unexpected playback or stale results. |

## Backlog (roughly priority-ordered)

### 1. Player post-MVP (was “Stremio post-MVP”; catalog/subtitle-resource items died with the addon client in Yozora Phase 4)
In rough order of expected want:
- **Shared player-wiring extraction** — pull the yomifin glue (cue store, capture
  context, pause-on-lookup, popup mount, onSubtitleText/delay bookkeeping) out of
  `direct-player.tsx` into a hook/component both players use. Deliberately NOT
  done in the polish pass: it's the one risky step (touches the load-bearing
  file) and needs its own session + a full Jellyfin-side device regression pass.
  Trigger: actually missing a control during real use — keep a list. (Gestures,
  controls-dim, playback speed, and watch-state/resume shipped WITHOUT it — the
  shared `GestureOverlay` needed no extraction.)
- Embedded-sub gate never explicitly verified: tappable overlay on a stream's
  EMBEDDED text track (jimaku path is verified; embedded should be identical —
  confirm once).

### 2. Gesture-layer cleanup (unblocked — surface verified 2026-07-03)
The unified surface + drag-seek are device-verified; once the apiVersion-2
tap-window row clears too, in its own small pass: delete GestureOverlay's legacy branch (RNGH tap tree + `GRACE_MS` grace delays),
`tapSuppression.ts`, the `twoFingerNonce` plumbing (GestureOverlay prop + both
players' `onTwoFingerTap` MpvPlayerView handlers), and `MpvPlayerView.swift`'s
now-dead `onTwoFingerTap` EventDispatcher. Android note: the gesture-surface
module is iOS-only (`platforms: ["apple"]`); Android keeps the legacy RNGH
branch — if Android ever matters, port the surface view there BEFORE this
cleanup.

### 3. Subtitle sidebar (transcript) — do last
Collapsible flex-row panel over the existing cue store (`yomifinCuesAtom` already
holds the full parsed track): timestamp + line rows, active line highlighted +
auto-scrolled, tap row → `seek(cue.start*1000)`. Bitmap tracks: unavailable,
degrade gracefully.

### 4. AI assist ("Ask AI" beside lookup) — Claude/OpenAI via subscription OAuth
Goal: after a lookup, when the dictionaries aren't enough, ask an LLM to explain
the word IN THIS SENTENCE — with full context (surrounding dialogue, show/episode,
optionally the current frame) — streamed into a sheet next to the popup, with
follow-up turns. Personal account auth (OAuth), API keys only as fallback.

**Auth (decided posture):** no public consumer OAuth exists for third parties;
use the semi-official CLI PKCE flows.
- **Anthropic = P1.** Claude Code flow: PKCE → `claude.ai/oauth/authorize`
  (Claude Code client id), redirect to the `console.anthropic.com/oauth/code/callback`
  page which DISPLAYS a `code#state` for the user to copy-paste back into the app
  (no loopback server → iPad-friendly; `expo-web-browser` opens it). Exchange +
  refresh at `console.anthropic.com/v1/oauth/token`; call the normal
  `api.anthropic.com/v1/messages` with `Authorization: Bearer` +
  `anthropic-beta: oauth-2025-04-20`. CONSTRAINT: first system block must be the
  Claude Code identity line (server-enforced) — put real instructions in a second
  system block / user turn. Vision + SSE streaming both work on this path.
- **OpenAI = P2 (defer).** Codex CLI flow needs a `localhost:1455` redirect; iPad
  workaround = paste-the-failed-redirect-URL (the `?code=` survives in Safari's
  address bar), and the token talks to the ChatGPT Codex backend (Responses-ish
  API), not the plain API — messier, more break-prone. Don't block v1 on it.
- **Fallbacks:** API key for both + custom OpenAI-compatible base URL (covers
  OpenRouter/local for free).
- **ToS note (conscious risk):** these flows are technically restricted to the
  first-party CLIs; fine for a personal sideloaded single-user app, and the
  API-key path is the pressure valve if a flow gets locked down. Never log tokens
  (`[YOMIFIN AI]` prefix must redact).
- Tokens/keys live in **expo-secure-store** (already a dep), NOT settings/MMKV;
  single-flight refresh on expiry/401.

**Layering (per the settled purity rule):**
- `utils/yomifin/ai/` PURE + bun-tested: `prompt.ts` (context → provider-neutral
  messages), `oauth.ts` (PKCE verifier/challenge + token exchange/refresh request
  builders + expiry — crypto fns injected), `providers/{anthropic,openai}.ts`
  (request builders + SSE delta parsers, fixture-stream tests). Add a
  yomifin-test.sh step.
- Device-only: `aiAuth.ts` (SecureStore, web-browser login, refresh) and
  `aiClient.ts` (streaming via `expo/fetch`; verify ReadableStream response
  bodies on the current SDK 57 binary early, fallback = non-streaming single
  response).
- UI: `components/yomifin/AiAssistSheet.tsx`, mounted inside `YomifinErrorBoundary`,
  zIndex 100001 (above popup per the z-order contract).

**Context assembly (all already available):** tapped text + headword/reading/
deinflection chain + compact gloss text from the active pane (so the model builds
ON what the dictionaries said); sentence = the popup's SELECTED CUE RANGE
(`rangeText` — ‹＋ ＋› extend applies to AI context too); ±N surrounding cues from
`yomifinCuesAtom` (default ~5/side, chip-toggleable); `Series · S02E04 · Title`;
optional 📷 frame via the frozen `CaptureContext` + `captureMedia` image-only path
(deduped, ≤720px JPEG → base64 vision block; captured only on send, mirroring the
Anki best-effort rule — image failure never blocks the text request); answer
language from settings (default English), learner language from the active profile.

**UI:** ✦ button in the DefinitionPopup footer (shown only when a provider is
connected) → sheet with context chips (word · sentence · ±N lines · 📷), preset
questions (explain-in-sentence, grammar breakdown, nuance vs synonyms, why this
reading, translate the line), free-text input, streamed answer (plain Text v1),
session-scoped follow-up turns, stop button. Pause-on-open reuses the
pause-on-lookup machinery. Stretch (separate pass): `{ai-explanation}` marker so
the last answer can flow onto Anki cards via the marker engine.

**Settings → AI (new screen):** provider connect/disconnect (shows
connected-account state), model picker (default cheap+fast, e.g. Haiku-class),
explanation language, context defaults (±N cues, include-image), API-key fields,
custom base URL. New settings keys: `yomifinAiProvider`, `yomifinAiModel`,
`yomifinAiAnswerLanguage`, `yomifinAiContextCues`, `yomifinAiIncludeImage`
(secrets in SecureStore under `yomifin.ai.*`).

**Suggested build order:** (1) pure layer + tests (prompt/oauth/providers);
(2) Anthropic OAuth round-trip on device (login → paste code → token → refresh);
(3) `expo/fetch` streaming spike on device; (4) sheet UI + popup wiring, text-only;
(5) image context; (6) Settings screen polish + OpenAI/key fallbacks.
**Device gates:** OAuth connect + a streamed answer on the iPad; kill/reopen app →
refresh path works without re-login; 📷 request answers a "what's on screen"
question; a provider outage/expired token degrades to a readable error (never a
frozen popup — error boundary holds).
### 6. Fix UI sluggishness
The app-wide log polling and query stale-time fixes are already committed
(`9e9cd675`). Investigate a reproducible remaining slowdown before changing more.

### 8. AirPlay to TV
Not implemented in the fork; investigate the desired playback/mining behavior.

### 12.5 Yozora detail-page parity pass (user request 2026-07-15)
Make `(yozora)/detail.tsx` feel like the Yozora web Detail page
(`~/playground/yozora/apps/web/src/pages/Detail.tsx` + `components/EpisodePanel.tsx`
+ `lib/nextEpisode.ts` — read those first; keep semantics in lockstep). Checklist:
- [ ] **Play target (#5/#11 semantics)**: one prominent Play button whose label/target
  is computed from `GET /titles/{key}/progress` — resume in-progress episode, else
  first unwatched after the watched high-water mark, else E1 (`computePlayTarget`
  port; mirrors server PRG-4). Label like “Resume E5” / “Play S2 E1”; greyed with
  “E8 · airs in 2d” countdown when the target hasn’t aired.
- [ ] **Episode SELECTION**: tapping an episode row selects it (updates the Play
  button target + highlight) instead of immediately playing; explicit per-row
  play + sources buttons do the actions (web: `onSelect`/`onPlay`/`onSources`).
- [ ] **Sources button always visible** next to Play (not only under auto-play —
  supersedes the interim `forcePicker` quick-win affordances).
- [ ] **Per-row mark watched/unwatched button** (check icon toggling; today it’s a
  long-press → Alert, keep or replace).
- [ ] Watched rows dim + check; in-progress rows keep the resume bar; the row the
  Play button targets gets the strong highlight (not the latest-aired).
- [ ] Nice-to-haves from web if cheap: backdrop hero + accent from poster,
  tagline, cast/characters rail (already have relations/recs/next-airing pill).
- Manual selection resets on navigating to another title (web `selectedEp`).

### Small / opportunistic
- Yozora query cache is currently keyed by content, not session/server. Clear or
  scope cached results before supporting account/server switching; validate with
  two sessions. The current app targets one personal deployment.
- Yozora progress follow-up: pause-on-lookup/native pause and natural EOF need a
  dedicated event audit. Current terminal tick is sent on leaving the player;
  history invalidation and ordering of final-tick completion also need review.
- Yozora API types/constants are hand-maintained in `utils/yozora/types.ts`;
  OpenAPI generation/hash checking in the historical plan was never implemented.
- Remaining Yomitan lookup knobs (maxScanLength, JA preprocessor toggles,
  `removeNonJapaneseCharacters`) — maxResults shipped; expose the rest only if a
  real miss/annoyance shows up.
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
