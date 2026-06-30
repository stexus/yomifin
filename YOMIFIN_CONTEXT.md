# CONTEXT.md — Japanese/Chinese Immersion Player for iPad

This document is the shared context for an iPad language-learning video player.
It defines every term, component, and design decision agreed on so far. Read this
fully before touching code. The companion `IMPLEMENTATION_PLAN.md` describes the
build order.

---

## 1. What we are building (one paragraph)

A **native iPad app** that plays video from a personal **Jellyfin** server using a
**libmpv** playback core, renders **tappable subtitles** so the user can look up
words **Yomitan-style** (forward-greedy dictionary lookup with deinflection), and
creates high-quality **Anki** flashcards (sentence + audio + image) by talking to
an **AnkiConnect** instance running on a 24/7 server. It supports **Japanese and
Chinese**, switchable via **profiles**. It is a single-user, personal project — not
a distributed App Store product (for now).

The desktop workflow being replicated: Jellyfin → MPV (jellyfin-mpv-shim) +
mpvacious + a custom subtitle-to-browser plugin → Yomitan lookup in browser →
AnkiConnect card → mpvacious fills audio/sentence/image. Result: a high-quality
vocab card in ~10 seconds. We want the equivalent on iPad.

---

## 2. Glossary of terms

**Jellyfin** — Self-hosted media server. The user streams from it ~99% of the time
(occasionally downloads). Exposes an HTTP API for: authentication, browsing the
library, getting direct-play/transcoded stream URLs, reporting playback progress,
and fetching subtitle streams as data (SRT/ASS).

**libmpv** — The C library form of the MPV media player. Plays essentially every
codec/container natively (10-bit HEVC, MKV, ASS subs, FLAC) with no server-side
transcoding. This is the desired playback core because the user's content (anime,
Chinese media) is codec-heavy. Renders video into a native view in the app's view
hierarchy.

**Streamyfin** — An existing **open-source iOS Jellyfin client built in React
Native (Expo)** that already wires up a **libmpv** backend for playback. We intend
to **fork/extend** it so we inherit Jellyfin auth, library browsing, and libmpv
playback for free, and add our own language layer on top. We want to treat most of
Streamyfin as a black box and only understand its **player seams** (see §5).

**Swiftfin** — The *other* open-source iOS Jellyfin client, written in native Swift,
using **VLCKit** (mobile-vlc-kit) as its codec/playback core. Considered as an
alternative to Streamyfin. **Decision: we lean Streamyfin** primarily because it is
React Native / JavaScript, which lets us reuse Yomitan's JS (see Yomitan below).
Swiftfin/VLCKit is the documented fallback if the Streamyfin/libmpv path fails.

**AVPlayer** — Apple's built-in native video player. Trivial to integrate and
battery-efficient, but only plays Apple-supported codecs; chokes on much anime
(10-bit H.265, styled ASS, FLAC). Rejected as the primary core for that reason;
relevant only as context for why we want libmpv.

**MPV / jellyfin-mpv-shim / mpvacious** — The user's *desktop* tools, named for
reference. mpvacious is the mpv plugin that builds Anki cards (audio + sentence +
image) and can "update the last added note." We are replicating its *outcome*, not
porting it.

**Yomitan** — A browser-extension popup dictionary (successor to Yomichan). On a web
page, hovering/tapping text triggers a **forward-greedy scan**: from the cursor
position it finds the longest following character sequence that forms a dictionary
entry, applying **deinflection**. It also adds Anki cards via AnkiConnect. **There
is no Yomitan on iOS** (it's a browser extension). Our plan is to **harvest
Yomitan's core JavaScript** — the deinflector, the dictionary-database/lookup layer,
and the structured-content renderer — and re-host it inside our React Native app,
discarding the extension shell. This is the single largest piece of reused work and
the reason we prefer the RN path.

**Deinflection** — Reducing a conjugated form back to a dictionary (lemma) form
(e.g. 好きでした → 好き; 食べさせられた → 食べる). Yomitan's deinflection rules are
JSON transformation rules and are quite portable. **Japanese needs deinflection;
Chinese essentially does not** (Chinese lookup is longest-match segmentation against
the dictionary with no conjugation step).

**Tokenization / segmentation** — Splitting a subtitle line into words. Neither
Japanese nor Chinese uses spaces. Used to produce **tap anchors** (see §4), NOT to
decide lookup boundaries. Options: Apple's `NLTokenizer`/`CFStringTokenizer`
(free, decent for both languages), MeCab+UniDic/IPADIC (Japanese, stronger),
Jieba-style longest-match (Chinese). For the MVP, whatever the harvested Yomitan
core already does is sufficient.

**Forward-greedy lookup** — The actual lookup mechanism. On tap, take the text
starting at the tapped token through the end of the line, and let the dictionary +
deinflector decide how many characters form the match. Tokens are only tap targets;
the dictionary decides the real word boundary. This is how Yomitan behaves and why
tapping a conjugated verb resolves to its dictionary form.

**Yomitan-format dictionary** — The zip-based dictionary format Yomitan imports:
`term_bank_*.json`, kanji banks, frequency banks, pitch-accent banks, and
**structured content** (a JSON tree resembling mini-HTML with nested divs/spans,
styling, embedded images). The user already has Japanese and Chinese dictionaries
in this format inside their existing Yomitan. **Many common dictionaries store
definitions as structured content**, so even though the user only wants definitions
(not pitch/frequency display), a **structured-content renderer is still required**
to display those definitions correctly. Yomitan stores dictionaries in
**IndexedDB** (a browser API) — in our app this must be repointed to **SQLite** or
loaded into memory (an MVP may load one dictionary in memory crudely).

**AnkiConnect** — HTTP API add-on for desktop Anki. The user runs Anki +
AnkiConnect on a **24/7 server**, so the iPad POSTs complete notes to it over the
network. This sidesteps iOS limitations (AnkiMobile only exposes a limited
`anki://` URL scheme; there is no on-device AnkiConnect). Relevant calls:
`addNote`, `canAddNotes` (duplicate check), media attachment.

**"Build the whole card at once"** — Because we create the card in one shot inside
the app (we already have the word, sentence, timestamp, video), we do NOT need
mpvacious's two-step "update last note." Tap word → "make card" → app gathers
sentence + audio + image + timestamps → POST a complete note to AnkiConnect.

**Server-side ffmpeg** — Audio clips (and optionally frames) are produced by the
**24/7 server** running ffmpeg on the source media (referenced by Jellyfin item ID
+ start/end timestamps), then returned to the app and attached to the Anki note.
**One code path for both streaming and downloaded media** — always ask the server,
since it always has the original file. On-device slicing is explicitly out of scope.

**Profiles** — A user-selectable config bundle, mirroring Yomitan profiles. A
profile = { language (JA/ZH), tokenizer/deinflection settings, dictionary set,
target Anki deck, Anki note type, **field mapping** }. Switching profile switches
language behavior AND which deck/note-type cards go to. Field mapping must be
**configurable at runtime** (no recompile when the user changes their Anki note
fields).

**Overlay lookup** — Tappable subtitle text rendered as native/RN views **on top of
the libmpv video surface** (a transparent layer above the video). The video is a
pure backdrop; taps land on our text views, which never touch video pixels. mpv
renders with its own subtitles OFF (`sub-visibility=no`); we render subtitle text
ourselves from Jellyfin subtitle *data*. **This is the user's preferred UX
("lookup without opening a sidebar") and the single biggest unproven risk** —
specifically: can our touchable views overlay the mpv surface and receive taps.

**Sidebar lookup** — The same tappable text rendered in a **region beside the
video** (e.g. flex row: mpv view 70% width, sidebar 30%). It **avoids the overlay
question entirely** because the text lives where mpv isn't drawing. "Resizing" the
video is just laying out the mpv view smaller in a flex row — libmpv auto-scales to
its view size; this is layout, not surgery. **Sidebar is the documented fallback**
if overlay fails. The lookup engine, subtitle parsing, and card creation are
identical between overlay and sidebar — only the mount location of the tappable
text differs.

**The overlay spike / Step 0** — A tiny throwaway experiment that is the hinge of
the whole project: get Streamyfin building, play any video via libmpv, and render
ONE hardcoded tappable label on top of the video surface that logs on tap. If it
works, the overlay architecture holds and the rest is grunt work. If it fights,
fall back to sidebar on day one for ~10 lines of code instead of discovering it
after building everything.

**Migaku / Manabu** — Existing immersion apps that do tap-to-lookup. Referenced as
proof the pattern works: they pre-segment each subtitle line into tappable units and
run a forward-greedy lookup from the tapped point. They float a text layer over the
player; they do NOT make video pixels tappable. Our overlay design mirrors this.

---

## 3. Hard constraints & confirmed decisions

1. **Mac required.** iOS builds need Xcode (macOS only), including for React Native.
   Cloud Mac/CI exists but is impractical for a libmpv-touching project. Any Apple
   Silicon Mac suffices.
1a. **Dev/build setup (PROVISIONAL — not locked in).** Current intended setup, to be
    tried but not married to: author code with Claude Code from the **Linux desktop**
    (the comfortable cockpit, big screens), drive a **headless M4 Mac Mini** as a
    build box over **SSH**, deploy to the **iPad over WiFi**. Claude Code writes all
    source including native iPadOS code; the Mac compiles/signs/runs it. This is
    confirmed workable but has known setup costs (see below). **If it proves more
    friction than it's worth, fall back to coding directly on the Mac** — keep this
    flexible.

    Confirmed facts about this setup:
    - **Headless builds work fully over SSH.** xcodebuild + Xcode command-line tools
      run headless; Xcode itself can be installed/managed without a GUI via `xcodes`,
      and the license accepted with `sudo xcodebuild -license accept`.
    - **WiFi deploy works after a one-time wired pairing.** Connect the iPad by cable
      once to enable wireless syncing; thereafter install/launch over WiFi using
      `xcrun devicectl` (which needs an explicit `--device <id>` — get it from
      `xcrun devicectl list devices`; it does not accept destination specifiers).
    - **GUI needed only for one-time signing setup.** Use VNC/Screen Sharing into the
      Mini once to set up the Apple ID, development certificate, and device/
      provisioning via Xcode's GUI. After that it's pure SSH.
    - **The SSH keychain trap (expect this).** An SSH session does NOT unlock the
      login keychain the way a GUI login does, so signing fails over SSH with "no
      signing certificate / private key found" even though it works locally. Fix: put
      `security unlock-keychain -p <pw> <keychain>` in the build script before
      xcodebuild. Subtler variants are solved by running the build as a LaunchAgent
      so it has proper keychain access. Budget an afternoon for signing + keychain;
      the building and wireless deploy themselves are smooth.

    Loop shape: Linux desktop → SSH → headless M4 Mac Mini (builds/signs) → WiFi →
    iPad. **All correctness validation is still Mac/iPad-side** — native code Claude
    writes is unverified until it has built and run there. Native-module mistakes
    (CocoaPods/signing, view-hierarchy/touch behavior, the libmpv bridge) only surface
    at build/run time. The JS/TS layer (subtitle parsing, harvested Yomitan core,
    lookup, RN UI, server-side ffmpeg/AnkiConnect) tolerates the remote-build seam
    well; the native work needs tighter author→build cycles. Phase 0 (the overlay
    spike) especially will bounce build attempts repeatedly, since "does a touchable
    view sit on the mpv surface and receive taps" can only be answered on the device.
2. **Languages: Japanese and Chinese.** Profiles switch between them.
3. **Native iPad app** (React Native via Streamyfin counts as native — it compiles
   to a native binary). A pure WebView/HTML5-video approach was **rejected** because
   it does not exercise libmpv, which is a core MVP requirement.
4. **Single user, personal.** No App Store / distribution concerns yet. Sideloading
   to the user's own device.
5. **24/7 server** runs Anki + AnkiConnect and will run the ffmpeg clip service.
   Network access from iPad to this server is assumed reliable.
6. **Streaming is the 99% case;** downloads supported but never require on-device
   audio slicing (server does it).
7. **Subtitles are rendered by the app from data, not by mpv** (mpv subs off), so
   they can be tappable. App fetches subtitle streams from Jellyfin.
8. **Card creation is one-shot** (no "update last note").
9. **Anki field mapping is runtime-configurable.**
10. **Definitions only** for dictionary display — but this still requires the
    **structured-content renderer** because many dictionaries store definitions as
    structured content. Pitch-accent/frequency *display* is out of scope.

---

## 4. The lookup mechanism (precise)

1. When a subtitle line becomes active, segment it once into tokens. (Cheap;
   sub-millisecond for a ~10–40 char line. Pre-segmenting is correct, not a perf
   concern.)
2. Render each token as its own tappable element (RN `<Text onPress>` / `<Pressable>`
   in a flex-wrap row). Hit-testing is then free — the OS reports which token was
   tapped; no pixel-to-character math.
3. On tap, pass "text from this token's position to end of line" into the harvested
   Yomitan core, which does a **forward-greedy** scan + **deinflection** (JA) or
   longest-match (ZH) to decide the real word boundary and find entries.
4. Show definition popup (structured-content rendered).
5. Optional "make card" → assemble note → POST to AnkiConnect.

Tokens are tap anchors only; the dictionary decides boundaries. Tokenizer
boundaries and dictionary boundaries need not agree.

---

## 5. Streamyfin seams we must understand (and ONLY these)

We want to black-box Streamyfin except for the player seams. Before/while building,
identify in Streamyfin's source:

- **(a) Video surface view** — the native view libmpv renders into, and whether
  sibling/overlay touchable views can be placed above it and receive touches.
  *(This is the overlay-spike question.)*
- **(b) Current playback timestamp** — how to read mpv's current play time
  (for subtitle sync and card timestamps).
- **(c) Frame snapshot** — how to grab the current video frame (for card images).
- **(d) Subtitle track access** — how it fetches/exposes Jellyfin subtitle streams,
  and how to turn mpv's own subtitle rendering OFF.

Everything else in Streamyfin (auth, library UI, settings, downloads) is a black box
for now.

---

## 6. Two load-bearing risks (ranked)

1. **Overlay-on-mpv** — can touchable views overlay the libmpv surface and receive
   taps? Proven/killed by the Step 0 spike.
2. **Yomitan core extraction into RN** — how cleanly the deinflector + dictionary-DB
   layer + structured-content renderer lift out of the extension and re-host in RN,
   including repointing IndexedDB → SQLite/in-memory.

Everything else is well-scoped grunt work.

---

## 7. Explicitly OUT of scope for the MVP

- Audio/image in cards (server-side ffmpeg) — v2 (sentence-only card is the MVP bar).
- ASS styling/positioning/karaoke — MVP handles SRT (the JA majority) as plain text.
- 10-bit HEVC and exotic codecs validation — pick test content that plays; libmpv
  handles it but it's not the thing being proven.
- Dictionary storage at scale (SQLite, multiple large dicts) — MVP may load one
  dictionary crudely in memory.
- Profiles UI — MVP can hardcode one language/deck; profiles are v2.
- Downloads / offline card creation.
- Duplicate detection, frequency/pitch display, furigana/pinyin reading aids
  (reading shown only on explicit lookup, Yomitan-style).

---

## 8. Dev environment & build setup (Phase −1 — DONE ✅)

Phase −1 from `IMPLEMENTATION_PLAN.md` is **complete and verified end-to-end**:
unmodified Streamyfin builds via a reproducible Nix toolchain, deploys over the
full remote loop, and **plays a Jellyfin video via libmpv on the physical iPad**
(confirmed: live device logs while navigating, video playback works). The
remaining unknowns are now downstream (Phase 0 overlay spike, Phase 2 Yomitan).
These are the concrete learnings (kept here so upstream `CLAUDE.md` stays clean).

> **Phase 0 (overlay spike) = PASS ✅.** Overlay-on-mpv works on the physical iPad.
> libmpv renders into an `AVSampleBufferDisplayLayer` (normal CALayer in a plain
> UIView/ExpoView), not a raw Metal/GL surface; the player view doesn't swallow
> touches; Streamyfin already overlays interactive RN `<Controls>` as siblings of
> `<MpvPlayerView>`. Overlay is the adopted container. Full seam map (a)–(d) is in
> `PHASE0_SEAMS.md`.
>
> **Phase 1 (tappable subtitles synced to playback) = PASS ✅.** Fetch one Jellyfin
> SRT as data → parse → render the active line as tappable spans over the video,
> synced via the player's `progress` shared value; mpv's own subs disabled. Tap
> logs from-token-to-end-of-line. Isolated language layer in `utils/yomifin/` +
> `components/yomifin/TappableSubtitleOverlay.tsx`, wired in the direct player.
> Tap anchors are per-grapheme (no Intl.Segmenter in this Hermes). Next: Phase 2
> (harvest Yomitan core for real lookup) — starts with an investigation task.

> **Phases 2 + storage + subtitles (2026-06-28).** Phase 2 (real Yomitan lookup) is
> DONE on device. Since then, **two architecture pivots supersede parts of this
> document** — the authoritative status is **`IMPLEMENTATION_PLAN.md` → STATUS &
> HANDOFF**:
>  - **Pivot A (storage):** dictionaries are now **SQLite** (`.db`), built offline or
>    imported on-device via **Settings → Dictionaries** (`.zip` chunked import, or a
>    prebuilt `.db` copy). Supersedes §2/§7's "in-memory MVP" and §7.5's "SQLite is v2".
>  - **Pivot B (subtitles):** **mpv now owns subtitle loading/selection/timing**; the
>    tappable overlay renders mpv's live `sub-text` (native `onSubtitleText` event), and
>    bitmap/PGS subs render natively. **This reverses §7 / the "Overlay lookup" note**
>    ("mpv subs OFF, app renders from data") — mpv subs are ON but native-rendering is
>    hidden for text tracks.
> Regression guards: `./scripts/yomifin-test.sh`. Next phase: **Phase 3 (Anki)**.

> REMOTE FLOW VERIFIED: the CONTEXT §1a loop works — Linux desktop → SSH →
> headless Mac (`massimo@10.0.0.99`, `Louiss-Mac-mini.local`) → WiFi → iPad.
> Build + deploy via `./scripts/remote-build.sh` (unlocks keychain, then builds
> in the Nix shell). The SSH keychain trap from §1a is real and handled by that
> script; Nix is found over SSH because Determinate Nix writes PATH setup to
> `/etc/zshenv` (sourced by non-interactive SSH).

### Signing facts (free Apple account) — all reproducible via app.json/plugins

- **Bundle ID:** `com.massimotseng.yomifin` (in `app.json` `ios.bundleIdentifier`).
- **Apple team:** `27326V9T54` (`app.json` `ios.appleTeamId` → `DEVELOPMENT_TEAM`).
  The Apple ID `massimotseng@gmail.com` belongs to TWO teams — `27326V9T54`
  (owns this App ID; this is the right one) and `ZUGK5GXTT7` (where the Apple
  Development cert lives). The cert works across both. A provisioning profile's
  `application-identifier` prefix tells you which team owns a bundle ID.
- **iPad device UDID (for `expo run:ios --device`):** `00008027-000641082130402E`
  (CoreDevice/devicectl id is different: `9932CE8C-3F5F-52C5-8A27-DDFFC93FD0D1`).
- **Free-account entitlement stripping:** free profiles can't grant paid
  capabilities, so `plugins/withFreeAccountEntitlements.js` removes
  `aps-environment` (push, added by expo-notifications) and
  `com.apple.developer.networking.wifi-info`. It is placed **first** in
  `app.json` `plugins` so its entitlements mod runs **last** (Expo runs
  later-registered entitlement mods first). If a new "profile does not support
  the X capability" error appears, add that entitlement key to that plugin.
- **Sandbox:** `plugins/withDisableScriptSandboxing.js` keeps
  `ENABLE_USER_SCRIPT_SANDBOXING=NO` (Xcode 26 defaults it YES → breaks the RN
  packager-IP build phase).
- All of the above survive `expo prebuild`; **never hand-edit `ios/`** for them.
- Free certs/profiles expire after **7 days** — rebuild + re-trust on device
  (Settings > General > VPN & Device Management).

### Reproducible toolchain (Nix)

A `flake.nix` provides bun, Node 22, JDK 17, watchman, cocoapods, git, jq so
nothing is installed globally. **Run every command inside the dev shell.**

```bash
nix develop                                # enter the shell (or: direnv allow once)
nix develop --command bash -c '<cmd>'      # run a single command in the shell
```

What the flake's shellHook handles automatically (these were all real failures we
hit — do not remove them):
- Defers Apple tooling to system Xcode: unsets Nix `DEVELOPER_DIR`/`SDKROOT` and
  shadows Nix's fake `xcrun` + GNU `tar` with the real `/usr/bin` ones (Nix's tar
  corrupts Expo's precompiled xcframework unpacking).
- Uses `mkShellNoCC` and clears `CC`/`CXX`/`NIX_CFLAGS_COMPILE` so iOS native
  builds use Xcode's clang/libc++, not Nix's (otherwise: `FP_ZERO`/`uint8_t`
  header errors when CMake pods compile against the iPhone SDK).
- Sets `LANG`/`LC_ALL` to UTF-8 so CocoaPods `pod install` doesn't crash.

Still required outside Nix (cannot be packaged): **full Xcode** (App Store) for
iOS device builds, and **Android Studio + SDK** for Android.

### First-time iOS setup

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -license accept
nix develop --command bash -c 'bun i && bun run submodule-reload'
nix develop --command bash -c 'bun run ios:install-metal-toolchain'
nix develop --command bash -c 'bun run prebuild'   # generates ios/, runs pod install
```

In Xcode (one-time): add your Apple ID (Settings > Accounts), then on the
Streamyfin target > Signing & Capabilities set your Team and a unique Bundle
Identifier (you can't sign `com.fredrikburmester.streamyfin`).

### Build & install to a physical device (CLI)

```bash
nix develop --command bash -c 'xcrun xctrace list devices'   # find your device UDID
nix develop --command bash -c 'EXPO_TV=0 bunx expo run:ios --device <UDID>'
```

If `codesign` prompts repeatedly (keychain ACL bug — same family as the SSH
keychain trap in §1a), authorize it once in your own Terminal (asks for your
macOS login password):

```bash
security unlock-keychain ~/Library/Keychains/login.keychain-db
security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
  -k <login-password> ~/Library/Keychains/login.keychain-db
```

Then on the device: Settings > General > VPN & Device Management > trust your
developer cert. Free Apple ID certs expire after 7 days (rebuild + re-trust).

### Day-to-day loop

- **JS/TS changes only:** no rebuild needed.
  `nix develop --command bash -c 'bunx expo start --dev-client'`, then open the
  app on the device (same network / it auto-connects to Metro). This is the loop
  most of the language layer (subtitle parsing, harvested Yomitan core, lookup
  UI, AnkiConnect) will use.
- **Native dep / config / `app.json` plugin changes:** re-run `bun run prebuild`
  then `expo run:ios --device <UDID>`. The libmpv/overlay native work (Phase 0)
  goes through this slower path.
- The `ENABLE_USER_SCRIPT_SANDBOXING=NO` fix is permanent via
  `plugins/withDisableScriptSandboxing.js` (reapplied on every prebuild under
  Xcode 26) — do NOT hand-edit `ios/.../project.pbxproj` for it.

### Repo state

All of the above lives on the **`yomifin`** branch: `flake.nix`, `flake.lock`,
`.envrc`, `plugins/withDisableScriptSandboxing.js` (+ `app.json` wiring),
`.gitignore` (`.direnv/`).
