/*
 * Drag-anywhere-to-seek preview bubble (FEATURES "drag-anywhere, done right",
 * attempt 2 requirement (b)): a dedicated scrub bubble — trickplay thumbnail +
 * timestamp — driven ENTIRELY by SharedValues on the UI thread, independent of
 * react-native-awesome-slider (whose internal bubble only renders during its own
 * gesture — the reason attempt 1 had no thumbnails).
 *
 * Zero per-frame bridge traffic: visibility (opacity) comes from `active` via
 * useAnimatedStyle, and the timestamp/delta texts use the ReText pattern
 * (Animated TextInput + useAnimatedProps writing `text`) so they track the finger
 * at UI-thread rate. Only the trickplay TILE arrives via throttled React state
 * (GestureOverlay's ~120ms onScrubPreview → useTrickplay), which is fine — tiles
 * only change every few seconds of video anyway.
 */
import { Image } from "expo-image";
import type { FC } from "react";
import { StyleSheet, TextInput } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { CONTROLS_CONSTANTS } from "./constants";

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
Animated.addWhitelistedNativeProps({ text: true });

export interface ScrubTrickplayUrl {
  x: number;
  y: number;
  url: string;
}

export interface ScrubTrickplayInfo {
  aspectRatio?: number;
  data: {
    TileWidth?: number;
    TileHeight?: number;
  };
}

function formatMs(ms: number): string {
  "worklet";
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 && m < 10 ? `0${m}` : `${m}`;
  const ss = s < 10 ? `0${s}` : `${s}`;
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Width of the mini progress bar inside the popup (senplayer-style).
const MINI_BAR_WIDTH = 150;

interface Props {
  /** 1 while a scrub drag is in flight (written by the pan worklet). */
  active: SharedValue<number>;
  /** Scrub target position, ms (UI-thread, per frame). */
  scrubMs: SharedValue<number>;
  /** Position when the drag started, ms (for the ± delta readout). */
  startMs: SharedValue<number>;
  /** Total duration, ms (mini progress bar). */
  max: SharedValue<number>;
  trickPlayUrl?: ScrubTrickplayUrl | null;
  trickplayInfo?: ScrubTrickplayInfo | null;
}

export const ScrubBubble: FC<Props> = ({
  active,
  scrubMs,
  startMs,
  max,
  trickPlayUrl,
  trickplayInfo,
}) => {
  const containerStyle = useAnimatedStyle(() => ({
    opacity: withTiming(active.value ? 1 : 0, { duration: 120 }),
  }));

  const miniFillStyle = useAnimatedStyle(() => {
    const dur = max.value || 1;
    const ratio = Math.min(1, Math.max(0, scrubMs.value / dur));
    return { width: ratio * MINI_BAR_WIDTH };
  });

  const timeProps = useAnimatedProps(() => {
    return { text: formatMs(scrubMs.value) } as any;
  });
  const deltaProps = useAnimatedProps(() => {
    const delta = scrubMs.value - startMs.value;
    const sign = delta < 0 ? "−" : "+";
    return { text: `${sign}${formatMs(Math.abs(delta))}` } as any;
  });

  const tileWidth = CONTROLS_CONSTANTS.TILE_WIDTH * 1.4;
  const aspectRatio = trickplayInfo?.aspectRatio ?? 16 / 9;
  const tileHeight = tileWidth / aspectRatio;
  const showTile = !!trickPlayUrl && !!trickplayInfo?.aspectRatio;

  return (
    <Animated.View
      pointerEvents='none'
      style={[styles.container, containerStyle]}
    >
      {showTile && trickPlayUrl ? (
        <Animated.View
          style={[styles.tile, { width: tileWidth, height: tileHeight }]}
        >
          <Image
            cachePolicy='memory-disk'
            style={{
              width: tileWidth * (trickplayInfo?.data.TileWidth ?? 1),
              height: tileHeight * (trickplayInfo?.data.TileHeight ?? 1),
              transform: [
                { translateX: -trickPlayUrl.x * tileWidth },
                { translateY: -trickPlayUrl.y * tileHeight },
              ],
            }}
            source={{ uri: trickPlayUrl.url }}
            contentFit='cover'
          />
        </Animated.View>
      ) : null}
      <Animated.View style={styles.pill}>
        <AnimatedTextInput
          editable={false}
          allowFontScaling={false}
          defaultValue='0:00'
          animatedProps={timeProps}
          style={styles.time}
        />
        <AnimatedTextInput
          editable={false}
          allowFontScaling={false}
          defaultValue='+0:00'
          animatedProps={deltaProps}
          style={styles.delta}
        />
      </Animated.View>
      <Animated.View style={styles.miniTrack}>
        <Animated.View style={[styles.miniFill, miniFillStyle]} />
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: "14%",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 10,
    zIndex: 30,
  },
  tile: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(15,15,15,0.9)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.3)",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  time: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    minWidth: 64,
    textAlign: "center",
    padding: 0,
  },
  delta: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    minWidth: 52,
    textAlign: "center",
    padding: 0,
  },
  miniTrack: {
    width: MINI_BAR_WIDTH,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    overflow: "hidden",
  },
  miniFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "#fff",
  },
});
