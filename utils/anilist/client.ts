/*
 * AniList GraphQL client — pure, RN-free, bun-testable (mirrors the
 * utils/stremio/client.ts + utils/yomifin patterns: no settings reads inside,
 * `fetch` is injectable for tests).
 *
 * AniList's public GraphQL API needs no key: https://graphql.anilist.co
 * It is rate-throttled (~30 req/min) so callers cache aggressively (shelves
 * module-level, id-maps in MMKV — see utils/anilist/useAnilistIdMap.ts).
 *
 * Playback bridge lives in utils/anilist/mapping.ts (anilist → kitsu/imdb via
 * arm.haglund.dev); this file is discovery only.
 */

export const ANILIST_ENDPOINT = "https://graphql.anilist.co";

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// ---------------------------------------------------------------------------
// Types (subset of the AniList Media schema the discovery UI consumes)
// ---------------------------------------------------------------------------

export type TitleLanguage = "romaji" | "english" | "native";

export interface AnilistTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

export interface AnilistCoverImage {
  extraLarge?: string | null;
  large?: string | null;
  medium?: string | null;
  color?: string | null;
}

export interface AnilistTag {
  name: string;
  rank?: number | null;
  isMediaSpoiler?: boolean | null;
  isAdult?: boolean | null;
}

export interface AnilistAiringEpisode {
  episode: number;
  airingAt: number;
}

export interface AnilistMediaPreview {
  id: number;
  idMal?: number | null;
  type?: string | null;
  title: AnilistTitle;
  coverImage?: AnilistCoverImage | null;
  bannerImage?: string | null;
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  duration?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  meanScore?: number | null;
  popularity?: number | null;
  favourites?: number | null;
  genres?: string[] | null;
  isAdult?: boolean | null;
  nextAiringEpisode?: AnilistAiringEpisode | null;
}

export interface AnilistStreamingEpisode {
  title?: string | null;
  thumbnail?: string | null;
  url?: string | null;
  site?: string | null;
}

export interface AnilistRelationEdge {
  relationType?: string | null;
  node: AnilistMediaPreview;
}

export interface AnilistMediaDetail extends AnilistMediaPreview {
  description?: string | null;
  tags?: AnilistTag[] | null;
  studios?: { nodes: { name: string }[] } | null;
  relations?: { edges: AnilistRelationEdge[] } | null;
  recommendations?: {
    nodes: { mediaRecommendation: AnilistMediaPreview | null }[];
  } | null;
  streamingEpisodes?: AnilistStreamingEpisode[] | null;
  airingSchedule?: { nodes: AnilistAiringEpisode[] } | null;
  trailer?: { id?: string | null; site?: string | null } | null;
}

export interface AnilistPageInfo {
  total?: number;
  currentPage?: number;
  lastPage?: number;
  hasNextPage?: boolean;
  perPage?: number;
}

export interface AnilistPage<T> {
  pageInfo: AnilistPageInfo;
  media: T[];
}

// ---------------------------------------------------------------------------
// GraphQL transport
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;

/** Thrown on an AniList 429 so callers can back off gracefully. */
export class AnilistRateLimitError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`AniList rate-limited (retry after ${retryAfterSec}s)`);
    this.name = "AnilistRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

export async function gqlRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(ANILIST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new AnilistRateLimitError(60);
    if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (json.errors && json.errors.length > 0) {
      throw new Error(
        `AniList: ${json.errors.map((e) => e.message).join("; ")}`,
      );
    }
    if (!json.data) throw new Error("AniList: empty response");
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Query fragments
// ---------------------------------------------------------------------------

const PREVIEW_FIELDS = `
  id
  idMal
  type
  title { romaji english native }
  coverImage { extraLarge large medium color }
  bannerImage
  format
  status
  episodes
  duration
  season
  seasonYear
  averageScore
  meanScore
  popularity
  favourites
  genres
  isAdult
  nextAiringEpisode { episode airingAt }
`;

/**
 * Lighter fragment for related/recommended CARDS (no banner, no scores breakdown
 * — the detail query fans out over ~40 of these, so trimming keeps it fast; the
 * full detail query with full preview fields per node timed out live).
 */
const CARD_FIELDS = `
  id
  idMal
  type
  title { romaji english native }
  coverImage { extraLarge large color }
  format
  episodes
  season
  seasonYear
  averageScore
`;

/**
 * ONE flexible browse query drives every shelf, the browse grid, AND search: all
 * filter variables are declared (GraphQL requires declared vars be referenced),
 * and any left null is ignored by AniList. isAdult defaults false so adult
 * titles are filtered out unless a caller opts in.
 */
const BROWSE_QUERY = `
query Browse(
  $page: Int = 1
  $perPage: Int = 30
  $type: MediaType = ANIME
  $sort: [MediaSort]
  $season: MediaSeason
  $seasonYear: Int
  $genre_in: [String]
  $tag_in: [String]
  $format_in: [MediaFormat]
  $status: MediaStatus
  $startDate_greater: FuzzyDateInt
  $startDate_lesser: FuzzyDateInt
  $search: String
  $isAdult: Boolean = false
) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage perPage }
    media(
      type: $type
      sort: $sort
      season: $season
      seasonYear: $seasonYear
      genre_in: $genre_in
      tag_in: $tag_in
      format_in: $format_in
      status: $status
      startDate_greater: $startDate_greater
      startDate_lesser: $startDate_lesser
      search: $search
      isAdult: $isAdult
    ) {
      ${PREVIEW_FIELDS}
    }
  }
}`;

const DETAIL_QUERY = `
query Detail($id: Int) {
  Media(id: $id, type: ANIME) {
    ${PREVIEW_FIELDS}
    description(asHtml: false)
    tags { name rank isMediaSpoiler isAdult }
    studios(isMain: true) { nodes { name } }
    trailer { id site }
    streamingEpisodes { title thumbnail url site }
    relations {
      edges {
        relationType
        node { ${CARD_FIELDS} }
      }
    }
    recommendations(sort: RATING_DESC, perPage: 16) {
      nodes { mediaRecommendation { ${CARD_FIELDS} } }
    }
  }
}`;

// ---------------------------------------------------------------------------
// Browse filter model
// ---------------------------------------------------------------------------

export interface BrowseFilters {
  sort?: string[];
  season?: string;
  seasonYear?: number;
  /** Inclusive year RANGE (startDate-based). AniList has no seasonYear_in, but
   *  startDate_greater/lesser gives a contiguous span, e.g. 2025–2026. When both
   *  are set they take precedence over the single seasonYear. */
  yearFrom?: number;
  yearTo?: number;
  genres?: string[];
  tags?: string[];
  formats?: string[];
  status?: string;
  search?: string;
  isAdult?: boolean;
}

function browseVariables(
  filters: BrowseFilters,
  page: number,
  perPage: number,
): Record<string, unknown> {
  const v: Record<string, unknown> = { page, perPage };
  if (filters.sort && filters.sort.length > 0) v.sort = filters.sort;
  if (filters.season) v.season = filters.season;
  // Year RANGE (startDate FuzzyDateInt YYYYMMDD) wins over the single seasonYear.
  if (filters.yearFrom || filters.yearTo) {
    if (filters.yearFrom) v.startDate_greater = filters.yearFrom * 10000 + 101;
    if (filters.yearTo) v.startDate_lesser = filters.yearTo * 10000 + 1231;
  } else if (filters.seasonYear) {
    v.seasonYear = filters.seasonYear;
  }
  if (filters.genres && filters.genres.length > 0) v.genre_in = filters.genres;
  if (filters.tags && filters.tags.length > 0) v.tag_in = filters.tags;
  if (filters.formats && filters.formats.length > 0)
    v.format_in = filters.formats;
  if (filters.status) v.status = filters.status;
  if (filters.search?.trim()) v.search = filters.search.trim();
  if (filters.isAdult) v.isAdult = true;
  return v;
}

/** Run one page of the flexible browse query (shelves, grid, and search all use it). */
export async function fetchMediaPage(
  filters: BrowseFilters,
  page = 1,
  perPage = 30,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<AnilistPage<AnilistMediaPreview>> {
  const data = await gqlRequest<{ Page: AnilistPage<AnilistMediaPreview> }>(
    BROWSE_QUERY,
    browseVariables(filters, page, perPage),
    fetchFn,
  );
  return data.Page;
}

/** Convenience for shelves: just the media array of page 1. */
export async function fetchMediaList(
  filters: BrowseFilters,
  perPage = 20,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<AnilistMediaPreview[]> {
  const page = await fetchMediaPage(filters, 1, perPage, fetchFn);
  return page.media ?? [];
}

export async function fetchMediaDetail(
  id: number,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<AnilistMediaDetail | null> {
  const data = await gqlRequest<{ Media: AnilistMediaDetail | null }>(
    DETAIL_QUERY,
    { id },
    fetchFn,
  );
  return data.Media ?? null;
}

/** Debounced search wrapper (paged). isAdult stays filtered out by default. */
export async function searchMedia(
  query: string,
  page = 1,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<AnilistPage<AnilistMediaPreview>> {
  return fetchMediaPage(
    { search: query, sort: ["SEARCH_MATCH"] },
    page,
    30,
    fetchFn,
  );
}

// ---------------------------------------------------------------------------
// Shelf presets (the index screen's rows)
// ---------------------------------------------------------------------------

export interface ShelfPreset {
  key: string;
  title: string;
  filters: BrowseFilters;
}

/** Northern-hemisphere anime seasons (AniList's own convention). */
export function currentSeason(now = new Date()): {
  season: string;
  year: number;
} {
  const m = now.getUTCMonth(); // 0-11
  const year = now.getUTCFullYear();
  if (m <= 1 || m === 11) {
    // Dec, Jan, Feb → WINTER (Dec rolls into next year's winter)
    return { season: "WINTER", year: m === 11 ? year + 1 : year };
  }
  if (m <= 4) return { season: "SPRING", year };
  if (m <= 7) return { season: "SUMMER", year };
  return { season: "FALL", year };
}

export function shelfPresets(now = new Date()): ShelfPreset[] {
  const { season, year } = currentSeason(now);
  return [
    {
      key: "trending",
      title: "Trending Now",
      filters: { sort: ["TRENDING_DESC", "POPULARITY_DESC"] },
    },
    {
      key: "season",
      title: `Popular This Season`,
      filters: { season, seasonYear: year, sort: ["POPULARITY_DESC"] },
    },
    {
      key: "top",
      title: "Top 100 Anime",
      filters: { sort: ["SCORE_DESC"] },
    },
    {
      key: "alltime",
      title: "All-Time Popular",
      filters: { sort: ["POPULARITY_DESC"] },
    },
  ];
}

// ---------------------------------------------------------------------------
// Browse filter options (for the grid's filter bar)
// ---------------------------------------------------------------------------

export const SORT_OPTIONS: { value: string[]; label: string }[] = [
  { value: ["POPULARITY_DESC"], label: "Popular" },
  { value: ["TRENDING_DESC", "POPULARITY_DESC"], label: "Trending" },
  { value: ["SCORE_DESC"], label: "Top Rated" },
  { value: ["FAVOURITES_DESC"], label: "Most Favorited" },
  { value: ["START_DATE_DESC"], label: "Newest" },
  { value: ["TITLE_ROMAJI"], label: "A–Z" },
];

export const FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "TV", label: "TV" },
  { value: "TV_SHORT", label: "TV Short" },
  { value: "MOVIE", label: "Movie" },
  { value: "OVA", label: "OVA" },
  { value: "ONA", label: "ONA" },
  { value: "SPECIAL", label: "Special" },
];

/** AniList airing-status vocabulary (MediaStatus enum). */
export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "RELEASING", label: "Airing" },
  { value: "FINISHED", label: "Finished" },
  { value: "NOT_YET_RELEASED", label: "Upcoming" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "HIATUS", label: "Hiatus" },
];

/** Descending list of years for the standalone Year filter (incl. next year). */
export function yearOptions(now = new Date(), count = 30): number[] {
  const start = now.getFullYear() + 1;
  return Array.from({ length: count }, (_, i) => start - i);
}

/** Season names (decoupled from year) for the Season filter. */
export const SEASON_OPTIONS: { value: string; label: string }[] = [
  { value: "WINTER", label: "Winter" },
  { value: "SPRING", label: "Spring" },
  { value: "SUMMER", label: "Summer" },
  { value: "FALL", label: "Fall" },
];

/** AniList's fixed genre vocabulary. */
export const GENRE_OPTIONS: string[] = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
];

/**
 * A curated subset of AniList's (huge) TAG vocabulary — the discovery win the
 * feature is really about. Full tag list is fetchable but this covers the
 * high-signal browse cases without a second round-trip.
 */
export const TAG_OPTIONS: string[] = [
  "Isekai",
  "Iyashikei",
  "Time Travel",
  "Cyberpunk",
  "Post-Apocalyptic",
  "Revenge",
  "Coming of Age",
  "Historical",
  "Military",
  "School",
  "Shounen",
  "Shoujo",
  "Seinen",
  "Josei",
  "Romantic Comedy",
  "Love Triangle",
  "Cute Girls Doing Cute Things",
  "Gods",
  "Vampire",
  "Samurai",
  "Ninja",
  "Space",
  "Martial Arts",
  "Detective",
  "Battle Royale",
  "Idol",
  "Cooking",
  "Gambling",
];

/** Recent + upcoming anime seasons for the browse season picker. */
export function seasonOptions(
  now = new Date(),
  count = 12,
): { season: string; year: number; label: string }[] {
  const order = ["WINTER", "SPRING", "SUMMER", "FALL"];
  const { season, year } = currentSeason(now);
  let idx = order.indexOf(season);
  let y = year;
  const out: { season: string; year: number; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const s = order[idx];
    out.push({ season: s, year: y, label: `${titleCase(s)} ${y}` });
    idx -= 1;
    if (idx < 0) {
      idx = 3;
      y -= 1;
    }
  }
  return out;
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function displayTitle(
  media: { title: AnilistTitle },
  lang: TitleLanguage = "romaji",
): string {
  const t = media.title ?? {};
  if (lang === "english") return t.english || t.romaji || t.native || "";
  if (lang === "native") return t.native || t.romaji || t.english || "";
  return t.romaji || t.english || t.native || "";
}

/** Title in the language MOST useful to jimaku search (romaji/native). */
export function jimakuTitle(media: { title: AnilistTitle }): string {
  return (
    media.title?.romaji || media.title?.native || media.title?.english || ""
  );
}

export function formatLabel(format?: string | null): string {
  if (!format) return "";
  const map: Record<string, string> = {
    TV: "TV",
    TV_SHORT: "TV Short",
    MOVIE: "Movie",
    SPECIAL: "Special",
    OVA: "OVA",
    ONA: "ONA",
    MUSIC: "Music",
  };
  return map[format] ?? titleCase(format.replace(/_/g, " "));
}

export function seasonLabel(
  season?: string | null,
  year?: number | null,
): string {
  if (!season && !year) return "";
  if (!season) return String(year);
  return `${titleCase(season)}${year ? ` ${year}` : ""}`;
}

/**
 * AniList score → pill color (their own thresholds: green ≥75, orange 60–74,
 * red <60). Returns a hex string; caller renders the pill.
 */
export function scoreColor(score?: number | null): string {
  if (score == null) return "#4b5563"; // gray-600
  if (score >= 75) return "#16a34a"; // green-600
  if (score >= 60) return "#d97706"; // amber-600
  return "#dc2626"; // red-600
}

/** Plain-text one-liner from AniList's HTML/newline description. */
export function stripDescription(desc?: string | null): string {
  if (!desc) return "";
  return desc
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/**
 * The number of episodes SAFE to offer for playback: capped at the last AIRED
 * episode (nextAiringEpisode - 1) when the show is still airing, else the full
 * episode count. Returns 0 when unknown (single-video / movie handled by caller).
 */
export function airedEpisodeCount(
  media: Pick<AnilistMediaPreview, "episodes" | "nextAiringEpisode">,
): number {
  const next = media.nextAiringEpisode?.episode;
  if (next && next > 1) {
    const aired = next - 1;
    return media.episodes ? Math.min(aired, media.episodes) : aired;
  }
  return media.episodes ?? 0;
}

/** Is this a single-video title (movie / one-shot special)? */
export function isSingleVideo(
  media: Pick<AnilistMediaPreview, "format" | "episodes">,
): boolean {
  if (media.format === "MOVIE" || media.format === "MUSIC") return true;
  return (media.episodes ?? 0) <= 1;
}

/**
 * Map episode NUMBER → its streaming-episode metadata (title/thumbnail).
 * AniList's streamingEpisodes array is NOT reliably ordered by episode and is
 * often sparse or empty (upcoming / newly-airing shows, non-Crunchyroll titles),
 * so we parse the episode number out of the title ("Episode 12 - …") and fall
 * back to array position. First entry for a given number wins.
 */
export function episodeStreamMap(
  streamingEpisodes?: AnilistStreamingEpisode[] | null,
): Map<number, AnilistStreamingEpisode> {
  const map = new Map<number, AnilistStreamingEpisode>();
  (streamingEpisodes ?? []).forEach((se, i) => {
    const m = se.title?.match(/episode\s*(\d+)/i);
    const num = m ? Number(m[1]) : i + 1;
    if (!map.has(num)) map.set(num, se);
  });
  return map;
}

/** Strip the "Episode N - " prefix from a streamingEpisode title. */
export function cleanEpisodeTitle(title?: string | null): string {
  if (!title) return "";
  return title.replace(/^episode\s*\d+\s*[-:–—]?\s*/i, "").trim();
}

/** Best cover image URL for a card. */
export function coverUrl(media: AnilistMediaPreview): string | undefined {
  return (
    media.coverImage?.extraLarge ||
    media.coverImage?.large ||
    media.coverImage?.medium ||
    undefined
  );
}
