import { useLocalSearchParams } from "expo-router";
import { useSetAtom } from "jotai";
import { memo, useCallback, useMemo, useRef } from "react";
import { BITRATES } from "@/components/BitrateSelector";
import useRouter from "@/hooks/useAppRouter";
import { useOfflineMode } from "@/providers/OfflineModeProvider";
import { useSettings } from "@/utils/atoms/settings";
import { yomifinOnlineSubsVisibleAtom } from "@/utils/atoms/yomifinOnlineSubs";
import { usePlayerContext } from "../contexts/PlayerContext";
import { useVideoContext } from "../contexts/VideoContext";
import { PlaybackSpeedScope } from "../utils/playback-speed-settings";
import { PlayerMenu, type PlayerMenuProps } from "./PlayerMenu";

interface Props
  extends Pick<
    PlayerMenuProps,
    | "variant"
    | "playbackSpeed"
    | "showTechnicalInfo"
    | "onToggleTechnicalInfo"
    | "subtitleDelay"
    | "onSubtitleDelayChange"
  > {
  setPlaybackSpeed?: (speed: number, scope: PlaybackSpeedScope) => void;
}

/** Jellyfin menu adapter: server indices and route replacement never enter the shared UI. */
export default memo(function DropdownView({
  setPlaybackSpeed,
  ...props
}: Props) {
  const { subtitleTracks, audioTracks } = useVideoContext();
  const { item, mediaSource } = usePlayerContext();
  const { settings } = useSettings();
  const router = useRouter();
  const isOffline = useOfflineMode();
  const setOnlineSubsVisible = useSetAtom(yomifinOnlineSubsVisibleAtom);
  const params = useLocalSearchParams<{
    audioIndex: string;
    subtitleIndex: string;
    bitrateValue: string;
    playbackPosition: string;
  }>();
  const latest = useRef({ item, mediaSource, params });
  latest.current = { item, mediaSource, params };
  const changeBitrate = useCallback(
    (bitrate: string) => {
      const { item, mediaSource, params } = latest.current;
      const query = new URLSearchParams({
        itemId: item.Id ?? "",
        mediaSourceId: mediaSource?.Id ?? "",
        audioIndex: params.audioIndex ?? "",
        subtitleIndex: params.subtitleIndex ?? "",
        bitrateValue: bitrate,
        playbackPosition: params.playbackPosition ?? "",
      });
      router.replace(`player/direct-player?${query}` as any);
    },
    [router],
  );
  const sourceTracks = props.variant === "audio" ? audioTracks : subtitleTracks;
  const selectedIndex =
    props.variant === "audio" ? params.audioIndex : params.subtitleIndex;
  const tracks = useMemo(
    () =>
      sourceTracks?.map((track) => ({
        id: String(track.index),
        label: track.name,
        selected: selectedIndex === String(track.index),
        onSelect: track.setTrack,
      })),
    [sourceTracks, selectedIndex],
  );
  const qualityOptions = useMemo(
    () =>
      isOffline
        ? undefined
        : BITRATES.map((bitrate) => ({
            type: "radio" as const,
            label: bitrate.key,
            value: String(bitrate.value ?? ""),
            selected: params.bitrateValue === String(bitrate.value ?? ""),
            onPress: () => changeBitrate(String(bitrate.value ?? "")),
          })),
    [isOffline, params.bitrateValue, changeBitrate],
  );
  const onSetSpeed = useCallback(
    (speed: number) => setPlaybackSpeed?.(speed, PlaybackSpeedScope.All),
    [setPlaybackSpeed],
  );
  const onOnlineSubtitles = useCallback(
    () => setOnlineSubsVisible(true),
    [setOnlineSubsVisible],
  );
  return (
    <PlayerMenu
      {...props}
      tracks={tracks}
      qualityOptions={qualityOptions}
      onSetSpeed={setPlaybackSpeed ? onSetSpeed : undefined}
      onOnlineSubtitles={
        !isOffline && settings.yomifinJimakuApiKey
          ? onOnlineSubtitles
          : undefined
      }
      canScaleSubtitles={Boolean(subtitleTracks?.length)}
    />
  );
});
