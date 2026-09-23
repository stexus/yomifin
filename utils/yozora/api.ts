/*
 * Yozora API client — pure, RN-free, bun-testable (fetch is injectable, config
 * is passed in; no settings/MMKV reads here, exactly like utils/yomifin/*).
 * Device-only glue (reading the token/URL out of settings, React hooks) lives
 * in utils/yozora/session.ts — NOT here.
 *
 * Yozora is the self-hosted debrid-streaming backend (~/playground/yozora). It
 * does all stream resolution + progress tracking server-side behind one
 * versioned API (`/api/v1`, OpenAPI-generated). It replaced the old client-side
 * addon fan-out and AniList/arm bridge (deleted in migration Phase 4).
 * See docs/yomifin/archive/YOZORA_MIGRATION_PLAN.md.
 *
 *   const api = createYozoraClient({ baseUrl, token });
 *   await api.discoverAnime({ sort: "trending" });
 */

import type {
  AnimeDiscoverQuery,
  ContinueWatchingItem,
  DiscoverQuery,
  EpisodesResponse,
  ErrorResponse,
  HideResponse,
  LibraryHistoryItem,
  LibraryResponse,
  LoginResponse,
  Paginated,
  ProgressTickRequest,
  ProgressTickResponse,
  ResolveRequest,
  ResolveResponse,
  ShelfItemsResponse,
  SourcesResponse,
  Subtitle,
  SubtitlesResponse,
  TitleDetail,
  TitleProgressResponse,
  TitleSummary,
  User,
  Shelf as YozoraShelf,
} from "./types";

/** Minimal fetch shape so tests can inject a fake (mirrors utils/yomifin/jimaku). */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface YozoraConfig {
  /** Deployment origin, e.g. https://yozora.example.com (trailing slash and a
   *  trailing /api/v1 are both tolerated). */
  baseUrl: string;
  /** Bearer device token (AUTH-2); omit for the unauthenticated login call. */
  token?: string | null;
  /** Injectable for tests; defaults to global fetch on device. */
  fetch?: FetchLike;
}

/** Structured API failure carrying the stable machine code (API-3 / RES-15). */
export class YozoraApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "YozoraApiError";
  }
}

const API_PREFIX = "/api/v1";

/** Normalize an origin to `<scheme>://host[:port]` with no trailing slash or /api/v1. */
export function normalizeBaseUrl(raw: string): string {
  let s = (raw ?? "").trim().replace(/\/+$/, "");
  s = s.replace(/\/api\/v1$/, "");
  return s;
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return "";
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return pairs.length ? `?${pairs.join("&")}` : "";
}

function isErrorEnvelope(x: unknown): x is ErrorResponse {
  return (
    typeof x === "object" &&
    x !== null &&
    "error" in x &&
    typeof (x as ErrorResponse).error?.code === "string"
  );
}

export interface YozoraClient {
  readonly baseUrl: string;
  // discovery
  discoverAnime(q?: AnimeDiscoverQuery): Promise<Paginated<TitleSummary>>;
  discoverMovies(q?: DiscoverQuery): Promise<Paginated<TitleSummary>>;
  discoverShows(q?: DiscoverQuery): Promise<Paginated<TitleSummary>>;
  search(q: string, page?: number): Promise<Paginated<TitleSummary>>;
  shelves(page?: number): Promise<Paginated<YozoraShelf>>;
  shelfItems(shelfId: string, page?: number): Promise<ShelfItemsResponse>;
  // metadata
  titleDetail(titleKey: string): Promise<TitleDetail>;
  episodes(
    titleKey: string,
    opts?: { season?: number; page?: number },
  ): Promise<EpisodesResponse>;
  // resolution
  sources(
    titleKey: string,
    opts?: { episode?: string; profile?: string },
  ): Promise<SourcesResponse>;
  resolve(req: ResolveRequest): Promise<ResolveResponse>;
  // progress
  progressTick(req: ProgressTickRequest): Promise<ProgressTickResponse>;
  titleProgress(titleKey: string): Promise<TitleProgressResponse>;
  continueWatching(page?: number): Promise<Paginated<ContinueWatchingItem>>;
  markWatched(titleKey: string, episode?: string): Promise<void>;
  markUnwatched(titleKey: string, episode?: string): Promise<void>;
  // library (PRG-9/PRG-10)
  library(): Promise<LibraryResponse>;
  libraryHistory(page?: number): Promise<Paginated<LibraryHistoryItem>>;
  hideTitle(titleKey: string): Promise<HideResponse>;
  unhideTitle(titleKey: string): Promise<HideResponse>;
  // subtitles
  subtitles(
    titleKey: string,
    opts?: { episode?: string; langs?: string; q?: string; provider?: string },
  ): Promise<SubtitlesResponse>;
  /** Absolute URL to a cached subtitle file (SUB-3: ?format=vtt for browsers). */
  subtitleUrl(id: number, opts?: { format?: "vtt" }): string;
  /** Fetch a subtitle file's raw text (authenticated GET /subtitles/{id}). */
  subtitleContent(id: number): Promise<string>;
  /** SUB-6: server-side alass re-time against the playing file. Returns the
   *  synced row (provider "sync") — fetch via subtitleContent like any other. */
  syncSubtitle(id: number, streamUrl?: string): Promise<Subtitle>;
  // auth / account
  login(
    username: string,
    password: string,
    deviceName?: string,
  ): Promise<LoginResponse>;
  me(): Promise<User>;
  logoutDevice(deviceId: number): Promise<void>;
  /** Cheap reachability probe (unauthenticated). */
  health(): Promise<{ status: string; version: string; time: string }>;
}

export function createYozoraClient(config: YozoraConfig): YozoraClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fetchFn: FetchLike = config.fetch ?? (globalThis.fetch as FetchLike);

  async function request<T>(
    path: string,
    opts?: {
      method?: string;
      query?: Record<string, unknown>;
      body?: unknown;
      /** Endpoints that return 204/empty. */
      noContent?: boolean;
    },
  ): Promise<T> {
    const url = `${baseUrl}${API_PREFIX}${path}${buildQuery(opts?.query)}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    if (opts?.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchFn(url, {
        method: opts?.method ?? "GET",
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new YozoraApiError(
        0,
        "NETWORK_ERROR",
        `Could not reach Yozora at ${baseUrl}: ${(e as Error).message}`,
      );
    }

    if (!res.ok) {
      let code = `HTTP_${res.status}`;
      let message = `Request failed (${res.status})`;
      let details: unknown;
      try {
        const parsed = await res.json();
        if (isErrorEnvelope(parsed)) {
          code = parsed.error.code;
          message = parsed.error.message;
          details = parsed.error.details;
        }
      } catch {
        // non-JSON error body — keep the HTTP fallbacks
      }
      throw new YozoraApiError(res.status, code, message, details);
    }

    if (opts?.noContent) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    baseUrl,

    discoverAnime: (q) =>
      request("/discover/anime", { query: q as Record<string, unknown> }),

    discoverMovies: (q) =>
      request("/discover/movies", { query: q as Record<string, unknown> }),

    discoverShows: (q) =>
      request("/discover/shows", { query: q as Record<string, unknown> }),

    search: (q, page) => request("/search", { query: { q, page } }),

    shelves: (page) => request("/shelves", { query: { page } }),

    shelfItems: (shelfId, page) =>
      request(`/shelves/${encodeURIComponent(shelfId)}/items`, {
        query: { page },
      }),

    titleDetail: (titleKey) =>
      request(`/titles/${encodeURIComponent(titleKey)}`),

    episodes: (titleKey, opts) =>
      request(`/titles/${encodeURIComponent(titleKey)}/episodes`, {
        query: { season: opts?.season, page: opts?.page },
      }),

    sources: (titleKey, opts) =>
      request(`/titles/${encodeURIComponent(titleKey)}/sources`, {
        query: { episode: opts?.episode, profile: opts?.profile },
      }),

    resolve: (req) => request("/resolve", { method: "POST", body: req }),

    progressTick: (req) => request("/progress", { method: "POST", body: req }),

    titleProgress: (titleKey) =>
      request(`/titles/${encodeURIComponent(titleKey)}/progress`),

    continueWatching: (page) =>
      request("/continue-watching", { query: { page } }),

    markWatched: (titleKey, episode) =>
      request(`/titles/${encodeURIComponent(titleKey)}/watched`, {
        method: "POST",
        body: episode ? { episode } : {},
        noContent: false,
      }).then(() => undefined),

    markUnwatched: (titleKey, episode) =>
      request(`/titles/${encodeURIComponent(titleKey)}/unwatched`, {
        method: "POST",
        body: episode ? { episode } : {},
      }).then(() => undefined),

    library: () => request("/library"),

    libraryHistory: (page) => request("/library/history", { query: { page } }),

    hideTitle: (titleKey) =>
      request(`/titles/${encodeURIComponent(titleKey)}/hide`, {
        method: "POST",
      }),

    unhideTitle: (titleKey) =>
      request(`/titles/${encodeURIComponent(titleKey)}/hide`, {
        method: "DELETE",
      }),

    subtitles: (titleKey, opts) =>
      request(`/titles/${encodeURIComponent(titleKey)}/subtitles`, {
        query: {
          episode: opts?.episode,
          langs: opts?.langs,
          q: opts?.q,
          provider: opts?.provider,
        },
      }),

    subtitleUrl: (id, opts) =>
      `${baseUrl}${API_PREFIX}/subtitles/${id}${buildQuery(
        opts?.format ? { format: opts.format } : undefined,
      )}`,

    subtitleContent: async (id) => {
      const url = `${baseUrl}${API_PREFIX}/subtitles/${id}`;
      const headers: Record<string, string> = {};
      if (config.token) headers.Authorization = `Bearer ${config.token}`;
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetchFn(url, { headers });
      } catch (e) {
        throw new YozoraApiError(
          0,
          "NETWORK_ERROR",
          `Could not reach Yozora at ${baseUrl}: ${(e as Error).message}`,
        );
      }
      if (!res.ok) {
        let code = `HTTP_${res.status}`;
        let message = `Subtitle download failed (${res.status})`;
        try {
          const parsed = await res.json();
          if (isErrorEnvelope(parsed)) {
            code = parsed.error.code;
            message = parsed.error.message;
          }
        } catch {}
        throw new YozoraApiError(res.status, code, message);
      }
      return res.text();
    },

    syncSubtitle: (id, streamUrl) =>
      request(`/subtitles/${id}/sync`, {
        method: "POST",
        body: streamUrl ? { stream_url: streamUrl } : {},
      }),

    login: (username, password, deviceName) =>
      request("/auth/login", {
        method: "POST",
        body: { username, password, device_name: deviceName },
      }),

    me: () => request("/me"),

    logoutDevice: (deviceId) =>
      request(`/me/devices/${deviceId}`, {
        method: "DELETE",
        noContent: true,
      }),

    health: () => request("/health"),
  };
}
