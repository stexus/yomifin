/*
 * Minimal Stremio player (FEATURES.md backlog item 1, MVP cut).
 *
 * Plays a debrid-resolved / plain-HTTP stream URL with the full yomifin mining
 * pipeline mounted on top: mpv-driven tappable subtitles → lookup popup → Anki
 * card with on-device audio+image capture (capture source = the playing URL,
 * which is range-seekable for debrid links).
 *
 * Deliberately NOT threaded through direct-player.tsx (no Jellyfin item, no
 * session reporting) — this is a separate, self-contained route taking
 * { url, title, subtitleUrls } params. Controls are minimal on purpose.
 */
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
import {
  cleanSubtitleOverlayText,
  parseSubtitleText,
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

  const { url, title, subtitleUrls } = useLocalSearchParams<{
    url: string;
    title?: string;
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

  const mediaId = useMemo(() => `stremio_${fnv1a(url ?? "")}`, [url]);

  useEffect(() => {
    activateKeepAwakeAsync();
    return () => {
      deactivateKeepAwake();
    };
  }, []);

  // Reset the cue store for this playback; fill it from the FIRST external
  // subtitle URL if one was provided (multi-sentence cards). Embedded-only subs
  // degrade to the single live cue — already handled downstream.
  useEffect(() => {
    setYomifinCues([]);
    setYomifinCueRange(null);
    const first = externalSubUrls[0];
    if (!first) return;
    let cancelled = false;
    fetch(first)
      .then((r) => r.text())
      .then((text) => {
        if (cancelled) return;
        const cues = parseSubtitleText(first, text);
        console.log(`[STREMIO] cue store: ${cues.length} cues from ${first}`);
        setYomifinCues(cues);
      })
      .catch((e) =>
        console.warn(`[STREMIO] external sub fetch failed: ${e.message}`),
      );
    return () => {
      cancelled = true;
    };
  }, [externalSubUrls, setYomifinCues, setYomifinCueRange]);

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
    [subTracks],
  );

  const onSubtitleText = useCallback(
    (e: { nativeEvent: { text: string; start?: number; end?: number } }) => {
      setSubtitleText(cleanSubtitleOverlayText(e.nativeEvent?.text ?? ""));
      cueRef.current = {
        start: e.nativeEvent?.start ?? 0,
        end: e.nativeEvent?.end ?? 0,
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
              <Text style={styles.buttonText}>✕</Text>
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
              <Text style={styles.buttonText}>CC</Text>
            </Pressable>
          </View>

          {/* Bottom bar */}
          <View
            style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}
          >
            <View style={styles.transportRow}>
              <Pressable
                onPress={() => videoRef.current?.subSeek?.(-1)}
                hitSlop={10}
              >
                <Text style={styles.transportText}>|◂</Text>
              </Pressable>
              <Pressable onPress={() => seekBy(-10)} hitSlop={10}>
                <Text style={styles.transportText}>-10</Text>
              </Pressable>
              <Pressable onPress={togglePlay} hitSlop={14}>
                <Text style={styles.playText}>{isPlaying ? "⏸" : "▶"}</Text>
              </Pressable>
              <Pressable onPress={() => seekBy(10)} hitSlop={10}>
                <Text style={styles.transportText}>+10</Text>
              </Pressable>
              <Pressable
                onPress={() => videoRef.current?.subSeek?.(1)}
                hitSlop={10}
              >
                <Text style={styles.transportText}>▸|</Text>
              </Pressable>
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
                selectedSubId === -1 && styles.subMenuSelected,
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
                  selectedSubId === t.id && styles.subMenuSelected,
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
          documentTitle={title || "Stremio stream"}
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
    gap: 28,
    marginBottom: 8,
  },
  transportText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  playText: { color: "#fff", fontSize: 30 },
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
  subMenuText: { color: "#ddd", fontSize: 14 },
  subMenuSelected: { color: "#a855f7", fontWeight: "700" },
});
