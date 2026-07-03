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
 */
import { Ionicons } from "@expo/vector-icons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import OnlineSubtitlesModal, {
  type LoadedOnlineSubtitle,
} from "@/components/yomifin/OnlineSubtitlesModal";
import YomifinErrorBoundary from "@/components/yomifin/YomifinErrorBoundary";
import YomifinLookupLayer from "@/components/yomifin/YomifinLookupLayer";
import {
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

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export default function StremioPlayerPage() {
  const videoRef = useRef<MpvPlayerViewRef>(null);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
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
  const [showSubMenu, setShowSubMenu] = useState(false);

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
      startPosition: 0,
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
  }, []);

  const selectSubTrack = useCallback(
    async (trackId: number) => {
      const v = videoRef.current;
      setShowSubMenu(false);
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
      setIsBuffering(false);
      setPositionSec((prev) =>
        Math.abs(prev - position) >= 1 ? position : prev,
      );
      setDurationSec((prev) =>
        Math.abs(prev - (duration ?? 0)) >= 1 ? (duration ?? 0) : prev,
      );
    },
    [],
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

  // Stop cleanly when leaving the screen.
  useEffect(() => {
    const sub = navigation.addListener("beforeRemove", () => {
      videoRef.current?.pause();
    });
    return sub;
  }, [navigation]);

  const [seekBarWidth, setSeekBarWidth] = useState(1);

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
        onTwoFingerTap={() => {
          if (!(settings.yomifinTwoFingerTapPause ?? true)) return;
          togglePlay();
        }}
        onTracksReady={refreshTracks}
        onError={(e) => {
          console.error("[STREMIO] video error:", e.nativeEvent);
          setError(e.nativeEvent?.error ?? "Playback failed");
        }}
      />

      {/* Controls toggle layer (below the yomifin overlay/popup z-indices). */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => setShowControls((s) => !s)}
      />

      {isBuffering && !error ? (
        <View pointerEvents='none' style={styles.centerOverlay}>
          <ActivityIndicator size='large' color='#fff' />
        </View>
      ) : null}
      {error ? (
        <View style={styles.centerOverlay}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.button} onPress={() => navigation.goBack()}>
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
        </View>
      ) : null}

      {showControls ? (
        <>
          {/* Top bar */}
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <Pressable
              style={styles.roundButton}
              onPress={() => navigation.goBack()}
              hitSlop={12}
            >
              <Ionicons name='close' size={22} color='white' />
            </Pressable>
            <Text style={styles.title} numberOfLines={1}>
              {title || "Stremio stream"}
            </Text>
            <Pressable
              style={styles.roundButton}
              onPress={() => {
                refreshTracks();
                setShowSubMenu((s) => !s);
              }}
              hitSlop={12}
            >
              <Ionicons
                name='chatbox-ellipses-outline'
                size={22}
                color='white'
              />
            </Pressable>
          </View>

          {/* Bottom bar */}
          <View
            style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}
          >
            <View style={styles.transportRow}>
              {showSubtitleNav ? (
                <Pressable
                  onPress={() => videoRef.current?.subSeek?.(-1)}
                  hitSlop={10}
                  accessibilityLabel='Previous subtitle'
                >
                  <View style={styles.subNavPair}>
                    <Ionicons name='caret-back' size={18} color='white' />
                    <Ionicons
                      name='chatbox-ellipses-outline'
                      size={16}
                      color='white'
                    />
                  </View>
                </Pressable>
              ) : null}
              <Pressable onPress={() => seekBy(-rewindTime)} hitSlop={10}>
                <View style={styles.skipWrap}>
                  <Ionicons
                    name='refresh-outline'
                    size={34}
                    color='white'
                    style={{
                      transform: [{ scaleY: -1 }, { rotate: "180deg" }],
                    }}
                  />
                  <Text style={styles.skipText}>{rewindTime}</Text>
                </View>
              </Pressable>
              <Pressable onPress={togglePlay} hitSlop={14}>
                <Ionicons
                  name={isPlaying ? "pause" : "play"}
                  size={40}
                  color='white'
                />
              </Pressable>
              <Pressable onPress={() => seekBy(forwardTime)} hitSlop={10}>
                <View style={styles.skipWrap}>
                  <Ionicons name='refresh-outline' size={34} color='white' />
                  <Text style={styles.skipText}>{forwardTime}</Text>
                </View>
              </Pressable>
              {showSubtitleNav ? (
                <Pressable
                  onPress={() => videoRef.current?.subSeek?.(1)}
                  hitSlop={10}
                  accessibilityLabel='Next subtitle'
                >
                  <View style={styles.subNavPair}>
                    <Ionicons
                      name='chatbox-ellipses-outline'
                      size={16}
                      color='white'
                    />
                    <Ionicons name='caret-forward' size={18} color='white' />
                  </View>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.seekRow}>
              <Text style={styles.timeText}>{fmtTime(positionSec)}</Text>
              <Pressable
                style={styles.seekBar}
                onLayout={(e) => setSeekBarWidth(e.nativeEvent.layout.width)}
                onPress={(e) => {
                  if (durationSec <= 0) return;
                  const frac = Math.min(
                    1,
                    Math.max(0, e.nativeEvent.locationX / seekBarWidth),
                  );
                  videoRef.current?.seekTo?.(frac * durationSec);
                }}
              >
                <View style={styles.seekTrack}>
                  <View
                    style={[
                      styles.seekFill,
                      {
                        width: `${
                          durationSec > 0
                            ? Math.min(100, (positionSec / durationSec) * 100)
                            : 0
                        }%`,
                      },
                    ]}
                  />
                </View>
              </Pressable>
              <Text style={styles.timeText}>{fmtTime(durationSec)}</Text>
            </View>
          </View>
        </>
      ) : null}

      {/* Subtitle track menu */}
      {showSubMenu ? (
        <View style={[styles.subMenu, { top: insets.top + 56 }]}>
          <Pressable
            style={styles.subMenuRow}
            onPress={() => selectSubTrack(-1)}
          >
            <Text
              style={[
                styles.subMenuText,
                selectedSubId === -1 && !externalSub && styles.subMenuSelected,
              ]}
            >
              Subtitles off
            </Text>
          </Pressable>
          {subTracks.map((t) => (
            <Pressable
              key={t.id}
              style={styles.subMenuRow}
              onPress={() => selectSubTrack(t.id)}
            >
              <Text
                style={[
                  styles.subMenuText,
                  selectedSubId === t.id &&
                    !externalSub &&
                    styles.subMenuSelected,
                ]}
                numberOfLines={1}
              >
                #{t.id} {t.lang ?? "?"} {t.title ?? ""}{" "}
                {isTextSubCodec(t.codec) ? "" : "(bitmap)"}
              </Text>
            </Pressable>
          ))}
          {subTracks.length === 0 ? (
            <Text style={styles.subMenuText}>No subtitle tracks</Text>
          ) : null}
          {settings.yomifinJimakuApiKey ? (
            <Pressable
              style={[styles.subMenuRow, styles.subMenuDivider]}
              onPress={() => {
                setShowSubMenu(false);
                setOnlineSubsVisible(true);
              }}
            >
              <Text
                style={[
                  styles.subMenuText,
                  externalSub && styles.subMenuSelected,
                ]}
                numberOfLines={1}
              >
                {externalSub
                  ? `Online: ${externalSub.name}`
                  : "Online subtitles (jimaku)…"}
              </Text>
            </Pressable>
          ) : null}
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
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 12,
  },
  title: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" },
  roundButton: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  buttonText: { color: "#fff", fontSize: 15 },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  transportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 30,
    marginBottom: 8,
  },
  subNavPair: { flexDirection: "row", alignItems: "center" },
  skipWrap: {
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  skipText: {
    position: "absolute",
    color: "white",
    fontSize: 10,
    fontWeight: "bold",
    bottom: 7,
  },
  seekRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timeText: {
    color: "#ddd",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 44,
    textAlign: "center",
  },
  seekBar: { flex: 1, paddingVertical: 10 },
  seekTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    overflow: "hidden",
  },
  seekFill: { height: 4, backgroundColor: "#a855f7" },
  subMenu: {
    position: "absolute",
    right: 16,
    backgroundColor: "rgba(20,20,20,0.95)",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 4,
    maxWidth: 320,
  },
  subMenuRow: { paddingVertical: 8, paddingHorizontal: 12 },
  subMenuDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#444",
    marginTop: 4,
    paddingTop: 10,
  },
  subMenuText: { color: "#ddd", fontSize: 14 },
  subMenuSelected: { color: "#a855f7", fontWeight: "700" },
});
