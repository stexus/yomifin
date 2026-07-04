import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useSetAtom } from "jotai";
import { memo, useCallback, useMemo, useRef } from "react";
import { Platform, View } from "react-native";
import { BITRATES } from "@/components/BitrateSelector";
import {
  type OptionGroup,
  PlatformDropdown,
} from "@/components/PlatformDropdown";
import { PLAYBACK_SPEEDS } from "@/components/PlaybackSpeedSelector";
import useRouter from "@/hooks/useAppRouter";
import { useOfflineMode } from "@/providers/OfflineModeProvider";
import { useSettings } from "@/utils/atoms/settings";
import { yomifinOnlineSubsVisibleAtom } from "@/utils/atoms/yomifinOnlineSubs";
import { usePlayerContext } from "../contexts/PlayerContext";
import { useVideoContext } from "../contexts/VideoContext";
import { PlaybackSpeedScope } from "../utils/playback-speed-settings";

// Subtitle scale presets (direct multiplier values)
const SUBTITLE_SCALE_PRESETS = [
  { label: "0.1x", value: 0.1 },
  { label: "0.25x", value: 0.25 },
  { label: "0.5x", value: 0.5 },
  { label: "0.75x", value: 0.75 },
  { label: "1.0x", value: 1.0 },
  { label: "1.25x", value: 1.25 },
  { label: "1.5x", value: 1.5 },
  { label: "2.0x", value: 2.0 },
  { label: "2.5x", value: 2.5 },
  { label: "3.0x", value: 3.0 },
] as const;

// YOMIFIN: tappable-overlay styling steps (same values as Settings → Reader — these
// entries edit the SAME global settings, just reachable mid-playback).
const OVERLAY_FONT_STEPS = [24, 28, 32, 38, 44] as const;
const OVERLAY_WEIGHT_STEPS = [
  { label: "Regular", value: 400 },
  { label: "Medium", value: 500 },
  { label: "Semibold", value: 600 },
  { label: "Bold", value: 700 },
] as const;
const OVERLAY_OUTLINE_STEPS = ["none", "thin", "normal", "strong"] as const;
const OVERLAY_OFFSET_STEPS = [24, 48, 64, 96, 128] as const;

/**
 * variant controls which sections + trigger icon this dropdown renders:
 *   "menu"      — the top ⋯ button: quality / speed / technical info.
 *   "subtitles" — bottom-left subtitle button: track list + scale + tappable-sub
 *                 styling + online subtitles.
 *   "audio"     — bottom-left audio button: audio track list.
 */
type DropdownVariant = "menu" | "subtitles" | "audio";

interface DropdownViewProps {
  variant?: DropdownVariant;
  playbackSpeed?: number;
  setPlaybackSpeed?: (speed: number, scope: PlaybackSpeedScope) => void;
  showTechnicalInfo?: boolean;
  onToggleTechnicalInfo?: () => void;
}

const DropdownView = ({
  variant = "menu",
  playbackSpeed = 1.0,
  setPlaybackSpeed,
  showTechnicalInfo = false,
  onToggleTechnicalInfo,
}: DropdownViewProps) => {
  const { subtitleTracks, audioTracks } = useVideoContext();
  const { item, mediaSource } = usePlayerContext();
  const { settings, updateSettings } = useSettings();
  const router = useRouter();
  const isOffline = useOfflineMode();
  // YOMIFIN: opens the online-subtitles (jimaku) modal mounted by direct-player.
  const setOnlineSubsVisible = useSetAtom(yomifinOnlineSubsVisibleAtom);

  const { subtitleIndex, audioIndex, bitrateValue, playbackPosition } =
    useLocalSearchParams<{
      itemId: string;
      audioIndex: string;
      subtitleIndex: string;
      mediaSourceId: string;
      bitrateValue: string;
      playbackPosition: string;
    }>();

  // Use ref to track playbackPosition without causing re-renders
  const playbackPositionRef = useRef(playbackPosition);
  playbackPositionRef.current = playbackPosition;

  // Stabilize IDs to prevent unnecessary recalculations
  const itemIdRef = useRef(item.Id);
  const mediaSourceIdRef = useRef(mediaSource?.Id);
  itemIdRef.current = item.Id;
  mediaSourceIdRef.current = mediaSource?.Id;

  const changeBitrate = useCallback(
    (bitrate: string) => {
      const queryParams = new URLSearchParams({
        itemId: itemIdRef.current ?? "",
        audioIndex: audioIndex?.toString() ?? "",
        subtitleIndex: subtitleIndex?.toString() ?? "",
        mediaSourceId: mediaSourceIdRef.current ?? "",
        bitrateValue: bitrate.toString(),
        playbackPosition: playbackPositionRef.current,
      }).toString();
      router.replace(`player/direct-player?${queryParams}` as any);
    },
    [audioIndex, subtitleIndex, router],
  );

  // Create stable identifiers for tracks
  const subtitleTracksKey = useMemo(
    () => subtitleTracks?.map((t) => `${t.index}-${t.name}`).join(",") ?? "",
    [subtitleTracks],
  );

  const audioTracksKey = useMemo(
    () => audioTracks?.map((t) => `${t.index}-${t.name}`).join(",") ?? "",
    [audioTracks],
  );

  // Transform sections into OptionGroup format
  const optionGroups = useMemo<OptionGroup[]>(() => {
    const groups: OptionGroup[] = [];

    // ===== AUDIO variant: audio track list only =====
    if (variant === "audio") {
      if (audioTracks && audioTracks.length > 0) {
        groups.push({
          title: "Audio",
          options: audioTracks.map((track) => ({
            type: "radio" as const,
            label: track.name,
            value: track.index.toString(),
            selected: audioIndex === track.index.toString(),
            onPress: () => track.setTrack(),
          })),
        });
      }
      return groups;
    }

    // ===== SUBTITLES variant: track list + scale + tappable styling + online =====
    if (variant === "subtitles") {
      if (subtitleTracks && subtitleTracks.length > 0) {
        groups.push({
          title: "Subtitles",
          options: subtitleTracks.map((sub) => ({
            type: "radio" as const,
            label: sub.name,
            value: sub.index.toString(),
            selected: subtitleIndex === sub.index.toString(),
            onPress: () => sub.setTrack(),
          })),
        });
        groups.push({
          title: "Subtitle Scale",
          options: SUBTITLE_SCALE_PRESETS.map((preset) => ({
            type: "radio" as const,
            label: preset.label,
            value: preset.value.toString(),
            selected: (settings.mpvSubtitleScale ?? 1.0) === preset.value,
            onPress: () => updateSettings({ mpvSubtitleScale: preset.value }),
          })),
        });
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
      }
      if (!isOffline && settings.yomifinJimakuApiKey) {
        groups.push({
          options: [
            {
              type: "action" as const,
              label: "Online subtitles (jimaku)…",
              onPress: () => setOnlineSubsVisible(true),
            },
          ],
        });
      }
      return groups;
    }

    // ===== MENU variant (default): quality / speed / technical info =====

    // Quality Section
    if (!isOffline) {
      groups.push({
        title: "Quality",
        options:
          BITRATES?.map((bitrate) => ({
            type: "radio" as const,
            label: bitrate.key,
            value: bitrate.value?.toString() ?? "",
            selected: bitrateValue === (bitrate.value?.toString() ?? ""),
            onPress: () => changeBitrate(bitrate.value?.toString() ?? ""),
          })) || [],
      });
    }

    // Speed Section
    if (setPlaybackSpeed) {
      groups.push({
        title: "Speed",
        options: PLAYBACK_SPEEDS.map((speed) => ({
          type: "radio" as const,
          label: speed.label,
          value: speed.value.toString(),
          selected: playbackSpeed === speed.value,
          onPress: () => setPlaybackSpeed(speed.value, PlaybackSpeedScope.All),
        })),
      });
    }

    // Technical Info (at bottom)
    if (onToggleTechnicalInfo) {
      groups.push({
        options: [
          {
            type: "action" as const,
            label: showTechnicalInfo
              ? "Hide Technical Info"
              : "Show Technical Info",
            onPress: onToggleTechnicalInfo,
          },
        ],
      });
    }

    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    variant,
    isOffline,
    bitrateValue,
    changeBitrate,
    subtitleTracksKey,
    audioTracksKey,
    subtitleIndex,
    audioIndex,
    settings.mpvSubtitleScale,
    settings.yomifinSubtitleFontSize,
    settings.yomifinSubtitleWeight,
    settings.yomifinSubtitleOutline,
    settings.yomifinSubtitleBottomOffset,
    settings.yomifinJimakuApiKey,
    setOnlineSubsVisible,
    updateSettings,
    playbackSpeed,
    setPlaybackSpeed,
    showTechnicalInfo,
    onToggleTechnicalInfo,
    // Note: subtitleTracks and audioTracks are intentionally excluded
    // because we use subtitleTracksKey and audioTracksKey for stability
  ]);

  // Memoize the trigger to prevent re-renders
  const triggerIcon =
    variant === "subtitles"
      ? "chatbox-ellipses"
      : variant === "audio"
        ? "volume-high"
        : "ellipsis-horizontal";
  const trigger = useMemo(
    () => (
      <View className='aspect-square flex flex-col rounded-xl items-center justify-center p-2'>
        <Ionicons name={triggerIcon} size={24} color={"white"} />
      </View>
    ),
    [triggerIcon],
  );

  // Hide on TV platforms
  if (Platform.isTV) return null;
  // Nothing to show (e.g. audio picker with no tracks) — render nothing so the
  // button doesn't appear as a dead control.
  if (optionGroups.length === 0) return null;

  return (
    <PlatformDropdown
      title={
        variant === "subtitles"
          ? "Subtitles"
          : variant === "audio"
            ? "Audio"
            : "Playback Options"
      }
      groups={optionGroups}
      trigger={trigger}
      expoUIConfig={{}}
      bottomSheetConfig={{
        enablePanDownToClose: true,
      }}
    />
  );
};

// Memoized: BottomControls (which now hosts the subtitle/audio pickers) re-renders
// every second as the clock ticks. Re-rendering the underlying @expo/ui SwiftUI
// Menu host that often crashes natively (regression from moving these pickers out of
// the tick-free HeaderControls). The picker variants take only a stable `variant`
// prop, so memo fully insulates them; the menu variant's props change rarely.
export default memo(DropdownView);
