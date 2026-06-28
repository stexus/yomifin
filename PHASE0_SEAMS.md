# Phase 0 — Streamyfin Player Seams Report

> **STATUS: PASS ✅ (overlay confirmed on physical iPad).** A hardcoded tappable
> label mounted over the playing libmpv surface received taps and logged. The
> overlay architecture is adopted; sidebar remains a trivial future fallback.
> The throwaway spike code has been removed from `direct-player.tsx`.

Investigation per IMPLEMENTATION_PLAN.md Phase 0 / CONTEXT.md §5. **No code was
modified to produce this report** — it only locates and documents the seams (a)–(d).
The player is a self-contained Expo native module at `modules/mpv-player/`.

---

## TL;DR — the overlay risk is already largely de-risked

Streamyfin **already renders fully-interactive React Native views on top of the
libmpv video surface**: `<Controls>` (play/pause buttons, a draggable seek slider,
gesture overlay) is mounted as a **sibling of `<MpvPlayerView>`** inside the same
parent `View` and receives touches over the playing video
(`app/(auth)/player/direct-player.tsx`, return block).

Why this works: libmpv renders into an **`AVSampleBufferDisplayLayer`** (a normal
`CALayer`), nested inside a plain `UIView` (`videoContainer`) inside the `ExpoView`
(`MpvPlayerView`). It is **not** a raw Metal/GL `CAEAGLLayer` view that captures the
responder chain. `MpvPlayerView` does **not** override `hitTest`/`pointInside` and
does not disable user interaction on itself, so sibling/overlay RN views above it in
z-order receive taps normally. The Phase 0 spike should therefore PASS; it remains
worth running on-device once to confirm literally.

---

## (a) Video-surface view — where libmpv draws, and overlay viability

- **Native view:** `MpvPlayerView` (`modules/mpv-player/ios/MpvPlayerView.swift`),
  an `ExpoView`. Exposed to JS/RN as the native component **`"MpvPlayer"`**
  (`MpvPlayerModule.swift` → `View(MpvPlayerView.self)`), wrapped by
  `modules/mpv-player/src/MpvPlayerView.tsx` and re-exported from `@/modules`.
- **Render target:** `private let displayLayer = AVSampleBufferDisplayLayer()`,
  added as a sublayer of `videoContainer` (a plain `UIView` pinned to all edges).
  `setupView()` builds this hierarchy; `MPVLayerRenderer(displayLayer:)` pushes
  decoded frames into that layer (`MPVLayerRenderer.swift`).
- **Touch behavior:** no `hitTest`/`isUserInteractionEnabled` override → does not
  swallow touches. Overlay siblings already work (the `<Controls>` proof above).
- **Where to mount overlay text (JS):** in `direct-player.tsx`, as a sibling of
  `<MpvPlayerView>` inside the relative-positioned wrapper `View`, using
  `position: "absolute"` — exactly how `<Controls>` and the loader overlay are
  mounted today.

**Conclusion:** overlay container is viable. Sidebar fallback not needed unless the
on-device spike surprises us.

---

## (b) Current playback timestamp

- **Push (preferred):** the `onProgress` event fires with
  `{ position, duration, progress, cacheSeconds }` where `position`/`duration` are
  **seconds** (`MpvPlayerView.swift` → `renderer(_:didUpdatePosition:...)` →
  `onProgress(...)`). Backed by mpv observing the **`time-pos`** property
  (`MPVLayerRenderer.swift`), throttled (~not every frame) to avoid 24+ Hz spam.
  In JS, `direct-player.tsx`'s `onProgress` already consumes this and stores it in a
  reanimated `progress` shared value (in **ms**).
- **Pull:** `videoRef.current.getCurrentPosition()` (seconds) and `getDuration()`.
- **For subtitle sync (Phase 1):** subscribe to `onProgress` (or read the existing
  `progress` shared value) to pick the active subtitle line. Resolution is fine for
  sub timing; it's throttled but sub-second.

---

## (c) Frame snapshot (for card images — Phase 4 / v2, NOT MVP)

- **Does not exist yet.** No screenshot/snapshot function in
  `MPVLayerRenderer.swift`, `MpvPlayerView.swift`, or the module API.
- **Two future options when needed:**
  1. mpv's own `screenshot-to-file` / `screenshot-raw` command via the existing
     `commandSync` plumbing in the renderer.
  2. Pull a `CVPixelBuffer`/`CMSampleBuffer` from the decode path feeding
     `AVSampleBufferDisplayLayer`.
- **MVP impact:** none. CONTEXT §7 makes audio/image cards v2; the MVP card is
  sentence-only and image comes from the **server-side ffmpeg** path (Phase 4),
  which may not even need an on-device snapshot.

---

## (d) Subtitle track access + disabling mpv's own subtitle rendering

- **Enumerate:** `getSubtitleTracks()` → `[{ id, title, lang, selected }]`
  (`MpvPlayerView.swift` / renderer line ~747).
- **Select:** `setSubtitleTrack(trackId)` (sets mpv `sid`).
- **Disable mpv's rendering (the key one for us):**
  `disableSubtitles()` → sets mpv property **`sid = "no"`**
  (`MPVLayerRenderer.swift` ~line 800). Also `setSubtitleTrack(-1)` maps to
  `sid = "no"`, and the load config accepts `initialSubtitleId: -1` to start with
  subs off (`VideoLoadConfig` / `getMpvSubtitleId` in
  `utils/jellyfin/subtitleUtils.ts`).
- **For Phase 1:** call `disableSubtitles()` (or pass `initialSubtitleId: -1`) so
  mpv draws no subs, then we fetch the SRT from Jellyfin as data and render our own
  tappable line. NOTE: Jellyfin subtitle *data* fetch is a JS concern (external
  subs are already resolved as URLs in `direct-player.tsx`'s `videoSource` memo:
  `mediaSource.MediaStreams` filtered to `Type === "Subtitle"`); we'll fetch the
  chosen track's `DeliveryUrl` as text rather than feed it to mpv.

---

## Other useful seams found (for later phases)

- **Track-ready gate:** `onTracksReady` event → `tracksReady` state; initial seek
  waits on it. Good signal that subtitle/audio track lists are populated.
- **Technical info:** `getTechnicalInfo()` returns width/height/fps/codecs — handy
  for image sizing / sync sanity later.
- **Imperative ref API:** full surface in `MpvPlayer.types.ts` (`MpvPlayerViewRef`)
  and wired in `MpvPlayerView.tsx`.

---

## Spike plan (next step)

Add ONE hardcoded tappable label (猫) as an `position:absolute` sibling of
`<MpvPlayerView>` in `direct-player.tsx`, `onPress` → `console.log`. Throwaway.
Build via the native path (`prebuild` not needed — JS-only change, so dev-client
reload suffices) and confirm on the iPad that the tap logs while video plays.
