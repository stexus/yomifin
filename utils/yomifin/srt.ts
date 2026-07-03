/**
 * Minimal SRT parser for the yomifin tappable-subtitle layer (Phase 1).
 *
 * SRT only for now. Produces cues with ms timings + text.
 * We deliberately keep this tiny and dependency-free.
 */

export interface SubtitleCue {
  /** 1-based cue index as written in the file (best-effort). */
  index: number;
  startMs: number;
  endMs: number;
  /** Display text; may contain "\n" for multi-line cues. */
  text: string;
}

/** "HH:MM:SS,mmm" (or with "." as decimal sep) → milliseconds. */
function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return Number.NaN;
  const [, hh, mm, ss, ms] = m;
  return (
    Number(hh) * 3_600_000 +
    Number(mm) * 60_000 +
    Number(ss) * 1_000 +
    Number(ms.padEnd(3, "0"))
  );
}

/** Strip the most common inline SRT/HTML tags for plain tappable text. */
function stripTags(s: string): string {
  return s
    .replace(/<\/?[^>]+>/g, "") // <i>, <b>, <font ...>, etc.
    .replace(/\{\\[^}]*\}/g, ""); // stray ASS override blocks if any leak in
}

/**
 * Parse SRT text into cues. Robust to CRLF, BOM, and blank-line variance.
 */
export function parseSrt(raw: string): SubtitleCue[] {
  if (!raw) return [];
  const text = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const blocks = text.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // A block may start with an index line (numeric in SRT, arbitrary cue id in
    // WebVTT) — locate the timing line instead of assuming a fixed position.
    const cursor = lines.findIndex((l) => l.includes("-->"));
    if (cursor === -1) continue;
    let index = cues.length + 1;
    if (cursor > 0 && /^\d+$/.test(lines[0].trim())) {
      index = Number(lines[0].trim());
    }

    const timingLine = lines[cursor];
    const [startRaw, endRaw] = timingLine.split("-->");
    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(endRaw);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;

    const textLines = lines.slice(cursor + 1).map(stripTags);
    const cueText = textLines.join("\n").trim();
    if (!cueText) continue;

    cues.push({ index, startMs, endMs, text: cueText });
  }

  // Ensure ascending by start time for the active-cue search.
  cues.sort((a, b) => a.startMs - b.startMs);
  return cues;
}
