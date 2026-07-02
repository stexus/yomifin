/*
 * Phase 8 — cue store range logic (pure, RN-free, bun-testable).
 *
 * The multi-sentence markers ({sentence}, {sentence-audio}) read a SELECTED CUE RANGE
 * over the item's full subtitle track (parsed once per item into SubtitleCue[]; see
 * utils/atoms/yomifinCueStore.ts). Default range = the single tapped cue (span 1);
 * the popup's "extend to previous / next line" affordances grow it. This module is the
 * pure math: anchoring a tap-time cue (mpv's live {start,end}, seconds) to an index in
 * the parsed track, growing/clamping ranges, and deriving the joined text + the audio
 * span (min start … max end).
 *
 * Data substrate only — Phase 12's sidebar reuses this.
 */
import type { SubtitleCue } from "./srt";

/** Inclusive cue index range [startIndex … endIndex]. */
export interface CueRange {
  startIndex: number;
  endIndex: number;
}

/**
 * Anchor mpv's live cue timing (seconds) to an index in the parsed track. Jellyfin's
 * SRT conversion and mpv's demuxer can disagree by a few ms, so match by best overlap
 * with [startSec, endSec], falling back to the nearest cue start within `toleranceMs`.
 * Returns -1 if nothing matches (bitmap track, fetch failure, off-track timing).
 */
export function findCueIndexByTime(
  cues: SubtitleCue[],
  startSec: number,
  endSec: number = startSec,
  toleranceMs = 400,
): number {
  if (cues.length === 0) return -1;
  const startMs = startSec * 1000;
  // A zero-width query (a point in time) must still overlap the cue containing it.
  const endMs = Math.max(endSec * 1000, startMs + 1);

  let bestIdx = -1;
  let bestOverlap = 0;
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const overlap = Math.min(c.endMs, endMs) - Math.max(c.startMs, startMs);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) return bestIdx;

  // No overlap — nearest start within tolerance (rounding-drift safety net).
  let nearestIdx = -1;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < cues.length; i++) {
    const dist = Math.abs(cues[i].startMs - startMs);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }
  return nearestDist <= toleranceMs ? nearestIdx : -1;
}

export function clampRange(range: CueRange, cueCount: number): CueRange {
  const start = Math.max(0, Math.min(range.startIndex, cueCount - 1));
  const end = Math.max(start, Math.min(range.endIndex, cueCount - 1));
  return { startIndex: start, endIndex: end };
}

/** Grow the range by one cue backwards (dir -1) or forwards (dir +1), clamped. */
export function extendRange(
  range: CueRange,
  dir: -1 | 1,
  cueCount: number,
): CueRange {
  const next =
    dir === -1
      ? { startIndex: range.startIndex - 1, endIndex: range.endIndex }
      : { startIndex: range.startIndex, endIndex: range.endIndex + 1 };
  return clampRange(next, cueCount);
}

export function rangeLength(range: CueRange): number {
  return range.endIndex - range.startIndex + 1;
}

/**
 * The range's cue texts joined for the {sentence} marker. CJK wants no separator;
 * internal line-wraps inside a cue are also joined (a cue's \n is layout, not
 * punctuation — sentences end with 。/？/！ anyway).
 */
export function rangeText(cues: SubtitleCue[], range: CueRange): string {
  const r = clampRange(range, cues.length);
  if (cues.length === 0) return "";
  const parts: string[] = [];
  for (let i = r.startIndex; i <= r.endIndex; i++) {
    parts.push(cues[i].text.replace(/\n+/g, ""));
  }
  return parts.join("");
}

/**
 * The audio span for the {sentence-audio} marker: min(starts)…max(ends) of the
 * selected cues, in SECONDS (the native extractAudio contract). Null if no cues.
 */
export function rangeSpanSec(
  cues: SubtitleCue[],
  range: CueRange,
): { start: number; end: number } | null {
  if (cues.length === 0) return null;
  const r = clampRange(range, cues.length);
  return {
    start: cues[r.startIndex].startMs / 1000,
    end: cues[r.endIndex].endMs / 1000,
  };
}
