/*
 * Phase 8 — {furigana} / {furigana-plain} markers (pure, RN-free, bun-testable).
 *
 * Thin wrappers over the VENDORED Yomitan `distributeFurigana` (japanese.js), which
 * aligns a headword with its reading segment-by-segment (読む/よむ → [読=よ][む]).
 * Same engine Yomitan's own furigana markers use, so segmentation quality matches.
 */
// vendored JS (no .d.ts) — shape: {text: string, reading: string}[]
import { distributeFurigana } from "./yomitan/japanese.js";

interface FuriganaSegment {
  text: string;
  reading: string;
}

function segments(term: string, reading: string): FuriganaSegment[] {
  if (!term) return [];
  try {
    return distributeFurigana(term, reading || term) as FuriganaSegment[];
  } catch {
    return [{ text: term, reading: reading !== term ? reading : "" }];
  }
}

/** HTML ruby form, e.g. 読む/よむ → `<ruby>読<rt>よ</rt></ruby>む`. */
export function furiganaHtml(term: string, reading: string): string {
  return segments(term, reading)
    .map((s) =>
      s.reading ? `<ruby>${s.text}<rt>${s.reading}</rt></ruby>` : s.text,
    )
    .join("");
}

/**
 * Anki furigana syntax, e.g. 読む/よむ → `読[よ]む`. A space precedes a bracketed
 * segment when it isn't first (Anki's parser needs the delimiter: `お 土産[みやげ]`).
 */
export function furiganaPlain(term: string, reading: string): string {
  return segments(term, reading)
    .map((s, i) =>
      s.reading ? `${i > 0 ? " " : ""}${s.text}[${s.reading}]` : s.text,
    )
    .join("");
}
