/*
 * Deterministic synthetic subtitle-track generation, shared by:
 *   - utils/yomifin/subSync.test.ts        (fast regression guard)
 *   - scripts/yomifin-sync-crosscheck.ts   (pins subSync against the REAL alass-cli)
 *
 * Pure and side-effect free. All randomness is seeded (mulberry32) so failures
 * reproduce exactly.
 */
import type { SubtitleCue } from "./srt";

/** Deterministic pseudo-random (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A dialogue-ish track: `count` cues with variable durations and gaps. */
export function makeTrack(
  seed: number,
  count = 300,
  startMs = 5_000,
): SubtitleCue[] {
  const rand = rng(seed);
  const cues: SubtitleCue[] = [];
  let t = startMs;
  for (let i = 0; i < count; i++) {
    const dur = 800 + Math.floor(rand() * 3200);
    cues.push({ index: i + 1, startMs: t, endMs: t + dur, text: `cue ${i}` });
    t += dur + 200 + Math.floor(rand() * 4000);
  }
  return cues;
}

/**
 * Shifted copy with per-cue jitter (±80ms), ~12% of cues dropped (lines the other
 * sub doesn't have) and ~5% extras injected — the shape of a real cross-release
 * subtitle pair.
 */
export function degradeAndShift(
  track: SubtitleCue[],
  shiftMs: number,
  seed: number,
): SubtitleCue[] {
  const rand = rng(seed);
  const out: SubtitleCue[] = [];
  for (const c of track) {
    if (rand() < 0.12) continue;
    const jitter = Math.floor((rand() - 0.5) * 160);
    out.push({
      ...c,
      startMs: c.startMs + shiftMs + jitter,
      endMs: c.endMs + shiftMs + jitter,
    });
    if (rand() < 0.05) {
      out.push({
        index: c.index,
        startMs: c.endMs + shiftMs + 100,
        endMs: c.endMs + shiftMs + 900,
        text: "extra",
      });
    }
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

function msToSrtTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1_000);
  const frac = clamped % 1_000;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(frac, 3)}`;
}

/** Serialize cues to SRT text (for feeding external tools like alass-cli). */
export function cuesToSrt(cues: SubtitleCue[]): string {
  return `${cues
    .map(
      (c, i) =>
        `${i + 1}\n${msToSrtTimestamp(c.startMs)} --> ${msToSrtTimestamp(c.endMs)}\n${c.text}`,
    )
    .join("\n\n")}\n`;
}
