import type { Api } from "@jellyfin/sdk";
import type {
  BaseItemDto,
  MediaSourceInfo,
} from "@jellyfin/sdk/lib/generated-client";
import { useLocalSearchParams } from "expo-router";
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { type SharedValue, useSharedValue } from "react-native-reanimated";
import ContinueWatchingOverlay from "@/components/video-player/controls/ContinueWatchingOverlay";
import useRouter from "@/hooks/useAppRouter";
import { useHaptic } from "@/hooks/useHaptic";
import { useMediaSegments } from "@/hooks/useMediaSegments";
import { usePlaybackManager } from "@/hooks/usePlaybackManager";
import { useTrickplay } from "@/hooks/useTrickplay";
import type { TechnicalInfo } from "@/modules/mpv-player";
import type { DownloadedItem } from "@/providers/Downloads/types";
import { useOfflineMode } from "@/providers/OfflineModeProvider";
import { useSettings } from "@/utils/atoms/settings";
import { hasChapterMarkers } from "@/utils/chapters";
import { getDefaultPlaySettings } from "@/utils/jellyfin/getDefaultPlaySettings";
import { SEGMENT_SKIP_KEY, useSegments } from "@/utils/segments";
import { ticksToMs } from "@/utils/time";
import { CONTROLS_CONSTANTS } from "./constants";
import DropdownView from "./dropdown/DropdownView";
import { EpisodeList } from "./EpisodeList";
import { useVideoTime } from "./hooks/useVideoTime";
import { PlayerControls } from "./PlayerControls";
import { SegmentSkippedNotice } from "./SegmentSkippedNotice";
import { SkipSegmentOverlay } from "./SkipSegmentOverlay";
import { TechnicalInfoOverlay } from "./TechnicalInfoOverlay";
import type { PlaybackSpeedScope } from "./utils/playback-speed-settings";
import { playerTitle } from "./utils/playerPresentation";
import type { AspectRatio } from "./VideoScalingModeSelector";

interface Props {
  item: BaseItemDto;
  isPlaying: boolean;
  /** Bumped by direct-player on every native two-finger tap (gesture feedback UI). */
  twoFingerNonce?: number;
  isSeeking: SharedValue<boolean>;
  cacheProgress: SharedValue<number>;
  progress: SharedValue<number>;
  isBuffering: boolean;
  showControls: boolean;
  enableTrickplay?: boolean;
  togglePlay: () => void;
  setShowControls: (shown: boolean) => void;
  mediaSource?: MediaSourceInfo | null;
  seek: (positionMs: number) => void;
  startPictureInPicture?: () => Promise<void>;
  play: () => void;
  pause: () => void;
  aspectRatio?: AspectRatio;
  isZoomedToFill?: boolean;
  onZoomToggle?: () => void;
  api?: Api | null;
  downloadedFiles?: DownloadedItem[];
  // Playback speed props
  playbackSpeed?: number;
  setPlaybackSpeed?: (speed: number, scope: PlaybackSpeedScope) => void;
  subtitleDelay?: number;
  onSubtitleDelayChange?: (seconds: number) => void;
  onHoldSpeedStart?: () => void;
  onHoldSpeedEnd?: () => void;
  // Technical info props
  showTechnicalInfo?: boolean;
  onToggleTechnicalInfo?: () => void;
  getTechnicalInfo?: () => Promise<TechnicalInfo>;
  playMethod?: "DirectPlay" | "DirectStream" | "Transcode";
  transcodeReasons?: string[];
  // Phase 5: prev/next SUBTITLE cue navigation (shown next to the time-skip buttons).
  showSubtitleNav?: boolean;
  onPrevSubtitle?: () => void;
  onNextSubtitle?: () => void;
  /** Extra header control next to the dropdown (yomifin profile pill). */
  headerLeftSlot?: React.ReactNode;
  interactionBlocked?: boolean;
}

export const Controls: FC<Props> = ({
  item,
  seek,
  startPictureInPicture,
  play,
  pause,
  togglePlay,
  isPlaying,
  twoFingerNonce,
  isSeeking,
  progress,
  isBuffering,
  cacheProgress,
  showControls,
  setShowControls,
  mediaSource,
  aspectRatio: _aspectRatio = "default",
  isZoomedToFill = false,
  onZoomToggle,
  api = null,
  downloadedFiles = undefined,
  playbackSpeed = 1.0,
  setPlaybackSpeed,
  subtitleDelay = 0,
  onSubtitleDelayChange,
  onHoldSpeedStart,
  onHoldSpeedEnd,
  showTechnicalInfo = false,
  onToggleTechnicalInfo,
  getTechnicalInfo,
  playMethod,
  transcodeReasons,
  showSubtitleNav = false,
  onPrevSubtitle,
  onNextSubtitle,
  headerLeftSlot,
  interactionBlocked,
}) => {
  const offline = useOfflineMode();
  const { settings, updateSettings } = useSettings();
  const router = useRouter();
  const lightHapticFeedback = useHaptic("light");
  const [episodeView, setEpisodeView] = useState(false);
  const { previousItem, nextItem } = usePlaybackManager({
    item,
    isOffline: offline,
  });
  const {
    trickPlayUrl,
    calculateTrickplayUrl,
    trickplayInfo,
    prefetchAllTrickplayImages,
  } = useTrickplay(item);
  const maxMs = ticksToMs(item.RunTimeTicks || 0);
  const max = useSharedValue(maxMs);
  useEffect(() => {
    prefetchAllTrickplayImages();
  }, [prefetchAllTrickplayImages]);
  useEffect(() => {
    progress.value = ticksToMs(item.UserData?.PlaybackPositionTicks);
    max.value = ticksToMs(item.RunTimeTicks || 0);
  }, [item, progress, max]);
  const { currentTime, remainingTime } = useVideoTime({
    progress,
    max,
    isSeeking,
  });
  const { bitrateValue, subtitleIndex, audioIndex } = useLocalSearchParams<{
    bitrateValue: string;
    audioIndex: string;
    subtitleIndex: string;
  }>();

  // Fetch all segments for the current item
  const { data: segments } = useSegments(
    item.Id ?? "",
    offline,
    downloadedFiles,
    api,
  );

  // Unified segment orchestration (identical mechanism on mobile and TV):
  // overlap priority + a single auto-skip driver live in the shared hook.
  const {
    activeSegment,
    skipActiveSegment: onSkipSegment,
    showSkipButton: showSkipSegmentButton,
    isOutroActive: showSkipOutroButton,
    skipOutro: onSkipOutro,
    hasContentAfterCredits,
    skippedNotice,
  } = useMediaSegments({
    segments,
    currentTime,
    maxMs,
    seek,
    play,
    isPlaying,
    isBuffering,
  });

  const { t } = useTranslation();
  const skipSegmentButtonText = t(
    SEGMENT_SKIP_KEY[activeSegment?.type ?? "Intro"],
  );
  const skipOutroButtonText = t(SEGMENT_SKIP_KEY.Outro);

  // Same gate as the bookmark icon in BottomControls, so the skip overlay
  // only shifts left when the icon is actually shown.
  const showsChapterIcon = useMemo(
    () => hasChapterMarkers(item.Chapters, maxMs),
    [item.Chapters, maxMs],
  );

  // Whether the "Next Episode" countdown can be rendered at all. The Skip
  // Credits button yields to it only when this is true; if autoplay is
  // disabled or its episode limit is reached, Skip Credits must stay available.
  const willShowNextEpisode =
    !!nextItem &&
    settings.autoPlayNextEpisode !== false &&
    (settings.maxAutoPlayEpisodeCount.value === -1 ||
      settings.autoPlayEpisodeCount < settings.maxAutoPlayEpisodeCount.value);

  // Credits segment metadata (hasContentAfterCredits) can be wrong, so this
  // path only swaps Skip Credits for a manually-tappable Next Episode button
  // — it must never auto-advance on its own.
  const showNextEpisodeFromCredits =
    willShowNextEpisode && showSkipOutroButton && !hasContentAfterCredits;

  // Driven by actual playback position vs. duration, independent of segment
  // metadata, so it's safe to auto-advance from this trigger.
  const showNextEpisodeFromRemainingTime =
    willShowNextEpisode &&
    remainingTime < CONTROLS_CONSTANTS.NEXT_EPISODE_COUNTDOWN_MS;

  const showNextEpisode =
    showNextEpisodeFromCredits || showNextEpisodeFromRemainingTime;
  // Whether reaching the end of the item may advance on its own. Pausing is
  // not a reason to take that away: the countdown follows the remaining time,
  // which stops moving while playback does.
  const autoAdvanceNextEpisode = showNextEpisodeFromRemainingTime;

  // Autoplay would run at EOF but the episode cap stops it: ask "Still
  // watching?" there instead, with playback paused — mirroring the native
  // player's stillWatchingRequired flow. Gated on reaching the end so the
  // prompt never covers a video that is still playing.
  const stillWatchingRequired =
    !!nextItem &&
    settings.autoPlayNextEpisode !== false &&
    settings.maxAutoPlayEpisodeCount.value !== -1 &&
    settings.autoPlayEpisodeCount >= settings.maxAutoPlayEpisodeCount.value;

  const [stillWatchingVisible, setStillWatchingVisible] = useState(false);
  // The cap-hitting autoplay updates the episode count synchronously while
  // currentTime/remainingTime still hold the outgoing episode's near-zero
  // values (the next item loads async), so "at EOF" alone would fire the
  // prompt over the incoming episode. Only a progress tick from mid-playback
  // of the final episode itself arms the trigger.
  const stillWatchingArmedRef = useRef(false);

  // Reset after an in-place episode switch (setParams keeps Controls mounted).
  useEffect(() => {
    stillWatchingArmedRef.current = false;
    setStillWatchingVisible(false);
  }, [item.Id]);

  useEffect(() => {
    if (!stillWatchingRequired || stillWatchingVisible || maxMs <= 0) {
      return;
    }
    if (
      currentTime > 0 &&
      remainingTime > CONTROLS_CONSTANTS.STILL_WATCHING_EOF_WINDOW_MS
    ) {
      stillWatchingArmedRef.current = true;
      return;
    }
    if (
      stillWatchingArmedRef.current &&
      remainingTime <= CONTROLS_CONSTANTS.STILL_WATCHING_EOF_WINDOW_MS
    ) {
      setStillWatchingVisible(true);
      pause();
    }
  }, [
    stillWatchingVisible,
    stillWatchingRequired,
    maxMs,
    currentTime,
    remainingTime,
    pause,
  ]);

  const goToItemCommon = useCallback(
    (item: BaseItemDto) => {
      if (!item || !settings) {
        return;
      }
      lightHapticFeedback();
      const previousIndexes = {
        subtitleIndex: subtitleIndex
          ? Number.parseInt(subtitleIndex, 10)
          : undefined,
        audioIndex: audioIndex ? Number.parseInt(audioIndex, 10) : undefined,
      };

      const {
        mediaSource: newMediaSource,
        audioIndex: defaultAudioIndex,
        subtitleIndex: defaultSubtitleIndex,
      } = getDefaultPlaySettings(item, settings, {
        indexes: previousIndexes,
        source: mediaSource ?? undefined,
      });

      // Use setParams instead of replace to avoid unmounting/remounting the player,
      // which would create a new MPV native view and crash with "mp_initialize already initialized".
      router.setParams({
        ...(offline && { offline: "true" }),
        itemId: item.Id ?? "",
        audioIndex: defaultAudioIndex?.toString() ?? "",
        subtitleIndex: defaultSubtitleIndex?.toString() ?? "",
        mediaSourceId: newMediaSource?.Id ?? "",
        bitrateValue: bitrateValue?.toString(),
        playbackPosition:
          item.UserData?.PlaybackPositionTicks?.toString() ?? "",
      });
    },
    [
      settings,
      subtitleIndex,
      audioIndex,
      mediaSource,
      bitrateValue,
      router,
      offline,
    ],
  );

  const goToPreviousItem = useCallback(() => {
    if (!previousItem) {
      return;
    }
    goToItemCommon(previousItem);
  }, [previousItem, goToItemCommon]);

  const goToNextItem = useCallback(
    ({
      isAutoPlay,
      resetWatchCount,
    }: {
      isAutoPlay?: boolean;
      resetWatchCount?: boolean;
    }) => {
      if (!nextItem) {
        return;
      }

      if (!isAutoPlay) {
        // if we are not autoplaying, we won't update anything, we just go to the next item
        goToItemCommon(nextItem);
        if (resetWatchCount) {
          updateSettings({
            autoPlayEpisodeCount: 0,
          });
        }
        return;
      }

      // Skip autoplay logic if maxAutoPlayEpisodeCount is -1
      if (settings.maxAutoPlayEpisodeCount.value === -1) {
        goToItemCommon(nextItem);
        return;
      }

      // Same boundary as the countdown's willShowNextEpisode gate — the
      // countdown must never complete without actually navigating.
      if (
        settings.autoPlayEpisodeCount < settings.maxAutoPlayEpisodeCount.value
      ) {
        goToItemCommon(nextItem);
      }

      // Check if the autoPlayEpisodeCount is less than maxAutoPlayEpisodeCount for the autoPlay
      if (
        settings.autoPlayEpisodeCount < settings.maxAutoPlayEpisodeCount.value
      ) {
        // update the autoPlayEpisodeCount in settings
        updateSettings({
          autoPlayEpisodeCount: settings.autoPlayEpisodeCount + 1,
        });
      }
    },
    [nextItem, goToItemCommon],
  );

  // Add a memoized handler for autoplay next episode
  const handleNextEpisodeAutoPlay = useCallback(() => {
    goToNextItem({ isAutoPlay: true });
  }, [goToNextItem]);

  // Add a memoized handler for manual next episode
  const handleNextEpisodeManual = useCallback(() => {
    goToNextItem({ isAutoPlay: false });
  }, [goToNextItem]);

  // Add a memoized handler for ContinueWatchingOverlay
  const handleContinueWatching = useCallback(
    (options: { isAutoPlay?: boolean; resetWatchCount?: boolean }) => {
      goToNextItem(options);
    },
    [goToNextItem],
  );

  const onClose = useCallback(() => {
    lightHapticFeedback();
    router.back();
  }, [lightHapticFeedback, router]);
  const switchOnEpisodeMode = useCallback(() => {
    setEpisodeView(true);
    if (isPlaying) pause();
  }, [isPlaying, pause]);
  const menu = useMemo(
    () => (
      <DropdownView
        variant='menu'
        playbackSpeed={playbackSpeed}
        setPlaybackSpeed={setPlaybackSpeed}
        showTechnicalInfo={showTechnicalInfo}
        onToggleTechnicalInfo={onToggleTechnicalInfo}
      />
    ),
    [playbackSpeed, setPlaybackSpeed, showTechnicalInfo, onToggleTechnicalInfo],
  );
  const trackMenus = useMemo(
    () => (
      <>
        <DropdownView
          variant='subtitles'
          subtitleDelay={subtitleDelay}
          onSubtitleDelayChange={onSubtitleDelayChange}
        />
        <DropdownView variant='audio' />
      </>
    ),
    [subtitleDelay, onSubtitleDelayChange],
  );
  return (
    <>
      <PlayerControls
        title={playerTitle(item)}
        durationMs={maxMs}
        progress={progress}
        cacheProgress={cacheProgress}
        isSeeking={isSeeking}
        isPlaying={isPlaying}
        isBuffering={isBuffering}
        showControls={showControls}
        setShowControls={setShowControls}
        play={play}
        pause={pause}
        togglePlay={togglePlay}
        seek={seek}
        onClose={onClose}
        menu={menu}
        trackMenus={trackMenus}
        profilePill={headerLeftSlot}
        twoFingerNonce={twoFingerNonce}
        onHoldSpeedStart={onHoldSpeedStart}
        onHoldSpeedEnd={onHoldSpeedEnd}
        startPictureInPicture={startPictureInPicture}
        isZoomedToFill={isZoomedToFill}
        onZoomToggle={onZoomToggle}
        onOpenEpisodes={
          item.Type === "Episode" ? switchOnEpisodeMode : undefined
        }
        onPreviousEpisode={previousItem ? goToPreviousItem : undefined}
        onNextEpisode={nextItem ? handleNextEpisodeManual : undefined}
        showSubtitleNav={showSubtitleNav}
        onPrevSubtitle={onPrevSubtitle}
        onNextSubtitle={onNextSubtitle}
        chapters={item.Chapters}
        getTechnicalInfo={getTechnicalInfo}
        trickPlayUrl={trickPlayUrl}
        trickplayInfo={trickplayInfo}
        calculateTrickplayUrl={calculateTrickplayUrl}
        interactionBlocked={interactionBlocked || stillWatchingVisible}
        panel={
          episodeView ? (
            <EpisodeList
              item={item}
              close={() => setEpisodeView(false)}
              goToItem={goToItemCommon}
            />
          ) : undefined
        }
        overlays={
          <>
            {getTechnicalInfo && (
              <TechnicalInfoOverlay
                showControls={showControls}
                visible={showTechnicalInfo}
                getTechnicalInfo={getTechnicalInfo}
                playMethod={playMethod}
                transcodeReasons={transcodeReasons}
                mediaSource={mediaSource}
                item={item}
              />
            )}
            <SkipSegmentOverlay
              showSkipButton={showSkipSegmentButton}
              skipButtonText={skipSegmentButtonText}
              showSkipCreditButton={showSkipOutroButton}
              skipCreditButtonText={skipOutroButtonText}
              hasContentAfterCredits={hasContentAfterCredits}
              willShowNextEpisode={willShowNextEpisode}
              showNextEpisode={showNextEpisode}
              autoAdvanceNextEpisode={autoAdvanceNextEpisode}
              remainingTime={remainingTime}
              isPlaying={isPlaying}
              itemId={item.Id}
              skipIntro={onSkipSegment}
              skipCredit={onSkipOutro}
              onNextEpisodeFinish={handleNextEpisodeAutoPlay}
              onNextEpisodePress={handleNextEpisodeManual}
              controlsVisible={showControls}
              hasChapters={showsChapterIcon}
            />
            <SegmentSkippedNotice segment={skippedNotice} />
          </>
        }
      />
      {stillWatchingVisible && (
        <ContinueWatchingOverlay goToNextItem={handleContinueWatching} />
      )}
    </>
  );
};
