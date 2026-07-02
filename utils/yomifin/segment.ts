/**
 * Subtitle line segmentation into TAP ANCHORS (Phase 1).
 *
 * The segmenter only produces tap targets — the dictionary (Phase 2)
 * decides real word boundaries via forward-greedy lookup. So a crude segmenter is
 * fine here. We try Intl.Segmenter (word granularity) and fall back to per-grapheme.
 */

export interface Token {
  /** The token's text. */
  text: string;
  /** Character offset of this token within its line (for "from-here-to-end"). */
  start: number;
  /** Whether this token is pure whitespace (rendered as a gap, not tappable). */
  isWhitespace: boolean;
}

export function segmentLine(line: string): Token[] {
  const tokens: Token[] = [];

  // Preferred: Intl.Segmenter (available on modern Hermes). "ja" is a reasonable
  // default for tap anchoring; it still segments CJK/Latin acceptably.
  const Seg = (Intl as unknown as { Segmenter?: any }).Segmenter;
  if (Seg) {
    try {
      const seg = new Seg("ja", { granularity: "word" });
      for (const part of seg.segment(line)) {
        const txt: string = part.segment;
        tokens.push({
          text: txt,
          start: part.index,
          isWhitespace: /^\s+$/.test(txt),
        });
      }
      if (tokens.length > 0) return tokens;
    } catch {
      // fall through to per-grapheme
    }
  }

  // Fallback: per grapheme (handles surrogate pairs via Array.from).
  let idx = 0;
  for (const ch of Array.from(line)) {
    tokens.push({ text: ch, start: idx, isWhitespace: /^\s+$/.test(ch) });
    idx += ch.length;
  }
  return tokens;
}
