/*
 * ScrubProgressBar — the sleek bottom progress bar that pops up on its own during a
 * drag-anywhere-to-seek WHILE THE CONTROL PANE IS HIDDEN (senplayer behaviour). It's
 * read-only (the pan worklet writes `progress` live); the full interactive slider in
 * BottomControls is used when the controls are up.
 *
 * Keeps chapter ticks so scrubbing across chapters stays legible.
 */

import type { ChapterInfo } from "@jellyfin/sdk/lib/generated-client";
import type { FC } from "react";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Slider } from "react-native-awesome-slider";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ChapterTicks } from "@/components/chapters/ChapterTicks";
import { useControlsSafeAreaInsets } from "@/hooks/useControlsSafeAreaInsets";
import { chapterMarkers } from "@/utils/chapters";

const TICK_HEIGHT = 8;

interface Props {
  visible: boolean;
  progress: SharedValue<number>;
  min: SharedValue<number>;
  max: SharedValue<number>;
  cacheProgress: SharedValue<number>;
  chapters?: ChapterInfo[] | null;
  durationMs: number;
}

export const ScrubProgressBar: FC<Props> = ({
  visible,
  progress,
  min,
  max,
  cacheProgress,
  chapters,
  durationMs,
}) => {
  const insets = useControlsSafeAreaInsets();

  const opacity = useSharedValue(0);
  opacity.value = withTiming(visible ? 1 : 0, { duration: 150 });
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const markers = useMemo(
    () => chapterMarkers(chapters, durationMs),
    [chapters, durationMs],
  );

  return (
    <Animated.View
      pointerEvents='none'
      style={[
        styles.container,
        {
          left: insets.left + 16,
          right: insets.right + 16,
          bottom: Math.max(insets.bottom + 14, 20),
        },
        style,
      ]}
    >
      <View style={styles.track}>
        <Slider
          theme={{
            maximumTrackTintColor: "rgba(255,255,255,0.25)",
            minimumTrackTintColor: "#fff",
            cacheTrackTintColor: "rgba(255,255,255,0.35)",
          }}
          renderThumb={() => null}
          renderBubble={() => null}
          disable
          cache={cacheProgress}
          containerStyle={{ borderRadius: 100 }}
          sliderHeight={5}
          thumbWidth={0}
          progress={progress}
          minimumValue={min}
          maximumValue={max}
        />
        <ChapterTicks markers={markers} height={TICK_HEIGHT} />
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    zIndex: 15,
  },
  track: {
    height: 5,
    justifyContent: "center",
    overflow: "visible",
  },
});
