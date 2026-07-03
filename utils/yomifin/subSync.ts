/*
 * On-device subtitle sync estimation (pure, RN-free, bun-testable).
 *
 * alass/ffsubsync align subtitles against the AUDIO track; we can do something much
 * cheaper because we usually have a reference SUBTITLE track already: the Jellyfin
 * item's own text track (parsed into the cue store on load). An online track (jimaku)
 * for the same episode is ~the same dialogue with a constant time shift (different
 * mux/broadcast timing), so a cross-correlation of the two cue-interval sets over
 * candidate offsets finds the shift directly — no audio decoding, no native code.
 *
 * estimateSubtitleOffset returns the offset to ADD to the external track's times to
 * land on the reference timeline — i.e. exactly mpv's `sub-delay` (in ms): positive
 * means the external subs must display later. Constant offset only (covers the
 * common mux-delay case); linear drift (framerate mismatch) is out of scope — the
 * manual nudge UI is the fallback.
 *
 * Cost: coarse pass ±maxOffsetMs at coarseStepMs, then a fine pass around the best
 * candidate. Each evaluation is a two-pointer sweep, O(n+m). Defaults ≈ 1000
 * evaluations over a 1500-cue track — well under a second, run only on demand.
 */
import type { SubtitleCue } from "./srt";

export interface OffsetEstimate {
  /** ms to add to the external track (== mpv sub-delay * 1000). */
  offsetMs: number;
  /** Overlap ratio at the best offset, 0..1 (1 = every cue fully aligned). */
  score: number;
}

export interface EstimateOptions {
  /** Search window: candidate offsets in [-maxOffsetMs, +maxOffsetMs]. */
  maxOffsetMs?: number;
  /** Coarse pass step. Must be smaller than typical cue duration (~2s). */
  coarseStepMs?: number;
  /** Fine pass step around the coarse winner. */
  fineStepMs?: number;
  /** Minimum overlap ratio to call the estimate confident. */
  minScore?: number;
  /**
   * Minimum best/mean overlap across candidate offsets. A genuine alignment has a
   * sharp correlation peak; chance overlap (e.g. a sparse track inside a dense one,
   * which trivially overlaps at ANY offset) is flat → ratio ≈ 1.
   */
  minPeakRatio?: number;
}

/** Total intersection (ms) of ref intervals with ext intervals shifted by offset. */
function totalOverlap(
  ref: SubtitleCue[],
  ext: SubtitleCue[],
  offset: number,
): number {
  let i = 0;
  let j = 0;
  let sum = 0;
  while (i < ref.length && j < ext.length) {
    const rs = ref[i].startMs;
    const re = ref[i].endMs;
    const es = ext[j].startMs + offset;
    const ee = ext[j].endMs + offset;
    const lo = Math.max(rs, es);
    const hi = Math.min(re, ee);
    if (hi > lo) sum += hi - lo;
    if (re < ee) i++;
    else j++;
  }
  return sum;
}

function totalDuration(cues: SubtitleCue[]): number {
  let sum = 0;
  for (const c of cues) sum += Math.max(0, c.endMs - c.startMs);
  return sum;
}

/**
 * Estimate the constant offset aligning `ext` (external/online track) to `ref`
 * (the item's own track). Returns null when there's no confident match (too few
 * cues, disjoint content, or best overlap below minScore) — callers fall back to
 * the manual nudge UI.
 */
export function estimateSubtitleOffset(
  ref: SubtitleCue[],
  ext: SubtitleCue[],
  opts: EstimateOptions = {},
): OffsetEstimate | null {
  const {
    maxOffsetMs = 120_000,
    coarseStepMs = 250,
    fineStepMs = 20,
    minScore = 0.25,
    minPeakRatio = 1.5,
  } = opts;

  if (ref.length < 5 || ext.length < 5) return null;

  // Both inputs are sorted by startMs (parser contract); the sweep relies on it.
  let bestOffset = 0;
  let bestOverlap = -1;
  let overlapSum = 0;
  let overlapCount = 0;
  for (let off = -maxOffsetMs; off <= maxOffsetMs; off += coarseStepMs) {
    const o = totalOverlap(ref, ext, off);
    overlapSum += o;
    overlapCount++;
    if (o > bestOverlap) {
      bestOverlap = o;
      bestOffset = off;
    }
  }
  const meanOverlap = overlapCount > 0 ? overlapSum / overlapCount : 0;

  // Fine pass around the coarse winner.
  const lo = bestOffset - coarseStepMs;
  const hi = bestOffset + coarseStepMs;
  for (let off = lo; off <= hi; off += fineStepMs) {
    const o = totalOverlap(ref, ext, off);
    if (o > bestOverlap) {
      bestOverlap = o;
      bestOffset = off;
    }
  }

  const denom = Math.min(totalDuration(ref), totalDuration(ext));
  if (denom <= 0 || bestOverlap <= 0) return null;
  const score = bestOverlap / denom;
  const peakRatio =
    meanOverlap > 0 ? bestOverlap / meanOverlap : Number.POSITIVE_INFINITY;
  if (score < minScore || peakRatio < minPeakRatio) return null;
  return { offsetMs: bestOffset, score };
}
