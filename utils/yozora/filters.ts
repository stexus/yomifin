/*
 * Client-side filter models for the Yozora tab (pure, bun-testable). The UI
 * keeps arrays/locals that are friendlier than wire params; these helpers
 * convert to the exact AnimeDiscoverQuery / DiscoverQuery the API expects and
 * produce the human summary line for the grid header.
 */
import type {
  AnimeDiscoverQuery,
  AnimeDiscoverSort,
  AnimeFormat,
  AnimeSeason,
  AnimeStatus,
  DiscoverQuery,
  DiscoverSort,
} from "./types";

// ── Anime (AniList vocabulary, DSC-2) ───────────────────────────────────────

export interface AnimeFilters {
  q?: string;
  sort?: AnimeDiscoverSort;
  season?: AnimeSeason;
  yearMin?: number;
  yearMax?: number;
  status?: AnimeStatus;
  format?: AnimeFormat;
  genres?: string[];
  tags?: string[];
}

/** True when anything narrows the results (→ grid instead of shelves). */
export function hasActiveAnimeFilters(f: AnimeFilters): boolean {
  return Boolean(
    f.q?.trim() ||
      f.season ||
      f.yearMin ||
      f.yearMax ||
      f.status ||
      f.format ||
      f.genres?.length ||
      f.tags?.length,
  );
}

export function toAnimeQuery(
  f: AnimeFilters,
  page: number,
): AnimeDiscoverQuery {
  return {
    page,
    sort: f.sort,
    q: f.q?.trim() || undefined,
    season: f.season,
    year_min: f.yearMin,
    year_max: f.yearMax,
    status: f.status,
    format: f.format,
    genres: f.genres?.length ? f.genres.join(",") : undefined,
    tags: f.tags?.length ? f.tags.join(",") : undefined,
  };
}

export const ANIME_SORT_OPTIONS: { value: AnimeDiscoverSort; label: string }[] =
  [
    { value: "trending", label: "Trending" },
    { value: "popularity", label: "Popular" },
    { value: "rating", label: "Top Rated" },
    { value: "newest", label: "Newest" },
    { value: "airing", label: "Airing Schedule" },
  ];

export const ANIME_SEASON_OPTIONS: { value: AnimeSeason; label: string }[] = [
  { value: "winter", label: "Winter" },
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer" },
  { value: "fall", label: "Fall" },
];

export const ANIME_STATUS_OPTIONS: { value: AnimeStatus; label: string }[] = [
  { value: "airing", label: "Airing" },
  { value: "finished", label: "Finished" },
  { value: "upcoming", label: "Upcoming" },
];

export const ANIME_FORMAT_OPTIONS: { value: AnimeFormat; label: string }[] = [
  { value: "tv", label: "TV" },
  { value: "tv_short", label: "TV Short" },
  { value: "movie", label: "Movie" },
  { value: "special", label: "Special" },
  { value: "ova", label: "OVA" },
  { value: "ona", label: "ONA" },
  { value: "music", label: "Music" },
];

export function yearOptions(now = new Date(), count = 30): number[] {
  const start = now.getFullYear() + 1;
  return Array.from({ length: count }, (_, i) => start - i);
}

/** Human summary of the active anime filters for the grid header line. */
export function animeFilterSummary(f: AnimeFilters): string {
  const parts: string[] = [];
  if (f.q?.trim()) parts.push(`“${f.q.trim()}”`);
  const yr =
    f.yearMin || f.yearMax
      ? f.yearMin === f.yearMax
        ? String(f.yearMin)
        : `${f.yearMin ?? "…"}–${f.yearMax ?? "…"}`
      : undefined;
  if (f.season || yr) {
    const s = ANIME_SEASON_OPTIONS.find((o) => o.value === f.season)?.label;
    parts.push([s ?? "", yr ?? ""].filter(Boolean).join(" "));
  }
  if (f.format) {
    const label = ANIME_FORMAT_OPTIONS.find((o) => o.value === f.format)?.label;
    if (label) parts.push(label);
  }
  if (f.status) {
    const label = ANIME_STATUS_OPTIONS.find((o) => o.value === f.status)?.label;
    if (label) parts.push(label);
  }
  if (f.genres?.length) parts.push(f.genres.join(", "));
  if (f.tags?.length) parts.push(f.tags.join(", "));
  return parts.filter(Boolean).join(" · ");
}

// ── Movies / Shows (TMDB vocabulary, DSC-1) ─────────────────────────────────

export interface TmdbFilters {
  q?: string;
  sort?: DiscoverSort;
  genreIds?: number[];
  yearMin?: number;
  yearMax?: number;
  minRating?: number;
}

export function hasActiveTmdbFilters(f: TmdbFilters): boolean {
  return Boolean(
    f.q?.trim() || f.genreIds?.length || f.yearMin || f.yearMax || f.minRating,
  );
}

/** TMDB search supports no filters — when q is present the rest is dropped. */
export function toDiscoverQuery(f: TmdbFilters, page: number): DiscoverQuery {
  const q = f.q?.trim();
  if (q) return { page, q };
  return {
    page,
    sort: f.sort,
    genres: f.genreIds?.length ? f.genreIds.join(",") : undefined,
    year_min: f.yearMin,
    year_max: f.yearMax,
    min_rating: f.minRating,
  };
}

export const TMDB_SORT_OPTIONS: { value: DiscoverSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "popularity", label: "Popular" },
  { value: "rating", label: "Top Rated" },
  { value: "newest", label: "Newest" },
];

export function tmdbFilterSummary(
  f: TmdbFilters,
  genreVocab: ReadonlyArray<{ id: number; name: string }>,
): string {
  const parts: string[] = [];
  if (f.q?.trim()) return `“${f.q.trim()}”`;
  const yr =
    f.yearMin || f.yearMax
      ? f.yearMin === f.yearMax
        ? String(f.yearMin)
        : `${f.yearMin ?? "…"}–${f.yearMax ?? "…"}`
      : undefined;
  if (yr) parts.push(yr);
  if (f.minRating) parts.push(`≥ ${f.minRating}★`);
  if (f.genreIds?.length) {
    parts.push(
      f.genreIds
        .map((id) => genreVocab.find((g) => g.id === id)?.name)
        .filter(Boolean)
        .join(", "),
    );
  }
  return parts.filter(Boolean).join(" · ");
}
