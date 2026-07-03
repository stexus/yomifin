/**
 * Tappable subtitle overlay (mpv-driven).
 *
 * Renders the CURRENT subtitle line — as decoded by mpv and pushed via its `sub-text`
 * property (see modules/mpv-player onSubtitleText) — over the libmpv surface as
 * tappable word-spans. On tap it hands Phase 2's forward-greedy lookup the text from
 * the tapped token to the end of the line.
 *
 * No clock interpolation: mpv owns subtitle timing/visibility, so the line appears and
 * clears exactly in sync with playback (and bitmap/PGS subs simply send empty text and
 * render natively). This replaces the old SRT-fetch + 60fps reanimated interpolation,
 * which caused flicker and couldn't handle PGS.
 */

import { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from "react-native";
import { segmentLine, type Token } from "@/utils/yomifin/segment";

export type SubtitleOutline = "none" | "normal" | "strong";

interface Props {
  /** Current subtitle text from mpv (empty string = nothing showing). */
  text: string;
  /**
   * Called on word tap with the text from the tapped token to the end of the line
   * (Phase 2's forward-greedy lookup input) and the tapped token. If omitted, the
   * tap is just logged.
   */
  onWordTap?: (input: string, token: Token) => void;
  /** Rendering QoL (runtime settings; Settings → Reader). */
  fontSize?: number;
  outline?: SubtitleOutline;
  /** Distance of the line stack from the bottom edge (pt). */
  bottomOffset?: number;
}

/** Text shadow params per outline strength (RN has no true stroke). */
function outlineStyle(outline: SubtitleOutline): Partial<TextStyle> {
  switch (outline) {
    case "none":
      return {};
    case "strong":
      return {
        textShadowColor: "rgba(0,0,0,1)",
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 7,
      };
    default:
      return {
        textShadowColor: "rgba(0,0,0,0.95)",
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
      };
  }
}

export default function TappableSubtitleOverlay({
  text,
  onWordTap,
  fontSize = 32,
  outline = "normal",
  bottomOffset = 64,
}: Props) {
  const textStyle = useMemo<TextStyle>(
    () => ({
      color: "white",
      fontSize,
      fontWeight: "600",
      lineHeight: Math.ceil(fontSize * 1.3),
      ...outlineStyle(outline),
    }),
    [fontSize, outline],
  );

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

  const trimmed = text?.trim();
  if (!trimmed) return null;

  const lines = trimmed.split("\n");

  return (
    <View
      pointerEvents='box-none'
      style={[styles.container, { bottom: bottomOffset }]}
    >
      <View pointerEvents='box-none' style={styles.lineStack}>
        {lines.map((line, li) => {
          const tokens = segmentLine(line);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable within a static line
            <View key={li} pointerEvents='box-none' style={styles.row}>
              {tokens.map((tok, ti) =>
                tok.isWhitespace ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional gap
                  <Text key={ti} style={textStyle}>
                    {tok.text}
                  </Text>
                ) : (
                  <Pressable
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional token
                    key={ti}
                    onPress={() => handleTokenPress(tok, line)}
                    hitSlop={4}
                  >
                    <Text style={textStyle}>{tok.text}</Text>
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
});
