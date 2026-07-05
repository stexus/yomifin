/*
 * Minimal Stremio player (FEATURES.md backlog item 1, MVP cut).
 *
 * Plays a debrid-resolved / plain-HTTP stream URL with the full yomifin mining
 * pipeline mounted on top: mpv-driven tappable subtitles → lookup popup → Anki
 * card with on-device audio+image capture (capture source = the playing URL,
 * which is range-seekable for debrid links).
 *
 * Online subtitles (jimaku.cc) are wired the same way as direct-player: the CC
 * menu offers "Online subtitles…" (gated on the API key), the downloaded file is
 * sub-add'ed to mpv with native rendering hidden, its parsed cues own the cue
 * store (shifted by the sync delay), and auto-sync estimates against the
 * stream's own external subtitle cues when the addon provided any (else manual
 * nudges only).
 *
 * Deliberately NOT threaded through direct-player.tsx (no Jellyfin item, no
 * session reporting) — this is a separate, self-contained route taking
 * { url, title, query, episode, subtitleUrls } params. Controls are minimal on
 * purpose; icons mirror direct-player's (Ionicons), shrunk.
 *
 * Post-MVP polish (FEATURES stremio item): full gesture parity via the shared
 * GestureOverlay (single/double/two-finger taps on the native gesture surface,
 * drag-anywhere-to-seek, volume/brightness, controls dim — replacing the old bare
 * Pressable toggle layer, which could never coexist with RNGH anyway), a playback
 * speed cycler, and local watch-state/resume (MMKV, keyed on title+episode — the
 * debrid URL changes per resolve; utils/stremio/watchState.ts).
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSharedValue } from "react-native-reanimated";
import StremioPlayerControls from "@/components/stremio/StremioPlayerControls";
import { GestureOverlay } from "@/components/video-player/controls/GestureOverlay";
import { suppressTaps } from "@/components/video-player/controls/tapSuppression";
import OnlineSubtitlesModal, {
  type LoadedOnlineSubtitle,
} from "@/components/yomifin/OnlineSubtitlesModal";
import ProfilePill from "@/components/yomifin/ProfilePill";
import YomifinErrorBoundary from "@/components/yomifin/YomifinErrorBoundary";
import YomifinLookupLayer from "@/components/yomifin/YomifinLookupLayer";
import {
  type MpvAudioTrack,
  type MpvOnPlaybackStateChangePayload,
  type MpvOnProgressEventPayload,
  MpvPlayerView,
  type MpvPlayerViewRef,
  type MpvSubtitleTrack,
  type MpvVideoSource,
} from "@/modules";
import { useSettings } from "@/utils/atoms/settings";
import {
  yomifinCueRangeAtom,
  yomifinCuesAtom,
} from "@/utils/atoms/yomifinCueStore";
import {
  loadStremioWatchState,
  saveStremioWatchState,
  stremioWatchKey,
} from "@/utils/stremio/watchState";
import {
  type CaptureContext,
  captureCardMedia,
  type MediaWant,
} from "@/utils/yomifin/ankiMedia";
import { fnv1a } from "@/utils/yomifin/mediaKey";
import type { SubtitleCue } from "@/utils/yomifin/srt";
import { estimateSubtitleOffset } from "@/utils/yomifin/subSync";
import {
  cleanSubtitleOverlayText,
  parseSubtitleText,
  shiftCues,
} from "@/utils/yomifin/subtitleParse";

/** mpv codecs rendered as bitmaps (native rendering stays ON; overlay is empty). */
const BITMAP_SUB_CODECS = new Set([
  "hdmv_pgs_subtitle",
  "dvd_subtitle",
  "dvb_subtitle",
  "vobsub",
  "pgssub",
  "dvbsub",
  "dvdsub",
  "xsub",
]);

function isTextSubCodec(codec?: string): boolean {
  if (!codec) return true; // unknown → assume text (external files etc.)
  return !BITMAP_SUB_CODECS.has(codec.toLowerCase());
}

export default function StremioPlayerPage() {
  const videoRef = useRef<MpvPlayerViewRef>(null);
  const navigation = useNavigation();
  const { settings } = useSettings();

  const { url, title, query, episode, anilistId, subtitleUrls } =
    useLocalSearchParams<{
      url: string;
      title?: string;
      /** Bare series/movie name (jimaku search prefill; falls back to title). */
      query?: string;
      /** Episode number (jimaku file filter prefill). */
      episode?: string;
      /** AniList id when the Stremio id was anilist-prefixed. */
      anilistId?: string;
      subtitleUrls?: string;
    }>();

  const externalSubUrls = useMemo<string[]>(() => {
    if (!subtitleUrls) return [];
    try {
      const parsed = JSON.parse(subtitleUrls);
      return Array.isArray(parsed)
        ? parsed.filter((u) => typeof u === "string")
        : [];
    } catch {
      return [];
    }
  }, [subtitleUrls]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [subTracks, setSubTracks] = useState<MpvSubtitleTrack[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<number>(-1);
  const [audioTracks, setAudioTracks] = useState<MpvAudioTrack[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<number>(-1);
  // LEGACY binaries only: bumped per window-seam two-finger tap (feedback bubble).
  const [twoFingerNonce, setTwoFingerNonce] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Gesture layer / slider shared values (ms, like the Jellyfin player's Controls).
  const progressSV = useSharedValue(0);
  const maxSV = useSharedValue(0);
  const minSV = useSharedValue(0);
  const cacheProgressSV = useSharedValue(0);
  const isSeekingSV = useSharedValue(false);

  // ── yomifin wiring (mirrors direct-player, minus Jellyfin) ────────────────
  const [subtitleText, setSubtitleText] = useState("");
  const cueRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const positionRef = useRef(0);
  const setYomifinCues = useSetAtom(yomifinCuesAtom);
  const setYomifinCueRange = useSetAtom(yomifinCueRangeAtom);

  // Online subs (jimaku): same contract as direct-player. When active, the
  // external track owns the cue store (cues shifted into the VIDEO timeline by
  // the sync delay); the stream's own external-sub cues (if the addon provided
  // any) become the auto-sync REFERENCE.
  const [onlineSubsVisible, setOnlineSubsVisible] = useState(false);
  const [externalSub, setExternalSub] = useState<LoadedOnlineSubtitle | null>(
    null,
  );
  const [subDelayMs, setSubDelayMs] = useState(0);
  const externalSubRef = useRef<LoadedOnlineSubtitle | null>(null);
  const subDelayMsRef = useRef(0);
  const referenceCuesRef = useRef<SubtitleCue[]>([]);

  const mediaId = useMemo(() => `stremio_${fnv1a(url ?? "")}`, [url]);

  // Watch-state / resume: keyed on content identity (title+episode), not the
  // per-resolve debrid URL. Read once per mount for the start position.
  const watchKey = useMemo(
    () => stremioWatchKey(query || title, episode),
    [query, title, episode],
  );
  const [resumePositionSec] = useState(() => {
    if (!watchKey) return 0;
    const state = loadStremioWatchState(watchKey);
    if (state && state.positionSec > 0) {
      console.log(`[STREMIO] resuming at ${state.positionSec}s (${watchKey})`);
      return state.positionSec;
    }
    return 0;
  });
  const lastWatchSaveRef = useRef(0);
  const durationRef = useRef(0);

  useEffect(() => {
    activateKeepAwakeAsync();
    return () => {
      deactivateKeepAwake();
    };
  }, []);

  // Reset the cue store for this playback; fill it from the FIRST external
  // subtitle URL if one was provided (multi-sentence cards + sync reference).
  // Embedded-only subs degrade to the single live cue — already handled.
  useEffect(() => {
    setYomifinCues([]);
    setYomifinCueRange(null);
    referenceCuesRef.current = [];
    const first = externalSubUrls[0];
    if (!first) return;
    let cancelled = false;
    fetch(first)
      .then((r) => r.text())
      .then((text) => {
        if (cancelled) return;
        const cues = parseSubtitleText(first, text);
        console.log(`[STREMIO] cue store: ${cues.length} cues from ${first}`);
        referenceCuesRef.current = cues;
        if (!externalSubRef.current) setYomifinCues(cues);
      })
      .catch((e) =>
        console.warn(`[STREMIO] external sub fetch failed: ${e.message}`),
      );
    return () => {
      cancelled = true;
    };
  }, [externalSubUrls, setYomifinCues, setYomifinCueRange]);

  // Publish the online sub's cues (shifted into the VIDEO timeline) + refs.
  useEffect(() => {
    externalSubRef.current = externalSub;
    subDelayMsRef.current = subDelayMs;
    if (externalSub) {
      setYomifinCues(shiftCues(externalSub.cues, subDelayMs));
    }
  }, [externalSub, subDelayMs, setYomifinCues]);

  const videoSource = useMemo<MpvVideoSource | undefined>(() => {
    if (!url) return undefined;
    const source: MpvVideoSource = {
      url,
      autoplay: true,
      startPosition: resumePositionSec,
      cacheConfig: {
        enabled: settings.mpvCacheEnabled,
        cacheSeconds: settings.mpvCacheSeconds,
        maxBytes: settings.mpvDemuxerMaxBytes,
        maxBackBytes: settings.mpvDemuxerMaxBackBytes,
      },
      voDriver: settings.mpvVoDriver,
    };
    if (externalSubUrls.length > 0) source.externalSubtitles = externalSubUrls;
    return source;
  }, [
    url,
    externalSubUrls,
    resumePositionSec,
    settings.mpvCacheEnabled,
    settings.mpvCacheSeconds,
    settings.mpvDemuxerMaxBytes,
    settings.mpvDemuxerMaxBackBytes,
    settings.mpvVoDriver,
  ]);

  // Track list + initial visibility: hide mpv's native rendering for TEXT subs
  // (our tappable overlay draws them); bitmap subs keep native rendering.
  const refreshTracks = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const tracks = (await v.getSubtitleTracks?.()) ?? [];
      setSubTracks(tracks);
      const sel = tracks.find((t) => t.selected);
      setSelectedSubId(sel?.id ?? -1);
      await v.setSubtitleVisibility?.(!(sel && isTextSubCodec(sel.codec)));
      console.log(
        "[STREMIO] sub tracks:",
        tracks.map(
          (t) =>
            `#${t.id} ${t.lang ?? "?"} "${t.title ?? ""}" ${t.selected ? "*SEL" : ""} ${t.codec ?? ""}`,
        ),
      );
    } catch (e) {
      console.warn(`[STREMIO] track refresh failed: ${e}`);
    }
    try {
      const audio = (await v.getAudioTracks?.()) ?? [];
      setAudioTracks(audio);
      const selAudio = audio.find((t) => t.selected);
      setSelectedAudioId(selAudio?.id ?? -1);
      console.log(
        "[STREMIO] audio tracks:",
        audio.map(
          (t) =>
            `#${t.id} ${t.lang ?? "?"} "${t.title ?? ""}" ${t.selected ? "*SEL" : ""} ${t.channels ?? "?"}ch`,
        ),
      );
    } catch (e) {
      console.warn(`[STREMIO] audio track refresh failed: ${e}`);
    }
  }, []);

  const selectAudioTrack = useCallback(async (trackId: number) => {
    const v = videoRef.current;
    if (!v) return;
    setSelectedAudioId(trackId);
    try {
      await v.setAudioTrack?.(trackId);
    } catch (e) {
      console.warn(`[STREMIO] audio track select failed: ${e}`);
    }
  }, []);

  const selectSubTrack = useCallback(
    async (trackId: number) => {
      const v = videoRef.current;
      if (!v) return;
      // Picking a track dismisses any active online sub (stays loaded in mpv's
      // list but deselected) and zeroes the sync delay — same as direct-player.
      if (externalSubRef.current) {
        setExternalSub(null);
        setSubDelayMs(0);
        v.setSubtitleDelay?.(0).catch(() => {});
        setYomifinCues(referenceCuesRef.current);
        setYomifinCueRange(null);
      }
      setSelectedSubId(trackId);
      if (trackId === -1) {
        await v.disableSubtitles?.();
        setSubtitleText("");
        return;
      }
      await v.setSubtitleTrack?.(trackId);
      const track = subTracks.find((t) => t.id === trackId);
      await v.setSubtitleVisibility?.(!isTextSubCodec(track?.codec));
    },
    [subTracks, setYomifinCues, setYomifinCueRange],
  );

  // Online sub loaded from the jimaku panel: into mpv, hidden natively (our
  // overlay draws it), cues into the store, delay reset.
  const handleOnlineSubtitleLoaded = useCallback(
    async (sub: LoadedOnlineSubtitle) => {
      try {
        await videoRef.current?.addSubtitleFile?.(sub.path, true);
        await videoRef.current?.setSubtitleVisibility?.(false);
        await videoRef.current?.setSubtitleDelay?.(0);
      } catch (e) {
        console.warn(
          `[STREMIO] failed to load online sub into mpv: ${(e as Error).message}`,
        );
      }
      setSubDelayMs(0);
      setExternalSub(sub);
      setYomifinCueRange(null);
      refreshTracks();
      console.log(
        `[STREMIO] online subtitle active: "${sub.name}" (${sub.cues.length} cues)`,
      );
    },
    [setYomifinCueRange, refreshTracks],
  );

  const handleSubDelayChange = useCallback((ms: number) => {
    setSubDelayMs(ms);
    videoRef.current?.setSubtitleDelay?.(ms / 1000).catch(() => {});
  }, []);

  // Auto sync: only possible when the stream's addon supplied an external sub
  // (its cues are the reference). Embedded-only playback → null → manual nudges.
  const handleAutoSync = useCallback(() => {
    const ext = externalSubRef.current;
    if (!ext || referenceCuesRef.current.length === 0) return null;
    const est = estimateSubtitleOffset(referenceCuesRef.current, ext.cues);
    if (est) handleSubDelayChange(Math.round(est.offsetMs));
    return est;
  }, [handleSubDelayChange]);

  const onSubtitleText = useCallback(
    (e: { nativeEvent: { text: string; start?: number; end?: number } }) => {
      setSubtitleText(cleanSubtitleOverlayText(e.nativeEvent?.text ?? ""));
      // mpv reports the cue's FILE-timeline times; a delayed online sub needs
      // VIDEO time = file time + delay for capture/anchoring.
      const delaySec = externalSubRef.current
        ? subDelayMsRef.current / 1000
        : 0;
      cueRef.current = {
        start: (e.nativeEvent?.start ?? 0) + delaySec,
        end: (e.nativeEvent?.end ?? 0) + delaySec,
      };
    },
    [],
  );

  const onProgress = useCallback(
    (e: { nativeEvent: MpvOnProgressEventPayload }) => {
      const { position, duration } = e.nativeEvent;
      positionRef.current = position;
      durationRef.current = duration ?? 0;
      setIsBuffering(false);
      setPositionSec((prev) =>
        Math.abs(prev - position) >= 1 ? position : prev,
      );
      setDurationSec((prev) =>
        Math.abs(prev - (duration ?? 0)) >= 1 ? (duration ?? 0) : prev,
      );
      // Gesture layer shared values (don't fight an in-flight scrub).
      if (!isSeekingSV.value) progressSV.value = position * 1000;
      maxSV.value = (duration ?? 0) * 1000;
      // Watch-state save, throttled to ~10s of wall time.
      const now = Date.now();
      if (watchKey && now - lastWatchSaveRef.current >= 10_000) {
        lastWatchSaveRef.current = now;
        saveStremioWatchState(watchKey, position, duration ?? 0);
      }
    },
    [watchKey, progressSV, maxSV, isSeekingSV],
  );

  const onPlaybackStateChange = useCallback(
    (e: { nativeEvent: MpvOnPlaybackStateChangePayload }) => {
      const { isPaused, isPlaying: playing, isLoading } = e.nativeEvent;
      if (playing) {
        setIsPlaying(true);
        setIsBuffering(false);
      } else if (isPaused) {
        setIsPlaying(false);
      }
      if (isLoading !== undefined) setIsBuffering(isLoading);
    },
    [],
  );

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      videoRef.current?.pause();
      setIsPlaying(false);
    } else {
      videoRef.current?.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const seekBy = useCallback((delta: number) => {
    videoRef.current?.seekBy?.(delta);
  }, []);

  const setSpeed = useCallback((next: number) => {
    setPlaybackSpeed(next);
    videoRef.current?.setSpeed(next).catch(() => {});
  }, []);

  // Pause-on-lookup (same contract as direct-player).
  const pausedByLookupRef = useRef(false);
  const isPlayingRef = useRef(false);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  const lookupOpen = useCallback(() => {
    if (!settings.yomifinPauseOnLookup) return;
    if (isPlayingRef.current) {
      pausedByLookupRef.current = true;
      setIsPlaying(false);
      videoRef.current?.pause();
    }
  }, [settings.yomifinPauseOnLookup]);
  const lookupClose = useCallback(() => {
    if (pausedByLookupRef.current) {
      pausedByLookupRef.current = false;
      setIsPlaying(true);
      videoRef.current?.play();
    }
  }, []);

  // Card capture: cheap snapshot at tap; expensive capture only on add-press.
  // sourceUrl = the playing URL itself (debrid links are range-seekable HTTPS).
  const snapshotCard = useCallback(
    (): CaptureContext => ({
      cueStart: cueRef.current.start,
      cueEnd: cueRef.current.end,
      framePos: positionRef.current,
    }),
    [],
  );
  const captureMedia = useCallback(
    async (ctx: CaptureContext, want: MediaWant) => {
      const v = videoRef.current;
      if (!v) return {};
      return captureCardMedia(v, ctx, mediaId, url ?? "", want);
    },
    [mediaId, url],
  );

  // Interactive slider: pause during, seek + resume on release (like the Jellyfin
  // bottom slider). awesome-slider writes progressSV live; onProgress is guarded.
  const wasPlayingBeforeSliderRef = useRef(false);
  const handleSliderStart = useCallback(() => {
    isSeekingSV.value = true;
    wasPlayingBeforeSliderRef.current = isPlayingRef.current;
    if (isPlayingRef.current) {
      setIsPlaying(false);
      videoRef.current?.pause();
    }
  }, [isSeekingSV]);
  const handleSliderComplete = useCallback(
    (ms: number) => {
      const sec = Math.max(0, ms / 1000);
      videoRef.current?.seekTo?.(sec);
      positionRef.current = sec;
      setPositionSec(sec);
      isSeekingSV.value = false;
      if (wasPlayingBeforeSliderRef.current) {
        setIsPlaying(true);
        videoRef.current?.play();
      }
    },
    [isSeekingSV],
  );

  // Drag-anywhere-to-seek lifecycle (GestureOverlay pan → worklet; these run at
  // the edges only). Same contract as direct-player: pause during, seek + resume.
  const wasPlayingBeforeScrubRef = useRef(false);
  const handleScrubStart = useCallback(() => {
    wasPlayingBeforeScrubRef.current = isPlayingRef.current;
    setIsScrubbing(true);
    if (isPlayingRef.current) {
      setIsPlaying(false);
      videoRef.current?.pause();
    }
  }, []);
  const handleScrubEnd = useCallback((ms: number) => {
    const sec = Math.max(0, ms / 1000);
    videoRef.current?.seekTo?.(sec);
    positionRef.current = sec;
    setPositionSec(sec);
    setIsScrubbing(false);
    if (wasPlayingBeforeScrubRef.current) {
      setIsPlaying(true);
      videoRef.current?.play();
    }
  }, []);

  const handleSeekRelative = useCallback(
    (seconds: number) => {
      seekBy(seconds);
    },
    [seekBy],
  );

  // Stop cleanly when leaving the screen (+ final watch-state save).
  useEffect(() => {
    const sub = navigation.addListener("beforeRemove", () => {
      if (watchKey) {
        saveStremioWatchState(
          watchKey,
          positionRef.current,
          durationRef.current,
        );
      }
      videoRef.current?.pause();
    });
    return sub;
  }, [navigation, watchKey]);

  const rewindTime = settings.rewindSkipTime ?? 10;
  const forwardTime = settings.forwardSkipTime ?? 30;
  const showSubtitleNav = selectedSubId !== -1 || externalSub !== null;

  if (!url) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>No stream URL.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <MpvPlayerView
        ref={videoRef}
        source={videoSource}
        style={{ width: "100%", height: "100%" }}
        nowPlayingMetadata={{ title: title || "Stremio" }}
        onProgress={onProgress}
        onSubtitleText={onSubtitleText}
        onPlaybackStateChange={onPlaybackStateChange}
        // LEGACY (pre-v3 binaries only): window-level two-finger seam. On v3
        // binaries this never fires — the GestureOverlay's native surface owns it.
        onTwoFingerTap={() => {
          if (!(settings.yomifinTwoFingerTapPause ?? true)) return;
          suppressTaps();
          togglePlay();
          setTwoFingerNonce((n) => n + 1);
        }}
        onTracksReady={refreshTracks}
        onError={(e) => {
          console.error("[STREMIO] video error:", e.nativeEvent);
          setError(e.nativeEvent?.error ?? "Playback failed");
        }}
      />

      {/* Gesture layer (below the yomifin overlay/popup z-indices, below the control
          bars): taps via the native gesture surface, drag-to-seek / volume /
          brightness via the RNGH worklet pan. No dim — matches the reworked Jellyfin
          player (ControlsScrims instead). Replaces the old bare Pressable. */}
      <GestureOverlay
        screenWidth={screenWidth}
        screenHeight={screenHeight}
        showControls={showControls}
        isPlaying={isPlaying}
        onToggleControls={() => setShowControls((s) => !s)}
        twoFingerNonce={twoFingerNonce}
        onSeekRelative={handleSeekRelative}
        onSkipForward={() => seekBy(forwardTime)}
        onSkipBackward={() => seekBy(-rewindTime)}
        onTogglePlay={togglePlay}
        progress={progressSV}
        max={maxSV}
        isSeeking={isSeekingSV}
        onScrubStart={handleScrubStart}
        onScrubEnd={handleScrubEnd}
      />

      {/* Unified senplayer-style control pane (matches the Jellyfin player). */}
      <StremioPlayerControls
        showControls={showControls}
        isPlaying={isPlaying}
        isBuffering={isBuffering && !error}
        title={title || "Stremio stream"}
        positionSec={positionSec}
        durationSec={durationSec}
        progress={progressSV}
        max={maxSV}
        min={minSV}
        cacheProgress={cacheProgressSV}
        isScrubbing={isScrubbing}
        onClose={() => navigation.goBack()}
        onTogglePlay={togglePlay}
        onSkipBackward={() => seekBy(-rewindTime)}
        onSkipForward={() => seekBy(forwardTime)}
        rewindSeconds={rewindTime}
        forwardSeconds={forwardTime}
        onSliderStart={handleSliderStart}
        onSliderComplete={handleSliderComplete}
        playbackSpeed={playbackSpeed}
        onSetSpeed={setSpeed}
        subTracks={subTracks}
        selectedSubId={selectedSubId}
        externalSubActive={externalSub !== null}
        externalSubName={externalSub?.name ?? null}
        isTextSubCodec={isTextSubCodec}
        onSelectSubtitle={selectSubTrack}
        onOnlineSubtitles={() => setOnlineSubsVisible(true)}
        jimakuEnabled={Boolean(settings.yomifinJimakuApiKey)}
        showSubtitleNav={showSubtitleNav}
        onPrevSubtitle={() => videoRef.current?.subSeek?.(-1)}
        onNextSubtitle={() => videoRef.current?.subSeek?.(1)}
        audioTracks={audioTracks}
        selectedAudioId={selectedAudioId}
        onSelectAudio={selectAudioTrack}
        getTechnicalInfo={() =>
          videoRef.current?.getTechnicalInfo?.() ?? Promise.resolve({})
        }
        profilePill={
          <ProfilePill
            profileKey={
              query || title ? `stremio:${query || title}` : undefined
            }
            languageHint={null}
          />
        }
      />

      {error ? (
        <View style={styles.centerOverlay}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.button} onPress={() => navigation.goBack()}>
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Yomifin: tappable subtitles + lookup + Anki (mining pipeline). */}
      <YomifinErrorBoundary label='stremio-lookup-layer'>
        <YomifinLookupLayer
          text={subtitleText}
          onLookupOpen={lookupOpen}
          onLookupClose={lookupClose}
          popupPosition={settings.yomifinPopupPosition ?? "right"}
          onSnapshotCard={snapshotCard}
          onCaptureMedia={captureMedia}
          languageHint={null}
          profileKey={query || title ? `stremio:${query || title}` : undefined}
          documentTitle={title || "Stremio stream"}
        />
      </YomifinErrorBoundary>

      {/* Online subtitle search (jimaku) + sync panel. */}
      <YomifinErrorBoundary label='stremio-online-subs'>
        <OnlineSubtitlesModal
          visible={onlineSubsVisible}
          onClose={() => setOnlineSubsVisible(false)}
          defaultQuery={query || title || ""}
          defaultEpisode={
            episode && /^\d+$/.test(episode) ? Number(episode) : undefined
          }
          anilistId={
            anilistId && /^\d+$/.test(anilistId) ? Number(anilistId) : undefined
          }
          activeSubName={externalSub?.name ?? null}
          activeCueCount={externalSub?.cues.length ?? 0}
          delayMs={subDelayMs}
          onDelayChange={handleSubDelayChange}
          onAutoSync={handleAutoSync}
          onSubtitleLoaded={handleOnlineSubtitleLoaded}
        />
      </YomifinErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: "black",
    alignItems: "center",
    justifyContent: "center",
  },
  centerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    color: "#f87171",
    fontSize: 15,
    textAlign: "center",
    margin: 16,
  },
  button: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  buttonText: { color: "#fff", fontSize: 15 },
});
