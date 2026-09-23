/*
 * Yozora API types (SPEC domains mirrored from ~/playground/yozora's
 * packages/shared Zod schemas). Hand-authored on purpose: the Yozora repo is a
 * separate project, so we don't share its package. These MUST track the served
 * OpenAPI (`/api/v1/openapi.json`); Yozora's API-1 guarantees additive-only
 * changes, so drift is safe (new fields we ignore).
 *
 * When Yozora is reachable at build time, prefer regenerating from OpenAPI:
 *   bunx openapi-typescript <baseUrl>/api/v1/openapi.json -o utils/yozora/types.gen.ts
 * and re-exporting the pieces below. Until then this file is the contract.
 *
 * Canonical identity (SPEC §2): title_key ∈
 *   tmdb:movie:{id} | tmdb:show:{id} | anilist:{id}
 * episode encoding: "{s}:{e}" for tmdb shows, "{n}" for anime, absent for movies.
 */

// ── Identity ────────────────────────────────────────────────────────────────

export type TitleKind = "movie" | "show" | "anime";

/** RES-15 stable resolution error codes (+ our transport codes). */
export type ResolveErrorCode =
  | "NO_SOURCES"
  | "NOTHING_CACHED"
  | "ADDON_TIMEOUT"
  | "TORBOX_RATE_LIMITED"
  | "TORBOX_ERROR"
  | "NO_MAPPING"
  | "NO_FILE_MATCH";

// ── Discovery / metadata ─────────────────────────────────────────────────────

export interface NextAiring {
  episode: number;
  airs_at: string;
}

export interface TitleSummary {
  title_key: string;
  kind: TitleKind;
  title: string;
  year: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  rating: number | null;
  overview: string | null;
  next_airing?: NextAiring | null;
  /** AniList title renditions (anime only) — client picks via the user's
   *  title-language setting (Romaji/English/日本語 toggle). DSC-2 amendment. */
  titles?: {
    romaji: string | null;
    english: string | null;
    native: string | null;
  };
}

export interface CastMember {
  name: string;
  character: string | null;
  profile_url: string | null;
  va_profile_url?: string | null;
}

export interface SeasonSummary {
  season: number;
  name: string;
  episode_count: number;
  air_date: string | null;
  poster_url: string | null;
}

export interface RelatedTitle {
  relation: string;
  title: TitleSummary;
}

export interface TitleGenre {
  id: number | null;
  name: string;
}

export interface TitleDetail extends TitleSummary {
  tagline: string | null;
  genres: TitleGenre[];
  runtime_min: number | null;
  status: string | null;
  external_ids: {
    imdb: string | null;
    kitsu?: number | null;
    mal?: number | null;
  };
  cast: CastMember[];
  recommendations: TitleSummary[];
  seasons: SeasonSummary[] | null;
  // anime-only (absent for tmdb titles)
  start_date?: string | null;
  format?: string | null;
  season_label?: string | null;
  episodes_total?: number | null;
  studios?: string[];
  relations?: RelatedTitle[];
  title_variants?: string[];
  canonical_key?: string;
}

export interface EpisodeSummary {
  episode: string;
  number: number;
  name: string;
  overview: string | null;
  air_date: string | null;
  runtime_min: number | null;
  still_url: string | null;
  rating: number | null;
  aired?: boolean;
}

export interface EpisodesResponse {
  title_key: string;
  season: number | null;
  episodes: EpisodeSummary[];
  page?: number;
  page_size?: number;
  total?: number | null;
}

/** Kitsu page cap; anime episode lists page in 20s (SPEC ANIME_EPISODES_PAGE_SIZE). */
export const ANIME_EPISODES_PAGE_SIZE = 20;

// ── Resolution (SPEC §8) ─────────────────────────────────────────────────────

export type Resolution = "480p" | "720p" | "1080p" | "2160p";
export type QualityClass =
  | "remux"
  | "bluray"
  | "webdl"
  | "webrip"
  | "hdtv"
  | "cam"
  | "unknown";

export interface ParsedRelease {
  resolution: Resolution | null;
  quality_class: QualityClass;
  codec: string | null;
  audio: string[];
  hdr: string[];
  dv_profile5_suspect: boolean;
  group: string | null;
  langs: string[];
  season_pack: boolean;
}

export interface Source {
  info_hash: string;
  name: string;
  addon: string;
  size_bytes: number | null;
  seeders: number | null;
  file_idx: number | null;
  parsed: ParsedRelease;
  cached: boolean;
}

export interface SourcesResponse {
  title_key: string;
  episode: string | null;
  sources: Source[];
}

export interface ResolveRequest {
  title_key: string;
  episode?: string;
  info_hash?: string;
  profile?: string;
}

export interface ResolveResponse {
  url: string;
  expires_at: string | null;
  info_hash: string;
  file: { id: string; name: string; size_bytes: number | null };
  source: Source | null;
  subtitles_hint: string;
}

// ── Progress (SPEC §9) ───────────────────────────────────────────────────────

export type TickState = "playing" | "paused" | "seeked" | "stopped" | "ended";
export type ProgressState = "not_resumable" | "in_progress" | "watched";

export interface ProgressTickRequest {
  title_key: string;
  episode?: string;
  position_sec: number;
  duration_sec: number;
  state: TickState;
}

export interface ProgressTickResponse {
  title_key: string;
  episode: string | null;
  state: ProgressState;
  position_sec: number;
  duration_sec: number | null;
}

export interface ProgressEntry {
  episode: string | null;
  position_sec: number;
  duration_sec: number | null;
  state: ProgressState;
  updated_at: string;
}

export interface TitleProgressResponse {
  title_key: string;
  items: ProgressEntry[];
}

export type ContinueWatchingKind = "resume" | "next_up" | "sequel" | "waiting";

export interface ContinueWatchingItem {
  kind: ContinueWatchingKind;
  title: TitleSummary;
  episode: string | null;
  position_sec: number;
  duration_sec: number | null;
  airs_at?: string | null;
  updated_at: string;
}

// ── Subtitles (SPEC §10) ─────────────────────────────────────────────────────

export type SubtitleFormat = "srt" | "vtt" | "ass" | "ssa";

export interface Subtitle {
  id: number;
  provider: string;
  lang: string;
  name: string;
  format: SubtitleFormat | null;
  title_key: string;
  episode: string | null;
}

export interface SubtitlesResponse {
  title_key: string;
  episode: string | null;
  items: Subtitle[];
}

// ── Auth / user (SPEC §4/§5) ─────────────────────────────────────────────────

export type Role = "admin" | "user";

export interface QualityProfile {
  max_resolution: Resolution;
  min_resolution: Resolution;
  preferred_codecs: string[];
  excluded_codecs: string[];
  excluded_audio: string[];
  hdr_policy: "allow" | "prefer_sdr" | "deny";
  preferred_langs: string[];
  max_size_gb: number;
  allow_dv: boolean;
}

export interface User {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  quality_profile: QualityProfile;
  has_debrid_key: boolean;
  created_at: string;
}

export interface Device {
  id: number;
  name: string;
  created_at: string;
  last_seen_at: string;
}

export interface MeDevice extends Device {
  current: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
  device_name?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  device: Device;
}

// ── Shelves (ADN-6: catalog addons as discovery rows) ──────────────────────

export interface Shelf {
  /** Composite shelf id: {addon_id}:{type}:{catalog_id} */
  id: string;
  name: string;
  addon: string;
}

export interface ShelfItemsResponse {
  shelf: Shelf;
  items: TitleSummary[];
  page: number;
  has_more: boolean;
}

// ── Library (PRG-9/PRG-10: derived viewing state) ───────────────────────────

export interface LibraryResponse {
  continue: ContinueWatchingItem[];
  waiting: ContinueWatchingItem[];
}

export type LibraryHistoryState = "finished" | "stopped";

export interface LibraryHistoryItem {
  title: TitleSummary;
  state: LibraryHistoryState;
  hidden: boolean;
  updated_at: string;
}

export interface HideResponse {
  title_key: string;
  hidden: boolean;
}

// ── Query params ─────────────────────────────────────────────────────────────

/** TMDB movie/show discovery (DSC-1). `q` is mutually exclusive with filters. */
export type DiscoverSort = "trending" | "popularity" | "rating" | "newest";

export interface DiscoverQuery {
  page?: number;
  sort?: DiscoverSort;
  q?: string;
  genres?: string; // comma-separated TMDB genre ids (AND)
  year_min?: number;
  year_max?: number;
  min_rating?: number;
}

export type AnimeDiscoverSort =
  | "trending"
  | "popularity"
  | "rating"
  | "newest"
  | "airing";
export type AnimeSeason = "winter" | "spring" | "summer" | "fall";
export type AnimeFormat =
  | "tv"
  | "tv_short"
  | "movie"
  | "special"
  | "ova"
  | "ona"
  | "music";
export type AnimeStatus = "airing" | "finished" | "upcoming";

export interface AnimeDiscoverQuery {
  page?: number;
  sort?: AnimeDiscoverSort;
  q?: string;
  genres?: string; // comma-separated AniList genre names (AND)
  tags?: string; // comma-separated AniList tag names (AND), e.g. "Isekai"
  season?: AnimeSeason;
  season_year?: number;
  year_min?: number; // inclusive start-year lower bound (AniList startDate)
  year_max?: number; // inclusive start-year upper bound
  format?: AnimeFormat;
  status?: AnimeStatus;
  min_rating?: number;
}

/**
 * TMDB genre vocabularies + AniList genre list. VENDORED from yozora
 * `packages/shared/src/discover.ts` (constants ship in the shared schemas, not
 * over the API). Re-copy when the yozora constants change.
 */
export const TMDB_MOVIE_GENRES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 36, name: "History" },
  { id: 27, name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Science Fiction" },
  { id: 53, name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37, name: "Western" },
];

export const TMDB_TV_GENRES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 10759, name: "Action & Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 10762, name: "Kids" },
  { id: 9648, name: "Mystery" },
  { id: 10765, name: "Sci-Fi & Fantasy" },
  { id: 10766, name: "Soap" },
  { id: 10768, name: "War & Politics" },
  { id: 37, name: "Western" },
];

/** AniList genre vocabulary (stable upstream strings — DSC-2). Vendored, see above. */
export const ANILIST_GENRES: ReadonlyArray<string> = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
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
 * Curated AniList tag vocabulary for the filter modal, grouped for the UI.
 * VENDORED from yozora `packages/shared/src/discover.ts` `ANILIST_TAG_GROUPS`
 * (constants ship in the shared schemas, not over the API — same deal as the
 * TMDB genre tables). Names are AniList's exact tag strings (`tag_in` matches
 * by name). Re-copy when the yozora constant changes.
 */
export const ANILIST_TAG_GROUPS: ReadonlyArray<{
  group: string;
  tags: ReadonlyArray<string>;
}> = [
  {
    group: "Demographic",
    tags: ["Shounen", "Shoujo", "Seinen", "Josei", "Kids"],
  },
  {
    group: "Premise",
    tags: [
      "Isekai",
      "Reincarnation",
      "Time Loop",
      "Time Travel",
      "Battle Royale",
      "Survival",
      "Revenge",
      "Conspiracy",
      "Espionage",
      "Coming of Age",
      "Found Family",
      "Slapstick",
      "Parody",
      "Satire",
      "Iyashikei",
      "Tragedy",
      "Gore",
    ],
  },
  {
    group: "Setting",
    tags: [
      "School",
      "Work",
      "Historical",
      "Military",
      "War",
      "Space",
      "Post-Apocalyptic",
      "Dystopian",
      "Virtual World",
      "Video Games",
      "Urban Fantasy",
      "Cyberpunk",
      "Steampunk",
      "Space Opera",
      "Mythology",
      "Cultivation",
      "Dungeon",
      "Afterlife",
    ],
  },
  {
    group: "Characters",
    tags: [
      "Anti-Hero",
      "Female Protagonist",
      "Male Protagonist",
      "Ensemble Cast",
      "Villainess",
      "Idol",
      "Detective",
      "Ninja",
      "Samurai",
      "Assassins",
      "Witch",
      "Vampire",
      "Zombie",
      "Demons",
      "Dragons",
      "Ghost",
      "Kaiju",
      "Superhero",
      "Super Power",
      "Mafia",
      "Yakuza",
      "Pirates",
    ],
  },
  {
    group: "Romance & drama",
    tags: [
      "Love Triangle",
      "Harem",
      "Reverse Harem",
      "Age Gap",
      "Arranged Marriage",
      "Boys' Love",
      "Yuri",
    ],
  },
  {
    group: "Hobbies & sports",
    tags: [
      "Cooking",
      "Food",
      "Gambling",
      "Card Battle",
      "Band",
      "Martial Arts",
      "Swordplay",
      "Baseball",
      "Basketball",
      "Boxing",
      "Cycling",
      "Football",
      "Swimming",
      "Volleyball",
    ],
  },
];

// ── Envelopes ────────────────────────────────────────────────────────────────

export interface ErrorResponse {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  has_more: boolean;
}
