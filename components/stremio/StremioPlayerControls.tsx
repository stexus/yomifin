/*
 * StremioPlayerControls — senplayer-style control pane for the Stremio player,
 * visually unified with the reworked Jellyfin player (see FEATURES "Player UI
 * rework"). It is a SELF-CONTAINED presentational component: it takes plain props
 * (no Jellyfin PlayerContext/VideoContext), so the two players share a look without
 * the risky shared-wiring extraction (FEATURES backlog §1).
 *
 * Layout, top → bottom:
 *   - custom OSD status bar (clock + battery; expands to date/wifi/throughput +
 *     centered title when the controls are up) — mounted outside the fade.
 *   - top/bottom scrims (ControlsScrims, reused from the Jellyfin side).
 *   - header row: ⋯ menu (speed) + profile pill (left) · close (right).
 *   - a read-only scrub bar that pops when drag-seeking with controls hidden.
 *   - bottom pane: subtitle/audio pickers (left) + subtitle-cue nav, a sleek
 *     progress slider flanked by fixed-width time columns, and a transport cluster
 *     below (skip-back / prev-cue / play-pause / next-cue / skip-forward).
 */
import { Ionicons } from "@expo/vector-icons";
import { type FC, memo, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Slider } from "react-native-awesome-slider";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/common/Text";
import { Loader } from "@/components/Loader";
import {
  type OptionGroup,
  PlatformDropdown,
} from "@/components/PlatformDropdown";
import { PLAYBACK_SPEEDS } from "@/components/PlaybackSpeedSelector";
import { ControlsScrims } from "@/components/video-player/controls/ControlsScrims";
import { useSystemStatus } from "@/components/video-player/controls/hooks/useSystemStatus";
import { ScrubProgressBar } from "@/components/video-player/controls/ScrubProgressBar";
import { useControlsSafeAreaInsets } from "@/hooks/useControlsSafeAreaInsets";
import type { MpvAudioTrack, MpvSubtitleTrack } from "@/modules";
import type { TechnicalInfo } from "@/modules/mpv-player";
import { useSettings } from "@/utils/atoms/settings";

// Tappable-overlay styling steps (same values + settings keys as the Jellyfin
// DropdownView, so the mid-playback subtitle knobs match across both players).
const OVERLAY_FONT_STEPS = [24, 28, 32, 38, 44] as const;
const OVERLAY_WEIGHT_STEPS = [
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
] as const;
const OVERLAY_OUTLINE_STEPS = ["none", "thin", "normal", "strong"] as const;
const OVERLAY_OFFSET_STEPS = [24, 48, 64, 96, 128] as const;

const ICON = "white";

const TEXT_SHADOW = {
  textShadowColor: "rgba(0,0,0,0.85)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

function batteryIcon(
  level: number | null,
  charging: boolean,
): keyof typeof Ionicons.glyphMap {
  if (charging) return "battery-charging";
  if (level == null) return "battery-half";
  if (level <= 0.1) return "battery-dead";
  if (level >= 0.95) return "battery-full";
  return "battery-half";
}

function netIcon(netType: string): keyof typeof Ionicons.glyphMap {
  if (netType === "wifi") return "wifi";
  if (netType === "cellular") return "cellular";
  if (netType === "none") return "cloud-offline";
  return "globe-outline";
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

// ── Status bar (mirrors PlayerStatusBar; takes a plain title string) ──────────
const StatusBar: FC<{
  title: string;
  showControls: boolean;
  getTechnicalInfo?: () => Promise<TechnicalInfo>;
}> = ({ title, showControls, getTechnicalInfo }) => {
  const { settings } = useSettings();
  const insets = useControlsSafeAreaInsets();

  const showNetwork = settings.playerStatusShowNetwork || showControls;
  const {
    clock,
    date,
    batteryLevel,
    batteryCharging,
    netType,
    throughputKbps,
  } = useSystemStatus({
    hour12: settings.playerClock12Hour ?? true,
    needsThroughput: showNetwork,
    getTechnicalInfo,
  });

  const persistent = settings.playerStatusBarDuringPlayback ?? true;
  const showClock =
    showControls || (persistent && settings.playerStatusShowClock);
  const showDate =
    showControls || (persistent && settings.playerStatusShowDate);
  const showBattery =
    showControls || (persistent && settings.playerStatusShowBattery);
  const showWifi =
    showControls || (persistent && settings.playerStatusShowWifi);
  const showThroughput =
    showControls || (persistent && settings.playerStatusShowNetwork);

  const targetOpacity = showControls ? 1 : 0.55;
  const opacity = useSharedValue(targetOpacity);
  opacity.value = withTiming(targetOpacity, { duration: 250 });
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const anyLeft = showClock || showDate;
  const anyRight = showWifi || showThroughput || showBattery;

  if (!showControls && !persistent) return null;
  if (!anyLeft && !anyRight && !showControls) return null;

  const throughputText =
    throughputKbps != null
      ? throughputKbps >= 1024
        ? `${(throughputKbps / 1024).toFixed(1)} MB/s`
        : `${Math.round(throughputKbps)} KB/s`
      : null;

  return (
    <View
      pointerEvents='none'
      style={[
        statusStyles.container,
        { top: insets.top, left: insets.left + 12, right: insets.right + 12 },
      ]}
    >
      <Animated.View style={[statusStyles.row, fadeStyle]}>
        <View style={statusStyles.side}>
          {showClock ? (
            <Text style={[statusStyles.clock, TEXT_SHADOW]}>{clock}</Text>
          ) : null}
          {showDate ? (
            <Text style={[statusStyles.date, TEXT_SHADOW]}>{date}</Text>
          ) : null}
        </View>
        <View style={statusStyles.center}>
          {showControls && title ? (
            <Text numberOfLines={1} style={[statusStyles.title, TEXT_SHADOW]}>
              {title}
            </Text>
          ) : null}
        </View>
        <View style={[statusStyles.side, statusStyles.sideRight]}>
          {showWifi ? (
            <Ionicons name={netIcon(netType)} size={15} color='white' />
          ) : null}
          {showThroughput && throughputText ? (
            <Text style={[statusStyles.meta, TEXT_SHADOW]}>
              {throughputText}
            </Text>
          ) : null}
          {showBattery ? (
            <View style={statusStyles.battery}>
              {batteryLevel != null ? (
                <Text style={[statusStyles.meta, TEXT_SHADOW]}>
                  {Math.round(batteryLevel * 100)}%
                </Text>
              ) : null}
              <Ionicons
                name={batteryIcon(batteryLevel, batteryCharging)}
                size={18}
                color='white'
              />
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
};

// ── Dropdown wrapper (subtitles / audio / menu) built on PlatformDropdown ─────
// memo'd: the controls re-render every second as the clock/position ticks, and the
// @expo/ui SwiftUI Menu host underneath crashes if re-rendered that often (the same
// bug fixed on the Jellyfin side by memo(DropdownView)). `groups` is memoized by the
// parent so this only re-renders when the track lists / selection actually change.
const PickerDropdown: FC<{
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  size?: number;
  groups: OptionGroup[];
}> = memo(({ title, icon, size = 20, groups }) => {
  const trigger = useMemo(
    () => (
      <View className='aspect-square flex flex-col rounded-xl items-center justify-center p-2'>
        <Ionicons name={icon} size={size} color='white' />
      </View>
    ),
    [icon, size],
  );
  if (Platform.isTV) return null;
  if (groups.length === 0) return null;
  return (
    <PlatformDropdown
      title={title}
      groups={groups}
      trigger={trigger}
      expoUIConfig={{}}
      bottomSheetConfig={{ enablePanDownToClose: true }}
    />
  );
});
PickerDropdown.displayName = "PickerDropdown";

export interface StremioPlayerControlsProps {
  showControls: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  title: string;
  positionSec: number;
  durationSec: number;

  // slider shared values (ms)
  progress: SharedValue<number>;
  max: SharedValue<number>;
  min: SharedValue<number>;
  cacheProgress: SharedValue<number>;
  /** Drag-anywhere scrub in flight (pop the read-only bar while controls hidden). */
  isScrubbing: boolean;

  onClose: () => void;
  onTogglePlay: () => void;
  onSkipBackward: () => void;
  onSkipForward: () => void;
  rewindSeconds: number;
  forwardSeconds: number;

  /** Slider drag lifecycle (pause during, seek + resume on release). */
  onSliderStart: () => void;
  onSliderComplete: (ms: number) => void;

  playbackSpeed: number;
  onSetSpeed: (speed: number) => void;

  // subtitles
  subTracks: MpvSubtitleTrack[];
  selectedSubId: number;
  externalSubActive: boolean;
  externalSubName: string | null;
  isTextSubCodec: (codec?: string) => boolean;
  onSelectSubtitle: (id: number) => void;
  onOnlineSubtitles?: () => void;
  jimakuEnabled: boolean;

  // subtitle cue navigation
  showSubtitleNav: boolean;
  onPrevSubtitle: () => void;
  onNextSubtitle: () => void;

  // audio
  audioTracks: MpvAudioTrack[];
  selectedAudioId: number;
  onSelectAudio: (id: number) => void;

  profilePill?: React.ReactNode;
  getTechnicalInfo?: () => Promise<TechnicalInfo>;
}

export const StremioPlayerControls: FC<StremioPlayerControlsProps> = ({
  showControls,
  isPlaying,
  isBuffering,
  title,
  positionSec,
  durationSec,
  progress,
  max,
  min,
  cacheProgress,
  isScrubbing,
  onClose,
  onTogglePlay,
  onSkipBackward,
  onSkipForward,
  rewindSeconds,
  forwardSeconds,
  onSliderStart,
  onSliderComplete,
  playbackSpeed,
  onSetSpeed,
  subTracks,
  selectedSubId,
  externalSubActive,
  externalSubName,
  isTextSubCodec,
  onSelectSubtitle,
  onOnlineSubtitles,
  jimakuEnabled,
  showSubtitleNav,
  onPrevSubtitle,
  onNextSubtitle,
  audioTracks,
  selectedAudioId,
  onSelectAudio,
  profilePill,
  getTechnicalInfo,
}) => {
  const { settings, updateSettings } = useSettings();
  const insets = useControlsSafeAreaInsets();
  // Right-hand time label cycles: 0 = total length, 1 = -remaining, 2 = ends-at.
  const [timeMode, setTimeMode] = useState(0);

  // Fade / slide the header + bottom panes with the controls (matches Jellyfin).
  const controlsOpacity = useSharedValue(showControls ? 1 : 0);
  const headerTranslateY = useSharedValue(showControls ? 0 : -10);
  const bottomTranslateY = useSharedValue(showControls ? 0 : 10);
  const cfg = { duration: 300, easing: Easing.out(Easing.quad) };
  controlsOpacity.value = withTiming(showControls ? 1 : 0, cfg);
  headerTranslateY.value = withTiming(showControls ? 0 : -10, cfg);
  bottomTranslateY.value = withTiming(showControls ? 0 : 10, cfg);

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));
  const bottomAnimatedStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
    transform: [{ translateY: bottomTranslateY.value }],
  }));

  // ── Dropdown option groups ──────────────────────────────────────────────
  const menuGroups = useMemo<OptionGroup[]>(
    () => [
      {
        title: "Speed",
        options: PLAYBACK_SPEEDS.map((speed) => ({
          type: "radio" as const,
          label: speed.label,
          value: speed.value.toString(),
          selected: playbackSpeed === speed.value,
          onPress: () => onSetSpeed(speed.value),
        })),
      },
    ],
    [playbackSpeed, onSetSpeed],
  );

  const subtitleGroups = useMemo<OptionGroup[]>(() => {
    const groups: OptionGroup[] = [];
    groups.push({
      title: "Subtitles",
      options: [
        {
          type: "radio" as const,
          label: "Off",
          value: "-1",
          selected: selectedSubId === -1 && !externalSubActive,
          onPress: () => onSelectSubtitle(-1),
        },
        ...subTracks.map((t) => ({
          type: "radio" as const,
          label:
            `#${t.id} ${t.lang ?? "?"} ${t.title ?? ""}`.trim() +
            (isTextSubCodec(t.codec) ? "" : " (bitmap)"),
          value: t.id.toString(),
          selected: selectedSubId === t.id && !externalSubActive,
          onPress: () => onSelectSubtitle(t.id),
        })),
      ],
    });
    if (jimakuEnabled && onOnlineSubtitles) {
      groups.push({
        options: [
          {
            type: "action" as const,
            label: externalSubActive
              ? `Online: ${externalSubName ?? "subtitle"}`
              : "Online subtitles (jimaku)…",
            onPress: onOnlineSubtitles,
          },
        ],
      });
    }
    // Tappable-overlay styling knobs (same as Jellyfin's subtitle dropdown).
    groups.push({
      title: "Tappable Subs · Text Size",
      options: OVERLAY_FONT_STEPS.map((v) => ({
        type: "radio" as const,
        label: String(v),
        value: String(v),
        selected: (settings.yomifinSubtitleFontSize ?? 32) === v,
        onPress: () => updateSettings({ yomifinSubtitleFontSize: v }),
      })),
    });
    groups.push({
      title: "Tappable Subs · Weight",
      options: OVERLAY_WEIGHT_STEPS.map((w) => ({
        type: "radio" as const,
        label: w.label,
        value: String(w.value),
        selected: (settings.yomifinSubtitleWeight ?? 500) === w.value,
        onPress: () => updateSettings({ yomifinSubtitleWeight: w.value }),
      })),
    });
    groups.push({
      title: "Tappable Subs · Outline",
      options: OVERLAY_OUTLINE_STEPS.map((v) => ({
        type: "radio" as const,
        label: v[0].toUpperCase() + v.slice(1),
        value: v,
        selected: (settings.yomifinSubtitleOutline ?? "normal") === v,
        onPress: () => updateSettings({ yomifinSubtitleOutline: v }),
      })),
    });
    groups.push({
      title: "Tappable Subs · Position",
      options: OVERLAY_OFFSET_STEPS.map((v) => ({
        type: "radio" as const,
        label: String(v),
        value: String(v),
        selected: (settings.yomifinSubtitleBottomOffset ?? 64) === v,
        onPress: () => updateSettings({ yomifinSubtitleBottomOffset: v }),
      })),
    });
    return groups;
  }, [
    subTracks,
    selectedSubId,
    externalSubActive,
    externalSubName,
    isTextSubCodec,
    onSelectSubtitle,
    onOnlineSubtitles,
    jimakuEnabled,
    settings.yomifinSubtitleFontSize,
    settings.yomifinSubtitleWeight,
    settings.yomifinSubtitleOutline,
    settings.yomifinSubtitleBottomOffset,
    updateSettings,
  ]);

  const audioGroups = useMemo<OptionGroup[]>(() => {
    if (audioTracks.length === 0) return [];
    return [
      {
        title: "Audio",
        options: audioTracks.map((t) => ({
          type: "radio" as const,
          label: `#${t.id} ${t.lang ?? "?"} ${t.title ?? ""}`.trim(),
          value: t.id.toString(),
          selected: selectedAudioId === t.id,
          onPress: () => onSelectAudio(t.id),
        })),
      },
    ];
  }, [audioTracks, selectedAudioId, onSelectAudio]);

  // Right time label (length / -remaining / ends-at).
  const remainingSec = Math.max(0, durationSec - positionSec);
  const rightTimeLabel = useMemo(() => {
    if (timeMode === 1) return `-${fmtTime(remainingSec)}`;
    if (timeMode === 2) {
      const finish = new Date(Date.now() + remainingSec * 1000);
      return finish.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
    return fmtTime(durationSec);
  }, [timeMode, remainingSec, durationSec]);

  const timeColWidth = useMemo(() => {
    const chars = fmtTime(durationSec).length;
    return Math.max(46, Math.ceil(chars * 8) + 6);
  }, [durationSec]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
      {/* Scrims fade with the controls. */}
      <ControlsScrims showControls={showControls} />

      {/* Status bar — always mounted (persistent-during-playback aware). */}
      <StatusBar
        title={title}
        showControls={showControls}
        getTechnicalInfo={getTechnicalInfo}
      />

      {/* Mid-playback buffering spinner (controls hidden). */}
      {isBuffering && !showControls ? (
        <View style={styles.centerSpinner} pointerEvents='none'>
          <Loader size='large' />
        </View>
      ) : null}

      {/* Drag-anywhere scrub bar (controls hidden). */}
      <ScrubProgressBar
        visible={isScrubbing && !showControls}
        progress={progress}
        min={min}
        max={max}
        cacheProgress={cacheProgress}
        chapters={null}
        durationMs={durationSec * 1000}
      />

      {/* Header row. */}
      <Animated.View
        style={[styles.header, { top: insets.top + 38 }, headerAnimatedStyle]}
        pointerEvents={showControls ? "auto" : "none"}
      >
        <View className='mr-auto flex flex-row items-center'>
          <PickerDropdown
            title='Playback Options'
            icon='ellipsis-horizontal'
            size={24}
            groups={menuGroups}
          />
          {profilePill ? (
            <View style={{ marginLeft: 8 }}>{profilePill}</View>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={onClose}
          className='aspect-square flex flex-col rounded-xl items-center justify-center p-2'
        >
          <Ionicons name='close' size={24} color='white' />
        </TouchableOpacity>
      </Animated.View>

      {/* Bottom pane. */}
      <Animated.View
        style={[
          styles.bottom,
          {
            left: insets.left,
            right: insets.right,
            bottom: Math.max(insets.bottom - 6, 4),
          },
          bottomAnimatedStyle,
        ]}
        className='px-4'
        pointerEvents={showControls ? "box-none" : "none"}
      >
        {/* Row A: subtitle/audio pickers. */}
        <View
          className='flex flex-row items-center'
          style={{ minHeight: 40 }}
          pointerEvents='auto'
        >
          <PickerDropdown
            title='Subtitles'
            icon='chatbox-ellipses'
            groups={subtitleGroups}
          />
          <PickerDropdown
            title='Audio'
            icon='volume-high'
            groups={audioGroups}
          />
        </View>

        {/* Row B: current time · sleek slider · length (tappable). */}
        <View
          className='flex flex-row items-center my-1'
          pointerEvents='box-none'
        >
          <View style={{ width: timeColWidth, marginRight: 12 }}>
            <Text
              className='text-[12px] text-neutral-300'
              numberOfLines={1}
              style={{ fontVariant: ["tabular-nums"], textAlign: "left" }}
            >
              {fmtTime(positionSec)}
            </Text>
          </View>
          <View
            style={{
              flex: 1,
              height: 6,
              justifyContent: "center",
              overflow: "visible",
            }}
            pointerEvents='auto'
          >
            <Slider
              theme={{
                maximumTrackTintColor: "rgba(255,255,255,0.2)",
                minimumTrackTintColor: "#fff",
                cacheTrackTintColor: "rgba(255,255,255,0.3)",
                bubbleBackgroundColor: "#fff",
                bubbleTextColor: "#666",
              }}
              renderThumb={() => null}
              renderBubble={() => null}
              cache={cacheProgress}
              onSlidingStart={onSliderStart}
              onSlidingComplete={(v) => onSliderComplete(v)}
              containerStyle={{ borderRadius: 100 }}
              sliderHeight={6}
              thumbWidth={0}
              progress={progress}
              minimumValue={min}
              maximumValue={max}
            />
          </View>
          <Pressable
            onPress={() => setTimeMode((m) => (m + 1) % 3)}
            hitSlop={10}
            className='ml-3'
            pointerEvents='auto'
            style={{ width: timeMode === 2 ? undefined : timeColWidth }}
          >
            <Text
              className='text-[12px] text-neutral-300'
              numberOfLines={1}
              style={{ fontVariant: ["tabular-nums"], textAlign: "right" }}
            >
              {rightTimeLabel}
            </Text>
          </Pressable>
        </View>

        {/* Row C: transport cluster. */}
        <View
          className='flex flex-row items-center justify-center'
          style={{ gap: 26, paddingVertical: 6 }}
          pointerEvents='auto'
        >
          <TouchableOpacity onPress={onSkipBackward} hitSlop={8}>
            <View style={{ justifyContent: "center", alignItems: "center" }}>
              <Ionicons
                name='refresh-outline'
                size={34}
                color={ICON}
                style={{ transform: [{ scaleY: -1 }, { rotate: "180deg" }] }}
              />
              <Text
                style={{
                  position: "absolute",
                  color: ICON,
                  fontSize: 11,
                  fontWeight: "bold",
                }}
              >
                {rewindSeconds}
              </Text>
            </View>
          </TouchableOpacity>

          {showSubtitleNav && (
            <TouchableOpacity
              onPress={onPrevSubtitle}
              hitSlop={8}
              accessibilityLabel='Previous subtitle'
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons name='caret-back' size={18} color={ICON} />
                <Ionicons
                  name='chatbox-ellipses-outline'
                  size={20}
                  color={ICON}
                />
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={onTogglePlay} hitSlop={10}>
            <View
              style={{
                width: 46,
                height: 46,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {!isBuffering ? (
                <Ionicons
                  name={isPlaying ? "pause" : "play"}
                  size={46}
                  color={ICON}
                />
              ) : (
                <Loader size='large' />
              )}
            </View>
          </TouchableOpacity>

          {showSubtitleNav && (
            <TouchableOpacity
              onPress={onNextSubtitle}
              hitSlop={8}
              accessibilityLabel='Next subtitle'
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name='chatbox-ellipses-outline'
                  size={20}
                  color={ICON}
                />
                <Ionicons name='caret-forward' size={18} color={ICON} />
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={onSkipForward} hitSlop={8}>
            <View style={{ justifyContent: "center", alignItems: "center" }}>
              <Ionicons name='refresh-outline' size={34} color={ICON} />
              <Text
                style={{
                  position: "absolute",
                  color: ICON,
                  fontSize: 11,
                  fontWeight: "bold",
                }}
              >
                {forwardSeconds}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

export default memo(StremioPlayerControls);

const styles = StyleSheet.create({
  header: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 10,
    padding: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  bottom: {
    position: "absolute",
    zIndex: 10,
    flexDirection: "column",
  },
  centerSpinner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 6,
  },
});

const statusStyles = StyleSheet.create({
  container: { position: "absolute", zIndex: 12 },
  row: { flexDirection: "row", alignItems: "center", height: 34 },
  side: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 90 },
  sideRight: { justifyContent: "flex-end" },
  center: { flex: 1, alignItems: "center", paddingHorizontal: 12 },
  clock: {
    color: "white",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  date: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "500" },
  title: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  meta: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  battery: { flexDirection: "row", alignItems: "center", gap: 3 },
});
