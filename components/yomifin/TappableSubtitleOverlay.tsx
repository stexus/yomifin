/**
 * Tappable subtitle overlay (mpv-driven).
 *
 * Renders the CURRENT subtitle line — as decoded by mpv and pushed via its `sub-text`
 * property (see modules/mpv-player onSubtitleText) — over the libmpv surface as
 * tappable text. On tap it hands Phase 2's forward-greedy lookup the text from the
 * tapped position to the end of the line.
 *
 * No clock interpolation: mpv owns subtitle timing/visibility, so the line appears and
 * clears exactly in sync with playback (and bitmap/PGS subs simply send empty text and
 * render natively).
 *
 * RENDERING — two paths:
 *  1. NATIVE (iOS, modules/outlined-text): TextKit draws the text with a real stroke
 *     (black outline fully outside the glyph, round joins — the Infuse look) and does
 *     per-character tap hit-testing via the SAME layout (`onCharacterTap` → char
 *     index → token mapping here). RN cannot express a text stroke: `textShadow` is a
 *     blur, and the 8×-stacked-copies JS trick anti-aliases into mush (tried, looked
 *     fuzzy on device). Off-glyph touches pass through natively (point(inside:)), so
 *     controls-toggle taps beside the text still work.
 *  2. JS FALLBACK (stale binary / non-iOS): per-token Pressables; outline approximated
 *     with crisp (no-blur) stacked black copies — worse than native, better than none.
 */

import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from "react-native";
import { OutlinedTextView } from "@/modules";
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
  /** Rendering QoL (runtime settings; Settings → Reader + player dropdown). */
  fontSize?: number;
  outline?: SubtitleOutline;
  /** Distance of the line stack from the bottom edge (pt). */
  bottomOffset?: number;
}

/** Outline thickness in pt, scaled with the font (32pt → 2pt; strong = +1). */
function outlineWidthFor(outline: SubtitleOutline, fontSize: number): number {
  if (outline === "none") return 0;
  const base = Math.max(1, Math.round(fontSize / 16));
  return outline === "strong" ? base + 1 : base;
}

function handleTap(
  token: Token,
  line: string,
  onWordTap?: (input: string, token: Token) => void,
) {
  const fromHere = line.slice(token.start);
  if (onWordTap) {
    onWordTap(fromHere, token);
  } else {
    console.log(
      `[YOMIFIN SUB] tapped "${token.text}" → lookup input: "${fromHere}"`,
    );
  }
}

export default function TappableSubtitleOverlay({
  text,
  onWordTap,
  fontSize = 32,
  outline = "normal",
  bottomOffset = 64,
}: Props) {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return null;
  const common = { trimmed, onWordTap, fontSize, outline, bottomOffset };
  return OutlinedTextView ? (
    <NativeOverlay {...common} />
  ) : (
    <FallbackOverlay {...common} />
  );
}

interface OverlayProps {
  trimmed: string;
  onWordTap?: (input: string, token: Token) => void;
  fontSize: number;
  outline: SubtitleOutline;
  bottomOffset: number;
}

/* ────────────────────────── native path (iOS) ────────────────────────── */

function NativeOverlay({
  trimmed,
  onWordTap,
  fontSize,
  outline,
  bottomOffset,
}: OverlayProps) {
  const Native = OutlinedTextView;
  const outlineWidth = outlineWidthFor(outline, fontSize);
  const lineHeight = Math.ceil(fontSize * 1.3);
  // Native reports the wrapped height for our width; until it arrives (and whenever
  // the cue changes — a measurement is only valid for ITS text), guess from the
  // explicit line count (wrapping is rare — subs come pre-broken).
  const [measured, setMeasured] = useState<{
    text: string;
    height: number;
  } | null>(null);
  const lines = trimmed.split("\n");
  const guessedHeight = lines.length * lineHeight + Math.ceil(outlineWidth) * 2;
  const height = measured?.text === trimmed ? measured.height : guessedHeight;

  // Map the native char index (into `trimmed`) to a line + token, mirroring the
  // fallback path's semantics: lookup input = tapped token → end of ITS line.
  const handleCharacterTap = (index: number) => {
    let lineStart = 0;
    for (const line of lines) {
      const lineEnd = lineStart + line.length; // exclusive; +1 below skips the \n
      if (index < lineEnd) {
        const local = index - lineStart;
        if (local < 0) return; // the \n itself
        const tokens = segmentLine(line);
        const token = tokens.find(
          (t) => local >= t.start && local < t.start + t.text.length,
        );
        if (!token || token.isWhitespace) return;
        handleTap(token, line, onWordTap);
        return;
      }
      lineStart = lineEnd + 1;
    }
  };

  if (!Native) return null;
  return (
    <View
      pointerEvents='box-none'
      style={[styles.container, { bottom: bottomOffset }]}
    >
      <Native
        text={trimmed}
        fontSize={fontSize}
        fontWeight={600}
        lineHeight={lineHeight}
        strokeWidth={outlineWidth}
        textColor='#FFFFFF'
        strokeColor='#000000'
        onCharacterTap={(e) => handleCharacterTap(e.nativeEvent.index)}
        onMeasured={(e) =>
          setMeasured({ text: trimmed, height: e.nativeEvent.height })
        }
        style={{ width: "92%", height }}
      />
    </View>
  );
}

/* ─────────────── JS fallback (stale binary / non-iOS) ─────────────── */

/** 8-direction offsets (diagonals normalized so the ring is uniform). */
function outlineOffsets(w: number): [number, number][] {
  const d = Math.max(1, Math.round(w * 0.7));
  return [
    [-w, 0],
    [w, 0],
    [0, -w],
    [0, w],
    [-d, -d],
    [-d, d],
    [d, -d],
    [d, d],
  ];
}

function FallbackOverlay({
  trimmed,
  onWordTap,
  fontSize,
  outline,
  bottomOffset,
}: OverlayProps) {
  const outlineWidth = outlineWidthFor(outline, fontSize);

  const metrics = useMemo<TextStyle>(
    () => ({
      fontSize,
      fontWeight: "600",
      lineHeight: Math.ceil(fontSize * 1.3),
    }),
    [fontSize],
  );
  const textStyle = useMemo<TextStyle>(
    () => ({ ...metrics, color: "white" }),
    [metrics],
  );
  // Crisp black copies — deliberately NO textShadow (blur reads as fuzz).
  const outlineTextStyle = useMemo<TextStyle>(
    () => ({ ...metrics, color: "black" }),
    [metrics],
  );

  const lines = trimmed.split("\n");
  const offsets = outlineWidth > 0 ? outlineOffsets(outlineWidth) : [];

  return (
    <View
      pointerEvents='box-none'
      style={[styles.container, { bottom: bottomOffset }]}
    >
      <View pointerEvents='box-none' style={styles.lineStack}>
        {lines.map((line, li) => {
          const tokens = segmentLine(line);
          return (
            <View key={`${li}-${line}`} pointerEvents='box-none'>
              {offsets.map(([dx, dy]) => (
                <View
                  key={`${dx},${dy}`}
                  pointerEvents='none'
                  style={[
                    styles.row,
                    styles.outlineCopy,
                    { left: dx, right: -dx, top: dy, bottom: -dy },
                  ]}
                >
                  {tokens.map((tok, ti) => (
                    <Text key={`${ti}-${tok.text}`} style={outlineTextStyle}>
                      {tok.text}
                    </Text>
                  ))}
                </View>
              ))}
              <View pointerEvents='box-none' style={styles.row}>
                {tokens.map((tok, ti) =>
                  tok.isWhitespace ? (
                    <Text key={`${ti}-ws`} style={textStyle}>
                      {tok.text}
                    </Text>
                  ) : (
                    <Pressable
                      key={`${ti}-${tok.text}`}
                      onPress={() => handleTap(tok, line, onWordTap)}
                      hitSlop={4}
                    >
                      <Text style={textStyle}>{tok.text}</Text>
                    </Pressable>
                  ),
                )}
              </View>
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
  outlineCopy: {
    position: "absolute",
  },
});
