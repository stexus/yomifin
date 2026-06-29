/**
 * Phase 1 — tappable subtitle overlay.
 *
 * Renders the currently-active subtitle line over the libmpv surface as tappable
 * word-spans. On tap it logs the tapped token and the text from that token to the
 * end of the line (the input Phase 2's forward-greedy lookup will consume).
 *
 * SYNC: mpv pushes its position only ~1x/sec (a deliberate native battery
 * throttle). To avoid up-to-1s subtitle lag we INTERPOLATE the clock on the UI
 * thread with a 60fps frame callback: anchor to each native position update, then
 * advance by elapsed wall-time * speed — but only while playing (so pausing to do
 * a lookup freezes the line correctly). The active-cue index is computed inside the
 * worklet; we only cross to JS when the visible line actually changes.
 */

import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  runOnJS,
  type SharedValue,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import { segmentLine, type Token } from "@/utils/yomifin/segment";
import type { SubtitleCue } from "@/utils/yomifin/srt";

interface Props {
  cues: SubtitleCue[];
  /** Latest known playback position in milliseconds (updated ~1x/sec). */
  progressMs: SharedValue<number>;
  /** Whether playback is currently running (freezes interpolation when false). */
  isPlaying: boolean;
  /** Playback speed multiplier (1.0 = normal). */
  speed: number;
  /**
   * Called on word tap with the text from the tapped token to the end of the line
   * (Phase 2's forward-greedy lookup input) and the tapped token. If omitted, the
   * tap is just logged (Phase 1 behavior).
   */
  onWordTap?: (input: string, token: Token) => void;
}

export default function TappableSubtitleOverlay({
  cues,
  progressMs,
  isPlaying,
  speed,
  onWordTap,
}: Props) {
  const handleTokenPress = (token: Token, line: string) => {
    const fromHere = line.slice(token.start);
    if (onWordTap) {
      onWordTap(fromHere, token);
    } else {
      console.log(
        `[YOMIFIN SUB] tapped "${token.text}" → lookup input: "${fromHere}"`,
      );
    }
  };
  const [activeIndex, setActiveIndex] = useState(-1);

  // Mirror playing/speed into shared values for the worklet.
  const playingSV = useSharedValue(isPlaying ? 1 : 0);
  const speedSV = useSharedValue(speed || 1);
  useEffect(() => {
    playingSV.value = isPlaying ? 1 : 0;
  }, [isPlaying, playingSV]);
  useEffect(() => {
    speedSV.value = speed || 1;
  }, [speed, speedSV]);

  // Worklet-readable cue bounds (ascending by start). Stable for the item.
  const bounds = useMemo(
    () => cues.map((c) => [c.startMs, c.endMs] as [number, number]),
    [cues],
  );

  // Interpolation anchors.
  const lastSeen = useSharedValue(-1);
  const anchorPos = useSharedValue(0);
  const anchorT = useSharedValue(0);
  const activeIdxSV = useSharedValue(-1);

  useFrameCallback((frame) => {
    "worklet";
    const t = frame.timeSinceFirstFrame;

    // Re-anchor whenever a fresh native position arrives (also covers seeks).
    if (progressMs.value !== lastSeen.value) {
      lastSeen.value = progressMs.value;
      anchorPos.value = progressMs.value;
      anchorT.value = t;
    }

    const est =
      playingSV.value === 1
        ? anchorPos.value + (t - anchorT.value) * speedSV.value
        : anchorPos.value;

    let idx = -1;
    for (let i = 0; i < bounds.length; i++) {
      if (est >= bounds[i][0] && est <= bounds[i][1]) {
        idx = i;
        break;
      }
    }

    if (idx !== activeIdxSV.value) {
      activeIdxSV.value = idx;
      runOnJS(setActiveIndex)(idx);
    }
  });

  const active = activeIndex >= 0 ? cues[activeIndex] : null;
  if (!active) return null;

  const lines = active.text.split("\n");

  return (
    <View pointerEvents='box-none' style={styles.container}>
      <View pointerEvents='box-none' style={styles.lineStack}>
        {lines.map((line, li) => {
          const tokens = segmentLine(line);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable within a static line
            <View key={li} pointerEvents='box-none' style={styles.row}>
              {tokens.map((tok, ti) =>
                tok.isWhitespace ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional gap
                  <Text key={ti} style={styles.text}>
                    {tok.text}
                  </Text>
                ) : (
                  <Pressable
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional token
                    key={ti}
                    onPress={() => handleTokenPress(tok, line)}
                    hitSlop={4}
                  >
                    <Text style={styles.text}>{tok.text}</Text>
                  </Pressable>
                ),
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 64,
    alignItems: "center",
    zIndex: 9999,
  },
  lineStack: {
    alignItems: "center",
    maxWidth: "92%",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  text: {
    color: "white",
    fontSize: 32,
    fontWeight: "600",
    lineHeight: 42,
    textShadowColor: "rgba(0,0,0,0.95)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
