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
import { NEXT_EPISODE_COUNTDOWN_MS } from "@/constants/Playback";
import useRouter from "@/hooks/useAppRouter";
import { useFinishEpisodeAction } from "@/hooks/useFinishEpisodeAction";
import { useHaptic } from "@/hooks/useHaptic";
import { useMediaSegments } from "@/hooks/useMediaSegments";
import { usePlaybackManager } from "@/hooks/usePlaybackManager";
import { useServerVersion } from "@/hooks/useServerVersion";
import { useTrickplay } from "@/hooks/useTrickplay";
import type { TechnicalInfo } from "@/modules/mpv-player";
import type { DownloadedItem } from "@/providers/Downloads/types";
import { useOfflineMode } from "@/providers/OfflineModeProvider";
import { useSettings } from "@/utils/atoms/settings";
import { hasChapterMarkers } from "@/utils/chapters";
import { shouldOfferEpisodeCompletion } from "@/utils/directPlayer/episodeCompletion";
import { resolveStartTicks } from "@/utils/directPlayer/sessionPosition";
import {
  getAdjacentStartTicks,
  getDefaultPlaySettings,
} from "@/utils/jellyfin/getDefaultPlaySettings";
import { getPlayingRunTimeTicks } from "@/utils/jellyfin/mediaSourceVersion";
import { SEGMENT_SKIP_KEY, useSegments } from "@/utils/segments";
import {
  decideStillWatchingOnce,
  isStillWatchingDueAtEnd,
  markStillWatchingInput,
  peekStillWatchingDecision,
  previewStillWatchingDecision,
  recordStillWatchingAutoplay,
  releaseStillWatchingDecision,
  resetStillWatchingSession,
} from "@/utils/stillWatching";
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
  onFinishEpisode?: () => Promise<boolean>;
  isFinishingEpisode?: boolean;
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
  onFinishEpisode,
  isFinishingEpisode = false,
}) => {
  const offline = useOfflineMode();
  const { settings } = useSettings();
  const serverVersion = useServerVersion({
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [stillWatchingVisible, setStillWatchingVisible] = useState(false);
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
  } = useTrickplay(item, mediaSource?.Id);
  const maxMs = ticksToMs(getPlayingRunTimeTicks(item, mediaSource));
  const max = useSharedValue(maxMs);
  useEffect(() => {
    prefetchAllTrickplayImages();
  }, [prefetchAllTrickplayImages]);
  useEffect(() => {
    progress.value = ticksToMs(
      resolveStartTicks(
        playbackPositionRef.current,
        item.UserData?.PlaybackPositionTicks,
      ),
    );
  }, [item, progress]);
  useEffect(() => {
    max.value = maxMs;
  }, [maxMs, max]);
  const { currentTime, remainingTime } = useVideoTime({
    progress,
    max,
    isSeeking,
  });
  const { playbackPosition, bitrateValue, subtitleIndex, audioIndex } =
    useLocalSearchParams<{
      playbackPosition: string;
      bitrateValue: string;
      audioIndex: string;
      subtitleIndex: string;
    }>();
  // Read when the item changes only: the player rewrites the param as it goes.
  const playbackPositionRef = useRef(playbackPosition);
  playbackPositionRef.current = playbackPosition;

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

  const autoPlayWanted = !!nextItem && settings.autoPlayNextEpisode !== false;
  const inCountdownWindow = remainingTime < NEXT_EPISODE_COUNTDOWN_MS;

  // Autoplay would run at EOF but the session is long enough to ask "Still
  // watching?" there instead, with playback paused — mirroring the native
  // player's stillWatchingRequired flow.
  //
  // An autoplay records the episode synchronously while currentTime and
  // remainingTime still hold the outgoing episode's near-zero values (the
  // next item loads async), so "at EOF" alone would fire the prompt over the
  // incoming episode. Only a progress tick from mid-playback of the episode
  // itself arms the trigger, and every navigation disarms it.
  const stillWatchingArmedRef = useRef(false);
  // Decided once the credits or the countdown window start, so time passing
  // can't swap Skip Credits, the countdown and the prompt around under the
  // viewer; an input can only cancel a due prompt, as the idle rule needs. The decision lives
  // with the session, not this component, so a track change that remounts
  // the player keeps it. Taken without the autoplay gate, so a next item that
  // resolves late still gets the prompt.
  const isDueNow = () =>
    isStillWatchingDueAtEnd({
      preset: settings.stillWatchingPreset,
      remainingMs: remainingTime,
      playbackRate: playbackSpeed,
      tracksInput: true,
    });
  const inDecisionWindow = showSkipOutroButton || inCountdownWindow;
  // Armed: a tick from this episode's own playback has been seen, not the 0/0
  // a freshly mounted item starts from. Unarmed, a decision already taken for
  // this episode (before a remount, such as a track change) still holds the
  // countdown back, but nothing is decided or released on placeholder values,
  // and only an armed player shows the prompt.
  const stillWatchingArmed = stillWatchingArmedRef.current;
  // Only read here: React may run a render and throw it away, and the
  // decision is shared with the native player and with the next mount. The
  // effect below takes it, for the render that was kept.
  const stillWatchingDue =
    !inDecisionWindow || !item.Id
      ? false
      : stillWatchingArmed
        ? previewStillWatchingDecision(item.Id, isDueNow)
        : (peekStillWatchingDecision(item.Id) ?? false);
  const stillWatchingRequired = autoPlayWanted && stillWatchingDue;

  // After every render, on purpose: the window, the arming and the inputs
  // that can make a "due" decision stale all move between two of them.
  useEffect(() => {
    if (!stillWatchingArmed || !item.Id) return;
    if (inDecisionWindow) {
      decideStillWatchingOnce(item.Id, isDueNow);
    } else {
      // Leaving the window (a seek back) lets go, so the end is judged again.
      releaseStillWatchingDecision(item.Id);
    }
  });

  // Whether the "Next Episode" countdown can be rendered at all. The Skip
  // Credits button yields to it only when this is true; if autoplay is
  // disabled or the prompt is due, Skip Credits must stay available. A shown
  // prompt keeps it away even after a touch makes the prompt no longer due,
  // or the countdown would auto-advance under an unanswered prompt.
  const willShowNextEpisode =
    autoPlayWanted && !stillWatchingRequired && !stillWatchingVisible;

  // Credits segment metadata (hasContentAfterCredits) can be wrong, so this
  // path only swaps Skip Credits for a manually-tappable Next Episode button
  // — it must never auto-advance on its own.
  const showNextEpisodeFromCredits =
    willShowNextEpisode && showSkipOutroButton && !hasContentAfterCredits;

  // Driven by actual playback position vs. duration, independent of segment
  // metadata, so it's safe to auto-advance from this trigger.
  const showNextEpisodeFromRemainingTime =
    willShowNextEpisode && inCountdownWindow;

  const canFinishEpisode =
    !!onFinishEpisode &&
    item.Type === "Episode" &&
    nextItem?.Type === "Episode";
  const showFinishEpisode =
    !!onFinishEpisode &&
    shouldOfferEpisodeCompletion({
      isEpisode: item.Type === "Episode",
      hasNextEpisode: nextItem?.Type === "Episode",
      controlsVisible: showControls,
      outroActive: showSkipOutroButton,
      durationMs: maxMs,
      remainingMs: remainingTime,
    });
  const showNextEpisode =
    showFinishEpisode ||
    showNextEpisodeFromCredits ||
    showNextEpisodeFromRemainingTime;
  // Whether reaching the end of the item may advance on its own. Pausing is
  // not a reason to take that away: the countdown follows the remaining time,
  // which stops moving while playback does.
  const autoAdvanceNextEpisode =
    showNextEpisodeFromRemainingTime && !isFinishingEpisode;

  // Reset whenever the item changes. direct-player remounts Controls on an
  // episode switch today, so this mostly covers the mount itself.
  useEffect(() => {
    stillWatchingArmedRef.current = false;
    setStillWatchingVisible(false);
  }, [item.Id]);

  useEffect(() => {
    if (stillWatchingVisible || isFinishingEpisode || maxMs <= 0) {
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
      stillWatchingRequired &&
      // Or a real tick (not the 0/0 placeholder) after a remount inside the
      // last moments, where arming can't happen: the known decision held the
      // countdown back, so the prompt must come or the episode just stops.
      (stillWatchingArmedRef.current ||
        (currentTime > 0 &&
          !!item.Id &&
          peekStillWatchingDecision(item.Id) === true)) &&
      remainingTime <= CONTROLS_CONSTANTS.STILL_WATCHING_EOF_WINDOW_MS
    ) {
      setStillWatchingVisible(true);
      pause();
    }
  }, [
    stillWatchingVisible,
    isFinishingEpisode,
    stillWatchingRequired,
    maxMs,
    currentTime,
    remainingTime,
    pause,
    item.Id,
  ]);

  const goToItemCommon = useCallback(
    (item: BaseItemDto) => {
      if (!item || !settings) {
        return;
      }
      stillWatchingArmedRef.current = false;
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
        offline,
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
          getAdjacentStartTicks(
            item,
            newMediaSource,
            offline,
            serverVersion,
          )?.toString() ?? "",
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
      serverVersion,
    ],
  );

  // Any navigation the viewer picks is a play they started themselves: a new
  // session, as in jellyfin-web. Autoplay goes through goToItemCommon alone.
  const goToItemByUser = useCallback(
    (target: BaseItemDto) => {
      resetStillWatchingSession();
      goToItemCommon(target);
    },
    [goToItemCommon],
  );

  const goToPreviousItem = useCallback(() => {
    if (!previousItem) {
      return;
    }
    goToItemByUser(previousItem);
  }, [previousItem, goToItemByUser]);

  const goToNextItem = useCallback(
    ({ isAutoPlay }: { isAutoPlay?: boolean }) => {
      if (!nextItem || isFinishingEpisode) {
        return;
      }

      // "Continue watching" is a deliberate advance too.
      if (!isAutoPlay) {
        goToItemByUser(nextItem);
        return;
      }

      // A due or unanswered prompt holds autoplay, whoever asks for it; a tap
      // on the shown prompt can make it no longer due.
      if (stillWatchingRequired || stillWatchingVisible) return;
      recordStillWatchingAutoplay();
      goToItemCommon(nextItem);
    },
    [
      nextItem,
      isFinishingEpisode,
      goToItemCommon,
      goToItemByUser,
      stillWatchingRequired,
      stillWatchingVisible,
    ],
  );

  // Add a memoized handler for autoplay next episode
  const handleNextEpisodeAutoPlay = useCallback(() => {
    goToNextItem({ isAutoPlay: true });
  }, [goToNextItem]);

  // Add a memoized handler for manual next episode
  const handleNextEpisodeManual = useCallback(() => {
    if (isFinishingEpisode) return;
    goToNextItem({ isAutoPlay: false });
  }, [goToNextItem, isFinishingEpisode]);
  const handleFinishEpisode = useFinishEpisodeAction(
    item.Id,
    onFinishEpisode,
    handleNextEpisodeManual,
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
        onUserInteraction={markStillWatchingInput}
        interactionBlocked={
          interactionBlocked || stillWatchingVisible || isFinishingEpisode
        }
        panel={
          episodeView ? (
            <EpisodeList
              item={item}
              close={() => setEpisodeView(false)}
              goToItem={goToItemByUser}
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
              willShowNextEpisode={showFinishEpisode || willShowNextEpisode}
              showNextEpisode={showNextEpisode}
              autoAdvanceNextEpisode={autoAdvanceNextEpisode}
              remainingTime={remainingTime}
              isPlaying={isPlaying}
              itemId={item.Id}
              nextIsEpisode={nextItem?.Type === "Episode"}
              skipIntro={onSkipSegment}
              skipCredit={onSkipOutro}
              onNextEpisodeFinish={handleNextEpisodeAutoPlay}
              onNextEpisodePress={
                canFinishEpisode ? handleFinishEpisode : handleNextEpisodeManual
              }
              nextButtonText={
                canFinishEpisode
                  ? t(
                      isFinishingEpisode
                        ? "player.finishing_episode"
                        : "player.finish_and_next_episode",
                    )
                  : undefined
              }
              nextButtonDisabled={isFinishingEpisode}
              controlsVisible={showControls}
              hasChapters={showsChapterIcon}
            />
            <SegmentSkippedNotice segment={skippedNotice} />
          </>
        }
      />
      {stillWatchingVisible && (
        <ContinueWatchingOverlay goToNextItem={goToNextItem} />
      )}
    </>
  );
};
