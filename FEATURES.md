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
| ZH word audio + Azure TTS fallback | `utils/yomifin/wordAudioSources.ts` (`wiktionary` + `azure-tts` source types, pinyin normalize/numbered helpers, Commons imageinfo API url+parse, `defaultWordAudioSources`/`mergeWordAudioSources`, SSML helpers; +tests), `wordAudio.ts` (API-first wiktionary branch, Azure POST branch, UA header), `ankiConfig.ts` (per-profile audio defaults + merge), Settings → Anki (toggles, Azure region/key/voice inputs) | DEVICE-VERIFIED 2026-07-03 (Commons recordings on-device; Azure TTS branch is code+tests+live-URL checked but not yet exercised with a real key — spot-check when one exists). ZH profile defaults to Wikimedia Commons recordings. NAMING (live-verified): zh files are PINYIN-named, NOT hanzi — `Zh-nǐ.ogg`/`Zh-māma.ogg` = the CC-CEDICT reading lowercased/concatenated, plus an old single-syllable numbered set (`Zh-hao3.ogg`); candidates = diacritic .ogg/.oga → numbered → hanzi last-resort, resolved via ONE `imageinfo` API query (blind Special:FilePath probing = a 404 per miss and Wikimedia 429s 404-storms — observed live; FilePath kept only as API-failure fallback; descriptive User-Agent sent). Azure Speech TTS (REST, SSML, mp3 out) sits LAST in the order BY DESIGN — synthesized only when every recorded source missed (real gaps: 妈 alone, 中国); stored source lists predating these types get new ones appended via merge (JA: disabled; ZH legacy: wiktionary enabled) — no migration; popup 🔊 and `{audio}` share the same cached fetch |
| Unified native gesture surface (seam v3) | `modules/gesture-surface/` (`YomifinGestureSurface`; sync `requireOptionalNativeModule` probe), `GestureOverlay.tsx`, `MpvPlayerView.swift` (window recognizer REMOVED; `twoFingerTapSeamVersion` → 3) | DEVICE-VERIFIED 2026-07-03. ONE UIKit tap tree (single/double/two-finger, `require(toFail:)` arbitration) on a native view where the dim layer sits — no grace delays/`tapSuppression`/`twoFingerNonce` on the live path. PAN deliberately stays an RNGH worklet (drag-seek needs UI-thread SharedValue writes; native pan events = per-frame bridge lag). Behavior delta vs the window recognizer (accepted): two-finger taps ON subtitle text/popup no longer toggle play. Legacy fallback (RNGH taps + window seam + suppression) still auto-selected on stale binaries/Android — deletion = backlog §2 |
| Drag-anywhere-to-seek (attempt 2) | `GestureOverlay.tsx` (worklet pan modes), `ScrubBubble.tsx`, `Controls.tsx` scrub lifecycle, `Settings.yomifinDragSeekEnabled` (default ON; Settings → Reader) | DEVICE-VERIFIED 2026-07-03. Worklet `onUpdate` → SharedValues (zero per-frame bridge); dedicated bubble: trickplay tile (~120ms JS prefetch) + ReText timestamps (`useAnimatedProps` on TextInput), independent of awesome-slider; commit exactly once on release/cancel, pause-during/seek+resume; full width = full duration; `progress.value` written live so the slider tracks. Off → legacy flick-to-skip; exclusion zones + volume/brightness verticals unchanged |
| Stremio player polish (gestures + dim + speed + resume) | `stremio-player.tsx` (shared GestureOverlay replaces the bare Pressable), `utils/stremio/watchState.ts` (MMKV, keyed title+episode via fnv1a — NOT the per-resolve debrid URL; >96% watched clears; ~10s cadence + save on leave) | DEVICE-VERIFIED 2026-07-03. Full gesture parity incl. drag-seek (timestamp-only bubble), controls-dim, top-bar speed cycler (1→1.25→1.5→2→0.75), resume via `startPosition` |
| Pane cycler polish (buttons-only, animated) | `DefinitionPopup.tsx` | DEVICE-VERIFIED 2026-07-03: prominent n/m index beside the headword; footer ◀ ▶ + edge-tap zones (34px strips + hitSlop, faint ‹ › chevrons) drive a keyed direction-aware `FadeInLeft/Right` (180ms) pane transition. SWIPE WAS REMOVED: two attempts (post-swipe commit, then fully interactive worklet drag with baselined offset + RNGH-aware scroll arbitration) both read as choppy/discontinuous on device over the popup's dense subtree — tombstone comment in the file warns not to re-add a pan without a two-pane tracking design (neighbor pane rendered live under the drag) |
| Player UI rework (senplayer-style) | `components/video-player/controls/{PlayerStatusBar,ControlsScrims,ScrubProgressBar,BottomControls,HeaderControls,Controls,ScrubBubble}.tsx`, `hooks/useSystemStatus.ts`, `dropdown/DropdownView.tsx` (`variant`), `components/settings/PlayerUISettings.tsx`, `direct-player.tsx` | DEVICE-VERIFIED 2026-07-04 (full, incl. `expo-battery` % after rebuild; battery hides gracefully on stale binaries). Custom OSD status bar (clock 12h + battery during playback, configurable `playerStatus*`; expands to date + wifi (netinfo) + stream throughput (mpv bitrate) + centered title `Series · S02E04 · Title` when controls up; mounted outside the fade). Trimmed top action row (`⋯` = quality/speed/tech-info only). `DropdownView` `variant`: `menu`/`subtitles`(track+scale+tappable-styling+online-subs)/`audio` — sub/audio pickers moved above the bar (LEFT), skip-intro/credits + next-ep countdown (RIGHT). Sleek 6px slider (chapter ticks kept) flanked by fixed-width time columns (current LEFT, tappable length RIGHT cycling length→−remaining→ends-at); transport cluster (prev-ep/skip-back/prev-sub/play-pause/next-sub/skip-forward/next-ep) BELOW the bar. `CenterControls` + on-screen volume/brightness sliders removed (gesture verticals stay; `CenterControls.tsx` orphaned). No dim on Jellyfin — `ControlsScrims` top/bottom gradients; `GestureOverlay` dim now opt-in (`dimWhenControlsShown`, stremio keeps it). Drag-seek pops ONLY the sleek bar when controls hidden (`ScrubProgressBar`) + `ScrubBubble` mini progress bar. TWO device-found bugs fixed: (1) skip-intro CRASH — the `@expo/ui` SwiftUI Menu pickers re-rendered every second inside the tick-driven `BottomControls`; fixed by `memo(DropdownView)` (restores the tick-free ~30s cadence the old top `⋯` had); (2) progress-bar JITTER while subtitle-seeking — flanking time labels changed width on digit rollover AND the play-icon↔`Loader` swap changed Row C height (bottom-anchored stack pushed the bar); fixed by fixed-width time columns + a fixed 46×46 play/pause box |
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
| Profiles (JA/ZH bundles) | `utils/yomifin/profiles.ts` (+test), settings keys `yomifinActiveProfile`/`yomifinProfiles`, Settings → Dictionaries/Anki profile switcher, `direct-player.tsx` `yomifinLanguageHint` | { language, dictionary set, Anki config } per profile; NO-MIGRATION design: legacy `yomifinDictionaryConfig`/`yomifinAnkiConfig` keys ARE the JA profile's fallback storage until first profile-aware edit shadows them; player auto-selects profile from subtitle-track language (then audio), manual choice is the fallback; effective profile threads popup → `getAnkiConfig(profileId)` → `addAnkiCard`. Follow-ups (same pending batch): in-player profile PILL (`ProfilePill.tsx`, rendered IN the controls top bars — next to the ⋯ dropdown via `Controls`/`HeaderControls` `headerLeftSlot`/`leftSlot` in direct-player, beside the ✕ button in stremio-player — so it shows/fades exactly with the controls; shows `JA/ZH · auto`, tap = switch remembered per-title via `yomifinProfileOverrides` keyed SeriesId/ItemId or `stremio:<name>`, long-press = back to auto; precedence override > track hint > manual default, pinned in profiles.test.ts); per-profile DICTIONARY VISIBILITY (`yomifinDictionaryLanguages` title→profile map, unmapped = ja so zero migration; lookups and Settings → Dictionaries list only the active profile's dicts, `→ ZH`/`→ JA` chip moves a row across, imports auto-assign to the importing profile, `{single-glossary:…}` picker filtered too) |
| Chinese parity (st↔ts folding) | `yomitan/chinese-text-preprocessors.js` (OURS, `chinese-simple2traditional` dep — MIT, char-level, no `\p{}`), registered in `language-descriptors.js`; zh cases in `lookup.test.ts` | closes LOOKUP_FIDELITY §4 divergence: 汉语 finds 漢語-stored entries and vice versa; zh = exact + longest-match, no deinflection; `language` threads from the active profile. NOTE: `assets/dictionaries/CC-CEDICT.zip` is the TERM dictionary to import — the `…Hanzi….zip` variant is kanji-bank-only (importer reads `term_bank_*` → would import 0 terms) |
| Subtitle rendering QoL | `utils/yomifin/subtitleParse.ts` (+test), `srt.ts` (VTT cue-id tolerance), `TappableSubtitleOverlay.tsx`, `YomifinLookupLayer.tsx`, Settings → Reader | ASS/SSA parse for the CUE STORE (`parseAss`/`parseSubtitleText`: Format field order, override tags stripped, `\N`→newline, `{\p}` drawing cues dropped, layered dupes deduped) + VTT; the LIVE overlay stays mpv-driven — mpv's `sub-text` is already tag-stripped, `cleanSubtitleOverlayText` is defensive insurance in `onSubtitleText`; overlay style knobs (runtime settings, in Settings → Reader AND the in-player dropdown next to Subtitle Scale): font size, weight (400–700, default 500 — 600 + outline read thick), outline none/thin/normal/strong (FRACTIONAL widths, 2.5%/4%/7.5% of font size — a 2pt-outside stroke blobbed dense kanji counters shut, device-observed as "blocky"), bottom offset. Outline is NATIVE (`modules/outlined-text`, iOS, render v4): glyph VECTOR paths extracted from the TextKit layout (`CTFontCreatePathForGlyph` per laid-out glyph, effective post-substitution font), then stroke (ROUND joins) AND fill both rendered from that same path — libass-style single-geometry registration. Failed detours, all device-observed: `.strokeWidth` attribute miters corners (blocky); TextKit-drawn fill over the path stroke is subpixel-misregistered (uneven border); emoji/color glyphs (no vector outline) are TextKit-drawn individually, un-outlined — with per-character tap hit-testing from the SAME layout (`onCharacterTap` → char index → token mapping in JS) and off-glyph touch pass-through (`point(inside:)`); height reported via `onMeasured`. RN cannot draw a text stroke — textShadow is a blur, and the 8×-stacked-copies JS trick was DEVICE-REJECTED as fuzzy (kept only as the stale-binary/non-iOS fallback, de-blurred) |
| Export dictionary .db + Anki settings backup | `dictionaryStore.ts` `prepareDbForExport` (WAL checkpoint) + Settings → Dictionaries "Export .db" (expo-sharing); `utils/yomifin/ankiSettingsTransfer.ts` (+test, step 17 of yomifin-test.sh) + Settings → Anki "Backup" Export/Import | .db export runs `PRAGMA wal_checkpoint(TRUNCATE)` first (expo-sqlite is WAL — sharing the bare file would silently drop recent imports) then hands the combined file to the share sheet; Anki settings = versioned JSON (`yomifin-anki-settings` v1) holding BOTH profiles' RAW stored configs (JA legacy-key fallback included via resolveProfile; Azure key rides along on purpose — cloning a working setup is the point); import validates type/version/shape, merges per-profile via `withProfileData`, leaves dictionaryConfig untouched; getAnkiConfig's per-key defaulting makes partial imports safe |
| Online subtitles (jimaku.cc) + sync | `utils/yomifin/{jimaku,subSync,subtitleParse}.ts` (+tests), `components/yomifin/OnlineSubtitlesModal.tsx`, `utils/atoms/yomifinOnlineSubs.ts`, `DropdownView.tsx` (menu entry, gated on API key), `direct-player.tsx` wiring, native `setSubtitleDelay` seam (mpv `sub-delay`; iOS) | side panel: search by AniList id (item ProviderIds, any key casing) else title → entry → episode-filtered files → download to cache (`yomifin_sub_*`, sweeper-compatible) → mpv `sub-add` + hidden native rendering (tappable overlay takes over) + parsed cues into the cue store; SYNC: auto = pure offset correlation vs the item's own track (`estimateSubtitleOffset`, coarse→fine sweep, peak-sharpness confidence gate, null → manual) — this is alass's NO-SPLIT objective in TS (shipping the real tools is impossible: ffsubsync = Python+VAD, alass = Rust, Hermes has no wasm) and is CROSS-VALIDATED against real `alass-cli --no-split` by `scripts/yomifin-sync-crosscheck.ts` (brew install alass; runs in yomifin-test.sh, skips if absent; agreement ≤10ms on knowns; drop real pairs in `scripts/sync-fixtures/`, gitignored); manual ±0.1/±0.5s nudges; delay bookkeeping: store cues shifted into VIDEO timeline, live `sub-start/end` shifted by delay in JS (mpv reports FILE timeline — assumption to confirm on device: if audio clips land 2×delay off, drop the JS-side shift); picking a Jellyfin track dismisses the external sub + zeroes delay; API key in Settings → Reader |

| Snappier single tap (gesture-surface apiVersion 2) | `TimedDoubleTapRecognizer` in `GestureSurfaceView.swift`; `doubleTapMaxIntervalMs` prop (native default 220ms), passed as `DOUBLE_TAP_WINDOW_MS` from `GestureOverlay.tsx` | UIKit's stock double-tap window (~350ms, not exposed) IS the single-tap latency behind `require(toFail:)` — device-verified as sluggish on surface v1. The subclass force-fails itself (`state = .failed`, needs `UIGestureRecognizerSubclass`) 220ms after the first tap lifts unless a second touch has begun, releasing the failure chain early. Trade-off (same one RNGH's old maxDelay(280) made): a second tap slower than the window becomes a fresh single tap |
| Stremio player UI unification + audio track selection | `components/stremio/StremioPlayerControls.tsx` (NEW, self-contained), `stremio-player.tsx` (rewired) | DEVICE-VERIFIED 2026-07-04. Rebuilds the Stremio control pane to match the reworked Jellyfin player: senplayer-style OSD status bar (clock/battery via shared `useSystemStatus`, expands to date/wifi/throughput + centered title when controls up), `ControlsScrims` (no dim — dropped `dimWhenControlsShown`), animated header (⋯ menu = speed + profile pill · ✕ close), sleek awesome-slider flanked by fixed-width time columns (right label cycles length→−remaining→ends-at), transport cluster below (skip-back/prev-cue/play/next-cue/skip-fwd), `ScrubProgressBar` on drag-seek while hidden. Sub/audio/menu pickers use the shared `PlatformDropdown` (native SwiftUI Menu / Android bottom sheet — dismisses on outside tap, fixing the old "menu doesn't go away" bug). AUDIO TRACK SELECTION: `getAudioTracks`/`setAudioTrack` (already on the MpvPlayerViewRef) surfaced via the 🔊 Audio dropdown; `refreshTracks` now fetches both track lists on `onTracksReady`; yomifin `extractAudio` uses current track so mined clips follow the selection. `PickerDropdown` is `memo`'d with parent-memoized `groups` (the per-second position tick would otherwise re-render the SwiftUI Menu host → the crash the Jellyfin side fixed with `memo(DropdownView)`). Interactive slider pauses-during/seek+resume like the Jellyfin bottom slider. Deliberately did NOT do the shared-wiring extraction (backlog §1) — this is presentational parity via context-free reuse (`ControlsScrims`/`ScrubProgressBar`/`PlatformDropdown`/`useSystemStatus`); `direct-player.tsx` and the Jellyfin control files are UNTOUCHED |
| Stremio addon sources (separate tab + minimal player, mining-capable) | `utils/stremio/client.ts` (+`client.test.ts`, step 16 of yomifin-test.sh), `useStremioAddons.ts`, tab `app/(auth)/(tabs)/(stremio)/` + `components/stremio/CatalogShelf.tsx`, route `app/(auth)/player/stremio-player.tsx`, `Settings.stremioAddonUrls` | DEVICE-VERIFIED 2026-07-03: catalog → debrid stream → jimaku sub → mined card. Pure addon client (manifest/catalog/meta/stream, capability checks, `skip` paging, torrent/`infoHash` streams filtered — debrid/HTTP only); Discover-style shelves → grid → meta/episodes → aggregated stream picker; player is a self-contained minimal route (direct-player UNTOUCHED — deliberate, see pruned backlog design) reusing MpvPlayerView + the full yomifin pipeline (tappable overlay, popup, pause-on-lookup, capture w/ sourceUrl = playing debrid URL, cue store from `stream.subtitles[0]` else jimaku); CC menu hosts the jimaku panel (same `OnlineSubtitlesModal`; auto-sync reference = addon-provided sub's cues when present, else manual nudges); icons = direct-player's Ionicons shrunk. NB addon manifest URLs (contain tokens) are settings DEFAULTS — private fork only |

## Backlog (roughly priority-ordered)

### 1. Stremio post-MVP (remaining after the 2026-07-03 polish pass)
In rough order of expected want:
- **Shared player-wiring extraction** — pull the yomifin glue (cue store, capture
  context, pause-on-lookup, popup mount, onSubtitleText/delay bookkeeping) out of
  `direct-player.tsx` into a hook/component both players use. Deliberately NOT
  done in the polish pass: it's the one risky step (touches the load-bearing
  file) and needs its own session + a full Jellyfin-side device regression pass.
  Trigger: actually missing a control during real use — keep a list. (Gestures,
  controls-dim, playback speed, and watch-state/resume shipped WITHOUT it — the
  shared `GestureOverlay` needed no extraction.)
- Catalog `search` / `genre` extras (client already builds the extra segment;
  UI only) + a Stremio search surface.
- `/subtitles/` resource resolution (both installed addons serve it) as another
  subtitle source next to jimaku + `stream.subtitles`.
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

### 4. Claude integration for asking about specific word usage or sentence meaning
### 5. Rework player UI completely — ✅ SHIPPED (see Shipped table)
### 6. Fix UI sluggishness
### 7. Ability to send sync command to ankiconnect
### 8. control pane (after a single tap) should close itself after a short timeout (5 seconds)
### 9. AirPlay to TV
### 10. Stremio progress tracking synced with new jellyfin+stremio web interface



### Small / opportunistic
- Remaining Yomitan lookup knobs (maxScanLength, JA preprocessor toggles,
  `removeNonJapaneseCharacters`) — maxResults shipped; expose the rest only if a
  real miss/annoyance shows up.
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
