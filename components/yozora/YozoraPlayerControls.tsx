import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PlayerMenu,
  type PlayerMenuTrack,
} from "@/components/video-player/controls/dropdown/PlayerMenu";
import {
  PlayerControls,
  type PlayerControlsProps,
} from "@/components/video-player/controls/PlayerControls";
import { TechnicalInfoOverlay } from "@/components/video-player/controls/TechnicalInfoOverlay";
import { nativeTrackLabel } from "@/components/video-player/controls/utils/playerPresentation";
import type { MpvAudioTrack, MpvSubtitleTrack } from "@/modules";

interface Props extends Omit<PlayerControlsProps, "menu" | "trackMenus"> {
  playbackSpeed: number;
  onSetSpeed: (speed: number) => void;
  subTracks: MpvSubtitleTrack[];
  selectedSubId: number;
  externalSubActive: boolean;
  externalSubName: string | null;
  onSelectSubtitle: (id: number) => void;
  onOnlineSubtitles: () => void;
  onlineSubtitlesEnabled: boolean;
  audioTracks: MpvAudioTrack[];
  selectedAudioId: number;
  onSelectAudio: (id: number) => void;
}
const noSelection = () => {};

/** Yozora supplies native track identities; all visible controls are shared. */
export default memo(function YozoraPlayerControls({
  playbackSpeed,
  onSetSpeed,
  subTracks,
  selectedSubId,
  externalSubActive,
  externalSubName,
  onSelectSubtitle,
  onOnlineSubtitles,
  onlineSubtitlesEnabled,
  audioTracks,
  selectedAudioId,
  onSelectAudio,
  ...controls
}: Props) {
  const { t } = useTranslation();
  const [showTechnicalInfo, setShowTechnicalInfo] = useState(false);
  const toggleTechnicalInfo = useCallback(
    () => setShowTechnicalInfo((value) => !value),
    [],
  );
  const subtitles = useMemo<PlayerMenuTrack[]>(
    () => [
      {
        id: "off",
        label: t("player.controls.subtitles_off"),
        selected: selectedSubId === -1 && !externalSubActive,
        onSelect: () => onSelectSubtitle(-1),
      },
      ...subTracks.map((track) => ({
        id: String(track.id),
        label: nativeTrackLabel(track),
        selected: selectedSubId === track.id && !externalSubActive,
        onSelect: () => onSelectSubtitle(track.id),
      })),
      ...(externalSubActive
        ? [
            {
              id: "online",
              label: externalSubName || t("player.controls.online_subtitles"),
              selected: true,
              onSelect: noSelection,
              disabled: true,
            },
          ]
        : []),
    ],
    [
      subTracks,
      selectedSubId,
      externalSubActive,
      externalSubName,
      onSelectSubtitle,
      t,
    ],
  );
  const audio = useMemo(
    () =>
      audioTracks.map((track) => ({
        id: String(track.id),
        label: nativeTrackLabel(track),
        selected: selectedAudioId === track.id,
        onSelect: () => onSelectAudio(track.id),
      })),
    [audioTracks, selectedAudioId, onSelectAudio],
  );
  const menu = useMemo(
    () => (
      <PlayerMenu
        variant='menu'
        playbackSpeed={playbackSpeed}
        onSetSpeed={onSetSpeed}
        showTechnicalInfo={showTechnicalInfo}
        onToggleTechnicalInfo={
          controls.getTechnicalInfo ? toggleTechnicalInfo : undefined
        }
      />
    ),
    [
      playbackSpeed,
      onSetSpeed,
      showTechnicalInfo,
      controls.getTechnicalInfo,
      toggleTechnicalInfo,
    ],
  );
  const trackMenus = useMemo(
    () => (
      <>
        <PlayerMenu
          variant='subtitles'
          tracks={subtitles}
          canScaleSubtitles={subTracks.length > 0}
          onOnlineSubtitles={
            onlineSubtitlesEnabled ? onOnlineSubtitles : undefined
          }
        />
        <PlayerMenu variant='audio' tracks={audio} />
      </>
    ),
    [
      subtitles,
      subTracks.length,
      onlineSubtitlesEnabled,
      onOnlineSubtitles,
      audio,
    ],
  );
  return (
    <PlayerControls
      {...controls}
      menu={menu}
      trackMenus={trackMenus}
      overlays={
        controls.getTechnicalInfo ? (
          <TechnicalInfoOverlay
            showControls={controls.showControls}
            visible={showTechnicalInfo}
            getTechnicalInfo={controls.getTechnicalInfo}
          />
        ) : undefined
      }
    />
  );
});
