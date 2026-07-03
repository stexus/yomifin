/*
 * Subtitle format dispatch for the yomifin cue store (pure, RN-free, bun-testable).
 *
 * The Jellyfin path always delivers SRT (Stream.srt converts server-side), but online
 * subtitle sources (jimaku.cc et al.) hand us raw files — overwhelmingly .ass/.ssa,
 * sometimes .srt or .vtt. mpv parses whatever we `sub-add` natively (its `sub-text`
 * event is already override-tag-stripped), so this module only needs to produce the
 * PLAIN-TEXT cue list for the store: multi-sentence cards, sync estimation
 * (subSync.ts), and the future transcript sidebar.
 *
 *   parseAss           — [Events] Dialogue lines → SubtitleCue[] (override tags
 *                        stripped, \N→newline, drawing/typesetting cues dropped,
 *                        layered duplicates deduped)
 *   parseSubtitleText  — format sniff (filename ext, then content) → parse
 *   cleanSubtitleOverlayText — defensive strip of leaked ASS override blobs from
 *                        mpv's live sub-text (normally already clean)
 *   shiftCues          — apply a sync offset (ms) to a parsed track
 */
import { parseSrt, type SubtitleCue } from "./srt";

export type SubtitleFormat = "ass" | "vtt" | "srt";

/** ASS spec default [Events] field order (v4+; SSA's "Marked" maps the same slot). */
const DEFAULT_ASS_EVENT_FORMAT = [
  "layer",
  "start",
  "end",
  "style",
  "name",
  "marginl",
  "marginr",
  "marginv",
  "effect",
  "text",
];

/** "H:MM:SS.cc" (ASS centiseconds) → milliseconds. NaN if unparseable. */
function parseAssTimestamp(ts: string): number {
  const m = ts.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,2})/);
  if (!m) return Number.NaN;
  const [, h, mm, ss, cs] = m;
  return (
    Number(h) * 3_600_000 +
    Number(mm) * 60_000 +
    Number(ss) * 1_000 +
    Number(cs.padEnd(2, "0")) * 10
  );
}

/** Split an ASS event body into exactly `n` fields (the last field keeps commas). */
function splitAssFields(body: string, n: number): string[] {
  const out: string[] = [];
  let rest = body;
  for (let i = 0; i < n - 1; i++) {
    const idx = rest.indexOf(",");
    if (idx < 0) break;
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  out.push(rest);
  return out;
}

/**
 * Parse ASS/SSA text into plain-text cues.
 *  - Only `Dialogue:` events in [Events] (Comment: lines skipped).
 *  - Override tag blocks `{...}` are stripped; `\N`/`\n` → newline, `\h` → space.
 *  - Cues that enter ASS drawing mode (`{\p1}` shapes / sign typesetting) are dropped
 *    — they're vector art, not dialogue.
 *  - Layered duplicates (same start/end/text, common for border+fill styling) dedupe.
 */
export function parseAss(raw: string): SubtitleCue[] {
  if (!raw) return [];
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  let inEvents = false;
  let format: string[] | null = null;
  const cues: SubtitleCue[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    const section = trimmed.match(/^\[([^\]]+)\]$/);
    if (section) {
      inEvents = section[1].trim().toLowerCase() === "events";
      continue;
    }
    if (!inEvents) continue;

    if (/^format\s*:/i.test(trimmed)) {
      format = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .split(",")
        .map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(trimmed)) continue;

    const fields = format ?? DEFAULT_ASS_EVENT_FORMAT;
    const body = trimmed.slice(trimmed.indexOf(":") + 1);
    const parts = splitAssFields(body, fields.length);
    const get = (name: string): string | undefined => {
      const idx = fields.indexOf(name);
      return idx >= 0 ? parts[idx] : undefined;
    };

    const startMs = parseAssTimestamp(get("start") ?? "");
    const endMs = parseAssTimestamp(get("end") ?? "");
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;

    let t = get("text") ?? "";
    // Drawing mode (\p1..\p4) = vector shapes, never dialogue.
    if (/\{[^}]*\\p[1-9]/.test(t)) continue;
    t = t
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\N|\\n/g, "\n")
      .replace(/\\h/g, " ")
      .trim();
    if (!t) continue;

    const key = `${startMs}|${endMs}|${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cues.push({ index: cues.length + 1, startMs, endMs, text: t });
  }

  cues.sort((a, b) => a.startMs - b.startMs);
  return cues;
}

/** Sniff the subtitle format: filename extension first, then content. */
export function detectSubtitleFormat(
  raw: string,
  filename?: string,
): SubtitleFormat {
  const name = filename?.toLowerCase() ?? "";
  if (name.endsWith(".ass") || name.endsWith(".ssa")) return "ass";
  if (name.endsWith(".vtt")) return "vtt";
  if (name.endsWith(".srt")) return "srt";
  if (/^\uFEFF?WEBVTT/.test(raw)) return "vtt";
  const head = raw.slice(0, 8000);
  if (/\[Script Info\]/i.test(head) || /^\s*Dialogue\s*:/im.test(head))
    return "ass";
  return "srt";
}

/** WebVTT → SRT-ish: drop the header, add the optional hours ("MM:SS.mmm"). */
function vttToSrtish(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^WEBVTT[^\n]*\n/, "")
    .replace(/(^|\n)(\d{1,2}):(\d{2})\.(\d{3})/g, "$100:$2:$3.$4")
    .replace(/ (\d{1,2}):(\d{2})\.(\d{3})/g, " 00:$1:$2.$3");
}

/** Parse subtitle text of any supported format into plain-text cues. */
export function parseSubtitleText(
  raw: string,
  filename?: string,
): SubtitleCue[] {
  const format = detectSubtitleFormat(raw, filename);
  if (format === "ass") return parseAss(raw);
  if (format === "vtt") return parseSrt(vttToSrtish(raw));
  return parseSrt(raw);
}

/**
 * Defensive cleanup of mpv's live `sub-text` before the tappable overlay renders it.
 * mpv already strips ASS formatting, but stray override blobs have been seen leaking
 * from malformed tracks; the `{\` prefix requirement keeps real dialogue braces safe.
 */
export function cleanSubtitleOverlayText(text: string): string {
  if (!text) return "";
  return text.replace(/\{\\[^}]*\}/g, "").replace(/\\h/g, " ");
}

/** Apply a sync offset to a parsed track (offsetMs > 0 = cues display later). */
export function shiftCues(
  cues: SubtitleCue[],
  offsetMs: number,
): SubtitleCue[] {
  if (!offsetMs) return cues;
  return cues.map((c) => ({
    ...c,
    startMs: c.startMs + offsetMs,
    endMs: c.endMs + offsetMs,
  }));
}
