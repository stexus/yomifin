/*
 * Yozora player (migration plan Phase 3): plays a server-resolved debrid CDN
 * URL with the full yomifin mining pipeline mounted on top (mpv-driven
 * tappable subtitles → lookup popup → Anki card with on-device audio+image
 * capture; capture source = the playing URL, which is range-seekable).
 *
 * Differences from the legacy addon-era player it replaced:
 *  - PRG-1 progress ticks to the Yozora server: every ~15s while playing +
 *    immediately on pause/seek and on leave (stopped/ended). Fire-and-forget —
 *    a lost tick is not an error state. Server semantics decide resumable/
 *    watched (<5% / ≥85%), replacing the local MMKV watch state entirely.
 *  - Resume position comes in as a param (server progress, read by the caller).
 *  - SHIM-7 analog: on an mpv error with a near/past expires_at, POST /resolve
 *    again (same info_hash) and reload at the last position instead of dying.
 *
 * Identity params: { titleKey, episode } (canonical). jimaku gets the raw
 * AniList id derived from an anilist:{id} titleKey + the romaji `query`.
 */
import { useQueryClient } from "@tanstack/react-query";
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
import { GestureOverlay } from "@/components/video-player/controls/GestureOverlay";
import { suppressTaps } from "@/components/video-player/controls/tapSuppression";
import OnlineSubtitlesModal, {
  type LoadedOnlineSubtitle,
  type ServerSubtitleSource,
} from "@/components/yomifin/OnlineSubtitlesModal";
import ProfilePill from "@/components/yomifin/ProfilePill";
import YomifinErrorBoundary from "@/components/yomifin/YomifinErrorBoundary";
import YomifinLookupLayer from "@/components/yomifin/YomifinLookupLayer";
import YozoraPlayerControls from "@/components/yozora/YozoraPlayerControls";
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
  type CaptureContext,
  captureCardMedia,
  type MediaWant,
} from "@/utils/yomifin/ankiMedia";
import { fnv1a } from "@/utils/yomifin/mediaKey";
import type { SubtitleCue } from "@/utils/yomifin/srt";
import {
  cleanSubtitleOverlayText,
  shiftCues,
} from "@/utils/yomifin/subtitleParse";
import { parseTitleKey } from "@/utils/yozora/display";
import { useYozora } from "@/utils/yozora/session";
import type { TickState } from "@/utils/yozora/types";

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

const TICK_INTERVAL_MS = 15_000;

export default function YozoraPlayerPage() {
  const videoRef = useRef<MpvPlayerViewRef>(null);
  const navigation = useNavigation();
  const { settings } = useSettings();
  const { client, connected } = useYozora();
  const queryClient = useQueryClient();

  const {
    url,
    expiresAt,
    infoHash,
    titleKey,
    episode,
    title,
    query,
    startPosition,
  } = useLocalSearchParams<{
    url: string;
    /** ISO expiry of the resolved CDN URL ("" = unknown). */
    expiresAt?: string;
    /** infoHash of the resolved source (re-resolve on expiry). */
    infoHash?: string;
    /** Canonical title_key (progress identity; anilist:{id} feeds jimaku). */
    titleKey?: string;
    /** Canonical episode encoding ("12" / "2:5"); "" for movies. */
    episode?: string;
    title?: string;
    /** Bare series/movie name (jimaku search prefill; falls back to title). */
    query?: string;
    /** Server resume position in seconds ("" = from the start). */
    startPosition?: string;
  }>();

  const anilistId = useMemo(
    () => (titleKey ? parseTitleKey(titleKey).anilistId : null),
    [titleKey],
  );
  const episodeNumber =
    episode && /^\d+$/.test(episode) ? Number(episode) : undefined;

  // Re-resolve on expiry swaps the URL; resume position rides along.
  const [playUrl, setPlayUrl] = useState(url ?? "");
  const [resumeAt, setResumeAt] = useState(() => {
    const n = Number(startPosition);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const expiresAtRef = useRef<string | null>(expiresAt || null);
  const reResolvingRef = useRef(false);

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
  const durationRef = useRef(0);
  const setYomifinCues = useSetAtom(yomifinCuesAtom);
  const setYomifinCueRange = useSetAtom(yomifinCueRangeAtom);

  // Online subs (jimaku): when active, the external track owns the cue store
  // (cues shifted into the VIDEO timeline by the sync delay). Yozora sources
  // carry no addon subtitle sidecars, so there is no auto-sync reference —
  // manual nudges only (server-side alass sync is the Phase 5 replacement).
  const [onlineSubsVisible, setOnlineSubsVisible] = useState(false);
  const [externalSub, setExternalSub] = useState<LoadedOnlineSubtitle | null>(
    null,
  );
  const [subDelayMs, setSubDelayMs] = useState(0);
  const externalSubRef = useRef<LoadedOnlineSubtitle | null>(null);
  const subDelayMsRef = useRef(0);
  const referenceCuesRef = useRef<SubtitleCue[]>([]);

  // Anki media key: stable content identity (title_key+episode), not the
  // per-resolve CDN URL.
  const mediaId = useMemo(
    () => `yozora_${fnv1a(`${titleKey ?? playUrl}:${episode ?? ""}`)}`,
    [titleKey, episode, playUrl],
  );

  useEffect(() => {
    activateKeepAwakeAsync();
    return () => {
      deactivateKeepAwake();
    };
  }, []);

  // Reset the cue store for this playback (multi-sentence cards fill from the
  // jimaku online sub when one is loaded; embedded-only degrades to live cue).
  useEffect(() => {
    setYomifinCues([]);
    setYomifinCueRange(null);
    referenceCuesRef.current = [];
  }, [setYomifinCues, setYomifinCueRange]);

  // Publish the online sub's cues (shifted into the VIDEO timeline) + refs.
  useEffect(() => {
    externalSubRef.current = externalSub;
    subDelayMsRef.current = subDelayMs;
    if (externalSub) {
      setYomifinCues(shiftCues(externalSub.cues, subDelayMs));
    }
  }, [externalSub, subDelayMs, setYomifinCues]);

  // ── PRG-1 progress ticks ──────────────────────────────────────────────────
  const isPlayingRef = useRef(false);
  const canTick = connected && !!titleKey;
  const sendTick = useCallback(
    (state: TickState) => {
      if (!canTick) return;
      const duration = Math.floor(durationRef.current);
      if (duration <= 0) return;
      client
        .progressTick({
          title_key: titleKey as string,
          episode: episode || undefined,
          position_sec: Math.max(0, Math.floor(positionRef.current)),
          duration_sec: duration,
          state,
        })
        .catch((e) =>
          // Offline swallow — a lost tick is not an error state.
          console.log(
            `[YOZORA] tick (${state}) failed: ${(e as Error).message}`,
          ),
        );
    },
    [canTick, client, titleKey, episode],
  );
  const sendTickRef = useRef(sendTick);
  useEffect(() => {
    sendTickRef.current = sendTick;
  }, [sendTick]);

  // Periodic playing ticks (~15s wall time while actually playing).
  useEffect(() => {
    if (!canTick) return;
    const id = setInterval(() => {
      if (isPlayingRef.current) sendTickRef.current("playing");
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [canTick]);

  const videoSource = useMemo<MpvVideoSource | undefined>(() => {
    if (!playUrl) return undefined;
    return {
      url: playUrl,
      autoplay: true,
      startPosition: resumeAt,
      cacheConfig: {
        enabled: settings.mpvCacheEnabled,
        cacheSeconds: settings.mpvCacheSeconds,
        maxBytes: settings.mpvDemuxerMaxBytes,
        maxBackBytes: settings.mpvDemuxerMaxBackBytes,
      },
      voDriver: settings.mpvVoDriver,
    };
  }, [
    playUrl,
    resumeAt,
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
        "[YOZORA] sub tracks:",
        tracks.map(
          (t) =>
            `#${t.id} ${t.lang ?? "?"} "${t.title ?? ""}" ${t.selected ? "*SEL" : ""} ${t.codec ?? ""}`,
        ),
      );
    } catch (e) {
      console.warn(`[YOZORA] track refresh failed: ${e}`);
    }
    try {
      const audio = (await v.getAudioTracks?.()) ?? [];
      setAudioTracks(audio);
      const selAudio = audio.find((t) => t.selected);
      setSelectedAudioId(selAudio?.id ?? -1);
    } catch (e) {
      console.warn(`[YOZORA] audio track refresh failed: ${e}`);
    }
  }, []);

  const selectAudioTrack = useCallback(async (trackId: number) => {
    const v = videoRef.current;
    if (!v) return;
    setSelectedAudioId(trackId);
    try {
      await v.setAudioTrack?.(trackId);
    } catch (e) {
      console.warn(`[YOZORA] audio track select failed: ${e}`);
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
          `[YOZORA] failed to load online sub into mpv: ${(e as Error).message}`,
        );
        throw e;
      }
      setSubDelayMs(0);
      setExternalSub(sub);
      setYomifinCueRange(null);
      refreshTracks();
      console.log(
        `[YOZORA] online subtitle active: "${sub.name}" (${sub.cues.length} cues)`,
      );
    },
    [setYomifinCueRange, refreshTracks],
  );

  const handleSubDelayChange = useCallback((ms: number) => {
    setSubDelayMs(ms);
    videoRef.current?.setSubtitleDelay?.(ms / 1000).catch(() => {});
  }, []);

  // No addon-provided reference subs exist on Yozora streams → no auto-sync
  // estimate; the modal falls back to manual nudges + the SERVER-side sync.
  const handleAutoSync = useCallback(() => null, []);

  // Phase 5: server-cached subtitles (SUB-1) + one-tap alass sync (SUB-6).
  // langs "ja,en": yomifin mines Japanese, but en rows are useful comparisons;
  // the server would otherwise default to the account's preferred_langs.
  const serverSubs = useMemo<ServerSubtitleSource | null>(() => {
    if (!connected || !titleKey) return null;
    return {
      label: "Yozora server",
      list: async (q) => {
        const res = await client.subtitles(titleKey, {
          episode: episode || undefined,
          langs: "ja,en",
          q,
        });
        return res.items.map((s) => ({
          id: s.id,
          provider: s.provider,
          lang: s.lang,
          name: s.name,
        }));
      },
      download: (row) => client.subtitleContent(row.id),
      // stream_url = the resolved CDN URL so alass re-times against the EXACT
      // file playing (SUB-6); the server extracts its own reference (SUB-7).
      sync: async (id) => {
        const synced = await client.syncSubtitle(id, playUrl || undefined);
        return {
          id: synced.id,
          provider: synced.provider,
          lang: synced.lang,
          name: synced.name,
        };
      },
    };
  }, [connected, titleKey, episode, client, playUrl]);

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
    },
    [progressSV, maxSV, isSeekingSV],
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
      sendTickRef.current("paused");
    } else {
      videoRef.current?.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const seekBy = useCallback((delta: number) => {
    videoRef.current?.seekBy?.(delta);
    // Position ref updates on the next onProgress; nudge it so the tick is honest.
    positionRef.current = Math.max(0, positionRef.current + delta);
    sendTickRef.current("seeked");
  }, []);

  const setSpeed = useCallback((next: number) => {
    setPlaybackSpeed(next);
    videoRef.current?.setSpeed(next).catch(() => {});
  }, []);

  // Pause-on-lookup (same contract as direct-player).
  const pausedByLookupRef = useRef(false);
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
      return captureCardMedia(v, ctx, mediaId, playUrl ?? "", want);
    },
    [mediaId, playUrl],
  );

  // Interactive slider: pause during, seek + resume on release.
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
      sendTickRef.current("seeked");
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
    sendTickRef.current("seeked");
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

  // SHIM-7 analog: an mpv error with a near/past expires_at → re-resolve the
  // SAME info_hash and reload at the last position instead of dying.
  const onVideoError = useCallback(
    (e: { nativeEvent?: { error?: string } }) => {
      console.error("[YOZORA] video error:", e.nativeEvent);
      const canReResolve =
        connected &&
        !!titleKey &&
        !!infoHash &&
        !reResolvingRef.current &&
        (() => {
          const exp = expiresAtRef.current;
          if (!exp) return true; // unknown expiry — worth one retry
          const ms = new Date(exp).getTime() - Date.now();
          return Number.isNaN(ms) || ms < 5 * 60 * 1000;
        })();
      if (!canReResolve) {
        setError(e.nativeEvent?.error ?? "Playback failed");
        return;
      }
      reResolvingRef.current = true;
      setIsBuffering(true);
      console.log("[YOZORA] URL likely expired — re-resolving…");
      client
        .resolve({
          title_key: titleKey as string,
          episode: episode || undefined,
          info_hash: infoHash,
        })
        .then((res) => {
          expiresAtRef.current = res.expires_at;
          setResumeAt(Math.floor(positionRef.current));
          setPlayUrl(res.url);
          setError(null);
          console.log("[YOZORA] re-resolved; resuming at", positionRef.current);
        })
        .catch((err) => {
          console.warn(`[YOZORA] re-resolve failed: ${err}`);
          setError(e.nativeEvent?.error ?? "Playback failed");
        })
        .finally(() => {
          // Allow one more attempt only after a fresh URL played for a while.
          setTimeout(() => {
            reResolvingRef.current = false;
          }, 30_000);
        });
    },
    [connected, titleKey, episode, infoHash, client],
  );

  // Stop cleanly when leaving the screen (+ final stopped/ended tick), then
  // invalidate the Yozora queries so CW rail / detail progress reflect the new
  // position (small delay so the final tick lands server-side first).
  useEffect(() => {
    const sub = navigation.addListener("beforeRemove", () => {
      const dur = durationRef.current;
      const nearEnd = dur > 0 && positionRef.current / dur >= 0.97;
      sendTickRef.current(nearEnd ? "ended" : "stopped");
      videoRef.current?.pause();
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["yozora", "progress"] });
        queryClient.invalidateQueries({
          queryKey: ["yozora", "continue-watching"],
        });
        queryClient.invalidateQueries({ queryKey: ["yozora", "library"] });
      }, 1200);
    });
    return sub;
  }, [navigation, queryClient]);

  const rewindTime = settings.rewindSkipTime ?? 10;
  const forwardTime = settings.forwardSkipTime ?? 30;
  const showSubtitleNav = selectedSubId !== -1 || externalSub !== null;

  if (!playUrl) {
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
        nowPlayingMetadata={{ title: title || "Yozora" }}
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
        onError={onVideoError}
      />

      {/* Gesture layer (below the yomifin overlay/popup z-indices, below the
          control bars): taps via the native gesture surface, drag-to-seek /
          volume / brightness via the RNGH worklet pan. */}
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
      <YozoraPlayerControls
        showControls={showControls}
        isPlaying={isPlaying}
        isBuffering={isBuffering && !error}
        title={title || "Yozora stream"}
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
        onlineSubtitlesEnabled={Boolean(
          serverSubs || settings.yomifinJimakuApiKey,
        )}
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
            profileKey={query || title ? `yozora:${query || title}` : undefined}
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
      <YomifinErrorBoundary label='yozora-lookup-layer'>
        <YomifinLookupLayer
          text={subtitleText}
          onLookupOpen={lookupOpen}
          onLookupClose={lookupClose}
          popupPosition={settings.yomifinPopupPosition ?? "right"}
          onSnapshotCard={snapshotCard}
          onCaptureMedia={captureMedia}
          languageHint={null}
          profileKey={query || title ? `yozora:${query || title}` : undefined}
          documentTitle={title || "Yozora stream"}
        />
      </YomifinErrorBoundary>

      {/* Online subtitle search (jimaku) + sync panel. */}
      <YomifinErrorBoundary label='yozora-online-subs'>
        <OnlineSubtitlesModal
          visible={onlineSubsVisible}
          onClose={() => setOnlineSubsVisible(false)}
          defaultQuery={query || title || ""}
          defaultEpisode={episodeNumber}
          anilistId={anilistId ?? undefined}
          activeSubName={externalSub?.name ?? null}
          activeCueCount={externalSub?.cues.length ?? 0}
          delayMs={subDelayMs}
          onDelayChange={handleSubDelayChange}
          onAutoSync={handleAutoSync}
          onSubtitleLoaded={handleOnlineSubtitleLoaded}
          serverSubs={serverSubs}
          activeServerId={externalSub?.serverId ?? null}
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
