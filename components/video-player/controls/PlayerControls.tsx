import type { ChapterInfo } from "@jellyfin/sdk/lib/generated-client";
import { useKeyEventListener } from "expo-key-event";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Loader } from "@/components/Loader";
import {
  PLAYER_CONTROLS_ANIMATION_MS,
  PLAYER_CONTROLS_TIMEOUT_MS,
} from "@/constants/PlayerUI";
import type { TechnicalInfo } from "@/modules/mpv-player";
import { msToTicks } from "@/utils/time";
import { BottomControls } from "./BottomControls";
import { ControlsScrims } from "./ControlsScrims";
import { CONTROLS_CONSTANTS } from "./constants";
import { GestureOverlay } from "./GestureOverlay";
import { HeaderControls } from "./HeaderControls";
import { useRemoteControl } from "./hooks/useRemoteControl";
import { useVideoNavigation } from "./hooks/useVideoNavigation";
import { useVideoSlider } from "./hooks/useVideoSlider";
import { useVideoTime } from "./hooks/useVideoTime";
import { PlayerInteractionContext } from "./PlayerInteraction";
import { PlayerStatusBar } from "./PlayerStatusBar";
import { ScrubProgressBar } from "./ScrubProgressBar";
import { useControlsTimeout } from "./useControlsTimeout";
import { clampPositionMs } from "./utils/playerPresentation";

type BottomProps = ComponentProps<typeof BottomControls>;
export interface PlayerControlsProps {
  title: string;
  durationMs: number;
  progress: SharedValue<number>;
  cacheProgress: SharedValue<number>;
  isSeeking: SharedValue<boolean>;
  isPlaying: boolean;
  isBuffering: boolean;
  showControls: boolean;
  setShowControls: (shown: boolean) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /** Absolute media position in milliseconds. */
  seek: (positionMs: number) => void;
  onClose: () => void;
  menu: ReactNode;
  trackMenus: ReactNode;
  profilePill?: ReactNode;
  twoFingerNonce?: number;
  onHoldSpeedStart?: () => void;
  onHoldSpeedEnd?: () => void;
  startPictureInPicture?: () => Promise<void>;
  isZoomedToFill?: boolean;
  onZoomToggle?: () => void;
  onOpenEpisodes?: () => void;
  onPreviousEpisode?: () => void;
  onNextEpisode?: () => void;
  showSubtitleNav?: boolean;
  onPrevSubtitle?: () => void;
  onNextSubtitle?: () => void;
  chapters?: ChapterInfo[] | null;
  getTechnicalInfo?: () => Promise<TechnicalInfo>;
  trickPlayUrl?: BottomProps["trickPlayUrl"];
  trickplayInfo?: BottomProps["trickplayInfo"];
  calculateTrickplayUrl?: (ticks: number) => void;
  panel?: ReactNode;
  overlays?: ReactNode;
  interactionBlocked?: boolean;
}
const noPreview = () => {};
const animation = {
  duration: PLAYER_CONTROLS_ANIMATION_MS,
  easing: Easing.out(Easing.quad),
};

/** Shared mobile chrome and interaction policy. Source adapters own playback sessions. */
export function PlayerControls({
  title,
  durationMs,
  progress,
  cacheProgress,
  isSeeking,
  isPlaying,
  isBuffering,
  showControls,
  setShowControls,
  play,
  pause,
  togglePlay,
  seek: seekSource,
  onClose,
  menu,
  trackMenus,
  profilePill,
  twoFingerNonce,
  onHoldSpeedStart,
  onHoldSpeedEnd,
  startPictureInPicture,
  isZoomedToFill,
  onZoomToggle,
  onOpenEpisodes,
  onPreviousEpisode,
  onNextEpisode,
  showSubtitleNav,
  onPrevSubtitle,
  onNextSubtitle,
  chapters,
  getTechnicalInfo,
  trickPlayUrl = null,
  trickplayInfo = null,
  calculateTrickplayUrl = noPreview,
  panel,
  overlays,
  interactionBlocked = false,
}: PlayerControlsProps) {
  const { width, height } = useWindowDimensions();
  const min = useSharedValue(0);
  const max = useSharedValue(durationMs);
  useEffect(() => {
    max.value = durationMs;
  }, [max, durationMs]);
  const seek = useCallback(
    (ms: number) => {
      const target = clampPositionMs(ms, durationMs);
      progress.value = target;
      seekSource(target);
    },
    [durationMs, progress, seekSource],
  );
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [holdingSpeed, setHoldingSpeed] = useState(false);
  const [openPanels, setOpenPanels] = useState<Set<string>>(() => new Set());
  const setPanelOpen = useCallback((name: string, open: boolean) => {
    setOpenPanels((previous) => {
      if (previous.has(name) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);
  const interaction = useMemo(() => ({ setPanelOpen }), [setPanelOpen]);
  const onChapterPanelChange = useCallback(
    (open: boolean) => setPanelOpen("chapters", open),
    [setPanelOpen],
  );
  const controlsOpacity = useSharedValue(showControls ? 1 : 0);
  const headerY = useSharedValue(showControls ? 0 : -10);
  const bottomY = useSharedValue(showControls ? 0 : 10);
  useEffect(() => {
    controlsOpacity.value = withTiming(
      showControls
        ? holdingSpeed
          ? CONTROLS_CONSTANTS.HOLD_SPEED_DIM_OPACITY
          : 1
        : 0,
      animation,
    );
    headerY.value = withTiming(showControls ? 0 : -10, animation);
    bottomY.value = withTiming(showControls ? 0 : 10, animation);
  }, [showControls, holdingSpeed, controlsOpacity, headerY, bottomY]);
  const headerStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
    transform: [{ translateY: headerY.value }],
  }));
  const bottomStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
    transform: [{ translateY: bottomY.value }],
  }));
  const holdStart = useCallback(() => {
    setHoldingSpeed(true);
    onHoldSpeedStart?.();
  }, [onHoldSpeedStart]);
  const holdEnd = useCallback(() => {
    setHoldingSpeed(false);
    onHoldSpeedEnd?.();
  }, [onHoldSpeedEnd]);
  const {
    handleSkipBackward,
    handleSkipForward,
    handleSeekBackward,
    handleSeekForward,
  } = useVideoNavigation({ progress, isPlaying, seek, play });
  const seekRelative = useCallback(
    (seconds: number) => {
      if (seconds >= 0) void handleSeekForward(seconds);
      else void handleSeekBackward(-seconds);
    },
    [handleSeekForward, handleSeekBackward],
  );
  const toggleControls = useCallback(
    () => setShowControls(!showControls),
    [showControls, setShowControls],
  );
  const hideControls = useCallback(
    () => setShowControls(false),
    [setShowControls],
  );
  const wasPlayingBeforeScrub = useRef(false);
  const scrubStart = useCallback(() => {
    wasPlayingBeforeScrub.current = isPlaying;
    setIsScrubbing(true);
    pause();
  }, [isPlaying, pause]);
  const scrubPreview = useCallback(
    (ms: number) => calculateTrickplayUrl(msToTicks(ms)),
    [calculateTrickplayUrl],
  );
  const scrubEnd = useCallback(
    (ms: number) => {
      seek(ms);
      setIsScrubbing(false);
      if (wasPlayingBeforeScrub.current) play();
    },
    [seek, play],
  );
  const { currentTime, remainingTime } = useVideoTime({
    progress,
    max,
    isSeeking,
  });
  const remote = useRemoteControl({
    progress,
    min,
    max,
    showControls,
    isPlaying,
    seek,
    play,
    togglePlay,
    toggleControls,
    calculateTrickplayUrl,
    handleSeekForward,
    handleSeekBackward,
  });
  const slider = useVideoSlider({
    progress,
    isSeeking,
    isPlaying,
    seek,
    play,
    pause,
    calculateTrickplayUrl,
    showControls,
  });
  const effectiveProgress = useSharedValue(0);
  const { isRemoteScrubbing, remoteScrubProgress } = remote;
  useAnimatedReaction(
    () =>
      isRemoteScrubbing.value
        ? (remoteScrubProgress.value ?? progress.value)
        : progress.value,
    (value) => {
      effectiveProgress.value = value;
    },
  );
  const { handleControlsInteraction } = useControlsTimeout({
    showControls,
    isSliding:
      slider.isSliding || remote.isSliding || isScrubbing || holdingSpeed,
    episodeView: Boolean(panel) || openPanels.size > 0 || interactionBlocked,
    onHideControls: hideControls,
    timeout: PLAYER_CONTROLS_TIMEOUT_MS,
  });
  useKeyEventListener((event) => {
    if (
      panel ||
      openPanels.size ||
      interactionBlocked ||
      event?.eventType !== "press"
    )
      return;
    handleControlsInteraction();
    if ([" ", "Space", "Spacebar"].includes(event.key)) togglePlay();
    else if (!Platform.isTV && event.key === "ArrowLeft")
      void handleSkipBackward();
    else if (!Platform.isTV && event.key === "ArrowRight")
      void handleSkipForward();
  });
  return (
    <PlayerInteractionContext.Provider value={interaction}>
      <View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
        {panel || (
          <>
            <GestureOverlay
              screenWidth={width}
              screenHeight={height}
              showControls={showControls}
              isPlaying={isPlaying}
              onToggleControls={toggleControls}
              twoFingerNonce={twoFingerNonce}
              onSeekRelative={seekRelative}
              onSkipForward={handleSkipForward}
              onSkipBackward={handleSkipBackward}
              onTogglePlay={togglePlay}
              onHoldSpeedStart={holdStart}
              onHoldSpeedEnd={holdEnd}
              progress={progress}
              max={max}
              isSeeking={isSeeking}
              onScrubStart={scrubStart}
              onScrubPreview={scrubPreview}
              onScrubEnd={scrubEnd}
              trickPlayUrl={trickPlayUrl}
              trickplayInfo={trickplayInfo}
            />
            <ControlsScrims showControls={showControls} />
            <PlayerStatusBar
              title={title}
              showControls={showControls}
              getTechnicalInfo={getTechnicalInfo}
            />
            {isBuffering && !showControls && (
              <View style={styles.spinner} pointerEvents='none'>
                <Loader size='large' />
              </View>
            )}
            <ScrubProgressBar
              visible={isScrubbing && !showControls}
              progress={progress}
              min={min}
              max={max}
              cacheProgress={cacheProgress}
              chapters={chapters}
              durationMs={durationMs}
            />
            <Animated.View
              style={[styles.header, headerStyle]}
              pointerEvents={showControls ? "box-none" : "none"}
              onTouchStart={handleControlsInteraction}
            >
              <HeaderControls
                showControls={showControls}
                onClose={onClose}
                menu={menu}
                leftSlot={profilePill}
                startPictureInPicture={startPictureInPicture}
                switchOnEpisodeMode={onOpenEpisodes}
                isZoomedToFill={isZoomedToFill}
                onZoomToggle={onZoomToggle}
              />
            </Animated.View>
            <Animated.View
              style={[styles.bottom, bottomStyle]}
              pointerEvents={showControls ? "box-none" : "none"}
            >
              <BottomControls
                trackMenus={trackMenus}
                onPanelOpenChange={onChapterPanelChange}
                chapters={chapters}
                durationMs={durationMs}
                showControls={showControls}
                isSliding={slider.isSliding}
                showRemoteBubble={remote.showRemoteBubble}
                currentTime={currentTime}
                remainingTime={remainingTime}
                handleControlsInteraction={handleControlsInteraction}
                isPlaying={isPlaying}
                isBuffering={isBuffering}
                togglePlay={togglePlay}
                handleSkipBackward={handleSkipBackward}
                handleSkipForward={handleSkipForward}
                showSubtitleNav={showSubtitleNav}
                onPrevSubtitle={onPrevSubtitle}
                onNextSubtitle={onNextSubtitle}
                goToPreviousItem={onPreviousEpisode}
                goToNextItem={onNextEpisode}
                min={min}
                max={max}
                effectiveProgress={effectiveProgress}
                cacheProgress={cacheProgress}
                handleSliderStart={slider.handleSliderStart}
                handleSliderComplete={slider.handleSliderComplete}
                handleSliderChange={slider.handleSliderChange}
                seekTo={slider.seekTo}
                trickPlayUrl={trickPlayUrl}
                trickplayInfo={trickplayInfo}
                time={remote.showRemoteBubble ? remote.time : slider.time}
              />
            </Animated.View>
            {overlays}
          </>
        )}
      </View>
    </PlayerInteractionContext.Provider>
  );
}
const styles = StyleSheet.create({
  header: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  bottom: { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10 },
  spinner: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 6,
  },
});
