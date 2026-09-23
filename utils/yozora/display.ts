/*
 * Pure display helpers for the Yozora tab (RN-free, bun-testable — same purity
 * rule as utils/yomifin/*). Everything here transforms Yozora API payloads into
 * strings/values the components render; no fetches, no settings reads.
 */
import type {
  ContinueWatchingItem,
  ProgressEntry,
  Source,
  TitleSummary,
} from "./types";

export type TitleLanguage = "romaji" | "english" | "native";

// ── Identity ────────────────────────────────────────────────────────────────

export interface ParsedTitleKey {
  kind: "anime" | "movie" | "show" | "unknown";
  /** Present for anilist:{id} keys — jimaku wants the raw AniList id. */
  anilistId: number | null;
}

export function parseTitleKey(key: string): ParsedTitleKey {
  const anilist = key.match(/^anilist:(\d+)$/);
  if (anilist) return { kind: "anime", anilistId: Number(anilist[1]) };
  if (/^tmdb:movie:\d+$/.test(key)) return { kind: "movie", anilistId: null };
  if (/^tmdb:show:\d+$/.test(key)) return { kind: "show", anilistId: null };
  return { kind: "unknown", anilistId: null };
}

// ── Titles ──────────────────────────────────────────────────────────────────

/** Pick the display title per the user's title-language toggle (anime carries
 *  `titles`; tmdb titles just have `title`). */
export function displayTitle(
  t: Pick<TitleSummary, "title" | "titles">,
  lang: TitleLanguage = "romaji",
): string {
  const r = t.titles;
  if (!r) return t.title;
  if (lang === "english") return r.english || r.romaji || r.native || t.title;
  if (lang === "native") return r.native || r.romaji || r.english || t.title;
  return r.romaji || r.english || r.native || t.title;
}

/** Title MOST useful to jimaku search (romaji/native beats english). */
export function jimakuTitle(t: Pick<TitleSummary, "title" | "titles">): string {
  const r = t.titles;
  if (!r) return t.title;
  return r.romaji || r.native || r.english || t.title;
}

// ── Ratings ─────────────────────────────────────────────────────────────────

/** Yozora ratings are 0–10 (TMDB vote / AniList score÷10) → AniList-style %. */
export function ratingPercent(rating?: number | null): number | null {
  if (rating == null || rating <= 0) return null;
  return Math.round(rating * 10);
}

/** AniList pill thresholds (green ≥75, amber 60–74, red <60) on the % scale. */
export function scoreColor(percent?: number | null): string {
  if (percent == null) return "#4b5563";
  if (percent >= 75) return "#16a34a";
  if (percent >= 60) return "#d97706";
  return "#dc2626";
}

// ── Sources ─────────────────────────────────────────────────────────────────

export function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return "";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${Math.round(mb)} MB`;
}

/** Compact metadata line for a source row (resolution · class · codec · size · seeders). */
export function sourceMetaLine(s: Source): string {
  const parts: string[] = [];
  if (s.parsed.resolution) parts.push(s.parsed.resolution);
  if (s.parsed.quality_class && s.parsed.quality_class !== "unknown")
    parts.push(s.parsed.quality_class.toUpperCase());
  if (s.parsed.codec) parts.push(s.parsed.codec.toUpperCase());
  if (s.parsed.hdr.length) parts.push(s.parsed.hdr.join("/").toUpperCase());
  const size = formatBytes(s.size_bytes);
  if (size) parts.push(size);
  if (s.seeders != null) parts.push(`${s.seeders} seeders`);
  if (s.parsed.season_pack) parts.push("season pack");
  return parts.join(" · ");
}

/** Honest copy for the source-picker empty/error states (RES-15 codes). */
export function describeSourcesError(code: string): string {
  switch (code) {
    case "NO_MAPPING":
      return "No sources yet — this title isn't mapped to any release database.";
    case "NO_SOURCES":
      return "No sources found for this title.";
    case "NOTHING_CACHED":
      return "Nothing is cached on the debrid service yet — pick a source to try anyway.";
    case "ADDON_TIMEOUT":
      return "The source addons timed out. Try again.";
    case "TORBOX_RATE_LIMITED":
      return "The debrid service is rate-limiting. Wait a moment and retry.";
    case "TORBOX_ERROR":
      return "The debrid service returned an error. Try another source.";
    case "NO_FILE_MATCH":
      return "The release didn't contain a matching video file. Try another source.";
    case "NETWORK_ERROR":
      return "Couldn't reach the Yozora server.";
    default:
      return `Failed (${code}).`;
  }
}

// ── Progress ────────────────────────────────────────────────────────────────

/** 0–1 fraction for progress bars (null when not meaningful). */
export function progressFraction(
  positionSec: number,
  durationSec?: number | null,
): number | null {
  if (!durationSec || durationSec <= 0 || positionSec <= 0) return null;
  return Math.min(1, positionSec / durationSec);
}

/** episode-string → progress entry map for episode-list styling. */
export function progressByEpisode(
  items: ProgressEntry[],
): Map<string, ProgressEntry> {
  const map = new Map<string, ProgressEntry>();
  for (const it of items) {
    if (it.episode != null && !map.has(it.episode)) map.set(it.episode, it);
  }
  return map;
}

/** The movie-level (episode-less) progress entry, if any. */
export function movieProgress(items: ProgressEntry[]): ProgressEntry | null {
  return items.find((it) => it.episode == null) ?? null;
}

// ── Continue Watching ───────────────────────────────────────────────────────

export function cwSubtitle(item: ContinueWatchingItem): string {
  const ep = item.episode ? `Ep ${item.episode.replace(":", "×")}` : "";
  switch (item.kind) {
    case "resume": {
      const pct =
        progressFraction(item.position_sec, item.duration_sec) ?? null;
      const pctStr = pct != null ? ` · ${Math.round(pct * 100)}%` : "";
      return `${ep ? `${ep} · ` : ""}Resume${pctStr}`;
    }
    case "next_up":
      return ep ? `${ep} · Next up` : "Next up";
    case "sequel":
      return "Sequel";
    case "waiting":
      return `${ep ? `${ep} · ` : ""}${relativeAirTime(item.airs_at)}`;
  }
}

/** "Airs in 2d 4h" style countdown (falls back to a bare label). */
export function relativeAirTime(
  iso?: string | null,
  now: Date = new Date(),
): string {
  if (!iso) return "Waiting";
  const ms = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(ms)) return "Waiting";
  if (ms <= 0) return "Airing now";
  const totalMin = Math.round(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `Airs in ${d}d ${h}h`;
  if (h > 0) return `Airs in ${h}h ${m}m`;
  return `Airs in ${m}m`;
}

// ── Misc formatting ─────────────────────────────────────────────────────────

/** "1:5" → "S1 E5" (tmdb shows); "12" → "Episode 12" (anime). */
export function episodeLabel(episode?: string | null): string {
  if (!episode) return "";
  const se = episode.match(/^(\d+):(\d+)$/);
  if (se) return `S${se[1]} E${se[2]}`;
  return `Episode ${episode}`;
}

export function runtimeLabel(min?: number | null): string {
  if (!min || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
