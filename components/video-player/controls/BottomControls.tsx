import { Ionicons } from "@expo/vector-icons";
import type {
  BaseItemDto,
  ChapterInfo,
} from "@jellyfin/sdk/lib/generated-client";
import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, TouchableOpacity, View } from "react-native";
import { Slider } from "react-native-awesome-slider";
import { type SharedValue } from "react-native-reanimated";
import { ChapterList } from "@/components/chapters/ChapterList";
import { ChapterTicks } from "@/components/chapters/ChapterTicks";
import { Text } from "@/components/common/Text";
import { Loader } from "@/components/Loader";
import { useControlsSafeAreaInsets } from "@/hooks/useControlsSafeAreaInsets";
import { useSettings } from "@/utils/atoms/settings";
import { chapterMarkers, chapterNameAt } from "@/utils/chapters";
import { formatTimeString } from "@/utils/time";
import DropdownView from "./dropdown/DropdownView";
import NextEpisodeCountDownButton from "./NextEpisodeCountDownButton";
import SkipButton from "./SkipButton";
import { TrickplayBubble } from "./TrickplayBubble";

// Sleek progress bar height (thinner than the old 10px) + chapter tick height.
const SLIDER_HEIGHT = 6;
const TICK_HEIGHT = 9;

interface BottomControlsProps {
  item: BaseItemDto;
  /** Item chapters, used for the tick overlay and chapter list. */
  chapters?: ChapterInfo[] | null;
  /** Total media duration in milliseconds. */
  durationMs: number;
  showControls: boolean;
  isSliding: boolean;
  showRemoteBubble: boolean;
  currentTime: number;
  remainingTime: number;
  showSkipButton: boolean;
  showSkipCreditButton: boolean;
  hasContentAfterCredits: boolean;
  skipIntro: () => void;
  skipCredit: () => void;
  nextItem?: BaseItemDto | null;
  previousItem?: BaseItemDto | null;
  handleNextEpisodeAutoPlay: () => void;
  handleNextEpisodeManual: () => void;
  handleControlsInteraction: () => void;

  // ---- control cluster (below the bar) ----
  isPlaying: boolean;
  isBuffering: boolean;
  togglePlay: () => void;
  handleSkipBackward: () => void;
  handleSkipForward: () => void;
  showSubtitleNav?: boolean;
  onPrevSubtitle?: () => void;
  onNextSubtitle?: () => void;
  goToPreviousItem: () => void;
  goToNextItem: (options: { isAutoPlay?: boolean }) => void;

  // Slider props
  min: SharedValue<number>;
  max: SharedValue<number>;
  effectiveProgress: SharedValue<number>;
  cacheProgress: SharedValue<number>;
  handleSliderStart: () => void;
  handleSliderComplete: (value: number) => void;
  handleSliderChange: (value: number) => void;
  handleTouchStart: () => void;
  handleTouchEnd: () => void;
  /** Programmatic seek (chapter list, hotkeys) — bypasses slide gesture state. */
  seekTo: (value: number) => void;

  // Trickplay props
  trickPlayUrl: {
    x: number;
    y: number;
    url: string;
  } | null;
  trickplayInfo: {
    aspectRatio?: number;
    data: {
      TileWidth?: number;
      TileHeight?: number;
    };
  } | null;
  time: {
    hours: number;
    minutes: number;
    seconds: number;
  };
}

const ICON = "white";

export const BottomControls: FC<BottomControlsProps> = ({
  item,
  chapters,
  durationMs,
  showControls,
  isSliding,
  showRemoteBubble,
  currentTime,
  remainingTime,
  showSkipButton,
  showSkipCreditButton,
  hasContentAfterCredits,
  skipIntro,
  skipCredit,
  nextItem,
  previousItem,
  handleNextEpisodeAutoPlay,
  handleNextEpisodeManual,
  handleControlsInteraction,
  isPlaying,
  isBuffering,
  togglePlay,
  handleSkipBackward,
  handleSkipForward,
  showSubtitleNav = false,
  onPrevSubtitle,
  onNextSubtitle,
  goToPreviousItem,
  goToNextItem,
  min,
  max,
  effectiveProgress,
  cacheProgress,
  handleSliderStart,
  handleSliderComplete,
  handleSliderChange,
  handleTouchStart,
  handleTouchEnd,
  seekTo,
  trickPlayUrl,
  trickplayInfo,
  time,
}) => {
  const { settings } = useSettings();
  const { t } = useTranslation();
  const insets = useControlsSafeAreaInsets();
  const [chapterListVisible, setChapterListVisible] = useState(false);
  // Right-hand time label cycles: 0 = total length, 1 = -remaining, 2 = ends-at.
  const [timeMode, setTimeMode] = useState(0);

  const chapterMarkerList = useMemo(
    () => chapterMarkers(chapters, durationMs),
    [chapters, durationMs],
  );
  const hasChapters = chapterMarkerList.length > 1;

  const currentChapterName = useMemo(
    () => (hasChapters ? chapterNameAt(currentTime, chapters) : null),
    [hasChapters, currentTime, chapters],
  );

  const scrubChapterName = useMemo(() => {
    if (!hasChapters) return null;
    const scrubMs =
      (time.hours * 3600 + time.minutes * 60 + time.seconds) * 1000;
    return chapterNameAt(scrubMs, chapters);
  }, [hasChapters, time.hours, time.minutes, time.seconds, chapters]);

  const rightTimeLabel = useMemo(() => {
    if (timeMode === 1) return `-${formatTimeString(remainingTime, "ms")}`;
    if (timeMode === 2) {
      const finish = new Date(Date.now() + remainingTime);
      return t("player.ends_at", {
        time: finish.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      });
    }
    return formatTimeString(durationMs, "ms");
  }, [timeMode, remainingTime, durationMs, t]);

  const rewind = settings?.rewindSkipTime ?? 10;
  const forward = settings?.forwardSkipTime ?? 10;

  // Fixed width for the time columns so the flanking labels can't change width as the
  // digits roll over (e.g. 9:59 → 10:00). Without this the flex:1 slider re-lays-out
  // every tick and the bar visibly flickers — most obvious while subtitle-seeking,
  // which fires rapid position jumps. Sized to the (constant) duration string.
  const timeColWidth = useMemo(() => {
    const chars = formatTimeString(durationMs, "ms").length;
    return Math.max(46, Math.ceil(chars * 8) + 6);
  }, [durationMs]);

  return (
    <View
      style={{
        position: "absolute",
        right: insets.right,
        left: insets.left,
        bottom: Math.max(insets.bottom - 6, 4),
      }}
      className='flex flex-col px-4'
      onTouchStart={handleControlsInteraction}
      pointerEvents={showControls ? "box-none" : "none"}
    >
      {/* ---- Row A: subtitle/audio pickers (left) · skip buttons (right) ---- */}
      <View
        className='flex flex-row items-center justify-between'
        style={{ minHeight: 40 }}
      >
        <View className='flex flex-row items-center' pointerEvents='auto'>
          {!Platform.isTV && <DropdownView variant='subtitles' />}
          {!Platform.isTV && <DropdownView variant='audio' />}
        </View>

        {currentChapterName ? (
          <Text
            className='text-xs opacity-70 shrink mx-2'
            numberOfLines={1}
            style={{ flex: 1, textAlign: "center" }}
          >
            {currentChapterName}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        <View
          className='flex flex-row items-center space-x-2 shrink-0'
          pointerEvents='auto'
        >
          <SkipButton
            showButton={showSkipButton}
            onPress={skipIntro}
            buttonText='Skip Intro'
          />
          <SkipButton
            showButton={
              showSkipCreditButton && (hasContentAfterCredits || !nextItem)
            }
            onPress={skipCredit}
            buttonText='Skip Credits'
          />
          {settings.autoPlayNextEpisode !== false &&
            (settings.maxAutoPlayEpisodeCount.value === -1 ||
              settings.autoPlayEpisodeCount <
                settings.maxAutoPlayEpisodeCount.value) && (
              <NextEpisodeCountDownButton
                show={
                  !nextItem
                    ? false
                    : (showSkipCreditButton && !hasContentAfterCredits) ||
                      remainingTime < 10000
                }
                onFinish={handleNextEpisodeAutoPlay}
                onPress={handleNextEpisodeManual}
              />
            )}
          {hasChapters && (
            <Pressable
              onPress={() => setChapterListVisible(true)}
              hitSlop={10}
              className='justify-center ml-2'
              accessibilityRole='button'
              accessibilityLabel={t("chapters.open")}
            >
              <Ionicons name='bookmarks' size={22} color={ICON} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ---- Row B: current time · sleek slider · length (tappable) ---- */}
      <View
        className='flex flex-row items-center my-1'
        pointerEvents='box-none'
      >
        <Text
          className='text-[12px] text-neutral-300 mr-3'
          numberOfLines={1}
          style={{
            fontVariant: ["tabular-nums"],
            width: timeColWidth,
            textAlign: "left",
          }}
        >
          {formatTimeString(currentTime, "ms")}
        </Text>
        <View
          style={{
            flex: 1,
            height: SLIDER_HEIGHT,
            justifyContent: "center",
            overflow: "visible",
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          pointerEvents='auto'
        >
          <Slider
            theme={{
              maximumTrackTintColor: "rgba(255,255,255,0.2)",
              minimumTrackTintColor: "#fff",
              cacheTrackTintColor: "rgba(255,255,255,0.3)",
              bubbleBackgroundColor: "#fff",
              bubbleTextColor: "#666",
              heartbeatColor: "#999",
            }}
            renderThumb={() => null}
            cache={cacheProgress}
            onSlidingStart={handleSliderStart}
            onSlidingComplete={handleSliderComplete}
            onValueChange={handleSliderChange}
            containerStyle={{ borderRadius: 100 }}
            renderBubble={() =>
              (isSliding || showRemoteBubble) && (
                <TrickplayBubble
                  trickPlayUrl={trickPlayUrl}
                  trickplayInfo={trickplayInfo}
                  time={time}
                  chapterName={scrubChapterName}
                />
              )
            }
            sliderHeight={SLIDER_HEIGHT}
            thumbWidth={0}
            progress={effectiveProgress}
            minimumValue={min}
            maximumValue={max}
          />
          <ChapterTicks markers={chapterMarkerList} height={TICK_HEIGHT} />
        </View>
        <Pressable
          onPress={() => setTimeMode((m) => (m + 1) % 3)}
          hitSlop={10}
          className='ml-3'
          pointerEvents='auto'
          // Fixed width so the ticking label can't jitter the slider. The ends-at
          // mode may be a touch wider — allow it to grow only there (a one-off shift
          // on an explicit tap, never during playback/seeking).
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

      {/* ---- Row C: control cluster (below the bar) ---- */}
      {!Platform.isTV && (
        <View
          className='flex flex-row items-center justify-center'
          style={{ gap: 26, paddingVertical: 6 }}
          pointerEvents='auto'
        >
          {previousItem && (
            <TouchableOpacity onPress={goToPreviousItem} hitSlop={8}>
              <Ionicons name='play-skip-back' size={26} color={ICON} />
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={handleSkipBackward} hitSlop={8}>
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
                {rewind}
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

          <TouchableOpacity onPress={togglePlay} hitSlop={10}>
            {/* Fixed 46×46 box so swapping the play icon for the buffering Loader
                can't change Row C's height — the whole stack is bottom-anchored, so a
                height change there pushes the progress bar up/down (flicker). */}
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

          <TouchableOpacity onPress={handleSkipForward} hitSlop={8}>
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
                {forward}
              </Text>
            </View>
          </TouchableOpacity>

          {nextItem && (
            <TouchableOpacity
              onPress={() => goToNextItem({ isAutoPlay: false })}
              hitSlop={8}
            >
              <Ionicons name='play-skip-forward' size={26} color={ICON} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <ChapterList
        visible={chapterListVisible}
        chapters={chapters}
        currentPositionMs={currentTime}
        onSeek={seekTo}
        onClose={() => setChapterListVisible(false)}
      />
    </View>
  );
};
