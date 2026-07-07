/*
 * AniList → playback-id bridge — pure, RN-free, bun-testable.
 *
 * AniList ids are not directly resolvable by the Stremio addons (aiometadata
 * advertises `anilist:` but returns null). The working bridge is arm.haglund.dev
 * (no key): anilist → { kitsu, imdb, myanimelist, thetvdb, themoviedb, +season }.
 *
 * PLAYBACK ID DECISION (probed live 2026-07-04, see FEATURES.md §11):
 * - kitsu-FIRST. aiostream resolves `kitsu:<id>:<episode>` (a SINGLE number, no
 *   season). kitsu, like AniList, splits every cour into its own entry numbered
 *   from 1, so AniList episode N → `kitsu:<id>:N` is aligned by construction and
 *   keeps playback scoped to the exact cour the user browsed.
 * - imdb (`tt`) is FALLBACK ONLY (movies) — driving imdb ids with AniList numbers
 *   BREAKS multi-cour shows (imdb meta is TVDB-numbered + collapses the franchise).
 *
 * MMKV caching lives in useAnilistIdMap.ts; this stays pure.
 */

export const ARM_ENDPOINT = "https://arm.haglund.dev/api/v2/ids";

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface AnilistIdMap {
  anilist?: number | null;
  anidb?: number | null;
  myanimelist?: number | null;
  kitsu?: number | null;
  imdb?: string | null;
  themoviedb?: number | null;
  thetvdb?: number | null;
  "thetvdb-season"?: number | null;
  "themoviedb-season"?: number | null;
}

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Resolve an AniList id to the id-map. Returns null on a miss / failure (the
 * caller decides whether to fall back to the Fribb static map or disable play).
 */
export async function fetchIdMap(
  anilistId: number,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<AnilistIdMap | null> {
  const url = `${ARM_ENDPOINT}?source=anilist&id=${encodeURIComponent(
    String(anilistId),
  )}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal });
    if (res.status === 404) return null; // arm 404s an unmapped id
    if (!res.ok) throw new Error(`arm HTTP ${res.status}`);
    const data = (await res.json()) as AnilistIdMap | null;
    if (!data || typeof data !== "object") return null;
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stremio stream id for the kitsu path: `kitsu:<id>:<episode>` for a series (a
 * SINGLE number — kitsu has no season segment), `kitsu:<id>` for a single video.
 */
export function kitsuStreamId(kitsuId: number, episode?: number): string {
  return episode !== undefined && episode !== null
    ? `kitsu:${kitsuId}:${episode}`
    : `kitsu:${kitsuId}`;
}

/** imdb fallback id (movies only): bare `tt…` — never appended with AniList numbers. */
export function imdbMovieStreamId(imdb: string): string {
  return imdb;
}

export interface PlaybackTarget {
  /** Stremio stream id to resolve. */
  streamId: string;
  /** Candidate Stremio content types to try (addons vary: anime/series/movie). */
  types: string[];
  /** Which id source resolved this (for UI / debugging). */
  source: "kitsu" | "imdb";
}

/**
 * Decide the Stremio stream id + candidate types for a play request.
 *
 * kitsu-first (episode-aligned, cour-scoped). imdb is used ONLY for single-video
 * titles (movies) when kitsu is absent, and NEVER carries an AniList episode
 * number (that breaks multi-cour shows). Returns null when nothing is playable.
 */
export function resolvePlaybackTarget(
  idMap: AnilistIdMap | null,
  opts: { episode?: number; singleVideo: boolean },
): PlaybackTarget | null {
  const kitsu = idMap?.kitsu;
  if (kitsu != null) {
    return {
      streamId: kitsuStreamId(
        kitsu,
        opts.singleVideo ? undefined : opts.episode,
      ),
      // kitsu ids live under "anime" (kitsu addon) but aggregators also expose
      // "series"/"movie" — try all; unsupported types just return no streams.
      types: opts.singleVideo
        ? ["movie", "anime", "series"]
        : ["anime", "series"],
      source: "kitsu",
    };
  }
  // imdb fallback: single-video only (movies) — safe without an episode number.
  const imdb = idMap?.imdb;
  if (imdb && opts.singleVideo) {
    return {
      streamId: imdbMovieStreamId(imdb),
      types: ["movie"],
      source: "imdb",
    };
  }
  return null;
}
